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

export const SCHEMA_VERSIONS_FOR_UI = Object.freeze({
  irSchemaVersion: 1,
  astSchemaVersion: 1,
  buildGraphFormatVersion: 1,
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
  'else',
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
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
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

/** Нормализует узел React Flow к { id, type, props [, semanticId] }. */
export function normalizeFlowNode(node) {
  if (!node) return { id: 'unknown', type: 'message', props: {} };
  const id = node.id || 'n';
  const data = node.data || {};
  if (data.type) {
    return {
      id,
      type: data.type,
      props: { ...(data.props || {}) },
      semanticId: data.semanticId || data.id || id,
    };
  }
  return {
    id,
    type: typeof node.type === 'string' && node.type !== 'cicada' ? node.type : 'message',
    props: {},
    semanticId: id,
  };
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
    out.push(`        стоп`);
  }
  return out.join('\n');
}

function emitMenu(p) {
  const title = String(p.title || '').trim();
  const items = String(p.items || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!title && !items.length) return '# меню: (пустой блок)';
  const head = title ? `меню ${q(title)}:` : 'меню "":';
  if (!items.length) return head;
  // В parser.py тело «меню» не разбирается — пункты сохраняем в комментариях.
  return [head, ...items.map((it) => `# меню пункт: ${q(it)}`)].join('\n');
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
      return `бот ${q(p.token || '')}`;
    case 'global':
      return `глобально ${p.varname} = ${p.value}`;
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
      return 'при фото:';
    case 'on_voice':
      return 'при голосовом:';
    case 'on_document':
      return 'при документе:';
    case 'on_sticker':
      return 'при стикере:';
    case 'on_location':
      return 'при геолокации:';
    case 'on_contact':
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
    case 'ask':
      return `спросить ${q(p.question || '')} ${ARROW} ${p.varname || 'var'}`;
    case 'remember':
      return `запомни ${p.varname} = ${p.value}`;
    case 'get':
      return `получить ${q(p.key || '')} ${ARROW} ${p.varname || 'var'}`;
    case 'get_user':
      return `получить от ${p.user_id} ${q(p.key || '')} ${ARROW} ${p.varname || 'var'}`;
    case 'save':
      return `сохранить ${q(p.key || '')} = ${p.value}`;
    case 'save_global':
      return `сохранить_глобально ${q(p.key || '')} = ${p.value}`;
    case 'db_delete':
      return `удалить ${q(p.key || '')}`;
    case 'all_keys':
      return `все_ключи ${ARROW} ${p.varname || 'var'}`;
    case 'call_block':
      return `вызвать ${q(p.blockname || '')} ${ARROW} ${p.varname || 'var'}`;
    case 'delay':
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
      if (mode === 'while') return `пока ${p.cond}:`;
      if (mode === 'foreach') return `для каждого ${p.var} в ${p.collection}:`;
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
    case 'role':
      return unsupportedComment(type, p);
    case 'payment':
    case 'analytics':
    case 'classify':
    case 'database':
    case 'sticker':
      return unsupportedComment(type, p);
    default:
      return unsupportedComment(type, p);
  }
}

/**
 * Линейные стеки с «если … иначе» — добавляем отступы тел как в parser.py.
 */
function stackToDSLWithBranches(blocks) {
  const out = [];
  let i = 0;
  let isFirst = true;
  const n = blocks.length;

  while (i < n) {
    const b = blocks[i];
    if (b.type === 'condition') {
      const linePrefix = isFirst ? '' : '    ';
      for (const line of emitBlockText(b).split('\n')) {
        out.push(linePrefix + line);
      }
      i += 1;
      const inner = linePrefix + '    ';
      while (i < n && blocks[i].type !== 'else') {
        for (const line of emitBlockText(blocks[i]).split('\n')) {
          out.push(inner + line);
        }
        i += 1;
      }
      if (i < n && blocks[i].type === 'else') {
        for (const line of emitBlockText(blocks[i]).split('\n')) {
          out.push(linePrefix + line);
        }
        i += 1;
        while (i < n && blocks[i].type !== 'condition') {
          for (const line of emitBlockText(blocks[i]).split('\n')) {
            out.push(inner + line);
          }
          i += 1;
        }
      }
      isFirst = false;
      continue;
    }

    const indent = isFirst ? '' : '    ';
    for (const line of emitBlockText(b).split('\n')) {
      out.push(indent + line);
    }
    isFirst = false;
    i += 1;
  }
  return out.join('\n');
}

export function stackToDSL(stack) {
  const blocks = stack?.blocks || [];
  if (!blocks.length) return '';
  if (blocks.some((b) => b.type === 'condition')) {
    return stackToDSLWithBranches(blocks);
  }
  const out = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const indent = i === 0 ? '' : '    ';
    const text = emitBlockText(blocks[i]);
    for (const line of text.split('\n')) {
      out.push(indent + line);
    }
  }
  return out.join('\n');
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

export function generateDSLFromFlow(flow, token) {
  const nodes = flow?.nodes || [];
  const edges = flow?.edges || [];
  const ordered = topoSortNodes(nodes, edges);
  const blocks = ordered.map((n) => {
    const b = normalizeFlowNode(n);
    if (b.type === 'bot' && token) return { type: b.type, props: { ...b.props, token } };
    return { type: b.type, props: b.props };
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
  const errors = [];
  const warnings = [];
  const nodes = flow?.nodes || [];
  const edges = flow?.edges || [];
  const idset = new Set(nodes.map((n) => n.id));

  const dupCheck = new Set();
  for (const n of nodes) {
    if (dupCheck.has(n.id)) errors.push(`Дублируется id узла ${n.id}`);
    dupCheck.add(n.id);
  }

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

  return { errors, warnings };
}

export function renderIr(flow) {
  const nodes = (flow?.nodes || []).map(normalizeFlowNode);
  const edges = flow?.edges || [];
  return JSON.stringify({ nodes, edges }, null, 2);
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
