/**
 * Индекс блобов по секциям graph document: digest + size (+ uri, chunks) для sync / prefetch / GC / CAS.
 *
 * Chunked CAS: не только `chunks[]`, а **стабильные семантические границы** — у каждого чанка свой
 * `chunkKey` в формате `chunkKeySpec` v1 (`handler/command:/start`, …). Без стабильных семантических границ
 * пересобирает весь AST как один блоб.
 *
 * Агрегат секции при чанках: рекомендуется **Merkle-корень** (`aggregateKind: 'merkle-v1'`), см.
 * `core/manifests/chunkMerkle.js` — частичная верификация, инкрементальный пересчёт ветки, subtree sync.
 * Дальше: граф ссылок на общие чанки между проектами → chunk-level GC.
 */

import { stableStringify } from './hashes.js';
import {
  normalizeContentDigest,
  contentDigestCanonicalJson,
} from './blobIntegrity.js';
import { assertValidChunkKey } from './chunkKeySpec.js';

/** Синхронно с GRAPH_DOCUMENT_BLOB_KEYS в graphDocumentRefs.js */
const BLOB_SECTION_KEYS = Object.freeze([
  'ir',
  'ast',
  'buildGraph',
  'ui',
  'debug',
  'cache',
]);

function refKey(k) {
  return `${k}Ref`;
}

function digestKey(k) {
  return `${k}Digest`;
}

export const BLOB_MANIFEST_VERSION = 1;

/**
 * @typedef {{
 *   digest: string,
 *   size: number,
 *   uri?: string,
 *   aggregateKind?: 'merkle-v1',
 *   chunks?: {
 *     digest: string,
 *     size: number,
 *     uri?: string,
 *     label?: string,
 *     chunkKey?: string,
 *   }[],
 * }} BlobManifestEntry
 */

function utf8ByteLength(text) {
  return new TextEncoder().encode(text).length;
}

/**
 * @param {unknown} entry
 * @returns {BlobManifestEntry}
 */
export function normalizeBlobManifestEntry(entry) {
  if (entry == null || typeof entry !== 'object') {
    throw new Error('blobManifest: запись должна быть объектом');
  }
  const e = /** @type {Record<string, unknown>} */ (entry);
  const digest = normalizeContentDigest(String(e.digest || ''));
  const size = Number(e.size);
  if (!Number.isFinite(size) || size < 0) {
    throw new Error('blobManifest: size должен быть неотрицательным числом байт');
  }
  /** @type {BlobManifestEntry} */
  const out = { digest, size };
  if (typeof e.uri === 'string' && e.uri) out.uri = e.uri;
  if (e.aggregateKind !== undefined && e.aggregateKind !== null) {
    const ak = String(e.aggregateKind);
    if (ak !== 'merkle-v1') {
      throw new Error('blobManifest: aggregateKind сейчас поддерживается только merkle-v1');
    }
    out.aggregateKind = 'merkle-v1';
  }
  if (Array.isArray(e.chunks)) {
    out.chunks = e.chunks.map((c, i) => {
      if (!c || typeof c !== 'object') throw new Error(`blobManifest: chunks[${i}] неверен`);
      const x = /** @type {Record<string, unknown>} */ (c);
      const cd = normalizeContentDigest(String(x.digest || ''));
      const csz = Number(x.size);
      if (!Number.isFinite(csz) || csz < 0) {
        throw new Error(`blobManifest: chunks[${i}].size неверен`);
      }
      /** @type {{ digest: string, size: number, uri?: string, label?: string, chunkKey?: string }} */
      const part = { digest: cd, size: csz };
      if (typeof x.uri === 'string' && x.uri) part.uri = x.uri;
      if (typeof x.label === 'string' && x.label) part.label = x.label;
      if (x.chunkKey !== undefined && x.chunkKey !== null) {
        const ck = String(x.chunkKey).trim();
        if (!ck) throw new Error(`blobManifest: chunks[${i}].chunkKey не может быть пустым`);
        try {
          assertValidChunkKey(ck);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`blobManifest: chunks[${i}].chunkKey: ${msg}`);
        }
        part.chunkKey = ck;
      }
      return part;
    });
  }
  if (out.aggregateKind === 'merkle-v1' && out.chunks?.length) {
    for (let i = 0; i < out.chunks.length; i += 1) {
      if (!out.chunks[i].chunkKey) {
        throw new Error(
          `blobManifest: при aggregateKind merkle-v1 у chunks[${i}] нужен стабильный chunkKey`,
        );
      }
    }
  }
  return out;
}

/**
 * @param {Record<string, unknown>} blobs - карта секция → запись (как в graph document)
 * @param {number} [version]
 */
export function normalizeBlobManifest(blobs, version = BLOB_MANIFEST_VERSION) {
  if (blobs == null || typeof blobs !== 'object' || Array.isArray(blobs)) {
    throw new Error('blobManifest: blobs должен быть объектом');
  }
  /** @type {Record<string, BlobManifestEntry>} */
  const out = {};
  for (const [k, v] of Object.entries(blobs)) {
    if (k.startsWith('_') || k === 'version') continue;
    out[k] = normalizeBlobManifestEntry(v);
  }
  return { blobsVersion: version, blobs: out };
}

/**
 * Собирает индекс по текущему документу: для inline секций считает canonical JSON, size и digest.
 * Для секций только с *Ref: подставляет *Digest и size из knownSizes или 0.
 *
 * @param {Record<string, unknown>} doc
 * @param {{ knownSizes?: Partial<Record<string, number>> }} [options]
 */
export async function buildBlobManifestFromGraphDocumentAsync(doc, options = {}) {
  const d = doc || {};
  const knownSizes = options.knownSizes || {};
  /** @type {Record<string, BlobManifestEntry>} */
  const blobs = {};

  for (const k of BLOB_SECTION_KEYS) {
    const rk = refKey(k);
    const dk = digestKey(k);
    const payload = d[k];
    const refUri = typeof d[rk] === 'string' && d[rk] ? d[rk] : undefined;
    const digestStr = typeof d[dk] === 'string' && d[dk].trim() ? d[dk].trim() : undefined;

    if (payload !== undefined && payload !== null) {
      const text = stableStringify(payload);
      const size = utf8ByteLength(text);
      const digest = await contentDigestCanonicalJson(payload);
      /** @type {BlobManifestEntry} */
      const ent = { digest, size };
      if (refUri) ent.uri = refUri;
      blobs[k] = ent;
      continue;
    }

    if (digestStr) {
      const digest = normalizeContentDigest(digestStr);
      const size =
        knownSizes[k] !== undefined && knownSizes[k] !== null
          ? Number(knownSizes[k])
          : 0;
      /** @type {BlobManifestEntry} */
      const ent = { digest, size: Number.isFinite(size) && size >= 0 ? size : 0 };
      if (refUri) ent.uri = refUri;
      blobs[k] = ent;
    }
  }

  return { blobsVersion: BLOB_MANIFEST_VERSION, blobs };
}

/**
 * Объём всех блобов в индексе (сумма size; чанки не суммируем отдельно — это метаданные срезов).
 * @param {{ blobs?: Record<string, BlobManifestEntry> }} manifest
 */
export function blobManifestTotalBytes(manifest) {
  const b = manifest?.blobs;
  if (!b || typeof b !== 'object') return 0;
  let n = 0;
  for (const e of Object.values(b)) {
    if (e && typeof e.size === 'number') n += e.size;
  }
  return n;
}

/**
 * Секции, для которых в индексе известен ненулевой size (удобно для prefetch).
 * @param {{ blobs?: Record<string, BlobManifestEntry> }} manifest
 */
export function blobManifestNonEmptySections(manifest) {
  const b = manifest?.blobs;
  if (!b) return [];
  return Object.entries(b)
    .filter(([, e]) => e && typeof e.size === 'number' && e.size > 0)
    .map(([k]) => k);
}

/**
 * Добавляет blobs / blobsVersion к копии graph document (удобно после sync-only среза).
 *
 * @param {Record<string, unknown>} doc
 * @param {{ knownSizes?: Partial<Record<string, number>> }} [options]
 */
export async function enrichGraphDocumentWithBlobManifestAsync(doc, options) {
  const built = await buildBlobManifestFromGraphDocumentAsync(doc, options);
  return {
    ...doc,
    blobsVersion: built.blobsVersion,
    blobs: built.blobs,
  };
}
