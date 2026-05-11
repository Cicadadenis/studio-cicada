import { normalizeAiCanonicalIr } from './aiCanonicalIr.mjs';

export const INTENT_COMPLEXITY = Object.freeze({
  SIMPLE: 'SIMPLE',
  MEDIUM: 'MEDIUM',
  ADVANCED: 'ADVANCED',
});

const COMPLEXITY_BUDGETS = Object.freeze({
  [INTENT_COMPLEXITY.SIMPLE]: Object.freeze({
    maxHandlers: 4,
    maxScenarios: 1,
    maxBlocks: 1,
    maxUiStates: 2,
    maxConditionDepth: 1,
    allowNestedFlows: false,
  }),
  [INTENT_COMPLEXITY.MEDIUM]: Object.freeze({
    maxHandlers: 6,
    maxScenarios: 2,
    maxBlocks: 2,
    maxUiStates: 4,
    maxConditionDepth: 2,
    allowNestedFlows: false,
  }),
  [INTENT_COMPLEXITY.ADVANCED]: Object.freeze({
    maxHandlers: 8,
    maxScenarios: 4,
    maxBlocks: 3,
    maxUiStates: 6,
    maxConditionDepth: 2,
    allowNestedFlows: true,
  }),
});

export const SEMANTIC_TEMPLATE_IDS = Object.freeze({
  CALCULATOR: 'calculator',
  CATALOG: 'catalog',
  SUBSCRIPTION: 'subscription',
  FORM_COLLECTION: 'form_collection',
  MENU_BOT: 'menu_bot',
});

const TEMPLATE_CAPABILITIES = Object.freeze({
  [SEMANTIC_TEMPLATE_IDS.CALCULATOR]: Object.freeze([
    'arithmetic_evaluation',
    'expression_parsing',
    'math_execution',
  ]),
  [SEMANTIC_TEMPLATE_IDS.CATALOG]: Object.freeze([
    'catalog_navigation',
    'item_listing',
  ]),
  [SEMANTIC_TEMPLATE_IDS.SUBSCRIPTION]: Object.freeze([
    'subscription_prompt',
    'subscription_branch',
  ]),
  [SEMANTIC_TEMPLATE_IDS.FORM_COLLECTION]: Object.freeze([
    'input_collection',
    'confirmation_response',
  ]),
  [SEMANTIC_TEMPLATE_IDS.MENU_BOT]: Object.freeze([
    'menu_entrypoint',
    'button_navigation',
  ]),
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

function str(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

function unique(values) {
  return [...new Set(asArray(values).filter(Boolean).map(String))];
}

function slug(raw, fallback) {
  const cleaned = str(raw)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9_]+/giu, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

function detectBotType(text) {
  if (includesAny(text, ['калькулятор', 'посчитай', 'расчет', 'расчёт', 'вычисл'])) return 'calculator';
  if (includesAny(text, ['подписк', 'канал', 'subscriber', 'subscription'])) return 'subscription';
  if (includesAny(text, ['магазин', 'каталог', 'товар', 'корзин', 'заказ'])) return 'commerce';
  if (includesAny(text, ['запись', 'бронь', 'расписан', 'встреч'])) return 'booking';
  if (includesAny(text, ['тест', 'опрос', 'анкета', 'викторин'])) return 'survey';
  if (includesAny(text, ['файл', 'документ', 'загруз', 'скач'])) return 'file_storage';
  if (includesAny(text, ['авторизац', 'логин', 'парол'])) return 'auth';
  if (includesAny(text, ['поддержк', 'helpdesk', 'заявк'])) return 'support';
  return 'informational';
}

function templateForBotType(botType, features = []) {
  if (botType === 'calculator') return SEMANTIC_TEMPLATE_IDS.CALCULATOR;
  if (botType === 'commerce' || features.includes('inline_catalog')) return SEMANTIC_TEMPLATE_IDS.CATALOG;
  if (botType === 'subscription') return SEMANTIC_TEMPLATE_IDS.SUBSCRIPTION;
  if (['booking', 'survey', 'file_storage', 'auth', 'support'].includes(botType)) {
    return SEMANTIC_TEMPLATE_IDS.FORM_COLLECTION;
  }
  return SEMANTIC_TEMPLATE_IDS.MENU_BOT;
}

function featureCatalog(botType, text) {
  const features = [];
  if (botType === 'calculator') features.push('calculate_from_user_input');
  if (botType === 'commerce') features.push('show_catalog_or_order_entry');
  if (botType === 'booking') features.push('collect_booking_request');
  if (botType === 'survey') features.push('collect_answers');
  if (botType === 'file_storage') features.push('accept_or_return_file_id');
  if (botType === 'auth') features.push('collect_credentials');
  if (botType === 'support') features.push('collect_support_request');
  if (!features.length) features.push('show_intro_and_help');

  if (includesAny(text, ['кнопк', 'меню'])) features.push('main_menu');
  if (includesAny(text, ['услов', 'если', 'провер'])) features.push('simple_condition');
  if (includesAny(text, ['база', 'бд', 'сохран', 'корзин'])) features.push('memory_storage');
  if (includesAny(text, ['inline', 'категор', 'товар'])) features.push('inline_catalog');

  return unique(features).slice(0, 5);
}

function complexityFor(prompt, features, botType) {
  const text = prompt.toLowerCase();
  let score = 0;
  if (prompt.length > 160) score += 1;
  if (prompt.length > 320) score += 1;
  if (features.length > 2) score += 1;
  if (includesAny(text, ['интеграц', 'оплат', 'рассылка', 'админ', 'роль', 'сегмент', 'api', 'webhook'])) score += 2;
  if (includesAny(text, ['каталог', 'корзин', 'авторизац', 'файл', 'документ'])) score += 1;
  if (botType === 'calculator' && prompt.length < 80) score = 0;
  if (score <= 1) return INTENT_COMPLEXITY.SIMPLE;
  if (score <= 3) return INTENT_COMPLEXITY.MEDIUM;
  return INTENT_COMPLEXITY.ADVANCED;
}

function buildMinimalFlow(botType, budget) {
  const scenarioName = botType === 'calculator' ? 'расчет' : slug(botType, 'основной_сценарий');
  const needsScenario = botType !== 'informational';
  const handlers = [{ id: 'h_start', type: 'start', trigger: '' }];
  if (botType === 'calculator') handlers.push({ id: 'h_text', type: 'text', trigger: '' });
  else if (needsScenario) handlers.push({ id: 'h_main_action', type: 'callback', trigger: 'Начать' });

  const uiStates = [{
    id: 'ui_start',
    purpose: 'minimal entry screen',
    message: botType === 'calculator'
      ? 'Введите выражение для расчёта.'
      : 'Краткое приветствие и один основной CTA.',
    buttons: needsScenario && botType !== 'calculator' ? 'Начать' : '',
  }];

  const minimalFlows = needsScenario
    ? [{
      id: 'flow_main',
      from: botType === 'calculator' ? 'h_text' : 'h_main_action',
      to: scenarioName,
      steps: botType === 'calculator'
        ? ['ask_or_use_text_input', 'reply_with_result_placeholder']
        : ['collect_minimum_required_input', 'confirm_request'],
    }]
    : [{
      id: 'flow_start',
      from: 'h_start',
      to: 'message',
      steps: ['show_intro', 'stop'],
    }];

  const scenarios = needsScenario && budget.maxScenarios > 0
    ? [{ id: `sc_${slug(scenarioName, 'main')}`, name: scenarioName, maxSteps: botType === 'calculator' ? 1 : 2 }]
    : [];

  return {
    nodes: [
      ...handlers.map((handler) => ({ id: handler.id, kind: 'handler', type: handler.type, trigger: handler.trigger })),
      ...uiStates.map((state) => ({ id: state.id, kind: 'uiState' })),
      ...scenarios.map((scenario) => ({ id: scenario.id, kind: 'scenario', name: scenario.name })),
    ],
    edges: minimalFlows.map((flow) => ({ from: flow.from, to: flow.to, type: 'minimal_flow' })),
    minimalFlows,
    requiredHandlers: handlers,
    uiStates,
    scenarios,
  };
}

export function intentPlanner(prompt) {
  const rawPrompt = String(prompt || '').trim();
  const text = rawPrompt.toLowerCase();
  const botType = detectBotType(text);
  const requiredFeatures = featureCatalog(botType, text);
  const complexityScore = complexityFor(rawPrompt, requiredFeatures, botType);
  const budget = COMPLEXITY_BUDGETS[complexityScore];
  const knownCapabilityTemplate = templateForBotType(botType, requiredFeatures);
  const graph = buildMinimalFlow(botType, budget);

  return {
    botType,
    requiredFeatures,
    knownCapabilityTemplate,
    requiredCapabilities: TEMPLATE_CAPABILITIES[knownCapabilityTemplate] || [],
    minimalFlows: graph.minimalFlows,
    requiredHandlers: graph.requiredHandlers.slice(0, budget.maxHandlers),
    uiStates: graph.uiStates.slice(0, budget.maxUiStates),
    transitions: graph.edges,
    complexityScore,
    budget,
    constraints: {
      limitComplexity: true,
      forbidPrematureScenarios: true,
      minimalViableFlowOnly: true,
      refuseOverGeneration: true,
    },
    minimalExecutionGraph: {
      nodes: graph.nodes,
      edges: graph.edges,
    },
  };
}

export function buildSemanticTemplateIr(plan, options = {}) {
  const templateId = plan?.knownCapabilityTemplate || SEMANTIC_TEMPLATE_IDS.MENU_BOT;
  const prompt = str(options.prompt || '');
  const base = {
    irVersion: 1,
    targetCore: '0.3.4',
    compatibilityMode: '0.3.4 exact',
    intent: {
      primary: templateId,
      plannedBotType: plan?.botType || templateId,
      complexityScore: plan?.complexityScore || INTENT_COMPLEXITY.SIMPLE,
      semanticTemplate: templateId,
    },
    state: { globals: [] },
    uiStates: [],
    handlers: [],
    blocks: [],
    scenarios: [],
    transitions: [],
  };

  if (templateId === SEMANTIC_TEMPLATE_IDS.CALCULATOR) {
    return normalizeAiCanonicalIr({
      ...base,
      intent: { ...base.intent, primary: 'calculator' },
      uiStates: [{
        id: 'ui_start',
        message: 'Калькулятор: выберите действие.',
        buttons: 'Посчитать',
      }],
      handlers: [
        { id: 'h_start', type: 'start', trigger: '', actions: [{ type: 'ui_state', uiStateId: 'ui_start' }, { type: 'stop' }] },
        { id: 'h_calc', type: 'callback', trigger: 'Посчитать', actions: [{ type: 'run_scenario', target: 'расчет' }] },
      ],
      scenarios: [{
        id: 'sc_calc',
        name: 'расчет',
        steps: [
          { id: 'step_a', name: 'число_1', actions: [{ type: 'ask', question: 'Введите первое число:', varname: 'число1' }] },
          { id: 'step_b', name: 'число_2', actions: [{ type: 'ask', question: 'Введите второе число:', varname: 'число2' }] },
          {
            id: 'step_result',
            name: 'результат',
            actions: [
              {
                type: 'message',
                text:
                  'Результаты:\\n' +
                  'Сумма: {в_число(число1) + в_число(число2)}\\n' +
                  'Разность: {в_число(число1) - в_число(число2)}\\n' +
                  'Произведение: {в_число(число1) * в_число(число2)}\\n' +
                  'Деление: {в_число(число1) / в_число(число2)}',
              },
              { type: 'stop' },
            ],
          },
        ],
      }],
      transitions: [{ from: 'h_calc', to: 'sc_calc', type: 'run_scenario' }],
    });
  }

  if (templateId === SEMANTIC_TEMPLATE_IDS.CATALOG) {
    return normalizeAiCanonicalIr({
      ...base,
      intent: { ...base.intent, primary: 'catalog' },
      state: { globals: [{ name: 'категории', value: '["Категория 1", "Категория 2"]' }] },
      uiStates: [
        { id: 'ui_menu', message: 'Каталог: выберите действие.', buttons: 'Каталог' },
        {
          id: 'ui_catalog',
          message: 'Выберите категорию:',
          inlineDb: { key: 'категории', callbackPrefix: 'cat:', backText: 'Назад', backCallback: 'back', columns: '1' },
        },
      ],
      handlers: [
        { id: 'h_start', type: 'start', trigger: '', actions: [{ type: 'ui_state', uiStateId: 'ui_menu' }, { type: 'stop' }] },
        { id: 'h_catalog', type: 'callback', trigger: 'Каталог', actions: [{ type: 'ui_state', uiStateId: 'ui_catalog' }, { type: 'stop' }] },
        {
          id: 'h_inline',
          type: 'callback',
          trigger: '',
          actions: [
            { type: 'remember', varname: 'выбор', value: 'callback_data' },
            { type: 'message', text: 'Вы выбрали: {выбор}' },
            { type: 'stop' },
          ],
        },
      ],
      transitions: [{ from: 'h_catalog', to: 'ui_catalog', type: 'ui_state' }],
    });
  }

  if (templateId === SEMANTIC_TEMPLATE_IDS.SUBSCRIPTION) {
    return normalizeAiCanonicalIr({
      ...base,
      intent: { ...base.intent, primary: 'subscription' },
      uiStates: [{ id: 'ui_start', message: 'Проверьте подписку и нажмите кнопку.', buttons: 'Я подписался' }],
      handlers: [
        { id: 'h_start', type: 'start', trigger: '', actions: [{ type: 'ui_state', uiStateId: 'ui_start' }, { type: 'stop' }] },
        { id: 'h_subscribed', type: 'callback', trigger: 'Я подписался', actions: [{ type: 'message', text: 'Спасибо! Продолжаем.' }, { type: 'stop' }] },
      ],
    });
  }

  if (templateId === SEMANTIC_TEMPLATE_IDS.FORM_COLLECTION) {
    return normalizeAiCanonicalIr({
      ...base,
      intent: { ...base.intent, primary: 'form_collection' },
      uiStates: [{ id: 'ui_start', message: 'Заполните короткую форму.', buttons: 'Начать' }],
      handlers: [
        { id: 'h_start', type: 'start', trigger: '', actions: [{ type: 'ui_state', uiStateId: 'ui_start' }, { type: 'stop' }] },
        { id: 'h_start_form', type: 'callback', trigger: 'Начать', actions: [{ type: 'run_scenario', target: 'форма' }] },
      ],
      scenarios: [{
        id: 'sc_form',
        name: 'форма',
        steps: [
          { id: 'step_name', name: 'имя', actions: [{ type: 'ask', question: 'Как вас зовут?', varname: 'имя' }] },
          { id: 'step_contact', name: 'контакт', actions: [{ type: 'ask', question: 'Оставьте контакт:', varname: 'контакт' }, { type: 'message', text: 'Спасибо, {имя}! Заявка принята: {контакт}' }, { type: 'stop' }] },
        ],
      }],
    });
  }

  return normalizeAiCanonicalIr({
    ...base,
    intent: { ...base.intent, primary: 'menu_bot', sourcePrompt: prompt.slice(0, 120) },
    uiStates: [{ id: 'ui_start', message: 'Главное меню. Выберите действие.', buttons: 'Помощь' }],
    handlers: [
      { id: 'h_start', type: 'start', trigger: '', actions: [{ type: 'ui_state', uiStateId: 'ui_start' }, { type: 'stop' }] },
      { id: 'h_help', type: 'callback', trigger: 'Помощь', actions: [{ type: 'message', text: 'Опишите, что нужно сделать.' }, { type: 'stop' }] },
    ],
  });
}

export function buildIntentPlanPromptContext(plan) {
  const safePlan = isObject(plan) ? plan : intentPlanner('');
  return [
    '',
    '═══ INTENT PLANNING LAYER (обязательно соблюдать) ═══',
    'Перед Canonical IR уже построены IntentPlan и MinimalExecutionGraph. Генератор IR обязан следовать им.',
    'Запрещено расширять функциональность сверх requiredFeatures и minimalFlows.',
    'Запрещены premature scenarios: сценарии можно создавать только если они есть в MinimalExecutionGraph и в пределах budget.',
    'Если хочется добавить extra menu/about/help, откажись от этого и оставь minimal viable flow.',
    `complexityScore: ${safePlan.complexityScore}`,
    `budget: handlers<=${safePlan.budget.maxHandlers}, scenarios<=${safePlan.budget.maxScenarios}, blocks<=${safePlan.budget.maxBlocks}, uiStates<=${safePlan.budget.maxUiStates}, conditionDepth<=${safePlan.budget.maxConditionDepth}, nestedFlows=${safePlan.budget.allowNestedFlows}`,
    'IntentPlan JSON:',
    JSON.stringify(safePlan, null, 2),
  ].join('\n');
}

function collectScenarioTargets(actions, out = new Set()) {
  for (const action of asArray(actions)) {
    if (!isObject(action)) continue;
    const target = str(action.target);
    if ((action.type === 'run_scenario' || action.type === 'goto_scenario') && target) out.add(target);
    if (action.type === 'condition') {
      collectScenarioTargets(action.then, out);
      collectScenarioTargets(action.else, out);
    }
  }
  return out;
}

function pruneNestedScenarioTransitions(actions, changed) {
  return asArray(actions).flatMap((action) => {
    if (!isObject(action)) return [];
    if (action.type === 'run_scenario' || action.type === 'goto_scenario') {
      changed.value = true;
      return [{ type: 'message', text: 'Этот шаг упрощён по complexity budget.' }, { type: 'stop' }];
    }
    if (action.type !== 'condition') return [action];
    const next = { ...action };
    next.then = pruneNestedScenarioTransitions(action.then, changed);
    if (Object.prototype.hasOwnProperty.call(next, 'else')) {
      next.else = pruneNestedScenarioTransitions(action.else, changed);
    }
    return [next];
  });
}

function conditionDepth(action, depth = 0) {
  if (!isObject(action) || action.type !== 'condition') return depth;
  const childDepth = Math.max(
    ...[
      ...asArray(action.then).map((child) => conditionDepth(child, depth + 1)),
      ...asArray(action.else).map((child) => conditionDepth(child, depth + 1)),
      depth + 1,
    ],
  );
  return childDepth;
}

function flattenConditions(actions, maxDepth, state, depth = 0) {
  return asArray(actions).flatMap((action) => {
    if (!isObject(action)) return [];
    if (action.type !== 'condition') return [action];
    if (depth >= maxDepth) {
      state.changed = true;
      state.notes.push('collapsed condition over complexity budget');
      return [{ type: 'message', text: 'Ветка упрощена.' }];
    }
    const next = { ...action };
    next.then = flattenConditions(next.then, maxDepth, state, depth + 1);
    if (Object.prototype.hasOwnProperty.call(next, 'else')) {
      next.else = flattenConditions(next.else, maxDepth, state, depth + 1);
    }
    return [next];
  });
}

function prioritizeHandlers(handlers) {
  return asArray(handlers)
    .map((handler, index) => ({ handler, index }))
    .sort((a, b) => {
      const rank = (handler) => {
        if (handler.type === 'start') return 0;
        if (handler.type === 'command' && str(handler.trigger).replace(/^\/+/, '') === 'start') return 1;
        if (handler.type === 'text') return 2;
        if (handler.type === 'callback') return 3;
        if (handler.type === 'command') return 4;
        return 5;
      };
      return rank(a.handler) - rank(b.handler) || a.index - b.index;
    })
    .map((item) => item.handler);
}

export function applyIntentBudgetToIr(ir, plan) {
  const current = normalizeAiCanonicalIr(ir);
  const budget = isObject(plan?.budget) ? plan.budget : COMPLEXITY_BUDGETS[INTENT_COMPLEXITY.SIMPLE];
  const next = clone(current);
  const notes = [];
  let changed = false;

  const originalHandlers = asArray(next.handlers);
  next.handlers = prioritizeHandlers(originalHandlers).slice(0, budget.maxHandlers);
  if (next.handlers.length !== originalHandlers.length) {
    changed = true;
    notes.push(`handlers limited ${originalHandlers.length}->${next.handlers.length}`);
  }

  const allowedScenarioTargets = new Set();
  for (const handler of next.handlers) collectScenarioTargets(handler.actions, allowedScenarioTargets);
  const originalScenarios = asArray(next.scenarios);
  next.scenarios = originalScenarios
    .filter((scenario) => {
      if (allowedScenarioTargets.size === 0) return true;
      return allowedScenarioTargets.has(str(scenario.name)) || allowedScenarioTargets.has(str(scenario.id));
    })
    .slice(0, budget.maxScenarios);
  if (next.scenarios.length !== originalScenarios.length) {
    changed = true;
    notes.push(`scenarios limited ${originalScenarios.length}->${next.scenarios.length}`);
  }

  const originalBlocks = asArray(next.blocks);
  next.blocks = originalBlocks.slice(0, budget.maxBlocks);
  if (next.blocks.length !== originalBlocks.length) {
    changed = true;
    notes.push(`blocks limited ${originalBlocks.length}->${next.blocks.length}`);
  }

  const originalUiStates = asArray(next.uiStates);
  next.uiStates = originalUiStates.slice(0, budget.maxUiStates);
  if (next.uiStates.length !== originalUiStates.length) {
    changed = true;
    notes.push(`uiStates limited ${originalUiStates.length}->${next.uiStates.length}`);
  }

  const conditionState = { changed: false, notes: [] };
  next.handlers = asArray(next.handlers).map((handler) => ({
    ...handler,
    actions: flattenConditions(handler.actions, budget.maxConditionDepth, conditionState),
  }));
  next.blocks = asArray(next.blocks).map((block) => ({
    ...block,
    actions: flattenConditions(block.actions, budget.maxConditionDepth, conditionState),
  }));
  next.scenarios = asArray(next.scenarios).map((scenario) => {
    const nestedChanged = { value: false };
    const out = {
      ...scenario,
      steps: asArray(scenario.steps).map((step) => ({
        ...step,
        actions: flattenConditions(
          budget.allowNestedFlows ? step.actions : pruneNestedScenarioTransitions(step.actions, nestedChanged),
          budget.maxConditionDepth,
          conditionState,
        ),
      })),
    };
    if (nestedChanged.value) {
      changed = true;
      notes.push('nested scenario transitions removed');
    }
    return out;
  });
  if (conditionState.changed) {
    changed = true;
    notes.push(...conditionState.notes);
  }
  if (!budget.allowNestedFlows) {
    const hasNested = asArray(next.scenarios).some((scenario) =>
      asArray(scenario.steps).some((step) => collectScenarioTargets(step.actions).size > 0));
    if (hasNested) notes.push('nested flows blocked by budget');
  }

  const originalTransitions = asArray(next.transitions);
  next.transitions = originalTransitions.filter((transition) => {
    const to = str(transition.to);
    if (!to) return true;
    return asArray(next.scenarios).some((scenario) => str(scenario.id) === to || str(scenario.name) === to) ||
      asArray(next.handlers).some((handler) => str(handler.id) === to) ||
      asArray(next.uiStates).some((state) => str(state.id) === to);
  });
  if (next.transitions.length !== originalTransitions.length) {
    changed = true;
    notes.push(`transitions limited ${originalTransitions.length}->${next.transitions.length}`);
  }

  const maxDepth = Math.max(
    0,
    ...asArray(next.handlers).flatMap((handler) => asArray(handler.actions).map((action) => conditionDepth(action))),
    ...asArray(next.scenarios).flatMap((scenario) =>
      asArray(scenario.steps).flatMap((step) => asArray(step.actions).map((action) => conditionDepth(action)))),
  );
  if (maxDepth > budget.maxConditionDepth) {
    changed = true;
    notes.push(`conditionDepth reduced to ${budget.maxConditionDepth}`);
  }

  next.intent = {
    ...(isObject(next.intent) ? next.intent : {}),
    plannedBotType: plan?.botType,
    complexityScore: plan?.complexityScore,
  };
  next.meta = {
    ...(isObject(next.meta) ? next.meta : {}),
    intentPlanApplied: true,
    complexityBudget: budget,
  };

  const normalized = normalizeAiCanonicalIr(next);
  normalized.meta = next.meta;

  return {
    ir: normalized,
    changed,
    notes: unique(notes),
  };
}
