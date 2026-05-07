/**
 * Формальный namespace для `chunkKey` — **семантическая**, не позиционная идентичность для CAS / sync / GC.
 * GC и lifecycle принадлежат **CAS-слою**, не AST: chunkKey — контракт между producer’ом чанков и хранилищем,
 * без привязки к языковым семантикам жизненного цикла блобов.
 *
 * Каноническая форма (v1):
 *   `<namespace>/<role>:<localId>`
 *
 * - `namespace` — верхний уровень предметной области (`handler`, `scenario`, `block`, …).
 * - `role` — подтип внутри namespace (`command`, `callback`, `flow`, `http`, …).
 * - `localId` — **семантический** идентификатор (имя callback, имя сценария, ключ блока, путь entrypoint).
 *   Допустимы символы вроде `/` в localId (`handler/command:/start`).
 *
 * Запрещены позиционные ключи вида `handler/3`: при переупорядочивании ломаются sync, кэш, Merkle, dedup.
 *
 * Примеры (v1):
 * - `handler/command:/start`
 * - `handler/callback:buy`
 * - `scenario/flow:onboarding`
 * - `block/http:weather`
 *
 * Дальше (отдельный контракт): **граф зависимостей** между chunkKey (инкрементальный анализ, invalidation,
 * selective execution) — не смешивать с **графом достижимости для GC** в CAS.
 */

export const CHUNK_KEY_SPEC_VERSION = 1;

/** Разрешённые верхнеуровневые namespace в v1 (расширение ⇒ согласовать новую версию spec или minor). */
export const CHUNK_KEY_NAMESPACE = Object.freeze({
  HANDLER: 'handler',
  SCENARIO: 'scenario',
  BLOCK: 'block',
});

const ALLOWED_NAMESPACES = new Set(Object.values(CHUNK_KEY_NAMESPACE));

/**
 * Рекомендуемые `role` для handler-чанков (документация / генераторы; парсер v1 не ограничивает жёстким списком).
 * @type {readonly string[]}
 */
export const CHUNK_KEY_SUGGESTED_HANDLER_ROLES = Object.freeze([
  'command',
  'callback',
  'menu',
]);

const SEG = '[a-z][a-z0-9_-]*';
const CHUNK_KEY_RE = new RegExp(`^(${SEG})/(${SEG}):([\\s\\S]+)$`);

const MAX_LOCAL_ID_LENGTH = 2048;

/**
 * @typedef {{ namespace: string, role: string, localId: string }} ParsedChunkKey
 */

/**
 * Разбор канонического chunkKey v1. Возвращает `null`, если строка не соответствует spec.
 * @param {string} s
 * @returns {ParsedChunkKey | null}
 */
export function parseChunkKey(s) {
  const str = String(s || '').trim();
  if (!str) return null;
  const m = str.match(CHUNK_KEY_RE);
  if (!m) return null;
  const namespace = m[1];
  const role = m[2];
  const localId = m[3];
  if (!ALLOWED_NAMESPACES.has(namespace)) return null;
  if (!localId || localId.length > MAX_LOCAL_ID_LENGTH) return null;
  if (localId !== localId.trim()) return null;
  if (/\n|\r/.test(localId)) return null;
  return { namespace, role, localId };
}

/**
 * Сборка канонической строки из частей (с trim). Бросает, если результат не проходит v1.
 * @param {{ namespace: string, role: string, localId: string }} parts
 */
export function formatChunkKey(parts) {
  if (parts == null || typeof parts !== 'object') {
    throw new Error('chunkKeySpec: ожидался объект { namespace, role, localId }');
  }
  const namespace = String(parts.namespace || '').trim();
  const role = String(parts.role || '').trim();
  const localId = String(parts.localId ?? '').trim();
  if (!namespace || !role || !localId) {
    throw new Error('chunkKeySpec: namespace, role и localId должны быть непустыми');
  }
  const formatted = `${namespace}/${role}:${localId}`;
  if (!parseChunkKey(formatted)) {
    throw new Error('chunkKeySpec: сочетание частей не образует валидный chunkKey v1');
  }
  return formatted;
}

/**
 * @param {string} s
 */
export function isValidChunkKey(s) {
  return parseChunkKey(s) != null;
}

/**
 * @param {string} s
 * @returns {ParsedChunkKey}
 */
export function assertValidChunkKey(s) {
  const p = parseChunkKey(s);
  if (!p) {
    throw new Error(
      `chunkKeySpec: неверный chunkKey "${String(s).slice(0, 96)}". Ожидается v1: <namespace>/<role>:<localId> (семантический localId, не индекс позиции).`,
    );
  }
  return p;
}

/**
 * Лексикографическое сравнение chunkKey по байтам UTF-8 (детерминизм между рантаймами).
 * Общее для Merkle, сортировки рёбер dependency graph и канонического порядка.
 * @param {string} a
 * @param {string} b
 * @returns {number} −1 | 0 | 1
 */
export function compareChunkKeysUtf8(a, b) {
  const enc = new TextEncoder();
  const ua = enc.encode(a);
  const ub = enc.encode(b);
  const n = Math.min(ua.length, ub.length);
  for (let i = 0; i < n; i += 1) {
    if (ua[i] !== ub[i]) return ua[i] < ub[i] ? -1 : 1;
  }
  if (ua.length < ub.length) return -1;
  if (ua.length > ub.length) return 1;
  return 0;
}
