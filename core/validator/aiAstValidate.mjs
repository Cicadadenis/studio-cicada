/**
 * Структурная проверка AI-стеков (зеркало core/schemas/aiStacks.schema.json) до generateDSL.
 * @param {unknown} stacks
 * @returns {string[]}
 */
function needStr(v, minLen = 1) {
  return typeof v === 'string' && v.trim().length >= minLen;
}

const ALLOWED_TYPES = new Set([
  'bot',
  'start',
  'callback',
  'scenario',
  'step',
  'message',
  'buttons',
  'inline_db',
  'ask',
  'remember',
  'get',
  'save',
  'save_global',
  'condition',
  'else',
  'run',
  'stop',
  'send_file',
]);

function validateBlock(block, stackId, errors) {
  if (!block || typeof block !== 'object') {
    errors.push(`стек ${stackId}: блок не объект`);
    return;
  }
  const t = block.type;
  if (!needStr(t, 1)) {
    errors.push(`стек ${stackId}: у блока нет type`);
    return;
  }
  if (!ALLOWED_TYPES.has(t)) {
    errors.push(`стек ${stackId}, блок ${block.id || '?'}: неизвестный type '${t}'`);
  }
  if (!block.props || typeof block.props !== 'object' || Array.isArray(block.props)) {
    errors.push(`стек ${stackId}, блок ${block.id || '?'} (${t}): props должен быть объектом`);
    return;
  }
  const p = block.props;

  switch (t) {
    case 'bot':
      if (!needStr(p.token, 1)) errors.push(`стек ${stackId}: bot.token обязателен (непустая строка)`);
      break;
    case 'callback':
      if (typeof p.label !== 'string') errors.push(`стек ${stackId}: callback.label обязателен строкой (может быть пустым для общего handler)`);
      break;
    case 'scenario':
    case 'run':
    case 'step':
      if (!needStr(p.name, 1)) errors.push(`стек ${stackId}: ${t}.name обязателен`);
      break;
    case 'message':
      if (!needStr(p.text, 1)) errors.push(`стек ${stackId}: message.text обязателен (непустая строка)`);
      break;
    case 'buttons':
      if (!needStr(p.rows, 1)) errors.push(`стек ${stackId}: buttons.rows обязателен`);
      break;
    case 'inline_db':
      if (!needStr(p.key, 1)) errors.push(`стек ${stackId}: inline_db.key обязателен`);
      if (!needStr(p.callbackPrefix, 1)) errors.push(`стек ${stackId}: inline_db.callbackPrefix обязателен`);
      break;
    case 'ask':
      if (!needStr(p.question, 1)) errors.push(`стек ${stackId}: ask.question обязателен`);
      if (!needStr(p.varname, 1)) errors.push(`стек ${stackId}: ask.varname обязателен`);
      break;
    case 'remember':
      if (!needStr(p.varname, 1)) errors.push(`стек ${stackId}: remember.varname обязателен`);
      if (!Object.prototype.hasOwnProperty.call(p, 'value')) {
        errors.push(`стек ${stackId}: remember.value обязателен`);
      }
      break;
    case 'get':
      if (!needStr(p.key, 1)) errors.push(`стек ${stackId}: get.key обязателен`);
      if (!needStr(p.varname, 1)) errors.push(`стек ${stackId}: get.varname обязателен`);
      break;
    case 'save':
    case 'save_global':
      if (!needStr(p.key, 1)) errors.push(`стек ${stackId}: ${t}.key обязателен`);
      if (!Object.prototype.hasOwnProperty.call(p, 'value')) {
        errors.push(`стек ${stackId}: ${t}.value обязателен`);
      }
      break;
    case 'condition':
      if (!needStr(p.cond, 1)) errors.push(`стек ${stackId}: condition.cond обязателен`);
      break;
    case 'start':
    case 'else':
    case 'stop':
      break;
    case 'send_file':
      if (!needStr(p.file, 1)) errors.push(`стек ${stackId}: send_file.file обязателен (file_id или {переменная})`);
      break;
    default:
      break;
  }
}

/**
 * @param {unknown} stacks
 * @returns {string[]}
 */
export function validateAstSchema(stacks) {
  const errors = [];
  if (!Array.isArray(stacks) || stacks.length === 0) {
    errors.push('JSON Schema: ожидался непустой массив стеков');
    return errors;
  }
  stacks.forEach((stack, idx) => {
    const sid = stack?.id ?? `s${idx}`;
    if (!stack || typeof stack !== 'object') {
      errors.push(`стек [${idx}]: не объект`);
      return;
    }
    if (!needStr(stack.id, 1)) errors.push(`стек [${idx}]: id обязателен`);
    if (!Number.isFinite(Number(stack.x))) errors.push(`стек ${sid}: x должен быть числом`);
    if (!Number.isFinite(Number(stack.y))) errors.push(`стек ${sid}: y должен быть числом`);
    const blocks = stack.blocks;
    if (!Array.isArray(blocks) || blocks.length === 0) {
      errors.push(`стек ${sid}: blocks — непустой массив`);
      return;
    }
    blocks.forEach((b) => validateBlock(b, sid, errors));
  });
  return errors;
}

export { ALLOWED_TYPES as AI_AST_ALLOWED_BLOCK_TYPES };
