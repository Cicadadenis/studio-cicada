import { AI_CANONICAL_IR_VERSION, AI_TARGET_CORE_EXACT, normalizeAiCanonicalIr } from './aiCanonicalIr.mjs';

export const IR_FALLBACK_REASON = 'IR_FALLBACK_USED';
export const IR_FALLBACK_SKELETON_REASON_CODE = 'IR_FALLBACK_SKELETON_USED';
export const IR_SKELETON_STATE = 'SKELETON_IR';

export function buildIrSkeletonFallback(options = {}) {
  const prompt = typeof options.prompt === 'string' ? options.prompt.trim() : '';
  const promptHint = prompt
    ? `Запрос сохранён как контекст, но сложная логика не применялась: ${prompt.slice(0, 160)}`
    : 'Сложная логика не применялась.';

  return normalizeAiCanonicalIr({
    irVersion: AI_CANONICAL_IR_VERSION,
    targetCore: AI_TARGET_CORE_EXACT,
    compatibilityMode: `${AI_TARGET_CORE_EXACT} exact`,
    intent: {
      primary: 'skeleton_fallback',
      reason: options.reason || IR_FALLBACK_REASON,
      executionMode: 'FALLBACK_SKELETON',
      isDegraded: true,
      isAIGenerated: false,
    },
    state: {},
    uiStates: [],
    blocks: [],
    scenarios: [],
    transitions: [],
    handlers: [
      {
        id: 'skeleton_start',
        type: 'start',
        trigger: '',
        actions: [
          { type: 'message', text: 'Запущена базовая версия сценария (без сложной логики).' },
          { type: 'message', text: promptHint },
          { type: 'buttons', rows: '🏠 Главное меню\nℹ️ Помощь' },
          { type: 'stop' },
        ],
      },
      {
        id: 'skeleton_menu',
        type: 'callback',
        trigger: '🏠 Главное меню',
        actions: [
          { type: 'message', text: 'Базовое меню готово. Выберите действие.' },
          { type: 'buttons', rows: '🏠 Главное меню\nℹ️ Помощь' },
          { type: 'stop' },
        ],
      },
      {
        id: 'skeleton_help',
        type: 'callback',
        trigger: 'ℹ️ Помощь',
        actions: [
          { type: 'message', text: 'Это безопасная базовая версия. Сгенерируйте сценарий повторно, чтобы добавить сложную логику.' },
          { type: 'buttons', rows: '🏠 Главное меню' },
          { type: 'stop' },
        ],
      },
      {
        id: 'skeleton_text_fallback',
        type: 'text',
        trigger: '',
        actions: [
          { type: 'message', text: 'Я пока понимаю только базовые кнопки меню.' },
          { type: 'buttons', rows: '🏠 Главное меню\nℹ️ Помощь' },
          { type: 'stop' },
        ],
      },
    ],
  });
}
