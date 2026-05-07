/**
 * Линтер и автоисправления для текста .ccd (DSL Cicada).
 * Используется панелью «проверить»: предложения правок + подсветка строк.
 */

/** Стрелка назначения в DSL — только Unicode → поддерживается парсером ядра целиком */
const ARROW_FIX_DESC =
  'Стрелка назначения: в Cicada нужен символ → (U+2192), а не ASCII ->';

const REPLY_KNOPKI_PIPE_FIX =
  'Reply-кнопки: в поле кнопок и в DSL одна строка — через запятую; символ | здесь не разделитель.';

/**
 * Поле блока «Кнопки» (props.rows): запятая = в одном ряду, Enter = новый ряд.
 * Модели часто ошибочно подставляют | как в inline — заменяем на запятую по строкам.
 * @param {unknown} rows
 * @returns {string}
 */
export function normalizeReplyKeyboardRowsProp(rows) {
  if (typeof rows !== 'string' || !rows.includes('|')) return rows;
  return rows
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (!t.includes('|')) return line;
      const parts = t.split('|').map((s) => s.trim()).filter(Boolean);
      if (parts.length < 2) return line;
      const lead = line.match(/^\s*/)?.[0] ?? '';
      return lead + parts.join(', ');
    })
    .join('\n');
}

const TEMPLATE_VAR_NAME = '[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*';
const TEMPLATE_BAD_CLOSER_RE = new RegExp(`\\{(${TEMPLATE_VAR_NAME})\\s*[)\\]>]`, 'g');
const TEMPLATE_MISSING_CLOSER_RE = new RegExp(`\\{(${TEMPLATE_VAR_NAME})$`, 'g');

/**
 * Исправляет частую ошибку LLM в шаблонах Cicada: {chat_id) / {user_id> вместо {chat_id}.
 * @param {unknown} value
 * @returns {unknown}
 */
export function repairTemplatePlaceholders(value) {
  if (typeof value !== 'string' || !value.includes('{')) return value;
  return value
    .replace(TEMPLATE_BAD_CLOSER_RE, '{$1}')
    .replace(TEMPLATE_MISSING_CLOSER_RE, '{$1}');
}

const AI_TEMPLATE_PROP_KEYS = new Set(['key', 'value', 'text', 'url', 'body']);

const CICADA_IDENTIFIER_RE = /^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*$/;
const AI_QUOTED_STRING_PROP_KEYS = new Set([
  'text', 'question', 'label', 'rows', 'buttons', 'key', 'value',
  'url', 'body', 'caption', 'filename', 'title', 'cmd', 'phone',
  'first_name', 'last_name', 'file_id',
]);

function normalizeCicadaIdentifier(value, fallback = 'значение') {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const normalized = raw
    .replace(/[\s\-–—]+/g, '_')
    .replace(/[^A-Za-zА-Яа-яЁё0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  const withPrefix = /^[0-9]/.test(normalized) ? `v_${normalized}` : normalized;
  return CICADA_IDENTIFIER_RE.test(withPrefix) ? withPrefix : fallback;
}

function normalizeCicadaQuotedString(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/"([^"\n]{1,120})"/g, '«$1»')
    .replace(/"/g, '″');
}

function replaceTemplateVarRefs(value, varNameMap) {
  if (typeof value !== 'string' || !value.includes('{') || varNameMap.size === 0) {
    return value;
  }
  let out = value;
  for (const [from, to] of varNameMap.entries()) {
    if (!from || from === to) continue;
    out = out.split(`{${from}}`).join(`{${to}}`);
  }
  return out;
}

function buildAiNameMaps(stacks) {
  const scenarioNameMap = new Map();
  const stepNameMap = new Map();
  const varNameMap = new Map();

  (stacks || []).forEach((stack) => {
    (stack?.blocks || []).forEach((block) => {
      const props = block?.props || {};
      if (block?.type === 'scenario' && props.name) {
        scenarioNameMap.set(
          String(props.name),
          normalizeCicadaIdentifier(props.name, 'scenario'),
        );
      }
      if (block?.type === 'step' && props.name) {
        stepNameMap.set(
          String(props.name),
          normalizeCicadaIdentifier(props.name, 'step'),
        );
      }
      if (['ask', 'get', 'remember', 'http'].includes(block?.type) && props.varname) {
        varNameMap.set(
          String(props.varname),
          normalizeCicadaIdentifier(props.varname, 'var'),
        );
      }
    });
  });

  return { scenarioNameMap, stepNameMap, varNameMap };
}

const CONFLICT_MARKER_LENGTH = 7;
const MERGE_CONFLICT_MARKERS = ['<', '=', '>'].map((ch) => ch.repeat(CONFLICT_MARKER_LENGTH));

function findUnquotedMergeConflictMarker(line) {
  let inQuote = false;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) continue;
    const marker = MERGE_CONFLICT_MARKERS.find((item) => line.startsWith(item, i));
    if (marker) return i;
  }
  return -1;
}

function stripMergeConflictMarkers(text) {
  return String(text || '')
    .split('\n')
    .map((line) => {
      const trimmed = line.trimStart();
      if (MERGE_CONFLICT_MARKERS.some((marker) => trimmed.startsWith(marker))) return '';
      const markerAt = findUnquotedMergeConflictMarker(line);
      return markerAt === -1 ? line : line.slice(0, markerAt).trimEnd();
    })
    .filter((line) => line.trim())
    .join('\n');
}

const COLLAPSED_CICADA_STARTERS = [
  'inline-кнопки:', 'при геолокации:', 'при документе:', 'при голосовом:',
  'при контакте:', 'при стикере:', 'при старте:', 'при фото:',
  'при нажатии ', 'при команде ', 'сценарий ', 'сохранить_глобально ',
  'проверить подписку ', 'переслать сообщение ', 'запустить ', 'спросить ',
  'получить ', 'сохранить ', 'ответ_md ', 'кнопки:', 'кнопки ', 'команда ',
  'ответ ', 'шаг ', 'бот ', 'стоп', 'пауза ', 'печатает ', 'лог',
];

function isCollapsedStarterBoundary(text, index, starter) {
  if (index <= 0) return true;
  if (/^(?:при|сценарий\s|бот\s)/i.test(starter)) return true;
  const prev = text[index - 1];
  return /[\s"':]/.test(prev);
}

function findCollapsedCicadaStatementStarts(text) {
  const starts = [];
  let inQuote = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) continue;
    const rest = text.slice(i).toLowerCase();
    const starter = COLLAPSED_CICADA_STARTERS.find((item) => rest.startsWith(item));
    if (starter && isCollapsedStarterBoundary(text, i, starter)) {
      starts.push(i);
    }
  }
  return [...new Set(starts)].sort((a, b) => a - b);
}

function splitCollapsedCicadaStatements(text) {
  const starts = findCollapsedCicadaStatementStarts(text);
  if (starts.length <= 1) return null;
  return starts
    .map((start, idx) => text.slice(start, starts[idx + 1] ?? text.length).trim())
    .filter(Boolean);
}

function normalizeCicadaBotLine(statement) {
  const trimmed = statement.trim();
  if (/^бот\s*""\s*$/i.test(trimmed)) return 'бот "YOUR_BOT_TOKEN"';
  return trimmed;
}

function cicadaStatementIndent(statement, scope) {
  if (/^(?:бот\s+|версия\s+|при\s+|команда\s+|сценарий\s+)/i.test(statement)) {
    return 0;
  }
  if (/^шаг\s+/i.test(statement)) return scope === 'scenario' || scope === 'step' ? 1 : 0;
  if (scope === 'step') return 2;
  if (scope === 'handler' || scope === 'scenario') return 1;
  return 0;
}

function nextCicadaScope(statement, scope) {
  if (/^сценарий\s+/i.test(statement)) return 'scenario';
  if (/^(?:при\s+|команда\s+)/i.test(statement)) return 'handler';
  if (/^шаг\s+/i.test(statement)) return 'step';
  if (/^(?:бот\s+|версия\s+)/i.test(statement)) return 'root';
  return scope;
}

/**
 * Repairs common LLM-converted Cicada DSL where newlines were collapsed into one line.
 * Example: `бот ""при старте:    ответ "..."    стоп`.
 * @param {string} code
 * @returns {string}
 */
export function repairCollapsedCicadaCode(code) {
  const src = stripMergeConflictMarkers(code)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
  if (!src) return src;

  const hasCollapsedSignals =
    /бот\s*""\s*при\s+/i.test(src) ||
    /стоп\s*при\s+/i.test(src) ||
    /запустить\s+\S+\s*при\s+/i.test(src) ||
    /:\s{2,}\S/.test(src) ||
    (src.split('\n').length <= 2 && findCollapsedCicadaStatementStarts(src).length > 2);

  if (!hasCollapsedSignals) {
    return src
      .split('\n')
      .map((line) => normalizeCicadaBotLine(line))
      .join('\n');
  }

  const statements = splitCollapsedCicadaStatements(src);
  if (!statements) return normalizeCicadaBotLine(src);

  let scope = 'root';
  const lines = statements.map((raw) => {
    const statement = normalizeCicadaBotLine(raw);
    const indent = cicadaStatementIndent(statement, scope);
    scope = nextCicadaScope(statement, scope);
    return `${'    '.repeat(indent)}${statement}`;
  });
  return lines.join('\n');
}

/** «Стоп» сразу после «запустить …» в том же обработчике ломает FSM ядра Cicada (EndScenario попадает в общую очередь с отложенными шагами «спросить»). */
const STOP_AFTER_RUN_FIX_MSG =
  'Удалён «стоп» после «запустить»: в одном обработчике так нельзя — завершится сценарий до шагов «спросить». Добавляйте «стоп» только внутри сценария или после полного прохождения цепочки.';

/**
 * Убирает строку `стоп`, если она идёт сразу после `запустить имя_сценария` с тем же отступом.
 * @param {string[]} lines
 * @returns {{ lines: string[], fixes: Array<{ line: number, message: string, before: string, after: string }> }}
 */
export function stripStopAfterRunScenario(lines) {
  const fixes = [];
  const removeIdx = new Set();
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (removeIdx.has(i)) continue;
    const line = lines[i];
    const nxt = lines[i + 1];
    const trimmed = line.trim();
    const nt = nxt.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (nt !== 'стоп') continue;
    if (!/^запустить\s+\S+\s*$/.test(trimmed)) continue;
    const ia = line.match(/^\s*/)?.[0] ?? '';
    const ib = nxt.match(/^\s*/)?.[0] ?? '';
    if (ia !== ib) continue;

    removeIdx.add(i + 1);
    fixes.push({
      line: i + 2,
      message: STOP_AFTER_RUN_FIX_MSG,
      before: nxt,
      after: '',
    });
  }
  const out = lines.filter((_, idx) => !removeIdx.has(idx));
  return { lines: out, fixes };
}

/**
 * Нормализует JSON-стеки от AI до generateDSL/парсера.
 * @param {Array} stacks
 * @returns {Array}
 */
export function normalizeAiGeneratedStacks(stacks) {
  if (!Array.isArray(stacks)) return stacks;
  const { scenarioNameMap, stepNameMap, varNameMap } = buildAiNameMaps(stacks);

  return stacks.map((stack) => ({
    ...stack,
    blocks: (stack?.blocks || []).map((block) => {
      const props = block?.props || {};
      let nextProps = props;
      const setProp = (key, value) => {
        if (nextProps === props) nextProps = { ...props };
        nextProps[key] = value;
      };

      if (block?.type === 'buttons' && typeof props.rows === 'string') {
        const rows = normalizeReplyKeyboardRowsProp(props.rows);
        if (rows !== props.rows) setProp('rows', rows);
      }

      for (const key of AI_QUOTED_STRING_PROP_KEYS) {
        if (typeof nextProps[key] !== 'string') continue;
        const fixed = normalizeCicadaQuotedString(nextProps[key]);
        if (fixed !== nextProps[key]) setProp(key, fixed);
      }

      if (block?.type === 'command' && typeof nextProps.cmd === 'string') {
        const fixed = nextProps.cmd.replace(/^\/+/, '').trim().split(/\s+/)[0] || 'start';
        if (fixed !== nextProps.cmd) setProp('cmd', fixed);
      }

      if (
        (block?.type === 'scenario' || block?.type === 'run') &&
        typeof nextProps.name === 'string'
      ) {
        const fixed =
          scenarioNameMap.get(nextProps.name) ||
          normalizeCicadaIdentifier(nextProps.name, 'scenario');
        if (fixed !== nextProps.name) setProp('name', fixed);
      }

      if (block?.type === 'step' && typeof nextProps.name === 'string') {
        const fixed =
          stepNameMap.get(nextProps.name) ||
          normalizeCicadaIdentifier(nextProps.name, 'step');
        if (fixed !== nextProps.name) setProp('name', fixed);
      }

      if (block?.type === 'goto') {
        const raw = typeof nextProps.label === 'string' ? nextProps.label : nextProps.target;
        if (typeof raw === 'string') {
          const fixed = stepNameMap.get(raw) || normalizeCicadaIdentifier(raw, 'step');
          if (fixed !== nextProps.label) setProp('label', fixed);
          if (nextProps.target != null && fixed !== nextProps.target) setProp('target', fixed);
        }
      }

      if (typeof nextProps.varname === 'string') {
        const fixed =
          varNameMap.get(nextProps.varname) ||
          normalizeCicadaIdentifier(nextProps.varname, 'var');
        if (fixed !== nextProps.varname) setProp('varname', fixed);
      }

      for (const key of AI_TEMPLATE_PROP_KEYS) {
        if (typeof nextProps[key] !== 'string') continue;
        let fixed = replaceTemplateVarRefs(nextProps[key], varNameMap);
        fixed = repairTemplatePlaceholders(fixed);
        if (fixed !== nextProps[key]) setProp(key, fixed);
      }

      return nextProps === props ? block : { ...block, props: nextProps };
    }),
  }));
}


/**
 * Строка DSL: кнопки "A|B|C" (одна кавычка) → кнопки "A" "B" "C"
 * @param {string} line
 * @returns {{ line: string, changed: boolean }}
 */
export function fixReplyKeyboardDSLQuotedPipesOnLine(line) {
  if (!line.includes('|') || !line.includes('кнопки')) return { line, changed: false };
  const trimmed = line.trim();
  if (trimmed.startsWith('#')) return { line, changed: false };
  if (/inline-кнопки/.test(line)) return { line, changed: false };

  const m = trimmed.match(/^кнопки(\s+)(.+)$/);
  if (!m) return { line, changed: false };
  const ws = m[1];
  const rest = m[2].trim();

  const quoted = [];
  const re = /"([^"]*)"/g;
  let mm;
  while ((mm = re.exec(rest)) !== null) quoted.push(mm[1]);

  if (quoted.length !== 1 || !quoted[0].includes('|')) return { line, changed: false };
  const parts = quoted[0]
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return { line, changed: false };

  const rebuilt = parts.map((p) => `"${p}"`).join(' ');
  const indent = line.match(/^\s*/)?.[0] ?? '';
  return { line: `${indent}кнопки${ws}${rebuilt}`, changed: true };
}

/**
 * Заменяет ASCII -> на → там, где это похоже на DSL-стрелку (не внутри URL).
 * @param {string} line
 * @returns {{ line: string, changed: boolean }}
 */
export function fixArrowOnLine(line) {
  if (!line.includes('->')) return { line, changed: false };
  const trimmed = line.trim();
  if (trimmed.startsWith('#')) return { line, changed: false };
  // не трогаем очевидные URL
  if (/https?:\/\//i.test(line)) return { line, changed: false };

  const DSL_ARROW_HINT =
    /(?:получить|спросить|все_ключи|вызвать|http_get|http_post|http_patch|http_put|http_delete|проверить\s+подписку|роль\s+@)/;
  const looksLikeArrow =
    DSL_ARROW_HINT.test(trimmed) ||
    /"\s*->\s*[а-яёa-zA-Z_]/.test(line) ||
    /\]\s*->\s*[а-яёa-zA-Z_]/.test(line);

  if (!looksLikeArrow) return { line, changed: false };

  let out = line;
  // "ключ" -> var  или  ... -> var в конце
  out = out.replace(/"\s*->\s*/g, '" → ');
  out = out.replace(/\s->\s/g, ' → ');
  out = out.replace(/->\s*/g, '→ ');
  // двойная стрелка если уже было →
  out = out.replace(/→\s*→/g, '→');
  return { line: out, changed: out !== line };
}

/**
 * Собирает исправления построчно.
 * @param {string} code
 * @returns {{ fixes: Array<{ line: number, message: string, before: string, after: string }>, correctedCode: string, changedLines: number[] }}
 */
export function collectDSLFixes(code) {
  let lines = code.split('\n');
  const zap = stripStopAfterRunScenario(lines);
  lines = zap.lines;
  const fixes = [...zap.fixes];
  const changedLines = zap.fixes.map((f) => f.line - 1).filter((n) => n >= 0);
  const newLines = lines.map((line, i) => {
    const pipeFix = fixReplyKeyboardDSLQuotedPipesOnLine(line);
    let current = pipeFix.line;
    if (pipeFix.changed) {
      fixes.push({
        line: i + 1,
        message: REPLY_KNOPKI_PIPE_FIX,
        before: line,
        after: current,
      });
      if (!changedLines.includes(i)) changedLines.push(i);
    }
    const { line: fixed, changed } = fixArrowOnLine(current);
    if (changed) {
      fixes.push({
        line: i + 1,
        message: ARROW_FIX_DESC,
        before: current,
        after: fixed,
      });
      if (!pipeFix.changed && !changedLines.includes(i)) changedLines.push(i);
    }
    return fixed;
  });
  return {
    fixes,
    correctedCode: newLines.join('\n'),
    changedLines,
  };
}

/**
 * Применяет все собранные исправления (эквивалентно пересборке из collectDSLFixes).
 */
export function applyAllDSLFixes(code) {
  return collectDSLFixes(code);
}
