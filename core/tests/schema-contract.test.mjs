/**
 * Без Ajv: сверяем фикстуры с enums в schemas/*.schema.json (ловит shape/type drift).
 *
 *   node --test tests/schema-contract.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCHEMAS = path.join(ROOT, 'schemas');

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function enumFromDefs(schema, defName) {
  const def = schema.$defs?.[defName];
  if (!def?.enum) throw new Error(`schemas: нет $defs.${defName}.enum`);
  return new Set(def.enum);
}

function walk(obj, fn) {
  if (obj === null || obj === undefined) return;
  if (Array.isArray(obj)) {
    obj.forEach((x) => walk(x, fn));
    return;
  }
  if (typeof obj === 'object') {
    fn(obj);
    for (const v of Object.values(obj)) walk(v, fn);
  }
}

function collectAstTypes(astRoot, out) {
  walk(astRoot, (o) => {
    if (typeof o.__type__ === 'string') out.add(o.__type__);
  });
}

function collectIrBlockTypes(obj, out) {
  walk(obj, (o) => {
    if (typeof o.type !== 'string') return;
    if (Object.prototype.hasOwnProperty.call(o, 'props')) out.add(o.type);
    if (Object.prototype.hasOwnProperty.call(o, 'block') && o.block?.type)
      out.add(o.block.type);
  });
  walk(obj, (o) => {
    if (!Array.isArray(o.blocks)) return;
    for (const b of o.blocks) {
      if (b && typeof b.type === 'string') out.add(b.type);
    }
  });
  walk(obj, (o) => {
    if (!Array.isArray(o.nodes)) return;
    for (const n of o.nodes) {
      if (n && typeof n.type === 'string') out.add(n.type);
    }
  });
}

function jsonFilesRecursive(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...jsonFilesRecursive(p));
    else if (name.endsWith('.json')) out.push(p);
  }
  return out;
}

const irSchema = loadJson(path.join(SCHEMAS, 'ir.schema.json'));
const astSchema = loadJson(path.join(SCHEMAS, 'ast.schema.json'));
const allowedIrTypes = enumFromDefs(irSchema, 'IrBlockType');
const allowedAstTypes = enumFromDefs(astSchema, 'AstNodeType');

test('IR фикстуры: все block.type входят в schemas/ir.schema.json', () => {
  const dirs = [
    path.join(__dirname, 'fixtures'),
    path.join(__dirname, 'fixtures', 'roundtrip'),
    path.join(__dirname, 'expected', 'roundtrip'),
  ];
  const bad = [];
  for (const dir of dirs) {
    for (const f of jsonFilesRecursive(dir)) {
      if (!f.endsWith('.ir.json')) continue;
      const used = new Set();
      collectIrBlockTypes(loadJson(f), used);
      for (const t of used) {
        if (!allowedIrTypes.has(t)) bad.push(`${path.relative(ROOT, f)}: unknown IR type "${t}"`);
      }
    }
  }
  assert.deepStrictEqual(bad, [], bad.join('\n'));
});

test('AST эталоны: все __type__ входят в schemas/ast.schema.json', () => {
  const dir = path.join(__dirname, 'expected', 'roundtrip');
  const bad = [];
  for (const f of jsonFilesRecursive(dir)) {
    if (!f.endsWith('.ast.json')) continue;
    const used = new Set();
    collectAstTypes(loadJson(f), used);
    for (const t of used) {
      if (!allowedAstTypes.has(t)) bad.push(`${path.relative(ROOT, f)}: unknown AST __type__ "${t}"`);
    }
  }
  assert.deepStrictEqual(bad, [], bad.join('\n'));
});
