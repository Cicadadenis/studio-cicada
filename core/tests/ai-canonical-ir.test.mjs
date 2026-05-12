import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { generateDSL } from '../stacksToDsl.js';
import {
  canonicalIrToEditorStacks,
  extractAiCanonicalIrFromRaw,
  normalizeAiCanonicalIr,
  validateAiCanonicalIr,
} from '../ai/aiCanonicalIr.mjs';
import { buildFeatureGraph, resolveFeatureDependencies } from '../ai/featureDependencyResolver.mjs';
import {
  GRAPH_RECONCILER_DIAGNOSTIC_CODES,
  assertNoUnresolvedGraphEdges,
  reconcileIrGraph,
} from '../ai/graphReconciler.mjs';
import { assertPrunedRecoveryIr, pruneIrForRecovery } from '../ai/irPruner.mjs';
import { runDeterministicRecoveryPipeline } from '../ai/irRecoveryTransforms.mjs';
import { applyIntentBudgetToIr, intentPlanner } from '../ai/intentPlanner.mjs';
import { repairIntentSatisfaction, validateIntentSatisfaction } from '../ai/intentSatisfactionValidator.mjs';
import { buildIrSkeletonFallback } from '../ai/irSkeletonFactory.mjs';
import { validateIrSemanticGate } from '../ai/irSemanticGate.mjs';
import { validateDSL } from '../validator/uiDslValidator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const inlineCatalogIr = {
  irVersion: 1,
  targetCore: '0.3.5',
  compatibilityMode: '0.3.5 exact',
  intent: { primary: 'db_inline_catalog' },
  state: { globals: [{ name: 'категории', value: '["Пицца", "Напитки"]' }] },
  uiStates: [
    { id: 'ui_menu', message: '🏠 Главное меню', buttons: '📦 Каталог' },
    {
      id: 'ui_categories',
      message: '📦 Выберите категорию:',
      inlineDb: {
        key: 'категории',
        callbackPrefix: 'cat:',
        backText: '⬅️ Назад',
        backCallback: 'back',
        columns: '2',
      },
    },
  ],
  handlers: [
    { id: 'h_start', type: 'start', trigger: '', actions: [{ type: 'ui_state', uiStateId: 'ui_menu' }, { type: 'stop' }] },
    { id: 'h_catalog', type: 'callback', trigger: '📦 Каталог', actions: [{ type: 'ui_state', uiStateId: 'ui_categories' }, { type: 'stop' }] },
    {
      id: 'h_inline',
      type: 'callback',
      trigger: '',
      actions: [
        {
          type: 'condition',
          cond: 'начинается_с(кнопка, "cat:")',
          then: [
            { type: 'remember', varname: 'категория', value: 'срез(кнопка, 4)' },
            { type: 'message', text: 'Товары категории: {категория}' },
            { type: 'inline_db', key: 'товары', callbackPrefix: 'prod:', backText: '⬅️ Категории', backCallback: 'back_categories' },
            { type: 'stop' },
          ],
        },
      ],
    },
  ],
  blocks: [],
  scenarios: [],
  transitions: [{ from: 'h_catalog', to: 'ui_categories', type: 'ui_state' }],
};

test('extracts and validates Canonical AI IR object', () => {
  const extracted = extractAiCanonicalIrFromRaw(`Here:\n\`\`\`json\n${JSON.stringify(inlineCatalogIr)}\n\`\`\``);
  assert.ok(extracted);
  const ir = normalizeAiCanonicalIr(extracted.ir);
  assert.deepEqual(validateAiCanonicalIr(ir).errors, []);
});

test('Canonical AI IR serializes to golden runtime-approved DSL', () => {
  const ir = normalizeAiCanonicalIr(inlineCatalogIr);
  const stacks = canonicalIrToEditorStacks(ir);
  const dsl = generateDSL(stacks).trim();
  const golden = fs.readFileSync(path.join(ROOT, 'tests/golden-dsl/inline-db-catalog.ccd'), 'utf8').trim();

  assert.equal(dsl, golden);
  assert.deepEqual(validateDSL(dsl, stacks).errors, []);
});

test('Skeleton fallback IR is executable and runtime-safe', () => {
  const ir = buildIrSkeletonFallback({ prompt: 'сломанный запрос' });
  assert.equal(ir.intent.primary, 'skeleton_fallback');
  assert.equal(ir.intent.executionMode, 'FALLBACK_SKELETON');
  assert.equal(ir.intent.isDegraded, true);
  assert.equal(ir.intent.isAIGenerated, false);
  assert.equal(ir.scenarios.length, 0);
  assert.equal(ir.transitions.length, 0);
  assert.deepEqual(validateAiCanonicalIr(ir).errors, []);
  assert.equal(validateIrSemanticGate(ir).ok, true);

  const stacks = canonicalIrToEditorStacks(ir);
  const dsl = generateDSL(stacks).trim();
  assert.match(dsl, /при старте:/);
  assert.match(dsl, /Запущена базовая версия сценария \(без сложной логики\)\./);
  assert.deepEqual(validateDSL(dsl, stacks).errors, []);
});

test('AI recovery pruner limits IR complexity before deterministic recovery', () => {
  const complexIr = normalizeAiCanonicalIr({
    ...inlineCatalogIr,
    blocks: [
      { id: 'b_required', name: 'required_block', actions: [{ type: 'message', text: 'keep' }] },
      { id: 'b_optional', name: 'optional_block', optional: true, actions: [{ type: 'message', text: 'drop' }] },
    ],
    handlers: [
      ...inlineCatalogIr.handlers,
      { id: 'h_1', type: 'callback', trigger: 'one', actions: [{ type: 'message', text: '1' }, { type: 'stop' }] },
      { id: 'h_2', type: 'callback', trigger: 'two', actions: [{ type: 'message', text: '2' }, { type: 'stop' }] },
      { id: 'h_3', type: 'callback', trigger: 'three', actions: [{ type: 'message', text: '3' }, { type: 'stop' }] },
      { id: 'h_4', type: 'callback', trigger: 'four', actions: [{ type: 'message', text: '4' }, { type: 'stop' }] },
    ],
    scenarios: [
      {
        id: 's1',
        name: 's1',
        steps: [{ id: 's1_step', name: 'step', actions: [{ type: 'run_scenario', target: 's2' }] }],
      },
      {
        id: 's2',
        name: 's2',
        steps: [{ id: 's2_step', name: 'step', actions: [{ type: 'run_scenario', target: 's3' }] }],
      },
      {
        id: 's3',
        name: 's3',
        steps: [{ id: 's3_step', name: 'step', actions: [{ type: 'message', text: 'too deep' }] }],
      },
    ],
    transitions: [{ from: 'h_start', to: 's1' }],
  });

  complexIr.handlers[0].actions = [{ type: 'run_scenario', target: 's1' }, { type: 'stop' }];
  const result = pruneIrForRecovery(complexIr);
  const pruned = result.ir;

  assert.equal(result.pruned, true);
  assert.ok(pruned.handlers.length <= 5);
  assert.equal(pruned.transitions.length, 0);
  assert.equal(pruned.blocks.some((block) => block.name === 'optional_block'), false);
  assert.equal(pruned.scenarios.some((scenario) => scenario.name === 's3'), false);
  assertPrunedRecoveryIr(pruned);
});

test('deterministic recovery transforms PRUNED_IR into executable PARTIAL_IR without LLM', () => {
  const pruned = normalizeAiCanonicalIr({
    irVersion: 1,
    targetCore: '0.3.5',
    compatibilityMode: '0.3.5 exact',
    intent: { primary: 'recovery_transform_test' },
    state: { globals: [] },
    uiStates: [],
    handlers: [
      {
        id: 'h_start',
        type: 'start',
        trigger: '',
        actions: [
          { type: 'buttons', rows: 'Missing callback' },
          { type: 'run_scenario', target: 'missing_scenario' },
        ],
      },
    ],
    blocks: [
      { id: 'b_help', name: 'help_block', actions: [{ type: 'message', text: 'Help' }] },
    ],
    scenarios: [
      {
        id: 'orphan',
        name: 'orphan',
        steps: [{ id: 'orphan_step', name: 'start', actions: [{ type: 'message', text: 'unused' }] }],
      },
    ],
    transitions: [],
  });
  pruned.meta = {
    IR_PRUNED: true,
    irPruned: true,
    constraints: { maxDepth: 2, maxHandlers: 5 },
  };

  const result = runDeterministicRecoveryPipeline(pruned);

  assert.equal(result.noLlmRequired, true);
  assert.equal(result.ok, true);
  assert.ok(result.appliedPasses.includes('repair missing transitions'));
  assert.ok(result.appliedPasses.includes('remove unreachable scenarios'));
  assert.equal(result.ir.scenarios.length, 0);
  assert.ok(result.ir.handlers.some((handler) => handler.type === 'callback' && handler.trigger === 'Missing callback'));
  assert.equal(validateIrSemanticGate(result.ir).ok, true);
});

test('graph reconciler removes dangling edges after transform pruning', () => {
  const prunedGraph = normalizeAiCanonicalIr({
    irVersion: 1,
    targetCore: '0.3.5',
    compatibilityMode: '0.3.5 exact',
    intent: { primary: 'graph_reconciliation_test' },
    state: { globals: [] },
    uiStates: [],
    handlers: [
      {
        id: 'h_start',
        type: 'start',
        trigger: '',
        actions: [
          { type: 'buttons', rows: 'Каталог' },
          { type: 'run_scenario', target: 'деление' },
          { type: 'ui_state', uiStateId: 'ui_removed' },
        ],
      },
    ],
    blocks: [],
    scenarios: [
      {
        id: 'sc_main',
        name: 'main',
        steps: [{ id: 'sc_main_step', name: 'start', actions: [{ type: 'message', text: 'Главное меню' }] }],
      },
    ],
    transitions: [
      { from: 'h_start', to: 'sc_deleted', type: 'run_scenario' },
      { from: 'h_deleted', to: 'sc_main', type: 'run_scenario' },
    ],
  });

  const result = reconcileIrGraph(prunedGraph);

  assert.equal(result.ok, true);
  assertNoUnresolvedGraphEdges(result.ir);
  assert.equal(validateIrSemanticGate(result.ir).ok, true);
  assert.ok(result.ir.handlers.some((handler) => handler.type === 'callback' && handler.trigger === 'Каталог'));
  assert.ok(result.ir.uiStates.some((state) => state.id === 'ui_removed'));
  assert.ok(result.ir.handlers[0].actions.some((action) => action.type === 'run_scenario' && action.target === 'main'));
  assert.deepEqual(result.ir.transitions, [{ from: 'h_start', to: 'sc_main', type: 'run_scenario' }]);
  assert.ok(result.diagnostics.some((item) => item.code === GRAPH_RECONCILER_DIAGNOSTIC_CODES.DANGLING_TRANSITION_FIXED));
  assert.ok(result.diagnostics.some((item) => item.code === GRAPH_RECONCILER_DIAGNOSTIC_CODES.TARGET_REDIRECTED));
  assert.ok(result.diagnostics.some((item) => item.code === GRAPH_RECONCILER_DIAGNOSTIC_CODES.GRAPH_RECONCILED));
});

test('intent planner keeps simple calculator prompt within minimal budget', () => {
  const plan = intentPlanner('бот калькулятор');

  assert.equal(plan.botType, 'calculator');
  assert.equal(plan.complexityScore, 'SIMPLE');
  assert.equal(plan.budget.maxHandlers, 4);
  assert.equal(plan.budget.maxScenarios, 1);
  assert.equal(plan.budget.allowNestedFlows, false);
  assert.ok(plan.requiredHandlers.length <= 4);
  assert.ok(plan.minimalExecutionGraph.nodes.length > 0);
});

test('intent budget reduces over-generated Canonical IR', () => {
  const plan = intentPlanner('бот калькулятор');
  const overGenerated = normalizeAiCanonicalIr({
    ...inlineCatalogIr,
    handlers: [
      ...inlineCatalogIr.handlers,
      { id: 'h_text', type: 'text', trigger: '', actions: [{ type: 'message', text: 'text' }] },
      { id: 'h_extra_1', type: 'callback', trigger: 'Extra 1', actions: [{ type: 'message', text: '1' }] },
      { id: 'h_extra_2', type: 'callback', trigger: 'Extra 2', actions: [{ type: 'message', text: '2' }] },
    ],
    scenarios: [
      {
        id: 's_calc',
        name: 'расчет',
        steps: [{ id: 's_calc_step', name: 'start', actions: [{ type: 'message', text: 'ok' }] }],
      },
      {
        id: 's_nested',
        name: 'nested',
        steps: [{ id: 's_nested_step', name: 'start', actions: [{ type: 'message', text: 'nested' }] }],
      },
    ],
    blocks: [
      { id: 'b1', name: 'one', actions: [{ type: 'message', text: '1' }] },
      { id: 'b2', name: 'two', actions: [{ type: 'message', text: '2' }] },
    ],
  });

  const result = applyIntentBudgetToIr(overGenerated, plan);

  assert.equal(result.changed, true);
  assert.ok(result.ir.handlers.length <= 4);
  assert.ok(result.ir.scenarios.length <= 1);
  assert.ok(result.ir.blocks.length <= 1);
});

test('ISV rejects calculator echo bot and injects deterministic calculator template', () => {
  const plan = intentPlanner('бот калькулятор');
  const fakeCalculator = normalizeAiCanonicalIr({
    irVersion: 1,
    targetCore: '0.3.5',
    compatibilityMode: '0.3.5 exact',
    intent: { primary: 'calculator' },
    state: { globals: [] },
    handlers: [
      {
        id: 'h_start',
        type: 'start',
        trigger: '',
        actions: [{ type: 'message', text: 'Пришлите пример, я повторю: {текст}' }, { type: 'stop' }],
      },
    ],
    blocks: [],
    scenarios: [],
    transitions: [],
    uiStates: [],
  });

  const validation = validateIntentSatisfaction(fakeCalculator, { prompt: 'бот калькулятор', intentPlan: plan });
  assert.equal(validation.ok, false);
  assert.ok(validation.diagnostics.some((item) => item.code === 'INTENT_NOT_SATISFIED'));
  assert.ok(validation.diagnostics.some((item) => item.code === 'MISSING_REQUIRED_CAPABILITY'));
  assert.ok(validation.diagnostics.some((item) => item.code === 'ECHO_RESPONSE_DETECTED'));

  const repaired = repairIntentSatisfaction(fakeCalculator, { prompt: 'бот калькулятор', intentPlan: plan });
  assert.equal(repaired.changed, true);
  assert.equal(validateIntentSatisfaction(repaired.ir, { prompt: 'бот калькулятор', intentPlan: plan }).ok, true);
  assert.equal(validateIrSemanticGate(repaired.ir).ok, true);
});

test('FDR injects inline_db generic callback dependency before validation', () => {
  const missingInlineDependency = normalizeAiCanonicalIr({
    irVersion: 1,
    targetCore: '0.3.5',
    compatibilityMode: '0.3.5 exact',
    intent: { primary: 'catalog' },
    state: { globals: [{ name: 'категории', value: '["Пицца"]' }] },
    uiStates: [{
      id: 'ui_catalog',
      message: 'Каталог',
      inlineDb: { key: 'категории', callbackPrefix: 'cat:' },
    }],
    handlers: [
      { id: 'h_start', type: 'start', trigger: '', actions: [{ type: 'ui_state', uiStateId: 'ui_catalog' }, { type: 'stop' }] },
    ],
    blocks: [],
    scenarios: [],
    transitions: [],
  });

  const initialGraph = buildFeatureGraph(missingInlineDependency);
  assert.ok(initialGraph.missing.some((item) => item.feature === 'inline_db' && item.requirement === 'generic_callback_handler'));

  const resolved = resolveFeatureDependencies(missingInlineDependency);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.changed, true);
  assert.ok(resolved.diagnostics.some((item) => item.code === 'MISSING_FEATURE_DEPENDENCY'));
  assert.ok(resolved.diagnostics.some((item) => item.code === 'DEPENDENCY_AUTO_INJECTED'));
  assert.ok(resolved.ir.handlers.some((handler) => handler.type === 'callback' && handler.trigger === ''));
  assert.equal(validateIrSemanticGate(resolved.ir).ok, true);
});

test('FDR guarantees interactive buttons and scenarios have executable transition paths', () => {
  const missingTransitions = normalizeAiCanonicalIr({
    irVersion: 1,
    targetCore: '0.3.5',
    compatibilityMode: '0.3.5 exact',
    intent: { primary: 'form_collection' },
    state: { globals: [] },
    uiStates: [{ id: 'ui_start', message: 'Форма', buttons: 'Начать' }],
    handlers: [
      { id: 'h_start', type: 'start', trigger: '', actions: [{ type: 'ui_state', uiStateId: 'ui_start' }, { type: 'stop' }] },
    ],
    blocks: [],
    scenarios: [{
      id: 'sc_form',
      name: 'форма',
      steps: [{ id: 'step_name', name: 'имя', actions: [{ type: 'ask', question: 'Имя?' }, { type: 'message', text: 'Готово' }] }],
    }],
    transitions: [],
  });

  const resolved = resolveFeatureDependencies(missingTransitions);

  assert.equal(resolved.ok, true);
  assert.ok(resolved.ir.handlers.some((handler) =>
    handler.type === 'callback' &&
    handler.trigger === 'Начать' &&
    handler.actions.some((action) => action.type === 'run_scenario' && action.target === 'форма')));
  assert.ok(resolved.ir.scenarios[0].steps[0].actions.some((action) => action.type === 'ask' && action.varname === 'ответ_1'));
  assert.ok(resolved.featureGraph.requirements.every((requirement) => requirement.ok));
  assert.equal(validateIrSemanticGate(resolved.ir).ok, true);
});
