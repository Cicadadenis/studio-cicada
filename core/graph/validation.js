import { createProjectGraphState } from './model.js';
import {
  selectGraphCycles,
  selectGraphValidationOverlay,
  selectInvalidEdges,
} from './selectors.js';

export function createAdjacency(projectGraph) {
  const graph = createProjectGraphState(projectGraph);
  const outgoing = new Map();
  const incoming = new Map();
  Object.keys(graph.nodes).forEach((id) => {
    outgoing.set(id, []);
    incoming.set(id, []);
  });
  Object.values(graph.edges).forEach((edge) => {
    outgoing.get(edge.source)?.push(edge);
    incoming.get(edge.target)?.push(edge);
  });
  return { outgoing, incoming };
}

export function validateProjectGraph(projectGraph) {
  const overlay = selectGraphValidationOverlay(createProjectGraphState(projectGraph));
  const invalidEdges = selectInvalidEdges(projectGraph);
  const cycles = selectGraphCycles(projectGraph);
  const errors = [
    ...invalidEdges.map((item) => `Edge ${item.edgeId}: ${item.reason}`),
    ...(cycles.size ? [`Graph contains cycle(s): ${[...cycles].join(', ')}`] : []),
  ];
  const warnings = [
    ...overlay.orphanNodes.map((node) => `Node ${node.id} (${node.type}) is orphaned`),
    ...overlay.unreachableNodes.map((node) => `Node ${node.id} (${node.type}) is unreachable`),
    ...overlay.missingOutputs.map((node) => `Node ${node.id} (${node.type}) has no outgoing edge`),
    ...overlay.deadBranches.map((node) => `Node ${node.id} (${node.type}) has dead branch output`),
  ];
  return { ok: errors.length === 0, errors, warnings };
}
import { FLOW_PORTS } from '../../src/ccdParser.js';
import { createProjectGraphState } from './model.js';

function portFor(blockType, dir) {
  const cfg = FLOW_PORTS[blockType] || { input: 'flow', output: 'flow' };
  return dir === 'in' ? cfg.input : cfg.output;
}

export function createAdjacency(projectGraph) {
  const graph = createProjectGraphState(projectGraph);
  const outgoing = new Map();
  const incoming = new Map();
  for (const id of Object.keys(graph.nodes)) {
    outgoing.set(id, []);
    incoming.set(id, []);
  }
  for (const edge of Object.values(graph.edges)) {
    outgoing.get(edge.source)?.push(edge);
    incoming.get(edge.target)?.push(edge);
  }
  return { outgoing, incoming };
}

export function validateProjectGraph(projectGraph) {
  const graph = createProjectGraphState(projectGraph);
  const errors = [];
  const warnings = [];
  const nodes = graph.nodes;
  const edges = Object.values(graph.edges);
  const { outgoing, incoming } = createAdjacency(graph);

  for (const edge of edges) {
    const source = nodes[edge.source];
    const target = nodes[edge.target];
    if (!source || !target) {
      errors.push(`Edge ${edge.id}: unknown source/target`);
      continue;
    }
    const expectedSourcePort = portFor(source.type, 'out');
    const expectedTargetPort = portFor(target.type, 'in');
    if (expectedSourcePort == null) {
      errors.push(`Edge ${edge.id}: ${source.type} has no output port`);
    } else if ((edge.sourcePort || 'flow') !== expectedSourcePort) {
      errors.push(`Edge ${edge.id}: source port ${edge.sourcePort || 'flow'} does not match ${expectedSourcePort}`);
    }
    if (expectedTargetPort == null) {
      errors.push(`Edge ${edge.id}: ${target.type} has no input port`);
    } else if ((edge.targetPort || 'flow') !== expectedTargetPort) {
      errors.push(`Edge ${edge.id}: target port ${edge.targetPort || 'flow'} does not match ${expectedTargetPort}`);
    }
  }

  const temp = new Set();
  const perm = new Set();
  const cycleNodes = new Set();
  const visit = (id, trail = []) => {
    if (perm.has(id)) return;
    if (temp.has(id)) {
      trail.slice(trail.indexOf(id)).forEach((item) => cycleNodes.add(item));
      return;
    }
    temp.add(id);
    for (const edge of outgoing.get(id) || []) {
      visit(edge.target, [...trail, id]);
    }
    temp.delete(id);
    perm.add(id);
  };
  Object.keys(nodes).forEach((id) => visit(id));
  if (cycleNodes.size) {
    errors.push(`Graph contains cycle(s): ${[...cycleNodes].join(', ')}`);
  }

  const rootTypes = new Set(['version', 'bot', 'commands', 'global', 'block', 'start', 'command', 'callback', 'scenario', 'middleware']);
  for (const node of Object.values(nodes)) {
    const ins = incoming.get(node.id) || [];
    const outs = outgoing.get(node.id) || [];
    if (!rootTypes.has(node.type) && ins.length === 0) {
      warnings.push(`Node ${node.id} (${node.type}) is orphaned: no incoming edge`);
    }
    if (portFor(node.type, 'out') != null && outs.length === 0 && !['settings'].includes(node.category)) {
      warnings.push(`Node ${node.id} (${node.type}) has no outgoing edge`);
    }
  }

  const reachable = new Set();
  const roots = Object.values(nodes).filter((node) => rootTypes.has(node.type) || (incoming.get(node.id) || []).length === 0);
  const queue = roots.map((node) => node.id);
  while (queue.length) {
    const id = queue.shift();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const edge of outgoing.get(id) || []) queue.push(edge.target);
  }
  for (const node of Object.values(nodes)) {
    if (!reachable.has(node.id)) warnings.push(`Node ${node.id} (${node.type}) is unreachable`);
  }

  return { ok: errors.length === 0, errors, warnings };
}
