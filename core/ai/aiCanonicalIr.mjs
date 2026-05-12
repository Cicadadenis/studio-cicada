import { stripThinkingFromAiRaw } from '../validator/fixes.js';

export const AI_CANONICAL_IR_VERSION = 1;
export const AI_TARGET_CORE_EXACT = '0.3.5';

const HANDLER_TYPES = new Set(['start', 'command', 'callback', 'text']);
const ACTION_TYPES = new Set([
  'message',
  'buttons',
  'inline_db',
  'ask',
  'remember',
  'get',
  'save',
  'save_global',
  'condition',
  'run_scenario',
  'goto_command',
  'goto_block',
  'goto_scenario',
  'goto',
  'use_block',
  'stop',
  'send_file',
  'ui_state',
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function str(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function nonEmpty(value) {
  return str(value).length > 0;
}

function normalizeFencedJsonText(raw) {
  return stripThinkingFromAiRaw(raw)
    .replace(/```(?:json|javascript|js)?\s*/gi, '')
    .replace(/```/g, '')
    .trim();
}

function stripJsonCommentsPreservingStrings(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = inString;
      continue;
    }
    if (ch === '"') {
      out += ch;
      inString = !inString;
      continue;
    }
    if (!inString && ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    out += ch;
  }
  return out;
}

function stripJsonTrailingCommas(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = inString;
      continue;
    }
    if (ch === '"') {
      out += ch;
      inString = !inString;
      continue;
    }
    if (!inString && ch === ',') {
      let j = i + 1;
      while (/\s/.test(text[j] || '')) j += 1;
      if (text[j] === ']' || text[j] === '}') continue;
    }
    out += ch;
  }
  return out;
}

function parseJsonMaybeLenient(text) {
  const source = String(text ?? '').trim().replace(/^\uFEFF/, '');
  if (!source) return null;
  const noComments = stripJsonCommentsPreservingStrings(source);
  for (const candidate of [source, noComments, stripJsonTrailingCommas(noComments)]) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next variant
    }
  }
  return null;
}

function findBalancedJsonCandidates(text) {
  const src = String(text ?? '');
  const candidates = [];
  for (let start = 0; start < src.length; start += 1) {
    const opener = src[start];
    if (opener !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < src.length; i += 1) {
      const ch = src[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = inString;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '{') depth += 1;
      if (ch === '}') depth -= 1;
      if (depth < 0) break;
      if (depth === 0) {
        candidates.push(src.slice(start, i + 1));
        break;
      }
    }
  }
  return candidates;
}

function unwrapCanonicalIr(value) {
  if (typeof value === 'string') return unwrapCanonicalIr(parseJsonMaybeLenient(value));
  if (!isObject(value)) return null;
  if (Array.isArray(value.handlers) || Array.isArray(value.blocks) || Array.isArray(value.scenarios)) return value;
  if (isObject(value.ir)) return unwrapCanonicalIr(value.ir);
  if (isObject(value.canonicalIr)) return unwrapCanonicalIr(value.canonicalIr);
  if (isObject(value.runtimeGraph)) return unwrapCanonicalIr(value.runtimeGraph);
  if (isObject(value.result)) return unwrapCanonicalIr(value.result);
  return null;
}

export function extractAiCanonicalIrFromRaw(raw) {
  const cleaned = normalizeFencedJsonText(raw);
  const direct = unwrapCanonicalIr(parseJsonMaybeLenient(cleaned));
  if (direct) return { ir: direct, jsonText: cleaned };

  for (const candidate of findBalancedJsonCandidates(cleaned)) {
    const ir = unwrapCanonicalIr(parseJsonMaybeLenient(candidate));
    if (ir) return { ir, jsonText: candidate };
  }
  return null;
}

function normalizeAction(action) {
  if (!isObject(action)) return action;
  const type = str(action.type);
  const next = { ...action, type };
  if (Array.isArray(next.then)) next.then = next.then.map(normalizeAction);
  if (Array.isArray(next.else)) next.else = next.else.map(normalizeAction);
  if (Array.isArray(next.actions)) next.actions = next.actions.map(normalizeAction);
  return next;
}

function preserveRecoveryMetadata(node) {
  if (!isObject(node)) return {};
  const out = {};
  for (const key of ['optional', 'isOptional', 'required', 'priority', 'tags', 'kind']) {
    if (Object.prototype.hasOwnProperty.call(node, key)) out[key] = node[key];
  }
  if (isObject(node.meta)) out.meta = node.meta;
  if (isObject(node.props)) out.props = node.props;
  return out;
}

export function normalizeAiCanonicalIr(ir) {
  const src = isObject(ir) ? ir : {};
  return {
    irVersion: Number(src.irVersion || src.version || AI_CANONICAL_IR_VERSION),
    targetCore: str(src.targetCore, AI_TARGET_CORE_EXACT),
    compatibilityMode: str(src.compatibilityMode, `${AI_TARGET_CORE_EXACT} exact`),
    intent: isObject(src.intent) ? src.intent : {},
    state: isObject(src.state) ? src.state : {},
    handlers: asArray(src.handlers).map((handler, index) => ({
      id: str(handler?.id, `handler_${index + 1}`),
      type: str(handler?.type),
      trigger: str(handler?.trigger),
      actions: asArray(handler?.actions || handler?.body || handler?.steps).map(normalizeAction),
      ...preserveRecoveryMetadata(handler),
    })),
    blocks: asArray(src.blocks).map((block, index) => ({
      id: str(block?.id, `block_${index + 1}`),
      name: str(block?.name),
      actions: asArray(block?.actions || block?.body || block?.steps).map(normalizeAction),
      ...preserveRecoveryMetadata(block),
    })),
    scenarios: asArray(src.scenarios).map((scenario, scenarioIndex) => ({
      id: str(scenario?.id, `scenario_${scenarioIndex + 1}`),
      name: str(scenario?.name),
      steps: asArray(scenario?.steps).map((step, stepIndex) => ({
        id: str(step?.id, `${str(scenario?.id, `scenario_${scenarioIndex + 1}`)}_step_${stepIndex + 1}`),
        name: str(step?.name, `шаг_${stepIndex + 1}`),
        actions: asArray(step?.actions || step?.body).map(normalizeAction),
      })),
      ...preserveRecoveryMetadata(scenario),
    })),
    transitions: asArray(src.transitions),
    uiStates: asArray(src.uiStates),
  };
}

function validateAction(action, path, errors) {
  if (!isObject(action)) {
    errors.push(`${path}: action должен быть объектом`);
    return;
  }
  const type = str(action.type);
  if (!ACTION_TYPES.has(type)) {
    errors.push(`${path}: unsupported action.type "${type}"`);
    return;
  }
  if (type === 'message' && !nonEmpty(action.text)) errors.push(`${path}: message.text обязателен`);
  if (type === 'buttons' && !nonEmpty(action.rows)) errors.push(`${path}: buttons.rows обязателен`);
  if (type === 'inline_db') {
    if (!nonEmpty(action.key)) errors.push(`${path}: inline_db.key обязателен`);
    if (!nonEmpty(action.callbackPrefix)) errors.push(`${path}: inline_db.callbackPrefix обязателен`);
  }
  if (type === 'ask') {
    if (!nonEmpty(action.question)) errors.push(`${path}: ask.question обязателен`);
    if (!nonEmpty(action.varname)) errors.push(`${path}: ask.varname обязателен`);
  }
  if (type === 'remember' && !nonEmpty(action.varname)) errors.push(`${path}: remember.varname обязателен`);
  if (type === 'get') {
    if (!nonEmpty(action.key)) errors.push(`${path}: get.key обязателен`);
    if (!nonEmpty(action.varname)) errors.push(`${path}: get.varname обязателен`);
  }
  if ((type === 'save' || type === 'save_global') && !nonEmpty(action.key)) {
    errors.push(`${path}: ${type}.key обязателен`);
  }
  if (['run_scenario', 'goto_command', 'goto_block', 'goto_scenario', 'goto', 'use_block'].includes(type)) {
    if (!nonEmpty(action.target)) errors.push(`${path}: ${type}.target обязателен`);
  }
  if (type === 'send_file' && !nonEmpty(action.file)) errors.push(`${path}: send_file.file обязателен`);
  if (type === 'condition') {
    if (!nonEmpty(action.cond)) errors.push(`${path}: condition.cond обязателен`);
    asArray(action.then).forEach((child, idx) => validateAction(child, `${path}.then[${idx}]`, errors));
    asArray(action.else).forEach((child, idx) => validateAction(child, `${path}.else[${idx}]`, errors));
  }
}

export function validateAiCanonicalIr(ir, options = {}) {
  const errors = [];
  const warnings = [];
  if (!isObject(ir)) return { errors: ['Canonical AI IR: ожидался объект'], warnings };
  if (Number(ir.irVersion) !== AI_CANONICAL_IR_VERSION) {
    errors.push(`Canonical AI IR: irVersion должен быть ${AI_CANONICAL_IR_VERSION}`);
  }
  if (str(ir.targetCore) && str(ir.targetCore) !== AI_TARGET_CORE_EXACT) {
    warnings.push(`Canonical AI IR: targetCore "${ir.targetCore}" будет проверен как ${AI_TARGET_CORE_EXACT}`);
  }
  if (!asArray(ir.handlers).some((handler) => handler.type === 'start' || (handler.type === 'command' && handler.trigger === '/start'))) {
    warnings.push('Canonical AI IR: нет start handler — будет добавлен минимальный /start');
  }
  asArray(ir.handlers).forEach((handler, idx) => {
    const path = `handlers[${idx}]`;
    if (!HANDLER_TYPES.has(str(handler.type))) errors.push(`${path}: unsupported handler.type "${handler.type}"`);
    if (handler.type === 'command' && !nonEmpty(handler.trigger)) errors.push(`${path}: command trigger обязателен`);
    if (handler.type === 'callback' && typeof handler.trigger !== 'string') errors.push(`${path}: callback trigger должен быть строкой (может быть пустой)`);
    asArray(handler.actions).forEach((action, actionIdx) => validateAction(action, `${path}.actions[${actionIdx}]`, errors));
  });
  asArray(ir.blocks).forEach((block, idx) => {
    const path = `blocks[${idx}]`;
    if (!nonEmpty(block.name)) errors.push(`${path}: name обязателен`);
    asArray(block.actions).forEach((action, actionIdx) => validateAction(action, `${path}.actions[${actionIdx}]`, errors));
  });
  asArray(ir.scenarios).forEach((scenario, idx) => {
    const path = `scenarios[${idx}]`;
    if (!nonEmpty(scenario.name)) errors.push(`${path}: name обязателен`);
    if (!asArray(scenario.steps).length) errors.push(`${path}: steps не должен быть пустым`);
    asArray(scenario.steps).forEach((step, stepIdx) => {
      const stepPath = `${path}.steps[${stepIdx}]`;
      if (!nonEmpty(step.name)) errors.push(`${stepPath}: name обязателен`);
      asArray(step.actions).forEach((action, actionIdx) => validateAction(action, `${stepPath}.actions[${actionIdx}]`, errors));
    });
  });
  if (options.astMode !== 'advanced') {
    const usesGet = JSON.stringify(ir).includes('"type":"get"');
    if (usesGet) warnings.push('Canonical AI IR: get в safe mode допустим только для ключей, которые этот же бот сохраняет через save/save_global.');
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

function dslSafeIdentifier(raw, fallback) {
  const cleaned = str(raw)
    .replace(/[\s\-–—]+/g, '_')
    .replace(/[^A-Za-zА-Яа-яЁё0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  const withPrefix = /^[0-9]/.test(cleaned) ? `v_${cleaned}` : cleaned;
  return /^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*$/.test(withPrefix) ? withPrefix : fallback;
}

function toDslRuntimeString(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/\{callback_data\}/g, '{кнопка}')
    .replace(/(?<![A-Za-zА-Яа-яЁё_0-9.])callback_data(?![A-Za-zА-Яа-яЁё_0-9.])/gu, 'кнопка');
}

function createStackFactory() {
  let stackSeq = 0;
  let blockSeq = 0;
  return {
    nextBlock(type, props = {}) {
      const block = { id: `b${blockSeq}`, type, props };
      blockSeq += 1;
      return block;
    },
    nextStack(blocks) {
      const stack = {
        id: `s${stackSeq}`,
        x: 40 + (stackSeq % 5) * 360,
        y: 40 + Math.floor(stackSeq / 5) * 320,
        blocks,
      };
      stackSeq += 1;
      return stack;
    },
  };
}

function actionToBlocks(action, factory, uiStateById) {
  const type = str(action?.type);
  if (type === 'ui_state') {
    const state = uiStateById.get(str(action.uiStateId || action.id || action.target));
    if (!state) return [];
    const blocks = [];
    if (nonEmpty(state.message || state.text)) blocks.push(factory.nextBlock('message', { text: str(state.message || state.text) }));
    if (nonEmpty(state.buttons)) blocks.push(factory.nextBlock('buttons', { rows: str(state.buttons) }));
    if (isObject(state.inlineDb)) blocks.push(factory.nextBlock('inline_db', state.inlineDb));
    return blocks;
  }
  if (type === 'message') return [factory.nextBlock('message', { text: toDslRuntimeString(String(action.text ?? '')) })];
  if (type === 'buttons') return [factory.nextBlock('buttons', { rows: String(action.rows ?? '') })];
  if (type === 'inline_db') {
    return [
      factory.nextBlock('inline_db', {
        key: str(action.key),
        labelField: str(action.labelField),
        idField: str(action.idField),
        callbackPrefix: str(action.callbackPrefix),
        backText: str(action.backText, 'Назад'),
        backCallback: str(action.backCallback, 'назад'),
        columns: str(action.columns, '1'),
      }),
    ];
  }
  if (type === 'ask') return [factory.nextBlock('ask', { question: str(action.question), varname: dslSafeIdentifier(action.varname, 'value') })];
  if (type === 'remember') return [factory.nextBlock('remember', { varname: dslSafeIdentifier(action.varname, 'value'), value: toDslRuntimeString(action.value ?? '') })];
  if (type === 'get') return [factory.nextBlock('get', { key: str(action.key), varname: dslSafeIdentifier(action.varname, 'value') })];
  if (type === 'save') return [factory.nextBlock('save', { key: str(action.key), value: toDslRuntimeString(action.value ?? '') })];
  if (type === 'save_global') return [factory.nextBlock('save_global', { key: str(action.key), value: toDslRuntimeString(action.value ?? '') })];
  if (type === 'condition') {
    return [
      factory.nextBlock('condition', { cond: toDslRuntimeString(str(action.cond)) }),
      ...asArray(action.then).flatMap((child) => actionToBlocks(child, factory, uiStateById)),
      ...(asArray(action.else).length
        ? [factory.nextBlock('else', {}), ...asArray(action.else).flatMap((child) => actionToBlocks(child, factory, uiStateById))]
        : []),
    ];
  }
  if (type === 'run_scenario') return [factory.nextBlock('run', { name: dslSafeIdentifier(action.target, 'scenario') })];
  if (type === 'use_block') return [factory.nextBlock('use', { blockname: dslSafeIdentifier(action.target, 'block') })];
  if (type === 'goto_command') return [factory.nextBlock('goto', { target: str(action.target).startsWith('/') ? str(action.target) : `/${str(action.target)}` })];
  if (type === 'goto_block' || type === 'goto_scenario' || type === 'goto') return [factory.nextBlock('goto', { target: str(action.target) })];
  if (type === 'send_file') return [factory.nextBlock('send_file', { file: toDslRuntimeString(str(action.file)) })];
  if (type === 'stop') return [factory.nextBlock('stop', {})];
  return [];
}

function rootForHandler(handler, factory) {
  if (handler.type === 'start') return factory.nextBlock('start', {});
  if (handler.type === 'command') return factory.nextBlock('command', { cmd: str(handler.trigger).replace(/^\/+/, '') || 'start' });
  if (handler.type === 'text') return factory.nextBlock('on_text', {});
  return factory.nextBlock('callback', { label: String(handler.trigger ?? '') });
}

export function canonicalIrToEditorStacks(ir) {
  const factory = createStackFactory();
  const uiStateById = new Map(asArray(ir.uiStates).map((state) => [str(state.id), state]));
  const stacks = [
    factory.nextStack([factory.nextBlock('bot', { token: 'YOUR_BOT_TOKEN' })]),
  ];

  asArray(ir.state?.globals).forEach((entry) => {
    if (!isObject(entry) || !nonEmpty(entry.name || entry.varname || entry.key)) return;
    stacks.push(factory.nextStack([
      factory.nextBlock('global', {
        varname: dslSafeIdentifier(entry.name || entry.varname || entry.key, 'global_value'),
        value: entry.value ?? '',
      }),
    ]));
  });

  asArray(ir.blocks).forEach((block) => {
    stacks.push(factory.nextStack([
      factory.nextBlock('block', { name: dslSafeIdentifier(block.name, 'block') }),
      ...asArray(block.actions).flatMap((action) => actionToBlocks(action, factory, uiStateById)),
    ]));
  });

  asArray(ir.scenarios).forEach((scenario) => {
    const blocks = [factory.nextBlock('scenario', { name: dslSafeIdentifier(scenario.name, 'scenario') })];
    asArray(scenario.steps).forEach((step) => {
      blocks.push(factory.nextBlock('step', { name: dslSafeIdentifier(step.name, 'step') }));
      blocks.push(...asArray(step.actions).flatMap((action) => actionToBlocks(action, factory, uiStateById)));
    });
    stacks.push(factory.nextStack(blocks));
  });

  let hasStart = false;
  asArray(ir.handlers).forEach((handler) => {
    if (handler.type === 'start') hasStart = true;
    stacks.push(factory.nextStack([
      rootForHandler(handler, factory),
      ...asArray(handler.actions).flatMap((action) => actionToBlocks(action, factory, uiStateById)),
    ]));
  });
  if (!hasStart) {
    stacks.push(factory.nextStack([
      factory.nextBlock('start', {}),
      factory.nextBlock('message', { text: 'Привет! Выберите действие:' }),
      factory.nextBlock('stop', {}),
    ]));
  }

  return stacks;
}
