import React from 'react';
import { formatDSLDiagnostic } from '../../core/validator/schema.js';
import { validateDSL, getLineIndent } from '../../core/validator/uiDslValidator.js';
import { collectDSLFixes } from '../../core/validator/fixes.js';
import { generateDSL } from '../../core/stacksToDsl.js';
import { postJsonWithCsrf, isMobileBuilderViewport } from '../apiClient.js';
import { BuilderUiContext } from '../builderContext.js';
import { getConstructorStrings } from '../builderI18n.js';
import { BLOCK_TYPES } from './BuilderComponents.jsx';

// ─── DSL VALIDATOR ────────────────────────────────────────────────────────
// Общая логика проверки вынесена в core/validator/uiDslValidator.js,
// чтобы UI и серверная AI-генерация использовали одни и те же правила.

function buildAutoFixFromValidation(code, validationResult) {
  if (!validationResult) return { correctedCode: code, changedLineIndexes: [], fixes: [] };
  const lint = collectDSLFixes(code);
  const fixes = [...(lint.fixes || [])];
  let text = lint.correctedCode || code;
  let lines = text.split('\n');
  const changed = new Set(lint.changedLines || []);

  const hasEmptyTokenError = (validationResult.errors || []).some((e) =>
    String(e).includes('пустой токен бота'),
  );
  const dslHasEmptyBotToken = String(code || '').split(/\n/).some((raw) => {
    const m = raw.trim().match(/^бот\s+"([^"]*)"\s*$/);
    return m !== null && (!m[1] || !String(m[1]).trim());
  });
  if (hasEmptyTokenError || dslHasEmptyBotToken) {
    for (let i = 0; i < lines.length; i += 1) {
      if (/^\s*бот\s+"[^"]*"\s*$/.test(lines[i])) {
        const before = lines[i];
        const after = 'бот "PASTE_BOT_TOKEN_HERE"';
        if (before !== after) {
          lines[i] = after;
          changed.add(i);
          fixes.push({
            line: i + 1,
            message: 'Не указан токен бота — подставлен placeholder (вставь токен от @BotFather или замени строку сам)',
            before,
            after,
          });
        }
        break;
      }
    }
  }

  const missingStartError = (validationResult.errors || []).some((e) =>
    String(e).includes('Нет «при старте»'),
  );
  if (missingStartError) {
    const beforeLen = lines.length;
    if (lines.length > 0 && lines[lines.length - 1].trim() !== '') lines.push('');
    const startIdx = lines.length;
    lines.push('при старте:');
    lines.push('    ответ "Привет!"');
    changed.add(startIdx);
    changed.add(startIdx + 1);
    fixes.push({
      line: startIdx + 1,
      message: 'Добавлен базовый обработчик старта',
      before: '',
      after: 'при старте:\n    ответ "Привет!"',
    });
    if (beforeLen === 0) changed.add(0);
  }

  text = lines.join('\n');
  return {
    correctedCode: text,
    changedLineIndexes: [...changed].sort((a, b) => a - b),
    fixes,
  };
}

function isStaleForwardInputDiagnostic(diag, code) {
  if (!diag || !['DSL001', 'DSL003'].includes(String(diag.code || ''))) return false;
  const lineNo = Number(diag.line || 0);
  if (!Number.isInteger(lineNo) || lineNo < 1) return false;
  const line = String(code || '').replace(/\r\n/g, '\n').split('\n')[lineNo - 1]?.trim() || '';
  return /^переслать\s+(?:текст|фото|документ|голосовое|аудио|стикер)(?:\s+"[^"]*")?\s*$/i.test(line);
}

function normalizeDslUI(input) {
  const source = String(input || '');
  const lines = source.split('\n');
  const blockBodies = new Map();

  // 1) Собираем блоки для развёртки `использовать <блок>`
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    const m = t.match(/^блок\s+([^\s:]+)\s*:\s*$/i);
    if (!m) continue;
    const name = m[1];
    const baseIndent = getLineIndent(lines[i]);
    const body = [];
    let j = i + 1;
    while (j < lines.length) {
      const nt = lines[j].trim();
      const ind = getLineIndent(lines[j]);
      if (nt && ind <= baseIndent) break;
      body.push(lines[j]);
      j += 1;
    }
    blockBodies.set(name, body);
  }

  // 2) Разворачиваем `использовать` + нормализуем body
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trim = line.trim();
    const indent = getLineIndent(line);
    out.push(line);
    if (!trim.endsWith(':')) continue;

    const bodyStart = i + 1;
    let j = bodyStart;
    while (j < lines.length) {
      const t = lines[j].trim();
      const ind = getLineIndent(lines[j]);
      if (t && ind <= indent) break;
      j += 1;
    }
    const body = lines.slice(bodyStart, j);
    if (!body.length) continue;

    const logic = [];
    const answers = [];
    const stopLines = [];
    let buttons = null;

    for (let k = 0; k < body.length; k += 1) {
      const ln = body[k];
      const t = ln.trim();
      if (!t) { logic.push(ln); continue; }

      const useMatch = t.match(/^использовать\s+([^\s]+)\s*$/i);
      if (useMatch && blockBodies.has(useMatch[1])) {
        const blockLines = blockBodies.get(useMatch[1]) || [];
        blockLines.forEach((bLine) => {
          const bt = bLine.trim();
          if (/^(?:ответ|ответ_md)\s+/i.test(bt)) answers.push(bLine);
          else if (/^кнопки(?:\s|:|$)/i.test(bt) || /^inline-кнопки:?\s*$/i.test(bt)) {
            if (!buttons) buttons = [bLine];
          } else if (/^(?:стоп|завершить|завершить сценарий|вернуть)\b/i.test(bt)) {
            stopLines.push(bLine);
          } else logic.push(bLine);
        });
        continue;
      }

      if (/^(?:стоп|завершить|завершить сценарий|вернуть)\b/i.test(t)) { stopLines.push(ln); continue; }
      if (/^(?:ответ|ответ_md)\s+/i.test(t)) { answers.push(ln); continue; }
      if (/^кнопки(?:\s|:|$)/i.test(t) || /^inline-кнопки:?\s*$/i.test(t)) {
        if (!buttons) {
          const btnChunk = [ln];
          const lnIndent = getLineIndent(ln);
          let x = k + 1;
          while (x < body.length) {
            const nt = body[x].trim();
            const nIndent = getLineIndent(body[x]);
            if (nt && nIndent <= lnIndent) break;
            btnChunk.push(body[x]);
            x += 1;
          }
          buttons = btnChunk;
        }
        continue;
      }
      logic.push(ln);
    }

    if (trim.startsWith('иначе') && answers.length === 0) {
      answers.push(`${' '.repeat(indent + 4)}ответ "..."`);
    }

    const normalized = [...logic, ...answers];
    if (buttons) normalized.push(...buttons);
    if (buttons || stopLines.length > 0) normalized.push(`${' '.repeat(indent + 4)}стоп`);

    normalized.forEach((ln) => out.push(ln));
    i = j - 1;
  }

  return out.join('\n');
}

export function fixDslSchema(input) {
  return normalizeDslUI(input);
}

// ─── DSL PANEL ────────────────────────────────────────────────────────────
function DSLPane({ stacks, isMobile, onClose, onApplyCorrectedCode }) {
  const ctx = React.useContext(BuilderUiContext);
  const blockTypes = ctx?.blockTypes || BLOCK_TYPES;
  const ui = ctx?.t || getConstructorStrings('ru');

  const dsl = generateDSL(stacks);
  const [validationResult, setValidationResult] = React.useState(null);
  /** После «Применить исправления»: показываем исправленный текст и подсветку строк */
  const [previewCorrected, setPreviewCorrected] = React.useState(null);
  const [highlightRows, setHighlightRows] = React.useState([]); // 0-based индексы строк
  const [fixNotice, setFixNotice] = React.useState('');

  React.useEffect(() => {
    setValidationResult(null);
    setPreviewCorrected(null);
    setHighlightRows([]);
    setFixNotice('');
  }, [dsl]);

  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    const doCopy = (text) => {
      if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text);
      }
      // HTTP fallback via textarea
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return Promise.resolve();
    };
    const textOut = previewCorrected ?? dsl;
    doCopy(textOut).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => {});
  };
  const download = () => {
    const textOut = previewCorrected ?? dsl;
    const blob = new Blob([textOut], { type: 'text/plain;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob), download: 'bot.ccd',
    });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const check = async () => {
    const result = validateDSL(dsl, stacks, blockTypes);
    try {
      const response = await postJsonWithCsrf('/api/dsl/lint', { code: dsl });
      const jr = await response.json().catch(() => ({}));
      const pyAvailable = jr?.available !== false;

      if (response.ok && pyAvailable) {
        if (Array.isArray(jr.diagnostics) && jr.diagnostics.length > 0) {
          const coreDiagnostics = jr.diagnostics.filter((d) => !isStaleForwardInputDiagnostic(d, dsl));
          const pyMsgs = coreDiagnostics.map(
            (d) => `${formatDSLDiagnostic(d)}${ui.dslCoreDiagSuffix}`,
          );
          result.errors = (result.errors || []).filter((e) =>
            typeof e !== 'string' ? true : !(e.includes('[DSL003]') || e.includes('[DSL001]')),
          );
          result.errors = [...pyMsgs, ...result.errors];
        } else if (jr.ok) {
          result.errors = (result.errors || []).filter((e) =>
            typeof e !== 'string' ? true : !(e.includes('[DSL003]') || e.includes('[DSL001]')),
          );
        }
      } else if (jr?.available === false && jr?.error) {
        result.warnings.push(`${ui.dslPyWarnPrefix} ${jr.error}`);
      } else if (jr?.error) {
        result.warnings.push(`${ui.dslPyCheckPrefix} ${jr.error}`);
      }
      // Core hints are shown in the dedicated hints panel below.
      // Do not duplicate them in warnings to avoid mixing diagnostics with suggestions.
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.warnings.push(`${ui.dslPyFail} (${msg}). ${ui.dslPyFailSuffix}`);
    }
    setValidationResult(result);
    setPreviewCorrected(null);
    setHighlightRows([]);
    return result;
  };

  const applySchemaFix = () => {
    const fixed = fixDslSchema(previewCorrected ?? dsl);
    const applied = onApplyCorrectedCode?.(fixed);
    setFixNotice('DSL исправлен и приведён к корректной структуре');
    setTimeout(() => setFixNotice(''), 2200);
    if (!applied) {
      setPreviewCorrected(fixed);
      setHighlightRows(fixed.split('\n').map((_, idx) => idx));
    }
  };



  const applyDetectedFix = async () => {
    const activeResult = validationResult || await check();
    if (!activeResult) return;
    const autoFixed = buildAutoFixFromValidation(previewCorrected ?? dsl, activeResult);
    if ((autoFixed.fixes || []).length > 0) {
      const applied = onApplyCorrectedCode?.(autoFixed.correctedCode);
      setFixNotice(`Применено автоисправлений: ${autoFixed.fixes.length}`);
      setTimeout(() => setFixNotice(''), 2200);
      if (!applied) {
        setPreviewCorrected(autoFixed.correctedCode);
        setHighlightRows(autoFixed.changedLineIndexes || []);
      }
      return;
    }
    if ((activeResult.errors || []).length > 0) {
      applySchemaFix();
      return;
    }
    setFixNotice('Ошибки не найдены: исправление недоступно');
    setTimeout(() => setFixNotice(''), 2200);
  };

  const resetPreview = () => {
    setPreviewCorrected(null);
    setHighlightRows([]);
  };

  const insertSnippet = (snippet) => {
    const clean = String(snippet || '').trim();
    if (!clean) return;
    const base = previewCorrected ?? dsl;
    const nextCode = `${base.replace(/\s*$/, '')}\n${clean}\n`;
    const applied = onApplyCorrectedCode?.(nextCode);
    if (!applied) setPreviewCorrected(nextCode);
  };

  const computedFixes = React.useMemo(
    () => (validationResult ? buildAutoFixFromValidation(dsl, validationResult) : null),
    [dsl, validationResult],
  );
  const visibleErrors = (validationResult?.errors || []);
  const hasErrors = visibleErrors.length > 0;
  const hasWarnings = (validationResult?.warnings?.length ?? 0) > 0;
  const hasFixes = (computedFixes?.fixes?.length ?? 0) > 0;
  const isValid = validationResult && !hasErrors && !hasWarnings && !hasFixes;
  const fixPreviewItems = (computedFixes?.fixes || []).slice(0, 3);

  const displayCode = previewCorrected ?? dsl;
  const displayLines = displayCode.split('\n');
  const isRuntimeMobile = Boolean(isMobile || isMobileBuilderViewport());
  const canClose = !isRuntimeMobile && typeof onClose === 'function';

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      borderTop: '1px solid var(--border)',
      flex: isMobile ? '1 1 auto' : '0 0 50%',
      height: isMobile ? '100%' : undefined,
      minHeight: 0,
      minWidth: 0,
    }}>
      <div style={{
        padding: '5px 10px', display: 'flex', alignItems: 'center',
        justifyContent: 'flex-start', borderBottom: '1px solid var(--border)',
        minWidth: 0,
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6,
          alignItems: 'center', width: '100%', minWidth: 0,
        }}>
          {canClose && (
            <div style={{ display: 'flex', gap: 6, gridColumn: '1 / -1' }}>
              <button
                type="button"
                onClick={onClose}
                title="Закрыть панель кода"
                style={{
                  padding: '4px 8px',
                  borderRadius: 6,
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  lineHeight: 1.2,
                  background: 'rgba(255,255,255,0.04)',
                  color: 'var(--text3)',
                  border: '1px solid var(--border2)',
                  whiteSpace: 'nowrap',
                  width: '100%',
                  minWidth: 0,
                }}
              >
                × Закрыть
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={check}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              fontSize: 10,
              fontWeight: 600,
              border: '1px solid transparent',
              cursor: 'pointer',
              fontFamily: 'inherit',
              lineHeight: 1.2,
              background: validationResult
                ? (hasErrors ? '#ef4444' : hasWarnings ? '#f59e0b' : '#10b981')
                : 'var(--bg3)',
              color: validationResult ? '#fff' : 'var(--text3)',
              width: '100%',
              minWidth: 0,
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => { if (!validationResult) e.currentTarget.style.background = 'var(--accent)'; }}
            onMouseLeave={e => { if (!validationResult) e.currentTarget.style.background = 'var(--bg3)'; }}
          >{ui.dslCheck}</button>
          <button
            type="button"
            onClick={copy}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              lineHeight: 1.2,
              background: copied ? 'var(--accent)' : 'transparent',
              color: copied ? '#fff' : 'var(--text3)',
              border: `1px solid ${copied ? 'var(--accent)' : 'var(--border2)'}`,
              transition: 'background 0.15s, color 0.15s, border-color 0.15s',
              width: '100%',
              minWidth: 0,
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => { if (!copied) { e.currentTarget.style.color = 'var(--text)'; } }}
            onMouseLeave={e => { if (!copied) { e.currentTarget.style.color = 'var(--text3)'; } }}
          >{copied ? ui.dslCopied : ui.dslCopy}</button>
          <button
            type="button"
            onClick={download}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              lineHeight: 1.2,
              background: 'var(--accent)',
              color: '#fff',
              border: '1px solid var(--accent)',
              width: '100%',
              minWidth: 0,
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent2)'; e.currentTarget.style.borderColor = 'var(--accent2)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
          >{ui.dslDownload}</button>
          <button
            type="button"
            onClick={applyDetectedFix}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              lineHeight: 1.2,
              background: (!validationResult || (!hasErrors && !hasFixes)) ? 'var(--bg3)' : '#0ea5e9',
              color: (!validationResult || (!hasErrors && !hasFixes)) ? 'var(--text3)' : '#fff',
              border: '1px solid transparent',
              opacity: (!validationResult || (!hasErrors && !hasFixes)) ? 0.9 : 1,
              width: '100%',
              minWidth: 0,
              whiteSpace: 'nowrap',
            }}
            title={!validationResult ? 'Проверить и применить автоисправления' : (!hasErrors && !hasFixes ? 'Нет ошибок для исправления' : 'Исправить DSL')}
          >
            {`🔧 Исправить${hasFixes ? ` (${computedFixes?.fixes?.length || 0})` : ''}`}
          </button>
        </div>
      </div>

      {/* Validation Results */}
      {validationResult && (
        <div style={{
          padding: '6px 10px', borderBottom: '1px solid var(--border)',
          background: hasErrors ? 'rgba(239,68,68,0.1)' : hasWarnings ? 'rgba(245,158,11,0.1)' : hasFixes ? 'rgba(14,165,233,0.1)' : 'rgba(16,185,129,0.1)',
          maxHeight: '150px', overflowY: 'auto',
        }}>
          {isValid ? (
            <div style={{ fontSize: 10, color: '#10b981', fontWeight: 600 }}>{ui.dslAllGood}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {visibleErrors.map((err, i) => (
                <div key={`err-${i}`} style={{ fontSize: 9, color: '#ef4444' }}>{err}</div>
              ))}
              {validationResult.warnings.map((warn, i) => (
                <div key={`warn-${i}`} style={{ fontSize: 9, color: '#f59e0b' }}>{warn}</div>
              ))}
              {hasFixes && !previewCorrected && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ fontSize: 9, color: '#38bdf8', fontWeight: 600 }}>
                    {`Доступно автоисправлений: ${computedFixes?.fixes?.length || 0}`}
                  </div>
                  {fixPreviewItems.map((fx, i) => (
                    <div key={`fix-${i}`} style={{ fontSize: 9, color: 'var(--text3)' }}>
                      {`строка ${fx.line}: ${fx.message}`}
                    </div>
                  ))}
                </div>
              )}
              {previewCorrected && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  <button
                    type="button"
                    onClick={resetPreview}
                    style={{
                      background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)',
                      borderRadius: 4, fontSize: 9, padding: '4px 8px', cursor: 'pointer',
                    }}
                  >{ui.dslResetPreview}</button>
                  <button
                    type="button"
                    onClick={copy}
                    style={{
                      background: '#10b981', color: '#fff', border: 'none',
                      borderRadius: 4, fontSize: 9, padding: '4px 8px', cursor: 'pointer',
                    }}
                  >{ui.dslCopyFixed}</button>
                </div>
              )}
              {previewCorrected && (
                <div style={{ fontSize: 8, color: 'var(--text3)', marginTop: 2 }}>
                  {ui.dslPreviewFooter}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {fixNotice && (
        <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', background: 'rgba(16,185,129,0.12)', color: '#10b981', fontSize: 10, fontWeight: 600 }}>
          {fixNotice}
        </div>
      )}

      

      <div style={{
        flex: 1, margin: 0, padding: '7px 10px',
        fontSize: 9, lineHeight: 1.65, color: 'var(--text2)',
        fontFamily: 'var(--mono)', overflowY: 'auto',
        background: previewCorrected ? 'rgba(16,185,129,0.06)' : 'var(--bg)',
        borderTop: previewCorrected ? '1px solid rgba(16,185,129,0.25)' : undefined,
      }}>
        {displayLines.map((line, i) => {
          const isHl = previewCorrected && highlightRows.includes(i);
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 8,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                background: isHl ? 'rgba(74,222,128,0.22)' : undefined,
                outline: isHl ? '1px solid rgba(74,222,128,0.45)' : undefined,
                marginLeft: isHl ? -2 : 0,
                paddingLeft: isHl ? 2 : 0,
                borderRadius: isHl ? 3 : 0,
              }}
            >
              <span style={{
                flexShrink: 0, width: 28, textAlign: 'right',
                userSelect: 'none', opacity: 0.35, color: 'var(--text3)',
              }}>{i + 1}</span>
              <span style={{ flex: 1 }}>{line || '\u00a0'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const MemoDSLPane = React.memo(DSLPane);

export default MemoDSLPane;
export { MemoDSLPane as DSLPane };
