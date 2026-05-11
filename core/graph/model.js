import { getBlockDefaultProps, getBlockDefinition } from '../blockRegistry.js';
import { validateBlockAttachments } from '../capabilityEngine.js';

export const PROJECT_GRAPH_STATE_SCHEMA_VERSION = 1;

function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function normalizeViewport(viewport) {
  return {
    x: Number.isFinite(Number(viewport?.x)) ? Number(viewport.x) : 0,
    y: Number.isFinite(Number(viewport?.y)) ? Number(viewport.y) : 0,
    zoom: Number.isFinite(Number(viewport?.zoom ?? viewport?.scale)) ? Number(viewport.zoom ?? viewport.scale) : 1,
  };
}

function normalizeUi(ui) {
  return {
    selection: Array.isArray(ui?.selection) ? ui.selection.map(String) : [],
    collapsed: Array.isArray(ui?.collapsed) ? ui.collapsed.map(String) : [],
  };
}

export function normalizeGraphNode(node) {
  const definition = getBlockDefinition(node?.type);
  if (!definition) return null;
  const normalized = validateBlockAttachments({
    id: node.id || uid('node'),
    type: definition.type,
    props: { ...getBlockDefaultProps(definition.type), ...(node.props || {}) },
    position: {
      x: Number.isFinite(Number(node.position?.x)) ? Number(node.position.x) : 260,
      y: Number.isFinite(Number(node.position?.y)) ? Number(node.position.y) : 160,
    },
    uiAttachments: node.uiAttachments,
  });
  return { ...normalized, category: definition.category };
}

export function normalizeGraphEdge(edge) {
  const source = edge?.source ?? edge?.from;
  const target = edge?.target ?? edge?.to;
  if (!source || !target) return null;
  return {
    id: edge.id || uid('edge'),
    source: String(source),
    target: String(target),
    sourcePort: edge.sourcePort || edge.sourceHandle || 'flow',
    targetPort: edge.targetPort || edge.targetHandle || 'flow',
    label: edge.label || '',
    condition: edge.condition || '',
  };
}

export function createProjectGraphState(seed = {}) {
  const nodes = {};
  const edges = {};
  for (const rawNode of asArray(seed.nodes)) {
    const node = normalizeGraphNode(rawNode);
    if (node) nodes[node.id] = node;
  }
  for (const rawEdge of asArray(seed.edges)) {
    const edge = normalizeGraphEdge(rawEdge);
    if (edge && nodes[edge.source] && nodes[edge.target]) edges[edge.id] = edge;
  }
  return {
    schemaVersion: PROJECT_GRAPH_STATE_SCHEMA_VERSION,
    nodes,
    edges,
    viewport: normalizeViewport(seed.viewport),
    ui: normalizeUi(seed.ui),
  };
}

export function isProjectGraphState(value) {
  return Boolean(value && Number(value.schemaVersion) >= 1 && value.nodes && value.edges && !Array.isArray(value.nodes) && !Array.isArray(value.edges));
}

export function projectGraphFromLegacyStacks(stacks = [], options = {}) {
  const nodes = {};
  const edges = {};
  for (const stack of stacks || []) {
    let previousId = null;
    (stack.blocks || []).forEach((block, index) => {
      const node = normalizeGraphNode({
        ...block,
        position: { x: stack.x ?? 120, y: (stack.y ?? 120) + index * 112 },
      });
      if (!node) return;
      nodes[node.id] = node;
      if (previousId) {
        const edge = normalizeGraphEdge({ id: `edge_${previousId}_${node.id}`, source: previousId, target: node.id });
        if (edge) edges[edge.id] = edge;
      }
      previousId = node.id;
    });
  }
  return createProjectGraphState({ nodes, edges, viewport: options.viewport || options.previous?.viewport, ui: options.ui || options.previous?.ui });
}

export function projectGraphToLegacyStacks(projectGraph = createProjectGraphState()) {
  const graph = createProjectGraphState(projectGraph);
  const nodes = Object.values(graph.nodes);
  const edges = Object.values(graph.edges);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Set(edges.map((edge) => edge.target));
  const visited = new Set();
  const outgoing = new Map();
  for (const edge of edges) {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    outgoing.get(edge.source).push(edge);
  }
  const starts = nodes.filter((node) => !incoming.has(node.id)).sort((a, b) => (a.position?.y || 0) - (b.position?.y || 0));
  const stacks = [];
  const pushChain = (start) => {
    const blocks = [];
    let current = start;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      blocks.push({ id: current.id, type: current.type, props: current.props || {}, uiAttachments: current.uiAttachments });
      const next = (outgoing.get(current.id) || []).find((edge) => !visited.has(edge.target));
      current = next ? byId.get(next.target) : null;
    }
    if (blocks.length) stacks.push({ id: `stack_${start.id}`, x: start.position?.x || 120, y: start.position?.y || 120, blocks });
  };
  starts.forEach(pushChain);
  nodes.filter((node) => !visited.has(node.id)).forEach(pushChain);
  return stacks;
}

export function projectGraphToFlow(projectGraph = createProjectGraphState()) {
  const graph = createProjectGraphState(projectGraph);
  return {
    nodes: Object.values(graph.nodes).map((node) => ({
      id: node.id,
      type: 'cicada',
      position: node.position || { x: 0, y: 0 },
      data: {
        type: node.type,
        props: { ...(node.props || {}) },
        uiAttachments: node.uiAttachments || undefined,
        irId: node.id,
        compilerId: node.id,
        semanticId: node.id,
      },
    })),
    edges: Object.values(graph.edges).map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourcePort || 'flow',
      targetHandle: edge.targetPort || 'flow',
      label: edge.label || '',
      condition: edge.condition || '',
    })),
  };
}
import {
  getBlockDefaultProps,
  getBlockDefinition,
} from '../blockRegistry.js';
import { validateBlockAttachments } from '../capabilityEngine.js';

export const PROJECT_GRAPH_STATE_SCHEMA_VERSION = 1;

function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
}

function asRecord(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return {};
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function normalizeViewport(viewport) {
  const x = Number(viewport?.x);
  const y = Number(viewport?.y);
  const zoom = Number(viewport?.zoom ?? viewport?.scale);
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1,
  };
}

function normalizeUi(ui) {
  return {
    selection: Array.isArray(ui?.selection) ? ui.selection.map(String) : [],
    collapsed: Array.isArray(ui?.collapsed) ? ui.collapsed.map(String) : [],
  };
}

export function normalizeGraphNode(node) {
  const definition = getBlockDefinition(node?.type);
  if (!definition) return null;
  const normalized = validateBlockAttachments({
    id: node.id || uid('node'),
    type: definition.type,
    props: { ...getBlockDefaultProps(definition.type), ...(node.props || {}) },
    position: {
      x: Number.isFinite(Number(node.position?.x)) ? Number(node.position.x) : 260,
      y: Number.isFinite(Number(node.position?.y)) ? Number(node.position.y) : 160,
    },
    uiAttachments: node.uiAttachments,
  });
  return {
    ...normalized,
    category: definition.category,
  };
}

export function normalizeGraphEdge(edge) {
  const source = edge?.source ?? edge?.from;
  const target = edge?.target ?? edge?.to;
  if (!source || !target) return null;
  return {
    id: edge.id || uid('edge'),
    source: String(source),
    target: String(target),
    sourcePort: edge.sourcePort || edge.sourceHandle || 'flow',
    targetPort: edge.targetPort || edge.targetHandle || 'flow',
    label: edge.label || '',
    condition: edge.condition || '',
  };
}

export function createProjectGraphState(seed = {}) {
  const nodes = {};
  const edges = {};

  for (const rawNode of asArray(seed.nodes)) {
    const node = normalizeGraphNode(rawNode);
    if (node) nodes[node.id] = node;
  }

  for (const rawEdge of asArray(seed.edges)) {
    const edge = normalizeGraphEdge(rawEdge);
    if (edge && nodes[edge.source] && nodes[edge.target]) {
      edges[edge.id] = edge;
    }
  }

  return {
    schemaVersion: PROJECT_GRAPH_STATE_SCHEMA_VERSION,
    nodes,
    edges,
    viewport: normalizeViewport(seed.viewport),
    ui: normalizeUi(seed.ui),
  };
}

export function isProjectGraphState(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    Number(value.schemaVersion) >= 1 &&
    value.nodes &&
    typeof value.nodes === 'object' &&
    !Array.isArray(value.nodes) &&
    value.edges &&
    typeof value.edges === 'object' &&
    !Array.isArray(value.edges)
  );
}

export function projectGraphToEngineGraph(projectGraph = createProjectGraphState()) {
  const graph = createProjectGraphState(projectGraph);
  return {
    nodes: Object.values(graph.nodes),
    edges: Object.values(graph.edges).map((edge) => ({
      id: edge.id,
      from: edge.source,
      to: edge.target,
      sourcePort: edge.sourcePort,
      targetPort: edge.targetPort,
      label: edge.label || '',
      condition: edge.condition || '',
    })),
  };
}

export function projectGraphFromEngineGraph(engineGraph, options = {}) {
  return createProjectGraphState({
    nodes: engineGraph?.nodes || [],
    edges: (engineGraph?.edges || []).map((edge) => ({
      ...edge,
      source: edge.source ?? edge.from,
      target: edge.target ?? edge.to,
    })),
    viewport: options.viewport || options.previous?.viewport,
    ui: options.ui || options.previous?.ui,
  });
}

export function projectGraphFromLegacyStacks(stacks = [], options = {}) {
  const nodes = {};
  const edges = {};
  for (const stack of stacks || []) {
    let previousId = null;
    (stack.blocks || []).forEach((block, index) => {
      const node = normalizeGraphNode({
        ...block,
        position: {
          x: stack.x ?? 120,
          y: (stack.y ?? 120) + index * 112,
        },
      });
      if (!node) return;
      nodes[node.id] = node;
      if (previousId) {
        const edge = normalizeGraphEdge({
          id: `edge_${previousId}_${node.id}`,
          source: previousId,
          target: node.id,
        });
        if (edge) edges[edge.id] = edge;
      }
      previousId = node.id;
    });
  }
  return createProjectGraphState({
    nodes,
    edges,
    viewport: options.viewport || options.previous?.viewport,
    ui: options.ui || options.previous?.ui,
  });
}

export function projectGraphToLegacyStacks(projectGraph = createProjectGraphState()) {
  const graph = createProjectGraphState(projectGraph);
  const nodes = Object.values(graph.nodes);
  const edges = Object.values(graph.edges);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Set(edges.map((edge) => edge.target));
  const visited = new Set();
  const outgoingBySource = new Map();

  for (const edge of edges) {
    if (!outgoingBySource.has(edge.source)) outgoingBySource.set(edge.source, []);
    outgoingBySource.get(edge.source).push(edge);
  }

  for (const list of outgoingBySource.values()) {
    list.sort((a, b) => String(a.label || a.id).localeCompare(String(b.label || b.id)));
  }

  const starts = nodes
    .filter((node) => !incoming.has(node.id))
    .sort((a, b) => (a.position?.y || 0) - (b.position?.y || 0) || (a.position?.x || 0) - (b.position?.x || 0));

  const stacks = [];
  const pushChain = (start) => {
    const blocks = [];
    let current = start;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      blocks.push({
        id: current.id,
        type: current.type,
        props: current.props || {},
        uiAttachments: current.uiAttachments,
      });
      const nextEdge = (outgoingBySource.get(current.id) || []).find((edge) => !visited.has(edge.target));
      current = nextEdge ? byId.get(nextEdge.target) : null;
    }
    if (blocks.length) {
      stacks.push({
        id: `stack_${start.id}`,
        x: start.position?.x || 120,
        y: start.position?.y || 120,
        blocks,
      });
    }
  };

  starts.forEach(pushChain);
  nodes.filter((node) => !visited.has(node.id)).forEach(pushChain);
  return stacks;
}

export function projectGraphToFlow(projectGraph = createProjectGraphState()) {
  const graph = createProjectGraphState(projectGraph);
  return {
    nodes: Object.values(graph.nodes).map((node) => ({
      id: node.id,
      type: 'cicada',
      position: node.position || { x: 0, y: 0 },
      data: {
        type: node.type,
        props: { ...(node.props || {}) },
        uiAttachments: node.uiAttachments || undefined,
        irId: node.id,
        compilerId: node.id,
        semanticId: node.id,
      },
    })),
    edges: Object.values(graph.edges).map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourcePort || 'flow',
      targetHandle: edge.targetPort || 'flow',
      label: edge.label || '',
      condition: edge.condition || '',
    })),
  };
}

export function withProjectGraphViewport(projectGraph, viewport) {
  return createProjectGraphState({
    ...asRecord(projectGraph),
    viewport: normalizeViewport(viewport),
  });
}
