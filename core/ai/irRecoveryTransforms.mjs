import { normalizeAiCanonicalIr } from './aiCanonicalIr.mjs';
import { resolveFeatureDependencies } from './featureDependencyResolver.mjs';
import { reconcileIrGraph } from './graphReconciler.mjs';
import { repairIrDeterministic } from './irRepairEngine.mjs';
import { validateIrSemanticGate } from './irSemanticGate.mjs';

const FALLBACK_MESSAGE = 'Сценарий временно упрощён для стабильного запуска.';
const BRANCH_FALLBACK_MESSAGE = 'Эта ветка временно упрощена.';

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

function str(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function unique(values) {
  return [...new Set(asArray(values).filter(Boolean).map(String))];
}

function fallbackActions(message = FALLBACK_MESSAGE) {
  return [{ type: 'message', text: message }, { type: 'stop' }];
}

function splitButtonRows(rows) {
  return String(rows || '')
    .split('\n')
    .map((row) => row.split(',').map((label) => label.trim()).filter(Boolean))
    .filter((row) => row.length > 0);
}

function buttonLabel(value) {
  return str(value)
    .split(/\s*(?:->|=>|→|\|)\s*/)[0]
    .replace(/^["«]+|["»]+$/g, '')
    .trim();
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

function collectActionTargets(actions, out = { scenarios: new Set(), blocks: new Set(), commands: new Set() }) {
  for (const action of asArray(actions)) {
    if (!isObject(action)) continue;
    const target = str(action.target);
    if ((action.type === 'run_scenario' || action.type === 'goto_scenario' || action.type === 'goto') && target) {
      out.scenarios.add(target);
    }
    if ((action.type === 'use_block' || action.type === 'goto_block' || action.type === 'goto') && target) {
      out.blocks.add(target);
    }
    if (action.type === 'goto_command' && target) out.commands.add(target.startsWith('/') ? target : `/${target}`);
    if (action.type === 'condition') {
      collectActionTargets(action.then, out);
      collectActionTargets(action.else, out);
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

function declaredGraph(ir) {
  return {
    scenarios: new Set(asArray(ir.scenarios).flatMap((scenario) => [scenario?.name, scenario?.id].map(str).filter(Boolean))),
    blocks: new Set(asArray(ir.blocks).flatMap((block) => [block?.name, block?.id].map(str).filter(Boolean))),
    commands: new Set([
      '/start',
      ...asArray(ir.handlers)
        .filter((handler) => handler?.type === 'command')
        .map((handler) => str(handler.trigger))
        .filter(Boolean)
        .map((trigger) => (trigger.startsWith('/') ? trigger : `/${trigger}`)),
    ]),
    callbacks: new Set(asArray(ir.handlers).filter((handler) => handler?.type === 'callback').map((handler) => String(handler.trigger ?? ''))),
    uiStates: new Set(asArray(ir.uiStates).map((state) => str(state?.id)).filter(Boolean)),
  };
}

function mapActions(actions, mapper) {
  return asArray(actions).flatMap((action) => {
    if (!isObject(action)) return [];
    let next = { ...action };
    if (next.type === 'condition') {
      next.then = mapActions(next.then, mapper);
      if (Object.prototype.hasOwnProperty.call(next, 'else')) {
        next.else = mapActions(next.else, mapper);
      }
    }
    const mapped = mapper(next);
    return Array.isArray(mapped) ? mapped : [mapped];
  });
}

function mutateAllActionLists(ir, mapper) {
  const next = clone(ir);
  next.handlers = asArray(next.handlers).map((handler) => ({ ...handler, actions: mapActions(handler.actions, mapper) }));
  next.blocks = asArray(next.blocks).map((block) => ({ ...block, actions: mapActions(block.actions, mapper) }));
  next.scenarios = asArray(next.scenarios).map((scenario) => ({
    ...scenario,
    steps: asArray(scenario.steps).map((step) => ({ ...step, actions: mapActions(step.actions, mapper) })),
  }));
  return next;
}

function hasTerminalAction(actions) {
  return asArray(actions).some((action) => {
    if (!isObject(action)) return false;
    if (action.type === 'condition') return hasTerminalAction(action.then) || hasTerminalAction(action.else);
    return ['message', 'buttons', 'inline_db', 'ask', 'send_file', 'ui_state', 'stop', 'run_scenario', 'goto_command', 'goto_block', 'goto_scenario', 'goto', 'use_block'].includes(action.type);
  });
}

export function hasExecutableIrHandlers(ir) {
  return asArray(ir?.handlers).some((handler) => asArray(handler?.actions).length > 0 && hasTerminalAction(handler.actions));
}

function passNormalizeCallbacks(ir) {
  let changed = false;
  let next = clone(ir);
  next.handlers = asArray(next.handlers).map((handler, index) => {
    const out = { ...handler };
    if (out.type === 'callback' && typeof out.trigger !== 'string') {
      out.trigger = String(out.trigger ?? '');
      changed = true;
    }
    if (!out.id) {
      out.id = `handler_${index + 1}`;
      changed = true;
    }
    return out;
  });

  let genericInlineRequired = false;
  next.uiStates = asArray(next.uiStates).map((state) => {
    if (!isObject(state?.inlineDb)) return state;
    const inlineDb = { ...state.inlineDb };
    if (!str(inlineDb.callbackPrefix)) {
      inlineDb.callbackPrefix = 'item:';
      changed = true;
    }
    genericInlineRequired = true;
    return { ...state, inlineDb };
  });
  next = mutateAllActionLists(next, (action) => {
    if (action.type !== 'inline_db') return action;
    genericInlineRequired = true;
    if (str(action.callbackPrefix)) return action;
    changed = true;
    return { ...action, callbackPrefix: 'item:' };
  });

  const callbacks = new Set(asArray(next.handlers).filter((handler) => handler?.type === 'callback').map((handler) => String(handler.trigger ?? '')));
  if (genericInlineRequired && !callbacks.has('')) {
    next.handlers.push({
      id: `recovery_inline_callback_${next.handlers.length + 1}`,
      type: 'callback',
      trigger: '',
      actions: fallbackActions('Выбор обработан.'),
    });
    changed = true;
  }

  return {
    ir: next,
    changed,
    notes: changed ? ['normalize callbacks'] : [],
  };
}

function passInlineSimpleBlocks(ir, options = {}) {
  const maxActions = Number(options.maxInlineBlockActions || 3);
  const next = clone(ir);
  const blocksByKey = new Map();
  for (const block of asArray(next.blocks)) {
    const actions = asArray(block.actions);
    if (countActions(actions) <= maxActions) {
      if (block.name) blocksByKey.set(String(block.name), actions);
      if (block.id) blocksByKey.set(String(block.id), actions);
    }
  }
  if (!blocksByKey.size) return { ir: next, changed: false, notes: [] };

  let changed = false;
  const inlinedTargets = new Set();
  const inlined = mutateAllActionLists(next, (action) => {
    if ((action.type !== 'use_block' && action.type !== 'goto_block') || !str(action.target)) return action;
    const blockActions = blocksByKey.get(str(action.target));
    if (!blockActions) return action;
    changed = true;
    inlinedTargets.add(str(action.target));
    return clone(blockActions);
  });
  if (!changed) return { ir: next, changed: false, notes: [] };

  const references = collectActionTargets([
    ...asArray(inlined.handlers).flatMap((handler) => handler.actions),
    ...asArray(inlined.scenarios).flatMap((scenario) => asArray(scenario.steps).flatMap((step) => step.actions)),
  ]).blocks;
  inlined.blocks = asArray(inlined.blocks).filter((block) => {
    const key = blockKey(block);
    return !inlinedTargets.has(key) || references.has(key);
  });

  return {
    ir: inlined,
    changed,
    notes: [`inline simple blocks: ${unique([...inlinedTargets]).join(', ')}`],
  };
}

function collapseConditionAction(action, depth, maxDepth, state) {
  if (!isObject(action) || action.type !== 'condition') return action;
  const next = { ...action };
  next.then = asArray(next.then).map((child) => collapseConditionAction(child, depth + 1, maxDepth, state));
  if (Object.prototype.hasOwnProperty.call(next, 'else')) {
    next.else = asArray(next.else).map((child) => collapseConditionAction(child, depth + 1, maxDepth, state));
    if (!next.else.length) {
      delete next.else;
      state.changed = true;
      state.notes.add('branch pruning');
    }
  }

  if (depth >= maxDepth) {
    state.changed = true;
    state.notes.add('collapse nested conditions');
    return { type: 'message', text: BRANCH_FALLBACK_MESSAGE };
  }

  if (next.then.length === 1 && next.then[0]?.type === 'condition' && !Object.prototype.hasOwnProperty.call(next, 'else')) {
    const inner = next.then[0];
    state.changed = true;
    state.notes.add('collapse nested conditions');
    return {
      ...inner,
      cond: `(${str(next.cond)}) и (${str(inner.cond)})`,
    };
  }

  return next;
}

function passCollapseNestedConditions(ir, options = {}) {
  const maxDepth = Number(options.maxConditionDepth || 2);
  const state = { changed: false, notes: new Set() };
  const next = mutateAllActionLists(ir, (action) => collapseConditionAction(action, 0, maxDepth, state));
  return { ir: next, changed: state.changed, notes: [...state.notes] };
}

function passRepairMissingTransitions(ir) {
  const next = clone(ir);
  const graph = declaredGraph(next);
  const missingCallbacks = new Set();
  let changed = false;
  let graphPatched = false;

  const repaired = mutateAllActionLists(next, (action) => {
    const target = str(action.target);
    if ((action.type === 'run_scenario' || action.type === 'goto_scenario') && target && !graph.scenarios.has(target)) {
      changed = true;
      graphPatched = true;
      return fallbackActions(`Раздел "${target}" временно недоступен.`);
    }
    if ((action.type === 'use_block' || action.type === 'goto_block') && target && !graph.blocks.has(target)) {
      changed = true;
      graphPatched = true;
      return fallbackActions(`Блок "${target}" временно недоступен.`);
    }
    if (action.type === 'goto_command' && target) {
      const command = target.startsWith('/') ? target : `/${target}`;
      if (!graph.commands.has(command)) {
        changed = true;
        graphPatched = true;
        return fallbackActions(`Команда "${command}" временно недоступна.`);
      }
    }
    if (action.type === 'ui_state') {
      const uiStateId = str(action.uiStateId || action.id || action.target);
      if (uiStateId && !graph.uiStates.has(uiStateId)) {
        changed = true;
        graphPatched = true;
        return { type: 'message', text: FALLBACK_MESSAGE };
      }
    }
    if (action.type === 'buttons') {
      for (const row of splitButtonRows(action.rows)) {
        for (const rawLabel of row) {
          const label = buttonLabel(rawLabel);
          if (label && !graph.callbacks.has(label)) missingCallbacks.add(label);
        }
      }
    }
    return action;
  });

  for (const label of missingCallbacks) {
    repaired.handlers.push({
      id: `recovery_callback_${repaired.handlers.length + 1}`,
      type: 'callback',
      trigger: label,
      actions: fallbackActions('Раздел временно упрощён.'),
    });
    changed = true;
    graphPatched = true;
  }
  repaired.transitions = [];

  return {
    ir: repaired,
    changed,
    graphPatched,
    notes: changed ? ['repair missing transitions'] : [],
  };
}

function passInjectFallbackResponses(ir) {
  let changed = false;
  const next = clone(ir);
  const firstScenario = scenarioKey(asArray(next.scenarios)[0]);
  if (!hasExecutableIrHandlers(next)) {
    next.handlers = [{
      id: 'recovery_start',
      type: 'start',
      trigger: '',
      actions: firstScenario
        ? [{ type: 'run_scenario', target: firstScenario }, { type: 'stop' }]
        : fallbackActions(),
    }];
    changed = true;
  } else if (!asArray(next.handlers).some((handler) => handler?.type === 'start')) {
    next.handlers.unshift({
      id: 'recovery_start',
      type: 'start',
      trigger: '',
      actions: firstScenario
        ? [{ type: 'run_scenario', target: firstScenario }, { type: 'stop' }]
        : fallbackActions(),
    });
    changed = true;
  }

  next.handlers = asArray(next.handlers).map((handler) => {
    const actions = asArray(handler.actions);
    if (actions.length && hasTerminalAction(actions)) return handler;
    changed = true;
    return { ...handler, actions: fallbackActions() };
  });
  next.blocks = asArray(next.blocks).map((block) => {
    const actions = asArray(block.actions);
    if (actions.length && hasTerminalAction(actions)) return block;
    changed = true;
    return { ...block, actions: fallbackActions() };
  });
  next.scenarios = asArray(next.scenarios).map((scenario) => {
    const steps = asArray(scenario.steps);
    const repairedSteps = steps.length ? steps : [{
      id: `${scenario.id || 'scenario'}_recovery_step`,
      name: 'старт',
      actions: fallbackActions(),
    }];
    if (!steps.length) changed = true;
    return {
      ...scenario,
      steps: repairedSteps.map((step) => {
        const actions = asArray(step.actions);
        if (actions.length && hasTerminalAction(actions)) return step;
        changed = true;
        return { ...step, actions: fallbackActions() };
      }),
    };
  });

  return {
    ir: next,
    changed,
    notes: changed ? ['inject fallback responses'] : [],
  };
}

function passRemoveUnreachableScenarios(ir) {
  const next = clone(ir);
  const scenarios = asArray(next.scenarios);
  if (!scenarios.length) return { ir: next, changed: false, notes: [] };
  const byKey = new Map();
  for (const scenario of scenarios) {
    const key = scenarioKey(scenario);
    if (key) byKey.set(key, scenario);
    if (scenario?.id) byKey.set(String(scenario.id), scenario);
  }

  const reachable = new Set();
  const queue = [];
  for (const handler of asArray(next.handlers)) {
    collectActionTargets(handler.actions).scenarios.forEach((target) => queue.push(target));
  }
  while (queue.length) {
    const target = queue.shift();
    const scenario = byKey.get(String(target));
    const key = scenarioKey(scenario);
    if (!scenario || !key || reachable.has(key)) continue;
    reachable.add(key);
    for (const step of asArray(scenario.steps)) {
      collectActionTargets(step.actions).scenarios.forEach((child) => queue.push(child));
    }
  }

  const kept = reachable.size ? scenarios.filter((scenario) => reachable.has(scenarioKey(scenario))) : [];
  if (kept.length === scenarios.length) return { ir: next, changed: false, notes: [] };
  next.scenarios = kept;
  return {
    ir: next,
    changed: true,
    notes: [`remove unreachable scenarios: ${scenarios.length} -> ${kept.length}`],
  };
}

export function runDeterministicRecoveryPipeline(ir, options = {}) {
  let current = normalizeAiCanonicalIr(ir);
  const sourceMeta = isObject(ir?.meta) ? clone(ir.meta) : {};
  const notes = [];
  const appliedPasses = [];
  let graphPatched = false;
  const passes = [
    ['normalize callbacks', passNormalizeCallbacks],
    ['inline simple blocks', passInlineSimpleBlocks],
    ['collapse nested conditions', passCollapseNestedConditions],
    ['repair missing transitions', passRepairMissingTransitions],
    ['inject fallback responses', passInjectFallbackResponses],
    ['remove unreachable scenarios', passRemoveUnreachableScenarios],
  ];

  for (const [name, pass] of passes) {
    const result = pass(current, options);
    current = normalizeAiCanonicalIr(result.ir);
    if (result.changed) {
      appliedPasses.push(name);
      notes.push(...asArray(result.notes));
    }
    graphPatched = graphPatched || Boolean(result.graphPatched);
  }

  const dependencyResolution = resolveFeatureDependencies(current, options);
  current = normalizeAiCanonicalIr(dependencyResolution.ir);
  if (dependencyResolution.changed) {
    appliedPasses.push('feature dependency resolver');
    notes.push(...dependencyResolution.repairActions.map((action) => `FDR: ${action}`));
    graphPatched = true;
  }

  const validation = validateIrSemanticGate(current, options);
  if (!validation.ok) {
    const repair = repairIrDeterministic(current, validation.diagnostics, options);
    current = normalizeAiCanonicalIr(repair.ir);
    if (repair.changed) {
      appliedPasses.push('semantic repair');
      notes.push(...repair.notes);
    }
  }
  const reconciliation = reconcileIrGraph(current, options);
  current = normalizeAiCanonicalIr(reconciliation.ir);
  if (reconciliation.changed || reconciliation.diagnostics.length) {
    appliedPasses.push('graph reconciler');
    notes.push(...asArray(reconciliation.notes).map((note) => `GRAPH_RECONCILER: ${note}`));
    graphPatched = true;
  }
  const finalValidation = validateIrSemanticGate(current, options);

  current.meta = {
    ...sourceMeta,
    ...(isObject(current.meta) ? current.meta : {}),
    recoveryPipeline: 'PRUNED_IR->DETERMINISTIC_REPAIR_PASSES->GRAPH_RECONCILER->PARTIAL_IR',
    recoveryNoLlmRequired: true,
    recoveryAppliedPasses: unique(appliedPasses),
    featureGraph: dependencyResolution.featureGraph,
  };

  return {
    ok: finalValidation.ok,
    ir: current,
    validation: finalValidation,
    diagnostics: [...asArray(reconciliation.diagnostics), ...asArray(finalValidation.diagnostics)],
    notes: unique(notes),
    appliedPasses: unique(appliedPasses),
    graphPatched,
    noLlmRequired: true,
  };
}
