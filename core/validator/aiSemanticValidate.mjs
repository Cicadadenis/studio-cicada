/**
 * Семантическая проверка AI-AST (после JSON Schema): режимы, KV get, {переменные}.
 */

const SYSTEM_VARS = new Set([
  'chat_id',
  'user_id',
  'текст',
  'сообщение_id',
  'имя',
  'фамилия',
  'кнопка',
  'username',
  'first_name',
  'last_name',
  'message_id',
]);

const MEDIA_TRIGGER_VARS = {
  document_received: new Set(['файл_id', 'имя_файла', 'тип_файла']),
  photo_received: new Set(['файл_id', 'тип_файла']),
  voice_received: new Set(['файл_id', 'тип_файла']),
  sticker_received: new Set(['файл_id', 'стикер_emoji', 'тип_файла']),
  location_received: new Set(['файл_id']),
  contact_received: new Set([]),
};

const MEDIA_ONLY_VAR_NAMES = new Set([
  'файл_id',
  'имя_файла',
  'тип_файла',
  'стикер_emoji',
]);

function hintForUndeclaredVar(varName, astMode) {
  if (MEDIA_ONLY_VAR_NAMES.has(varName)) {
    return (
      `В режиме ${astMode} медиа-триггеров нет — не используй {файл_id}. ` +
      `Спроси файл через ask (varname "файл") и подставь {файл} в message.`
    );
  }
  return 'Добавь блок ask/get/remember для её получения.';
}

function extractUsedVars(str) {
  if (!str || typeof str !== 'string') return [];
  const matches = [...str.matchAll(/\{([a-zA-Zа-яА-ЯёЁ_][a-zA-Zа-яА-ЯёЁ0-9_]*)\}/g)];
  return matches.map((m) => m[1]);
}

/**
 * @param {unknown[]} stacks
 * @param {{ astMode: 'safe' | 'advanced'; allowedMemoryKeys: string[] }} opts
 * @returns {string[]}
 */
export function semanticValidate(stacks, opts) {
  const errors = [];
  const astMode = opts?.astMode === 'advanced' ? 'advanced' : 'safe';
  const allowedKeys = new Set((opts?.allowedMemoryKeys || []).map((k) => String(k).trim()).filter(Boolean));

  if (!Array.isArray(stacks)) {
    return ['semantic: ожидался массив стеков'];
  }

  for (const stack of stacks) {
    const blocks = stack?.blocks || [];
    for (const block of blocks) {
      const t = block?.type;
      const p = block?.props || {};
      if (t === 'get') {
        if (astMode === 'safe') {
          errors.push(
            `Блок get (стек ${stack?.id}): в режиме safe KV get запрещён. Убери get или перестрой на remember/ask.`,
          );
          continue;
        }
        if (allowedKeys.size === 0) {
          errors.push(
            `Блок get (стек ${stack?.id}): список разрешённых ключей пуст — get недоступен. Задайте AI_ALLOWED_MEMORY_KEYS или уберите get.`,
          );
          continue;
        }
        const key = String(p.key ?? '').trim();
        if (!allowedKeys.has(key)) {
          errors.push(
            `Блок get (стек ${stack?.id}): ключ "${key}" не из разрешённого списка: ${[...allowedKeys].join(', ')}.`,
          );
        }
      }
    }
  }

  errors.push(...semanticValidateUndeclaredVars(stacks, astMode));
  return [...new Set(errors)];
}

function semanticValidateUndeclaredVars(stacks, astMode) {
  const errors = [];
  const globalVars = new Set(SYSTEM_VARS);

  for (const stack of stacks) {
    const blocks = stack?.blocks || [];
    const declaredInStack = new Set(globalVars);

    const firstBlock = blocks[0];
    if (firstBlock && MEDIA_TRIGGER_VARS[firstBlock.type]) {
      for (const v of MEDIA_TRIGGER_VARS[firstBlock.type]) declaredInStack.add(v);
    }

    for (const block of blocks) {
      const p = block.props || {};
      const t = block.type;

      if (t === 'ask' && p.varname) declaredInStack.add(p.varname);
      if (t === 'get' && p.varname) declaredInStack.add(p.varname);
      if (t === 'remember' && p.varname) declaredInStack.add(p.varname);

      const toCheck = [];
      if (t === 'message') toCheck.push(p.text);
      if (t === 'condition') toCheck.push(p.cond);
      if (t === 'remember') toCheck.push(String(p.value ?? ''));
      if (t === 'send_file' && p.file != null) toCheck.push(String(p.file));

      for (const str of toCheck) {
        for (const varName of extractUsedVars(str)) {
          if (!declaredInStack.has(varName)) {
            errors.push(
              `Переменная '${varName}' в блоке '${t}' (стек ${stack.id}), не объявлена. ` +
                hintForUndeclaredVar(varName, astMode),
            );
          }
        }
      }
    }
  }
  return errors;
}
