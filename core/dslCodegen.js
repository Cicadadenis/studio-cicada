/**
 * Генерация .ccd из стеков редактора и React Flow-графа,
 * минимальный project manifest и полный cicada-project-graph document.
 */

import { FLOW_PORTS } from '../src/ccdParser.js';
import { DEFAULT_STUDIO_CAPABILITIES } from './manifests/constants.js';
import { buildMinimalProjectManifest } from './manifests/minimalManifest.js';
import {
  buildProjectGraphDocument,
  GRAPH_DOCUMENT_BLOB_KEYS,
} from './manifests/graphDocumentRefs.js';
import { graphBlobDigestKey } from './manifests/blobIntegrity.js';
import {
  enrichGraphDocumentWithBlobManifestAsync,
} from './manifests/blobManifest.js';
import { normalizeChunkDependencyGraphV0 } from './manifests/chunkDependencyGraph.js';
import { computeGraphHashes } from './manifests/hashes.js';
import { negotiateCapabilities } from './manifests/capabilities.js';
import { normalizeFlowNode } from './ir/normalizeFlowNode.js';
import { validateProjectIr, validateProjectIrStrict } from './ir/validateProjectIr.js';
import {
  assertCompilableFlow,
  IR_BUILD_COMPILE_STRICT,
  IR_BUILD_DEFAULTS,
  irBuildOptionsFromValidateMode,
} from './ir/compileGate.js';
import { irNodeDslEmitName } from './ir/buildProjectIrV2.js';

export { normalizeFlowNode };
export { validateProjectIr, validateProjectIrStrict };
export { assertCompilableFlow, IR_BUILD_COMPILE_STRICT, IR_BUILD_DEFAULTS, irBuildOptionsFromValidateMode };
export { migrateFlowToIrV2 } from './ir/migrateFlowToIrV2.js';
export { CompilationError } from './ir/CompilationError.js';
export { buildProjectIrV2, irNodeDslEmitName } from './ir/buildProjectIrV2.js';
export { validateIrV2 } from './ir/validateIrV2.js';
export { getCompilerId } from './ir/buildProjectIrV2.js';
export { IR_SCHEMA_VERSION_V1, IR_SCHEMA_VERSION_V2, IR_SCHEMA_VERSION_DEFAULT } from './ir/irSchema.js';
export { IR_NODE_REGISTRY } from './ir/nodeTypeRegistry.js';

export const SCHEMA_VERSIONS_FOR_UI = Object.freeze({
  irSchemaVersion: 2,
  astSchemaVersion: 1,
  buildGraphFormatVersion: 1,
  dslSnapshotManifestVersion: 1,
  capabilitiesManifestVersion: 1,
  projectManifestFormatVersion: 1,
});

const ARROW = '→';

const ROOT_BLOCK_TYPES = new Set([
  'version',
  'bot',
  'global',
  'commands',
  'block',
  'start',
  'command',
  'callback',
  'on_text',
  'on_photo',
  'on_voice',
  'on_document',
  'on_sticker',
  'on_location',
  'on_contact',
  'scenario',
  'middleware',
]);

const FEATURE_BY_TYPE = {
  http: 'http_client',
  poll: 'poll',
  scenario: 'scenarios',
  step: 'scenarios',
  database: 'sql',
  payment: 'payments',
  analytics: 'analytics',
  classify: 'classification',
  notify: 'telegram_notify',
  broadcast: 'telegram_broadcast',
  check_sub: 'telegram_channel_gate',
  member_role: 'telegram_admin',
  forward_msg: 'telegram_forward',
  loop: 'control_flow_loops',
  save_global: 'global_kv',
  get_user: 'cross_user_kv',
  db_delete: 'kv_delete',
  all_keys: 'kv_scan',
  call_block: 'block_call',
  random: 'random_reply',
  inline: 'inline_keyboard',
  menu: 'bot_menu',
  switch: 'switch',
};

function q(v) {
  const s = String(v ?? '');
  return `"${s
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/"/g, '\\"')}"`;
}

/** Cicada parser требует непустой RHS после «=» (regex .+). Пустой value из JSON/ИИ ломает DSL. */
function dslAssignRhs(value) {
  if (value == null || String(value).trim() === '') return '""';
  return String(value).trim();
}

function stripAt(ch) {
  return String(ch || '').trim().replace(/^@/, '');
}

function isRootBlockType(type) {
  return ROOT_BLOCK_TYPES.has(type);
}

function byPosition(a, b) {
  const dy = (a.position?.y || 0) - (b.position?.y || 0);
  if (dy !== 0) return dy;
  return (a.position?.x || 0) - (b.position?.x || 0);
}

function topoSortNodes(nodes, edges) {
  const list = nodes || [];
  const idToNode = new Map(list.map((n) => [n.id, n]));
  const adj = new Map();
  const indeg = new Map();
  for (const n of list) {
    adj.set(n.id, []);
    indeg.set(n.id, 0);
  }
  for (const e of edges || []) {
    if (!idToNode.has(e.source) || !idToNode.has(e.target)) continue;
    adj.get(e.source).push(e.target);
    indeg.set(e.target, indeg.get(e.target) + 1);
  }
  const ready = list.filter((n) => indeg.get(n.id) === 0);
  ready.sort(byPosition);
  const out = [];
  while (ready.length) {
    const cur = ready.shift();
    out.push(cur);
    const outs = adj.get(cur.id) || [];
    for (const t of outs) {
      indeg.set(t, indeg.get(t) - 1);
      if (indeg.get(t) === 0) {
        ready.push(idToNode.get(t));
        ready.sort(byPosition);
      }
    }
  }
  if (out.length < list.length) {
    const seen = new Set(out.map((x) => x.id));
    out.push(...list.filter((x) => !seen.has(x.id)).sort(byPosition));
  }
  return out;
}

function emitButtons(p) {
  const rows = String(p.rows || '').trim();
  if (!rows) return 'кнопки:';
  const lines = rows.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 1 && !rows.includes('[')) {
    const parts = lines[0].split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return `кнопки ${parts.map((x) => q(x)).join(' ')}`;
  }
  const out = ['кнопки:'];
  for (const line of lines) {
    const parts = line.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) out.push(`    [${parts.map((x) => q(x)).join(', ')}]`);
  }
  return out.join('\n');
}

function emitInline(p) {
  const raw = String(p.buttons || '').trim();
  if (!raw) return 'inline-кнопки:';
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const out = ['inline-кнопки:'];
  for (const line of lines) {
    const pairs = line.split(',').map((x) => x.trim()).filter(Boolean);
    const cells = [];
    for (const pair of pairs) {
      const [a, b] = pair.split('|').map((s) => s.trim());
      if (a && b != null) cells.push(`${q(a)} ${ARROW} ${q(b)}`);
    }
    if (cells.length) out.push(`    [${cells.join(', ')}]`);
  }
  return out.join('\n');
}

function emitRandom(p) {
  const v = String(p.variants || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!v.length) return 'рандом:';
  return ['рандом:', ...v.map((line) => `    ${q(line)}`)].join('\n');
}

function emitPoll(p) {
  const opts = String(p.options || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!opts.length) return `опрос ${q(p.question || '')}`;
  const compact = opts.length <= 8 && opts.every((o) => !/\n/.test(o));
  if (compact) return `опрос ${q(p.question || '')} ${opts.map((o) => q(o)).join(' ')}`;
  const out = [`опрос ${q(p.question || '')}`];
  for (const o of opts) out.push(`    - ${q(o)}`);
  return out.join('\n');
}

function emitHttp(p) {
  const method = String(p.method || 'GET').toUpperCase();
  const url = p.url || '';
  const vn = p.varname || 'результат';
  if (method === 'HEADERS') return `http_заголовки ${vn}`;
  if (method === 'GET') return `http_get ${q(url)} ${ARROW} ${vn}`;
  if (method === 'DELETE') return `http_delete ${q(url)} ${ARROW} ${vn}`;
  if (p.isJson === 'true' && p.jsonVar) {
    return `http_${method.toLowerCase()} ${q(url)} json ${p.jsonVar} ${ARROW} ${vn}`;
  }
  if (p.body) {
    return `http_${method.toLowerCase()} ${q(url)} с ${q(p.body)} ${ARROW} ${vn}`;
  }
  return `http_${method.toLowerCase()} ${q(url)} ${ARROW} ${vn}`;
}

function emitSwitch(p) {
  const v = String(p.varname || 'x').trim();
  const lines = String(p.cases || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const cases = lines.length ? lines : [''];
  const out = [`переключить ${v}:`];
  for (const c of cases) {
    out.push(`    ${q(c)}:`);
    out.push(`        ответ ${q('...')}`);
  }
  return out.join('\n');
}

function emitMenu(p) {
  const title = String(p.title || '').trim();
  const items = String(p.items || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!title && !items.length) return 'ответ ""';
  const out = [];
  if (title) out.push(`ответ ${q(title)}`);
  if (items.length) out.push(`кнопки ${items.map((it) => q(it)).join(' ')}`);
  return out.join('\n');
}

function quoteListLines(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => q(line))
    .join(', ');
}

function unsupportedComment(type, props) {
  return `# блок ${type}: ${JSON.stringify(props || {})}`;
}

/**
 * Текст одного блока (многострочный допускается, без внешних отступов стека).
 * @param {{ type: string, props?: object }} block
 */
export function emitBlockText(block) {
  const type = block?.type || 'message';
  const p = block?.props || {};

  switch (type) {
    case 'version':
      return `версия ${q(p.version || '1.0')}`;
    case 'bot':
      return `бот ${q(String(p.token || '').trim() || 'YOUR_BOT_TOKEN')}`;
    case 'global':
      return `глобально ${p.varname} = ${dslAssignRhs(p.value)}`;
    case 'commands': {
      const out = ['команды:'];
      const cmdText = String(p.commands || '').trim();
      if (cmdText) {
        for (const line of cmdText.split('\n')) {
          const t = line.trim();
          if (!t) continue;
          if (t.includes(' - ') && t.startsWith('"')) {
            out.push(`    ${t}`);
            continue;
          }
          const m = t.match(/^"?([^"]+)"?\s*-\s*"?([^"]*)"?$/);
          if (m) out.push(`    ${q('/' + m[1].replace(/^\//, ''))} - ${q(m[2])}`);
          else out.push(`    ${t}`);
        }
      }
      return out.join('\n');
    }
    case 'block':
      return `блок ${p.name}:`;
    case 'start':
      return 'при старте:';
    case 'command':
      return `при команде ${q('/' + String(p.cmd || '').replace(/^\//, ''))}:`;
    case 'callback':
      return `при нажатии ${q(p.label || '')}:`;
    case 'on_text':
      return 'при тексте:';
    case 'on_photo':
    case 'photo_received':
      return 'при фото:';
    case 'on_voice':
    case 'voice_received':
      return 'при голосовом:';
    case 'on_document':
    case 'document_received':
      return 'при документе:';
    case 'on_sticker':
    case 'sticker_received':
      return 'при стикере:';
    case 'on_location':
    case 'location_received':
      return 'при геолокации:';
    case 'on_contact':
    case 'contact_received':
      return 'при контакте:';
    case 'scenario':
      return `сценарий ${p.name}:`;
    case 'middleware':
      return p.type === 'after' ? 'после каждого:' : 'до каждого:';
    case 'else':
      return 'иначе:';
    case 'step':
      return `шаг ${p.name}:`;
    case 'condition': {
      const cond = String(p.cond || '').replace(/:?\s*$/, '');
      return `если ${cond}:`;
    }
    case 'message':
      return p.md ? `ответ_md ${q(p.text || '')}` : `ответ ${q(p.text || '')}`;
    case 'use':
      return `использовать ${p.blockname || ''}`;
    case 'run':
      return `запустить ${p.name || p.scenario || p.target || ''}`;
    case 'ask':
      return `спросить ${q(p.question || '')} ${ARROW} ${p.varname || 'var'}`;
    case 'remember':
      return `запомни ${p.varname} = ${dslAssignRhs(p.value)}`;
    case 'get':
      return `получить ${q(p.key || '')} ${ARROW} ${p.varname || 'var'}`;
    case 'get_user':
      return `получить от ${p.user_id} ${q(p.key || '')} ${ARROW} ${p.varname || 'var'}`;
    case 'save':
      return `сохранить ${q(p.key || '')} = ${dslAssignRhs(p.value)}`;
    case 'save_global':
      return `сохранить_глобально ${q(p.key || '')} = ${dslAssignRhs(p.value)}`;
    case 'db_delete':
      return `удалить ${q(p.key || '')}`;
    case 'all_keys':
      return `все_ключи ${ARROW} ${p.varname || 'var'}`;
    case 'call_block':
      return `вызвать ${q(p.blockname || '')} ${ARROW} ${p.varname || 'var'}`;
    case 'delay':
    case 'pause':
      return `подождать ${p.seconds || '1'}с`;
    case 'typing':
      return `печатает ${p.seconds || '1'}с`;
    case 'log':
      return `лог[${p.level || 'info'}] ${q(p.message || '')}`;
    case 'stop':
      if (p.reason === 'break') return 'прервать';
      if (p.reason === 'continue') return 'продолжить';
      if (p.reason === 'return' && p.value) return `вернуть ${p.value}`;
      if (p.reason === 'scenario') return 'завершить сценарий';
      return 'стоп';
    case 'goto': {
      const raw = p.target != null && p.target !== '' ? p.target : p.label;
      if (raw === 'повторить') return 'повторить шаг';
      const s = String(raw ?? '').trim();
      if (!s) return 'перейти "main"';
      if (/^[\w\u0400-\u04FF]+$/.test(s)) return `перейти ${s}`;
      return `перейти ${q(s)}`;
    }
    case 'photo': {
      const cap = (p.caption || '').trim();
      const u = `фото ${q(p.url || '')}`;
      if (cap) return `${u}\nответ ${q(cap)}`;
      return u;
    }
    case 'video': {
      const cap = (p.caption || '').trim();
      return cap ? `видео ${q(p.url || '')} ${q(cap)}` : `видео ${q(p.url || '')}`;
    }
    case 'audio':
      return `аудио ${q(p.url || '')}`;
    case 'document': {
      const fn = (p.filename || '').trim();
      return fn ? `документ ${q(p.url || '')} ${q(fn)}` : `документ ${q(p.url || '')}`;
    }
    case 'contact':
      return `контакт ${q(p.phone || '')} ${q(p.first_name || '')}`;
    case 'location':
      return `локация ${p.lat || 0} ${p.lon || 0}`;
    case 'poll':
      return emitPoll(p);
    case 'buttons':
      return emitButtons(p);
    case 'inline':
      return emitInline(p);
    case 'random':
      return emitRandom(p);
    case 'switch':
      return emitSwitch(p);
    case 'menu':
      return emitMenu(p);
    case 'http':
      return emitHttp(p);
    case 'loop': {
      const mode = p.mode || 'count';
      if (mode === 'while') return `пока ${p.cond || 'истина'}:`;
      if (mode === 'foreach') return `для каждого ${p.var || 'item'} в ${p.collection || 'список'}:`;
      if (mode === 'timeout') return `таймаут ${p.seconds || 5} секунд:`;
      return `повторять ${p.count || 3} раз:`;
    }
    case 'notify':
      return `уведомить ${p.target}: ${q(p.text || '')}`;
    case 'broadcast': {
      if (p.mode === 'group')
        return `рассылка группе ${p.tag || 'all'}: ${q(p.text || '')}`;
      return `рассылка всем: ${q(p.text || '')}`;
    }
    case 'check_sub':
      return `проверить подписку @${stripAt(p.channel)} ${ARROW} ${p.varname || 'var'}`;
    case 'member_role':
      return `роль @${stripAt(p.channel)} ${p.user_id} ${ARROW} ${p.varname || 'var'}`;
    case 'forward_msg':
      return `переслать сообщение ${p.target}`;
    case 'database':
      return `запрос_бд ${q(p.query || 'select 1')} ${ARROW} ${p.varname || 'rows'}`;
    case 'payment':
      return `оплата ${p.provider || 'stripe'} ${p.amount || '1'} ${p.currency || 'USD'} ${q(p.title || 'Платёж')}`;
    case 'analytics':
      return `событие ${q(p.event || 'event')}`;
    case 'classify': {
      const intents = quoteListLines(p.intents) || q('намерение');
      return `классифицировать [${intents}] ${ARROW} ${p.varname || 'намерение'}`;
    }
    case 'sticker':
      return `стикер ${q(p.file_id || '')}`;
    case 'role':
      return `получить ${q(p.key || 'role_{chat_id}')} ${ARROW} ${p.varname || 'роль'}`;
    default:
      return unsupportedComment(type, p);
  }
}

/**
 * Верхний уровень тела «шаг» в линейном списке блоков (как узлы AST в parser.py).
 */
function topLevelStatementsForStepBody(body) {
  const stmts = [];
  let i = 0;
  const afterScope = (b) => b?.props?._afterScope;

  while (i < body.length) {
    const b = body[i];
    if (b.type === 'condition') {
      const stmt = [b];
      i += 1;
      while (i < body.length && body[i].type !== 'else' && !afterScope(body[i])) {
        stmt.push(body[i]);
        i += 1;
      }
      if (i < body.length && body[i].type === 'else') {
        stmt.push(body[i]);
        i += 1;
        while (i < body.length && !afterScope(body[i])) {
          stmt.push(body[i]);
          i += 1;
        }
      }
      stmts.push(stmt);
      continue;
    }
    if (b.type === 'else') {
      const stmt = [b];
      i += 1;
      while (i < body.length && !afterScope(body[i])) {
        stmt.push(body[i]);
        i += 1;
      }
      stmts.push(stmt);
      continue;
    }
    if (b.type === 'loop') {
      const stmt = [b];
      i += 1;
      while (
        i < body.length &&
        !afterScope(body[i]) &&
        body[i].type !== 'condition' &&
        body[i].type !== 'else' &&
        body[i].type !== 'loop'
      ) {
        stmt.push(body[i]);
        i += 1;
      }
      stmts.push(stmt);
      continue;
    }
    stmts.push([b]);
    i += 1;
  }
  return stmts;
}

/**
 * Несколько «спросить» под одним «шаг» ломают FSM в исполнителе сценария
 * (после Ask вызывается _continue_scenario, а не _pending_stmts).
 * Разбиваем как normalize_program_scenario_asks в parser.py.
 */
function splitOneStepBlockForAskFsm(stepBlock, body) {
  const baseName = stepBlock.props?.name || 'шаг';
  const stmts = topLevelStatementsForStepBody(body);
  const topAskCount = stmts.filter((s) => s.length === 1 && s[0].type === 'ask').length;
  if (topAskCount <= 1) {
    return [stepBlock, ...body];
  }

  const out = [];
  let current = [];
  let counter = 1;

  const flush = () => {
    if (current.length === 0) return;
    const stepName = counter === 1 ? baseName : `${baseName}_${counter}`;
    counter += 1;
    out.push({
      ...stepBlock,
      props: { ...stepBlock.props, name: stepName },
    });
    for (const blk of current) out.push(blk);
    current = [];
  };

  for (const stmtBlocks of stmts) {
    for (const blk of stmtBlocks) current.push(blk);
    if (stmtBlocks.length === 1 && stmtBlocks[0].type === 'ask') {
      flush();
    }
  }
  if (current.length) flush();
  return out;
}

export function expandScenarioStackBlocksForAskFsm(blocks) {
  if (!blocks?.length || blocks[0]?.type !== 'scenario') return blocks;
  const out = [blocks[0]];
  let i = 1;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block.type !== 'step') {
      out.push(block);
      i += 1;
      continue;
    }
    const stepBlock = block;
    i += 1;
    const body = [];
    while (i < blocks.length && blocks[i].type !== 'step') {
      body.push(blocks[i]);
      i += 1;
    }
    out.push(...splitOneStepBlockForAskFsm(stepBlock, body));
  }
  return out;
}

/**
 * Линейные стеки с «если … иначе» — добавляем отступы тел как в parser.py.
 */
function stackToDSLStructured(blocks) {
  const out = [];
  const rootType = blocks[0]?.type || '';
  let i = 0;
  let insideScenarioStep = false;

  const baseIndentFor = (block, index) => {
    if (index === 0) return 0;
    if (rootType !== 'scenario') return 1;
    if (block?.type === 'step') return 1;
    return insideScenarioStep ? 2 : 1;
  };

  const isBoundary = (block) => {
    if (!block) return true;
    if (block.props?._afterScope) return true;
    if (block.type === 'condition' || block.type === 'else' || block.type === 'loop') return true;
    if (rootType === 'scenario' && block.type === 'step') return true;
    return false;
  };

  const pushBlock = (block, indent) => {
    for (const line of emitBlockText(block).split('\n')) {
      out.push(`${'    '.repeat(indent)}${line}`);
    }
  };

  while (i < blocks.length) {
    const block = blocks[i];
    const baseIndent = baseIndentFor(block, i);

    if (block.type === 'step') insideScenarioStep = true;

    if (block.type === 'condition') {
      pushBlock(block, baseIndent);
      i += 1;
      while (i < blocks.length && blocks[i].type !== 'else' && !isBoundary(blocks[i])) {
        pushBlock(blocks[i], baseIndent + 1);
        i += 1;
      }
      if (i < blocks.length && blocks[i].type === 'else') {
        pushBlock(blocks[i], baseIndent);
        i += 1;
        while (i < blocks.length && !isBoundary(blocks[i])) {
          pushBlock(blocks[i], baseIndent + 1);
          i += 1;
        }
      }
      continue;
    }

    if (block.type === 'else') {
      pushBlock(block, baseIndent);
      i += 1;
      while (i < blocks.length && !isBoundary(blocks[i])) {
        pushBlock(blocks[i], baseIndent + 1);
        i += 1;
      }
      continue;
    }

    if (block.type === 'loop') {
      pushBlock(block, baseIndent);
      i += 1;
      let bodyCount = 0;
      while (i < blocks.length && !isBoundary(blocks[i])) {
        pushBlock(blocks[i], baseIndent + 1);
        bodyCount += 1;
        i += 1;
      }
      if (bodyCount === 0) out.push(`${'    '.repeat(baseIndent + 1)}# тело цикла`);
      continue;
    }

    pushBlock(block, baseIndent);
    i += 1;
  }
  return out.join('\n');
}

export function stackToDSL(stack) {
  const blocks = stack?.blocks || [];
  if (!blocks.length) return '';
  const normalized = expandScenarioStackBlocksForAskFsm(blocks);
  return stackToDSLStructured(normalized);
}

export function generateDSLFromStacks(stacks) {
  return (stacks || []).map(stackToDSL).filter(Boolean).join('\n\n');
}

export const emitBlock = emitBlockText;
export const blockToDSL = emitBlockText;
export const nodeDSL = (node, token) => {
  const b = normalizeFlowNode(node);
  if (b.type === 'bot' && token) b.props = { ...b.props, token };
  return emitBlockText(b);
};

function trimStr(v) {
  return typeof v === 'string' ? v.trim() : '';
}

export function generateDSLFromFlow(flow, token) {
  const { doc, warnings: compileWarnings } = assertCompilableFlow(flow);
  void compileWarnings;
  const gotoEmitByFlowId = new Map(
    (doc.nodes || [])
      .filter((x) => x.type === 'goto' && x.emitTargetName)
      .map((x) => [x.flowNodeId, x.emitTargetName]),
  );
  const nodes = flow?.nodes || [];
  const edges = flow?.edges || [];
  const ordered = topoSortNodes(nodes, edges);
  const blocks = ordered.map((n) => {
    const b = normalizeFlowNode(n);
    let props = { ...b.props };
    if (b.type === 'goto') {
      const emit = gotoEmitByFlowId.get(n.id);
      if (emit != null && emit !== '') props = { ...props, target: emit };
    }
    if (b.type === 'use') {
      const ref = trimStr(props.blockRef ?? props.blockRefId ?? '');
      if (ref) {
        const blk = doc.nodes.find((x) => x.type === 'block' && x.id === ref);
        if (blk) props = { ...props, blockname: trimStr(props.blockname) || irNodeDslEmitName(blk) };
      }
    }
    if (b.type === 'bot' && token) props = { ...props, token };
    return { type: b.type, props };
  });
  const chunks = [];
  let i = 0;
  while (i < blocks.length) {
    const chunk = [blocks[i]];
    i += 1;
    while (i < blocks.length && !isRootBlockType(blocks[i].type)) {
      chunk.push(blocks[i]);
      i += 1;
    }
    chunks.push(chunk);
  }
  return chunks.map((c) => stackToDSL({ blocks: c })).filter(Boolean).join('\n\n');
}

function portFor(blockType, dir) {
  const cfg = FLOW_PORTS[blockType] || { input: 'flow', output: 'flow' };
  return dir === 'in' ? cfg.input : cfg.output;
}

export function validateFlow(flow) {
  const ir = validateProjectIr(flow);
  const errors = [...ir.errors];
  const warnings = [...ir.warnings];
  const nodes = flow?.nodes || [];
  const edges = flow?.edges || [];
  const idset = new Set(nodes.map((n) => n.id));

  const blockType = (n) => n?.data?.type || n?.type;
  const blockProps = (n) => n?.data?.props || n.props || {};
  const blockLabel = (n) => n?.data?.label || n?.label || blockType(n);
  const standaloneTypes = new Set(['version', 'bot', 'commands', 'global']);

  for (const e of edges) {
    if (!idset.has(e.source) || !idset.has(e.target)) {
      errors.push(`Ребро ${e.id || 'без id'}: неизвестный source/target`);
      continue;
    }
    const sn = nodes.find((n) => n.id === e.source);
    const tn = nodes.find((n) => n.id === e.target);
    const st = sn?.data?.type || sn?.type;
    const tt = tn?.data?.type || tn?.type;
    const sh = e.sourceHandle ?? 'flow';
    const th = e.targetHandle ?? 'flow';
    const so = portFor(st, 'out');
    const ti = portFor(tt, 'in');
    if (so == null && ti != null) {
      warnings.push(`${st} → ${tt}: исток без выходного flow-порта`);
    }
    if (so != null && sh !== so) {
      warnings.push(`sourceHandle «${sh}» у ${st} (канон: ${so})`);
    }
    if (ti != null && th !== ti) {
      warnings.push(`targetHandle «${th}» у ${tt} (канон: ${ti})`);
    }
    if (so == null || ti == null) {
      warnings.push(`Ребро ${e.source}→${e.target}: терминальный/несовместимый порт`);
    }
  }

  if (nodes.length === 0) {
    warnings.push('Холст пуст — добавь блоки');
    return { errors, warnings };
  }

  const startNodes = nodes.filter((n) => blockType(n) === 'start');
  if (startNodes.length === 0) warnings.push('Нет блока «Старт» — бот не знает с чего начать');
  if (startNodes.length > 1) warnings.push(`Несколько блоков «Старт» (${startNodes.length} шт.)`);

  nodes.forEach((n) => {
    const p = blockProps(n);
    const t = blockType(n);
    const outgoing = edges.filter((e) => e.source === n.id).length;

    switch (t) {
      case 'version':
        if (!p.version?.trim()) errors.push(`Блок «Версия» [${n.id}]: не указана версия`);
        break;
      case 'bot':
        if (!p.token?.trim()) warnings.push(`Блок «Бот» [${n.id}]: не указан токен`);
        break;
      case 'commands':
        if (!p.commands?.trim()) warnings.push(`Блок «Команды меню» [${n.id}]: нет команд`);
        break;
      case 'global':
        if (!p.varname?.trim()) errors.push(`Блок «Глобальная» [${n.id}]: нет имени переменной`);
        break;
      case 'middleware':
        if (!p.type?.trim() || !['before', 'after'].includes(p.type))
          errors.push(`Блок «Middleware» [${n.id}]: неверный тип (before/after)`);
        break;
      case 'message':
        if (!p.text?.trim()) errors.push(`Блок «Ответ» [${n.id}]: пустой текст`);
        break;
      case 'buttons':
        if (!p.rows?.trim()) errors.push(`Блок «Кнопки» [${n.id}]: нет кнопок`);
        break;
      case 'inline': {
        if (!p.buttons?.trim()) {
          errors.push(`Блок «Inline-кнопки» [${n.id}]: нет кнопок`);
          break;
        }
        const inlineRows = p.buttons.trim().split('\n');
        inlineRows.forEach((row, ri) => {
          row.split(',').forEach((btn, bi) => {
            const parts = btn.trim().split('|');
            if (parts.length < 2 || !parts[0].trim() || !parts[1].trim()) {
              errors.push(
                `Блок «Inline-кнопки» [${n.id}]: кнопка ${ri + 1}.${bi + 1} — неверный формат, нужно "Текст|callback"`,
              );
            }
          });
        });
        const inlineParents = edges.filter((e) => e.target === n.id).map((e) => e.source);
        if (inlineParents.length === 0) {
          warnings.push(`Блок «Inline-кнопки» [${n.id}]: не подключён к родительскому блоку`);
        } else {
          const hasSiblingMessage = inlineParents.some((parentId) =>
            edges
              .filter((e) => e.source === parentId)
              .map((e) => e.target)
              .some((sibId) => {
                const sib = nodes.find((nd) => nd.id === sibId);
                return sib && blockType(sib) === 'message';
              }),
          );
          if (!hasSiblingMessage) {
            warnings.push(
              `Блок «Inline-кнопки» [${n.id}]: нет блока «Ответ» в том же родителе — кнопки отправятся без текста`,
            );
          }
        }
        break;
      }
      case 'command':
        if (!p.cmd?.trim()) errors.push(`Блок «Команда» [${n.id}]: не указана команда`);
        if (outgoing === 0) warnings.push(`Команда /${p.cmd || '?'} не имеет дочерних блоков`);
        break;
      case 'condition':
        if (!p.cond?.trim()) errors.push(`Блок «Условие» [${n.id}]: пустое условие`);
        break;
      case 'else':
        break;
      case 'switch':
        if (!p.varname?.trim()) errors.push(`Блок «Переключатель» [${n.id}]: не указана переменная`);
        if (!p.cases?.trim()) errors.push(`Блок «Переключатель» [${n.id}]: нет вариантов`);
        break;
      case 'ask':
        if (!p.question?.trim()) errors.push(`Блок «Спросить» [${n.id}]: нет вопроса`);
        if (!p.varname?.trim()) errors.push(`Блок «Спросить» [${n.id}]: нет переменной`);
        break;
      case 'remember':
        if (!p.varname?.trim()) errors.push(`Блок «Запомнить» [${n.id}]: нет переменной`);
        break;
      case 'get':
        if (!p.key?.trim()) errors.push(`Блок «Получить» [${n.id}]: нет ключа`);
        if (!p.varname?.trim()) errors.push(`Блок «Получить» [${n.id}]: нет переменной`);
        break;
      case 'save':
        if (!p.key?.trim()) errors.push(`Блок «Сохранить» [${n.id}]: нет ключа`);
        break;
      case 'http':
        if (!p.url?.trim()) errors.push(`Блок «HTTP» [${n.id}]: не указан URL`);
        if (!p.varname?.trim()) warnings.push(`Блок «HTTP» [${n.id}]: не указана переменная для ответа`);
        break;
      case 'random':
        if (!p.variants?.trim()) errors.push(`Блок «Рандом» [${n.id}]: нет вариантов`);
        break;
      case 'photo':
      case 'video':
      case 'audio':
      case 'document':
        if (!p.url?.trim()) warnings.push(`Блок «${t}» [${n.id}]: не указан URL`);
        break;
      case 'delay':
      case 'typing':
        if (!p.seconds || isNaN(Number(p.seconds)))
          errors.push(`Блок «${t}» [${n.id}]: некорректное число секунд`);
        break;
      case 'loop':
        if (p.mode === 'while' && !p.cond?.trim())
          errors.push(`Блок «Цикл» [${n.id}]: не указано условие`);
        if (p.mode !== 'while' && (!p.count || isNaN(Number(p.count))))
          errors.push(`Блок «Цикл» [${n.id}]: некорректное число повторений`);
        break;
      case 'database':
        if (!p.query?.trim()) errors.push(`Блок «БД» [${n.id}]: не указан SQL-запрос`);
        if (!p.varname?.trim()) warnings.push(`Блок «БД» [${n.id}]: не указана переменная для результата`);
        break;
      case 'classify':
        if (!p.intents?.trim()) errors.push(`Блок «Классификация» [${n.id}]: не указаны намерения`);
        if (!p.varname?.trim()) errors.push(`Блок «Классификация» [${n.id}]: не указана переменная`);
        break;
      case 'log':
        if (!p.message?.trim()) warnings.push(`Блок «Лог» [${n.id}]: пустое сообщение`);
        break;
      case 'role':
        if (!p.roles?.trim()) errors.push(`Блок «Роль» [${n.id}]: не указаны роли`);
        break;
      case 'payment':
        if (!p.amount?.trim() || isNaN(Number(p.amount)))
          errors.push(`Блок «Оплата» [${n.id}]: некорректная сумма`);
        if (!p.provider?.trim()) errors.push(`Блок «Оплата» [${n.id}]: не указан провайдер`);
        break;
      case 'notify':
        if (!p.text?.trim()) errors.push(`Блок «Уведомление» [${n.id}]: пустой текст`);
        break;
      default:
        break;
    }
  });

  const rootTypes = [
    'start',
    'command',
    'scenario',
    'callback',
    'on_text',
    'on_photo',
    'on_voice',
    'on_document',
    'on_sticker',
    'on_location',
    'on_contact',
  ];
  nodes.forEach((n) => {
    const t = blockType(n);
    if (!rootTypes.includes(t) && !standaloneTypes.has(t)) {
      const hasParent = edges.some((e) => e.target === n.id);
      if (!hasParent) warnings.push(`«${blockLabel(n)}» [${n.id}] не подключён ни к одному блоку`);
    }
  });

  return { errors, warnings };
}

function indentDsl(text, level = 0) {
  const prefix = '    '.repeat(Math.max(0, Number(level) || 0));
  return String(text || '')
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function renderIrBlock(entry) {
  const block = entry?.block || entry;
  const indent = entry?.indent ?? 0;
  return indentDsl(emitBlockText(block), indent);
}

function renderWrappedIr(body, wrap = {}) {
  const version = wrap.version ?? '1.0';
  const bot = wrap.bot ?? '';
  const command = wrap.command ?? '/t';
  const head = [
    `версия ${q(version)}`,
    `бот ${q(bot)}`,
    '',
    `при команде ${q(command)}:`,
  ];
  const bodyText = String(body || '')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => `    ${line}`)
    .join('\n');
  return `${head.join('\n')}\n${bodyText}`;
}

export function renderIr(ir) {
  if (ir?.kind === 'emitBlock') {
    const body = renderIrBlock({ block: ir.block, indent: ir.indent ?? 0 });
    return ir.wrap ? renderWrappedIr(body, ir.wrap) : body;
  }

  if (ir?.kind === 'wrappedChain') {
    const body = (ir.blocks || []).map(renderIrBlock).filter(Boolean).join('\n');
    return renderWrappedIr(body, ir.wrap);
  }

  if (Array.isArray(ir?.blocks)) {
    return ir.blocks.map(renderIrBlock).filter(Boolean).join('\n');
  }

  return generateDSLFromFlow(ir);
}

function inferFeaturesFromTypes(types) {
  const set = new Set();
  for (const t of types) {
    const f = FEATURE_BY_TYPE[t];
    if (f) set.add(f);
  }
  return [...set].sort();
}

export function inferRequiredFeaturesFromFlow(flow) {
  const types = (flow?.nodes || []).map((n) => n.data?.type || n.type).filter(Boolean);
  return inferFeaturesFromTypes(types);
}

export function inferRequiredFeaturesFromStacks(stacks) {
  const types = [];
  for (const s of stacks || []) {
    for (const b of s.blocks || []) types.push(b.type);
  }
  return inferFeaturesFromTypes(types);
}

/** Минимальный manifest: только projectFormatVersion + requiredFeatures (+ опционально dialect). */
export function buildProjectManifestDraft(flow, _schemaVersions) {
  const requiredFeatures = inferRequiredFeaturesFromFlow(flow);
  return buildMinimalProjectManifest({
    requiredFeatures,
    dialect: 'cicada-dsl-ru',
  });
}

export function buildProjectManifestDraftFromStacks(stacks, _schemaVersions) {
  const requiredFeatures = inferRequiredFeaturesFromStacks(stacks);
  return buildMinimalProjectManifest({
    requiredFeatures,
    dialect: 'cicada-dsl-ru',
  });
}

/**
 * Полный graph document: manifest + ir + ast + buildGraph + ui (плейсхолдеры там, где слоя ещё нет).
 * @param {{ nodes: unknown[], edges: unknown[] }} flow
 * @param {object} [options]
 * @param {typeof SCHEMA_VERSIONS_FOR_UI} [options.schemaVersions]
 * @param {Record<string, unknown> | null} [options.ui]
 * @param {Record<string, unknown> | null} [options.ast]
 * @param {Record<string, unknown> | null} [options.debug]
 * @param {Record<string, unknown> | null} [options.cache]
 * @param {Record<string, string>} [options.sectionRefs] URI по секциям: ast, buildGraph, ir, ui, debug, cache
 * @param {Record<string, string>} [options.sectionDigests] ожидаемые sha256 для секций (после canonical JSON), например { ast: 'sha256:…' }
 * @param {unknown} [options.dependencyGraph] опциональный протокольный граф (нормализуется отдельно от buildGraph)
 */
export function buildProjectGraphDocumentFromFlow(flow, options = {}) {
  const sv = options.schemaVersions || SCHEMA_VERSIONS_FOR_UI;
  const nodesRaw = flow?.nodes || [];
  const edges = flow?.edges || [];
  const norm = nodesRaw.map(normalizeFlowNode);
  const { contentHash, rollupHash, subtreeByNode } = computeGraphHashes(norm, edges);
  const requiredFeatures = inferRequiredFeaturesFromFlow(flow);
  const caps = negotiateCapabilities(DEFAULT_STUDIO_CAPABILITIES, {
    requiredFeatures,
    dialect: 'cicada-dsl-ru',
  });

  const manifest = buildMinimalProjectManifest({
    requiredFeatures,
    dialect: 'cicada-dsl-ru',
  });

  const ir = {
    schemaVersion: sv.irSchemaVersion,
    nodes: norm,
    edges: (edges || []).map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    })),
  };

  const buildGraph = {
    schemaVersion: sv.buildGraphFormatVersion,
    contentHash,
    rollupHash,
    subtreeHashSample: norm.length ? subtreeByNode[norm[0].id] : null,
    stats: {
      nodeCount: norm.length,
      edgeCount: edges.length,
    },
    semanticIds: norm.map((n) => n.semanticId || n.id),
    edges: (edges || []).map((e) => ({
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    })),
    capabilitiesNegotiation: caps,
  };

  const astDefault =
    options.ast !== undefined
      ? options.ast
      : { schemaVersion: sv.astSchemaVersion, _stub: true };

  const r = options.sectionRefs || {};
  /** @type {Record<string, unknown>} */
  const parts = { manifest };

  if (typeof r.ir === 'string' && r.ir) parts.irRef = r.ir;
  else parts.ir = ir;

  if (typeof r.ast === 'string' && r.ast) parts.astRef = r.ast;
  else parts.ast = astDefault;

  if (typeof r.buildGraph === 'string' && r.buildGraph) parts.buildGraphRef = r.buildGraph;
  else parts.buildGraph = buildGraph;

  if (typeof r.ui === 'string' && r.ui) parts.uiRef = r.ui;
  else parts.ui = options.ui ?? null;

  if (typeof r.debug === 'string' && r.debug) parts.debugRef = r.debug;
  else if (options.debug !== undefined) parts.debug = options.debug;
  else parts.debug = null;

  if (typeof r.cache === 'string' && r.cache) parts.cacheRef = r.cache;
  else if (options.cache !== undefined) parts.cache = options.cache;
  else parts.cache = null;

  const dig = options.sectionDigests || {};
  for (const k of GRAPH_DOCUMENT_BLOB_KEYS) {
    const v = dig[k];
    if (typeof v === 'string' && v.trim()) {
      parts[graphBlobDigestKey(k)] = v.trim();
    }
  }

  if (options.dependencyGraph != null) {
    parts.dependencyGraph = normalizeChunkDependencyGraphV0(options.dependencyGraph);
  }

  return buildProjectGraphDocument(parts);
}

/**
 * Как buildProjectGraphDocumentFromFlow, но при options.autoBlobManifest заполняет blobs / blobsVersion (digest+size по секциям).
 *
 * @param {object} flow
 * @param {object} [options]
 * @param {boolean} [options.autoBlobManifest]
 */
export async function buildProjectGraphDocumentFromFlowAsync(flow, options = {}) {
  const doc = buildProjectGraphDocumentFromFlow(flow, options);
  if (!options.autoBlobManifest) return doc;
  return enrichGraphDocumentWithBlobManifestAsync(doc, options.blobManifestOptions);
}

/**
 * @param {unknown[]} stacks
 * @param {object} [options]
 */
export async function buildProjectGraphDocumentFromStacksAsync(stacks, options = {}) {
  const doc = buildProjectGraphDocumentFromStacks(stacks, options);
  if (!options.autoBlobManifest) return doc;
  return enrichGraphDocumentWithBlobManifestAsync(doc, options.blobManifestOptions);
}

export function buildProjectGraphDocumentFromStacks(stacks, options = {}) {
  const nodes = [];
  const edges = [];
  for (const stack of stacks || []) {
    let prev = null;
    for (const b of stack.blocks || []) {
      const id = `n_${stack.id}_${b.id}`;
      nodes.push({
        id,
        type: 'cicada',
        position: { x: stack.x || 0, y: stack.y || 0 },
        data: { type: b.type, props: { ...(b.props || {}) }, semanticId: b.id },
      });
      if (prev) {
        edges.push({
          id: `e_${prev}_${id}`,
          source: prev,
          target: id,
          sourceHandle: 'flow',
          targetHandle: 'flow',
        });
      }
      prev = id;
    }
  }
  const ui = options.ui ?? {
    stacks: (stacks || []).map((s) => ({
      id: s.id,
      x: s.x,
      y: s.y,
      blockIds: (s.blocks || []).map((b) => b.id),
    })),
  };
  return buildProjectGraphDocumentFromFlow({ nodes, edges }, { ...options, ui });
}

export const generateDSL = generateDSLFromStacks;
