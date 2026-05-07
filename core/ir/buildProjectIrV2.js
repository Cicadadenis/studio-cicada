import { normalizeFlowNode } from './normalizeFlowNode.js';
import { IR_SCHEMA_VERSION_V2 } from './irSchema.js';
import { normalizeIrBuildOptions } from './irBuildOptions.js';

function trimStr(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Compiler id для узла Studio.
 * Пермиссивно: data.irId | data.compilerId | React Flow node.id (legacy canvas).
 * При options.strictCompilerIdentity — только data.irId | data.compilerId (fallback на node.id запрещён).
 *
 * @param {unknown} rawNode
 * @param {{ strictCompilerIdentity?: boolean }} [options]
 */
export function getCompilerId(rawNode, options = {}) {
  const strict = Boolean(options.strictCompilerIdentity);
  const d = /** @type {{ irId?: string, compilerId?: string }} */ (rawNode?.data || {});
  const fromData = trimStr(d.irId) || trimStr(d.compilerId);
  if (strict) return fromData;
  if (fromData) return fromData;
  return trimStr(rawNode?.id);
}

function uxLabel(rawNode) {
  const d = rawNode?.data || {};
  const fromData = trimStr(d.label);
  const p = d.props || {};
  if (fromData) return fromData;
  return trimStr(p.label);
}

function dslEmitName(ir) {
  const n = trimStr(/** @type {{ name?: string }} */ (ir.props).name);
  if (ir.type === 'scenario' || ir.type === 'step' || ir.type === 'block') return n || ir.id;
  return ir.id;
}

/** Строка DSL для узлов scenario | step | block (для codegen без мутации flow). */
export function irNodeDslEmitName(ir) {
  return dslEmitName(ir);
}

const BUILTIN_GOTO = new Set(['main', 'повторить']);

/**
 * @param {unknown} flow
 * @param {import('./irBuildOptions.js').IrBuildOptions} [buildOptions]
 */
export function buildProjectIrV2(flow, buildOptions) {
  const opts = normalizeIrBuildOptions(buildOptions);
  const rawNodes = flow?.nodes || [];
  const edges = flow?.edges || [];
  const buildWarnings = [];
  const buildErrors = [];

  /**
   * Линковка (этап linker): compiler id целевого узла или null для builtin.
   * Кодоген (этап codegen): строка для DSL — только emitTargetName, не смешивать ссылку графа в одном значении.
   *
   * @type {Array<{
   *   id: string,
   *   flowNodeId: string,
   *   type: string,
   *   label?: string,
   *   props: Record<string, unknown>,
   *   resolvedTargetId?: string | null,
   *   emitTargetName?: string | null,
   *   resolvedTargetType?: string,
   *   resolutionNotes?: string[],
   * }>}
   */
  const irNodes = [];
  const seenCompiler = new Set();

  for (const n of rawNodes) {
    const cid = getCompilerId(n, opts);
    if (!cid) {
      const fid = trimStr(String(n?.id ?? ''));
      const detail = opts.strictCompilerIdentity
        ? `IR strict: узел React Flow «${fid || '?'}» без data.irId / data.compilerId`
        : `IR v2: узел React Flow без id и без data.irId`;
      if (opts.strictCompilerIdentity) buildErrors.push(detail);
      else buildWarnings.push(detail);
      continue;
    }
    if (seenCompiler.has(cid)) {
      buildWarnings.push(`IR v2: повтор compiler id «${cid}»`);
    }
    seenCompiler.add(cid);

    const norm = normalizeFlowNode(n);
    const props = { ...norm.props };
    const label = uxLabel(n);
    if (label && !trimStr(props.label)) props.label = label;

    const entry = {
      id: cid,
      flowNodeId: n.id,
      type: norm.type,
      props,
    };
    if (label) entry.label = label;
    irNodes.push(entry);
  }

  const byCompilerId = new Map(irNodes.map((x) => [x.id, x]));
  const scenariosByName = new Map();
  const stepsByName = new Map();
  const blocksByName = new Map();

  for (const ir of irNodes) {
    const name = trimStr(ir.props.name);
    if (ir.type === 'scenario' && name) {
      if (scenariosByName.has(name)) {
        buildWarnings.push(`IR v2: не уникально DSL-имя сценария «${name}»`);
      }
      scenariosByName.set(name, ir.id);
    }
    if (ir.type === 'step' && name) {
      if (stepsByName.has(name)) buildWarnings.push(`IR v2: не уникально имя шага «${name}»`);
      stepsByName.set(name, ir.id);
    }
    if (ir.type === 'block' && name) {
      if (blocksByName.has(name)) buildWarnings.push(`IR v2: не уникально имя блока «${name}»`);
      blocksByName.set(name, ir.id);
    }
  }

  function resolveTargetSpec(rawSpec) {
    const spec = trimStr(String(rawSpec ?? ''));
    if (!spec) return { targetId: null, emit: null, notes: ['пустая цель'] };
    if (BUILTIN_GOTO.has(spec)) return { targetId: null, emit: spec, notes: ['встроенная цель'] };

    if (byCompilerId.has(spec)) {
      const t = byCompilerId.get(spec);
      return {
        targetId: t.id,
        emit: dslEmitName(t),
        notes: ['разрешено: compiler id'],
      };
    }
    if (!opts.forbidGotoResolutionByDisplayName) {
      if (scenariosByName.has(spec)) {
        const tid = scenariosByName.get(spec);
        const t = byCompilerId.get(tid);
        return { targetId: tid, emit: dslEmitName(t), notes: ['legacy: имя сценария'] };
      }
      if (stepsByName.has(spec)) {
        const tid = stepsByName.get(spec);
        const t = byCompilerId.get(tid);
        return { targetId: tid, emit: dslEmitName(t), notes: ['legacy: имя шага'] };
      }
      if (blocksByName.has(spec)) {
        const tid = blocksByName.get(spec);
        const t = byCompilerId.get(tid);
        return { targetId: tid, emit: dslEmitName(t), notes: ['legacy: имя блока'] };
      }
    }
    return {
      targetId: null,
      emit: null,
      notes: opts.forbidGotoResolutionByDisplayName
        ? [`нет цели для «${spec}» (strict: только compiler id или встроенная цель)`]
        : [`нет цели для «${spec}»`],
    };
  }

  for (const ir of irNodes) {
    if (ir.type !== 'goto') continue;
    const p = ir.props;
    const preferRef = trimStr(String(p.targetRef ?? p.gotoRef ?? ''));
    const legacy = trimStr(
      String(p.target != null && p.target !== '' ? p.target : p.label ?? ''),
    );
    const spec = preferRef || legacy;
    const r = resolveTargetSpec(spec);
    ir.resolvedTargetId = r.targetId;
    ir.emitTargetName = r.emit;
    ir.resolutionNotes = r.notes;
    if (r.targetId) {
      const tgt = byCompilerId.get(r.targetId);
      ir.resolvedTargetType = tgt?.type;
    }
  }

  return {
    irSchemaVersion: IR_SCHEMA_VERSION_V2,
    irBuildOptions: Object.freeze({ ...opts }),
    nodes: irNodes,
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    })),
    index: Object.freeze({
      byCompilerId,
      scenariosByName,
      stepsByName,
      blocksByName,
    }),
    buildWarnings,
    buildErrors,
  };
}

/**
 * Первый достижимый узел типа goto по рёбрам flow (BFS).
 * @param {{ nodes?: unknown[], edges?: unknown[] }} flow
 * @param {string} startFlowNodeId
 */
export function findFirstGotoFromFlowNode(flow, startFlowNodeId) {
  const edges = flow?.edges || [];
  const q = [startFlowNodeId];
  const seen = new Set();
  const rawNodes = flow?.nodes || [];
  while (q.length) {
    const cur = q.shift();
    if (seen.has(cur)) continue;
    seen.add(cur);
    const n = rawNodes.find((x) => x.id === cur);
    if (n && normalizeFlowNode(n).type === 'goto') return n;
    for (const e of edges) {
      if (e.source === cur) q.push(e.target);
    }
  }
  return null;
}

