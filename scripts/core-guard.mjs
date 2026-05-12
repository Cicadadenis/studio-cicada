#!/usr/bin/env node
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const EXPECTED_VERSION = '0.3.5';
const DEFAULT_CANONICAL_CORE = '/usr/local/lib/python3.12/dist-packages/cicada';
const SYNCED_DIRS = [
  'cicada',
  'core',
  'vendor/cicada-dsl-parser/cicada',
];
const CORE_RUNTIME_DIRS = [
  'cicada',
  'core',
  'vendor/cicada-dsl-parser/cicada',
];

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function listPyFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fp = path.join(current, entry.name);
      if (entry.isDirectory()) walk(fp);
      else if (entry.isFile() && entry.name.endsWith('.py')) out.push(fp);
    }
  };
  walk(dir);
  return out.sort();
}

function runPythonSnippet(snippet) {
  const env = { ...process.env };
  delete env.PYTHONPATH;
  return spawnSync('python3', ['-c', snippet], {
    cwd: '/',
    encoding: 'utf8',
    env,
  });
}

function resolveCanonicalCore() {
  if (process.env.CICADA_CANONICAL_CORE) {
    return path.resolve(process.env.CICADA_CANONICAL_CORE);
  }
  const py = [
    'import pathlib',
    'import cicada',
    'print(pathlib.Path(cicada.__file__).resolve().parent)',
  ].join('; ');
  const proc = runPythonSnippet(py);
  const resolved = String(proc.stdout || '').trim();
  return resolved || path.resolve(DEFAULT_CANONICAL_CORE);
}

const CANONICAL_CORE = resolveCanonicalCore();

function readVersion() {
  const py = [
    'import importlib.metadata as m',
    'print(m.version("cicada-tg"))',
  ].join('; ');
  const proc = runPythonSnippet(py);
  if (proc.status !== 0) return null;
  return String(proc.stdout || '').trim();
}

function apiSurface(modulePath) {
  const py = `
import ast, json, pathlib, sys
p = pathlib.Path(sys.argv[1])
tree = ast.parse(p.read_text(encoding="utf-8"))
items = []
for node in tree.body:
    if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
        args = []
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            args = [a.arg for a in node.args.args]
        fields = []
        if isinstance(node, ast.ClassDef):
            for sub in node.body:
                if isinstance(sub, ast.AnnAssign) and isinstance(sub.target, ast.Name):
                    fields.append(sub.target.id)
        items.append({"kind": node.__class__.__name__, "name": node.name, "args": args, "fields": fields})
print(json.dumps(items, ensure_ascii=False, sort_keys=True))
`.trim();
  const proc = spawnSync('python3', ['-c', py, modulePath], { encoding: 'utf8' });
  if (proc.status !== 0) {
    throw new Error(`API surface extraction failed for ${modulePath}: ${proc.stderr || proc.stdout}`);
  }
  return JSON.parse(proc.stdout);
}

function compareHashes() {
  const failures = [];
  const canonicalFiles = listPyFiles(CANONICAL_CORE);
  for (const coreFile of canonicalFiles) {
    const rel = path.relative(CANONICAL_CORE, coreFile);
    const coreHash = sha256(coreFile);
    for (const dir of SYNCED_DIRS) {
      const target = path.join(REPO_ROOT, dir, rel);
      if (!fs.existsSync(target)) {
        failures.push({ type: 'missing', dir, file: rel });
        continue;
      }
      const targetHash = sha256(target);
      if (targetHash !== coreHash) {
        failures.push({ type: 'hash', dir, file: rel, expected: coreHash, actual: targetHash });
      }
    }
  }
  return failures;
}

function compareApiSurface() {
  const failures = [];
  const modules = ['core.py', 'parser.py', 'executor.py', 'runtime.py', 'runner.py', 'preview.py', 'preview_worker.py', 'adapters/telegram.py', 'adapters/mock_telegram.py'];
  for (const rel of modules) {
    const expected = JSON.stringify(apiSurface(path.join(CANONICAL_CORE, rel)));
    for (const dir of SYNCED_DIRS) {
      const target = path.join(REPO_ROOT, dir, rel);
      if (!fs.existsSync(target)) continue;
      const actual = JSON.stringify(apiSurface(target));
      if (actual !== expected) failures.push({ type: 'api', dir, file: rel });
    }
  }
  return failures;
}

function guardLegacyImports() {
  const failures = [];
  const importRe = /(?:from\s+legacy(?:\.|\s)|import\s+legacy\b|['"]\.\.?\/legacy\/|['"]legacy\/)/;
  for (const dir of CORE_RUNTIME_DIRS) {
    const root = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(root)) continue;
    for (const file of listPyFiles(root)) {
      const text = fs.readFileSync(file, 'utf8');
      if (importRe.test(text)) failures.push({ type: 'forbidden-legacy-import', file: path.relative(REPO_ROOT, file) });
    }
  }
  return failures;
}

function main() {
  const failures = [];
  if (!fs.existsSync(CANONICAL_CORE)) {
    failures.push({ type: 'missing-canonical-core', path: CANONICAL_CORE });
  }
  const version = readVersion();
  if (version !== EXPECTED_VERSION) {
    failures.push({ type: 'version', expected: EXPECTED_VERSION, actual: version || 'unavailable' });
  }
  if (!failures.length) {
    failures.push(...compareHashes(), ...compareApiSurface(), ...guardLegacyImports());
  }
  if (failures.length) {
    console.error(JSON.stringify({ ok: false, canonicalCore: CANONICAL_CORE, expectedVersion: EXPECTED_VERSION, failures }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({
    ok: true,
    canonicalCore: CANONICAL_CORE,
    version,
    syncedDirs: SYNCED_DIRS,
    policy: 'CORE immutable; Studio changes must go through adapters/extensions.',
  }, null, 2));
}

main();
