/**
 * Манифест возможностей parser-capabilities ↔ версии контракта.
 *
 *   node --test tests/capabilities-manifest.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCHEMA_VERSIONS = path.join(ROOT, 'schemas', 'schema-versions.json');
const CAP_DEFAULT = path.join(ROOT, 'manifests', 'parser-capabilities.default.json');

test('parser-capabilities.default.json schemaVersion = capabilitiesManifestVersion', () => {
  const canonical = JSON.parse(fs.readFileSync(SCHEMA_VERSIONS, 'utf8'));
  const cap = JSON.parse(fs.readFileSync(CAP_DEFAULT, 'utf8'));
  assert.strictEqual(cap.schemaVersion, canonical.capabilitiesManifestVersion);
  assert.ok(Array.isArray(cap.features));
  assert.ok(cap.features.includes('switch'));
});
