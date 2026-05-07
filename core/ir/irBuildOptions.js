/**
 * Опции сборки IR. Пермиссивные значения — для UI / legacy-графов.
 * Строгие — только для компиляции в DSL (без двойной семантики id и без резолва goto по display name).
 */

/** @typedef {{
 *   strictCompilerIdentity?: boolean,
 *   forbidGotoResolutionByDisplayName?: boolean,
 * }} IrBuildOptions */

/** Пермиссивная сборка: compiler id = data.irId | data.compilerId | React Flow node.id */
export const IR_BUILD_DEFAULTS = Object.freeze({
  strictCompilerIdentity: false,
  forbidGotoResolutionByDisplayName: false,
});

/** Компиляция DSL: один источник идентичности и только compiler id / builtins в goto */
export const IR_BUILD_COMPILE_STRICT = Object.freeze({
  strictCompilerIdentity: true,
  forbidGotoResolutionByDisplayName: true,
});

/** @typedef {'soft' | 'strict'} IrValidateMode */

/**
 * Единый маппинг режима UI/компилятора на опции сборки IR (без дублирования пайплайнов).
 * @param {IrValidateMode} mode
 * @returns {Required<IrBuildOptions>}
 */
export function irBuildOptionsFromValidateMode(mode) {
  return mode === 'strict' ? { ...IR_BUILD_COMPILE_STRICT } : { ...IR_BUILD_DEFAULTS };
}

/**
 * @param {IrBuildOptions | undefined} opts
 * @returns {Required<IrBuildOptions>}
 */
export function normalizeIrBuildOptions(opts) {
  return {
    strictCompilerIdentity: Boolean(opts?.strictCompilerIdentity),
    forbidGotoResolutionByDisplayName: Boolean(opts?.forbidGotoResolutionByDisplayName),
  };
}
