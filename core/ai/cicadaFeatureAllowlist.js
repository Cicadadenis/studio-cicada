/**
 * Полный набор известных capability для «студийного» контура (все фичи из DSL, без внешнего рантайма).
 * Для production-сравнения передавайте в pipeline реальные возможности исполнителя.
 */
export const CICADA_STUDIO_FULL_FEATURE_ALLOWLIST = Object.freeze(
  new Set([
    'http_client',
    'poll',
    'scenarios',
    'sql',
    'payments',
    'analytics',
    'classification',
    'telegram_notify',
    'telegram_broadcast',
    'telegram_channel_gate',
    'telegram_admin',
    'telegram_forward',
    'control_flow_loops',
    'global_kv',
    'cross_user_kv',
    'kv_delete',
    'kv_scan',
    'block_call',
    'random_reply',
    'inline_keyboard',
    'bot_menu',
    'switch',
  ]),
);
