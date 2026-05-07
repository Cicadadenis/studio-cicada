/**
 * AST → DSL → AST (через ast_json_emit.py и parser).
 * Эталон — тот же JSON, что tests/expected/roundtrip/*.ast.json (после normalizeAst).
 *
 *   node --test tests/dsl-codegen.ast-roundtrip.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { normalizeAst } from './ast-normalize.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ROUNDTRIP_EXPECTED = path.join(__dirname, 'expected', 'roundtrip');
const PARSE_SCRIPT = path.join(__dirname, 'tools', 'dsl_to_ast_json.py');
const EMIT_SCRIPT = path.join(__dirname, 'tools', 'ast_json_emit.py');

function pythonCmd() {
  if (process.env.PYTHON) return process.env.PYTHON;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function parseAstJson(text) {
  return JSON.parse(text.replace(/\r\n/g, '\n'));
}

function parseToAst(dsl) {
  const res = spawnSync(pythonCmd(), [PARSE_SCRIPT], {
    cwd: ROOT,
    input: dsl,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(`dsl_to_ast_json.py: ${res.stderr || res.stdout}`);
  }
  return parseAstJson(res.stdout);
}

function emitAstToDsl(astObj) {
  const res = spawnSync(pythonCmd(), [EMIT_SCRIPT], {
    cwd: ROOT,
    input: JSON.stringify(astObj),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(`ast_json_emit.py: ${res.stderr || res.stdout}`);
  }
  return res.stdout.replace(/\r\n/g, '\n');
}

/** Кэш: parser поддерживает SwitchStmt (см. dsl-codegen.roundtrip.test.mjs). */
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

test('normalizeAst убирает метаданные для стабильного сравнения', () => {
  const noisy = {
    line: 9,
    _internal: 'x',
    foo: { b: 2, a: 1 },
  };
  const clean = { foo: { a: 1, b: 2 } };
  assert.deepStrictEqual(normalizeAst(noisy), normalizeAst(clean));
});

for (const name of CASES) {
  const skipReason =
    name === 'switch' && !parserSupportsSwitchStmt()
      ? 'parser без SwitchStmt — кейс switch для AST→DSL→AST недоступен'
      : false;

  test(
    `AST → DSL → AST roundtrip: ${name}`,
    { skip: skipReason },
    () => {
      const astPath = path.join(ROUNDTRIP_EXPECTED, `${name}.ast.json`);
      const ast0 = parseAstJson(fs.readFileSync(astPath, 'utf8'));
      const dsl = emitAstToDsl(ast0);
      const ast1 = parseToAst(dsl);
      assert.deepStrictEqual(normalizeAst(ast1), normalizeAst(ast0));
    },
  );
}
