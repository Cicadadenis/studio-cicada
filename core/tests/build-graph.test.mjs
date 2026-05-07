/**
 * Build graph: Merkle rollup + edges (формат v2+).
 *
 *   node --test tests/build-graph.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCHEMA_VERSIONS = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', 'schema-versions.json'), 'utf8'));
const SCRIPT = path.join(__dirname, 'tools', 'ast_build_graph.py');
const SIMPLE_AST = path.join(__dirname, 'expected', 'roundtrip', 'simple_reply.ast.json');

function pythonCmd() {
  return process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

function runGraph(astPath) {
  const res = spawnSync(pythonCmd(), [SCRIPT, astPath], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr || res.stdout);
  return JSON.parse(res.stdout);
}

test('ast_build_graph v2: Merkle поля, рёбра, стабильный stdout', () => {
  const g = runGraph(SIMPLE_AST);
  assert.strictEqual(g.buildGraphFormatVersion, SCHEMA_VERSIONS.buildGraphFormatVersion);
  assert.strictEqual(g.merkleRootHash, g.programFullHash);
  assert.match(g.programShellHash, /^[0-9a-f]{64}$/);
  assert.match(g.programFullHash, /^[0-9a-f]{64}$/);
  assert.match(g.programSubtreeFingerprint, /^[0-9a-f]{64}$/);
  assert.notStrictEqual(g.programShellHash, g.programFullHash);

  assert.ok(Array.isArray(g.edges));
  assert.ok(g.edges.some((e) => e.type === 'contains' && e.from === 'handler:0'));

  const h = g.nodes.find((n) => n.id === 'handler:0');
  assert.match(h.contentHash, /^[0-9a-f]{64}$/);
  assert.match(h.rollupHash, /^[0-9a-f]{64}$/);
  assert.notStrictEqual(h.rollupHash, h.contentHash);

  const reply = g.nodes.find((n) => n.id === 'handler:0:s0');
  assert.strictEqual(reply.stmtType, 'Reply');
  assert.match(reply.subtreeHash, /^[0-9a-f]{64}$/);
});

test('ast_build_graph: два запуска → одинаковые байты stdout', () => {
  const a = spawnSync(pythonCmd(), [SCRIPT, SIMPLE_AST], { cwd: ROOT, encoding: 'utf8' });
  const b = spawnSync(pythonCmd(), [SCRIPT, SIMPLE_AST], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(a.stdout, b.stdout);
});

test('ast_build_graph: switch — control_flow / switch_variant рёбра', () => {
  const astPath = path.join(__dirname, 'expected', 'roundtrip', 'switch.ast.json');
  const g = runGraph(astPath);
  assert.ok(g.edges.some((e) => e.type === 'switch_variant'));
  const sw = g.nodes.find((n) => n.id === 'handler:0:s0');
  assert.strictEqual(sw.stmtType, 'SwitchStmt');
  assert.notStrictEqual(sw.contentHash, sw.rollupHash);
});
