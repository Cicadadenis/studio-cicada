/**
 * Линтер и автоисправления для текста .ccd (DSL Cicada).
 * Используется панелью «проверить»: предложения правок + подсветка строк.
 */

/** Стрелка назначения в DSL — только Unicode → поддерживается парсером ядра целиком */
const ARROW_FIX_DESC =
  'Стрелка назначения: в Cicada нужен символ → (U+2192), а не ASCII ->';

const REPLY_KNOPKI_PIPE_FIX =
  'Reply-кнопки: в поле кнопок и в DSL одна строка — через запятую; символ | здесь не разделитель.';

const BARE_FORWARD_FIX =
  'Пересылка сообщения: добавлен получатель ADMIN_ID, потому что строка «переслать» без адресата не поддерживается ядром.';

const FORWARD_MESSAGE_PREFIX_FIX =
  'Пересылка сообщения: добавлено слово «сообщение» для совместимости с ядром Cicada.';

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



/** Убирает служебные размышления LLM, чтобы JSON-извлечение не цеплялось за массивы внутри reasoning. */
export function stripThinkingFromAiRaw(raw) {
  const reThink = /\u003c\u0074\u0068\u0069\u006E\u006B\u003e[\s\S]*?\u003c\/\u0074\u0068\u0069\u006E\u006B\u003e/gi;
  const reThinkBr = /\u003c\u005B\u0074\u0068\u0069\u006E\u006B\u005D\u003e[\s\S]*?\u003c\/\u005B\u0074\u0068\u0069\u006E\u006B\u005D\u003e/gi;
  return String(raw || '')
    .replace(reThink, '')
    .replace(reThinkBr, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\[think\]>[\s\S]*?<\/\[think\]>/gi, '')
    .replace(/<redacted_reasoning>[\s\S]*?<\/redacted_reasoning>/gi, '')
    .trim();
}

function stripJsonCommentsPreservingStrings(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = inString;
      continue;
    }
    if (ch === '"') {
      out += ch;
      inString = !inString;
      continue;
    }
    if (!inString && ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (!inString && ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

function stripJsonTrailingCommas(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = inString;
      continue;
    }
    if (ch === '"') {
      out += ch;
      inString = !inString;
      continue;
    }
    if (!inString && ch === ',') {
      let j = i + 1;
      while (/\s/.test(text[j] || '')) j += 1;
      if (text[j] === ']' || text[j] === '}') continue;
    }
    out += ch;
  }
  return out;
}

function parseJsonMaybeLenient(text) {
  const source = String(text ?? '').trim().replace(/^\uFEFF/, '');
  if (!source) return null;
  const variants = [source];
  const noComments = stripJsonCommentsPreservingStrings(source);
  variants.push(noComments, stripJsonTrailingCommas(noComments));
  for (const candidate of variants) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try next normalization variant.
    }
  }
  return null;
}

function normalizeFencedJsonText(raw) {
  return String(raw ?? '')
    .replace(/```(?:json|javascript|js)?\s*/gi, '')
    .replace(/```/g, '')
    .trim();
}

function findBalancedJsonCandidates(text) {
  const src = String(text ?? '');
  const candidates = [];
  for (let start = 0; start < src.length; start += 1) {
    const opener = src[start];
    if (opener !== '[' && opener !== '{') continue;
    const closer = opener === '[' ? ']' : '}';
    let squareDepth = 0;
    let curlyDepth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < src.length; i += 1) {
      const ch = src[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = inString;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '[') squareDepth += 1;
      if (ch === ']') squareDepth -= 1;
      if (ch === '{') curlyDepth += 1;
      if (ch === '}') curlyDepth -= 1;
      if (squareDepth < 0 || curlyDepth < 0) break;
      if (ch === closer && squareDepth === 0 && curlyDepth === 0) {
        candidates.push(src.slice(start, i + 1));
        break;
      }
    }
  }
  return candidates;
}

function unwrapAiStacksPayload(value) {
  if (typeof value === 'string') {
    return unwrapAiStacksPayload(parseJsonMaybeLenient(value));
  }
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value.stacks)) return value.stacks;
  if (Array.isArray(value.schema)) return value.schema;
  if (Array.isArray(value.flow)) return value.flow;
  if (value.result) return unwrapAiStacksPayload(value.result);
  if (value.data) return unwrapAiStacksPayload(value.data);
  return null;
}

function looksLikeAiStackArray(value) {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.some((item) => item && typeof item === 'object' && Array.isArray(item.blocks));
}

/**
 * Extracts editor stacks from messy LLM output. Handles prose around JSON,
 * fenced blocks, object wrappers like {"stacks":[...]}, comments and trailing commas.
 * @param {string} raw
 * @returns {{ stacks: Array, jsonText: string } | null}
 */
export function extractAiGeneratedStacksFromRaw(raw) {
  const cleaned = normalizeFencedJsonText(stripThinkingFromAiRaw(raw));
  const direct = unwrapAiStacksPayload(parseJsonMaybeLenient(cleaned));
  if (looksLikeAiStackArray(direct)) return { stacks: direct, jsonText: cleaned };

  for (const candidate of findBalancedJsonCandidates(cleaned)) {
    const stacks = unwrapAiStacksPayload(parseJsonMaybeLenient(candidate));
    if (looksLikeAiStackArray(stacks)) return { stacks, jsonText: candidate };
  }
  return null;
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
      if (MERGE_CONFLICT_MARKERS.some((marker) => trimmed.startsWith(marker))) return null;
      const markerAt = findUnquotedMergeConflictMarker(line);
      return markerAt === -1 ? line : line.slice(0, markerAt).trimEnd();
    })
    .filter((line) => line !== null)
    .join('\n');
}


function parseUnsupportedBlockCommentPayload(raw) {
  const text = String(raw || '').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function emitSupportedDslForBlockComment(type, props) {
  const p = props || {};
  if (type === 'run') {
    const name = firstString(p.name, p.scenario, p.target, p.label);
    return name ? `запустить ${normalizeCicadaIdentifier(name, 'scenario')}` : null;
  }
  if (type === 'use') {
    const blockname = firstString(p.blockname, p.name, p.target, p.label);
    return blockname ? `использовать ${normalizeCicadaIdentifier(blockname, 'block')}` : null;
  }
  return null;
}

function repairUnsupportedDslBlockComments(text) {
  return String(text || '').replace(
    /#\s*блок\s+([A-Za-zА-Яа-яЁё0-9_\-]+)\s*:\s*(\{[^\n]*?\})/g,
    (match, rawType, rawProps) => {
      const type = normalizeAiBlockType(rawType);
      const replacement = emitSupportedDslForBlockComment(
        type,
        parseUnsupportedBlockCommentPayload(rawProps),
      );
      return replacement || match;
    },
  );
}

const COLLAPSED_CICADA_STARTERS = [
  'inline из бд ', 'inline-кнопки из бд ', 'inline-кнопки:', 'при геолокации:', 'при документе:', 'при голосовом:',
  'при контакте:', 'при стикере:', 'при старте:', 'при фото:',
  'при нажатии ', 'при команде ', 'сценарий ', 'сохранить_глобально ',
  'проверить подписку ', 'переслать сообщение ', 'переслать ', 'запустить ', 'спросить ',
  'получить ', 'сохранить ', 'ответ_markdown_v2 ', 'ответ_html ', 'ответ_md2 ', 'ответ_md ', 'кнопки:', 'кнопки ', 'команда ',
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
  const src = repairUnsupportedDslBlockComments(stripMergeConflictMarkers(code))
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



const AI_BLOCK_TYPE_ALIASES = new Map([
  ['send_message', 'message'], ['reply', 'message'], ['text', 'message'], ['answer', 'message'],
  ['keyboard', 'buttons'], ['reply_keyboard', 'buttons'], ['button', 'buttons'],
  ['inline_keyboard', 'inline'], ['inline_buttons', 'inline'],
  ['inline_from_db', 'inline_db'], ['inline_db_buttons', 'inline_db'], ['database_inline', 'inline_db'],
  ['question', 'ask'], ['input', 'ask'], ['set', 'remember'], ['variable', 'remember'],
  ['store', 'save'], ['persist', 'save'], ['save_value', 'save'], ['save_global_value', 'save_global'],
  ['if', 'condition'], ['elseif', 'condition'], ['end', 'stop'], ['finish', 'stop'],
  ['on_start', 'start'], ['on_command', 'command'], ['on_callback', 'callback'],
  ['on_document', 'document_received'],
  ['on_photo', 'photo_received'],
  ['on_voice', 'voice_received'],
  ['on_sticker', 'sticker_received'],
  ['on_location', 'location_received'],
  ['on_contact', 'contact_received'],
  ['call', 'run'], ['scenario_call', 'run'], ['transition', 'goto'], ['delay', 'pause'],
]);

function normalizeAiBlockType(type) {
  const raw = String(type ?? '').trim();
  const key = raw.toLowerCase().replace(/[\s-]+/g, '_');
  return AI_BLOCK_TYPE_ALIASES.get(key) || raw;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function normalizeAiBlockProps(type, props) {
  const p = props && typeof props === 'object' && !Array.isArray(props) ? { ...props } : {};
  if (type === 'message') p.text = firstString(p.text, p.message, p.content, p.reply, p.answer) ?? p.text;
  if (type === 'buttons') {
    if (Array.isArray(p.rows)) p.rows = p.rows.map((row) => Array.isArray(row) ? row.join(', ') : String(row)).join('\n');
    p.rows = firstString(p.rows, p.labels, p.buttons, p.keyboard, p.text) ?? p.rows;
  }
  if (type === 'inline') {
    if (Array.isArray(p.buttons)) p.buttons = p.buttons.map((row) => Array.isArray(row) ? row.join(', ') : String(row)).join('\n');
    p.buttons = firstString(p.buttons, p.rows, p.inline, p.keyboard) ?? p.buttons;
  }
  if (type === 'inline_db') {
    p.key = firstString(p.key, p.source, p.collection, p.list, p.from) ?? p.key;
    p.labelField = firstString(p.labelField, p.label_field, p.textField, p.text_field) ?? p.labelField;
    p.idField = firstString(p.idField, p.id_field, p.valueField, p.value_field) ?? p.idField;
    p.callbackPrefix = firstString(p.callbackPrefix, p.callback_prefix, p.prefix) ?? p.callbackPrefix;
    p.backText = firstString(p.backText, p.back_text) ?? p.backText;
    p.backCallback = firstString(p.backCallback, p.back_callback) ?? p.backCallback;
    p.columns = firstString(p.columns, p.cols) ?? p.columns;
  }
  if (type === 'ask') {
    p.question = firstString(p.question, p.text, p.message, p.prompt) ?? p.question;
    p.varname = firstString(p.varname, p.variable, p.var, p.name, p.save_to) ?? p.varname;
  }
  if (type === 'callback') p.label = firstString(p.label, p.text, p.button, p.data) ?? p.label;
  if (type === 'command') p.cmd = firstString(p.cmd, p.command, p.name) ?? p.cmd;
  if (type === 'run' || type === 'scenario') p.name = firstString(p.name, p.scenario, p.label, p.target) ?? p.name;
  if (type === 'goto') p.label = firstString(p.label, p.target, p.step, p.name) ?? p.label;
  if (type === 'condition') p.cond = firstString(p.cond, p.condition, p.expr, p.expression, p.if) ?? p.cond;
  if (type === 'log') p.message = firstString(p.message, p.text, p.event, p.content) ?? p.message;
  if (type === 'remember') {
    p.varname = firstString(p.varname, p.variable, p.var, p.name) ?? p.varname;
    if (p.value == null && p.text != null) p.value = p.text;
  }
  if (type === 'save' || type === 'save_global') {
    p.key = firstString(p.key, p.name, p.field) ?? p.key;
    if (p.value == null && p.text != null) p.value = p.text;
  }
  return p;
}

function removeStopImmediatelyAfterRun(blocks) {
  const out = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const current = blocks[i];
    const prev = out[out.length - 1];
    if (current?.type === 'stop' && prev?.type === 'run') continue;
    out.push(current);
  }
  return out;
}

function ensureAiBotStack(stacks) {
  if (!Array.isArray(stacks) || stacks.length === 0) return stacks;
  const hasBot = stacks.some((stack) => (stack?.blocks || []).some((block) => block?.type === 'bot'));
  if (hasBot) return stacks;
  return [
    { id: 's0', x: 40, y: 40, blocks: [{ id: 'b0', type: 'bot', props: { token: 'YOUR_BOT_TOKEN' } }] },
    ...stacks,
  ];
}


const AI_HANDLER_ROOT_TYPES = new Set(['start', 'callback', 'command']);
const AI_VISIBLE_OUTPUT_TYPES = new Set([
  'message', 'buttons', 'inline', 'inline_db', 'photo', 'video', 'audio', 'document',
  'contact', 'location', 'poll', 'sticker', 'random',
]);

function stackHasMultipleLinearAsks(stack) {
  const blocks = stack?.blocks || [];
  const rootType = blocks[0]?.type;
  if (!AI_HANDLER_ROOT_TYPES.has(rootType)) return false;
  if (blocks.some((b) => b?.type === 'scenario' || b?.type === 'step' || b?.type === 'run')) return false;
  return blocks.filter((b) => b?.type === 'ask').length >= 2;
}

function hasVisibleAiOutput(blocks) {
  return (blocks || []).some((b) => AI_VISIBLE_OUTPUT_TYPES.has(b?.type));
}

function ensureVisibleTailAfterFinalAsk(tail, stackId) {
  const out = [...(tail || [])];
  if (hasVisibleAiOutput(out)) return out;

  const completion = {
    id: `${stackId}_auto_done_msg`,
    type: 'message',
    props: { text: 'Спасибо! Данные сохранены.' },
  };
  const firstStop = out.findIndex((b) => b?.type === 'stop');
  if (firstStop >= 0) out.splice(firstStop, 0, completion);
  else out.push(completion, { id: `${stackId}_auto_done_stop`, type: 'stop', props: {} });
  return out;
}

function scenarioNameForLinearAskStack(stack, index) {
  const root = stack?.blocks?.[0];
  const raw = root?.props?.label || root?.props?.cmd || root?.type || `форма_${index}`;
  return normalizeCicadaIdentifier(`${raw}_форма`, `форма_${index}`);
}

function convertLinearAskStackToScenario(stack, index) {
  const blocks = stack?.blocks || [];
  const firstAskIndex = blocks.findIndex((b) => b?.type === 'ask');
  if (firstAskIndex <= 0) return [stack];

  const scenarioName = scenarioNameForLinearAskStack(stack, index);
  const rootBlocks = [
    ...blocks.slice(0, firstAskIndex),
    { id: `${stack.id}_auto_run`, type: 'run', props: { name: scenarioName } },
  ];

  const askIndexes = [];
  blocks.forEach((block, blockIdx) => {
    if (block?.type === 'ask') askIndexes.push(blockIdx);
  });

  const scenarioBlocks = [
    { id: `${stack.id}_auto_scenario`, type: 'scenario', props: { name: scenarioName } },
  ];

  askIndexes.forEach((askIndex, askOrdinal) => {
    const askBlock = blocks[askIndex];
    const isLastAsk = askOrdinal === askIndexes.length - 1;
    const nextAskIndex = askIndexes[askOrdinal + 1];
    const between = blocks.slice(askIndex + 1, isLastAsk ? blocks.length : nextAskIndex);
    const stepName = normalizeCicadaIdentifier(
      askBlock?.props?.varname || `шаг_${askOrdinal + 1}`,
      `шаг_${askOrdinal + 1}`,
    );

    scenarioBlocks.push({
      id: `${askBlock.id || stack.id}_auto_step_${askOrdinal + 1}`,
      type: 'step',
      props: { name: stepName },
    });
    scenarioBlocks.push(askBlock);
    scenarioBlocks.push(...(isLastAsk ? ensureVisibleTailAfterFinalAsk(between, stack.id) : between));
  });

  return [
    { ...stack, blocks: rootBlocks },
    {
      id: `${stack.id}_auto_scenario_stack`,
      x: Number.isFinite(Number(stack.x)) ? Number(stack.x) + 360 : 40 + ((index + 1) % 5) * 360,
      y: Number.isFinite(Number(stack.y)) ? Number(stack.y) + 320 : 360 + Math.floor((index + 1) / 5) * 320,
      blocks: scenarioBlocks,
    },
  ];
}

function convertLinearAskStacksToScenarios(stacks) {
  const out = [];
  for (let i = 0; i < (stacks || []).length; i += 1) {
    const stack = stacks[i];
    if (stackHasMultipleLinearAsks(stack)) out.push(...convertLinearAskStackToScenario(stack, i));
    else out.push(stack);
  }
  return out;
}
/**
 * Нормализует JSON-стеки от AI до generateDSL/парсера.
 * @param {Array} stacks
 * @returns {Array}
 */
export function normalizeAiGeneratedStacks(stacks) {
  if (!Array.isArray(stacks)) return stacks;
  const shapedStacks = convertLinearAskStacksToScenarios(ensureAiBotStack(stacks).map((stack, stackIdx) => {
    const blocks = (stack?.blocks || []).map((block, blockIdx) => {
      const type = normalizeAiBlockType(block?.type);
      return {
        ...block,
        id: block?.id || `b${stackIdx}_${blockIdx}`,
        type,
        props: normalizeAiBlockProps(type, block?.props),
      };
    });
    return {
      ...stack,
      id: stack?.id || `s${stackIdx}`,
      x: Number.isFinite(Number(stack?.x)) ? Number(stack.x) : 40 + (stackIdx % 5) * 360,
      y: Number.isFinite(Number(stack?.y)) ? Number(stack.y) : 40 + Math.floor(stackIdx / 5) * 320,
      blocks: removeStopImmediatelyAfterRun(blocks),
    };
  }));
  const { scenarioNameMap, stepNameMap, varNameMap } = buildAiNameMaps(shapedStacks);

  return shapedStacks.map((stack) => ({
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
 * Исправляет голую инструкцию `переслать`, которую старый UI мог сгенерировать
 * при пустом поле получателя.
 * @param {string} line
 * @returns {{ line: string, changed: boolean }}
 */
export function fixBareForwardOnLine(line) {
  if (!/^\s*переслать\s*$/i.test(line)) return { line, changed: false };
  const indent = line.match(/^\s*/)?.[0] ?? '';
  return { line: `${indent}переслать сообщение ADMIN_ID`, changed: true };
}

/**
 * Старые версии ядра принимают только `переслать сообщение USER_ID`.
 * Короткий формат `переслать USER_ID` оставляем парсеру, но автофикс
 * приводит его к максимально совместимому виду.
 * @param {string} line
 * @returns {{ line: string, changed: boolean }}
 */
export function fixForwardMessagePrefixOnLine(line) {
  const m = line.match(/^(\s*)переслать\s+(?!(?:сообщение|текст|фото|документ|голосовое|аудио|стикер)(?:\s|$))(.+?)\s*$/i);
  if (!m) return { line, changed: false };
  return { line: `${m[1]}переслать сообщение ${m[2].trim()}`, changed: true };
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
    const bareForwardFix = fixBareForwardOnLine(fixed);
    if (bareForwardFix.changed) {
      fixes.push({
        line: i + 1,
        message: BARE_FORWARD_FIX,
        before: fixed,
        after: bareForwardFix.line,
      });
      if (!changedLines.includes(i)) changedLines.push(i);
    }
    const forwardPrefixFix = fixForwardMessagePrefixOnLine(bareForwardFix.line);
    if (forwardPrefixFix.changed) {
      fixes.push({
        line: i + 1,
        message: FORWARD_MESSAGE_PREFIX_FIX,
        before: bareForwardFix.line,
        after: forwardPrefixFix.line,
      });
      if (!changedLines.includes(i)) changedLines.push(i);
    }
    return forwardPrefixFix.line;
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
