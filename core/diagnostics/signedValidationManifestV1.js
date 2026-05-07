/**
 * Подписанный манифест валидации v1 — доверенный контур (облако, marketplace, CI attestation).
 * Здесь только **контракт полей** и каноническая строка для подписи; проверка Ed25519/RS256 — у вызывающей стороны.
 */

import { stableStringify } from '../manifests/hashes.js';
import {
  normalizeValidationArtifactManifestV1,
} from './validationArtifactManifestV1.js';

export const SIGNED_VALIDATION_MANIFEST_PROTOCOL_VERSION = 1;

/** Согласованные идентификаторы алгоритмов подписи (расширяйте по мере внедрения). */
export const VALIDATION_SIGNATURE_ALGORITHM = Object.freeze({
  /** Подпись отсутствует (dev / внутренние тесты). */
  NONE: 'none',
  /** Ed25519 над UTF-8 байтами signing payload (рекомендуется для новых интеграций). */
  ED25519_V1: 'ed25519-v1',
  RS256: 'RS256',
});

/** Поля артефакта в фиксированном порядке для signing payload (без расширяемых блоков). */
const ARTIFACT_SIGNING_FIELD_ORDER = [
  'manifestVersion',
  'diagnosticProtocolVersion',
  'fingerprintSchemaVersion',
  'pipelineVersion',
  'ok',
  'fingerprint',
  'diagnostics',
  'repair',
  'generatedAt',
];

/**
 * @typedef {{
 *   signingProtocolVersion: number,
 *   signature: string,
 *   signatureAlgorithm: string,
 *   validatorIdentity: string,
 *   validatedAt: string,
 *   keyId?: string,
 *   contentDigest?: string,
 *   artifact: import('./validationArtifactManifestV1.js').ValidationArtifactManifestV1,
 * }} SignedValidationManifestV1
 */

/**
 * Каноническая UTF-8 строка для подписи / contentDigest (без `fingerprintDetails`).
 * @param {import('./validationArtifactManifestV1.js').ValidationArtifactManifestV1} artifactManifest
 */
export function validationArtifactSigningPayloadV1(artifactManifest) {
  const m = normalizeValidationArtifactManifestV1(artifactManifest);
  /** @type {Record<string, unknown>} */
  const pick = {};
  for (const k of ARTIFACT_SIGNING_FIELD_ORDER) {
    if (Object.prototype.hasOwnProperty.call(m, k)) {
      pick[k] = /** @type {Record<string, unknown>} */ (m)[k];
    }
  }
  return stableStringify(pick);
}

/**
 * @param {{
 *   artifact: import('./validationArtifactManifestV1.js').ValidationArtifactManifestV1,
 *   signature: string,
 *   signatureAlgorithm: string,
 *   validatorIdentity: string,
 *   validatedAt: string,
 *   keyId?: string,
 *   contentDigest?: string,
 * }} parts
 * @returns {SignedValidationManifestV1}
 */
export function buildSignedValidationManifestV1(parts) {
  const artifact = normalizeValidationArtifactManifestV1(parts.artifact);
  const signature = String(parts.signature ?? '');
  const signatureAlgorithm = String(parts.signatureAlgorithm || VALIDATION_SIGNATURE_ALGORITHM.NONE);
  const validatorIdentity = String(parts.validatorIdentity ?? '').trim();
  if (!validatorIdentity) {
    throw new Error('signedValidationManifest: validatorIdentity обязателен');
  }
  const validatedAt = String(parts.validatedAt ?? '');
  if (!validatedAt) {
    throw new Error('signedValidationManifest: validatedAt обязателен (ISO-8601)');
  }
  /** @type {SignedValidationManifestV1} */
  const out = {
    signingProtocolVersion: SIGNED_VALIDATION_MANIFEST_PROTOCOL_VERSION,
    signature: signatureAlgorithm === VALIDATION_SIGNATURE_ALGORITHM.NONE ? '' : signature,
    signatureAlgorithm,
    validatorIdentity,
    validatedAt,
    artifact,
  };
  if (typeof parts.keyId === 'string' && parts.keyId) out.keyId = parts.keyId;
  if (typeof parts.contentDigest === 'string' && parts.contentDigest.trim()) {
    out.contentDigest = parts.contentDigest.trim();
  }
  return out;
}

/**
 * @param {unknown} raw
 * @returns {SignedValidationManifestV1}
 */
export function normalizeSignedValidationManifestV1(raw) {
  if (raw == null || typeof raw !== 'object') throw new Error('signedValidationManifest: ожидался объект');
  const r = /** @type {Record<string, unknown>} */ (raw);
  const sp = Number(r.signingProtocolVersion);
  if (sp !== SIGNED_VALIDATION_MANIFEST_PROTOCOL_VERSION) {
    throw new Error(`signedValidationManifest: неподдерживаемый signingProtocolVersion ${r.signingProtocolVersion}`);
  }
  if (r.artifact == null || typeof r.artifact !== 'object') {
    throw new Error('signedValidationManifest: поле artifact обязательно');
  }
  return buildSignedValidationManifestV1({
    artifact: /** @type {import('./validationArtifactManifestV1.js').ValidationArtifactManifestV1} */ (
      r.artifact
    ),
    signature: String(r.signature ?? ''),
    signatureAlgorithm: String(r.signatureAlgorithm ?? VALIDATION_SIGNATURE_ALGORITHM.NONE),
    validatorIdentity: String(r.validatorIdentity ?? ''),
    validatedAt: String(r.validatedAt ?? ''),
    keyId: typeof r.keyId === 'string' ? r.keyId : undefined,
    contentDigest: typeof r.contentDigest === 'string' ? r.contentDigest : undefined,
  });
}
