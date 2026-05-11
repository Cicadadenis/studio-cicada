const ROOT_KEYWORDS = ['версия', 'бот', 'команды:', 'глобально', 'блок', 'до каждого:', 'после каждого:', 'при старте:', 'старт:', 'при команде', 'команда', 'при нажатии', 'при фото:', 'при документе:', 'при геолокации:', 'сценарий'];

export const FLOW_PORTS = {
  version:     { input: null,           output: null           },
  bot:         { input: null,           output: null           },
  commands:    { input: null,           output: null           },
  global:      { input: null,           output: null           },
  block:       { input: null,           output: 'flow'         },
  middleware:  { input: null,           output: 'flow'         },
  start:       { input: 'flow',         output: 'flow'         },
  command:     { input: null,           output: 'flow'         },
  on_location: { input: null,           output: 'flow'         },
  callback:    { input: null,           output: 'flow'         },
  else:        { input: 'flow',         output: 'flow'         },
  scenario:    { input: null,           output: 'scenario_flow'},
  step:        { input: 'scenario_flow',output: 'scenario_flow'},
  message:     { input: 'flow',         output: 'flow'         },
  buttons:     { input: 'flow',         output: 'flow'         },
  inline:      { input: 'flow',         output: 'flow'         },
  inline_db:   { input: 'flow',         output: 'flow'         },
  use:         { input: 'flow',         output: 'flow'         },
  condition:   { input: 'flow',         output: 'flow'         },
  ask:         { input: 'flow',         output: 'flow'         },
  remember:    { input: 'flow',         output: 'flow'         },
  get:         { input: 'flow',         output: 'flow'         },
  save:        { input: 'flow',         output: 'flow'         },
  delay:       { input: 'flow',         output: 'flow'         },
  typing:      { input: 'flow',         output: 'flow'         },
  log:         { input: 'flow',         output: 'flow'         },
  goto:        { input: 'flow',         output: null           },
  stop:        { input: 'flow',         output: null           },
  poll:        { input: 'flow',         output: 'flow'         },
  photo:       { input: 'flow',         output: 'flow'         },
  video:       { input: 'flow',         output: 'flow'         },
  audio:       { input: 'flow',         output: 'flow'         },
  document:    { input: 'flow',         output: 'flow'         },
  send_file:   { input: 'flow',         output: 'flow'         },
  random:      { input: 'flow',         output: 'flow'         },
  // ── Новые типы ядра ─────────────────────────────────────────────────────
  loop:        { input: 'flow',         output: 'flow'         },
  http:        { input: 'flow',         output: 'flow'         },
  notify:      { input: 'flow',         output: 'flow'         },
  broadcast:   { input: 'flow',         output: 'flow'         },
  check_sub:   { input: 'flow',         output: 'flow'         },
  member_role: { input: 'flow',         output: 'flow'         },
  forward_msg: { input: 'flow',         output: 'flow'         },
  database:    { input: 'flow',         output: 'flow'         },
  payment:     { input: 'flow',         output: 'flow'         },
  analytics:   { input: 'flow',         output: 'flow'         },
  classify:    { input: 'flow',         output: 'flow'         },
  sticker:     { input: 'flow',         output: 'flow'         },
  db_delete:   { input: 'flow',         output: 'flow'         },
  save_global: { input: 'flow',         output: 'flow'         },
  get_user:    { input: 'flow',         output: 'flow'         },
  all_keys:    { input: 'flow',         output: 'flow'         },
  call_block:  { input: 'flow',         output: 'flow'         },
};

/** Запятые вне кавычек и при глубине [] = 0 (совместимо с cicada parser.py). */
export function splitTopLevelListItems(itemsStr) {
  const s = String(itemsStr).trim();
  if (!s) return [];
  const parts = [];
  let buf = '';
  let depth = 0;
  let inQuote = false;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === '"') {
      inQuote = !inQuote;
      buf += c;
    } else if (inQuote) {
      buf += c;
    } else if (c === '[') {
      depth += 1;
      buf += c;
    } else if (c === ']') {
      depth -= 1;
      buf += c;
    } else if (c === ',' && depth === 0) {
      const t = buf.trim();
      if (t) parts.push(t);
      buf = '';
    } else {
      buf += c;
    }
  }
  const tail = buf.trim();
  if (tail) parts.push(tail);
  return parts;
}

function indentLevel(line) {
  const match = line.match(/^[\t ]*/);
  const spaces = (match?.[0] || '').replace(/\t/g, '    ').length;
  return Math.floor(spaces / 4);
}

function stripQuotes(value = '') {
  return value.trim().replace(/^"/, '').replace(/"$/, '');
}

function parseNode(line) {
  const t = line.trim();
  if (!t) return null;

  // ── Настройки и корневые блоки ──────────────────────────────────────────
  if (t.startsWith('версия ')) return { type: 'version', props: { version: stripQuotes(t.replace('версия', '').trim()) }, root: true };
  if (t.startsWith('бот ')) return { type: 'bot', props: { token: stripQuotes(t.replace('бот', '').trim()) }, root: true };
  if (t.startsWith('глобально ')) {
    const [varname, ...rest] = t.replace('глобально', '').trim().split('=');
    return { type: 'global', props: { varname: (varname || '').trim(), value: (rest.join('=') || '').trim() }, root: true };
  }
  if (t.startsWith('блок ') && t.endsWith(':')) return { type: 'block', props: { name: t.replace('блок', '').replace(':', '').trim() }, root: true };
  if (t === 'до каждого:') return { type: 'middleware', props: { type: 'before', code: '' }, root: true };
  if (t === 'после каждого:') return { type: 'middleware', props: { type: 'after', code: '' }, root: true };
  if (t === 'при геолокации:' || t === 'при геолокации' || t === 'при локации:' || t === 'при локации') return { type: 'on_location', props: {}, root: true };
  if (t === 'при старте:' || t === 'при старте' || t === 'старт:' || t === 'старт') return { type: 'start', props: {}, root: true };
  if ((t.startsWith('при команде ') || t.startsWith('команда ')) && t.endsWith(':')) return { type: 'command', props: { cmd: stripQuotes(t.match(/"([^"]+)"/)?.[1] || '').replace(/^\//, '') }, root: true };
  if (t.startsWith('при нажатии ') && t.endsWith(':')) return { type: 'callback', props: { label: stripQuotes(t.match(/"([^"]+)"/)?.[1] || '') }, root: true };
  if (t.startsWith('сценарий ') && t.endsWith(':')) return { type: 'scenario', props: { name: t.replace('сценарий', '').replace(':', '').trim(), text: 'Начинаем!' }, root: true };
  if (t.startsWith('шаг ') && t.endsWith(':')) return { type: 'step', props: { name: t.replace('шаг', '').replace(':', '').trim(), text: '...' }, root: false };
  if (t === 'иначе:' || t === 'иначе') return { type: 'else', props: {}, root: false };

  // ── Медиа-обработчики (root) ────────────────────────────────────────────
  if (t === 'при фото:') return { type: 'on_photo', props: {}, root: true };
  if (t === 'при документе:') return { type: 'on_document', props: {}, root: true };
  if (t === 'при голосовом:') return { type: 'on_voice', props: {}, root: true };
  if (t === 'при стикере:') return { type: 'on_sticker', props: {}, root: true };
  if (t === 'при контакте:') return { type: 'on_contact', props: {}, root: true };

  // ── Циклы ───────────────────────────────────────────────────────────────
  {
    const feMatch = t.match(/^для каждого (\S+) в (.+?):$/);
    if (feMatch) return { type: 'loop', props: { mode: 'foreach', var: feMatch[1], collection: feMatch[2].trim() }, root: false };
  }
  {
    const whileMatch = t.match(/^пока (.+?):$/);
    if (whileMatch) return { type: 'loop', props: { mode: 'while', cond: whileMatch[1].trim() }, root: false };
  }
  {
    const repMatch = t.match(/^повторять (\S+) раз:?$/);
    if (repMatch) return { type: 'loop', props: { mode: 'count', count: repMatch[1] }, root: false };
  }
  {
    const tmMatch = t.match(/^таймаут (\S+) секунд[ыа]?:$/);
    if (tmMatch) return { type: 'loop', props: { mode: 'timeout', seconds: tmMatch[1] }, root: false };
  }

  // ── Управление потоком ──────────────────────────────────────────────────
  if (t === 'прервать') return { type: 'stop', props: { reason: 'break' }, root: false };
  if (t === 'продолжить') return { type: 'stop', props: { reason: 'continue' }, root: false };
  {
    const retMatch = t.match(/^вернуть\s+(.+)$/);
    if (retMatch) return { type: 'stop', props: { reason: 'return', value: retMatch[1].trim() }, root: false };
  }
  if (t.startsWith('завершить сценарий')) return { type: 'stop', props: { reason: 'scenario' }, root: false };
  if (t.startsWith('завершить') || t === 'вернуть' || t === 'стоп') return { type: 'stop', props: {}, root: false };
  if (t === 'повторить шаг') return { type: 'goto', props: { target: 'повторить' }, root: false };

  // ── Сообщение и навигация ───────────────────────────────────────────────
  if (t.startsWith('ответ ')) return { type: 'message', props: { text: stripQuotes(t.replace(/^ответ(_md)?/, '').trim()) }, root: false };
  if (t.startsWith('использовать ')) return { type: 'use', props: { blockname: t.replace('использовать', '').trim() }, root: false };
  if (t.startsWith('если ')) return { type: 'condition', props: { cond: t.replace(/^если\s+/, '').replace(/:$/, '') }, root: false };

  // ── Вопрос ──────────────────────────────────────────────────────────────
  if (t.startsWith('спросить ')) {
    const question = t.match(/"([^"]+)"/)?.[1] || '';
    const varname = (t.split('→')[1] || t.split('->')[1] || 'var').trim();
    return { type: 'ask', props: { question, varname }, root: false };
  }

  // ── Переменные ──────────────────────────────────────────────────────────
  if (t.startsWith('запомни ')) {
    const [varname, ...rest] = t.replace('запомни', '').trim().split('=');
    return { type: 'remember', props: { varname: (varname || '').trim(), value: (rest.join('=') || '').trim() }, root: false };
  }

  // ── База данных ─────────────────────────────────────────────────────────
  // получить от USER_ID "key" → var  (должно быть ПЕРЕД обычным получить)
  {
    const guMatch = t.match(/^получить от (\S+) "([^"]+)"\s*(?:→|->)\s*(\S+)/);
    if (guMatch) return { type: 'get_user', props: { user_id: guMatch[1], key: guMatch[2], varname: guMatch[3] }, root: false };
  }
  if (t.startsWith('получить ')) {
    const key = t.match(/"([^"]+)"/)?.[1] || '';
    const varname = (t.split('→')[1] || t.split('->')[1] || 'var').trim();
    return { type: 'get', props: { key, varname }, root: false };
  }

  // сохранить_глобально "key" = value
  if (t.startsWith('сохранить_глобально ')) {
    const key = t.match(/"([^"]+)"/)?.[1] || '';
    const value = t.split('=').slice(1).join('=').trim();
    return { type: 'save_global', props: { key, value }, root: false };
  }
  if (t.startsWith('сохранить ')) {
    const key = t.match(/"([^"]+)"/)?.[1] || '';
    const value = t.split('=').slice(1).join('=').trim();
    return { type: 'save', props: { key, value }, root: false };
  }

  // удалить "key"  (только с кавычками — это удаление из БД)
  {
    const delDbMatch = t.match(/^удалить "([^"]+)"$/);
    if (delDbMatch) return { type: 'db_delete', props: { key: delDbMatch[1] }, root: false };
  }

  // все_ключи → var
  {
    const akMatch = t.match(/^все_ключи\s*(?:→|->)\s*(\S+)/);
    if (akMatch) return { type: 'all_keys', props: { varname: akMatch[1] }, root: false };
  }

  // вызвать "блок" → var
  {
    const cbMatch = t.match(/^вызвать "([^"]+)"\s*(?:→|->)\s*(\S+)/);
    if (cbMatch) return { type: 'call_block', props: { blockname: cbMatch[1], varname: cbMatch[2] }, root: false };
  }

  // ── Кнопки ──────────────────────────────────────────────────────────────
  if (t.startsWith('кнопки:')) return { type: 'buttons', props: { rows: '' }, root: false, multilineButtons: true };
  if (t.startsWith('кнопки ')) {
    const label = stripQuotes(t.replace('кнопки', '').trim());
    return { type: 'buttons', props: { rows: label }, root: false };
  }
  if (t.startsWith('inline-кнопки:')) return { type: 'inline', props: { buttons: '' }, root: false, multilineButtons: true, inlineButtons: true };
  if (t.startsWith('кнопка ')) {
    const label = t.match(/"([^"]+)"/)?.[1] || '';
    const urlMatch = t.match(/url\s+"([^"]+)"/);
    const cbMatch2 = t.match(/->\s+"([^"]+)"/);
    const target = urlMatch ? urlMatch[1] : (cbMatch2 ? cbMatch2[1] : '');
    const isUrl = !!urlMatch;
    return { type: 'buttons', props: { rows: label, target, isUrl }, root: false };
  }

  // ── Пауза / печатает ────────────────────────────────────────────────────
  if (t.startsWith('подождать ') || t.startsWith('пауза ')) {
    const raw = t.replace('подождать', '').replace('пауза', '').trim().split(' ')[0];
    return { type: 'delay', props: { seconds: raw.replace(/с$/, '') }, root: false };
  }
  if (t.startsWith('печатает ')) {
    const raw = t.replace('печатает', '').trim().split(' ')[0];
    return { type: 'typing', props: { seconds: raw.replace(/с$/, '') }, root: false };
  }

  // ── Лог ─────────────────────────────────────────────────────────────────
  if (t.startsWith('лог')) {
    const levelMatch = t.match(/^лог\[([^\]]+)\]/);
    const level = levelMatch ? levelMatch[1] : 'info';
    const rest = levelMatch ? t.slice(levelMatch[0].length).trim() : t.replace('лог', '').trim();
    return { type: 'log', props: { message: stripQuotes(rest), level }, root: false };
  }

  // ── Переходы ────────────────────────────────────────────────────────────
  if (t.startsWith('запустить ')) return { type: 'goto', props: { target: stripQuotes(t.replace('запустить', '').trim()) }, root: false };
  if (t.startsWith('перейти к шаг ')) return { type: 'goto', props: { target: stripQuotes(t.replace('перейти к шаг', '').trim()) }, root: false };
  if (t.startsWith('перейти ')) return { type: 'goto', props: { target: stripQuotes(t.replace('перейти', '').trim()) }, root: false };

  // ── Уведомления и рассылки ───────────────────────────────────────────────
  // уведомить TARGET: "text"
  {
    const ntMatch = t.match(/^уведомить (.+?):\s*"(.*)"/);
    if (ntMatch) return { type: 'notify', props: { target: ntMatch[1].trim(), text: ntMatch[2] }, root: false };
  }
  // рассылка всем: "text"
  {
    const bcAllMatch = t.match(/^рассылка всем:\s*"(.*)"/);
    if (bcAllMatch) return { type: 'broadcast', props: { mode: 'all', text: bcAllMatch[1] }, root: false };
  }
  // рассылка группе TAG: "text"
  {
    const bcGrpMatch = t.match(/^рассылка группе (\S+):\s*"(.*)"/);
    if (bcGrpMatch) return { type: 'broadcast', props: { mode: 'group', tag: bcGrpMatch[1], text: bcGrpMatch[2] }, root: false };
  }

  // ── Telegram расширения ─────────────────────────────────────────────────
  // inline из бд "key" текст "name" id "id" callback "prefix:" назад "Назад" -> "back"
  {
    const dbInlineMatch = t.match(/^inline(?:-кнопки)?\s+из\s+бд\s+"([^"]+)"(?:\s+текст\s+"([^"]*)")?(?:\s+id\s+"([^"]*)")?(?:\s+callback\s+"([^"]*)")?(?:\s+назад\s+"([^"]*)"\s*(?:→|->)\s*"([^"]*)")?(?:(?:\s+колонки\s+|\s+columns=)(\d+))?/);
    if (dbInlineMatch) {
      return {
        type: 'inline_db',
        props: {
          key: dbInlineMatch[1],
          labelField: dbInlineMatch[2] || '',
          idField: dbInlineMatch[3] || '',
          callbackPrefix: dbInlineMatch[4] || 'item:',
          backText: dbInlineMatch[5] || '⬅️ Назад',
          backCallback: dbInlineMatch[6] || 'назад',
          columns: dbInlineMatch[7] || '1',
        },
        root: false,
      };
    }
  }
  // проверить подписку @channel → var
  {
    const csMatch = t.match(/^проверить подписку @(\S+)\s*(?:→|->)\s*(\S+)/);
    if (csMatch) return { type: 'check_sub', props: { channel: '@' + csMatch[1], varname: csMatch[2] }, root: false };
  }
  // роль @channel USER_ID → var  (или: роль @channel USER_ID -> var)
  {
    const mrMatch = t.match(/^роль @(\S+)\s+(\S+)\s*(?:→|->)\s*(\S+)/);
    if (mrMatch) return { type: 'member_role', props: { channel: '@' + mrMatch[1], user_id: mrMatch[2], varname: mrMatch[3] }, root: false };
  }
  // переслать текст/фото/документ/... — вернуть входящее в текущий чат
  {
    const selfForwardMatch = t.match(/^переслать\s+(текст|фото|документ|голосовое|аудио|стикер)(?:\s+"([^"]*)")?/);
    if (selfForwardMatch) {
      const modeMap = { текст: 'text', фото: 'photo', документ: 'document', голосовое: 'voice', аудио: 'audio', стикер: 'sticker' };
      return { type: 'forward_msg', props: { mode: modeMap[selfForwardMatch[1]] || selfForwardMatch[1], target: '', caption: selfForwardMatch[2] || '' }, root: false };
    }
  }
  // переслать TARGET (старый формат: переслать сообщение TARGET)
  {
    const fwMatch = t.match(/^переслать(?:\s+сообщение)?\s+(.+)/);
    if (fwMatch) return { type: 'forward_msg', props: { mode: 'message', target: fwMatch[1].trim() }, root: false };
  }

  // ── Интеграции ядра ─────────────────────────────────────────────────────
  {
    const dbMatch = t.match(/^запрос_бд "([^"]+)"\s*(?:→|->)\s*(\S+)/);
    if (dbMatch) return { type: 'database', props: { query: dbMatch[1], varname: dbMatch[2] }, root: false };
  }
  {
    const clsMatch = t.match(/^классифицировать\s+\[([^\]]+)\]\s*(?:→|->)\s*(\S+)/);
    if (clsMatch) {
      const intents = splitTopLevelListItems(clsMatch[1]).map((x) => stripQuotes(x)).join('\n');
      return { type: 'classify', props: { intents, varname: clsMatch[2] }, root: false };
    }
  }
  {
    const evMatch = t.match(/^событие "([^"]+)"/);
    if (evMatch) return { type: 'analytics', props: { event: evMatch[1] }, root: false };
  }
  {
    const payMatch = t.match(/^оплата\s+(\S+)\s+(\S+)\s+(\S+)\s+"([^"]+)"$/);
    if (payMatch) return { type: 'payment', props: { provider: payMatch[1], amount: payMatch[2], currency: payMatch[3], title: payMatch[4] }, root: false };
  }

  // ── HTTP запросы ────────────────────────────────────────────────────────
  // http_заголовки var
  {
    const hdrsMatch = t.match(/^http_заголовки\s+(\S+)/);
    if (hdrsMatch) return { type: 'http', props: { method: 'HEADERS', varname: hdrsMatch[1] }, root: false };
  }
  // http_get "url" → var
  {
    const fetchMatch = t.match(/^fetch "([^"]+)"\s*(?:→|->)\s*(\S+)/);
    if (fetchMatch) return { type: 'http', props: { method: 'GET', url: fetchMatch[1], varname: fetchMatch[2] }, root: false };
  }
  {
    const hgMatch = t.match(/^http_get "([^"]+)"\s*(?:→|->)\s*(\S+)/);
    if (hgMatch) return { type: 'http', props: { method: 'GET', url: hgMatch[1], varname: hgMatch[2] }, root: false };
  }
  // http_delete "url" → var
  {
    const hdMatch = t.match(/^http_delete "([^"]+)"\s*(?:→|->)\s*(\S+)/);
    if (hdMatch) return { type: 'http', props: { method: 'DELETE', url: hdMatch[1], varname: hdMatch[2] }, root: false };
  }
  // http_post/patch/put "url" json VAR → result
  {
    const hjMatch = t.match(/^http_(post|patch|put) "([^"]+)" json (\S+)\s*(?:→|->)\s*(\S+)/);
    if (hjMatch) return { type: 'http', props: { method: hjMatch[1].toUpperCase(), url: hjMatch[2], jsonVar: hjMatch[3], varname: hjMatch[4], isJson: 'true' }, root: false };
  }
  // http_post/patch/put "url" с "data" → var
  {
    const hbMatch = t.match(/^http_(post|patch|put) "([^"]+)" с "([^"]+)"\s*(?:→|->)\s*(\S+)/);
    if (hbMatch) return { type: 'http', props: { method: hbMatch[1].toUpperCase(), url: hbMatch[2], body: hbMatch[3], varname: hbMatch[4] }, root: false };
  }
  // http_post/patch/put "url" → var  (без тела)
  {
    const hsMatch = t.match(/^http_(post|patch|put) "([^"]+)"\s*(?:→|->)\s*(\S+)/);
    if (hsMatch) return { type: 'http', props: { method: hsMatch[1].toUpperCase(), url: hsMatch[2], varname: hsMatch[3] }, root: false };
  }
  // устаревший синтаксис: запрос METHOD "url" → var
  {
    const oldHMatch = t.match(/^запрос (GET|POST|PATCH|PUT|DELETE) "([^"]+)"\s*(?:→|->)\s*(\S+)/);
    if (oldHMatch) return { type: 'http', props: { method: oldHMatch[1], url: oldHMatch[2], varname: oldHMatch[3] }, root: false };
  }

  // ── Медиа ───────────────────────────────────────────────────────────────
  if (t.startsWith('фото ')) {
    const parts = t.replace('фото', '').trim().match(/"([^"]+)"/g) || [];
    const url = parts[0] ? stripQuotes(parts[0]) : '';
    const caption = parts[1] ? stripQuotes(parts[1]) : '';
    return { type: 'photo', props: { url, ...(caption ? { caption } : {}) }, root: false };
  }
  if (t.startsWith('видео ')) {
    const parts = t.replace('видео', '').trim().match(/"([^"]+)"/g) || [];
    const url = parts[0] ? stripQuotes(parts[0]) : '';
    const caption = parts[1] ? stripQuotes(parts[1]) : '';
    return { type: 'video', props: { url, ...(caption ? { caption } : {}) }, root: false };
  }
  if (t.startsWith('аудио ')) return { type: 'audio', props: { url: stripQuotes(t.replace('аудио', '').trim()) }, root: false };
  if (t.startsWith('стикер ')) return { type: 'sticker', props: { file_id: stripQuotes(t.replace('стикер', '').trim()) }, root: false };
  if (/^отправить файл\s+/i.test(t)) {
    const rest = t.replace(/^отправить\s+файл\s+/i, '').trim();
    return { type: 'send_file', props: { file: rest }, root: false };
  }
  if (t.startsWith('документ ')) {
    const parts = t.replace('документ', '').trim().match(/"([^"]+)"/g) || [];
    const url = parts[0] ? stripQuotes(parts[0]) : '';
    const caption = parts[1] ? stripQuotes(parts[1]) : '';
    return { type: 'document', props: { url, ...(caption ? { caption } : {}) }, root: false };
  }
  if (t.startsWith('переслать фото ')) return { type: 'message', props: { text: stripQuotes(t.replace('переслать фото', '').trim()), media: 'forward_photo' }, root: false };
  if (t.startsWith('контакт ')) {
    const parts = t.replace('контакт', '').trim().match(/"([^"]+)"/g) || [];
    return { type: 'contact', props: { phone: stripQuotes(parts[0] || ''), first_name: stripQuotes(parts[1] || '') }, root: false };
  }
  if (t.startsWith('локация ')) {
    const [lat = '0', lon = '0'] = t.replace('локация', '').trim().split(/\s+/);
    return { type: 'location', props: { lat, lon }, root: false };
  }

  // ── Опрос ───────────────────────────────────────────────────────────────
  if (t.startsWith('опрос ')) {
    const quotes = t.match(/"([^"]+)"/g) || [];
    const question = quotes[0] ? stripQuotes(quotes[0]) : '';
    const options = quotes.slice(1).map(q => stripQuotes(q)).join('\n');
    return { type: 'poll', props: { question, options }, root: false };
  }

  // ── Рандом ──────────────────────────────────────────────────────────────
  if (t === 'рандом:') return { type: 'random', props: { variants: '' }, root: false, multilineRandom: true };

  return null;
}

function portFor(type, dir) {
  const cfg = FLOW_PORTS[type] || { input: 'flow', output: 'flow' };
  return dir === 'in' ? cfg.input : cfg.output;
}

export function parseCCDToFlow(text, blockTypes, defaultProps) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const nodes = [];
  const edges = [];
  const lastAtIndent = {};
  const rootRows = {};
  const rootByNode = {};
  let currentRoot = -1;
  let idSeq = 1;
  let pendingButtonsNode = null;
  let buttonsIndent = -1;
  let pendingRandomNode = null;
  let randomIndent = -1;
  let commandsNode = null;

  const mkNode = (parsed, indent, rootIndex) => {
    const id = `i${idSeq++}`;
    const meta = blockTypes.find(b => b.type === parsed.type);
    const row = rootRows[rootIndex] || 0;
    rootRows[rootIndex] = row + 1;

    nodes.push({
      id,
      type: 'cicada',
      position: {
        x: 60 + rootIndex * 260 + indent * 170,
        y: 40 + row * 92,
      },
      data: {
        type: parsed.type,
        label: meta?.label || parsed.type,
        props: { ...(defaultProps[parsed.type] || {}), ...(parsed.props || {}) },
      },
    });
    rootByNode[id] = rootIndex;
    return id;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = indentLevel(raw);

    if (commandsNode && indent > 0 && trimmed.startsWith('"')) {
      const prev = commandsNode.data.props.commands || '';
      commandsNode.data.props.commands = prev ? `${prev}\n${trimmed}` : trimmed;
      continue;
    }
    if (commandsNode && indent === 0) commandsNode = null;

    // FIX 7: сбор вариантов рандом
    if (pendingRandomNode && indent > randomIndent) {
      const val = stripQuotes(trimmed);
      if (val) {
        const prev = pendingRandomNode.data.props.variants || '';
        pendingRandomNode.data.props.variants = prev ? `${prev}\n${val}` : val;
      }
      continue;
    }
    if (pendingRandomNode && indent <= randomIndent) {
      pendingRandomNode = null;
      randomIndent = -1;
    }

    // FIX 6: сбор inline-кнопок (формат: ["текст" → "cb", ...])
    if (pendingButtonsNode && indent > buttonsIndent) {
      const nodeType = pendingButtonsNode.data.type;
      const bracket = trimmed.startsWith('[') && trimmed.endsWith(']');
      if (nodeType === 'inline') {
        const inner = bracket ? trimmed.slice(1, -1).trim() : trimmed;
        const pairs = (bracket ? splitTopLevelListItems(inner) : [trimmed])
          .map((s) => s.trim())
          .filter(Boolean)
          .join(', ');
        const prev = pendingButtonsNode.data.props.buttons || '';
        pendingButtonsNode.data.props.buttons = prev ? `${prev}\n${pairs}` : pairs;
      } else {
        const inner = bracket ? trimmed.slice(1, -1).trim() : trimmed;
        const parts = bracket ? splitTopLevelListItems(inner) : [trimmed];
        const labels = parts
          .map((p) => p.trim().match(/^"([^"]*)"$/)?.[1])
          .filter((x) => x !== undefined);
        const row = (labels.length ? labels : parts.map((p) => p.trim().replace(/^"|"$/g, '')))
          .map((v) => v.trim())
          .filter(Boolean)
          .join(', ');
        if (row) {
          const prev = pendingButtonsNode.data.props.rows || '';
          pendingButtonsNode.data.props.rows = prev ? `${prev}\n${row}` : row;
        }
      }
      continue;
    }
    if (pendingButtonsNode && indent <= buttonsIndent) {
      pendingButtonsNode = null;
      buttonsIndent = -1;
    }

    if (trimmed === 'команды:') {
      currentRoot += 1;
      const id = mkNode({ type: 'commands', props: { commands: '' } }, 0, currentRoot);
      commandsNode = nodes.find(n => n.id === id);
      lastAtIndent[0] = id;
      continue;
    }

    const parsed = parseNode(raw);
    if (!parsed) continue;

    // `иначе` относится к ближайшему `если` на том же уровне отступа;
    // корневым блоком оно быть не должно, иначе импорт DSL разрывает ветку условия.
    const isRoot = parsed.root || ROOT_KEYWORDS.some(k => trimmed.startsWith(k));

    if (isRoot) {
      currentRoot += 1;
      const id = mkNode(parsed, indent, currentRoot);
      lastAtIndent[0] = id;
      Object.keys(lastAtIndent).forEach(k => {
        if (Number(k) > 0) delete lastAtIndent[k];
      });
      if (parsed.multilineButtons) {
        pendingButtonsNode = nodes.find(n => n.id === id);
        buttonsIndent = indent;
      }
      if (parsed.multilineRandom) {
        pendingRandomNode = nodes.find(n => n.id === id);
        randomIndent = indent;
      }
      continue;
    }

    const parentIndent = Object.keys(lastAtIndent)
      .map(Number)
      .filter(k => k < indent)
      .sort((a, b) => b - a)[0];

    const rootIndex = parentIndent !== undefined ? rootByNode[lastAtIndent[parentIndent]] : Math.max(currentRoot, 0);
    const id = mkNode(parsed, indent, rootIndex);

    const sibling = lastAtIndent[indent];
    const parent = parentIndent !== undefined ? lastAtIndent[parentIndent] : null;
    const source = sibling || parent;
    if (source) {
      const sourceType = nodes.find(n => n.id === source)?.data?.type;
      const targetType = parsed.type;
      const sourceHandle = portFor(sourceType, 'out');
      const targetHandle = portFor(targetType, 'in');
      if (sourceHandle && targetHandle) {
        edges.push({
          id: `ie${source}-${id}`,
          source,
          target: id,
          sourceHandle,
          targetHandle,
        });
      }
    }

    lastAtIndent[indent] = id;
    Object.keys(lastAtIndent).forEach(k => {
      if (Number(k) > indent) delete lastAtIndent[k];
    });

    if (parsed.multilineButtons) {
      pendingButtonsNode = nodes.find(n => n.id === id);
      buttonsIndent = indent;
    }
    if (parsed.multilineRandom) {
      pendingRandomNode = nodes.find(n => n.id === id);
      randomIndent = indent;
    }
  }

  return { nodes, edges };
}
