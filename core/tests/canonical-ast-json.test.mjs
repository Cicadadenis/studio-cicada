/**
 * Каноническая сериализация AST (tests/tools/canonical_ast_json.py).
 *
 *   node --test tests/canonical-ast-json.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.join(__dirname, 'tools');

function pythonCmd() {
  return process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

test('dumps_canonical: два прохода дают один и тот же текст', () => {
  const code = `
import json
from canonical_ast_json import dumps_canonical
j = {"b": 2, "a": {"y": 1, "x": 0}}
s1 = dumps_canonical(j)
s2 = dumps_canonical(json.loads(s1))
assert s1 == s2, (s1, s2)
print("ok")
`;
  const res = spawnSync(pythonCmd(), ['-c', code], {
    encoding: 'utf8',
    cwd: TOOLS,
  });
  assert.strictEqual(res.status, 0, res.stderr || res.stdout);
  assert.ok((res.stdout + res.stderr).includes('ok'));
});
