/**
 * Полный контур проверки DSL, сгенерированного ИИ: извлечение → parser.py → семантика IR → capabilities
 * → опционально dependencyGraph / invalidation → project graph document → dry-run политика.
 *
 * Диагностики: единый контракт v1 (`core/diagnostics`). Отпечаток валидации: `fingerprint` на результате.
 */

import { parseCCDToFlow } from '../src/ccdParser.js';
import { extractDslFromAiText } from '../core/ai/extractDsl.js';
import { CICADA_STUDIO_FULL_FEATURE_ALLOWLIST } from '../core/ai/cicadaFeatureAllowlist.js';
import { mapPythonLintDiagnosticsToStructured } from '../core/ai/syntaxDiagnostics.js';
import { semanticValidateFlow } from '../core/ai/semanticValidateFlow.js';
import { dryRunFlowPolicy } from '../core/ai/dryRunFlow.js';
import { lintCicadaWithPython } from './pythonDslLint.mjs';
import {
  buildProjectGraphDocumentFromFlow,
  inferRequiredFeaturesFromFlow,
} from '../core/dslCodegen.js';
import { planSemanticInvalidationV0 } from '../core/manifests/chunkInvalidation.js';
import {
  computeValidationPipelineFingerprintV1,
  diagnosticV1FromExtraction,
  diagnosticV1FromStructuredSyntax,
  diagnosticV1FromSemanticError,
  diagnosticV1FromSemanticWarning,
  diagnosticV1FromUnsupportedFeatures,
  diagnosticV1FromDryRunBlocked,
  diagnosticV1FromDryRunWarning,
  diagnosticV1FromInvalidation,
  diagnosticV1FromGraphBuild,
  diagnosticV1FromParserUnavailable,
  primaryErrorDiagnosticV1,
} from '../core/diagnostics/index.js';
import { VALIDATION_ORCHESTRATION_VERSION } from '../core/diagnostics/pipelineFingerprintV1.js';

export const AI_DSL_PIPELINE_VERSION = VALIDATION_ORCHESTRATION_VERSION;

/** @param {import('../core/diagnostics/unifiedDiagnosticV1.js').UnifiedDiagnosticV1[]} diagnostics */
function attachRepair(out, diagnostics) {
  const p = primaryErrorDiagnosticV1(diagnostics);
  out.repair = p
    ? {
        stage: p.phase,
        error: { type: p.code, message: p.message, range: p.range },
        diagnostic: p,
      }
    : undefined;
}

/**
 * @param {{
 *   rawAiText: string,
 *   cwd?: string,
 *   grammarRevision?: string,
 *   extract?: { prefer?: 'first' | 'longest' },
 *   runtimeSupportedFeatures?: Iterable<string> | null,
 *   skipCapabilities?: boolean,
 *   skipSemantic?: boolean,
 *   dependencyGraph?: unknown,
 *   dirtyChunkKeys?: string[],
 *   skipInvalidation?: boolean,
 *   skipProjectGraph?: boolean,
 *   projectGraphOptions?: Record<string, unknown>,
 *   dryRunPolicy?: Record<string, unknown>,
 *   syntaxTimeoutMs?: number,
 *   skipDryRun?: boolean,
 * }} opts
 */
export function runAiDslValidationPipeline(opts) {
  const rawAiText = String(opts.rawAiText ?? '');
  const cwd = opts.cwd ?? process.cwd();

  /** @type {import('../core/diagnostics/unifiedDiagnosticV1.js').UnifiedDiagnosticV1[]} */
  const diagnostics = [];

  /** @type {{
   *   pipelineVersion: number,
   *   ok: boolean,
   *   stages: Record<string, unknown>,
   *   diagnostics: typeof diagnostics,
   *   fingerprint?: unknown,
   *   repair?: unknown,
   *   projectGraph?: unknown,
   * }} */
  const out = {
    pipelineVersion: AI_DSL_PIPELINE_VERSION,
    ok: false,
    stages: {},
    diagnostics,
    repair: undefined,
    projectGraph: undefined,
    fingerprint: undefined,
  };

  const extraction = extractDslFromAiText(rawAiText, opts.extract || {});
  out.stages.extraction = {
    ok: Boolean(extraction.dsl && extraction.dsl.trim()),
    dslLength: extraction.dsl.length,
    meta: extraction.meta,
  };
  if (!out.stages.extraction.ok) {
    diagnostics.push(diagnosticV1FromExtraction('Пустой DSL после извлечения из ответа ИИ'));
    attachRepair(out, diagnostics);
    return out;
  }

  out.fingerprint = computeValidationPipelineFingerprintV1({
    dslText: extraction.dsl,
    grammarRevision: opts.grammarRevision,
    runtimeSupportedFeatures:
      opts.runtimeSupportedFeatures != null ? opts.runtimeSupportedFeatures : null,
  });

  const syntaxRaw = lintCicadaWithPython({ code: extraction.dsl, cwd, timeoutMs: opts.syntaxTimeoutMs });
  const structuredSyntax = mapPythonLintDiagnosticsToStructured(syntaxRaw.diagnostics || []);
  out.stages.syntax = {
    ok: Boolean(syntaxRaw.available && syntaxRaw.ok && !(syntaxRaw.diagnostics || []).length),
    available: Boolean(syntaxRaw.available),
    lint: {
      ok: syntaxRaw.ok,
      error: syntaxRaw.error || null,
      diagnosticsStructured: structuredSyntax,
    },
  };

  if (!syntaxRaw.available) {
    diagnostics.push(
      diagnosticV1FromParserUnavailable(
        syntaxRaw.error || 'Python parser недоступен (lint_cicada.py)',
      ),
    );
    attachRepair(out, diagnostics);
    return out;
  }
  if (!syntaxRaw.ok || (syntaxRaw.diagnostics || []).length) {
    for (const s of structuredSyntax) {
      diagnostics.push(diagnosticV1FromStructuredSyntax(/** @type {Record<string, unknown>} */ (s)));
    }
    if (!diagnostics.length && syntaxRaw.error) {
      diagnostics.push(
        diagnosticV1FromStructuredSyntax({
          type: 'SyntaxError',
          message: syntaxRaw.error,
          line: null,
          severity: 'error',
        }),
      );
    }
    attachRepair(out, diagnostics);
    return out;
  }

  const flow = parseCCDToFlow(extraction.dsl, [], {});
  out.stages.flow = { ok: true, nodeCount: (flow.nodes || []).length, edgeCount: (flow.edges || []).length };

  if (!opts.skipSemantic) {
    const sem = semanticValidateFlow(flow);
    out.stages.semantic = {
      ok: sem.ok,
      errors: sem.errors,
      warnings: sem.warnings,
    };
    for (const w of sem.warnings) {
      diagnostics.push(diagnosticV1FromSemanticWarning(w));
    }
    for (const e of sem.errors) {
      diagnostics.push(diagnosticV1FromSemanticError(e));
    }
    if (!sem.ok) {
      attachRepair(out, diagnostics);
      return out;
    }
  } else {
    out.stages.semantic = { skipped: true };
  }

  const required = inferRequiredFeaturesFromFlow(flow);
  out.stages.requiredFeatures = required;

  let capabilityOk = true;
  /** @type {string[]} */
  let missingCaps = [];
  if (!opts.skipCapabilities) {
    const allow =
      opts.runtimeSupportedFeatures != null
        ? new Set(opts.runtimeSupportedFeatures)
        : CICADA_STUDIO_FULL_FEATURE_ALLOWLIST;
    missingCaps = required.filter((f) => !allow.has(f));
    capabilityOk = missingCaps.length === 0;
  }
  out.stages.capabilities = {
    ok: capabilityOk,
    missing: missingCaps,
    skipped: Boolean(opts.skipCapabilities),
  };
  if (!capabilityOk) {
    diagnostics.push(diagnosticV1FromUnsupportedFeatures(missingCaps));
    attachRepair(out, diagnostics);
    return out;
  }

  if (opts.dependencyGraph != null && !opts.skipInvalidation && opts.dirtyChunkKeys?.length) {
    try {
      out.stages.invalidation = planSemanticInvalidationV0(opts.dirtyChunkKeys, opts.dependencyGraph, {
        includeSeedsInRecomputeSet: true,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.stages.invalidation = { error: msg };
      diagnostics.push(diagnosticV1FromInvalidation(msg));
      attachRepair(out, diagnostics);
      return out;
    }
  } else {
    out.stages.invalidation = { skipped: true };
  }

  if (!opts.skipProjectGraph) {
    try {
      /** @type {Record<string, unknown>} */
      const pgo = { ...(opts.projectGraphOptions || {}) };
      if (opts.dependencyGraph != null) pgo.dependencyGraph = opts.dependencyGraph;
      out.projectGraph = buildProjectGraphDocumentFromFlow(flow, pgo);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      diagnostics.push(diagnosticV1FromGraphBuild(msg));
      attachRepair(out, diagnostics);
      return out;
    }
  }

  if (!opts.skipDryRun) {
    const dry = dryRunFlowPolicy(flow, opts.dryRunPolicy || {});
    out.stages.dryRun = dry;
    for (const w of dry.warnings || []) {
      diagnostics.push(diagnosticV1FromDryRunWarning(w));
    }
    if (!dry.ok) {
      for (const b of dry.blocked || []) {
        diagnostics.push(diagnosticV1FromDryRunBlocked(b));
      }
      attachRepair(out, diagnostics);
      return out;
    }
  } else {
    out.stages.dryRun = { skipped: true };
  }

  out.ok = true;
  return out;
}

/**
 * Объект для AI repair: предпочтительно unified diagnostic v1.
 * @param {ReturnType<typeof runAiDslValidationPipeline>} result
 */
export function getAiRepairPayload(result) {
  if (result.repair?.diagnostic) return result.repair.diagnostic;
  return result.repair || null;
}

export { validationArtifactManifestFromPipelineResult } from '../core/diagnostics/validationArtifactManifestV1.js';
