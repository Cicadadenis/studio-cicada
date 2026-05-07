/**
 * Протокол записи в кэше валидации v1: стабильная identity по fingerprint + ссылка на полный артефакт в CAS.
 * Дедупликация, распределённые worker’ы, повторное использование результатов.
 *
 * `artifactRef` — URI контента (например `cache://validation/...`); сам стор вне этого контракта.
 */

import { casUriFromContentDigest, normalizeContentDigest } from '../manifests/blobIntegrity.js';
import { stableStringify } from '../manifests/hashes.js';

export const VALIDATION_CACHE_ENTRY_VERSION = 1;

export const VALIDATION_CACHE_STATUS = Object.freeze({
  OK: 'ok',
  ERROR: 'error',
});

/**
 * @typedef {{
 *   cacheEntryVersion: number,
 *   fingerprint: string,
 *   artifactRef: string,
 *   status: 'ok' | 'error',
 *   artifactDigest?: string,
 *   recordedAt?: string,
 * }} ValidationCacheEntryV1
 */

/**
 * @param {{
 *   fingerprint: string,
 *   artifactRef: string,
 *   status: 'ok' | 'error',
 *   artifactDigest?: string | null,
 *   recordedAt?: string,
 * }} parts
 * @returns {ValidationCacheEntryV1}
 */
export function buildValidationCacheEntryV1(parts) {
  const fingerprint = String(parts.fingerprint || '').trim();
  if (!fingerprint) throw new Error('validationCacheEntry: fingerprint обязателен');
  const artifactRef = String(parts.artifactRef || '').trim();
  if (!artifactRef) throw new Error('validationCacheEntry: artifactRef обязателен');
  const status = String(parts.status || '');
  if (status !== 'ok' && status !== 'error') {
    throw new Error('validationCacheEntry: status должен быть ok или error');
  }
  /** @type {ValidationCacheEntryV1} */
  const out = {
    cacheEntryVersion: VALIDATION_CACHE_ENTRY_VERSION,
    fingerprint,
    artifactRef,
    status: /** @type {'ok' | 'error'} */ (status),
  };
  if (parts.artifactDigest != null && String(parts.artifactDigest).trim()) {
    try {
      out.artifactDigest = normalizeContentDigest(String(parts.artifactDigest).trim());
    } catch {
      out.artifactDigest = String(parts.artifactDigest).trim();
    }
  }
  if (typeof parts.recordedAt === 'string' && parts.recordedAt) {
    out.recordedAt = parts.recordedAt;
  }
  return out;
}

/**
 * @param {unknown} raw
 * @returns {ValidationCacheEntryV1}
 */
export function normalizeValidationCacheEntryV1(raw) {
  if (raw == null || typeof raw !== 'object') throw new Error('validationCacheEntry: ожидался объект');
  const r = /** @type {Record<string, unknown>} */ (raw);
  const v = Number(r.cacheEntryVersion);
  if (v !== VALIDATION_CACHE_ENTRY_VERSION) {
    throw new Error(`validationCacheEntry: неподдерживаемый cacheEntryVersion ${r.cacheEntryVersion}`);
  }
  return buildValidationCacheEntryV1({
    fingerprint: String(r.fingerprint ?? ''),
    artifactRef: String(r.artifactRef ?? ''),
    status: String(r.status ?? ''),
    artifactDigest: r.artifactDigest != null ? String(r.artifactDigest) : null,
    recordedAt: typeof r.recordedAt === 'string' ? r.recordedAt : undefined,
  });
}

/**
 * CAS URI из digest содержимого сериализованного артефакта (после canonical JSON UTF-8 в сторе).
 * @param {string} contentDigest sha256:…
 */
export function validationCacheArtifactRefFromDigest(contentDigest) {
  return casUriFromContentDigest(contentDigest);
}

/**
 * Ключ для индекса кэша: только fingerprint + status (детерминированно).
 * @param {string} fingerprint
 * @param {'ok' | 'error'} status
 */
export function validationCacheLogicalKeyV1(fingerprint, status) {
  return stableStringify({ fingerprint, status });
}

/**
 * Запись кэша из манифеста артефакта + URI, где лежит сериализованный JSON артефакта.
 * @param {import('./validationArtifactManifestV1.js').ValidationArtifactManifestV1} artifactManifest
 * @param {string} artifactRef
 * @param {{ artifactDigest?: string, recordedAt?: string }} [options]
 */
export function validationCacheEntryV1FromArtifactRef(artifactManifest, artifactRef, options = {}) {
  const m = normalizeValidationArtifactManifestV1(artifactManifest);
  const fp = m.fingerprint;
  if (!fp || !String(fp).trim()) {
    throw new Error('validationCacheEntry: у манифеста нет fingerprint — кэш-ключ нельзя построить');
  }
  return buildValidationCacheEntryV1({
    fingerprint: String(fp),
    artifactRef: String(artifactRef || '').trim(),
    status: m.ok ? 'ok' : 'error',
    artifactDigest: options.artifactDigest ?? null,
    recordedAt: options.recordedAt,
  });
}
