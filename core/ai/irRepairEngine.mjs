import {
  canonicalSymbolFor,
  IR_USER_STORAGE_KEYS,
  isForbiddenInventedSymbol,
} from './irSymbolRegistry.mjs';
import { IR_ERROR_CODES } from './irSemanticGate.mjs';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cloneIr(ir) {
  return JSON.parse(JSON.stringify(ir || {}));
}

function fallbackDbKey(options = {}) {
  const allowed = asArray(options.allowedMemoryKeys).map(String).map((x) => x.trim()).filter(Boolean);
  return allowed[0] || IR_USER_STORAGE_KEYS[0] || 'корзина';
}

function replaceSymbolInString(value, from, to) {
  if (typeof value !== 'string' || !from || from === to) return value;
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const word = new RegExp(`(?<![A-Za-zА-Яа-яЁё_0-9.])${escaped}(?![A-Za-zА-Яа-яЁё_0-9.])`, 'gu');
  return value
    .replace(new RegExp(`\\{${escaped}\\}`, 'gu'), `{${to}}`)
    .replace(word, to);
}

function mapStringsDeep(value, mapper) {
  if (typeof value === 'string') return mapper(value);
  if (Array.isArray(value)) return value.map((item) => mapStringsDeep(item, mapper));
  if (!isObject(value)) return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = mapStringsDeep(child, mapper);
  }
  return out;
}

function normalizeInventedSymbols(ir) {
  let changed = false;
  const next = mapStringsDeep(ir, (value) => {
    let out = value;
    for (const bad of ['бд', 'callback', 'data', 'state']) {
      const fixed = canonicalSymbolFor(bad);
      const replaced = replaceSymbolInString(out, bad, fixed);
      if (replaced !== out) changed = true;
      out = replaced;
    }
    return out;
  });
  return { ir: next, changed };
}

function repairUnknownSymbol(ir, diagnostic, options) {
  const details = diagnostic?.details || {};
  const symbol = str(details.symbol);
  if (!symbol) return { ir, changed: false };

  let target = symbol;
  if (isForbiddenInventedSymbol(symbol)) target = canonicalSymbolFor(symbol);
  else if (details.kind === 'dbKey') target = fallbackDbKey(options);
  else if (details.kind === 'variable') target = 'текст';
  else return { ir, changed: false };

  let changed = false;
  const next = mapStringsDeep(ir, (value) => {
    const replaced = replaceSymbolInString(value, symbol, target);
    if (replaced !== value) changed = true;
    return replaced;
  });
  return { ir: next, changed };
}

function repairConditionBranchesInActions(actions) {
  let changed = false;
  const out = asArray(actions).map((action) => {
    if (!isObject(action)) return action;
    const next = { ...action };
    if (next.type === 'condition') {
      if (!Array.isArray(next.then) || next.then.length === 0) {
        next.then = [{ type: 'message', text: 'Продолжим.' }];
        changed = true;
      } else {
        const repairedThen = repairConditionBranchesInActions(next.then);
        next.then = repairedThen.actions;
        changed = changed || repairedThen.changed;
      }
      if (Object.prototype.hasOwnProperty.call(next, 'else')) {
        if (!Array.isArray(next.else) || next.else.length === 0) {
          delete next.else;
          changed = true;
        } else {
          const repairedElse = repairConditionBranchesInActions(next.else);
          next.else = repairedElse.actions;
          changed = changed || repairedElse.changed;
        }
      }
    }
    return next;
  });
  return { actions: out, changed };
}

function repairEmptyBranches(ir) {
  let changed = false;
  const next = cloneIr(ir);
  for (const handler of asArray(next.handlers)) {
    const repaired = repairConditionBranchesInActions(handler.actions);
    handler.actions = repaired.actions;
    changed = changed || repaired.changed;
    if (!handler.actions.length) {
      handler.actions = [{ type: 'message', text: 'Готово.' }, { type: 'stop' }];
      changed = true;
    }
  }
  for (const block of asArray(next.blocks)) {
    const repaired = repairConditionBranchesInActions(block.actions);
    block.actions = repaired.actions;
    changed = changed || repaired.changed;
  }
  for (const scenario of asArray(next.scenarios)) {
    if (!asArray(scenario.steps).length) {
      scenario.steps = [{
        id: `${scenario.id || 'scenario'}_entry`,
        name: 'старт',
        actions: [{ type: 'message', text: 'Готово.' }, { type: 'stop' }],
      }];
      changed = true;
    }
    for (const step of asArray(scenario.steps)) {
      const repaired = repairConditionBranchesInActions(step.actions);
      step.actions = repaired.actions;
      changed = changed || repaired.changed;
      if (!step.actions.length) {
        step.actions = [{ type: 'message', text: 'Готово.' }, { type: 'stop' }];
        changed = true;
      }
    }
  }
  return { ir: next, changed };
}

function removeInvalidTransitionActions(actions, diagnostic) {
  const details = diagnostic?.details || {};
  const actionType = str(details.actionType);
  const target = str(details.target);
  let changed = false;
  const out = [];
  for (const action of asArray(actions)) {
    if (!isObject(action)) {
      out.push(action);
      continue;
    }
    if (action.type === 'condition') {
      const next = { ...action };
      const thenResult = removeInvalidTransitionActions(next.then, diagnostic);
      next.then = thenResult.actions;
      changed = changed || thenResult.changed;
      if (Array.isArray(next.else)) {
        const elseResult = removeInvalidTransitionActions(next.else, diagnostic);
        next.else = elseResult.actions;
        changed = changed || elseResult.changed;
      }
      out.push(next);
      continue;
    }
    if (actionType && action.type === actionType && str(action.target) === target) {
      changed = true;
      continue;
    }
    out.push(action);
  }
  return { actions: out, changed };
}

function addMissingCallbackHandlers(ir, diagnostic) {
  const details = diagnostic?.details || {};
  const next = cloneIr(ir);
  const callbacks = new Set(asArray(next.handlers).filter((h) => h?.type === 'callback').map((h) => String(h.trigger ?? '')));
  let changed = false;

  if (details.kind === 'callback' && details.label && !callbacks.has(details.label)) {
    next.handlers.push({
      id: `auto_callback_${next.handlers.length + 1}`,
      type: 'callback',
      trigger: details.label,
      actions: [{ type: 'message', text: 'Раздел в разработке.' }, { type: 'stop' }],
    });
    changed = true;
  }

  if (details.kind === 'inlineCallback' && !callbacks.has('')) {
    next.handlers.push({
      id: `auto_inline_callback_${next.handlers.length + 1}`,
      type: 'callback',
      trigger: '',
      actions: [{ type: 'message', text: 'Выбор обработан.' }, { type: 'stop' }],
    });
    changed = true;
  }

  return { ir: next, changed };
}

function isTransitionAction(type) {
  return ['run_scenario', 'goto_command', 'goto_block', 'goto_scenario', 'goto', 'use_block'].includes(type);
}

function isTerminalUiAction(type) {
  return [
    'message',
    'buttons',
    'inline_db',
    'ask',
    'send_file',
    'ui_state',
    'stop',
  ].includes(type) || isTransitionAction(type);
}

function hasReachableTerminal(actions) {
  const list = asArray(actions);
  for (let index = 0; index < list.length; index += 1) {
    const action = list[index];
    if (!isObject(action)) continue;
    if (action.type === 'condition') {
      const rest = list.slice(index + 1);
      const thenReachable = hasReachableTerminal([...asArray(action.then), ...rest]);
      const hasElse = Object.prototype.hasOwnProperty.call(action, 'else');
      const elseReachable = hasElse
        ? hasReachableTerminal([...asArray(action.else), ...rest])
        : hasReachableTerminal(rest);
      return thenReachable && elseReachable;
    }
    if (isTerminalUiAction(str(action.type))) return true;
  }
  return false;
}

function ensureTerminalReachableActions(actions) {
  const list = asArray(actions);
  if (hasReachableTerminal(list)) return { actions: list, changed: false };
  return {
    actions: [...list, { type: 'message', text: 'Готово.' }, { type: 'stop' }],
    changed: true,
  };
}

function repairInvalidTransition(ir, diagnostic) {
  const details = diagnostic?.details || {};
  if (details.kind === 'callback' || details.kind === 'inlineCallback') {
    return addMissingCallbackHandlers(ir, diagnostic);
  }

  let changed = false;
  const next = cloneIr(ir);
  for (const handler of asArray(next.handlers)) {
    const result = removeInvalidTransitionActions(handler.actions, diagnostic);
    handler.actions = result.actions;
    changed = changed || result.changed;
  }
  for (const block of asArray(next.blocks)) {
    const result = removeInvalidTransitionActions(block.actions, diagnostic);
    block.actions = result.actions;
    changed = changed || result.changed;
  }
  for (const scenario of asArray(next.scenarios)) {
    for (const step of asArray(scenario.steps)) {
      const result = removeInvalidTransitionActions(step.actions, diagnostic);
      step.actions = result.actions;
      changed = changed || result.changed;
    }
  }
  if (details.from || details.to) {
    const before = asArray(next.transitions).length;
    next.transitions = asArray(next.transitions).filter(
      (t) => !(str(t.from) === str(details.from) && str(t.to) === str(details.to)),
    );
    changed = changed || next.transitions.length !== before;
  }
  return { ir: next, changed };
}

function replaceMissingUiStateActions(actions) {
  let changed = false;
  const out = asArray(actions).map((action) => {
    if (!isObject(action)) return action;
    if (action.type === 'ui_state') {
      changed = true;
      return { type: 'message', text: 'Готово.' };
    }
    if (action.type === 'condition') {
      const next = { ...action };
      const thenResult = replaceMissingUiStateActions(next.then);
      next.then = thenResult.actions;
      changed = changed || thenResult.changed;
      if (Array.isArray(next.else)) {
        const elseResult = replaceMissingUiStateActions(next.else);
        next.else = elseResult.actions;
        changed = changed || elseResult.changed;
      }
      return next;
    }
    return action;
  });
  return { actions: out, changed };
}

function repairMissingUiState(ir) {
  let changed = false;
  const next = cloneIr(ir);
  for (const handler of asArray(next.handlers)) {
    const result = replaceMissingUiStateActions(handler.actions);
    handler.actions = result.actions;
    changed = changed || result.changed;
    const terminal = ensureTerminalReachableActions(handler.actions);
    handler.actions = terminal.actions;
    changed = changed || terminal.changed;
  }
  for (const block of asArray(next.blocks)) {
    const result = replaceMissingUiStateActions(block.actions);
    block.actions = result.actions;
    changed = changed || result.changed;
  }
  for (const scenario of asArray(next.scenarios)) {
    for (const step of asArray(scenario.steps)) {
      const result = replaceMissingUiStateActions(step.actions);
      step.actions = result.actions;
      changed = changed || result.changed;
      const terminal = ensureTerminalReachableActions(step.actions);
      step.actions = terminal.actions;
      changed = changed || terminal.changed;
    }
  }
  return { ir: next, changed };
}

export function repairIrDeterministic(ir, diagnostics = [], options = {}) {
  let current = cloneIr(ir);
  const notes = [];
  const aliasRepair = normalizeInventedSymbols(current);
  current = aliasRepair.ir;
  if (aliasRepair.changed) notes.push('normalized invented symbol aliases');

  for (const item of diagnostics || []) {
    let result = { ir: current, changed: false };
    if (item.code === IR_ERROR_CODES.EMPTY_BRANCH) result = repairEmptyBranches(current);
    else if (item.code === IR_ERROR_CODES.UNKNOWN_SYMBOL) result = repairUnknownSymbol(current, item, options);
    else if (item.code === IR_ERROR_CODES.INVALID_TRANSITION) result = repairInvalidTransition(current, item);
    else if (item.code === IR_ERROR_CODES.MISSING_UI_STATE) result = repairMissingUiState(current);
    current = result.ir;
    if (result.changed) notes.push(`${item.code}: ${item.path || item.message}`);
  }

  const finalEmptyRepair = repairEmptyBranches(current);
  current = finalEmptyRepair.ir;
  if (finalEmptyRepair.changed) notes.push('ensured non-empty executable bodies');

  return {
    ir: current,
    changed: notes.length > 0,
    notes,
  };
}
