#!/usr/bin/env node
import { collectDSLFixes } from '../core/validator/fixes.js';
import {
  analyzeDslControlFlow,
  shouldInjectDefaultButtonsForClickHandler,
} from '../core/validator/uiFlowAnalysis.js';

const BASE = 'бот "TEST"\nпри старте:\n    ответ "start"\n';

const cases = [
  {
    name: 'direct reply without navigation stays core-valid without fallback',
    expectInject: false,
    dsl: `${BASE}
при нажатии "X":
    ответ "No keyboard"
`,
  },
  {
    name: 'direct keyboard is valid',
    expectInject: false,
    dsl: `${BASE}
при нажатии "X":
    ответ "Menu"
    кнопки "A"
`,
  },
  {
    name: 'use block with reachable keyboard is valid',
    expectInject: false,
    dsl: `${BASE}
блок меню:
    ответ "Menu"
    кнопки "A"

при нажатии "X":
    использовать меню
`,
  },
  {
    name: 'quoted use block is treated as delegation',
    expectInject: false,
    dsl: `${BASE}
при нажатии "X":
    ответ "Delegated"
    использовать "меню"
`,
  },
  {
    name: 'goto block is valid even without direct keyboard',
    expectInject: false,
    dsl: `${BASE}
блок меню:
    ответ "Menu"
    кнопки "A"

при нажатии "X":
    перейти меню
`,
  },
  {
    name: 'goto command is valid',
    expectInject: false,
    dsl: `${BASE}
при команде "/catalog":
    ответ "Catalog"
    кнопки "A"

при нажатии "X":
    перейти "/catalog"
`,
  },
  {
    name: 'run scenario is valid terminal transition',
    expectInject: false,
    dsl: `${BASE}
сценарий заказ:
    шаг start:
        ответ "Order"
        кнопки "Back"

при нажатии "X":
    запустить заказ
`,
  },
  {
    name: 'stop after reply is terminal and valid',
    expectInject: false,
    dsl: `${BASE}
при нажатии "X":
    ответ "Done"
    стоп
`,
  },
  {
    name: 'generic callback router with transition is valid',
    expectInject: false,
    dsl: `${BASE}
при нажатии:
    если начинается_с(кнопка, "menu:"):
        перейти "/start"
`,
  },
];

let failed = 0;
for (const item of cases) {
  const flow = analyzeDslControlFlow(item.dsl);
  const handler = flow.clickHandlers[0];
  const inject = shouldInjectDefaultButtonsForClickHandler(handler?.summary);
  const fixMessages = collectDSLFixes(item.dsl).fixes.map((f) => f.message);
  const hasDefaultButtonFix = fixMessages.some((msg) => msg.includes('добавлена кнопка'));
  const ok = inject === item.expectInject && hasDefaultButtonFix === item.expectInject;
  console.log(`${ok ? '✓' : '✗'} ${item.name}`);
  if (!ok) {
    failed += 1;
    console.log(JSON.stringify({ inject, expected: item.expectInject, summary: handler?.summary, fixMessages }, null, 2));
  }
}

if (failed) process.exit(1);
