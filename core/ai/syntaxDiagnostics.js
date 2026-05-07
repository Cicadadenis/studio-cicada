/**
 * Нормализация диагностик `lint_cicada.py` / `lintCicadaWithPython` в форму для AI repair loop.
 */

/**
 * @param {Record<string, unknown>} d — элемент diagnostics[]
 * @returns {Record<string, unknown>}
 */
export function mapPythonLintDiagnosticToStructured(d) {
  if (!d || typeof d !== 'object') {
    return { type: 'SyntaxError', message: 'unknown diagnostic', line: null, column: null };
  }
  const line = typeof d.line === 'number' ? d.line : d.line != null ? Number(d.line) : null;
  const column = typeof d.column === 'number' ? d.column : d.column != null ? Number(d.column) : null;
  const offset = typeof d.offset === 'number' ? d.offset : d.offset != null ? Number(d.offset) : null;
  return {
    type: typeof d.type === 'string' && d.type ? d.type : 'SyntaxError',
    message: String(d.message ?? d.help ?? ''),
    line: Number.isFinite(line) ? line : null,
    column: Number.isFinite(column) ? column : null,
    offset: Number.isFinite(offset) ? offset : null,
    token: typeof d.token === 'string' ? d.token : undefined,
    expected: typeof d.expected === 'string' ? d.expected : undefined,
    got: typeof d.got === 'string' ? d.got : undefined,
    sourceLine: typeof d.sourceLine === 'string' ? d.sourceLine : undefined,
    code: typeof d.code === 'string' ? d.code : undefined,
    severity: typeof d.severity === 'string' ? d.severity : 'error',
    suggestions: Array.isArray(d.suggestions) ? d.suggestions : undefined,
  };
}

/**
 * @param {Array<Record<string, unknown>>} diagnostics
 */
export function mapPythonLintDiagnosticsToStructured(diagnostics) {
  if (!Array.isArray(diagnostics)) return [];
  return diagnostics.map((x) => mapPythonLintDiagnosticToStructured(x));
}
