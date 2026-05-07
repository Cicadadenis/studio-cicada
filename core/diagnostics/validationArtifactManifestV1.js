/**
 * Переносимый воспроизводимый артефакт результата валидации (manifest v1).
 * Кэш удалённой валидации, воркеры, replay AI-retry, CI-хранилище, распределённый дебаг.
 *
 * Не дублирует project graph / DSL-тело: только метаданные валидации + unified diagnostics + repair.
 */

import { UNIFIED_DIAGNOSTIC_PROTOCOL_VERSION, normalizeUnifiedDiagnosticV1 } from './unifiedDiagnosticV1.js';
import { VALIDATION_PIPELINE_FINGERPRINT_VERSION } from './pipelineFingerprintV1.js';

/** Версия схемы манифеста артефакта (не путать с orchestration / fingerprint schema). */
export const VALIDATION_ARTIFACT_MANIFEST_VERSION = 1;

/**
 * @typedef {{
 *   manifestVersion: number,
 *   diagnosticProtocolVersion: number,
 *   fingerprintSchemaVersion: number,
 *   pipelineVersion: number,
 *   ok: boolean,
 *   fingerprint: string | null,
 *   fingerprintDetails?: ReturnType<import('./pipelineFingerprintV1.js').computeValidationPipelineFingerprintV1> | null,
 *   diagnostics: import('./unifiedDiagnosticV1.js').UnifiedDiagnosticV1[],
 *   repair: Record<string, unknown> | null,
 *   generatedAt: string,
 * }} ValidationArtifactManifestV1
 */

/**
 * @param {{
 *   ok: boolean,
 *   pipelineVersion: number,
 *   fingerprintDigest: string | null,
 *   fingerprintDetails?: ReturnType<import('./pipelineFingerprintV1.js').computeValidationPipelineFingerprintV1> | null,
 *   diagnostics: import('./unifiedDiagnosticV1.js').UnifiedDiagnosticV1[],
 *   repair: Record<string, unknown> | null | undefined,
 *   generatedAt: string,
 * }} parts
 */
export function buildValidationArtifactManifestV1(parts) {
  const diagnostics = (parts.diagnostics || []).map((d) => normalizeUnifiedDiagnosticV1(d));
  /** @type {ValidationArtifactManifestV1} */
  const out = {
    manifestVersion: VALIDATION_ARTIFACT_MANIFEST_VERSION,
    diagnosticProtocolVersion: UNIFIED_DIAGNOSTIC_PROTOCOL_VERSION,
    fingerprintSchemaVersion: VALIDATION_PIPELINE_FINGERPRINT_VERSION,
    pipelineVersion: Number(parts.pipelineVersion),
    ok: Boolean(parts.ok),
    fingerprint: parts.fingerprintDigest != null ? String(parts.fingerprintDigest) : null,
    diagnostics,
    repair: parts.repair != null && typeof parts.repair === 'object' ? { ...parts.repair } : null,
    generatedAt: String(parts.generatedAt || ''),
  };
  if (!out.generatedAt) {
    throw new Error('validationArtifactManifest: generatedAt обязателен (ISO-8601)');
  }
  if (parts.fingerprintDetails != null && typeof parts.fingerprintDetails === 'object') {
    out.fingerprintDetails = parts.fingerprintDetails;
  }
  return out;
}

/**
 * Нормализация входящего JSON (воркеры, CI).
 * @param {unknown} raw
 * @returns {ValidationArtifactManifestV1}
 */
export function normalizeValidationArtifactManifestV1(raw) {
  if (raw == null || typeof raw !== 'object') {
    throw new Error('validationArtifactManifest: ожидался объект');
  }
  const r = /** @type {Record<string, unknown>} */ (raw);
  const mv = Number(r.manifestVersion);
  if (mv !== VALIDATION_ARTIFACT_MANIFEST_VERSION) {
    throw new Error(`validationArtifactManifest: неподдерживаемый manifestVersion ${r.manifestVersion}`);
  }
  const diags = Array.isArray(r.diagnostics) ? r.diagnostics : [];
  return buildValidationArtifactManifestV1({
    ok: Boolean(r.ok),
    pipelineVersion: Number(r.pipelineVersion),
    fingerprintDigest: r.fingerprint != null ? String(r.fingerprint) : null,
    fingerprintDetails:
      r.fingerprintDetails != null && typeof r.fingerprintDetails === 'object'
        ? /** @type {ValidationArtifactManifestV1['fingerprintDetails']} */ (r.fingerprintDetails)
        : null,
    diagnostics: diags.map((d) => normalizeUnifiedDiagnosticV1(d)),
    repair: r.repair != null && typeof r.repair === 'object' ? /** @type {Record<string, unknown>} */ (r.repair) : null,
    generatedAt: String(r.generatedAt || ''),
  });
}

/**
 * Сборка манифеста из `runAiDslValidationPipeline` (services/aiDslPipeline.mjs).
 * @param {{
 *   ok: boolean,
 *   pipelineVersion: number,
 *   diagnostics?: unknown[],
 *   repair?: unknown,
 *   fingerprint?: { digest?: string } | null,
 * }} result
 * @param {{ generatedAt?: string, includeFingerprintDetails?: boolean }} [options]
 */
export function validationArtifactManifestFromPipelineResult(result, options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const fp = result.fingerprint && typeof result.fingerprint === 'object' ? result.fingerprint : null;
  const digest = fp && typeof fp.digest === 'string' ? fp.digest : null;
  return buildValidationArtifactManifestV1({
    ok: result.ok,
    pipelineVersion: result.pipelineVersion,
    fingerprintDigest: digest,
    fingerprintDetails: options.includeFingerprintDetails === true && fp ? fp : null,
    diagnostics: /** @type {import('./unifiedDiagnosticV1.js').UnifiedDiagnosticV1[]} */ (
      result.diagnostics || []
    ),
    repair: result.repair != null && typeof result.repair === 'object' ? result.repair : null,
    generatedAt,
  });
}
