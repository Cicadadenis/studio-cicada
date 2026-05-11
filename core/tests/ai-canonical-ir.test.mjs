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
import { buildIrSkeletonFallback } from '../ai/irSkeletonFactory.mjs';
import { validateIrSemanticGate } from '../ai/irSemanticGate.mjs';
import { validateDSL } from '../validator/uiDslValidator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const inlineCatalogIr = {
  irVersion: 1,
  targetCore: '0.3.3',
  compatibilityMode: '0.3.3 exact',
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
