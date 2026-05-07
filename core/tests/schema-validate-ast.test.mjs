/**
 * Полная проверка эталонных AST по schemas/ast.schema.json (через tests/tools/validate_ast.py).
 * Нужны Python и pip-пакет jsonschema (requirements-dev.txt).
 *
 *   pip install -r requirements-dev.txt
 *   node --test tests/schema-validate-ast.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VALIDATE_SCRIPT = path.join(__dirname, 'tools', 'validate_ast.py');
const ROUNDTRIP_AST = path.join(__dirname, 'expected', 'roundtrip');

function pythonCmd() {
  return process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

function hasJsonSchema() {
  const r = spawnSync(pythonCmd(), ['-c', 'import jsonschema'], {
    encoding: 'utf8',
    cwd: ROOT,
  });
  return r.status === 0;
}

const SKIP_FULL_AST =
  process.env.SKIP_AST_VALIDATE === '1'
    ? 'SKIP_AST_VALIDATE=1'
    : !hasJsonSchema()
      ? 'установите: pip install -r requirements-dev.txt'
      : false;

function validateAstFile(absPath) {
  return spawnSync(pythonCmd(), [VALIDATE_SCRIPT, absPath, '-q'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

const CASES = ['switch', 'simple_reply', 'message_newline', 'condition'];

test(
  'validate_ast.py + jsonschema: эталоны roundtrip',
  { skip: SKIP_FULL_AST },
  () => {
    assert.ok(fs.existsSync(VALIDATE_SCRIPT), `нет ${path.relative(ROOT, VALIDATE_SCRIPT)}`);
    for (const name of CASES) {
      const p = path.join(ROUNDTRIP_AST, `${name}.ast.json`);
      const res = validateAstFile(p);
      assert.strictEqual(
        res.status,
        0,
        `${name}: validate_ast exited ${res.status}\n${res.stderr || res.stdout || ''}`,
      );
    }
  },
);
