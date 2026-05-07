/**
 * Перезаписать tests/snapshots/*.dsl из fixtures (осознанное обновление golden).
 *
 *   node tests/update-dsl-snapshots.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderIr } from '../dslCodegen.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');
const SNAPSHOTS = path.join(__dirname, 'snapshots');

const CASES = ['simple_reply', 'condition', 'switch', 'message_newline'];

mkdirSync(SNAPSHOTS, { recursive: true });

for (const name of CASES) {
  const ir = JSON.parse(readFileSync(path.join(FIXTURES, `${name}.ir.json`), 'utf8'));
  let out = renderIr(ir).replace(/\r\n/g, '\n');
  if (!out.endsWith('\n')) out += '\n';
  writeFileSync(path.join(SNAPSHOTS, `${name}.dsl`), out);
  console.log('updated', name);
}
