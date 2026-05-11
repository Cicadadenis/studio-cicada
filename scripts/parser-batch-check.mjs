#!/usr/bin/env node
/**
 * Пакетная проверка DSL парсером Cicada (тот же путь, что /api/dsl/lint и requireParsedDSL).
 *
 * Режимы:
 *   node scripts/parser-batch-check.mjs
 *       — встроенные мини-кейсы + реальные примеры из репозитория (examples/*.ccd, qr-bot, demo-bot, bot.ccd).
 *   node scripts/parser-batch-check.mjs --dir ./path
 *       — все *.ccd в каталоге.
 *   node scripts/parser-batch-check.mjs stacks a.json b.json
 *       — JSON массивов стеков редактора → generateDSL → парсер.
 *   node scripts/parser-batch-check.mjs --regression
 *       — fixtures/ai-regression/*.json (сохранённые ответы ИИ).
 *
 * Опции: --json  печатать итог одной строкой JSON (для CI).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { lintCicadaWithPython } from '../services/pythonDslLint.mjs';
import { generateDSL } from '../core/stacksToDsl.js';
import { lintDSLSchema, formatDSLDiagnostic } from '../core/validator/schema.js';
import { normalizeAiGeneratedStacks, repairCollapsedCicadaCode } from '../core/validator/fixes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SYNTHETIC_CONFLICT_TAIL = '='.repeat(7) + '>'.repeat(7) + ' main';

/** @type {{ name: string, dsl: string, expectParserFail?: boolean }[]} */
const BUILTIN_DSL_CASES = [
  {
    name: 'минимум: старт + ответ + стоп',
    dsl: `бот "TEST"
при старте:
    ответ "Привет"
    стоп
`,
  },
  {
    name: 'кнопки + колбэк + сценарий',
    dsl: `бот "TEST"
при старте:
    кнопки "Заказ" "Помощь"
    стоп
при нажатии "Заказ":
    запустить оформление
    стоп
сценарий оформление:
    шаг s1:
        спросить "Имя?" → имя
        ответ "Ок, {имя}"
        стоп
`,
  },
  {
    name: 'условие иначе',
    dsl: `бот "TEST"
при старте:
    запустить проверка
    стоп
сценарий проверка:
    шаг s1:
        спросить "Возраст?" → возраст
        если возраст >= 18:
            ответ "Взрослый"
        иначе:
            ответ "Мало"
        стоп
`,
  },
  {
    name: 'условие с JS-оператором &&',
    dsl: `бот "TEST"
сценарий проверка_админа:
    шаг s1:
        спросить "Логин?" → логин
        спросить "Пароль?" → пароль
        если логин == "admin" && пароль == "12345":
            ответ "Доступ разрешён"
        иначе:
            ответ "Доступ запрещён"
        стоп
`,
  },
  {
    name: 'ключ БД с шаблоном (корректные скобки)',
    dsl: `бот "TEST"
сценарий s:
    шаг a:
        сохранить "file_{chat_id}" = 1
        получить "file_{chat_id}" → x
        стоп
`,
  },
  {
    name: 'намеренная ошибка: ) вместо } в ключе',
    expectParserFail: true,
    dsl: `бот "TEST"
сценарий s:
    шаг a:
        сохранить "file_{chat_id)" = 1
        стоп
`,
  },
  {
    name: 'цикл для каждого',
    dsl: `бот "TEST"
при старте:
    запомни список = [1, 2]
    для каждого i в список:
        ответ "{i}"
    стоп
`,
  },
  {
    name: 'http_get',
    dsl: `бот "TEST"
при старте:
    http_get "https://example.com" → t
    ответ "ok"
    стоп
`,
  },
  {
    name: 'выражение в фигурных скобках справа',
    dsl: `бот "TEST"
при старте:
    запомни x = 2
    ответ "двойка: {x * 2}"
    стоп
`,
  },
  {
    name: 'два ответа подряд в старте',
    dsl: `бот "TEST"
при старте:
    ответ "Шаг 1"
    ответ "Шаг 2"
    стоп
`,
  },
  {
    name: 'глобально + та же строка бот',
    dsl: `бот "TEST"
глобально счет = 0
при старте:
    ответ "Старт"
    стоп
`,
  },
  {
    name: 'схлопнутый DSL от AI-конвертера восстанавливается',
    dsl: repairCollapsedCicadaCode(
      'бот ""при старте:    ответ "Добро пожаловать в Dropbox-бот! 📁"    ' +
        'кнопки "📄 Загрузить файл" "📁 Просмотреть файлы"    стоппри нажатии ' +
        '"📄 Загрузить файл":    запустить загрузкапри нажатии ' +
        '"📁 Просмотреть файлы":    ответ "Ваши файлы:"    ' +
        'получить "files_{chat_id}" → files    ответ "{files}"    ' +
        'стопсценарий загрузка:    шаг шаг_загрузки:        ' +
        'спросить "Загрузите файл:" → файл        сохранить "files_{chat_id}" = {файл}        ' +
        'ответ "Файл загружен! 📄"        стоп' + SYNTHETIC_CONFLICT_TAIL,
    ),
  },
  {
    name: 'схлопнутый Drop Box DSL с # блок run восстанавливается',
    dsl: repairCollapsedCicadaCode(
      'бот "YOUR_BOT_TOKEN"при старте:    ответ "Добро пожаловать в Drop Box! 📦"    ' +
        'кнопки "📁 Загрузить файл" "📝 О нас"    стоппри нажатии "📁 Загрузить файл":    ' +
        '# блок run: {"name":"загрузка"}при нажатии "📝 О нас":    ответ "Мы — Drop Box! 📦"    ' +
        'стопсценарий загрузка:    шаг шаг_загрузки:    спросить "Отправьте файл для загрузки:" → файл    ' +
        'сохранить "f_{chat_id}" = {файл}    ответ "Файл загружен! 📦"    стоп',
    ),
  },
  {
    name: 'намеренная ошибка: # блок comment не считается рабочим DSL',
    expectParserFail: true,
    dsl: `бот "TEST"
при старте:
    # блок run: {"name":"загрузка"}
`,
  },
  {
    name: 'готовый DSL с хвостом conflict marker очищается',
    dsl: repairCollapsedCicadaCode(`бот "TEST"
при старте:
    ответ "ok"
    стоп${SYNTHETIC_CONFLICT_TAIL}
`),
  },
  {
    name: 'намеренная ошибка: неподдерживаемый формат фото с подписью не игнорируется',
    expectParserFail: true,
    dsl: `бот "TEST"
при старте:
    фото "https://example.com/a.jpg" "подпись"
    стоп
`,
  },
];

/** Реальные .ccd из репозитория (те же примеры, что лежат рядом с проектом). */
function repoExampleCcdCases() {
  const pairs = [
    ['examples/echo-bot.ccd', 'репо: Echo Bot (examples/echo-bot.ccd)'],
    ['examples/weather-bot.ccd', 'репо: погода (examples/weather-bot.ccd)'],
    ['examples/shop-bot.ccd', 'репо: магазин — каталог/корзина (examples/shop-bot.ccd)'],
    ['examples/demo-bot.ccd', 'репо: демо — квиз/медиа/inline (examples/demo-bot.ccd)'],
    ['examples/qr-bot.ccd', 'репо: QR-код (examples/qr-bot.ccd)'],
    ['examples/showcase-bot.ccd', 'репо: большой шаблон — меню/магазин/игра (examples/showcase-bot.ccd)'],
    ['bot.ccd', 'репо: Dropbox-бот (bot.ccd)'],
  ];
  const out = [];
  for (const [rel, label] of pairs) {
    const fp = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(fp)) continue;
    out.push({ name: label, dsl: fs.readFileSync(fp, 'utf8') });
  }
  return out;
}

function listCsvFiles(dir) {
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    console.error('Не каталог:', abs);
    process.exit(2);
  }
  return fs
    .readdirSync(abs)
    .filter((f) => f.endsWith('.ccd'))
    .map((f) => path.join(abs, f));
}

function unsupportedBlockCommentLines(dsl) {
  return String(dsl || '')
    .split('\n')
    .map((line, idx) => ({ line: idx + 1, text: line.trim() }))
    .filter((row) => /^#\s*блок\s+/.test(row.text));
}

function runOne(name, dsl, meta = {}) {
  const unsupportedComments = unsupportedBlockCommentLines(dsl);
  const schemaDiags = lintDSLSchema(dsl);
  const schemaErrs = schemaDiags.filter((d) => d.severity === 'error');
  const py = lintCicadaWithPython({ code: dsl, cwd: REPO_ROOT });
  return {
    name,
    expectParserFail: !!meta.expectParserFail,
    schemaOk: schemaErrs.length === 0,
    schemaHints: schemaErrs.slice(0, 3).map((d) => formatDSLDiagnostic(d)),
    rejectUnsupportedComments: !!meta.rejectUnsupportedComments,
    unsupportedComments: unsupportedComments.slice(0, 5),
    unsupportedCommentsOk: !meta.rejectUnsupportedComments || unsupportedComments.length === 0,
    py,
  };
}

function parserHasErrors(r) {
  const py = r.py;
  return (
    !py.available || !py.ok || (py.diagnostics && py.diagnostics.length > 0) || !!py.error
  );
}

/** Итог по кейсу: ok / unexpectedFail / negativeOk / negativeMiss (парсер проглотил баг) */
function classifyRow(r) {
  if (!r.schemaOk) return 'schemaFail';
  if (!r.unsupportedCommentsOk) return 'unsupportedCommentFail';
  if (r.expectParserFail) {
    if (parserHasErrors(r)) return 'negativeOk';
    return 'negativeMiss';
  }
  if (parserHasErrors(r)) return 'unexpectedFail';
  return 'ok';
}

function printReport(rows, asJson) {
  if (asJson) {
    console.log(
      JSON.stringify(
        rows.map((r) => ({
          ...r,
          outcome: classifyRow(r),
        })),
        null,
        0,
      ),
    );
    return;
  }
  for (const r of rows) {
    const py = r.py;
    const kind = classifyRow(r);
    let mark = '✓';
    if (kind === 'schemaFail' || kind === 'unsupportedCommentFail' || kind === 'unexpectedFail') mark = '✗';
    if (kind === 'negativeOk') mark = '✓';
    if (kind === 'negativeMiss') mark = '✗';

    const suffix = r.expectParserFail ? ' [негативный тест — ждём ошибку парсера]' : '';
    console.log('\n──', r.name, mark + suffix, '──');
    if (!r.schemaOk) {
      console.log('  schema:', r.schemaHints.join(' | ') || 'errors');
    }
    if (!r.unsupportedCommentsOk) {
      console.log('  unsupported:', r.unsupportedComments.map((x) => `стр.${x.line} ${x.text}`).join(' | '));
    }
    if (!py.available) {
      console.log('  parser: недоступен —', py.error || '?');
      continue;
    }
    if (kind === 'negativeOk') {
      const d = (py.diagnostics && py.diagnostics[0]) || {};
      const line = d.line != null ? `стр.${d.line}` : '';
      console.log('  parser: ожидаемая ошибка —', line, d.message || py.error || '');
      continue;
    }
    if (!py.ok || (py.diagnostics && py.diagnostics.length)) {
      for (const d of py.diagnostics || []) {
        const line = d.line != null ? `стр.${d.line}` : '';
        console.log('  parser:', line, d.message || d.code);
      }
      if (py.error && !(py.diagnostics && py.diagnostics.length)) {
        console.log('  parser:', py.error);
      }
    } else if (r.schemaOk) {
      console.log('  parser: ok, диагностик нет');
    }
    if (kind === 'negativeMiss') {
      console.log(
        '  ⚠ негативный тест: парсер не отверг код — доработать валидацию в parser.py',
      );
    }
  }

  const neg = rows.filter((r) => r.expectParserFail);
  const pos = rows.filter((r) => !r.expectParserFail);
  const negOk = neg.filter((r) => classifyRow(r) === 'negativeOk').length;
  const posOk = pos.filter((r) => classifyRow(r) === 'ok').length;
  if (neg.length) {
    console.log(
      `\nИтого: позитивные ${posOk}/${pos.length}, негативные (поймана ошибка) ${negOk}/${neg.length}.`,
    );
  } else {
    console.log(`\nИтого: позитивные ${posOk}/${pos.length}.`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const wantJson = args.includes('--json');
  const dirIdx = args.indexOf('--dir');
  let cases = [];

  if (args.includes('--regression')) {
    const regDir = path.join(REPO_ROOT, 'fixtures', 'ai-regression');
    if (!fs.existsSync(regDir)) {
      console.error('Нет каталога', regDir);
      process.exit(2);
    }
    const files = fs
      .readdirSync(regDir)
      .filter((f) => f.endsWith('.json'))
      .sort();
    if (!files.length) {
      console.error('В', regDir, 'нет .json файлов');
      process.exit(2);
    }
    for (const f of files) {
      const fp = path.join(regDir, f);
      const stacks = normalizeAiGeneratedStacks(JSON.parse(fs.readFileSync(fp, 'utf8')));
      cases.push({
        name: `regression:${f}`,
        dsl: generateDSL(stacks),
        rejectUnsupportedComments: true,
      });
    }
  } else if (dirIdx !== -1 && args[dirIdx + 1]) {
    for (const fp of listCsvFiles(args[dirIdx + 1])) {
      cases.push({
        name: path.basename(fp),
        dsl: fs.readFileSync(fp, 'utf8'),
      });
    }
  } else if (args[0] === 'stacks') {
    const files = args.slice(1).filter((a) => a !== '--json');
    for (const fp of files) {
      const raw = fs.readFileSync(path.resolve(fp), 'utf8');
      const stacks = normalizeAiGeneratedStacks(JSON.parse(raw));
      cases.push({
        name: path.basename(fp),
        dsl: generateDSL(stacks),
        rejectUnsupportedComments: true,
      });
    }
  } else {
    cases = BUILTIN_DSL_CASES.map((c) => ({
      name: c.name,
      dsl: c.dsl,
      expectParserFail: c.expectParserFail,
    }));
    cases.push(...repoExampleCcdCases());
  }

  const rows = cases.map((c) =>
    runOne(c.name, c.dsl, { expectParserFail: c.expectParserFail, rejectUnsupportedComments: c.rejectUnsupportedComments }),
  );
  printReport(rows, wantJson);

  const failed = rows.filter((r) => classifyRow(r) !== 'ok' && classifyRow(r) !== 'negativeOk');
  if (failed.length && process.env.CI === 'true') {
    console.error(
      '\nCI: провал:',
      failed.map((r) => `${r.name} (${classifyRow(r)})`).join(', '),
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
