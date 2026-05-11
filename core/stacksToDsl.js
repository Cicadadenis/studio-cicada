/**
 * Стеки редактора → текст .ccd.
 * Реализация вынесена в dslCodegen.js (общее ядро с графом Flow).
 *
 * generateDSL(stacks) — прежнее имя API (= generateDSLFromStacks).
 * blockToDSL — алиас emitBlock для совместимости.
 */

export {
  emitBlock,
  emitBlock as blockToDSL,
  stackToDSL,
  generateDSLFromStacks,
  generateDSLFromFlow,
  nodeDSL,
  validateFlow,
  renderIr,
  canRenderUi,
  SCHEMA_VERSIONS_FOR_UI,
  inferRequiredFeaturesFromFlow,
  inferRequiredFeaturesFromStacks,
  buildProjectManifestDraft,
  buildProjectManifestDraftFromStacks,
} from './dslCodegen.js';

export { generateDSLFromStacks as generateDSL } from './dslCodegen.js';
