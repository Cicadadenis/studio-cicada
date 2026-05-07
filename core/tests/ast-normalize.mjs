/**
 * Канонизация AST после JSON.parse — перед deepStrictEqual или сериализацией.
 *
 * - Удаляет типичные метаданные (позиции, служебные поля).
 * - Сортирует ключи объектов (стабильные снимки и меньше шума при diff).
 * - Не меняет порядок элементов массивов (семантика дерева).
 * - Поле schemaVersion у узлов контракта не считается метаданными и сохраняется.
 */

/** Имена полей, которые не должны участвовать в сравнении деревьев. */
export const AST_METADATA_KEYS = new Set([
  'line',
  'lineno',
  'line_no',
  'column',
  'col',
  'offset',
  'start',
  'end',
  'span',
  'pos',
  'range',
  'loc',
  'location',
  'source',
  'source_text',
  'filename',
  'file',
  'meta',
  'metadata',
  'comments',
  'leading_comments',
  'trailing_comments',
]);

export function shouldStripAstKey(key) {
  if (typeof key !== 'string') return false;
  if (AST_METADATA_KEYS.has(key)) return true;
  if (key.startsWith('_')) return true;
  return false;
}

/**
 * @param {unknown} node
 * @param {{ stripNull?: boolean }} [opts]
 */
export function normalizeAst(node, opts = {}) {
  const { stripNull = false } = opts;

  if (node === null || node === undefined) {
    return stripNull ? undefined : null;
  }

  if (typeof node !== 'object') {
    return node;
  }

  if (Array.isArray(node)) {
    const arr = node.map((x) => normalizeAst(x, opts));
    return stripNull ? arr.filter((x) => x !== undefined) : arr;
  }

  /** @type {Record<string, unknown>} */
  const sorted = {};
  for (const key of Object.keys(node).sort()) {
    if (shouldStripAstKey(key)) continue;
    let val = normalizeAst(node[key], opts);
    if (stripNull && val === undefined) continue;
    if (stripNull && val === null) continue;
    sorted[key] = val;
  }
  return sorted;
}

/** Строка для отладки / опциональных снимков (ключи отсортированы рекурсивно). */
export function canonicalAstString(ast, opts) {
  return `${JSON.stringify(normalizeAst(ast, opts), null, 2)}\n`;
}
