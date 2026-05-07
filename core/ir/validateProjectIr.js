import { buildProjectIrV2 } from './buildProjectIrV2.js';
import { validateIrV2 } from './validateIrV2.js';
import { irBuildOptionsFromValidateMode } from './irBuildOptions.js';

/**
 * Единая точка: сборка IR + validateIrV2 с тем же mode (нет расхождения UI vs компилятор).
 *
 * @param {{ nodes?: unknown[], edges?: unknown[] }} flow
 * @param {{ mode?: 'soft' | 'strict' }} [options]
 * @returns {{ errors: string[], warnings: string[], doc: object }}
 */
export function validateProjectIr(flow, options = {}) {
  const mode = options.mode === 'strict' ? 'strict' : 'soft';
  const doc = buildProjectIrV2(flow, irBuildOptionsFromValidateMode(mode));
  const validation = validateIrV2(doc, { mode, flow });
  return {
    errors: validation.errors,
    warnings: validation.warnings,
    doc,
  };
}

/** @deprecated Используйте validateProjectIr(flow, { mode: 'strict' }). */
export function validateProjectIrStrict(flow) {
  return validateProjectIr(flow, { mode: 'strict' });
}
