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
  return stacks.map((stack) => ({
    ...stack,
    blocks: (stack?.blocks || []).map((block) => {
      const props = block?.props || {};
      let nextProps = props;

      if (block?.type === 'buttons' && typeof props.rows === 'string') {
        nextProps = {
          ...nextProps,
          rows: normalizeReplyKeyboardRowsProp(props.rows),
        };
      }

      for (const key of AI_TEMPLATE_PROP_KEYS) {
        if (typeof nextProps[key] !== 'string') continue;
        const fixed = repairTemplatePlaceholders(nextProps[key]);
        if (fixed !== nextProps[key]) {
          if (nextProps === props) nextProps = { ...props };
          nextProps[key] = fixed;
        }
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
