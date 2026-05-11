import {
  SEMANTIC_TEMPLATE_IDS,
  buildSemanticTemplateIr,
} from './intentPlanner.mjs';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function walkActions(ir, visit) {
  const walk = (actions, owner) => {
    for (const action of asArray(actions)) {
      if (!isObject(action)) continue;
      visit(action, owner);
      if (action.type === 'condition') {
        walk(action.then, owner);
        walk(action.else, owner);
      }
    }
  };
  for (const handler of asArray(ir?.handlers)) walk(handler.actions, { kind: 'handler', node: handler });
  for (const block of asArray(ir?.blocks)) walk(block.actions, { kind: 'block', node: block });
  for (const scenario of asArray(ir?.scenarios)) {
    for (const step of asArray(scenario.steps)) walk(step.actions, { kind: 'scenarioStep', node: step, scenario });
  }
}

function allActionText(ir) {
  const chunks = [];
  walkActions(ir, (action) => {
    for (const key of ['text', 'value', 'cond', 'question', 'key', 'callbackPrefix']) {
      if (typeof action[key] === 'string') chunks.push(action[key]);
    }
  });
  for (const state of asArray(ir?.uiStates)) {
    if (typeof state?.message === 'string') chunks.push(state.message);
    if (typeof state?.buttons === 'string') chunks.push(state.buttons);
    if (isObject(state?.inlineDb)) chunks.push(JSON.stringify(state.inlineDb));
  }
  return chunks.join('\n');
}

function hasArithmeticExecution(ir) {
  let found = false;
  const arithmeticRe = /(?:в_число\s*\([^)]*\)|\bчисло[12]?\b|\bсумм|\bразност|\bпроизвед|\bделен).*(?:\+|-|\*|\/)|(?:\+|-|\*|\/).*(?:в_число\s*\(|\bчисло[12]?\b)/iu;
  walkActions(ir, (action) => {
    if (found) return;
    if (action.type !== 'message' && action.type !== 'remember' && action.type !== 'condition') return;
    const text = [action.text, action.value, action.cond].filter(Boolean).join(' ');
    if (arithmeticRe.test(text)) found = true;
  });
  return found;
}

function hasCalculatorInputs(ir) {
  const asks = [];
  walkActions(ir, (action) => {
    if (action.type === 'ask') asks.push(`${action.question || ''} ${action.varname || ''}`.toLowerCase());
  });
  return asks.filter((item) => /числ|number|операц|выражен|пример|expression/u.test(item)).length >= 1;
}

function hasEchoResponse(ir) {
  let echo = false;
  walkActions(ir, (action) => {
    if (echo || action.type !== 'message') return;
    const text = str(action.text).toLowerCase();
    if (/\{текст\}|\{сообщение\}|вы написали|повторяю|echo/u.test(text)) echo = true;
  });
  return echo;
}

function hasCatalogCapability(ir) {
  let hasCatalog = false;
  walkActions(ir, (action) => {
    if (action.type === 'inline_db') hasCatalog = true;
    if (action.type === 'buttons' && /каталог|товар|категор/iu.test(str(action.rows))) hasCatalog = true;
  });
  return hasCatalog || /каталог|товар|категор/iu.test(allActionText(ir));
}

function hasSubscriptionCapability(ir) {
  return /подпис|канал|subscriber|subscription/iu.test(allActionText(ir));
}

function hasFormCollectionCapability(ir) {
  let askCount = 0;
  let hasConfirmation = false;
  walkActions(ir, (action) => {
    if (action.type === 'ask') askCount += 1;
    if (action.type === 'message' && /\{[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*\}/u.test(str(action.text))) {
      hasConfirmation = true;
    }
  });
  return askCount > 0 && hasConfirmation;
}

function hasMenuCapability(ir) {
  const hasButtonsState = asArray(ir?.uiStates).some((state) => str(state?.buttons));
  let hasButtonsAction = false;
  walkActions(ir, (action) => {
    if (action.type === 'buttons') hasButtonsAction = true;
  });
  return hasButtonsState || hasButtonsAction;
}

function generatedCapabilities(ir) {
  const capabilities = new Set();
  if (hasArithmeticExecution(ir)) capabilities.add('math_execution');
  if (hasCalculatorInputs(ir)) capabilities.add('expression_parsing');
  if (capabilities.has('math_execution') && capabilities.has('expression_parsing')) {
    capabilities.add('arithmetic_evaluation');
    capabilities.add('deterministic_calculation_block');
  }
  if (hasCatalogCapability(ir)) {
    capabilities.add('catalog_navigation');
    capabilities.add('item_listing');
  }
  if (hasSubscriptionCapability(ir)) {
    capabilities.add('subscription_prompt');
    capabilities.add('subscription_branch');
  }
  if (hasFormCollectionCapability(ir)) {
    capabilities.add('input_collection');
    capabilities.add('confirmation_response');
  }
  if (hasMenuCapability(ir)) {
    capabilities.add('menu_entrypoint');
    capabilities.add('button_navigation');
  }
  return capabilities;
}

function diagnostic(code, message, details = {}) {
  return {
    code,
    severity: 'error',
    message,
    details,
  };
}

function requiredCapabilitiesFor(intentPlan) {
  return asArray(intentPlan?.requiredCapabilities);
}

function templateIdFor(intentPlan) {
  return intentPlan?.knownCapabilityTemplate || SEMANTIC_TEMPLATE_IDS.MENU_BOT;
}

export function validateIntentSatisfaction(ir, { prompt = '', intentPlan } = {}) {
  const templateId = templateIdFor(intentPlan);
  const required = requiredCapabilitiesFor(intentPlan);
  const generated = generatedCapabilities(ir);
  const diagnostics = [];

  if (templateId === SEMANTIC_TEMPLATE_IDS.CALCULATOR) {
    const hasCalculatorCapability = (
      generated.has('math_execution') ||
      generated.has('arithmetic_evaluation') ||
      generated.has('deterministic_calculation_block')
    );
    if (!hasCalculatorCapability) {
      diagnostics.push(diagnostic(
        'INTENT_NOT_SATISFIED',
        'Calculator intent is not satisfied by generated IR.',
        { prompt, templateId },
      ));
      diagnostics.push(diagnostic(
        'MISSING_REQUIRED_CAPABILITY',
        'Calculator bot requires arithmetic evaluation, expression parsing, or deterministic calculation block.',
        { missing: ['arithmetic_evaluation', 'expression_parsing', 'math_execution'] },
      ));
    }
    if (hasEchoResponse(ir) && !hasCalculatorCapability) {
      diagnostics.push(diagnostic(
        'ECHO_RESPONSE_DETECTED',
        'Generated IR echoes user text instead of calculating.',
        { templateId },
      ));
    }
  } else {
    const missing = required.filter((capability) => !generated.has(capability));
    if (missing.length) {
      diagnostics.push(diagnostic(
        'INTENT_NOT_SATISFIED',
        `Generated IR does not satisfy ${templateId} intent.`,
        { templateId, missing },
      ));
      diagnostics.push(diagnostic(
        'MISSING_REQUIRED_CAPABILITY',
        `Missing required capabilities: ${missing.join(', ')}.`,
        { templateId, missing },
      ));
    }
  }

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    requiredCapabilities: required,
    generatedCapabilities: [...generated],
    templateId,
  };
}

export function repairIntentSatisfaction(ir, { prompt = '', intentPlan } = {}) {
  const validation = validateIntentSatisfaction(ir, { prompt, intentPlan });
  if (validation.ok) {
    return {
      ok: true,
      ir,
      validation,
      changed: false,
      diagnostics: [],
      repairNotes: [],
    };
  }

  const templateIr = buildSemanticTemplateIr(intentPlan, { prompt });
  return {
    ok: true,
    ir: templateIr,
    validation,
    changed: true,
    diagnostics: validation.diagnostics,
    repairNotes: [
      `ISV: injected ${validation.templateId} semantic template`,
      'ISV: blocked structurally valid but semantically fake IR',
    ],
  };
}
