/**
 * Roundtrip: IR → DSL (renderIr) → parser.py → AST JSON ≟ expected.
 *
 * Из каталога core/:
 *   node --test tests/dsl-codegen.roundtrip.test.mjs
 *
 * Обновить эталоны AST после намеренного изменения парсера/генератора:
 *   node tests/update-roundtrip-ast.mjs
 *
 * Переменные окружения:
 *   PYTHON — интерпретатор (по умолчанию python на Windows, python3 иначе)
 *   CICADA_PARSER_PATH — явный путь к parser.py или к каталогу с ним
 *
 * Кейс «switch» пропускается (skip), если выбранный parser не даёт узел SwitchStmt
 * (нет поддержки «переключить»). Полный прогон: укажите CICADA_PARSER_PATH на ядро Cicada.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { renderIr } from '../dslCodegen.js';
import { normalizeAst } from './ast-normalize.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ROUNDTRIP_FIXTURES = path.join(__dirname, 'fixtures', 'roundtrip');
const ROUNDTRIP_EXPECTED = path.join(__dirname, 'expected', 'roundtrip');
const PY_SCRIPT = path.join(__dirname, 'tools', 'dsl_to_ast_json.py');
const SCHEMA_VERSIONS = path.join(__dirname, '..', 'schemas', 'schema-versions.json');
const VERSION_CONSTANTS = JSON.parse(fs.readFileSync(SCHEMA_VERSIONS, 'utf8'));

function pythonCmd() {
  if (process.env.PYTHON) return process.env.PYTHON;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function parseAstJson(text) {
  return JSON.parse(text.replace(/\r\n/g, '\n'));
}

function parseToAst(dsl) {
  const res = spawnSync(pythonCmd(), [PY_SCRIPT], {
    cwd: ROOT,
    input: dsl,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(
      `dsl_to_ast_json.py failed (${res.status}):\n${res.stderr || ''}\nDSL:\n${dsl}`,
    );
  }
  return parseAstJson(res.stdout);
}

/** Кэш: текущий parser.py поддерживает «переключить» / SwitchStmt. */
let _parserHasSwitchStmt;
function parserSupportsSwitchStmt() {
  if (_parserHasSwitchStmt !== undefined) return _parserHasSwitchStmt;
  const dsl =
    'версия "1.0"\nбот "0:d"\n\nпри команде "/p":\n    переключить _probe:\n        "a":\n            ответ "x"\n';
  try {
    const ast = parseToAst(dsl);
    _parserHasSwitchStmt = JSON.stringify(ast).includes('"SwitchStmt"');
  } catch {
    _parserHasSwitchStmt = false;
  }
  return _parserHasSwitchStmt;
}

const CASES = ['switch', 'simple_reply', 'message_newline', 'condition'];

for (const name of CASES) {
  const skipReason =
    name === 'switch' && !parserSupportsSwitchStmt()
      ? 'parser без SwitchStmt (переключить): задайте CICADA_PARSER_PATH на ядро с переключить или обновите cicada/parser.py'
      : false;

  test(
    `IR → DSL → AST roundtrip: ${name}`,
    { skip: skipReason },
    () => {
      const irPath = path.join(ROUNDTRIP_FIXTURES, `${name}.ir.json`);
      const astPath = path.join(ROUNDTRIP_EXPECTED, `${name}.ast.json`);
      const ir = JSON.parse(fs.readFileSync(irPath, 'utf8'));
      assert.strictEqual(ir.schemaVersion, VERSION_CONSTANTS.irSchemaVersion);
      const dsl = renderIr(ir);
      const actual = parseToAst(dsl);
      const expected = parseAstJson(fs.readFileSync(astPath, 'utf8'));
      assert.strictEqual(expected.schemaVersion, VERSION_CONSTANTS.astSchemaVersion);
      assert.strictEqual(actual.schemaVersion, VERSION_CONSTANTS.astSchemaVersion);
      assert.deepStrictEqual(normalizeAst(actual), normalizeAst(expected));
    },
  );
}
