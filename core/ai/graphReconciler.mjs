import { normalizeAiCanonicalIr } from './aiCanonicalIr.mjs';
import {
  buildIrSymbolRegistry,
  registryHasBlock,
  registryHasCommand,
  registryHasScenario,
  registryHasUiState,
} from './irSymbolRegistry.mjs';
import { IR_ERROR_CODES, validateIrSemanticGate } from './irSemanticGate.mjs';

export const GRAPH_RECONCILER_DIAGNOSTIC_CODES = Object.freeze({
  DANGLING_TRANSITION_FIXED: 'DANGLING_TRANSITION_FIXED',
  TARGET_REDIRECTED: 'TARGET_REDIRECTED',
  GRAPH_RECONCILED: 'GRAPH_RECONCILED',
});

const FALLBACK_MESSAGE = 'Раздел временно упрощён для стабильного выполнения.';

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

function fallbackActions(message = FALLBACK_MESSAGE) {
  return [{ type: 'message', text: message }, { type: 'stop' }];
}

function diagnostic(code, message, path = 'graph', details = {}, severity = 'info') {
  return { code, severity, message, path, details };
}

function unique(values) {
  return [...new Set(asArray(values).filter(Boolean).map(String))];
}

function splitButtonRows(rows) {
  return String(rows || '')
    .split('\n')
    .map((row) => row.split(',').map((label) => label.trim()).filter(Boolean))
    .filter((row) => row.length > 0);
}

function buttonLabel(value) {
  return str(value)
    .split(/\s*(?:->|=>|→|\|)\s*/u)[0]
    .replace(/^["«]+|["»]+$/g, '')
    .trim();
}

function collectButtonLabels(rows) {
  return splitButtonRows(rows)
    .flatMap((row) => row.map(buttonLabel))
    .filter(Boolean);
}

function normalizeCommand(value) {
  const raw = str(value);
  if (!raw) return '';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function safeIdPart(value, fallback) {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return raw || fallback;
}

function nextUniqueId(existingIds, prefix, label = '') {
  const base = `${prefix}_${safeIdPart(label, 'fallback')}`;
  let id = base;
  let index = 1;
  while (existingIds.has(id)) {
    index += 1;
    id = `${base}_${index}`;
  }
  existingIds.add(id);
  return id;
}

function scenarioTarget(scenario) {
  return str(scenario?.name) || str(scenario?.id);
}

function blockTarget(block) {
  return str(block?.name) || str(block?.id);
}

function preferredScore(value) {
  const normalized = str(value).toLowerCase().replace(/^\/+/, '');
  const preferred = ['main', 'menu', 'start', 'главное', 'главная', 'меню', 'старт', 'начало'];
  const index = preferred.indexOf(normalized);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function choosePreferred(items, targetOf) {
  const candidates = asArray(items)
    .map((item, index) => ({ item, target: targetOf(item), index }))
    .filter((entry) => entry.target);
  if (!candidates.length) return null;
  candidates.sort((a, b) => preferredScore(a.target) - preferredScore(b.target) || a.index - b.index);
  return candidates[0].item;
}

function fallbackScenarioTarget(ir) {
  const scenario = choosePreferred(ir?.scenarios, scenarioTarget);
  return scenario ? scenarioTarget(scenario) : '';
}

function fallbackBlockTarget(ir) {
  const block = choosePreferred(ir?.blocks, blockTarget);
  return block ? blockTarget(block) : '';
}

function fallbackTransitionEndpointId(ir) {
  const scenario = choosePreferred(ir?.scenarios, (item) => str(item?.name) || str(item?.id));
  if (scenario && str(scenario.id)) return str(scenario.id);
  const startHandler = asArray(ir?.handlers).find((handler) => handler?.type === 'start' && str(handler.id));
  if (startHandler) return str(startHandler.id);
  const handler = asArray(ir?.handlers).find((item) => str(item?.id));
  if (handler) return str(handler.id);
  const block = choosePreferred(ir?.blocks, blockTarget);
  if (block && str(block.id)) return str(block.id);
  const uiState = choosePreferred(ir?.uiStates, (item) => str(item?.id));
  return uiState ? str(uiState.id) : '';
}

function transitionActionTargetOk(type, target, registry) {
  if (!target) return true;
  if (type === 'run_scenario' || type === 'goto_scenario') return registryHasScenario(registry, target);
  if (type === 'goto_block' || type === 'use_block') return registryHasBlock(registry, target);
  if (type === 'goto_command') return registryHasCommand(registry, target);
  if (type === 'goto') {
    return (
      target === 'повторить' ||
      target === 'main' ||
      registryHasScenario(registry, target) ||
      registryHasBlock(registry, target) ||
      registryHasCommand(registry, target)
    );
  }
  return true;
}

function isTransitionAction(type) {
  return ['run_scenario', 'goto_command', 'goto_block', 'goto_scenario', 'goto', 'use_block'].includes(type);
}

function mapActions(actions, mapper) {
  return asArray(actions).flatMap((action, index) => {
    if (!isObject(action)) return [action];
    let next = { ...action };
    if (next.type === 'condition') {
      next.then = mapActions(next.then, mapper);
      if (Object.prototype.hasOwnProperty.call(next, 'else')) {
        next.else = mapActions(next.else, mapper);
      }
    }
    const mapped = mapper(next, index);
    return Array.isArray(mapped) ? mapped : [mapped];
  });
}

function mutateAllActionLists(ir, mapper) {
  const next = clone(ir);
  next.handlers = asArray(next.handlers).map((handler, handlerIndex) => ({
    ...handler,
    actions: mapActions(handler.actions, (action, index) => mapper(action, `handlers[${handlerIndex}].actions[${index}]`)),
  }));
  next.blocks = asArray(next.blocks).map((block, blockIndex) => ({
    ...block,
    actions: mapActions(block.actions, (action, index) => mapper(action, `blocks[${blockIndex}].actions[${index}]`)),
  }));
  next.scenarios = asArray(next.scenarios).map((scenario, scenarioIndex) => ({
    ...scenario,
    steps: asArray(scenario.steps).map((step, stepIndex) => ({
      ...step,
      actions: mapActions(
        step.actions,
        (action, index) => mapper(action, `scenarios[${scenarioIndex}].steps[${stepIndex}].actions[${index}]`),
      ),
    })),
  }));
  return next;
}

function ensureCallbackHandler(ir, label, diagnostics, path) {
  const trigger = String(label ?? '');
  const callbacks = new Set(asArray(ir.handlers).filter((handler) => handler?.type === 'callback').map((handler) => String(handler.trigger ?? '')));
  if (callbacks.has(trigger)) return false;
  const ids = new Set(asArray(ir.handlers).map((handler) => str(handler?.id)).filter(Boolean));
  ir.handlers.push({
    id: nextUniqueId(ids, trigger ? 'graph_callback' : 'graph_inline_callback', trigger || 'generic'),
    type: 'callback',
    trigger,
    actions: fallbackActions(trigger ? `Раздел "${trigger}" временно упрощён.` : 'Выбор обработан.'),
    meta: { graphReconcilerInjected: true },
  });
  diagnostics.push(diagnostic(
    GRAPH_RECONCILER_DIAGNOSTIC_CODES.DANGLING_TRANSITION_FIXED,
    trigger ? `Injected fallback callback handler for "${trigger}".` : 'Injected generic callback handler.',
    path,
    { kind: trigger ? 'callback' : 'inlineCallback', label: trigger },
  ));
  return true;
}

function ensureUiState(ir, id, diagnostics, path) {
  const uiStateId = str(id);
  if (!uiStateId) return false;
  const registry = buildIrSymbolRegistry(ir);
  if (registryHasUiState(registry, uiStateId)) return false;
  ir.uiStates = asArray(ir.uiStates);
  ir.uiStates.push({
    id: uiStateId,
    message: FALLBACK_MESSAGE,
    meta: { graphReconcilerInjected: true },
  });
  diagnostics.push(diagnostic(
    GRAPH_RECONCILER_DIAGNOSTIC_CODES.DANGLING_TRANSITION_FIXED,
    `Recreated minimal uiState "${uiStateId}".`,
    path,
    { kind: 'uiState', uiStateId },
  ));
  return true;
}

function collectMissingCallbackRoutes(ir, diagnostics) {
  let changed = false;
  for (const [stateIndex, state] of asArray(ir.uiStates).entries()) {
    if (!isObject(state)) continue;
    for (const label of collectButtonLabels(state.buttons)) {
      changed = ensureCallbackHandler(ir, label, diagnostics, `uiStates[${stateIndex}].buttons`) || changed;
    }
    if (isObject(state.inlineDb)) {
      changed = ensureCallbackHandler(ir, '', diagnostics, `uiStates[${stateIndex}].inlineDb`) || changed;
    }
  }
  return changed;
}

function reconcileActionTargets(ir, options, diagnostics) {
  let changed = false;
  let graphPatched = false;
  const seenInlineDb = { value: false };
  const missingCallbackLabels = new Set();
  const missingUiStateIds = new Set();

  const reconcileOne = (action, path) => {
    const type = str(action.type);
    const target = str(action.target);

    if (type === 'buttons') {
      for (const label of collectButtonLabels(action.rows)) missingCallbackLabels.add(label);
      return action;
    }

    if (type === 'inline_db') {
      seenInlineDb.value = true;
      return action;
    }

    if (type === 'ui_state') {
      const uiStateId = str(action.uiStateId || action.id || action.target);
      if (!uiStateId) {
        changed = true;
        graphPatched = true;
        diagnostics.push(diagnostic(
          GRAPH_RECONCILER_DIAGNOSTIC_CODES.DANGLING_TRANSITION_FIXED,
          'Removed ui_state action without target id.',
          path,
          { kind: 'uiState' },
        ));
        return { type: 'message', text: FALLBACK_MESSAGE };
      }
      const registry = buildIrSymbolRegistry(ir, options);
      if (!registryHasUiState(registry, uiStateId)) {
        missingUiStateIds.add(JSON.stringify({ id: uiStateId, path }));
        changed = true;
        graphPatched = true;
      }
      return action;
    }

    if (!isTransitionAction(type) || !target) return action;

    const registry = buildIrSymbolRegistry(ir, options);
    if (transitionActionTargetOk(type, target, registry)) return action;

    if (type === 'run_scenario' || type === 'goto_scenario') {
      const fallbackTarget = fallbackScenarioTarget(ir);
      changed = true;
      graphPatched = true;
      if (fallbackTarget) {
        diagnostics.push(diagnostic(
          GRAPH_RECONCILER_DIAGNOSTIC_CODES.TARGET_REDIRECTED,
          `${type} target "${target}" redirected to scenario "${fallbackTarget}".`,
          path,
          { actionType: type, from: target, to: fallbackTarget, targetKind: 'scenario' },
        ));
        return { ...action, target: fallbackTarget };
      }
      diagnostics.push(diagnostic(
        GRAPH_RECONCILER_DIAGNOSTIC_CODES.TARGET_REDIRECTED,
        `${type} target "${target}" redirected to main fallback.`,
        path,
        { actionType: type, from: target, to: 'main', targetKind: 'builtin' },
      ));
      return { type: 'goto', target: 'main' };
    }

    if (type === 'goto_block' || type === 'use_block') {
      const fallbackBlock = fallbackBlockTarget(ir);
      changed = true;
      graphPatched = true;
      if (fallbackBlock) {
        diagnostics.push(diagnostic(
          GRAPH_RECONCILER_DIAGNOSTIC_CODES.TARGET_REDIRECTED,
          `${type} target "${target}" redirected to block "${fallbackBlock}".`,
          path,
          { actionType: type, from: target, to: fallbackBlock, targetKind: 'block' },
        ));
        return { ...action, target: fallbackBlock };
      }
      const fallbackScenario = fallbackScenarioTarget(ir);
      if (fallbackScenario) {
        diagnostics.push(diagnostic(
          GRAPH_RECONCILER_DIAGNOSTIC_CODES.TARGET_REDIRECTED,
          `${type} target "${target}" redirected to scenario "${fallbackScenario}".`,
          path,
          { actionType: type, from: target, to: fallbackScenario, targetKind: 'scenario' },
        ));
        return { type: 'run_scenario', target: fallbackScenario };
      }
      diagnostics.push(diagnostic(
        GRAPH_RECONCILER_DIAGNOSTIC_CODES.DANGLING_TRANSITION_FIXED,
        `${type} target "${target}" was removed.`,
        path,
        { actionType: type, target },
      ));
      return fallbackActions(`Блок "${target}" временно недоступен.`);
    }

    if (type === 'goto_command') {
      changed = true;
      graphPatched = true;
      diagnostics.push(diagnostic(
        GRAPH_RECONCILER_DIAGNOSTIC_CODES.TARGET_REDIRECTED,
        `Command target "${target}" redirected to /start.`,
        path,
        { actionType: type, from: target, to: '/start', targetKind: 'command' },
      ));
      return { ...action, target: '/start' };
    }

    if (type === 'goto') {
      const fallbackScenario = fallbackScenarioTarget(ir);
      changed = true;
      graphPatched = true;
      const nextTarget = fallbackScenario || 'main';
      diagnostics.push(diagnostic(
        GRAPH_RECONCILER_DIAGNOSTIC_CODES.TARGET_REDIRECTED,
        `Goto target "${target}" redirected to "${nextTarget}".`,
        path,
        { actionType: type, from: target, to: nextTarget, targetKind: fallbackScenario ? 'scenario' : 'builtin' },
      ));
      return { ...action, target: nextTarget };
    }

    return action;
  };

  let next = mutateAllActionLists(ir, reconcileOne);
  next = normalizeAiCanonicalIr(next);

  for (const encoded of missingUiStateIds) {
    const item = JSON.parse(encoded);
    changed = ensureUiState(next, item.id, diagnostics, item.path) || changed;
    graphPatched = true;
  }
  for (const label of missingCallbackLabels) {
    changed = ensureCallbackHandler(next, label, diagnostics, 'buttons') || changed;
    graphPatched = true;
  }
  if (seenInlineDb.value) {
    changed = ensureCallbackHandler(next, '', diagnostics, 'inline_db') || changed;
    graphPatched = true;
  }
  changed = collectMissingCallbackRoutes(next, diagnostics) || changed;

  return { ir: next, changed, graphPatched };
}

function endpointIds(ir) {
  return new Set([
    ...asArray(ir.handlers).map((item) => str(item?.id)).filter(Boolean),
    ...asArray(ir.scenarios).map((item) => str(item?.id)).filter(Boolean),
    ...asArray(ir.blocks).map((item) => str(item?.id)).filter(Boolean),
    ...asArray(ir.uiStates).map((item) => str(item?.id)).filter(Boolean),
  ]);
}

function reconcileTransitions(ir, options, diagnostics) {
  let next = normalizeAiCanonicalIr(ir);
  let changed = false;
  let graphPatched = false;
  const out = [];

  for (const [index, transition] of asArray(next.transitions).entries()) {
    if (!isObject(transition)) continue;
    const path = `transitions[${index}]`;
    const from = str(transition.from);
    const to = str(transition.to);
    let known = endpointIds(next);

    if (to && !known.has(to) && str(transition.type) === 'ui_state') {
      if (ensureUiState(next, to, diagnostics, path)) {
        changed = true;
        graphPatched = true;
        known = endpointIds(next);
      }
    }

    if (from && !known.has(from)) {
      changed = true;
      graphPatched = true;
      diagnostics.push(diagnostic(
        GRAPH_RECONCILER_DIAGNOSTIC_CODES.DANGLING_TRANSITION_FIXED,
        `Removed transition with missing source "${from}".`,
        path,
        { from, to, reason: 'missingSource' },
      ));
      continue;
    }

    if (to && !known.has(to)) {
      const fallbackId = fallbackTransitionEndpointId(next);
      changed = true;
      graphPatched = true;
      if (fallbackId) {
        diagnostics.push(diagnostic(
          GRAPH_RECONCILER_DIAGNOSTIC_CODES.TARGET_REDIRECTED,
          `Transition target "${to}" redirected to "${fallbackId}".`,
          path,
          { from, to, redirectedTo: fallbackId, targetKind: 'endpoint' },
        ));
        out.push({ ...transition, to: fallbackId });
      } else {
        diagnostics.push(diagnostic(
          GRAPH_RECONCILER_DIAGNOSTIC_CODES.DANGLING_TRANSITION_FIXED,
          `Removed transition with missing target "${to}".`,
          path,
          { from, to, reason: 'missingTarget' },
        ));
      }
      continue;
    }

    out.push(transition);
  }

  next.transitions = out;
  return { ir: next, changed, graphPatched };
}

function isUnresolvedGraphEdgeDiagnostic(item) {
  if (item?.code === IR_ERROR_CODES.INVALID_TRANSITION) return true;
  return item?.code === IR_ERROR_CODES.MISSING_UI_STATE && Boolean(item?.details?.uiStateId);
}

export function graphEdgeDiagnostics(ir, options = {}) {
  const validation = validateIrSemanticGate(ir, options);
  return asArray(validation.diagnostics).filter(isUnresolvedGraphEdgeDiagnostic);
}

export function assertNoUnresolvedGraphEdges(ir, options = {}) {
  const unresolved = graphEdgeDiagnostics(ir, options);
  if (unresolved.length > 0) {
    const error = new Error('Graph transform invariant failed: unresolved graph edges remain.');
    error.code = 'UNRESOLVED_GRAPH_EDGES';
    error.diagnostics = unresolved;
    throw error;
  }
  return true;
}

export function reconcileIrGraph(ir, options = {}) {
  const diagnostics = [];
  let current = normalizeAiCanonicalIr(ir);
  const sourceMeta = isObject(ir?.meta) ? clone(ir.meta) : {};
  let changed = false;
  let graphPatched = false;

  // Registry is intentionally rebuilt after every mutating stage.
  buildIrSymbolRegistry(current, options);

  const actionResult = reconcileActionTargets(current, options, diagnostics);
  current = normalizeAiCanonicalIr(actionResult.ir);
  changed = changed || actionResult.changed;
  graphPatched = graphPatched || actionResult.graphPatched;
  buildIrSymbolRegistry(current, options);

  const transitionResult = reconcileTransitions(current, options, diagnostics);
  current = normalizeAiCanonicalIr(transitionResult.ir);
  changed = changed || transitionResult.changed;
  graphPatched = graphPatched || transitionResult.graphPatched;
  const registry = buildIrSymbolRegistry(current, options);

  const unresolved = graphEdgeDiagnostics(current, options);
  if (changed || graphPatched || diagnostics.length) {
    diagnostics.push(diagnostic(
      GRAPH_RECONCILER_DIAGNOSTIC_CODES.GRAPH_RECONCILED,
      unresolved.length
        ? `Graph reconciled with ${unresolved.length} unresolved edge(s) remaining.`
        : 'Graph reconciled; no unresolved graph edges remain.',
      'graph',
      {
        changed,
        graphPatched,
        unresolvedGraphEdges: unresolved.length,
        diagnostics: unique(diagnostics.map((item) => item.code)),
      },
      unresolved.length ? 'warning' : 'info',
    ));
  }

  current.meta = {
    ...sourceMeta,
    ...(isObject(current.meta) ? current.meta : {}),
    graphReconciled: true,
    graphReconciler: {
      changed,
      graphPatched,
      unresolvedGraphEdges: unresolved.length,
    },
  };

  return {
    ok: unresolved.length === 0,
    ir: current,
    changed,
    graphPatched,
    diagnostics,
    unresolvedDiagnostics: unresolved,
    registry,
    notes: unique(diagnostics.map((item) => item.code)),
  };
}
