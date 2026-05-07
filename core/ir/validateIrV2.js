import { IR_NODE_REGISTRY, IR_STRICT_NODE_TYPES } from './nodeTypeRegistry.js';
import { IR_SCHEMA_VERSION_V2 } from './irSchema.js';
import { normalizeFlowNode } from './normalizeFlowNode.js';
import { findFirstGotoFromFlowNode } from './buildProjectIrV2.js';

function trimStr(v) {
  return typeof v === 'string' ? v.trim() : '';
}

const ALLOWED_GOTO_TARGET_TYPES = new Set(['scenario', 'step', 'block']);
const BUILTIN_GOTO = new Set(['main', 'повторить']);

/**
 * Единое ядро проверки IR v2. Режим задаёт политику ошибок (strict — как компилятор).
 *
 * @param {object} doc — результат buildProjectIrV2
 * @param {{ mode?: 'soft' | 'strict', flow?: { nodes?: unknown[], edges?: unknown[] } } | { nodes?: unknown[], edges?: unknown[] }} [flowOrOptions]
 *   Второй аргумент: либо options ({ mode, flow }), либо legacy — сам flow (тогда mode выводится из doc).
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateIrV2(doc, flowOrOptions) {
  /** @type {{ mode?: 'soft' | 'strict', flow?: { nodes?: unknown[], edges?: unknown[] } }} */
  let options = {};
  if (flowOrOptions != null && typeof flowOrOptions === 'object') {
    if ('mode' in flowOrOptions || 'flow' in flowOrOptions) {
      options = flowOrOptions;
    } else {
      options = { flow: flowOrOptions };
    }
  }

  const flow = options.flow;
  let mode = options.mode;
  if (mode !== 'strict' && mode !== 'soft') {
    mode = doc?.irBuildOptions?.strictCompilerIdentity ? 'strict' : 'soft';
  }

  const errors = [];
  const warnings = [...(doc?.buildWarnings || [])];

  if (!doc || doc.irSchemaVersion !== IR_SCHEMA_VERSION_V2) {
    errors.push(`IR: ожидался irSchemaVersion = ${IR_SCHEMA_VERSION_V2}`);
    return { errors, warnings };
  }

  if (doc.buildErrors?.length) errors.push(...doc.buildErrors);

  const irNodes = doc.nodes || [];
  const ids = new Set(irNodes.map((x) => x.id));
  for (const n of irNodes) {
    if (!n.id) errors.push(`IR v2: узел без compiler id (type=${n.type})`);
  }
  if (ids.size !== irNodes.length) errors.push('IR v2: дублируются compiler id в документе');

  for (const ir of irNodes) {
    if (!IR_STRICT_NODE_TYPES.has(ir.type)) continue;
    if (ir.type === 'use') continue;
    const reg = IR_NODE_REGISTRY[ir.type];
    if (!reg) continue;
    for (const key of reg.requiredProps) {
      const v = ir.props[key] ?? (key === 'label' ? ir.label : undefined);
      if (v == null || (typeof v === 'string' && !v.trim())) {
        errors.push(`IR v2 [${ir.id}] (${ir.type}): обязательное поле «${key}»`);
      }
    }
  }

  for (const ir of irNodes) {
    if (ir.type !== 'use') continue;
    const blockRef = trimStr(ir.props.blockRef ?? ir.props.blockRefId ?? '');
    const bn = trimStr(ir.props.blockname);

    if (mode === 'strict') {
      if (!blockRef) {
        errors.push(`IR v2 [${ir.id}] (use): strict — задайте props.blockRef (compiler id блока)`);
        continue;
      }
      const blk = irNodes.find((x) => x.type === 'block' && x.id === blockRef);
      if (!blk) {
        errors.push(`IR v2 [${ir.id}] (use): нет блока с compiler id «${blockRef}»`);
        continue;
      }
      if (bn && trimStr(blk.props.name) !== bn) {
        warnings.push(
          `IR v2 [${ir.id}] (use): blockname «${bn}» не совпадает с именем блока «${blk.props.name}» — в DSL пойдёт каноническое имя блока`,
        );
      }
      continue;
    }

    if (!bn) {
      errors.push(`IR v2 [${ir.id}] (use): пустой blockname`);
      continue;
    }
    const blockIr = irNodes.find((x) => x.type === 'block' && trimStr(x.props.name) === bn);
    if (!blockIr) {
      errors.push(`IR v2 [${ir.id}] (use): нет блока с name «${bn}»`);
    }
  }

  for (const ir of irNodes) {
    if (ir.type !== 'goto') continue;
    const spec = trimStr(
      String(ir.props.targetRef ?? ir.props.gotoRef ?? ir.props.target ?? ir.props.label ?? ''),
    );
    if (!spec) {
      errors.push(`IR v2 [${ir.id}] (goto): нет цели (targetRef | target | label)`);
      continue;
    }
    if (BUILTIN_GOTO.has(spec)) continue;

    const emit = ir.emitTargetName;
    const tid = ir.resolvedTargetId;
    if (!emit) {
      errors.push(`IR v2 [${ir.id}] (goto): не разрешена цель «${spec}»`);
      continue;
    }
    if (tid && ir.resolvedTargetType && !ALLOWED_GOTO_TARGET_TYPES.has(ir.resolvedTargetType)) {
      errors.push(
        `IR v2 [${ir.id}] (goto): цель «${tid}» имеет тип «${ir.resolvedTargetType}» (ожидался scenario | step | block)`,
      );
    }
    const note0 = String(ir.resolutionNotes?.[0] || '');
    if (note0.includes('legacy:')) {
      if (mode === 'strict') {
        errors.push(
          `IR v2 [${ir.id}] (goto): strict — резолв по display name запрещён (migrateFlowToIrV2 / targetRef)`,
        );
      } else {
        warnings.push(
          `IR v2 [${ir.id}] (goto): legacy-разрешение по имени — задайте targetRef (compiler id цели)`,
        );
      }
    }
  }

  if (flow?.nodes && flow?.edges) {
    for (const raw of flow.nodes) {
      const norm = normalizeFlowNode(raw);
      if (norm.type !== 'callback') continue;
      const meta = irNodes.find((x) => x.flowNodeId === raw.id);
      if (mode === 'strict' && !meta) {
        errors.push(
          `IR v2 [flow ${raw.id}] (callback): узел не в IR при strict compiler id — задайте data.irId`,
        );
        continue;
      }
      const cid = meta?.id ?? raw.id;
      const gotoRef = trimStr(norm.props.gotoRef);
      if (gotoRef) {
        if (!ids.has(gotoRef)) {
          errors.push(`IR v2 [${cid}] (callback): gotoRef «${gotoRef}» — нет такого compiler id`);
        }
        continue;
      }
      const gNode = findFirstGotoFromFlowNode(flow, raw.id);
      if (!gNode) {
        errors.push(
          `IR v2 [${cid}] (callback): нет достижимого «Переход» — задайте data.props.gotoRef или соедините с goto`,
        );
      }
    }
  }

  return { errors, warnings };
}
