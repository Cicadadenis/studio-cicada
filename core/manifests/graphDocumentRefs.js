/**
 * Внешние «блобы» graph document: либо inline-поле (ast, ui, …), либо ссылка astRef, uiRef, …
 *
 * Схемы URI не фиксируем жёстко: `cache://`, `file://`, `https://`, `s3://` — на усмотрение стора.
 *
 * Опционально на top-level: `dependencyGraph` — протокольный артефакт «что семантически от чего зависит»
 * (chunkKey → chunkKey), отдельно от секции **buildGraph** («как собирать»).
 */

import {
  PROJECT_GRAPH_DOCUMENT_SCHEMA_VERSION,
  PROJECT_GRAPH_DOCUMENT_TYPE,
} from './constants.js';
import {
  graphBlobDigestKey,
  normalizeContentDigest,
  contentDigestCanonicalJson,
  verifyContentDigestCanonicalJson,
} from './blobIntegrity.js';
import { normalizeBlobManifest, BLOB_MANIFEST_VERSION } from './blobManifest.js';
import { normalizeChunkDependencyGraphV0 } from './chunkDependencyGraph.js';

export {
  CONTENT_DIGEST_PREFIX,
  graphBlobDigestKey,
  normalizeContentDigest,
  contentDigestCanonicalJson,
  contentDigestHex,
  contentDigestUtf8,
  contentDigestsEqual,
  verifyContentDigestCanonicalJson,
  casUriFromContentDigest,
  contentDigestFromCasUri,
} from './blobIntegrity.js';

/** Топ-level: необязательный семантический граф зависимостей между chunkKey (не blob-секция). */
export const GRAPH_DOCUMENT_DEPENDENCY_GRAPH_KEY = 'dependencyGraph';

/** Ключи секций, которые могут быть вынесены в {key}Ref. manifest — всегда inline. */
export const GRAPH_DOCUMENT_BLOB_KEYS = Object.freeze([
  'ir',
  'ast',
  'buildGraph',
  'ui',
  'debug',
  'cache',
]);
// Держать в синхроне с BLOB_SECTION_KEYS в blobManifest.js

const BLOB_SET = new Set(GRAPH_DOCUMENT_BLOB_KEYS);

/** @param {string} blobKey */
export function graphBlobRefKey(blobKey) {
  return `${blobKey}Ref`;
}

/** @param {string} key */
export function isGraphBlobRefKey(key) {
  if (typeof key !== 'string' || !key.endsWith('Ref')) return false;
  const base = key.slice(0, -3);
  return BLOB_SET.has(base);
}

/** @param {string} refKey e.g. astRef */
export function graphBlobKeyFromRef(refKey) {
  if (!isGraphBlobRefKey(refKey)) return null;
  return refKey.slice(0, -3);
}

/** @param {string} key */
export function isGraphBlobDigestKey(key) {
  if (typeof key !== 'string' || !key.endsWith('Digest')) return false;
  const base = key.slice(0, -6);
  return BLOB_SET.has(base);
}

/** @param {string} digestKey e.g. astDigest */
export function graphBlobKeyFromDigest(digestKey) {
  if (!isGraphBlobDigestKey(digestKey)) return null;
  return digestKey.slice(0, -6);
}

/**
 * @param {Record<string, unknown>} doc
 * @param {string} blobKey
 * @returns {string | null}
 */
export function graphDocumentSectionDigest(doc, blobKey) {
  if (!BLOB_SET.has(blobKey)) return null;
  const dk = graphBlobDigestKey(blobKey);
  const v = (doc || {})[dk];
  if (typeof v !== 'string' || !v.trim()) return null;
  try {
    return normalizeContentDigest(v);
  } catch {
    return null;
  }
}

/**
 * Нельзя одновременно задавать inline и Ref для одной секции.
 * @param {Record<string, unknown>} parts
 */
export function assertGraphDocumentNoDuplicateBlob(parts) {
  const p = parts || {};
  for (const k of GRAPH_DOCUMENT_BLOB_KEYS) {
    const refK = graphBlobRefKey(k);
    const hasRef = typeof p[refK] === 'string' && p[refK].length > 0;
    const hasInline = Object.prototype.hasOwnProperty.call(p, k) && p[k] !== undefined;
    if (hasRef && hasInline && p[k] !== null) {
      throw new Error(
        `cicada-project-graph: задайте либо «${k}», либо «${refK}», не оба`,
      );
    }
  }
}

/**
 * true если секция доступна как объект/array (inline), а не только как URI.
 * @param {Record<string, unknown>} doc
 * @param {string} blobKey
 */
export function graphDocumentSectionIsInline(doc, blobKey) {
  if (!BLOB_SET.has(blobKey)) return false;
  const d = doc || {};
  if (Object.prototype.hasOwnProperty.call(d, blobKey)) {
    return d[blobKey] !== undefined;
  }
  return false;
}

/**
 * @param {Record<string, unknown>} doc
 * @param {string} blobKey
 * @returns {string | null} URI или null
 */
export function graphDocumentSectionRefUri(doc, blobKey) {
  if (!BLOB_SET.has(blobKey)) return null;
  const rk = graphBlobRefKey(blobKey);
  const u = (doc || {})[rk];
  return typeof u === 'string' && u.length > 0 ? u : null;
}

/**
 * Перевод в reference mode: убирает inline-ключи, добавляет *Ref.
 *
 * @param {Record<string, unknown>} doc
 * @param {string[]} keysToRef — подмножество GRAPH_DOCUMENT_BLOB_KEYS
 * @param {(sectionKey: string, payload: unknown) => string} createRef — вернуть URI
 */
export function graphDocumentToReferenceMode(doc, keysToRef, createRef) {
  const out = { ...(doc || {}) };
  for (const k of keysToRef || []) {
    if (!BLOB_SET.has(k)) continue;
    const rk = graphBlobRefKey(k);
    if (typeof out[rk] === 'string' && out[rk]) continue;
    if (!Object.prototype.hasOwnProperty.call(out, k)) continue;
    const payload = out[k];
    if (payload === undefined || payload === null) {
      delete out[k];
      continue;
    }
    out[rk] = createRef(k, payload);
    delete out[k];
  }
  return out;
}

/**
 * Копия документа только с указанными blob-секциями (+ manifest, documentType, schemaVersion).
 * Для headless CLI / runtime: например ['ast'] или ['ir','ast'] без ui/debug/buildGraph.
 *
 * @param {Record<string, unknown>} doc
 * @param {string[]} includeBlobs — подмножество GRAPH_DOCUMENT_BLOB_KEYS
 * @param {{ blobManifest?: boolean }} [options] — если blobManifest !== false, переносит в срез только строки индекса для выбранных секций
 */
export function graphDocumentPickBlobs(doc, includeBlobs, options = {}) {
  const includeIdx = options.blobManifest !== false;
  const d = doc || {};
  const want = new Set(includeBlobs || []);
  /** @type {Record<string, unknown>} */
  const out = {
    documentType: d.documentType,
    schemaVersion: d.schemaVersion,
    manifest: d.manifest,
  };
  if (
    Object.prototype.hasOwnProperty.call(d, GRAPH_DOCUMENT_DEPENDENCY_GRAPH_KEY) &&
    d[GRAPH_DOCUMENT_DEPENDENCY_GRAPH_KEY] != null
  ) {
    out[GRAPH_DOCUMENT_DEPENDENCY_GRAPH_KEY] = normalizeChunkDependencyGraphV0(
      d[GRAPH_DOCUMENT_DEPENDENCY_GRAPH_KEY],
    );
  }
  for (const k of GRAPH_DOCUMENT_BLOB_KEYS) {
    if (!want.has(k)) continue;
    if (Object.prototype.hasOwnProperty.call(d, k)) out[k] = d[k];
    const rk = graphBlobRefKey(k);
    if (typeof d[rk] === 'string' && d[rk]) out[rk] = d[rk];
    const dk = graphBlobDigestKey(k);
    if (typeof d[dk] === 'string' && d[dk]) {
      try {
        out[dk] = normalizeContentDigest(d[dk]);
      } catch {
        out[dk] = d[dk];
      }
    }
  }
  if (includeIdx && d.blobs && typeof d.blobs === 'object' && !Array.isArray(d.blobs)) {
    /** @type {Record<string, unknown>} */
    const idx = {};
    for (const k of want) {
      const row = d.blobs[k];
      if (row) idx[k] = row;
    }
    if (Object.keys(idx).length > 0) {
      out.blobsVersion = typeof d.blobsVersion === 'number' ? d.blobsVersion : BLOB_MANIFEST_VERSION;
      out.blobs = idx;
    }
  }
  return out;
}

/**
 * Убирает перечисленные секции (inline, Ref и Digest).
 * Опционально: blobManifest — выкинуть строки индекса для удаляемых секций (по умолчанию true).
 * @param {Record<string, unknown>} doc
 * @param {string[]} omitBlobs
 * @param {{ blobManifest?: boolean }} [options]
 */
export function graphDocumentOmitBlobs(doc, omitBlobs, options) {
  const drop = new Set(omitBlobs || []);
  const include = GRAPH_DOCUMENT_BLOB_KEYS.filter((k) => !drop.has(k));
  return graphDocumentPickBlobs(doc, include, options);
}

/**
 * Считает *Digest для inline-секций (canonical JSON). Ref-only не трогает.
 *
 * @param {Record<string, unknown>} doc
 * @param {string[]} [blobKeys]
 * @param {(payload: unknown) => Promise<string>} [digestFn]
 */
export async function graphDocumentAttachDigestsAsync(doc, blobKeys, digestFn = contentDigestCanonicalJson) {
  const out = { ...(doc || {}) };
  const keys = blobKeys || [...GRAPH_DOCUMENT_BLOB_KEYS];
  for (const k of keys) {
    if (!BLOB_SET.has(k)) continue;
    const rk = graphBlobRefKey(k);
    if (typeof out[rk] === 'string' && out[rk]) continue;
    const payload = out[k];
    if (payload === undefined || payload === null) continue;
    const dk = graphBlobDigestKey(k);
    const raw = await digestFn(payload);
    out[dk] = normalizeContentDigest(raw);
  }
  return out;
}

/**
 * Проверяет дайджесты: для inline считает от тела; для Ref — подгружает fetchBlob.
 *
 * @param {Record<string, unknown>} doc
 * @param {{
 *   fetchBlob?: (uri: string, sectionKey: string) => Promise<unknown>,
 *   strict?: boolean,
 * }} [options]
 */
export async function graphDocumentVerifyDigestsAsync(doc, options = {}) {
  const { fetchBlob, strict = true } = options || {};
  /** @type {{ section: string, message: string }[]} */
  const errors = [];
  const d = doc || {};

  for (const k of GRAPH_DOCUMENT_BLOB_KEYS) {
    const dk = graphBlobDigestKey(k);
    const expected = d[dk];
    if (typeof expected !== 'string' || !expected.trim()) continue;

    let expectedNorm;
    try {
      expectedNorm = normalizeContentDigest(expected);
    } catch (e) {
      errors.push({ section: k, message: `неверный формат digest: ${e instanceof Error ? e.message : e}` });
      continue;
    }

    const rk = graphBlobRefKey(k);
    const hasRef = typeof d[rk] === 'string' && d[rk].length > 0;
    let payload = d[k];

    if ((payload === undefined || payload === null) && hasRef) {
      if (!fetchBlob) {
        if (strict) errors.push({ section: k, message: 'digest+Ref, но fetchBlob не передан' });
        continue;
      }
      try {
        payload = await fetchBlob(d[rk], k);
      } catch (e) {
        errors.push({
          section: k,
          message: `загрузка Ref: ${e instanceof Error ? e.message : String(e)}`,
        });
        continue;
      }
    }

    if (payload === undefined || payload === null) {
      if (strict) errors.push({ section: k, message: 'digest без inline/Ref payload' });
      continue;
    }

    const ok = await verifyContentDigestCanonicalJson(payload, expectedNorm);
    if (!ok) {
      errors.push({ section: k, message: 'digest mismatch (canonical JSON sha256)' });
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Подмена Ref на inline (sync). Не проверяет *Digest — см. graphDocumentVerifyDigestsAsync.
 *
 * @param {Record<string, unknown>} doc
 * @param {(uri: string, sectionKey: string) => unknown} fetchBlob
 */
export function graphDocumentResolveRefs(doc, fetchBlob) {
  const out = { ...(doc || {}) };
  for (const k of GRAPH_DOCUMENT_BLOB_KEYS) {
    const rk = graphBlobRefKey(k);
    const uri = out[rk];
    if (typeof uri !== 'string' || !uri) continue;
    out[k] = fetchBlob(uri, k);
    delete out[rk];
  }
  return out;
}

/**
 * @param {Record<string, unknown>} doc
 * @param {(uri: string, sectionKey: string) => Promise<unknown>} fetchBlob
 */
export async function graphDocumentResolveRefsAsync(doc, fetchBlob) {
  const out = { ...(doc || {}) };
  for (const k of GRAPH_DOCUMENT_BLOB_KEYS) {
    const rk = graphBlobRefKey(k);
    const uri = out[rk];
    if (typeof uri !== 'string' || !uri) continue;
    out[k] = await fetchBlob(uri, k);
    delete out[rk];
  }
  return out;
}

/**
 * Список секций, которые в документе сейчас в reference mode.
 * @param {Record<string, unknown>} doc
 * @returns {string[]}
 */
export function graphDocumentReferencedSections(doc) {
  const d = doc || {};
  const out = [];
  for (const k of GRAPH_DOCUMENT_BLOB_KEYS) {
    const uri = d[graphBlobRefKey(k)];
    if (typeof uri === 'string' && uri) out.push(k);
  }
  return out;
}

/**
 * Собирает топ-level graph document: inline и/или *Ref и/или *Digest на секцию.
 * @param {{
 *   schemaVersion?: number,
 *   manifest: Record<string, unknown>,
 *   ir?: unknown,
 *   irRef?: string,
 *   irDigest?: string,
 *   ast?: unknown,
 *   astRef?: string,
 *   astDigest?: string,
 *   buildGraph?: unknown,
 *   buildGraphRef?: string,
 *   buildGraphDigest?: string,
 *   ui?: unknown,
 *   uiRef?: string,
 *   uiDigest?: string,
 *   debug?: unknown,
 *   debugRef?: string,
 *   debugDigest?: string,
 *   cache?: unknown,
 *   cacheRef?: string,
 *   cacheDigest?: string,
 *   blobsVersion?: number,
 *   blobs?: Record<string, { digest: string, size: number, uri?: string, chunks?: unknown[] }>,
 *   dependencyGraph?: unknown,
 * }} parts
 */
export function buildProjectGraphDocument(parts) {
  assertGraphDocumentNoDuplicateBlob(parts);

  const {
    schemaVersion = PROJECT_GRAPH_DOCUMENT_SCHEMA_VERSION,
    manifest,
  } = parts || {};

  /** @param {string} k */
  const blobEntry = (k) => {
    const rk = graphBlobRefKey(k);
    const dk = graphBlobDigestKey(k);
    /** @type {Record<string, unknown>} */
    const o = {};
    const refVal = parts?.[rk];
    const hasRef = typeof refVal === 'string' && refVal.length > 0;
    if (hasRef) {
      o[rk] = refVal;
    } else if (Object.prototype.hasOwnProperty.call(parts || {}, k)) {
      o[k] = parts[k];
    } else {
      o[k] = null;
    }
    const dig = parts?.[dk];
    if (typeof dig === 'string' && dig.trim()) {
      try {
        o[dk] = normalizeContentDigest(dig.trim());
      } catch {
        o[dk] = dig.trim();
      }
    }
    return o;
  };

  /** @type {Record<string, unknown>} */
  const out = {
    documentType: PROJECT_GRAPH_DOCUMENT_TYPE,
    schemaVersion,
    manifest,
    ...blobEntry('ir'),
    ...blobEntry('ast'),
    ...blobEntry('buildGraph'),
    ...blobEntry('ui'),
    ...blobEntry('debug'),
    ...blobEntry('cache'),
  };

  if (parts?.blobs != null && typeof parts.blobs === 'object' && !Array.isArray(parts.blobs)) {
    const bv =
      typeof parts.blobsVersion === 'number' ? parts.blobsVersion : BLOB_MANIFEST_VERSION;
    const nm = normalizeBlobManifest(parts.blobs, bv);
    out.blobsVersion = nm.blobsVersion;
    out.blobs = nm.blobs;
  }

  if (
    parts &&
    Object.prototype.hasOwnProperty.call(parts, GRAPH_DOCUMENT_DEPENDENCY_GRAPH_KEY) &&
    parts[GRAPH_DOCUMENT_DEPENDENCY_GRAPH_KEY] != null
  ) {
    out[GRAPH_DOCUMENT_DEPENDENCY_GRAPH_KEY] = normalizeChunkDependencyGraphV0(
      parts[GRAPH_DOCUMENT_DEPENDENCY_GRAPH_KEY],
    );
  }

  return out;
}
