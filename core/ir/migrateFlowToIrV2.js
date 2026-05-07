import { buildProjectIrV2 } from './buildProjectIrV2.js';
import { IR_BUILD_DEFAULTS } from './irBuildOptions.js';

function trimStr(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function randomIrId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ir_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

/**
 * Приводит React Flow-граф к контракту strict IR v2: стабильные data.irId, targetRef у goto, blockRef у use.
 * Вызывать до компиляции DSL для legacy-проектов; не мутирует исходный flow (возвращает копию).
 *
 * @param {{ nodes?: unknown[], edges?: unknown[] }} flow
 * @returns {{ flow: { nodes: unknown[], edges: unknown[] }, notes: string[] }}
 */
export function migrateFlowToIrV2(flow) {
  const notes = [];
  const edges = Array.isArray(flow?.edges) ? [...flow.edges] : [];
  const nodes = (flow?.nodes || []).map((n) => ({
    ...n,
    data: {
      ...(n?.data || {}),
      props: { ...(n?.data?.props || {}) },
    },
  }));

  for (const n of nodes) {
    let irId = trimStr(n.data.irId) || trimStr(n.data.compilerId);
    if (!irId) {
      irId = trimStr(n.id) || randomIrId();
      notes.push(`назначен data.irId для узла canvas «${n.id}»`);
    }
    n.data.irId = irId;
  }

  const softDoc = buildProjectIrV2({ nodes, edges }, IR_BUILD_DEFAULTS);
  const byFlow = new Map(softDoc.nodes.map((x) => [x.flowNodeId, x]));

  for (const n of nodes) {
    const ir = byFlow.get(n.id);
    if (!ir) continue;

    if (ir.type === 'goto' && ir.resolvedTargetId) {
      const prev = trimStr(n.data.props.targetRef);
      if (prev !== ir.resolvedTargetId) {
        n.data.props.targetRef = ir.resolvedTargetId;
        notes.push(`goto «${ir.id}»: записан props.targetRef`);
      }
    }

    if (ir.type === 'use') {
      const bn = trimStr(ir.props.blockname);
      const blockIr = softDoc.nodes.find((x) => x.type === 'block' && trimStr(x.props.name) === bn);
      if (blockIr) {
        const prev = trimStr(n.data.props.blockRef ?? n.data.props.blockRefId);
        if (prev !== blockIr.id) {
          n.data.props.blockRef = blockIr.id;
          notes.push(`use «${ir.id}»: записан props.blockRef → «${blockIr.id}»`);
        }
      } else if (bn) {
        notes.push(`use «${ir.id}»: блок с name «${bn}» не найден — задайте blockRef вручную`);
      }
    }
  }

  return { flow: { nodes, edges }, notes };
}
