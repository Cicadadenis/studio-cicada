import {
  buildIrSymbolRegistry,
  isForbiddenInventedSymbol,
  registryHasBlock,
  registryHasCommand,
  registryHasDbKey,
  registryHasScenario,
  registryHasUiState,
} from './irSymbolRegistry.mjs';

export const IR_ERROR_CODES = Object.freeze({
  SYNTAX_ERROR: 'SYNTAX_ERROR',
  SEMANTIC_ERROR: 'SEMANTIC_ERROR',
  EMPTY_BRANCH: 'EMPTY_BRANCH',
  UNKNOWN_SYMBOL: 'UNKNOWN_SYMBOL',
  UNREACHABLE_FLOW: 'UNREACHABLE_FLOW',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  MISSING_UI_STATE: 'MISSING_UI_STATE',
});

const BUILTIN_FUNCTIONS = new Set([
  'начинается_с',
  'содержит',
  'срез',
  'длина',
  'число',
  'тип',
  'округлить',
  'абс',
  'мин',
  'макс',
  'верхний',
  'нижний',
  'обрезать',
  'разделить',
  'соединить',
  'кодировать_url',
  'в_число',
  'в_строку',
  'в_булево',
]);

const LITERAL_WORDS = new Set([
  'true',
  'false',
  'null',
  'истина',
  'ложь',
  'пусто',
  'и',
  'или',
  'не',
]);

const VAR_RE = /(?<![A-Za-zА-Яа-яЁё_0-9.])([A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*(?:\.[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*)?)(?![A-Za-zА-Яа-яЁё_0-9.])/gu;
const TEMPLATE_RE = /\{([A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_.]*)\}/gu;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function diagnostic(code, message, path, details = {}) {
  return {
    code,
    message,
    path,
    severity: 'error',
    details,
  };
}

function stripQuotedStrings(value) {
  return String(value || '')
    .replace(/"[^"\n]*"|'[^'\n]*'|«[^»\n]*»|“[^”\n]*”/g, ' ');
}

function variableBase(name) {
  return str(name).split('.')[0];
}

function hasVariable(scope, name) {
  const raw = str(name);
  const base = variableBase(raw);
  return Boolean(scope.has(raw) || scope.has(base));
}

function extractTemplateVars(value) {
  if (typeof value !== 'string' || !value.includes('{')) return [];
  return [...value.matchAll(TEMPLATE_RE)].map((m) => m[1]).filter(Boolean);
}

function extractExpressionVars(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  const src = stripQuotedStrings(value).replace(/\{[^}]*\}/g, ' ');
  const out = [];
  for (const match of src.matchAll(VAR_RE)) {
    const name = match[1];
    const after = src.slice(match.index + name.length).trimStart();
    if (after.startsWith('(') && BUILTIN_FUNCTIONS.has(name)) continue;
    if (BUILTIN_FUNCTIONS.has(name) || LITERAL_WORDS.has(name)) continue;
    if (/^\d/.test(name)) continue;
    out.push(name);
  }
  return out;
}

function looksLikeExpression(value) {
  const src = stripQuotedStrings(value).replace(/\{[^}]*\}/g, ' ');
  return /[()<>!=+\-*/]|\b(?:и|или|не|содержит|начинается_с)\b/u.test(src);
}

function extractValueRefs(value) {
  return [
    ...extractTemplateVars(String(value ?? '')),
    ...(looksLikeExpression(String(value ?? '')) ? extractExpressionVars(String(value ?? '')) : []),
  ];
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

function validateSymbolName(name, kind, path, diagnostics) {
  const symbol = variableBase(name);
  if (!symbol) return;
  if (isForbiddenInventedSymbol(symbol)) {
    diagnostics.push(diagnostic(
      IR_ERROR_CODES.UNKNOWN_SYMBOL,
      `${path}: invented ${kind} "${symbol}" is forbidden`,
      path,
      { kind, symbol, invented: true },
    ));
  }
}

function validateVarRefs(refs, scope, path, diagnostics) {
  for (const ref of refs) {
    const symbol = variableBase(ref);
    validateSymbolName(symbol, 'variable', path, diagnostics);
    if (!hasVariable(scope, ref)) {
      diagnostics.push(diagnostic(
        IR_ERROR_CODES.UNKNOWN_SYMBOL,
        `${path}: unknown variable "${ref}"`,
        path,
        { kind: 'variable', symbol: ref },
      ));
    }
  }
}

function validateDbKey(key, path, registry, diagnostics) {
  const symbol = str(key);
  if (!symbol) return;
  validateSymbolName(symbol, 'dbKey', path, diagnostics);
  if (!registryHasDbKey(registry, symbol)) {
    diagnostics.push(diagnostic(
      IR_ERROR_CODES.UNKNOWN_SYMBOL,
      `${path}: unknown db key "${symbol}"`,
      path,
      { kind: 'dbKey', symbol },
    ));
  }
}

function cloneScope(scope) {
  return new Set(scope);
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
    const type = str(action.type);
    if (type === 'condition') {
      const rest = list.slice(index + 1);
      const thenReachable = hasReachableTerminal([...asArray(action.then), ...rest]);
      const hasElse = Object.prototype.hasOwnProperty.call(action, 'else');
      const elseReachable = hasElse
        ? hasReachableTerminal([...asArray(action.else), ...rest])
        : hasReachableTerminal(rest);
      return thenReachable && elseReachable;
    }
    if (isTerminalUiAction(type)) return true;
  }
  return false;
}

function validateTerminalReachable(actions, path, diagnostics) {
  if (!hasReachableTerminal(actions)) {
    diagnostics.push(diagnostic(
      IR_ERROR_CODES.MISSING_UI_STATE,
      `${path}: no reachable terminal UI, transition, or stop action`,
      path,
      { kind: 'terminalUi' },
    ));
  }
}

function validateTransitionAction(action, path, registry, diagnostics) {
  const type = str(action.type);
  const target = str(action.target);
  if (!target) return;
  let ok = true;
  if (type === 'run_scenario' || type === 'goto_scenario') ok = registryHasScenario(registry, target);
  else if (type === 'goto_block' || type === 'use_block') ok = registryHasBlock(registry, target);
  else if (type === 'goto_command') ok = registryHasCommand(registry, target);
  else if (type === 'goto') {
    ok =
      target === 'повторить' ||
      target === 'main' ||
      registryHasScenario(registry, target) ||
      registryHasBlock(registry, target) ||
      registryHasCommand(registry, target);
  }
  if (!ok) {
    diagnostics.push(diagnostic(
      IR_ERROR_CODES.INVALID_TRANSITION,
      `${path}: ${type} target "${target}" is not declared`,
      path,
      { actionType: type, target },
    ));
  }
}

function validateUiStateAction(action, path, registry, diagnostics) {
  const uiStateId = str(action.uiStateId || action.id || action.target);
  if (!registryHasUiState(registry, uiStateId)) {
    diagnostics.push(diagnostic(
      IR_ERROR_CODES.MISSING_UI_STATE,
      `${path}: ui_state "${uiStateId}" is not declared`,
      path,
      { uiStateId },
    ));
  }
}

function validateActionList(actions, path, scope, registry, diagnostics) {
  const nextScope = cloneScope(scope);
  asArray(actions).forEach((action, index) => {
    validateAction(action, `${path}[${index}]`, nextScope, registry, diagnostics);
  });
  return nextScope;
}

function validateAction(action, path, scope, registry, diagnostics) {
  if (!isObject(action)) return;
  const type = str(action.type);

  if (type === 'message') {
    validateVarRefs(extractTemplateVars(action.text), scope, path, diagnostics);
    return;
  }

  if (type === 'buttons') {
    for (const label of collectButtonLabels(action.rows)) {
      if (!registry.callbacks.has(label)) {
        diagnostics.push(diagnostic(
          IR_ERROR_CODES.INVALID_TRANSITION,
          `${path}: button "${label}" has no callback handler`,
          path,
          { kind: 'callback', label },
        ));
      }
    }
    return;
  }

  if (type === 'inline_db') {
    validateDbKey(action.key, path, registry, diagnostics);
    if (!registry.callbacks.has('')) {
      diagnostics.push(diagnostic(
        IR_ERROR_CODES.INVALID_TRANSITION,
        `${path}: inline_db requires generic callback handler`,
        path,
        { kind: 'inlineCallback', callbackPrefix: str(action.callbackPrefix) },
      ));
    }
    return;
  }

  if (type === 'ask') {
    validateSymbolName(action.varname, 'variable', path, diagnostics);
    if (str(action.varname)) scope.add(str(action.varname));
    return;
  }

  if (type === 'remember') {
    validateSymbolName(action.varname, 'variable', path, diagnostics);
    validateVarRefs(extractValueRefs(action.value), scope, path, diagnostics);
    if (str(action.varname)) scope.add(str(action.varname));
    return;
  }

  if (type === 'get') {
    validateDbKey(action.key, path, registry, diagnostics);
    validateSymbolName(action.varname, 'variable', path, diagnostics);
    if (str(action.varname)) scope.add(str(action.varname));
    return;
  }

  if (type === 'save' || type === 'save_global') {
    validateDbKey(action.key, path, registry, diagnostics);
    validateVarRefs(extractValueRefs(action.value), scope, path, diagnostics);
    return;
  }

  if (type === 'send_file') {
    validateVarRefs(
      [...extractTemplateVars(String(action.file ?? '')), ...extractExpressionVars(String(action.file ?? ''))],
      scope,
      path,
      diagnostics,
    );
    return;
  }

  if (type === 'ui_state') {
    validateUiStateAction(action, path, registry, diagnostics);
    return;
  }

  if (isTransitionAction(type)) {
    validateTransitionAction(action, path, registry, diagnostics);
    return;
  }

  if (type === 'condition') {
    validateVarRefs(extractExpressionVars(action.cond), scope, path, diagnostics);
    const thenActions = asArray(action.then);
    const hasElse = Object.prototype.hasOwnProperty.call(action, 'else');
    const elseActions = asArray(action.else);
    if (thenActions.length === 0) {
      diagnostics.push(diagnostic(
        IR_ERROR_CODES.EMPTY_BRANCH,
        `${path}: condition.then must not be empty`,
        path,
        { branch: 'then' },
      ));
    }
    if (hasElse && elseActions.length === 0) {
      diagnostics.push(diagnostic(
        IR_ERROR_CODES.EMPTY_BRANCH,
        `${path}: condition.else must not be empty`,
        path,
        { branch: 'else' },
      ));
    }
    validateActionList(thenActions, `${path}.then`, cloneScope(scope), registry, diagnostics);
    validateActionList(elseActions, `${path}.else`, cloneScope(scope), registry, diagnostics);
  }
}

function validateUiStates(ir, registry, diagnostics) {
  asArray(ir?.uiStates).forEach((state, index) => {
    if (!isObject(state)) return;
    const path = `uiStates[${index}]`;
    if (isObject(state.inlineDb)) validateDbKey(state.inlineDb.key, `${path}.inlineDb`, registry, diagnostics);
    for (const label of collectButtonLabels(state.buttons)) {
      if (!registry.callbacks.has(label)) {
        diagnostics.push(diagnostic(
          IR_ERROR_CODES.INVALID_TRANSITION,
          `${path}: button "${label}" has no callback handler`,
          path,
          { kind: 'callback', label },
        ));
      }
    }
  });
}

function validateTransitions(ir, registry, diagnostics) {
  const knownIds = new Set([
    ...registry.handlers,
    ...registry.scenarioIds,
    ...registry.blockIds,
    ...registry.uiStates,
  ]);
  asArray(ir?.transitions).forEach((transition, index) => {
    if (!isObject(transition)) return;
    const path = `transitions[${index}]`;
    const from = str(transition.from);
    const to = str(transition.to);
    if ((from && !knownIds.has(from)) || (to && !knownIds.has(to))) {
      diagnostics.push(diagnostic(
        IR_ERROR_CODES.INVALID_TRANSITION,
        `${path}: transition references undeclared endpoint`,
        path,
        { from, to },
      ));
    }
  });
}

export function validateIrSemanticGate(ir, options = {}) {
  const registry = buildIrSymbolRegistry(ir, options);
  const diagnostics = [];
  const baseScope = new Set(registry.variables);

  validateUiStates(ir, registry, diagnostics);
  validateTransitions(ir, registry, diagnostics);

  asArray(ir?.blocks).forEach((block, index) => {
    const path = `blocks[${index}].actions`;
    const scope = cloneScope(baseScope);
    validateActionList(block?.actions, path, scope, registry, diagnostics);
  });

  asArray(ir?.scenarios).forEach((scenario, scenarioIndex) => {
    const scenarioPath = `scenarios[${scenarioIndex}]`;
    const scenarioScope = cloneScope(baseScope);
    const steps = asArray(scenario?.steps);
    if (steps.length === 0) {
      diagnostics.push(diagnostic(
        IR_ERROR_CODES.EMPTY_BRANCH,
        `${scenarioPath}: scenario must have entry step`,
        scenarioPath,
        { branch: 'scenario' },
      ));
    }
    steps.forEach((step, stepIndex) => {
      const actions = asArray(step?.actions);
      const path = `${scenarioPath}.steps[${stepIndex}].actions`;
      if (actions.length === 0) {
        diagnostics.push(diagnostic(
          IR_ERROR_CODES.EMPTY_BRANCH,
          `${path}: step must have body`,
          path,
          { branch: 'step' },
        ));
      } else {
        validateTerminalReachable(actions, path, diagnostics);
      }
      const nextScope = validateActionList(actions, path, scenarioScope, registry, diagnostics);
      nextScope.forEach((name) => scenarioScope.add(name));
    });
  });

  asArray(ir?.handlers).forEach((handler, index) => {
    const path = `handlers[${index}].actions`;
    const actions = asArray(handler?.actions);
    if (actions.length === 0) {
      diagnostics.push(diagnostic(
        IR_ERROR_CODES.EMPTY_BRANCH,
        `${path}: handler must have body`,
        path,
        { branch: 'handler' },
      ));
    } else {
      validateTerminalReachable(actions, path, diagnostics);
    }
    validateActionList(actions, path, cloneScope(baseScope), registry, diagnostics);
  });

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    errors: diagnostics.map((d) => `[${d.code}] ${d.message}`),
    warnings: [],
    registry,
  };
}

export function formatIrDiagnostic(diagnosticItem) {
  if (!diagnosticItem) return '';
  return `[${diagnosticItem.code || 'IR'}] ${diagnosticItem.message || String(diagnosticItem)}`;
}
