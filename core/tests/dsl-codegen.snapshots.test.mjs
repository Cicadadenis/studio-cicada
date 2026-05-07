/**
 * Golden-снимки IR → DSL для dslCodegen.js (узкое место: генератор).
 *
 * Запуск из каталога core/:
 *   node --test tests/dsl-codegen.snapshots.test.mjs
 *
 * Обновить эталоны после намеренного изменения вывода:
 *   node tests/update-dsl-snapshots.mjs
 *
 * Версия снимков: tests/snapshots/manifest.json; канон —
 * schemas/schema-versions.json → dslSnapshotManifestVersion.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderIr } from '../dslCodegen.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');
const SNAPSHOTS = path.join(__dirname, 'snapshots');
const SCHEMA_VERSIONS = path.join(__dirname, '..', 'schemas', 'schema-versions.json');
const VERSION_CONSTANTS = JSON.parse(fs.readFileSync(SCHEMA_VERSIONS, 'utf8'));

/** Единый финальный перевод строки + завершающий \\n. */
function normalizeDsl(s) {
  return s.replace(/\r\n/g, '\n').replace(/\s*$/, '') + '\n';
}

test('snapshots/manifest.json schemaVersion совпадает с schemas/schema-versions.json', () => {
  const snapManifest = JSON.parse(fs.readFileSync(path.join(SNAPSHOTS, 'manifest.json'), 'utf8'));
  assert.strictEqual(snapManifest.schemaVersion, VERSION_CONSTANTS.dslSnapshotManifestVersion);
});

const CASES = ['simple_reply', 'condition', 'switch', 'message_newline'];

for (const name of CASES) {
  test(`IR → DSL snapshot: ${name}`, () => {
    const irPath = path.join(FIXTURES, `${name}.ir.json`);
    const snapPath = path.join(SNAPSHOTS, `${name}.dsl`);
    const ir = JSON.parse(fs.readFileSync(irPath, 'utf8'));
    assert.strictEqual(ir.schemaVersion, VERSION_CONSTANTS.irSchemaVersion, `${name}.ir.json schemaVersion`);
    const actual = normalizeDsl(renderIr(ir));
    const expected = normalizeDsl(fs.readFileSync(snapPath, 'utf8'));
    assert.equal(actual, expected);
  });
}
