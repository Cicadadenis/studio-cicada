/**
 * Детерминированный отпечаток контекста валидации: вход DSL + ревизия грамматики + capabilities
 * + версии семантических правил и протоколов — для кэша, CI, распределённых воркеров, воспроизводимого AI repair.
 *
 * Алгоритм: `stableStringify` канонического объекта → FNV-1a 64-bit (синхронно, без WebCrypto).
 * При необходимости криптохэша оборачивайте `inputs` в SHA-256 на стороне сервера.
 */

import { stableStringify, fnv1a64HexUtf8 } from '../manifests/hashes.js';
import { UNIFIED_DIAGNOSTIC_PROTOCOL_VERSION } from './unifiedDiagnosticV1.js';
import { CHUNK_DEPENDENCY_GRAPH_SCHEMA_VERSION } from '../manifests/chunkDependencyGraph.js';
import { CHUNK_INVALIDATION_PROTOCOL_VERSION } from '../manifests/chunkInvalidation.js';

/** Версия схемы отпечатка (меняется при изменении состава полей). */
export const VALIDATION_PIPELINE_FINGERPRINT_VERSION = 1;

/** Ревизия набора семантических правил в `semanticValidateFlow.js` (bump при изменении правил). */
export const SEMANTIC_RULES_VERSION = 1;

/** Значение по умолчанию, пока не вынесена версия из vendored parser. */
export const DEFAULT_GRAMMAR_REVISION = 'cicada-dsl-parser@vendor:1';

/** Версия оркестрации серверного AI-pipeline (`services/aiDslPipeline.mjs`). */
export const VALIDATION_ORCHESTRATION_VERSION = 1;

const DEFAULT_CAPS_SENTINEL = '__DEFAULT_STUDIO_ALLOWLIST__';

/**
 * @param {{
 *   dslText: string,
 *   grammarRevision?: string,
 *   runtimeSupportedFeatures?: Iterable<string> | null,
 *   semanticRulesVersion?: number,
 *   dependencyGraphSchemaVersion?: number | null,
 *   invalidationProtocolVersion?: number | null,
 * }} parts
 */
export function computeValidationPipelineFingerprintV1(parts) {
  const dslText = String(parts.dslText ?? '');
  const grammarRevision = String(parts.grammarRevision ?? DEFAULT_GRAMMAR_REVISION);
  const semanticRulesVersion =
    typeof parts.semanticRulesVersion === 'number' && Number.isFinite(parts.semanticRulesVersion)
      ? parts.semanticRulesVersion
      : SEMANTIC_RULES_VERSION;

  let capabilitiesKey;
  if (parts.runtimeSupportedFeatures != null) {
    capabilitiesKey = [...new Set([...parts.runtimeSupportedFeatures])].sort();
  } else {
    capabilitiesKey = DEFAULT_CAPS_SENTINEL;
  }

  const dependencyGraphSchemaVersion =
    parts.dependencyGraphSchemaVersion != null
      ? Number(parts.dependencyGraphSchemaVersion)
      : CHUNK_DEPENDENCY_GRAPH_SCHEMA_VERSION;

  const invalidationProtocolVersion =
    parts.invalidationProtocolVersion != null
      ? Number(parts.invalidationProtocolVersion)
      : CHUNK_INVALIDATION_PROTOCOL_VERSION;

  /** @type {Record<string, unknown>} */
  const inputs = {
    fingerprintSchema: VALIDATION_PIPELINE_FINGERPRINT_VERSION,
    orchestrationVersion: VALIDATION_ORCHESTRATION_VERSION,
    unifiedDiagnosticProtocol: UNIFIED_DIAGNOSTIC_PROTOCOL_VERSION,
    grammarRevision,
    dslInputDigest: fnv1a64HexUtf8(dslText),
    capabilitiesKey,
    semanticRulesVersion,
    dependencyGraphSchemaVersion,
    invalidationProtocolVersion,
  };

  const canonical = stableStringify(inputs);
  const digestHex = fnv1a64HexUtf8(canonical);

  return {
    fingerprintVersion: VALIDATION_PIPELINE_FINGERPRINT_VERSION,
    algorithm: 'fnv1a64-stableStringify-v1',
    digest: `fnv1a64:${digestHex}`,
    canonical,
    inputs,
  };
}
