/**
 * Единый контракт диагностик v1 для Studio, AI repair, CLI, cloud validation, будущего LSP.
 * Источники: parser.py, семантика IR, capabilities, dry-run, invalidation, project graph.
 */

export const UNIFIED_DIAGNOSTIC_PROTOCOL_VERSION = 1;

/** Фазы пайплайна (не смешивать с `kind` рёбер dependency graph). */
export const DIAGNOSTIC_PHASE = Object.freeze({
  EXTRACTION: 'extraction',
  SYNTAX: 'syntax',
  SEMANTIC: 'semantic',
  CAPABILITIES: 'capabilities',
  DRY_RUN: 'dry_run',
  INVALIDATION: 'invalidation',
  PROJECT_GRAPH: 'project_graph',
  INTERNAL: 'internal',
});

/** Частые коды (расширяйте по мере появления правил). */
export const DIAGNOSTIC_CODE = Object.freeze({
  EMPTY_DSL: 'EMPTY_DSL',
  PARSER_UNAVAILABLE: 'PARSER_UNAVAILABLE',
  PARSER_FAILURE: 'PARSER_FAILURE',
  SYNTAX_ERROR: 'SYNTAX_ERROR',
  SEMANTIC_FLOW: 'SEMANTIC_FLOW',
  SEMANTIC_NODE: 'SEMANTIC_NODE',
  SEMANTIC_WARNING: 'SEMANTIC_WARNING',
  UNSUPPORTED_FEATURE: 'UNSUPPORTED_FEATURE',
  INVALIDATION: 'INVALIDATION',
  GRAPH_BUILD: 'GRAPH_BUILD',
  DRY_RUN_BLOCKED: 'DRY_RUN_BLOCKED',
  DRY_RUN_WARNING: 'DRY_RUN_WARNING',
  INTERNAL: 'INTERNAL',
});

/**
 * @typedef {{
 *   protocolVersion: number,
 *   severity: 'error' | 'warning' | 'info',
 *   phase: string,
 *   code: string,
 *   message: string,
 *   range?: { line?: number | null, column?: number | null, endLine?: number | null, endColumn?: number | null },
 *   nodeId?: string,
 *   repair?: Record<string, unknown> | null,
 *   details?: Record<string, unknown>,
 * }} UnifiedDiagnosticV1
 */

const SEVERITIES = new Set(['error', 'warning', 'info']);
const PHASES = new Set(Object.values(DIAGNOSTIC_PHASE));

/**
 * @param {unknown} raw
 * @returns {UnifiedDiagnosticV1}
 */
export function normalizeUnifiedDiagnosticV1(raw) {
  if (raw == null || typeof raw !== 'object') {
    throw new Error('unifiedDiagnostic: ожидался объект');
  }
  const r = /** @type {Record<string, unknown>} */ (raw);
  const severity = String(r.severity || 'error');
  if (!SEVERITIES.has(severity)) {
    throw new Error(`unifiedDiagnostic: неверный severity: ${severity}`);
  }
  const phase = String(r.phase || '');
  if (!PHASES.has(phase)) {
    throw new Error(`unifiedDiagnostic: неизвестная phase: ${phase}`);
  }
  const code = String(r.code || 'DIAGNOSTIC');
  const message = String(r.message || '');
  if (!message) {
    throw new Error('unifiedDiagnostic: message обязателен');
  }
  /** @type {UnifiedDiagnosticV1} */
  const out = {
    protocolVersion: UNIFIED_DIAGNOSTIC_PROTOCOL_VERSION,
    severity: /** @type {'error' | 'warning' | 'info'} */ (severity),
    phase,
    code,
    message,
  };
  if (r.range != null && typeof r.range === 'object') {
    const rg = /** @type {Record<string, unknown>} */ (r.range);
    /** @type {NonNullable<UnifiedDiagnosticV1['range']>} */
    const range = {};
    if (rg.line != null && Number.isFinite(Number(rg.line))) range.line = Number(rg.line);
    if (rg.column != null && Number.isFinite(Number(rg.column))) range.column = Number(rg.column);
    if (rg.endLine != null && Number.isFinite(Number(rg.endLine))) range.endLine = Number(rg.endLine);
    if (rg.endColumn != null && Number.isFinite(Number(rg.endColumn))) range.endColumn = Number(rg.endColumn);
    if (Object.keys(range).length) out.range = range;
  }
  if (typeof r.nodeId === 'string' && r.nodeId) out.nodeId = r.nodeId;
  if (r.repair != null && typeof r.repair === 'object' && !Array.isArray(r.repair)) {
    out.repair = /** @type {Record<string, unknown>} */ ({ ...r.repair });
  }
  if (r.details != null && typeof r.details === 'object' && !Array.isArray(r.details)) {
    out.details = /** @type {Record<string, unknown>} */ ({ ...r.details });
  }
  return out;
}

/** @param {string} msg */
export function diagnosticV1FromSemanticWarning(msg) {
  return normalizeUnifiedDiagnosticV1({
    severity: 'warning',
    phase: DIAGNOSTIC_PHASE.SEMANTIC,
    code: DIAGNOSTIC_CODE.SEMANTIC_WARNING,
    message: String(msg),
    repair: { action: 'review_flow_graph' },
  });
}

/**
 * @param {Record<string, unknown>} s — элемент после mapPythonLintDiagnosticToStructured
 */
export function diagnosticV1FromStructuredSyntax(s) {
  const line = s.line != null ? Number(s.line) : null;
  const column = s.column != null ? Number(s.column) : null;
  const isParserFailure = String(s.type) === 'ParserError';
  return normalizeUnifiedDiagnosticV1({
    severity: s.severity === 'warning' ? 'warning' : 'error',
    phase: DIAGNOSTIC_PHASE.SYNTAX,
    code: isParserFailure ? DIAGNOSTIC_CODE.PARSER_FAILURE : DIAGNOSTIC_CODE.SYNTAX_ERROR,
    message: String(s.message || 'syntax'),
    range:
      line != null && Number.isFinite(line)
        ? { line, column: column != null && Number.isFinite(column) ? column : null }
        : undefined,
    details: {
      offset: s.offset,
      sourceLine: s.sourceLine,
      token: s.token,
      expected: s.expected,
      got: s.got,
      lintCode: s.code,
      syntaxType: s.type,
    },
    repair: { action: 'fix_dsl_at_range' },
  });
}

/**
 * @param {{ type: string, message: string, nodeId?: string }} e
 */
export function diagnosticV1FromSemanticError(e) {
  return normalizeUnifiedDiagnosticV1({
    severity: 'error',
    phase: DIAGNOSTIC_PHASE.SEMANTIC,
    code: e.type === 'FlowGraphError' ? DIAGNOSTIC_CODE.SEMANTIC_FLOW : DIAGNOSTIC_CODE.SEMANTIC_NODE,
    message: e.message,
    nodeId: e.nodeId,
    repair: { action: 'fix_flow_semantics' },
    details: { semanticType: e.type },
  });
}

/**
 * @param {string[]} missingFeatures
 */
export function diagnosticV1FromUnsupportedFeatures(missingFeatures) {
  const missing = [...missingFeatures];
  return normalizeUnifiedDiagnosticV1({
    severity: 'error',
    phase: DIAGNOSTIC_PHASE.CAPABILITIES,
    code: DIAGNOSTIC_CODE.UNSUPPORTED_FEATURE,
    message:
      missing.length === 0
        ? 'Неподдерживаемые возможности'
        : `Неподдерживаемые возможности: ${missing.join(', ')}`,
    details: { missingFeatures: missing },
    repair:
      missing.length === 1
        ? { removeFeature: missing[0] }
        : { removeFeatures: missing, replaceOrGateFeatures: true },
  });
}

/**
 * @param {{ code: string, message: string }} b
 */
export function diagnosticV1FromDryRunBlocked(b) {
  return normalizeUnifiedDiagnosticV1({
    severity: 'error',
    phase: DIAGNOSTIC_PHASE.DRY_RUN,
    code: DIAGNOSTIC_CODE.DRY_RUN_BLOCKED,
    message: b.message,
    details: { policyCode: b.code },
    repair: { action: 'adjust_dsl_or_policy' },
  });
}

/** @param {string} msg */
export function diagnosticV1FromDryRunWarning(msg) {
  return normalizeUnifiedDiagnosticV1({
    severity: 'warning',
    phase: DIAGNOSTIC_PHASE.DRY_RUN,
    code: DIAGNOSTIC_CODE.DRY_RUN_WARNING,
    message: String(msg),
    repair: { action: 'review_runtime_limits' },
  });
}

/** @param {string} message */
export function diagnosticV1FromInvalidation(message) {
  return normalizeUnifiedDiagnosticV1({
    severity: 'error',
    phase: DIAGNOSTIC_PHASE.INVALIDATION,
    code: DIAGNOSTIC_CODE.INVALIDATION,
    message,
    repair: { action: 'fix_dependency_graph_or_chunk_keys' },
  });
}

/** @param {string} message */
export function diagnosticV1FromGraphBuild(message) {
  return normalizeUnifiedDiagnosticV1({
    severity: 'error',
    phase: DIAGNOSTIC_PHASE.PROJECT_GRAPH,
    code: DIAGNOSTIC_CODE.GRAPH_BUILD,
    message,
    repair: { action: 'fix_graph_document_inputs' },
  });
}

/** @param {string} message */
export function diagnosticV1FromExtraction(message) {
  return normalizeUnifiedDiagnosticV1({
    severity: 'error',
    phase: DIAGNOSTIC_PHASE.EXTRACTION,
    code: DIAGNOSTIC_CODE.EMPTY_DSL,
    message,
    repair: { action: 'extract_fenced_cicada_block' },
  });
}

/** @param {string} message */
export function diagnosticV1FromParserUnavailable(message) {
  return normalizeUnifiedDiagnosticV1({
    severity: 'error',
    phase: DIAGNOSTIC_PHASE.SYNTAX,
    code: DIAGNOSTIC_CODE.PARSER_UNAVAILABLE,
    message,
    details: { requiresPython: true, script: 'lint_cicada.py' },
    repair: { action: 'ensure_python_parser_available' },
  });
}

/**
 * Первый error в списке (для legacy repair / AI).
 * @param {UnifiedDiagnosticV1[]} list
 */
export function primaryErrorDiagnosticV1(list) {
  const e = (list || []).find((d) => d.severity === 'error');
  return e || null;
}

/**
 * Сводка для ответа API / repair loop: только ошибки или всё.
 * @param {UnifiedDiagnosticV1[]} list
 * @param {{ errorsOnly?: boolean }} [options]
 */
export function unifiedDiagnosticsV1ToJson(list, options = {}) {
  const errorsOnly = options.errorsOnly !== false;
  const src = list || [];
  const filtered = errorsOnly ? src.filter((d) => d.severity === 'error') : src;
  return filtered.map((d) => ({ ...d }));
}
