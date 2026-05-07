/**
 * Ошибка компиляции: IR не прошёл strict-валидацию — DSL собирать нельзя.
 */
export class CompilationError extends Error {
  /** @param {string[]} errors */
  /** @param {string[]} [warnings] */
  constructor(errors, warnings = []) {
    const msg = errors.length ? errors.join('\n') : 'CompilationError';
    super(msg);
    this.name = 'CompilationError';
    /** @type {string[]} */
    this.errors = errors;
    /** @type {string[]} */
    this.warnings = warnings;
  }
}
