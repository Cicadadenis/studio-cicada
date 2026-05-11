import assert from 'node:assert/strict';
import test from 'node:test';

import { generateDSL } from '../stacksToDsl.js';
import { validateAstSchema } from '../validator/aiAstValidate.mjs';
import { semanticValidate } from '../validator/aiSemanticValidate.mjs';

test('AI AST supports DB-backed inline catalog blocks', () => {
  const stacks = [
    {
      id: 's0',
      x: 40,
      y: 40,
      blocks: [{ id: 'b0', type: 'bot', props: { token: 'YOUR_BOT_TOKEN' } }],
    },
    {
      id: 's1',
      x: 400,
      y: 40,
      blocks: [
        { id: 'b1', type: 'start', props: {} },
        { id: 'b2', type: 'save_global', props: { key: 'категории', value: '["Пицца", "Напитки"]' } },
        { id: 'b3', type: 'message', props: { text: '📦 Выберите категорию:' } },
        {
          id: 'b4',
          type: 'inline_db',
          props: {
            key: 'категории',
            callbackPrefix: 'cat:',
            backText: '⬅️ Назад',
            backCallback: 'back',
            columns: '2',
          },
        },
        { id: 'b5', type: 'stop', props: {} },
      ],
    },
    {
      id: 's2',
      x: 760,
      y: 40,
      blocks: [
        { id: 'b6', type: 'callback', props: { label: '' } },
        { id: 'b7', type: 'condition', props: { cond: 'начинается_с(кнопка, "cat:")' } },
        { id: 'b8', type: 'message', props: { text: 'Товары категории: {кнопка}' } },
        {
          id: 'b9',
          type: 'inline_db',
          props: {
            key: 'товары',
            callbackPrefix: 'prod:',
            backText: '⬅️ Категории',
            backCallback: 'back_categories',
          },
        },
        { id: 'b10', type: 'stop', props: {} },
      ],
    },
  ];

  assert.deepEqual(validateAstSchema(stacks), []);
  assert.deepEqual(semanticValidate(stacks, { astMode: 'safe', allowedMemoryKeys: [] }), []);

  const dsl = generateDSL(stacks);
  assert.match(dsl, /inline из бд "категории".*callback "cat:"/);
  assert.match(dsl, /при нажатии:/);
});
