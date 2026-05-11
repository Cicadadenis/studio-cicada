import { normalizeAiCanonicalIr } from './aiCanonicalIr.mjs';

export const AI_RECOVERY_INVALID_INPUT = 'AI_RECOVERY_INVALID_INPUT';
export const IR_PRUNER_DEFAULTS = Object.freeze({
  maxDepth: 2,
  maxHandlers: 5,
  maxActionsPerList: 8,
  maxStepsPerScenario: 5,
  maxBlocks: 3,
  maxUiStates: 5,
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function clone(value) {
  try {
    return JSON.parse(JSON.stringify(value || {}));
  } catch {
    return {};
  }
}

function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function unique(values) {
  return [...new Set(asArray(values).filter(Boolean).map((value) => String(value)))];
}

function isOptionalNode(value) {
  if (!isObject(value)) return false;
  const meta = isObject(value.meta) ? value.meta : {};
  const props = isObject(value.props) ? value.props : {};
  const optionalFlag = value.optional ?? value.isOptional ?? meta.optional ?? props.optional;
  const requiredFlag = value.required ?? meta.required ?? props.required;
  const priority = String(value.priority || meta.priority || props.priority || value.kind || '').toLowerCase();
  const tags = asArray(value.tags || meta.tags || props.tags).map((tag) => String(tag).toLowerCase());
  return (
    optionalFlag === true ||
    requiredFlag === false ||
    priority === 'optional' ||
    priority === 'nice_to_have' ||
    priority === 'fallback' ||
    tags.includes('optional') ||
    tags.includes('nice_to_have') ||
    tags.includes('fallback')
  );
}

function countActions(actions) {
  let total = 0;
  for (const action of asArray(actions)) {
    if (!isObject(action)) continue;
    total += 1;
    if (action.type === 'condition') {
      total += countActions(action.then);
      total += countActions(action.else);
    }
  }
  return total;
}

function countIrNodes(ir) {
  const handlers = asArray(ir?.handlers);
  const blocks = asArray(ir?.blocks);
  const scenarios = asArray(ir?.scenarios);
  const uiStates = asArray(ir?.uiStates);
  const transitions = asArray(ir?.transitions);
  const steps = scenarios.flatMap((scenario) => asArray(scenario?.steps));
  return (
    handlers.length +
    blocks.length +
    scenarios.length +
    steps.length +
    uiStates.length +
    transitions.length +
    handlers.reduce((sum, handler) => sum + countActions(handler?.actions), 0) +
    blocks.reduce((sum, block) => sum + countActions(block?.actions), 0) +
    steps.reduce((sum, step) => sum + countActions(step?.actions), 0)
  );
}

function collectTargets(actions, out = { scenarios: new Set(), blocks: new Set() }) {
  for (const action of asArray(actions)) {
    if (!isObject(action)) continue;
    const target = str(action.target);
    if ((action.type === 'run_scenario' || action.type === 'goto_scenario') && target) {
      out.scenarios.add(target);
    }
    if ((action.type === 'goto_block' || action.type === 'use_block') && target) {
      out.blocks.add(target);
    }
    if (action.type === 'condition') {
      collectTargets(action.then, out);
      collectTargets(action.else, out);
    }
  }
  return out;
}

function scenarioKey(scenario) {
  return str(scenario?.name || scenario?.id);
}

function blockKey(block) {
  return str(block?.name || block?.id);
}

function optionalMetadata(source) {
  if (!isObject(source)) return {};
  const out = {};
  for (const key of ['optional', 'isOptional', 'required', 'priority', 'tags', 'kind']) {
    if (Object.prototype.hasOwnProperty.call(source, key)) out[key] = clone(source[key]);
  }
  if (isObject(source.meta)) {
    out.meta = {
      ...(isObject(out.meta) ? out.meta : {}),
      ...clone(source.meta),
    };
  }
  if (isObject(source.props)) {
    out.props = {
      ...(isObject(out.props) ? out.props : {}),
      ...clone(source.props),
    };
  }
  return out;
}

function enrichOptionalMetadata(normalizedItems, rawItems, keyOf) {
  const rawList = asArray(rawItems);
  const byKey = new Map();
  rawList.forEach((item, index) => {
    const key = keyOf(item) || `#${index}`;
    if (key) byKey.set(key, item);
  });
  return asArray(normalizedItems).map((item, index) => {
    const key = keyOf(item) || `#${index}`;
    const source = byKey.get(key) || rawList[index];
    return { ...item, ...optionalMetadata(source) };
  });
}

function prioritizeHandlers(handlers, maxHandlers, notes) {
  const candidates = asArray(handlers)
    .filter((handler) => !isOptionalNode(handler))
    .map((handler, index) => ({ handler, index }))
    .sort((a, b) => {
      const score = (item) => {
        const handler = item.handler;
        if (handler.type === 'start') return 0;
        if (handler.type === 'command' && str(handler.trigger).replace(/^\/+/, '') === 'start') return 1;
        if (handler.type === 'callback' && String(handler.trigger ?? '') === '') return 2;
        if (handler.type === 'command') return 3;
        if (handler.type === 'callback') return 4;
        return 5;
      };
      return score(a) - score(b) || a.index - b.index;
    });
  const selected = candidates.slice(0, maxHandlers).map((item) => item.handler);
  if (asArray(handlers).length > selected.length) {
    notes.push(`IR_PRUNER: limited handlers from ${asArray(handlers).length} to ${selected.length}`);
  }
  return selected;
}

function selectScenarios(ir, handlers, maxDepth, notes) {
  const scenarios = asArray(ir?.scenarios).filter((scenario) => !isOptionalNode(scenario));
  if (scenarios.length === 0) return [];
  const byName = new Map();
  const byId = new Map();
  for (const scenario of scenarios) {
    if (scenario?.name) byName.set(String(scenario.name), scenario);
    if (scenario?.id) byId.set(String(scenario.id), scenario);
  }
  const roots = new Set();
  for (const handler of handlers) collectTargets(handler?.actions).scenarios.forEach((target) => roots.add(target));
  if (roots.size === 0 && scenarios[0]) roots.add(scenarioKey(scenarios[0]));

  const keep = new Set();
  const queue = [...roots].map((target) => ({ target, depth: 1 }));
  while (queue.length > 0) {
    const { target, depth } = queue.shift();
    const scenario = byName.get(String(target)) || byId.get(String(target));
    if (!scenario) continue;
    const key = scenarioKey(scenario);
    if (!key || keep.has(key)) continue;
    if (depth > maxDepth) {
      notes.push(`IR_PRUNER: removed nested scenario "${key}" deeper than depth ${maxDepth}`);
      continue;
    }
    keep.add(key);
    const childTargets = new Set();
    for (const step of asArray(scenario.steps)) {
      collectTargets(step?.actions).scenarios.forEach((child) => childTargets.add(child));
    }
    childTargets.forEach((child) => queue.push({ target: child, depth: depth + 1 }));
  }
  const selected = scenarios.filter((scenario) => keep.has(scenarioKey(scenario)));
  if (selected.length < scenarios.length) {
    notes.push(`IR_PRUNER: limited scenarios from ${scenarios.length} to ${selected.length || 0}`);
  }
  return selected;
}

function splitButtonRows(rows) {
  return String(rows || '')
    .split('\n')
    .map((row) => row.split(',').map((label) => label.trim()).filter(Boolean))
    .filter((row) => row.length > 0);
}

function filterButtonRows(rows, allowedCallbacks) {
  const filtered = splitButtonRows(rows)
    .map((row) => row.filter((label) => allowedCallbacks.has(label)))
    .filter((row) => row.length > 0);
  return filtered.map((row) => row.join(', ')).join('\n');
}

function pruneActions(actions, context, depth = 0) {
  const out = [];
  for (const action of asArray(actions)) {
    if (out.length >= context.maxActionsPerList) {
      context.notes.push(`IR_PRUNER: limited action list to ${context.maxActionsPerList}`);
      break;
    }
    if (!isObject(action) || isOptionalNode(action)) {
      if (isOptionalNode(action)) context.notes.push('IR_PRUNER: removed optional action');
      continue;
    }
    const type = String(action.type || '');
    if ((type === 'run_scenario' || type === 'goto_scenario') && action.target) {
      const target = String(action.target);
      if (!context.allowedScenarioTargets.has(target)) {
        context.notes.push(`IR_PRUNER: flattened transition to removed scenario "${target}"`);
        out.push({ type: 'message', text: 'Этот раздел упрощён для стабильного выполнения.' }, { type: 'stop' });
        continue;
      }
    }
    if ((type === 'goto_block' || type === 'use_block') && action.target) {
      const target = String(action.target);
      if (!context.allowedBlockTargets.has(target)) {
        context.notes.push(`IR_PRUNER: flattened transition to removed block "${target}"`);
        out.push({ type: 'message', text: 'Этот блок упрощён для стабильного выполнения.' });
        continue;
      }
    }
    if (type === 'buttons') {
      const rows = filterButtonRows(action.rows, context.allowedCallbacks);
      if (!rows) {
        context.notes.push('IR_PRUNER: removed buttons without kept handlers');
        continue;
      }
      out.push({ ...action, rows });
      continue;
    }
    if (type === 'inline_db' && !context.allowedCallbacks.has('')) {
      context.notes.push('IR_PRUNER: removed inline_db without generic callback handler');
      out.push({ type: 'message', text: 'Каталог временно упрощён. Попробуйте выбрать раздел из меню.' });
      continue;
    }
    if (type === 'condition') {
      if (depth >= context.maxDepth) {
        context.notes.push(`IR_PRUNER: flattened nested condition deeper than depth ${context.maxDepth}`);
        out.push({ type: 'message', text: 'Ветка сценария упрощена для стабильного выполнения.' }, { type: 'stop' });
        continue;
      }
      const thenActions = pruneActions(action.then, context, depth + 1);
      out.push({
        ...action,
        then: thenActions.length ? thenActions : [{ type: 'message', text: 'Продолжим.' }],
      });
      if (Object.prototype.hasOwnProperty.call(action, 'else')) {
        context.notes.push('IR_PRUNER: removed optional else/fallback branch');
      }
      continue;
    }
    out.push(action);
  }
  return out;
}

function selectBlocks(ir, handlers, scenarios, maxBlocks, notes) {
  const blocks = asArray(ir?.blocks).filter((block) => !isOptionalNode(block));
  if (blocks.length === 0) return [];
  const wanted = new Set();
  for (const handler of handlers) collectTargets(handler?.actions).blocks.forEach((target) => wanted.add(target));
  for (const scenario of scenarios) {
    for (const step of asArray(scenario?.steps)) {
      collectTargets(step?.actions).blocks.forEach((target) => wanted.add(target));
    }
  }
  const selected = blocks
    .filter((block) => wanted.size === 0 || wanted.has(blockKey(block)) || wanted.has(str(block?.id)))
    .slice(0, maxBlocks);
  if (blocks.length > selected.length) {
    notes.push(`IR_PRUNER: limited blocks from ${blocks.length} to ${selected.length || 0}`);
  }
  return selected;
}

function pruneUiStates(uiStates, allowedCallbacks, maxUiStates) {
  return asArray(uiStates)
    .filter((state) => !isOptionalNode(state))
    .slice(0, maxUiStates)
    .map((state) => {
      const next = { ...state };
      if (next.buttons) {
        const rows = filterButtonRows(next.buttons, allowedCallbacks);
        if (rows) next.buttons = rows;
        else delete next.buttons;
      }
      if (next.inlineDb && !allowedCallbacks.has('')) delete next.inlineDb;
      return next;
    });
}

function hasElseBranches(actions) {
  for (const action of asArray(actions)) {
    if (!isObject(action)) continue;
    if (action.type === 'condition') {
      if (Object.prototype.hasOwnProperty.call(action, 'else')) return true;
      if (hasElseBranches(action.then)) return true;
    }
  }
  return false;
}

export function pruneIrForRecovery(ir, options = {}) {
  const settings = { ...IR_PRUNER_DEFAULTS, ...(options || {}) };
  const notes = [];
  const raw = clone(ir);
  const current = normalizeAiCanonicalIr(raw);
  current.handlers = enrichOptionalMetadata(current.handlers, raw.handlers, (handler) => str(handler?.id));
  current.blocks = enrichOptionalMetadata(current.blocks, raw.blocks, blockKey);
  current.scenarios = enrichOptionalMetadata(current.scenarios, raw.scenarios, scenarioKey);
  const beforeNodeCount = countIrNodes(current);
  const handlersSeed = prioritizeHandlers(current.handlers, settings.maxHandlers, notes);
  const scenariosSeed = selectScenarios(current, handlersSeed, settings.maxDepth, notes);
  const blocksSeed = selectBlocks(current, handlersSeed, scenariosSeed, settings.maxBlocks, notes);
  const allowedScenarioTargets = new Set();
  for (const scenario of scenariosSeed) {
    if (scenario?.name) allowedScenarioTargets.add(String(scenario.name));
    if (scenario?.id) allowedScenarioTargets.add(String(scenario.id));
  }
  const allowedBlockTargets = new Set();
  for (const block of blocksSeed) {
    if (block?.name) allowedBlockTargets.add(String(block.name));
    if (block?.id) allowedBlockTargets.add(String(block.id));
  }
  const allowedCallbacks = new Set(
    handlersSeed
      .filter((handler) => handler?.type === 'callback')
      .map((handler) => String(handler.trigger ?? '')),
  );
  const context = {
    notes,
    allowedScenarioTargets,
    allowedBlockTargets,
    allowedCallbacks,
    maxDepth: settings.maxDepth,
    maxActionsPerList: settings.maxActionsPerList,
  };
  const handlers = handlersSeed.map((handler) => ({
    ...handler,
    actions: pruneActions(handler.actions, context),
  }));
  const scenarios = scenariosSeed
    .map((scenario) => ({
      ...scenario,
      steps: asArray(scenario.steps).slice(0, settings.maxStepsPerScenario).map((step) => ({
        ...step,
        actions: pruneActions(step.actions, context),
      })),
    }))
    .filter((scenario) => asArray(scenario.steps).length > 0);
  const blocks = blocksSeed.map((block) => ({
    ...block,
    actions: pruneActions(block.actions, context),
  }));
  const uiStates = pruneUiStates(current.uiStates, allowedCallbacks, settings.maxUiStates);

  const pruned = normalizeAiCanonicalIr({
    ...current,
    handlers,
    blocks,
    scenarios,
    transitions: [],
    uiStates,
  });
  const afterNodeCount = countIrNodes(pruned);
  const pruningReductionRatio = beforeNodeCount > 0
    ? Number(((beforeNodeCount - afterNodeCount) / beforeNodeCount).toFixed(4))
    : 0;
  pruned.meta = {
    ...(isObject(current.meta) ? current.meta : {}),
    IR_PRUNED: true,
    irPruned: true,
    pruningReductionRatio,
    beforeNodeCount,
    afterNodeCount,
    pruner: 'core/ai/irPruner.mjs',
    constraints: {
      maxDepth: settings.maxDepth,
      maxHandlers: settings.maxHandlers,
      maxActionsPerList: settings.maxActionsPerList,
    },
    notes: unique(notes),
  };
  return {
    ir: pruned,
    pruned: true,
    pruningReductionRatio,
    beforeNodeCount,
    afterNodeCount,
    notes: unique(notes),
  };
}

export function assertPrunedRecoveryIr(ir, options = {}) {
  const settings = { ...IR_PRUNER_DEFAULTS, ...(options || {}) };
  const meta = isObject(ir?.meta) ? ir.meta : {};
  const constraints = isObject(meta.constraints) ? meta.constraints : {};
  const handlers = asArray(ir?.handlers);
  const scenarios = asArray(ir?.scenarios);
  const blocks = asArray(ir?.blocks);
  const hasFallbackBranches = (
    handlers.some((handler) => hasElseBranches(handler?.actions)) ||
    blocks.some((block) => hasElseBranches(block?.actions)) ||
    scenarios.some((scenario) => asArray(scenario?.steps).some((step) => hasElseBranches(step?.actions)))
  );
  const invalid = (
    meta.IR_PRUNED !== true ||
    meta.irPruned !== true ||
    handlers.length > settings.maxHandlers ||
    asArray(ir?.transitions).length > 0 ||
    hasFallbackBranches ||
    Number(constraints.maxDepth || 0) > settings.maxDepth ||
    Number(constraints.maxHandlers || 0) > settings.maxHandlers
  );
  if (invalid) {
    const error = new Error('AI_RECOVERY requires an IR_PRUNED snapshot from irPruner.');
    error.code = AI_RECOVERY_INVALID_INPUT;
    error.details = {
      IR_PRUNED: Boolean(meta.IR_PRUNED),
      handlers: handlers.length,
      transitions: asArray(ir?.transitions).length,
      hasFallbackBranches,
      constraints,
    };
    throw error;
  }
  return true;
}
