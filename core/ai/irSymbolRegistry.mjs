export const IR_SYSTEM_VARIABLES = Object.freeze([
  'пользователь',
  'текст',
  'callback_data',
  'chat_id',
  'user_id',
  'сообщение_id',
  'имя',
  'фамилия',
  'кнопка',
  'файл_id',
  'тип_файла',
  'имя_файла',
  'широта',
  'долгота',
]);

export const IR_USER_STORAGE_KEYS = Object.freeze([
  'корзина',
  'итого',
  'адрес',
  'категории',
  'товары',
]);

export const IR_INVENTED_SYMBOL_ALIASES = Object.freeze({
  'бд': 'корзина',
  callback: 'callback_data',
  data: 'текст',
  state: 'корзина',
});

export const IR_FORBIDDEN_INVENTED_SYMBOLS = Object.freeze(
  Object.keys(IR_INVENTED_SYMBOL_ALIASES),
);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function addNonEmpty(set, value) {
  const s = str(value);
  if (s) set.add(s);
}

function normalizeCommandTrigger(value) {
  const raw = str(value);
  if (!raw) return '';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

export function isForbiddenInventedSymbol(name) {
  return IR_FORBIDDEN_INVENTED_SYMBOLS.includes(str(name));
}

export function canonicalSymbolFor(name) {
  const raw = str(name);
  return IR_INVENTED_SYMBOL_ALIASES[raw] || raw;
}

export function createBaseIrSymbolRegistry(options = {}) {
  const variables = new Set(IR_SYSTEM_VARIABLES);
  const dbKeys = new Set([
    ...IR_USER_STORAGE_KEYS,
    ...asArray(options.allowedMemoryKeys).map(String).map((x) => x.trim()).filter(Boolean),
  ]);

  return {
    variables,
    dbKeys,
    callbacks: new Set(),
    scenarios: new Set(),
    scenarioIds: new Set(),
    blocks: new Set(),
    blockIds: new Set(),
    commands: new Set(['/start']),
    handlers: new Set(),
    uiStates: new Set(),
  };
}

export function buildIrSymbolRegistry(ir, options = {}) {
  const registry = createBaseIrSymbolRegistry(options);

  for (const entry of asArray(ir?.state?.globals)) {
    if (!isObject(entry)) continue;
    const name = str(entry.name || entry.varname || entry.key);
    addNonEmpty(registry.variables, name);
    addNonEmpty(registry.dbKeys, name);
  }

  for (const state of asArray(ir?.uiStates)) {
    if (!isObject(state)) continue;
    addNonEmpty(registry.uiStates, state.id);
  }

  for (const block of asArray(ir?.blocks)) {
    if (!isObject(block)) continue;
    addNonEmpty(registry.blockIds, block.id);
    addNonEmpty(registry.blocks, block.name);
  }

  for (const scenario of asArray(ir?.scenarios)) {
    if (!isObject(scenario)) continue;
    addNonEmpty(registry.scenarioIds, scenario.id);
    addNonEmpty(registry.scenarios, scenario.name);
  }

  for (const handler of asArray(ir?.handlers)) {
    if (!isObject(handler)) continue;
    addNonEmpty(registry.handlers, handler.id);
    if (handler.type === 'callback') addNonEmpty(registry.callbacks, handler.trigger);
    if (handler.type === 'command') addNonEmpty(registry.commands, normalizeCommandTrigger(handler.trigger));
    if (handler.type === 'start') registry.commands.add('/start');
  }

  return registry;
}

export function registryHasScenario(registry, target) {
  const t = str(target);
  return Boolean(t && (registry.scenarios.has(t) || registry.scenarioIds.has(t)));
}

export function registryHasBlock(registry, target) {
  const t = str(target);
  return Boolean(t && (registry.blocks.has(t) || registry.blockIds.has(t)));
}

export function registryHasCommand(registry, target) {
  const t = normalizeCommandTrigger(target);
  return Boolean(t && registry.commands.has(t));
}

export function registryHasUiState(registry, target) {
  const t = str(target);
  return Boolean(t && registry.uiStates.has(t));
}

export function registryHasDbKey(registry, key) {
  const k = str(key);
  return Boolean(k && registry.dbKeys.has(k));
}

export function buildIrSymbolRegistryPromptContext(options = {}) {
  const allowedMemoryKeys = asArray(options.allowedMemoryKeys)
    .map(String)
    .map((x) => x.trim())
    .filter(Boolean);
  const dbKeys = [...new Set([...IR_USER_STORAGE_KEYS, ...allowedMemoryKeys])];

  return [
    '',
    '═══ CANONICAL SYMBOL REGISTRY (STRICT) ═══',
    `SYSTEM variables: ${IR_SYSTEM_VARIABLES.join(', ')}`,
    `USER_STORAGE dbKeys: ${dbKeys.join(', ')}`,
    'Use only declared scenario/block/command/uiState ids and names.',
    `Forbidden invented symbols: ${IR_FORBIDDEN_INVENTED_SYMBOLS.join(', ')}`,
    'Aliases repaired internally when possible: callback→callback_data, data→текст, бд/state→корзина.',
    'Do not invent variable names in message templates or conditions. Declare variables first with ask/get/remember.',
    'Canonical callback variable in IR is callback_data; the DSL serializer maps it to runtime callback variable.',
  ].join('\n');
}
