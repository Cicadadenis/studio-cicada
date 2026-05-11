import { normalizeAiCanonicalIr } from './aiCanonicalIr.mjs';

export const FDR_DIAGNOSTIC_CODES = Object.freeze({
  MISSING_FEATURE_DEPENDENCY: 'MISSING_FEATURE_DEPENDENCY',
  DEPENDENCY_AUTO_INJECTED: 'DEPENDENCY_AUTO_INJECTED',
  DEPENDENCY_INJECTION_FAILED: 'DEPENDENCY_INJECTION_FAILED',
});

const FEATURE_REQUIREMENTS = Object.freeze({
  inline_db: Object.freeze(['generic_callback_handler', 'callback_routing']),
  scenarios: Object.freeze(['transition_resolver']),
  forms: Object.freeze(['state_persistence']),
  payments: Object.freeze(['payment_callback_handlers']),
  interactive_ui: Object.freeze(['executable_transition_path']),
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function str(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function clone(value) {
  try {
    return JSON.parse(JSON.stringify(value || {}));
  } catch {
    return {};
  }
}

function unique(values) {
  return [...new Set(asArray(values).filter(Boolean).map(String))];
}

function diagnostic(code, message, details = {}, severity = 'warning') {
  return { code, severity, message, details };
}

function safeId(raw, fallback) {
  const cleaned = str(raw)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9_]+/giu, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

function nextId(items, prefix) {
  const existing = new Set(asArray(items).map((item) => str(item?.id)));
  let index = asArray(items).length + 1;
  let id = `${prefix}_${index}`;
  while (existing.has(id)) {
    index += 1;
    id = `${prefix}_${index}`;
  }
  return id;
}

function collectButtonLabels(rows) {
  if (typeof rows !== 'string') return [];
  return rows
    .split('\n')
    .flatMap((row) => row.split(','))
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(/\s*(?:->|=>|→|\|)\s*/)[0].trim())
    .map((part) => part.replace(/^["«]+|["»]+$/g, '').trim())
    .filter(Boolean);
}

function walkActions(ir, visit) {
  const walk = (actions, ownerPath) => {
    asArray(actions).forEach((action, index) => {
      if (!isObject(action)) return;
      const path = `${ownerPath}[${index}]`;
      visit(action, path);
      if (action.type === 'condition') {
        walk(action.then, `${path}.then`);
        walk(action.else, `${path}.else`);
      }
    });
  };

  asArray(ir?.handlers).forEach((handler, index) => walk(handler.actions, `handlers[${index}].actions`));
  asArray(ir?.blocks).forEach((block, index) => walk(block.actions, `blocks[${index}].actions`));
  asArray(ir?.scenarios).forEach((scenario, scenarioIndex) => {
    asArray(scenario.steps).forEach((step, stepIndex) => {
      walk(step.actions, `scenarios[${scenarioIndex}].steps[${stepIndex}].actions`);
    });
  });
}

function mapActions(actions, mapper) {
  return asArray(actions).map((action) => {
    if (!isObject(action)) return action;
    const next = mapper({ ...action });
    if (next?.type === 'condition') {
      next.then = mapActions(next.then, mapper);
      if (Object.prototype.hasOwnProperty.call(next, 'else')) next.else = mapActions(next.else, mapper);
    }
    return next;
  });
}

function callbackTriggers(ir) {
  return new Set(asArray(ir?.handlers)
    .filter((handler) => handler?.type === 'callback')
    .map((handler) => String(handler.trigger ?? '')));
}

function scenarioTargets(ir) {
  const scenarios = asArray(ir?.scenarios);
  return new Set(scenarios.flatMap((scenario) => [str(scenario.id), str(scenario.name)]).filter(Boolean));
}

function transitionReferencesScenario(ir) {
  const targets = scenarioTargets(ir);
  let found = false;
  walkActions(ir, (action) => {
    if (found) return;
    if ((action.type === 'run_scenario' || action.type === 'goto_scenario') && targets.has(str(action.target))) {
      found = true;
    }
  });
  if (found) return true;
  return asArray(ir?.transitions).some((transition) => targets.has(str(transition.to)));
}

function collectInlineDbUses(ir) {
  const uses = [];
  asArray(ir?.uiStates).forEach((state, index) => {
    if (isObject(state?.inlineDb)) {
      uses.push({
        path: `uiStates[${index}].inlineDb`,
        callbackPrefix: str(state.inlineDb.callbackPrefix, 'item:'),
        key: str(state.inlineDb.key),
      });
    }
  });
  walkActions(ir, (action, path) => {
    if (action.type === 'inline_db') {
      uses.push({
        path,
        callbackPrefix: str(action.callbackPrefix, 'item:'),
        key: str(action.key),
      });
    }
  });
  return uses;
}

function collectButtonUses(ir) {
  const labels = [];
  asArray(ir?.uiStates).forEach((state, index) => {
    for (const label of collectButtonLabels(state?.buttons)) {
      labels.push({ label, path: `uiStates[${index}].buttons` });
    }
  });
  walkActions(ir, (action, path) => {
    if (action.type === 'buttons') {
      for (const label of collectButtonLabels(action.rows)) labels.push({ label, path });
    }
  });
  return labels;
}

function collectAskActions(ir) {
  const asks = [];
  walkActions(ir, (action, path) => {
    if (action.type === 'ask') asks.push({ path, varname: str(action.varname) });
  });
  return asks;
}

function collectPaymentSignals(ir, intentPlan) {
  const signals = [];
  const paymentRe = /оплат|плат[её]ж|pay|payment|invoice|checkout/iu;

  if (asArray(intentPlan?.requiredFeatures).some((feature) => paymentRe.test(String(feature)))) {
    signals.push({ path: 'IntentPlan.requiredFeatures', label: 'Оплатить' });
  }

  for (const button of collectButtonUses(ir)) {
    if (paymentRe.test(button.label)) signals.push(button);
  }

  walkActions(ir, (action, path) => {
    const type = str(action.type);
    if (paymentRe.test(type)) signals.push({ path, label: str(action.label || action.text || 'Оплатить'), unsupportedActionType: type });
    if (paymentRe.test(str(action.text)) || paymentRe.test(str(action.question))) {
      signals.push({ path, label: 'Оплатить' });
    }
  });

  return signals;
}

function dependencyNodeId(feature, requirement) {
  return `dep:${feature}:${requirement}`;
}

export function buildFeatureGraph(ir, options = {}) {
  const current = normalizeAiCanonicalIr(ir);
  const triggers = callbackTriggers(current);
  const inlineDbUses = collectInlineDbUses(current);
  const buttons = collectButtonUses(current);
  const asks = collectAskActions(current);
  const paymentSignals = collectPaymentSignals(current, options.intentPlan);
  const scenarios = asArray(current.scenarios);
  const nodes = [];
  const edges = [];
  const requirements = [];

  const addFeature = (feature, details = {}) => {
    const featureNode = `feature:${feature}`;
    if (!nodes.some((node) => node.id === featureNode)) {
      nodes.push({ id: featureNode, kind: 'feature', feature, details });
    }
    for (const requirement of FEATURE_REQUIREMENTS[feature] || []) {
      const depNode = dependencyNodeId(feature, requirement);
      if (!nodes.some((node) => node.id === depNode)) {
        nodes.push({ id: depNode, kind: 'dependency', feature, requirement });
      }
      edges.push({ from: featureNode, to: depNode, type: 'requires' });
    }
  };

  if (inlineDbUses.length) addFeature('inline_db', { count: inlineDbUses.length });
  if (scenarios.length) addFeature('scenarios', { count: scenarios.length });
  if (asks.length || options.intentPlan?.knownCapabilityTemplate === 'form_collection') {
    addFeature('forms', { count: asks.length });
  }
  if (paymentSignals.length) addFeature('payments', { count: paymentSignals.length });
  if (buttons.length || inlineDbUses.length) addFeature('interactive_ui', { buttons: buttons.length, inlineDb: inlineDbUses.length });

  const addRequirement = (feature, requirement, ok, details = {}) => {
    requirements.push({ feature, requirement, ok: Boolean(ok), details });
  };

  for (const use of inlineDbUses) {
    addRequirement('inline_db', 'generic_callback_handler', triggers.has(''), use);
    const generic = asArray(current.handlers).find((handler) => handler?.type === 'callback' && String(handler.trigger ?? '') === '');
    addRequirement('inline_db', 'callback_routing', Boolean(generic && asArray(generic.actions).length > 0), use);
  }

  if (scenarios.length) {
    addRequirement('scenarios', 'transition_resolver', transitionReferencesScenario(current), {
      scenarios: scenarios.map((scenario) => str(scenario.name || scenario.id)).filter(Boolean),
    });
  }

  for (const ask of asks) {
    addRequirement('forms', 'state_persistence', Boolean(ask.varname), ask);
  }

  if (paymentSignals.length) {
    const hasPaymentHandler = asArray(current.handlers).some((handler) =>
      handler?.type === 'callback' && /оплат|плат[её]ж|pay|payment|invoice|checkout|success|cancel/iu.test(String(handler.trigger ?? '')));
    addRequirement('payments', 'payment_callback_handlers', hasPaymentHandler, {
      signals: paymentSignals.map((signal) => signal.path),
    });
  }

  for (const button of buttons) {
    addRequirement('interactive_ui', 'executable_transition_path', triggers.has(button.label), button);
  }
  if (inlineDbUses.length) {
    addRequirement('interactive_ui', 'executable_transition_path', triggers.has(''), {
      inlineDb: inlineDbUses.map((use) => use.path),
    });
  }

  return {
    nodes,
    edges,
    requirements,
    features: unique(nodes.filter((node) => node.kind === 'feature').map((node) => node.feature)),
    missing: requirements.filter((requirement) => !requirement.ok),
  };
}

function buildInlineCallbackActions(prefixes) {
  const knownPrefixes = unique(prefixes).filter(Boolean);
  return [
    { type: 'remember', varname: 'выбор', value: 'callback_data' },
    {
      type: 'message',
      text: knownPrefixes.length
        ? `Выбор обработан: {выбор}`
        : 'Выбор обработан.',
    },
    { type: 'stop' },
  ];
}

function ensureGenericInlineCallback(ir, inlineDbUses) {
  const next = ir;
  const prefixes = inlineDbUses.map((use) => use.callbackPrefix || 'item:');
  const existing = asArray(next.handlers).find((handler) => handler?.type === 'callback' && String(handler.trigger ?? '') === '');
  if (existing) {
    if (asArray(existing.actions).length > 0) return false;
    existing.actions = buildInlineCallbackActions(prefixes);
    existing.meta = {
      ...(isObject(existing.meta) ? existing.meta : {}),
      fdrInjected: true,
      callbackRoutes: prefixes,
    };
    return true;
  }
  next.handlers.push({
    id: nextId(next.handlers, 'fdr_inline_callback'),
    type: 'callback',
    trigger: '',
    actions: buildInlineCallbackActions(prefixes),
    meta: {
      fdrInjected: true,
      callbackRoutes: prefixes,
    },
  });
  return true;
}

function ensureButtonCallbacks(ir, buttons) {
  const triggers = callbackTriggers(ir);
  let changed = false;
  for (const { label } of buttons) {
    if (!label || triggers.has(label)) continue;
    ir.handlers.push({
      id: nextId(ir.handlers, `fdr_callback_${safeId(label, 'button')}`),
      type: 'callback',
      trigger: label,
      actions: [{ type: 'message', text: 'Раздел в разработке.' }, { type: 'stop' }],
      meta: { fdrInjected: true, dependency: 'executable_transition_path' },
    });
    triggers.add(label);
    changed = true;
  }
  return changed;
}

function firstScenario(ir) {
  return asArray(ir.scenarios).find((scenario) => str(scenario.name) || str(scenario.id));
}

function insertBeforeTrailingStop(actions, additions) {
  const list = asArray(actions);
  const last = list[list.length - 1];
  if (last?.type === 'stop') return [...list.slice(0, -1), ...additions, last];
  return [...list, ...additions];
}

function ensureScenarioTransitionResolver(ir) {
  if (!asArray(ir.scenarios).length || transitionReferencesScenario(ir)) return false;
  const scenario = firstScenario(ir);
  const target = str(scenario?.name || scenario?.id);
  if (!target) return false;

  let entry = asArray(ir.handlers).find((handler) =>
    handler?.type === 'callback' && /начать|start|заполн|оформ|посчит|расч[её]т/iu.test(String(handler.trigger ?? '')));
  if (!entry) {
    entry = {
      id: nextId(ir.handlers, 'fdr_scenario_entry'),
      type: 'callback',
      trigger: 'Начать',
      actions: [],
      meta: { fdrInjected: true, dependency: 'transition_resolver' },
    };
    ir.handlers.push(entry);
  }
  entry.actions = [{ type: 'run_scenario', target }, { type: 'stop' }];

  let startHandler = asArray(ir.handlers).find((handler) => handler?.type === 'start');
  if (!startHandler) {
    startHandler = {
      id: nextId(ir.handlers, 'fdr_start'),
      type: 'start',
      trigger: '',
      actions: [],
      meta: { fdrInjected: true, dependency: 'transition_resolver' },
    };
    ir.handlers.unshift(startHandler);
  }
  const hasEntryButton = collectButtonLabels(startHandler.actions?.find((action) => action?.type === 'buttons')?.rows || '')
    .includes(String(entry.trigger ?? ''));
  if (!hasEntryButton) {
    startHandler.actions = insertBeforeTrailingStop(startHandler.actions, [
      { type: 'buttons', rows: String(entry.trigger ?? 'Начать') },
    ]);
  }

  ir.transitions = [
    ...asArray(ir.transitions),
    { from: entry.id, to: str(scenario.id || scenario.name), type: 'run_scenario', fdrInjected: true },
  ];
  return true;
}

function ensureFormStatePersistence(ir) {
  let index = 1;
  let changed = false;
  const mapper = (action) => {
    if (action.type !== 'ask' || str(action.varname)) return action;
    changed = true;
    const next = { ...action, varname: `ответ_${index}` };
    index += 1;
    return next;
  };

  ir.handlers = asArray(ir.handlers).map((handler) => ({ ...handler, actions: mapActions(handler.actions, mapper) }));
  ir.blocks = asArray(ir.blocks).map((block) => ({ ...block, actions: mapActions(block.actions, mapper) }));
  ir.scenarios = asArray(ir.scenarios).map((scenario) => ({
    ...scenario,
    steps: asArray(scenario.steps).map((step) => ({ ...step, actions: mapActions(step.actions, mapper) })),
  }));
  return changed;
}

function ensurePaymentCallbacks(ir, paymentSignals) {
  const triggers = callbackTriggers(ir);
  let changed = false;
  const labels = unique(paymentSignals.map((signal) => signal.label).filter(Boolean));
  for (const label of labels) {
    if (!label || triggers.has(label)) continue;
    ir.handlers.push({
      id: nextId(ir.handlers, `fdr_payment_${safeId(label, 'pay')}`),
      type: 'callback',
      trigger: label,
      actions: [{ type: 'message', text: 'Платёж принят в обработку.' }, { type: 'stop' }],
      meta: { fdrInjected: true, dependency: 'payment_callback_handlers' },
    });
    triggers.add(label);
    changed = true;
  }
  for (const trigger of ['payment_success', 'payment_cancel']) {
    if (triggers.has(trigger)) continue;
    ir.handlers.push({
      id: nextId(ir.handlers, `fdr_${trigger}`),
      type: 'callback',
      trigger,
      actions: [
        { type: 'message', text: trigger.endsWith('success') ? 'Платёж успешно обработан.' : 'Платёж отменён.' },
        { type: 'stop' },
      ],
      meta: { fdrInjected: true, dependency: 'payment_callback_handlers' },
    });
    triggers.add(trigger);
    changed = true;
  }
  return changed;
}

function injectionMessage(dependency) {
  if (dependency === 'generic_callback_handler' || dependency === 'callback_routing') {
    return 'Injected generic callback handler for inline_db routing.';
  }
  if (dependency === 'executable_transition_path') return 'Injected callback handler for interactive UI transition path.';
  if (dependency === 'transition_resolver') return 'Injected scenario transition resolver.';
  if (dependency === 'state_persistence') return 'Injected form state varname for ask action.';
  if (dependency === 'payment_callback_handlers') return 'Injected payment callback handlers.';
  return `Injected dependency ${dependency}.`;
}

export function resolveFeatureDependencies(ir, options = {}) {
  const sourceMeta = isObject(ir?.meta) ? clone(ir.meta) : {};
  const next = clone(normalizeAiCanonicalIr(ir));
  const initialGraph = buildFeatureGraph(next, options);
  const diagnostics = [];
  const repairActions = [];
  let changed = false;

  for (const missing of initialGraph.missing) {
    diagnostics.push(diagnostic(
      FDR_DIAGNOSTIC_CODES.MISSING_FEATURE_DEPENDENCY,
      `${missing.feature} requires ${missing.requirement}.`,
      missing,
    ));
  }

  const inlineDbUses = collectInlineDbUses(next);
  if (inlineDbUses.length && ensureGenericInlineCallback(next, inlineDbUses)) {
    changed = true;
    repairActions.push(injectionMessage('generic_callback_handler'));
  }

  const buttonUses = collectButtonUses(next);
  if (buttonUses.length && ensureButtonCallbacks(next, buttonUses)) {
    changed = true;
    repairActions.push(injectionMessage('executable_transition_path'));
  }

  if (asArray(next.scenarios).length && ensureScenarioTransitionResolver(next)) {
    changed = true;
    repairActions.push(injectionMessage('transition_resolver'));
  }

  if (collectAskActions(next).some((ask) => !ask.varname) && ensureFormStatePersistence(next)) {
    changed = true;
    repairActions.push(injectionMessage('state_persistence'));
  }

  const paymentSignals = collectPaymentSignals(next, options.intentPlan);
  if (paymentSignals.length && ensurePaymentCallbacks(next, paymentSignals)) {
    changed = true;
    repairActions.push(injectionMessage('payment_callback_handlers'));
  }

  const unsupportedPaymentActions = paymentSignals.filter((signal) => signal.unsupportedActionType);
  for (const signal of unsupportedPaymentActions) {
    diagnostics.push(diagnostic(
      FDR_DIAGNOSTIC_CODES.DEPENDENCY_INJECTION_FAILED,
      `Payment action type "${signal.unsupportedActionType}" is not supported by Canonical IR runtime.`,
      signal,
      'error',
    ));
  }

  const finalGraph = buildFeatureGraph(next, options);
  const unresolved = finalGraph.missing.filter((missing) => !(
    missing.feature === 'payments' && unsupportedPaymentActions.length === 0
  ));
  for (const missing of unresolved) {
    diagnostics.push(diagnostic(
      FDR_DIAGNOSTIC_CODES.DEPENDENCY_INJECTION_FAILED,
      `Could not satisfy ${missing.feature} dependency ${missing.requirement}.`,
      missing,
      'error',
    ));
  }

  if (changed) {
    for (const action of unique(repairActions)) {
      diagnostics.push(diagnostic(
        FDR_DIAGNOSTIC_CODES.DEPENDENCY_AUTO_INJECTED,
        action,
        { action },
        'info',
      ));
    }
  }

  const normalized = normalizeAiCanonicalIr(next);
  normalized.meta = {
    ...sourceMeta,
    featureGraph: finalGraph,
    fdrApplied: true,
  };

  return {
    ok: diagnostics.every((item) => item.severity !== 'error'),
    ir: normalized,
    changed,
    diagnostics,
    repairActions: unique(repairActions),
    featureGraph: finalGraph,
  };
}
