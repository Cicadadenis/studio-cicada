import assert from 'node:assert/strict';
import test from 'node:test';

import { repairIrDeterministic } from '../ai/irRepairEngine.mjs';
import { IR_ERROR_CODES, validateIrSemanticGate } from '../ai/irSemanticGate.mjs';

test('IR semantic gate rejects empty branches and deterministic repair removes empty else', () => {
  const ir = {
    irVersion: 1,
    targetCore: '0.3.5',
    compatibilityMode: '0.3.5 exact',
    intent: { primary: 'empty_else' },
    state: { globals: [] },
    uiStates: [],
    handlers: [
      {
        id: 'h_start',
        type: 'start',
        trigger: '',
        actions: [
          {
            type: 'condition',
            cond: 'текст == "да"',
            then: [{ type: 'message', text: 'Да' }],
            else: [],
          },
        ],
      },
    ],
    blocks: [],
    scenarios: [],
    transitions: [],
  };

  const before = validateIrSemanticGate(ir);
  assert.equal(before.ok, false);
  assert.ok(before.diagnostics.some((d) => d.code === IR_ERROR_CODES.EMPTY_BRANCH));

  const repaired = repairIrDeterministic(ir, before.diagnostics);
  const after = validateIrSemanticGate(repaired.ir);
  assert.equal(after.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(repaired.ir.handlers[0].actions[0], 'else'), false);
});

test('IR semantic gate rejects invented symbols before DSL serialization', () => {
  const ir = {
    irVersion: 1,
    targetCore: '0.3.5',
    compatibilityMode: '0.3.5 exact',
    intent: { primary: 'invented_symbol' },
    state: { globals: [] },
    uiStates: [],
    handlers: [
      {
        id: 'h_start',
        type: 'start',
        trigger: '',
        actions: [{ type: 'message', text: 'Data: {data}' }],
      },
    ],
    blocks: [],
    scenarios: [],
    transitions: [],
  };

  const result = validateIrSemanticGate(ir);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((d) => d.code === IR_ERROR_CODES.UNKNOWN_SYMBOL));
});

test('deterministic repair normalizes invented variable aliases', () => {
  const ir = {
    irVersion: 1,
    targetCore: '0.3.5',
    compatibilityMode: '0.3.5 exact',
    intent: { primary: 'invented_symbol_repair' },
    state: { globals: [] },
    uiStates: [],
    handlers: [
      {
        id: 'h_start',
        type: 'start',
        trigger: '',
        actions: [{ type: 'message', text: 'Data: {data}' }],
      },
    ],
    blocks: [],
    scenarios: [],
    transitions: [],
  };

  const before = validateIrSemanticGate(ir);
  const repaired = repairIrDeterministic(ir, before.diagnostics);
  const after = validateIrSemanticGate(repaired.ir);

  assert.equal(after.ok, true);
  assert.equal(repaired.ir.handlers[0].actions[0].text, 'Data: {текст}');
});

test('deterministic repair adds missing callback handlers for buttons', () => {
  const ir = {
    irVersion: 1,
    targetCore: '0.3.5',
    compatibilityMode: '0.3.5 exact',
    intent: { primary: 'button_callback_repair' },
    state: { globals: [] },
    uiStates: [],
    handlers: [
      {
        id: 'h_start',
        type: 'start',
        trigger: '',
        actions: [{ type: 'buttons', rows: 'Каталог' }, { type: 'stop' }],
      },
    ],
    blocks: [],
    scenarios: [],
    transitions: [],
  };

  const before = validateIrSemanticGate(ir);
  assert.equal(before.ok, false);
  assert.ok(before.diagnostics.some((d) => d.code === IR_ERROR_CODES.INVALID_TRANSITION));

  const repaired = repairIrDeterministic(ir, before.diagnostics);
  const after = validateIrSemanticGate(repaired.ir);

  assert.equal(after.ok, true);
  assert.ok(repaired.ir.handlers.some((handler) => handler.type === 'callback' && handler.trigger === 'Каталог'));
});

test('deterministic repair appends terminal UI for dead handler bodies', () => {
  const ir = {
    irVersion: 1,
    targetCore: '0.3.5',
    compatibilityMode: '0.3.5 exact',
    intent: { primary: 'terminal_ui_repair' },
    state: { globals: [] },
    uiStates: [],
    handlers: [
      {
        id: 'h_start',
        type: 'start',
        trigger: '',
        actions: [{ type: 'remember', varname: 'итого', value: '0' }],
      },
    ],
    blocks: [],
    scenarios: [],
    transitions: [],
  };

  const before = validateIrSemanticGate(ir);
  assert.equal(before.ok, false);
  assert.ok(before.diagnostics.some((d) => d.code === IR_ERROR_CODES.MISSING_UI_STATE));

  const repaired = repairIrDeterministic(ir, before.diagnostics);
  const after = validateIrSemanticGate(repaired.ir);

  assert.equal(after.ok, true);
  assert.deepEqual(repaired.ir.handlers[0].actions.slice(-2), [
    { type: 'message', text: 'Готово.' },
    { type: 'stop' },
  ]);
});
