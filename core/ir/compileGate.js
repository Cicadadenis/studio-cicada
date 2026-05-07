import { validateProjectIr } from './validateProjectIr.js';
import { CompilationError } from './CompilationError.js';

/**
 * IR build + strict validate. При любых errors — throw (не собирать DSL).
 * @param {{ nodes?: unknown[], edges?: unknown[] }} flow
 * @returns {{ doc: object, warnings: string[] }}
 */
export function assertCompilableFlow(flow) {
  const { errors, warnings, doc } = validateProjectIr(flow, { mode: 'strict' });
  if (errors.length) {
    throw new CompilationError(errors, warnings);
  }
  return { doc, warnings };
}

export { IR_BUILD_COMPILE_STRICT } from './irBuildOptions.js';
export { IR_BUILD_DEFAULTS } from './irBuildOptions.js';
export { irBuildOptionsFromValidateMode } from './irBuildOptions.js';
