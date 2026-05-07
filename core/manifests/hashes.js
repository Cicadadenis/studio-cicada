/**
 * Детерминированные отличия графа: стабильная сериализация + 64-bit FNV-1a.
 * В браузере без WebCrypto sync; для крипто-уровня на сервере замените на SHA-256.
 */

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function fnv1a64Hex(text) {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i += 1) {
    h ^= BigInt(text.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

/**
 * Детерминированный 64-bit FNV-1a по строке, hex без префикса.
 * Синхронно везде; удобно для cache key пайплайна без WebCrypto.
 * @param {string} text
 */
export function fnv1a64HexUtf8(text) {
  return fnv1a64Hex(String(text ?? ''));
}

/** Хэш листа: тип + props блока (без координат UI). */
export function blockContentFingerprint(type, props) {
  return stableStringify({ type, props: props || {} });
}

/**
 * @param {{ id: string, type: string, props: object, semanticId?: string }[]} nodes
 * @param {{ source: string, target: string, sourceHandle?: string|null, targetHandle?: string|null }[]} edges
 */
export function computeGraphHashes(nodes, edges) {
  const byId = new Map((nodes || []).map((n) => [n.id, n]));
  const nodePart = (nodes || [])
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((n) => blockContentFingerprint(n.type, n.props))
    .join('\n');
  const edgePart = (edges || [])
    .slice()
    .sort((a, b) => {
      const ak = `${a.source}|${a.target}|${a.sourceHandle}|${a.targetHandle}`;
      const bk = `${b.source}|${b.target}|${b.sourceHandle}|${b.targetHandle}`;
      return ak.localeCompare(bk);
    })
    .map((e) => stableStringify(e))
    .join('\n');
  const contentHash = `fnv1a64:${fnv1a64Hex(`${nodePart}\n--EDGES--\n${edgePart}`)}`;

  const children = new Map();
  for (const n of nodes || []) children.set(n.id, []);
  for (const e of edges || []) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    if (!children.has(e.source)) children.set(e.source, []);
    children.get(e.source).push(e.target);
  }
  for (const [, list] of children) list.sort();

  const memo = new Map();
  function subtreeHash(id) {
    if (memo.has(id)) return memo.get(id);
    const node = byId.get(id);
    if (!node) {
      memo.set(id, fnv1a64Hex(`missing:${id}`));
      return memo.get(id);
    }
    const base = blockContentFingerprint(node.type, node.props);
    const ch = (children.get(id) || []).map(subtreeHash).sort().join(',');
    const rolled = fnv1a64Hex(`${base}|children:${ch}`);
    memo.set(id, rolled);
    return rolled;
  }

  const roots = (nodes || []).filter((n) => !(edges || []).some((e) => e.target === n.id));
  const rootList = roots.length ? roots.map((r) => r.id) : (nodes || []).map((n) => n.id);
  const rollupParts = rootList.slice().sort().map((id) => `${id}:${subtreeHash(id)}`);
  const rollupHash = `fnv1a64:${fnv1a64Hex(rollupParts.join('|'))}`;

  return {
    contentHash,
    rollupHash,
    subtreeByNode: Object.fromEntries(memo),
  };
}
