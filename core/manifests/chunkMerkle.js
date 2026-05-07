/**
 * Merkle-агрегация семантических чанков (chunked CAS, v1).
 *
 * Стабильные границы — у каждого чанка стабильный `chunkKey` по **chunkKeySpec** v1
 * (`handler/command:/start`, `scenario/flow:onboarding`, …). См. `chunkKeySpec.js`. Порядок листьев —
 * лексикографика по UTF-8 байтам `chunkKey`.
 *
 * Агрегат секции (корень) — не «hash отсортированного списка digest», а двоичное Merkle-дерево:
 * частичная верификация, инкрементальный пересчёт ветки, выровненный с chunkKey подграф для sync.
 *
 * Следующий уровень: граф ссылок между чанками (shared chunks, ref-count / GC по проектам).
 */

import {
  CONTENT_DIGEST_PREFIX,
  normalizeContentDigest,
  contentDigestHex,
} from './blobIntegrity.js';
import { assertValidChunkKey, compareChunkKeysUtf8 } from './chunkKeySpec.js';

/** Версия правил дерева; смена префиксов / нормализации ключа → новая версия API. */
export const CHUNK_MERKLE_TREE_VERSION = 1;

const LEAF_PREFIX = new TextEncoder().encode(`cicada.chunkLeaf.v${CHUNK_MERKLE_TREE_VERSION}\0`);
const NODE_PREFIX = new TextEncoder().encode(`cicada.chunkNode.v${CHUNK_MERKLE_TREE_VERSION}\0`);

/**
 * @typedef {{ chunkKey: string, digest: string }} ChunkMerkleLeaf
 */

/** @param {string} hex64 */
function hex64ToBytes(hex64) {
  if (!/^[a-f0-9]{64}$/i.test(hex64)) {
    throw new Error('chunkMerkle: ожидался 64 hex символа');
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    out[i] = parseInt(hex64.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @returns {Uint8Array}
 */
function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** @param {ArrayBuffer} buf */
async function sha256Raw(buf) {
  const crypto_ = globalThis.crypto;
  if (!crypto_?.subtle) {
    throw new Error('Web Crypto (crypto.subtle) недоступен: нельзя посчитать sha256');
  }
  return new Uint8Array(await crypto_.subtle.digest('SHA-256', buf));
}

/**
 * Лист: H(prefix | utf8(chunkKey) | 0x00 | raw32(contentDigest)).
 * chunkKey включается в лист, чтобы одинаковое содержимое под разными семантическими границами
 * не сливалось в один узел.
 *
 * @param {string} chunkKey
 * @param {string} contentDigest
 */
export async function chunkMerkleLeafHashAsync(chunkKey, contentDigest) {
  assertValidChunkKey(chunkKey);
  const nd = normalizeContentDigest(contentDigest);
  const hex = contentDigestHex(nd);
  if (!hex) throw new Error('chunkMerkle: неверный contentDigest');
  const raw = hex64ToBytes(hex);
  const keyUtf8 = new TextEncoder().encode(chunkKey);
  const payload = concatBytes(concatBytes(concatBytes(LEAF_PREFIX, keyUtf8), new Uint8Array([0])), raw);
  return sha256Raw(payload.buffer);
}

/**
 * Узел: H(prefix | left32 | right32).
 * @param {Uint8Array} left32
 * @param {Uint8Array} right32
 */
export async function chunkMerkleNodeHashAsync(left32, right32) {
  if (left32.length !== 32 || right32.length !== 32) {
    throw new Error('chunkMerkle: дочерние хэши должны быть по 32 байта');
  }
  const payload = concatBytes(concatBytes(NODE_PREFIX, left32), right32);
  return sha256Raw(payload.buffer);
}

function sortLeavesStable(leaves) {
  const sorted = [...leaves];
  sorted.sort((a, b) => compareChunkKeysUtf8(a.chunkKey, b.chunkKey));
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].chunkKey === sorted[i - 1].chunkKey) {
      throw new Error(`chunkMerkle: дубликат chunkKey: ${sorted[i].chunkKey}`);
    }
  }
  return sorted;
}

/**
 * Корень Merkle по семантическим листьям.
 * n === 1: корень = лист (без удвоения).
 * n > 1: на каждом уровне нечётный последний дублируется (как в классическом Merkle для нечётного числа).
 *
 * @param {ChunkMerkleLeaf[]} leaves
 * @returns {Promise<string>} sha256:…
 */
export async function merkleRootFromSemanticChunksAsync(leaves) {
  if (!Array.isArray(leaves) || leaves.length === 0) {
    throw new Error('chunkMerkle: нужен непустой массив листьев');
  }
  for (let i = 0; i < leaves.length; i += 1) {
    const L = leaves[i];
    if (!L || typeof L.chunkKey !== 'string' || typeof L.digest !== 'string') {
      throw new Error(`chunkMerkle: лист ${i} должен содержать строковые chunkKey и digest`);
    }
    assertValidChunkKey(L.chunkKey);
  }
  const sorted = sortLeavesStable(leaves);
  /** @type {Uint8Array[]} */
  let level = [];
  for (const L of sorted) {
    level.push(await chunkMerkleLeafHashAsync(L.chunkKey, L.digest));
  }
  if (level.length === 1) {
    const hex = [...level[0]].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${CONTENT_DIGEST_PREFIX}${hex}`;
  }
  while (level.length > 1) {
    /** @type {Uint8Array[]} */
    const next = [];
    const len = level.length;
    const paired = len % 2 === 0 ? len : len - 1;
    for (let i = 0; i < paired; i += 2) {
      next.push(await chunkMerkleNodeHashAsync(level[i], level[i + 1]));
    }
    if (len % 2 === 1) {
      const last = level[len - 1];
      next.push(await chunkMerkleNodeHashAsync(last, last));
    }
    level = next;
  }
  const hex = [...level[0]].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${CONTENT_DIGEST_PREFIX}${hex}`;
}

/**
 * Проверка, что digest секции совпадает с Merkle-корнем по чанкам.
 *
 * @param {ChunkMerkleLeaf[]} leaves
 * @param {string} expectedAggregateDigest
 */
export async function verifySemanticMerkleRootAsync(leaves, expectedAggregateDigest) {
  const root = await merkleRootFromSemanticChunksAsync(leaves);
  return normalizeContentDigest(root) === normalizeContentDigest(expectedAggregateDigest);
}
