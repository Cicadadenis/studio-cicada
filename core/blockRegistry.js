const VALID_CATEGORIES = new Set([
  'render',
  'logic',
  'control',
  'action',
  'media',
  'telegram',
  'data',
  'settings',
]);

const VALID_UI_SCOPES = new Set(['render', 'none']);
const RENDER_UI_CAPABILITIES = Object.freeze(['buttons', 'inline', 'media']);

function freezeDefinition(definition) {
  return Object.freeze({
    ...definition,
    capabilities: Object.freeze([...(definition.capabilities || [])]),
    constraints: definition.constraints
      ? Object.freeze({
          ...definition.constraints,
          ui: definition.constraints.ui
            ? Object.freeze({ ...definition.constraints.ui })
            : undefined,
          flow: definition.constraints.flow
            ? Object.freeze({
                ...definition.constraints.flow,
                allowedTargetCategories: definition.constraints.flow.allowedTargetCategories
                  ? Object.freeze([...definition.constraints.flow.allowedTargetCategories])
                  : undefined,
                outputLabels: definition.constraints.flow.outputLabels
                  ? Object.freeze([...definition.constraints.flow.outputLabels])
                  : undefined,
              })
            : undefined,
          defaults: definition.constraints.defaults
            ? Object.freeze({ ...definition.constraints.defaults })
            : undefined,
        })
      : undefined,
  });
}

export function createBlockDefinition(definition) {
  const type = String(definition?.type || '').trim();
  const category = String(definition?.category || '').trim();
  const uiScope = definition?.uiScope || 'none';
  const description = String(definition?.description || '').trim();

  if (!type) throw new Error('BlockDefinition.type is required');
  if (!VALID_CATEGORIES.has(category)) {
    throw new Error(`BlockDefinition.category is invalid for ${type}`);
  }
  if (!VALID_UI_SCOPES.has(uiScope)) {
    throw new Error(`BlockDefinition.uiScope is invalid for ${type}`);
  }
  if (!description) throw new Error(`BlockDefinition.description is required for ${type}`);

  return freezeDefinition({
    type,
    category,
    capabilities: [...new Set((definition.capabilities || []).map(String).filter(Boolean))],
    uiScope,
    description,
    constraints: definition.constraints || undefined,
  });
}

function block(type, category, description, options = {}) {
  return createBlockDefinition({
    type,
    category,
    capabilities: options.capabilities || [],
    uiScope: options.uiScope || 'none',
    description,
    constraints: options.constraints,
  });
}

function palette(label, icon, color, group, canBeRoot, canStack, extra = {}) {
  return {
    ui: {
      label,
      icon,
      color,
      group,
      canBeRoot,
      canStack,
      ...extra,
    },
  };
}

function hidden(extra = {}) {
  return { ui: { palette: false }, ...extra };
}

function withFlow(base, flow) {
  return {
    ...base,
    flow,
  };
}

function withDefaults(base, defaults) {
  return {
    ...base,
    defaults,
  };
}

export const renderBlocks = Object.freeze([
  block('message', 'render', 'Send a text reply to the current chat.', {
    capabilities: RENDER_UI_CAPABILITIES,
    uiScope: 'render',
    constraints: withDefaults(
      withFlow(palette('Ответ', '✉', '#5b7cf6', 'Основные', false, true), { maxOutputs: 1 }),
      { text: 'Привет, {пользователь.имя}!' },
    ),
  }),
  block('reply', 'render', 'Alias for a text reply render action.', {
    capabilities: RENDER_UI_CAPABILITIES,
    uiScope: 'render',
    constraints: hidden(),
  }),
  block('caption', 'render', 'Caption-bearing render action.', {
    capabilities: RENDER_UI_CAPABILITIES,
    uiScope: 'render',
    constraints: hidden(),
  }),
  block('buttons', 'render', 'Legacy reply keyboard block, normalized to a UI attachment when attached.', {
    constraints: palette('Кнопки', '⊞', '#a78bfa', 'Основные', false, true),
  }),
  block('inline', 'render', 'Legacy inline keyboard block, normalized to a UI attachment when attached.', {
    constraints: palette('Inline-кнопки', '▦', '#7c3aed', 'Основные', false, true),
  }),
  block('inline_db', 'render', 'Legacy inline keyboard generated from database rows.', {
    constraints: palette('Inline из БД', '▤', '#06b6d4', 'Основные', false, true),
  }),
]);

export const controlBlocks = Object.freeze([
  block('start', 'control', 'Entry point for the /start update.', {
    constraints: withFlow(palette('Старт', '▶', '#3ecf8e', 'Основные', true, true), {
      maxOutputs: 1,
      allowedTargetCategories: ['render', 'media', 'logic', 'control', 'action', 'telegram', 'data', 'settings'],
    }),
  }),
  block('command', 'control', 'Entry point for a Telegram slash command.', {
    constraints: withDefaults(
      withFlow(palette('Команда', '/', '#fbbf24', 'Основные', true, true), {
        maxOutputs: 1,
        allowedTargetCategories: ['render', 'media', 'logic', 'control', 'action', 'telegram', 'data', 'settings'],
      }),
      { cmd: 'start' },
    ),
  }),
  block('callback', 'control', 'Entry point for a Telegram callback or reply button click.', {
    constraints: withDefaults(
      withFlow(palette('При нажатии', '⊙', '#60a5fa', 'Основные', true, true), {
        maxOutputs: 1,
        allowedTargetCategories: ['render', 'media', 'logic', 'control', 'action', 'telegram', 'data', 'settings'],
      }),
      { label: 'Кнопка' },
    ),
  }),
  block('on_text', 'control', 'Entry point for incoming text messages.', {
    constraints: hidden({ flow: { canBeRoot: true } }),
  }),
  block('on_photo', 'control', 'Entry point for incoming photos.', {
    constraints: palette('При фото', '📷', '#34d399', 'Основные', true, true),
  }),
  block('photo_received', 'control', 'Alias for the incoming photo entry point.', {
    constraints: hidden(),
  }),
  block('on_voice', 'control', 'Entry point for incoming voice messages.', {
    constraints: palette('При голосовом', '🎤', '#818cf8', 'Основные', true, true),
  }),
  block('voice_received', 'control', 'Alias for the incoming voice entry point.', {
    constraints: hidden(),
  }),
  block('on_document', 'control', 'Entry point for incoming documents.', {
    constraints: palette('При документе', '📎', '#94a3b8', 'Основные', true, true),
  }),
  block('document_received', 'control', 'Alias for the incoming document entry point.', {
    constraints: hidden(),
  }),
  block('on_sticker', 'control', 'Entry point for incoming stickers.', {
    constraints: palette('При стикере', '🎭', '#f472b6', 'Основные', true, true),
  }),
  block('sticker_received', 'control', 'Alias for the incoming sticker entry point.', {
    constraints: hidden(),
  }),
  block('on_location', 'control', 'Entry point for incoming locations.', {
    constraints: palette('При локации', '📍', '#ef4444', 'Основные', true, true),
  }),
  block('location_received', 'control', 'Alias for the incoming location entry point.', {
    constraints: hidden(),
  }),
  block('on_contact', 'control', 'Entry point for incoming contacts.', {
    constraints: palette('При контакте', '👤', '#0ea5e9', 'Основные', true, true),
  }),
  block('contact_received', 'control', 'Alias for the incoming contact entry point.', {
    constraints: hidden(),
  }),
  block('scenario', 'control', 'Named scenario containing steps or flow blocks.', {
    constraints: palette('Сценарий', '↺', '#34d399', 'Сценарии', true, true),
  }),
  block('step', 'control', 'Named step inside a scenario.', {
    constraints: palette('Шаг', '»', '#059669', 'Сценарии', false, true),
  }),
  block('middleware', 'control', 'Before or after hook around every incoming message.', {
    constraints: palette('Middleware', '⚙', '#64748b', 'Middleware', true, true),
  }),
  block('goto', 'control', 'Jump to another scenario, command, or step.', {
    constraints: withDefaults(
      withFlow(palette('Переход', '→', '#a3a3a3', 'Действия', false, false), { maxOutputs: 0 }),
      { target: 'сценарий' },
    ),
  }),
  block('loop', 'control', 'Repeat nested flow blocks.', {
    constraints: withDefaults(
      withFlow(palette('Цикл', '↻', '#f59e0b', 'Логика', false, true), { maxOutputs: 2, outputLabels: ['body', 'done'] }),
      { mode: 'count', count: '3' },
    ),
  }),
]);

export const logicBlocks = Object.freeze([
  block('condition', 'logic', 'Conditional branch.', {
    constraints: withDefaults(
      withFlow(palette('Если', '◇', '#fb923c', 'Логика', false, true), { maxOutputs: 2, outputLabels: ['true', 'false'] }),
      { cond: 'текст == "да"' },
    ),
  }),
  block('else', 'logic', 'Fallback branch for a condition.', {
    constraints: palette('Иначе', '⎇', '#f97316', 'Логика', false, true),
  }),
  block('switch', 'logic', 'Multi-branch switch by variable value.', {
    constraints: withDefaults(
      withFlow(palette('Переключатель', '⇄', '#f59e0b', 'Логика', false, true), { maxOutputs: 8 }),
      { varname: 'текст', cases: 'да\nнет' },
    ),
  }),
  block('ask', 'logic', 'Ask a question and store the user response.', {
    constraints: palette('Спросить', '?', '#f87171', 'Логика', false, true),
  }),
  block('remember', 'logic', 'Store a temporary session variable.', {
    constraints: palette('Запомнить', '♦', '#94a3b8', 'Логика', false, true),
  }),
  block('get', 'logic', 'Read a value from persistent storage.', {
    constraints: palette('Получить', '📥', '#0ea5e9', 'Логика', false, true),
  }),
  block('save', 'logic', 'Write a value to persistent storage.', {
    constraints: palette('Сохранить', '💾', '#059669', 'Логика', false, true),
  }),
  block('random', 'logic', 'Choose a random text variant.', {
    constraints: palette('Рандом', '⚄', '#c084fc', 'Логика', false, true),
  }),
]);

export const actionBlocks = Object.freeze([
  block('http', 'action', 'Execute an HTTP request.', {
    constraints: palette('HTTP-запрос', '↗', '#0ea5e9', 'Действия', false, true),
  }),
  block('delay', 'action', 'Pause execution for a number of seconds.', {
    constraints: palette('Пауза', '⏱', '#64748b', 'Действия', false, true),
  }),
  block('pause', 'action', 'Alias for delay.', {
    constraints: hidden(),
  }),
  block('typing', 'action', 'Show a typing indicator.', {
    constraints: palette('Печатает...', '…', '#475569', 'Действия', false, true),
  }),
  block('stop', 'action', 'Stop, break, continue, or return from the current flow.', {
    constraints: palette('Стоп', '■', '#ef4444', 'Действия', false, false),
  }),
  block('log', 'action', 'Write a diagnostic log line.', {
    constraints: palette('Лог', '📋', '#6b7280', 'Действия', false, true),
  }),
  block('notify', 'action', 'Send a direct notification to a Telegram user.', {
    constraints: palette('Уведомление', '🔔', '#06b6d4', 'Действия', false, true),
  }),
  block('menu', 'action', 'Send a simple menu block.', {
    constraints: palette('Меню', '≡', '#8b5cf6', 'Основные', false, true),
  }),
  block('run', 'action', 'Run another named scenario.', {
    constraints: hidden(),
  }),
  block('payment', 'action', 'Create a payment request.', {
    constraints: palette('Оплата', '💳', '#16a34a', 'Действия', false, true),
  }),
  block('analytics', 'action', 'Emit an analytics event.', {
    constraints: palette('Аналитика', '📊', '#0284c7', 'Действия', false, true),
  }),
  block('classify', 'action', 'Classify text into one of configured intents.', {
    constraints: palette('Классификация', '🧠', '#ec4899', 'Действия', false, true),
  }),
  block('role', 'action', 'Read or check a user role.', {
    constraints: palette('Проверка роли', '🔐', '#dc2626', 'Действия', false, true),
  }),
]);

export const mediaBlocks = Object.freeze([
  block('media', 'media', 'Generic media render action.', {
    capabilities: RENDER_UI_CAPABILITIES,
    uiScope: 'render',
    constraints: hidden(),
  }),
  block('photo', 'media', 'Send a photo by URL or file_id.', {
    capabilities: RENDER_UI_CAPABILITIES,
    uiScope: 'render',
    constraints: withDefaults(
      withFlow(palette('Фото', '🖼', '#34d399', 'Медиа', false, true), { maxOutputs: 1 }),
      { url: '', caption: '' },
    ),
  }),
  block('video', 'media', 'Send a video by URL or file_id.', {
    capabilities: RENDER_UI_CAPABILITIES,
    uiScope: 'render',
    constraints: withDefaults(
      withFlow(palette('Видео', '▷', '#2dd4bf', 'Медиа', false, true), { maxOutputs: 1 }),
      { url: '', caption: '' },
    ),
  }),
  block('audio', 'media', 'Send an audio file by URL or file_id.', {
    capabilities: RENDER_UI_CAPABILITIES,
    uiScope: 'render',
    constraints: palette('Аудио', '♪', '#818cf8', 'Медиа', false, true),
  }),
  block('document', 'media', 'Send a document by URL or file_id.', {
    capabilities: RENDER_UI_CAPABILITIES,
    uiScope: 'render',
    constraints: palette('Документ', '📄', '#94a3b8', 'Медиа', false, true),
  }),
  block('send_file', 'media', 'Send a previously stored Telegram file_id.', {
    capabilities: RENDER_UI_CAPABILITIES,
    uiScope: 'render',
    constraints: palette('Отправить файл', '📎', '#64748b', 'Медиа', false, true),
  }),
  block('sticker', 'media', 'Send a sticker by file_id.', {
    capabilities: RENDER_UI_CAPABILITIES,
    uiScope: 'render',
    constraints: palette('Стикер', '◉', '#f472b6', 'Медиа', false, true),
  }),
  block('contact', 'media', 'Send a Telegram contact.', {
    capabilities: RENDER_UI_CAPABILITIES,
    uiScope: 'render',
    constraints: palette('Контакт', '👤', '#0ea5e9', 'Медиа', false, true),
  }),
  block('location', 'media', 'Send a Telegram location.', {
    capabilities: RENDER_UI_CAPABILITIES,
    uiScope: 'render',
    constraints: palette('Локация', '📍', '#ef4444', 'Медиа', false, true),
  }),
  block('poll', 'media', 'Send a Telegram poll.', {
    capabilities: RENDER_UI_CAPABILITIES,
    uiScope: 'render',
    constraints: palette('Опрос', '📊', '#8b5cf6', 'Медиа', false, true),
  }),
]);

export const telegramBlocks = Object.freeze([
  block('check_sub', 'telegram', 'Check whether a user is subscribed to a channel.', {
    constraints: palette('Проверка подписки', '✅', '#10b981', 'Telegram', false, true),
  }),
  block('member_role', 'telegram', 'Read a user role in a channel or group.', {
    constraints: palette('Роль участника', '👮', '#059669', 'Telegram', false, true),
  }),
  block('forward_msg', 'telegram', 'Forward or re-send inbound Telegram content.', {
    constraints: palette('Переслать', '↗', '#34d399', 'Telegram', false, true),
  }),
  block('broadcast', 'telegram', 'Broadcast a message to all users or a tagged group.', {
    constraints: palette('Рассылка', '📡', '#0ea5e9', 'Telegram', false, true),
  }),
]);

export const dataBlocks = Object.freeze([
  block('database', 'data', 'Execute a SQL query against an external database.', {
    constraints: palette('БД-запрос', '🗄', '#10b981', 'Действия', false, true),
  }),
  block('db_delete', 'data', 'Delete a key from persistent storage.', {
    constraints: palette('Удалить из БД', '🗑', '#ef4444', 'Данные', false, true),
  }),
  block('save_global', 'data', 'Write a value to global persistent storage.', {
    constraints: palette('Глобальная БД', '🌐', '#10b981', 'Данные', false, true),
  }),
  block('set_global', 'data', 'Update a runtime global variable.', {
    constraints: palette('Обновить глобальную', '🌍', '#10b981', 'Данные', false, true),
  }),
  block('get_user', 'data', 'Read another user persistent value by Telegram user id.', {
    constraints: palette('Данные польз-ля', '👤', '#0ea5e9', 'Данные', false, true),
  }),
  block('all_keys', 'data', 'List all keys for the current user.', {
    constraints: palette('Все ключи', '🗂', '#64748b', 'Данные', false, true),
  }),
]);

export const settingsBlocks = Object.freeze([
  block('version', 'settings', 'Project DSL version declaration.', {
    constraints: palette('Версия', '📌', '#6b7280', 'Настройки', true, false),
  }),
  block('bot', 'settings', 'Telegram bot token declaration.', {
    constraints: palette('Бот', '🤖', '#3ecf8e', 'Настройки', true, false),
  }),
  block('commands', 'settings', 'Telegram bot menu commands declaration.', {
    constraints: palette('Команды меню', '📋', '#fbbf24', 'Настройки', true, false),
  }),
  block('global', 'settings', 'Project-wide global variable declaration.', {
    constraints: palette('Глобальная', '🌍', '#10b981', 'Настройки', true, false),
  }),
  block('block', 'settings', 'Named reusable block declaration.', {
    constraints: palette('Блок', '🧱', '#8b5cf6', 'Настройки', true, true),
  }),
  block('use', 'settings', 'Inline a named reusable block.', {
    constraints: palette('Использовать', '⚡', '#a78bfa', 'Настройки', false, true),
  }),
  block('call_block', 'settings', 'Call a named block and store its return value.', {
    constraints: palette('Вызвать блок', '⚡', '#8b5cf6', 'Настройки', false, true),
  }),
]);

export const blockDefinitionGroups = Object.freeze({
  renderBlocks,
  controlBlocks,
  logicBlocks,
  actionBlocks,
  mediaBlocks,
  telegramBlocks,
  dataBlocks,
  settingsBlocks,
});

export const blockDefinitions = Object.freeze([
  ...settingsBlocks,
  ...controlBlocks,
  ...renderBlocks,
  ...logicBlocks,
  ...actionBlocks,
  ...mediaBlocks,
  ...telegramBlocks,
  ...dataBlocks,
]);

export const blockRegistry = Object.freeze(
  Object.fromEntries(blockDefinitions.map((definition) => [definition.type, definition])),
);

const TERMINAL_CHILDREN = Object.freeze([]);
export const UI_ATTACHMENT_LEGACY_BLOCK_TYPES = Object.freeze(['buttons', 'inline', 'inline_db']);

const FLOW_CHILDREN = Object.freeze([
  'message', 'typing', 'delay', 'condition', 'else', 'switch', 'ask', 'remember',
  'get', 'save', 'random', 'loop', 'http', 'log', 'notify', 'broadcast', 'role',
  'payment', 'analytics', 'photo', 'video', 'audio', 'document', 'send_file',
  'sticker', 'contact', 'location', 'poll', 'database', 'classify', 'use',
  'call_block', 'stop', 'goto', 'menu', 'check_sub', 'member_role', 'forward_msg',
  'db_delete', 'save_global', 'set_global', 'get_user', 'all_keys',
]);

const FLOW_NO_MEDIA = Object.freeze([
  'message', 'typing', 'delay', 'condition', 'switch', 'ask', 'remember', 'get',
  'save', 'random', 'loop', 'http', 'log', 'stop', 'goto', 'use', 'call_block',
  'set_global',
]);

const TEXT_ATTACHMENTS = Object.freeze(['buttons', 'inline', 'inline_db']);

function freezeCompatibilityMap(map) {
  return Object.freeze(Object.fromEntries(
    Object.entries(map).map(([type, allowed]) => [type, Object.freeze([...allowed])]),
  ));
}

export const BLOCK_STACK_COMPATIBILITY = freezeCompatibilityMap({
  version: TERMINAL_CHILDREN,
  bot: TERMINAL_CHILDREN,
  commands: TERMINAL_CHILDREN,
  global: TERMINAL_CHILDREN,
  block: FLOW_CHILDREN,
  use: FLOW_CHILDREN,
  call_block: ['message', 'remember', 'save', 'condition', 'log', 'stop', 'goto', 'use'],

  start: FLOW_CHILDREN,
  command: FLOW_CHILDREN,
  callback: FLOW_CHILDREN,
  on_text: FLOW_CHILDREN,
  on_photo: FLOW_CHILDREN,
  photo_received: FLOW_CHILDREN,
  on_voice: FLOW_CHILDREN,
  voice_received: FLOW_CHILDREN,
  on_document: FLOW_CHILDREN,
  document_received: FLOW_CHILDREN,
  on_sticker: FLOW_CHILDREN,
  sticker_received: FLOW_CHILDREN,
  on_location: FLOW_CHILDREN,
  location_received: FLOW_CHILDREN,
  on_contact: FLOW_CHILDREN,
  contact_received: FLOW_CHILDREN,
  middleware: FLOW_CHILDREN,

  message: [...FLOW_CHILDREN, ...TEXT_ATTACHMENTS],
  reply: [...FLOW_CHILDREN, ...TEXT_ATTACHMENTS],
  caption: [...FLOW_CHILDREN, ...TEXT_ATTACHMENTS],
  buttons: FLOW_CHILDREN,
  inline: ['message', 'condition', 'stop', 'goto'],
  inline_db: ['message', 'condition', 'stop', 'goto'],
  menu: ['message', 'condition', 'stop', 'goto', 'use'],

  condition: FLOW_CHILDREN,
  else: FLOW_CHILDREN,
  switch: FLOW_CHILDREN,
  ask: ['message', 'remember', 'get', 'save', 'condition', 'http', 'log', 'notify', 'stop', 'goto', 'use'],
  remember: [...FLOW_NO_MEDIA, 'notify'],
  get: FLOW_NO_MEDIA,
  save: FLOW_NO_MEDIA,
  random: ['message', 'typing', 'delay', 'condition', 'goto', 'stop', 'use', 'log'],
  loop: FLOW_CHILDREN,

  http: ['message', 'remember', 'save', 'condition', 'log', 'stop', 'goto', 'use'],
  delay: ['message', 'typing', 'condition', 'ask', 'remember', 'get', 'save', 'http', 'log', 'stop', 'goto', 'use'],
  typing: ['message', 'photo', 'video', 'audio', 'document', 'send_file', 'sticker', 'condition', 'ask', 'delay', 'stop', 'goto', 'use'],
  stop: TERMINAL_CHILDREN,
  goto: TERMINAL_CHILDREN,
  log: [...FLOW_NO_MEDIA, 'notify'],
  notify: ['message', 'typing', 'delay', 'stop', 'goto', 'log'],
  database: ['message', 'remember', 'get', 'save', 'condition', 'log', 'stop', 'goto', 'use'],
  payment: ['message', 'condition', 'stop', 'goto', 'log'],
  analytics: ['message', 'stop', 'goto', 'log'],
  classify: ['message', 'condition', 'stop', 'goto', 'use', 'log'],
  role: ['message', 'condition', 'stop', 'goto', 'use', 'log'],

  photo: ['message', 'typing', 'delay', 'condition', 'ask', 'stop', 'goto', 'use', 'log'],
  video: ['message', 'typing', 'delay', 'condition', 'ask', 'stop', 'goto', 'use', 'log'],
  audio: ['message', 'typing', 'delay', 'condition', 'ask', 'stop', 'goto', 'use', 'log'],
  document: ['message', 'typing', 'delay', 'condition', 'ask', 'stop', 'goto', 'use', 'log'],
  send_file: ['message', 'typing', 'delay', 'condition', 'ask', 'stop', 'goto', 'use', 'log'],
  sticker: ['message', 'typing', 'delay', 'condition', 'ask', 'stop', 'goto', 'use', 'log'],
  contact: ['message', 'typing', 'delay', 'condition', 'ask', 'stop', 'goto', 'use', 'log'],
  location: ['message', 'typing', 'delay', 'condition', 'ask', 'stop', 'goto', 'use', 'log'],
  poll: ['message', 'typing', 'delay', 'condition', 'ask', 'stop', 'goto', 'use', 'log'],

  scenario: ['step', 'message', 'typing', 'delay', 'condition', 'switch', 'ask', 'remember', 'get', 'save', 'random', 'loop', 'http', 'log', 'stop', 'goto', 'use'],
  step: ['message', 'typing', 'delay', 'condition', 'switch', 'ask', 'remember', 'get', 'save', 'random', 'loop', 'http', 'log', 'stop', 'goto', 'use', 'step'],

  check_sub: ['message', 'condition', 'stop', 'goto', 'use', 'log'],
  member_role: ['message', 'condition', 'remember', 'save', 'stop', 'goto', 'log'],
  forward_msg: ['message', 'condition', 'stop', 'goto', 'log'],
  broadcast: ['message', 'stop', 'goto', 'log'],

  db_delete: [...FLOW_NO_MEDIA, 'notify'],
  save_global: FLOW_NO_MEDIA,
  set_global: FLOW_NO_MEDIA,
  get_user: [...FLOW_NO_MEDIA, 'notify'],
  all_keys: [...FLOW_NO_MEDIA, 'notify'],
});

export function getCompatibleBlockTypes(parentType) {
  return [...(BLOCK_STACK_COMPATIBILITY[String(parentType || '').trim()] || [])];
}

export function canStackBlockBelow(parentType, childType) {
  return getCompatibleBlockTypes(parentType).includes(String(childType || '').trim());
}

export function getBlockDefinition(type) {
  return blockRegistry[String(type || '').trim()] || null;
}

export function getBlockUiConstraints(type) {
  return getBlockDefinition(type)?.constraints?.ui || null;
}

export function getBlockFlowConstraints(type) {
  return getBlockDefinition(type)?.constraints?.flow || null;
}

export function getBlockDefaultProps(type) {
  return { ...(getBlockDefinition(type)?.constraints?.defaults || {}) };
}

export function getPaletteBlockTypes() {
  return blockDefinitions
    .map((definition) => {
      const ui = definition.constraints?.ui;
      if (!ui || ui.palette === false) return null;
      return {
        type: definition.type,
        label: ui.label,
        icon: ui.icon,
        color: ui.color,
        group: ui.group,
        canBeRoot: Boolean(ui.canBeRoot),
        canStack: Boolean(ui.canStack),
      };
    })
    .filter(Boolean);
}

export function getRootBlockTypes() {
  return blockDefinitions
    .filter((definition) => (
      definition.constraints?.ui?.canBeRoot ||
      definition.constraints?.flow?.canBeRoot
    ))
    .map((definition) => definition.type);
}
