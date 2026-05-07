/**
 * Project manifest: формат и примеры ↔ schemas/schema-versions.json.
 *
 * Полная проверка по JSON Schema (jsonschema):
 *   python tests/tools/validate_project_manifest.py manifests/project.minimal.example.json
 *
 *   node --test tests/project-manifest.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCHEMA_VERSIONS = path.join(ROOT, 'schemas', 'schema-versions.json');
const MANIFESTS = path.join(ROOT, 'manifests');
const VALIDATE_SCRIPT = path.join(__dirname, 'tools', 'validate_project_manifest.py');

const EXAMPLES = [
  'project.minimal.example.json',
  'project.switch-bot.example.json',
  'project.forward-compat.example.json',
];

function pythonCmd() {
  return process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

let jsonschemaAvailable;
function hasJsonSchema() {
  if (jsonschemaAvailable !== undefined) return jsonschemaAvailable;
  const r = spawnSync(pythonCmd(), ['-c', 'import jsonschema'], { encoding: 'utf8', cwd: ROOT });
  jsonschemaAvailable = r.status === 0;
  return jsonschemaAvailable;
}

test('project manifests: projectFormatVersion = projectManifestFormatVersion', () => {
  const canonical = JSON.parse(fs.readFileSync(SCHEMA_VERSIONS, 'utf8'));
  for (const name of EXAMPLES) {
    const p = path.join(MANIFESTS, name);
    const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.strictEqual(
      doc.projectFormatVersion,
      canonical.projectManifestFormatVersion,
      `${name}: обновите manifest или schemas/schema-versions.json`,
    );
    assert.ok(Array.isArray(doc.requiredFeatures));
    assert.strictEqual(typeof doc.requiredAstSchemaVersion, 'number');
  }
});

const validateSkipReason =
  process.env.SKIP_PROJECT_MANIFEST_VALIDATE === '1'
    ? 'SKIP_PROJECT_MANIFEST_VALIDATE=1'
    : !hasJsonSchema()
      ? 'pip install jsonschema'
      : false;

test(
  'validate_project_manifest.py: примеры проходят JSON Schema',
  { skip: validateSkipReason },
  () => {
    for (const name of EXAMPLES) {
      const abs = path.join(MANIFESTS, name);
      const res = spawnSync(pythonCmd(), [VALIDATE_SCRIPT, abs, '-q'], { cwd: ROOT, encoding: 'utf8' });
      assert.strictEqual(res.status, 0, `${name}: ${res.stderr || res.stdout}`);
    }
  },
);

test('project.switch-bot / forward-compat: requiredFeatures ⊆ parser-capabilities.default', () => {
  const capsPath = path.join(MANIFESTS, 'parser-capabilities.default.json');
  const caps = JSON.parse(fs.readFileSync(capsPath, 'utf8'));
  const allowed = new Set(caps.features);
  for (const name of ['project.switch-bot.example.json', 'project.forward-compat.example.json']) {
    const doc = JSON.parse(fs.readFileSync(path.join(MANIFESTS, name), 'utf8'));
    for (const f of doc.requiredFeatures) {
      assert.ok(allowed.has(f), `${name}: неизвестная requiredFeatures «${f}» для текущего parser-capabilities.default`);
    }
  }
});
