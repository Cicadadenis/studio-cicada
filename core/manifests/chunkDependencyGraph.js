/**
 * Минимальный **протокольный** контракт рёбер графа зависимостей между chunkKey (schema v0).
 *
 * В project graph document (cicada-project-graph): опциональный top-level блок `dependencyGraph`
 * — см. `GRAPH_DOCUMENT_DEPENDENCY_GRAPH_KEY` и `buildProjectGraphDocument` в `graphDocumentRefs.js`.
 * Не смешивать с секцией **buildGraph** («как собирать» vs «что от чего семантически зависит»).
 *
 * Это не слой AST: рёбра должны пережить миграции IR/AST, смену парсера, диалекты и оптимизатор.
 * Семантика `kind` — **стабильная предметная** (что означает связь для анализа / инвалидации), а не
 * runtime/UI (никаких `executes_before`, `stack_parent` и т.п.).
 *
 * Версия схемы (`chunkDependencyGraphSchemaVersion`) **независима** от `CHUNK_KEY_SPEC_VERSION` и версий
 * graph document: она будет эволюционировать отдельно и обычно быстрее AST.
 *
 * Распространение инвалидации по графу: см. `chunkInvalidation.js` (`planSemanticInvalidationV0`).
 */

import {
  assertValidChunkKey,
  compareChunkKeysUtf8,
  formatChunkKey,
} from './chunkKeySpec.js';

/** Схема dependency graph v0 (отдельно от chunkKey spec и Merkle tree version). */
export const CHUNK_DEPENDENCY_GRAPH_SCHEMA_VERSION = 0;

/**
 * Семантические виды рёбер v0. Расширение — поднять `CHUNK_DEPENDENCY_GRAPH_SCHEMA_VERSION` или ввести v1.
 */
export const CHUNK_DEPENDENCY_EDGE_KIND = Object.freeze({
  CALLS: 'calls',
  READS: 'reads',
  WRITES: 'writes',
  IMPORTS: 'imports',
  DEPENDS_ON: 'depends_on',
  TRIGGERS: 'triggers',
});

const ALLOWED_KINDS = new Set(Object.values(CHUNK_DEPENDENCY_EDGE_KIND));

/** Поля документа v0 (кроме версии и `edges`). */
const ALLOWED_GRAPH_KEYS = new Set([
  'chunkDependencyGraphSchemaVersion',
  /** Допустимый алиас при вводе; в выводе нормализации остаётся только каноническое имя версии. */
  'schemaVersion',
  'edges',
]);

/** @typedef {{ from: string, to: string, kind: string }} ChunkDependencyEdgeV0 */

function canonicalChunkKeyString(raw, ctx) {
  try {
    const p = assertValidChunkKey(String(raw ?? ''));
    return formatChunkKey(p);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${ctx}: ${msg}`);
  }
}

/**
 * Нормализует одно ребро v0: только `from`, `to`, `kind`; `from`/`to` — валидные chunkKey v1, канонизированы.
 *
 * @param {unknown} edge
 * @param {number} [idx]
 * @returns {ChunkDependencyEdgeV0}
 */
export function normalizeChunkDependencyEdgeV0(edge, idx = 0) {
  if (edge == null || typeof edge !== 'object' || Array.isArray(edge)) {
    throw new Error(`chunkDependencyGraph: ребро [${idx}] должно быть объектом`);
  }
  const e = /** @type {Record<string, unknown>} */ (edge);
  for (const k of Object.keys(e)) {
    if (k !== 'from' && k !== 'to' && k !== 'kind') {
      throw new Error(
        `chunkDependencyGraph: ребро [${idx}]: неизвестное поле "${k}" (v0 — только from, to, kind)`,
      );
    }
  }
  const from = canonicalChunkKeyString(e.from, `chunkDependencyGraph: ребро [${idx}].from`);
  const to = canonicalChunkKeyString(e.to, `chunkDependencyGraph: ребро [${idx}].to`);
  const kindRaw = String(e.kind ?? '').trim();
  if (!ALLOWED_KINDS.has(kindRaw)) {
    throw new Error(
      `chunkDependencyGraph: ребро [${idx}]: неизвестный kind "${kindRaw.slice(0, 64)}"`,
    );
  }
  return { from, to, kind: kindRaw };
}

/**
 * Нормализует документ графа v0: дедупликация и сортировка рёбер (from, to, kind).
 * Принимает `{ chunkDependencyGraphSchemaVersion?, schemaVersion?, edges }` или сырой массив `edges`.
 *
 * @param {unknown} input
 * @returns {{ chunkDependencyGraphSchemaVersion: number, edges: ChunkDependencyEdgeV0[] }}
 */
export function normalizeChunkDependencyGraphV0(input) {
  /** @type {Record<string, unknown>} */
  let container;
  if (Array.isArray(input)) {
    container = { edges: input };
  } else if (input != null && typeof input === 'object' && !Array.isArray(input)) {
    container = /** @type {Record<string, unknown>} */ (input);
  } else {
    throw new Error('chunkDependencyGraph: ожидался объект документа или массив рёбер');
  }

  for (const k of Object.keys(container)) {
    if (!ALLOWED_GRAPH_KEYS.has(k)) {
      throw new Error(`chunkDependencyGraph: неизвестное поле документа "${k}"`);
    }
  }

  const rawVersion =
    container.chunkDependencyGraphSchemaVersion !== undefined
      ? container.chunkDependencyGraphSchemaVersion
      : container.schemaVersion !== undefined
        ? container.schemaVersion
        : CHUNK_DEPENDENCY_GRAPH_SCHEMA_VERSION;

  const vn = Number(rawVersion);
  if (!Number.isInteger(vn) || vn !== CHUNK_DEPENDENCY_GRAPH_SCHEMA_VERSION) {
    throw new Error(
      `chunkDependencyGraph: неподдерживаемая chunkDependencyGraphSchemaVersion ${String(rawVersion)} (ожидается ${CHUNK_DEPENDENCY_GRAPH_SCHEMA_VERSION})`,
    );
  }

  const edgesRaw = container.edges;
  if (!Array.isArray(edgesRaw)) {
    throw new Error('chunkDependencyGraph: edges должен быть массивом');
  }

  const normalized = edgesRaw.map((ed, i) => normalizeChunkDependencyEdgeV0(ed, i));
  const seen = new Set();
  /** @type {ChunkDependencyEdgeV0[]} */
  const uniq = [];
  for (const e of normalized) {
    const k = `${e.from}\0${e.to}\0${e.kind}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(e);
  }
  uniq.sort((a, b) => {
    let c = compareChunkKeysUtf8(a.from, b.from);
    if (c !== 0) return c;
    c = compareChunkKeysUtf8(a.to, b.to);
    if (c !== 0) return c;
    if (a.kind < b.kind) return -1;
    if (a.kind > b.kind) return 1;
    return 0;
  });

  return {
    chunkDependencyGraphSchemaVersion: CHUNK_DEPENDENCY_GRAPH_SCHEMA_VERSION,
    edges: uniq,
  };
}
