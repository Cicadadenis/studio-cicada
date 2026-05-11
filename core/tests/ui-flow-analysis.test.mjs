import assert from 'node:assert/strict';
import test from 'node:test';

import { collectDSLFixes } from '../validator/fixes.js';
import { analyzeDslControlFlow } from '../validator/uiFlowAnalysis.js';
import { validateDSL } from '../validator/uiDslValidator.js';

const baseHeader = `версия "1.0"
бот "TOKEN"

при старте:
    ответ "Старт"
    кнопки "Меню"
`;

test('click handler using a block with buttons is a valid reachable UI ending', () => {
  const code = `${baseHeader}
блок главное_меню:
    ответ "Главное меню"
    кнопки "A" "B"

при нажатии "Меню":
    использовать главное_меню
`;

  const flow = analyzeDslControlFlow(code);
  const click = flow.clickHandlers.find((handler) => handler.header.includes('"Меню"'));

  assert.equal(click.summary.hasBlockUse, true);
  assert.equal(click.summary.hasReachableKeyboard, true);
  assert.equal(collectDSLFixes(code).fixes.some((fix) => fix.message.includes('нет кнопок')), false);
});

test('goto to command or block suppresses fallback keyboard autofix', () => {
  const code = `${baseHeader}
блок главное_меню:
    ответ "Главное меню"
    кнопки "A" "B"

при команде "/menu":
    использовать главное_меню

при нажатии "Команда":
    перейти "/menu"

при нажатии "Блок":
    перейти "главное_меню"
`;

  const flow = analyzeDslControlFlow(code);
  const commandClick = flow.clickHandlers.find((handler) => handler.header.includes('"Команда"'));
  const blockClick = flow.clickHandlers.find((handler) => handler.header.includes('"Блок"'));

  assert.equal(commandClick.summary.hasTransition, true);
  assert.equal(commandClick.summary.hasReachableKeyboard, true);
  assert.equal(blockClick.summary.hasTransition, true);
  assert.equal(blockClick.summary.hasReachableKeyboard, true);
  assert.equal(collectDSLFixes(code).fixes.some((fix) => fix.message.includes('нет кнопок')), false);
});

test('reply-only click handlers do not get a Studio-imposed fallback keyboard', () => {
  const code = `${baseHeader}
при нажатии "Ок":
    ответ "Ок"
`;

  const fixes = collectDSLFixes(code);

  assert.equal(fixes.fixes.some((fix) => fix.message.includes('нет кнопок')), false);
  assert.equal(fixes.correctedCode, code);
});

test('goto may target a declared block', () => {
  const code = `${baseHeader}
блок главное_меню:
    ответ "Главное меню"
    кнопки "A" "B"

при нажатии "Блок":
    перейти "главное_меню"
`;
  const stacks = [
    { blocks: [{ type: 'bot', props: { token: 'TOKEN' } }] },
    { blocks: [{ type: 'start', props: {} }, { type: 'message', props: { text: 'Старт' } }] },
    { blocks: [{ type: 'block', props: { name: 'главное_меню' } }, { type: 'message', props: { text: 'Главное меню' } }] },
    { blocks: [{ type: 'callback', props: { label: 'Блок' } }, { type: 'goto', props: { target: 'главное_меню' } }] },
  ];

  const result = validateDSL(code, stacks);

  assert.equal(result.errors.some((error) => String(error).includes('сценарий или команда')), false);
});
