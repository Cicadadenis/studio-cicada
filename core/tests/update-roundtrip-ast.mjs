/**
 * Перезаписать tests/expected/roundtrip/*.ast.json (осознанное обновление эталонов AST).
 *
 * Выход: канонический JSON (canonical_ast_json.dumps_canonical), корень Program с schemaVersion.
 *
 *   node tests/update-roundtrip-ast.mjs
 *
 * Используется parser из dsl_to_ast_json.py (CICADA_PARSER_PATH или авто-поиск).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { renderIr } from '../dslCodegen.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'roundtrip');
const OUT = path.join(__dirname, 'expected', 'roundtrip');
const PY_SCRIPT = path.join(__dirname, 'tools', 'dsl_to_ast_json.py');

function pythonCmd() {
  if (process.env.PYTHON) return process.env.PYTHON;
  return process.platform === 'win32' ? 'python' : 'python3';
}

const CASES = ['switch', 'simple_reply', 'message_newline', 'condition'];

mkdirSync(OUT, { recursive: true });

for (const name of CASES) {
  const ir = JSON.parse(readFileSync(path.join(FIX, `${name}.ir.json`), 'utf8'));
  const dsl = renderIr(ir);
  const res = spawnSync(pythonCmd(), [PY_SCRIPT], {
    cwd: ROOT,
    input: dsl,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (res.status !== 0) {
    console.error(res.stderr);
    process.exit(1);
  }
  let text = res.stdout.replace(/\r\n/g, '\n');
  if (!text.endsWith('\n')) text += '\n';
  writeFileSync(path.join(OUT, `${name}.ast.json`), text);
  console.log('updated', name);
}
