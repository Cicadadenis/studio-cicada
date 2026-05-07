/**
 * Запрещённые «шаблонные» токены бота (как в POST /api/run).
 * Единая проверка для линта DSL и запуска бота.
 */

const RAW = [
  'YOUR_BOT_TOKEN',
  'TOKEN',
  'BOT_TOKEN',
  'TELEGRAM_BOT_TOKEN',
  'Paste_your_token_here',
  'paste_your_token_here',
  'REPLACE_ME',
  'XXX',
];

const SET = new Set([...RAW, ...RAW.map((s) => s.toLowerCase())]);

/**
 * @param {string} token — значение из строки бот "…"
 */
export function isPlaceholderBotToken(token) {
  const t = String(token ?? '').trim();
  if (!t) return true;
  if (SET.has(t)) return true;
  const u = t.toUpperCase();
  if (SET.has(u)) return true;
  if (/^your[_\s-]?bot[_\s-]?token$/i.test(t)) return true;
  return false;
}

/**
 * Диагностики по первой корневой строке `бот "TOKEN"`.
 *
 * В конструкторе и AI-пайплайне токен намеренно игнорируется: схемы часто
 * создаются с `YOUR_BOT_TOKEN`, а реальная проверка остаётся только в /api/run
 * через isPlaceholderBotToken(). Это убирает ложные предупреждения DSL005.
 *
 * @returns {Array<{code:string, severity:string, line:number, message:string, help:string, suggestions?:string[]}>}
 */
export function lintPlaceholderBotDeclaration() {
  return [];
}
