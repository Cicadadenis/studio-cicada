/**
 * Протокол **семантической инвалидации** v0: чистая логика на `dependencyGraph` + множестве изменившихся chunkKey.
 * Без AST, компилятора, рантайма, планировщика — только interchange / planning.
 *
 * Согласовано с рёбрами v0 (см. `chunkDependencyGraph.js`): ребро **from → to** означает,
 * что **from семантически зависит от to** (пример: handler *calls* block). Изменился **to** (новый digest /
 * rollup Merkel) → нужно пересчитать **from** и транзитивных **потребителей** from.
 *
 * v0: все `kind` обрабатываются одинаково (унифицированное распространение). Узкие правила по `kind` —
 * следующие версии протокола.
 *
 * Merkle / CAS: пересчёт агрегатов и выкладка блобов — вне этого модуля; на входе уже есть стабильные
 * идентичности и канонический граф.
 */

import {
  assertValidChunkKey,
  compareChunkKeysUtf8,
  formatChunkKey,
} from './chunkKeySpec.js';
import { normalizeChunkDependencyGraphV0 } from './chunkDependencyGraph.js';

/** Версия протокола инвалидации (независима от `chunkDependencyGraphSchemaVersion`). */
export const CHUNK_INVALIDATION_PROTOCOL_VERSION = 0;

/**
 * @typedef {{
 *   invalidationProtocolVersion: number,
 *   dirtySeeds: string[],
 *   dependentsTransitive: string[],
 *   recomputeSet: string[],
 * }} SemanticInvalidationPlanV0
 */

/**
 * @param {string} s
 */
function canonicalChunkKey(s) {
  return formatChunkKey(assertValidChunkKey(s));
}

/**
 * to → множество from, у которых есть ребро (from → to).
 * @param {{ edges: { from: string, to: string, kind: string }[] }} graph
 * @returns {Map<string, Set<string>>}
 */
export function dependencyGraphReverseConsumers(graph) {
  /** @type {Map<string, Set<string>>} */
  const rev = new Map();
  for (const e of graph.edges) {
    if (!rev.has(e.to)) rev.set(e.to, new Set());
    rev.get(e.to).add(e.from);
  }
  return rev;
}

/**
 * План пересчёта: транзитивные потребители изменившихся chunkKey.
 *
 * @param {string[]} dirtyChunkKeys — идентичности чанков, чьё содержимое/digest изменилось
 * @param {unknown} dependencyGraphInput — аргумент для `normalizeChunkDependencyGraphV0`
 * @param {{ includeSeedsInRecomputeSet?: boolean }} [options] — по умолчанию seeds входят в `recomputeSet`
 * @returns {SemanticInvalidationPlanV0}
 */
export function planSemanticInvalidationV0(dirtyChunkKeys, dependencyGraphInput, options = {}) {
  const includeSeeds = options.includeSeedsInRecomputeSet !== false;
  const graph = normalizeChunkDependencyGraphV0(dependencyGraphInput);
  const seeds = Array.from(
    new Set((dirtyChunkKeys || []).map((k) => canonicalChunkKey(k))),
  ).sort(compareChunkKeysUtf8);

  const rev = dependencyGraphReverseConsumers(graph);
  /** @type {Set<string>} */
  const dependents = new Set();
  /** @type {string[]} */
  const queue = [];

  for (const s of seeds) {
    queue.push(s);
  }

  while (queue.length > 0) {
    const k = /** @type {string} */ (queue.shift());
    const outs = rev.get(k);
    if (!outs) continue;
    for (const consumer of outs) {
      if (dependents.has(consumer)) continue;
      dependents.add(consumer);
      queue.push(consumer);
    }
  }

  const dependentsSorted = Array.from(dependents).sort(compareChunkKeysUtf8);
  /** @type {Set<string>} */
  const recompute = new Set(includeSeeds ? [...seeds, ...dependentsSorted] : dependentsSorted);
  const recomputeSet = Array.from(recompute).sort(compareChunkKeysUtf8);

  return {
    invalidationProtocolVersion: CHUNK_INVALIDATION_PROTOCOL_VERSION,
    dirtySeeds: seeds,
    dependentsTransitive: dependentsSorted,
    recomputeSet,
  };
}
