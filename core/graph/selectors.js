import { FLOW_PORTS } from '../../src/ccdParser.js';
import { getBlockDefinition, getBlockFlowConstraints } from '../blockRegistry.js';
import { createProjectGraphState } from './model.js';

export const GRAPH_PORT_TYPES = Object.freeze({
  FLOW: 'FlowPort',
  CONDITION: 'ConditionPort',
  BOOLEAN: 'BooleanPort',
  MESSAGE: 'MessagePort',
  MEDIA: 'MediaPort',
  ACTION: 'ActionPort',
});

export const GRAPH_PORT_COLORS = Object.freeze({
  FlowPort: '#60a5fa',
  ConditionPort: '#fb923c',
  BooleanPort: '#22c55e',
  MessagePort: '#5b7cf6',
  MediaPort: '#34d399',
  ActionPort: '#f87171',
});

const ROOT_TYPES = new Set(['version', 'bot', 'commands', 'global', 'block', 'start', 'command', 'callback', 'scenario', 'middleware']);

function flowPortFor(type, dir) {
  const cfg = FLOW_PORTS[type] || { input: 'flow', output: 'flow' };
  return dir === 'in' ? cfg.input : cfg.output;
}

function semanticPortType(node) {
  if (!node) return GRAPH_PORT_TYPES.FLOW;
  if (node.type === 'condition' || node.type === 'switch' || node.type === 'loop') return GRAPH_PORT_TYPES.CONDITION;
  if (node.category === 'render') return GRAPH_PORT_TYPES.MESSAGE;
  if (node.category === 'media') return GRAPH_PORT_TYPES.MEDIA;
  if (node.category === 'action' || node.category === 'telegram' || node.category === 'data') return GRAPH_PORT_TYPES.ACTION;
  return GRAPH_PORT_TYPES.FLOW;
}

function port(id, label, type, direction) {
  return { id, label, type, direction, color: GRAPH_PORT_COLORS[type] || GRAPH_PORT_COLORS.FlowPort };
}

export function selectNodeById(graph, nodeId) {
  return createProjectGraphState(graph).nodes[nodeId] || null;
}

export function selectOutgoingEdges(graph, nodeId) {
  return Object.values(createProjectGraphState(graph).edges).filter((edge) => edge.source === nodeId);
}

export function selectIncomingEdges(graph, nodeId) {
  return Object.values(createProjectGraphState(graph).edges).filter((edge) => edge.target === nodeId);
}

export function selectNodePorts(graph, nodeId) {
  const state = createProjectGraphState(graph);
  const node = state.nodes[nodeId];
  if (!node) return { inputs: [], outputs: [], semantic: [] };
  const inputHandle = flowPortFor(node.type, 'in');
  const outputHandle = flowPortFor(node.type, 'out');
  const flow = getBlockFlowConstraints(node.type);
  const semantic = semanticPortType(node);
  const inputs = inputHandle == null ? [] : [port(inputHandle, inputHandle, GRAPH_PORT_TYPES.FLOW, 'in')];
  let outputs = [];
  if (outputHandle != null) {
    const labels = flow?.outputLabels || [];
    outputs = labels.length
      ? labels.map((label) => port(label, label.toUpperCase(), label === 'true' || label === 'false' ? GRAPH_PORT_TYPES.BOOLEAN : GRAPH_PORT_TYPES.FLOW, 'out'))
      : [port(outputHandle, outputHandle, GRAPH_PORT_TYPES.FLOW, 'out')];
  }
  return {
    inputs,
    outputs,
    semantic: [port(`semantic:${node.type}`, getBlockDefinition(node.type)?.category || node.type, semantic, 'semantic')],
  };
}

export function areGraphPortsCompatible(sourcePortType, targetPortType) {
  if (sourcePortType === GRAPH_PORT_TYPES.FLOW && targetPortType === GRAPH_PORT_TYPES.FLOW) return true;
  if (sourcePortType === GRAPH_PORT_TYPES.BOOLEAN && targetPortType === GRAPH_PORT_TYPES.FLOW) return true;
  if (sourcePortType === GRAPH_PORT_TYPES.MESSAGE && targetPortType === GRAPH_PORT_TYPES.CONDITION) return false;
  return sourcePortType === targetPortType;
}

export function selectConditionBranches(graph, nodeId) {
  return selectOutgoingEdges(graph, nodeId).filter((edge) => ['true', 'false'].includes(String(edge.sourcePort || edge.label || edge.condition).toLowerCase()));
}

export function selectReachableNodes(graph) {
  const state = createProjectGraphState(graph);
  const outgoing = new Map();
  Object.keys(state.nodes).forEach((id) => outgoing.set(id, []));
  Object.values(state.edges).forEach((edge) => outgoing.get(edge.source)?.push(edge.target));
  const roots = Object.values(state.nodes).filter((node) => ROOT_TYPES.has(node.type) || selectIncomingEdges(state, node.id).length === 0);
  const reachable = new Set();
  const queue = roots.map((node) => node.id);
  while (queue.length) {
    const id = queue.shift();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const target of outgoing.get(id) || []) queue.push(target);
  }
  return reachable;
}

export function selectExecutionPlan(graph) {
  const state = createProjectGraphState(graph);
  const reachable = selectReachableNodes(state);
  return Object.values(state.nodes)
    .filter((node) => reachable.has(node.id))
    .sort((a, b) => (a.position?.y || 0) - (b.position?.y || 0) || (a.position?.x || 0) - (b.position?.x || 0));
}

export function selectGraphCycles(graph) {
  const state = createProjectGraphState(graph);
  const outgoing = new Map();
  Object.keys(state.nodes).forEach((id) => outgoing.set(id, []));
  Object.values(state.edges).forEach((edge) => outgoing.get(edge.source)?.push(edge.target));
  const visiting = new Set();
  const visited = new Set();
  const cycles = new Set();
  const visit = (id, trail = []) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      trail.slice(trail.indexOf(id)).forEach((item) => cycles.add(item));
      cycles.add(id);
      return;
    }
    visiting.add(id);
    for (const target of outgoing.get(id) || []) visit(target, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  };
  Object.keys(state.nodes).forEach((id) => visit(id));
  return cycles;
}

export function selectInvalidEdges(graph) {
  const state = createProjectGraphState(graph);
  return Object.values(state.edges).flatMap((edge) => {
    const source = state.nodes[edge.source];
    const target = state.nodes[edge.target];
    if (!source || !target) return [{ edgeId: edge.id, reason: 'Unknown source/target' }];
    const sourcePorts = selectNodePorts(state, source.id).outputs;
    const targetPorts = selectNodePorts(state, target.id).inputs;
    const sourcePort = sourcePorts.find((item) => item.id === (edge.sourcePort || 'flow')) || sourcePorts[0];
    const targetPort = targetPorts.find((item) => item.id === (edge.targetPort || 'flow')) || targetPorts[0];
    if (!sourcePort || !targetPort) return [{ edgeId: edge.id, reason: 'Missing source or target port' }];
    if (!areGraphPortsCompatible(sourcePort.type, targetPort.type)) {
      return [{ edgeId: edge.id, reason: `${sourcePort.type} -> ${targetPort.type} is invalid` }];
    }
    return [];
  });
}

export function selectInvalidNodes(graph) {
  const state = createProjectGraphState(graph);
  const cycles = selectGraphCycles(state);
  const reachable = selectReachableNodes(state);
  return Object.values(state.nodes).flatMap((node) => {
    const issues = [];
    if (cycles.has(node.id)) issues.push({ nodeId: node.id, reason: 'cycle' });
    if (!reachable.has(node.id)) issues.push({ nodeId: node.id, reason: 'unreachable' });
    return issues;
  });
}

export function selectGraphValidationOverlay(graph) {
  const state = createProjectGraphState(graph);
  const reachable = selectReachableNodes(state);
  const cycles = selectGraphCycles(state);
  const invalidEdges = selectInvalidEdges(state);
  const invalidNodes = selectInvalidNodes(state);
  const nodes = Object.values(state.nodes);
  const orphanNodes = nodes.filter((node) => !ROOT_TYPES.has(node.type) && selectIncomingEdges(state, node.id).length === 0);
  const unreachableNodes = nodes.filter((node) => !reachable.has(node.id));
  const missingOutputs = nodes.filter((node) => flowPortFor(node.type, 'out') != null && selectOutgoingEdges(state, node.id).length === 0);
  const deadBranches = nodes.filter((node) => {
    const labels = getBlockFlowConstraints(node.type)?.outputLabels || [];
    if (!labels.length) return false;
    const used = new Set(selectOutgoingEdges(state, node.id).map((edge) => edge.sourcePort || edge.label));
    return labels.some((label) => !used.has(label));
  });
  return { cycles, invalidEdges, invalidNodes, orphanNodes, unreachableNodes, missingOutputs, deadBranches };
}
import { getBlockDefinition, getBlockFlowConstraints } from '../blockRegistry.js';
import { FLOW_PORTS } from '../../src/ccdParser.js';
import { createProjectGraphState } from './model.js';

export const GRAPH_PORT_TYPES = Object.freeze({
  FLOW: 'FlowPort',
  CONDITION: 'ConditionPort',
  BOOLEAN: 'BooleanPort',
  MESSAGE: 'MessagePort',
  MEDIA: 'MediaPort',
  ACTION: 'ActionPort',
});

export const GRAPH_PORT_COLORS = Object.freeze({
  FlowPort: '#60a5fa',
  ConditionPort: '#fb923c',
  BooleanPort: '#22c55e',
  MessagePort: '#a78bfa',
  MediaPort: '#34d399',
  ActionPort: '#f87171',
});

const ROOT_TYPES = new Set([
  'version',
  'bot',
  'commands',
  'global',
  'block',
  'start',
  'command',
  'callback',
  'scenario',
  'middleware',
  'on_photo',
  'on_voice',
  'on_document',
  'on_sticker',
  'on_location',
  'on_contact',
]);

const TERMINAL_TYPES = new Set(['stop', 'goto']);

function nodesArray(graph) {
  return Object.values(createProjectGraphState(graph).nodes);
}

function edgesArray(graph) {
  return Object.values(createProjectGraphState(graph).edges);
}

function canonicalPortFor(blockType, dir) {
  const cfg = FLOW_PORTS[blockType] || { input: 'flow', output: 'flow' };
  return dir === 'in' ? cfg.input : cfg.output;
}

function semanticPortType(node) {
  const category = getBlockDefinition(node?.type)?.category || node?.category || 'action';
  if (node?.type === 'condition' || node?.type === 'switch' || node?.type === 'loop') return GRAPH_PORT_TYPES.CONDITION;
  if (category === 'render') return GRAPH_PORT_TYPES.MESSAGE;
  if (category === 'media') return GRAPH_PORT_TYPES.MEDIA;
  if (category === 'action' || category === 'telegram' || category === 'data') return GRAPH_PORT_TYPES.ACTION;
  return GRAPH_PORT_TYPES.FLOW;
}

function makePort(node, port) {
  const type = port.type || GRAPH_PORT_TYPES.FLOW;
  return {
    nodeId: node.id,
    direction: port.direction,
    id: port.id,
    transportPort: port.transportPort || port.id,
    label: port.label || port.id,
    type,
    color: port.color || GRAPH_PORT_COLORS[type] || GRAPH_PORT_COLORS.FlowPort,
    edgeLabel: port.edgeLabel || '',
    compatibleWith: port.compatibleWith || [GRAPH_PORT_TYPES.FLOW],
  };
}

export function selectNodeById(projectGraph, nodeId) {
  const graph = createProjectGraphState(projectGraph);
  return graph.nodes?.[nodeId] || null;
}

export function selectOutgoingEdges(projectGraph, nodeId) {
  const graph = createProjectGraphState(projectGraph);
  return Object.values(graph.edges).filter((edge) => edge.source === nodeId);
}

export function selectIncomingEdges(projectGraph, nodeId) {
  const graph = createProjectGraphState(projectGraph);
  return Object.values(graph.edges).filter((edge) => edge.target === nodeId);
}

export function selectConditionBranches(projectGraph, nodeId) {
  const outgoing = selectOutgoingEdges(projectGraph, nodeId);
  const normalize = (value) => String(value || '').trim().toLowerCase();
  return {
    true: outgoing.find((edge) => ['true', 'yes', 'да', '1'].includes(normalize(edge.condition || edge.label))) || null,
    false: outgoing.find((edge) => ['false', 'no', 'нет', '0'].includes(normalize(edge.condition || edge.label))) || null,
    other: outgoing.filter((edge) => !['true', 'yes', 'да', '1', 'false', 'no', 'нет', '0'].includes(normalize(edge.condition || edge.label))),
  };
}

export function selectNodePorts(projectGraph, nodeId) {
  const node = typeof nodeId === 'object' ? nodeId : selectNodeById(projectGraph, nodeId);
  if (!node) return { inputs: [], outputs: [], semantic: [] };

  const input = canonicalPortFor(node.type, 'in');
  const output = canonicalPortFor(node.type, 'out');
  const semanticType = semanticPortType(node);
  const inputs = [];
  const outputs = [];
  const semantic = [];

  if (input != null) {
    inputs.push(makePort(node, {
      direction: 'in',
      id: input,
      label: input === 'scenario_flow' ? 'scenario' : 'flow',
      type: GRAPH_PORT_TYPES.FLOW,
    }));
  }

  if (output != null) {
    if (node.type === 'condition') {
      outputs.push(makePort(node, {
        direction: 'out',
        id: 'true',
        transportPort: output,
        label: 'TRUE',
        edgeLabel: 'TRUE',
        type: GRAPH_PORT_TYPES.BOOLEAN,
        color: '#22c55e',
      }));
      outputs.push(makePort(node, {
        direction: 'out',
        id: 'false',
        transportPort: output,
        label: 'FALSE',
        edgeLabel: 'FALSE',
        type: GRAPH_PORT_TYPES.BOOLEAN,
        color: '#ef4444',
      }));
    } else {
      outputs.push(makePort(node, {
        direction: 'out',
        id: output,
        label: output === 'scenario_flow' ? 'scenario' : 'flow',
        type: GRAPH_PORT_TYPES.FLOW,
      }));
    }
  }

  if (semanticType !== GRAPH_PORT_TYPES.FLOW) {
    semantic.push(makePort(node, {
      direction: 'semantic',
      id: semanticType,
      label: semanticType,
      type: semanticType,
      compatibleWith: [semanticType],
    }));
  }

  return { inputs, outputs, semantic };
}

export function areGraphPortsCompatible(sourcePort, targetPort) {
  if (!sourcePort || !targetPort) return false;
  if (sourcePort.type === GRAPH_PORT_TYPES.MESSAGE && targetPort.type === GRAPH_PORT_TYPES.CONDITION) return false;
  if (sourcePort.transportPort !== targetPort.transportPort) return false;
  if (sourcePort.type === GRAPH_PORT_TYPES.BOOLEAN && targetPort.type === GRAPH_PORT_TYPES.FLOW) return true;
  if (sourcePort.type === GRAPH_PORT_TYPES.FLOW && targetPort.type === GRAPH_PORT_TYPES.FLOW) return true;
  return (sourcePort.compatibleWith || []).includes(targetPort.type);
}

function resolveSourcePort(graph, edge) {
  const ports = selectNodePorts(graph, edge.source).outputs;
  const label = String(edge.condition || edge.label || '').trim().toLowerCase();
  if (label === 'true' || label === 'да') return ports.find((port) => port.id === 'true') || null;
  if (label === 'false' || label === 'нет') return ports.find((port) => port.id === 'false') || null;
  return ports.find((port) => port.id === edge.sourcePort)
    || ports.find((port) => port.transportPort === (edge.sourcePort || 'flow'))
    || null;
}

function resolveTargetPort(graph, edge) {
  const ports = selectNodePorts(graph, edge.target).inputs;
  return ports.find((port) => port.id === edge.targetPort)
    || ports.find((port) => port.transportPort === (edge.targetPort || 'flow'))
    || null;
}

export function selectInvalidEdges(projectGraph) {
  const graph = createProjectGraphState(projectGraph);
  const invalid = [];
  for (const edge of Object.values(graph.edges)) {
    const source = graph.nodes[edge.source];
    const target = graph.nodes[edge.target];
    if (!source || !target) {
      invalid.push({ edgeId: edge.id, edge, reason: 'Unknown source or target node' });
      continue;
    }
    const sourcePort = resolveSourcePort(graph, edge);
    const targetPort = resolveTargetPort(graph, edge);
    if (!areGraphPortsCompatible(sourcePort, targetPort)) {
      invalid.push({ edgeId: edge.id, edge, sourcePort, targetPort, reason: `${sourcePort?.type || 'UnknownPort'} -> ${targetPort?.type || 'UnknownPort'} is not compatible` });
    }
  }
  return invalid;
}

export function selectReachableNodes(projectGraph, rootIds = []) {
  const graph = createProjectGraphState(projectGraph);
  const incoming = new Map();
  const outgoing = new Map();
  Object.keys(graph.nodes).forEach((id) => {
    incoming.set(id, []);
    outgoing.set(id, []);
  });
  Object.values(graph.edges).forEach((edge) => {
    incoming.get(edge.target)?.push(edge);
    outgoing.get(edge.source)?.push(edge);
  });

  const roots = rootIds.length
    ? rootIds
    : Object.values(graph.nodes)
      .filter((node) => ROOT_TYPES.has(node.type) || (incoming.get(node.id) || []).length === 0)
      .map((node) => node.id);

  const reachable = new Set();
  const queue = [...roots];
  while (queue.length) {
    const id = queue.shift();
    if (!id || reachable.has(id) || !graph.nodes[id]) continue;
    reachable.add(id);
    for (const edge of outgoing.get(id) || []) queue.push(edge.target);
  }
  return reachable;
}

export function selectInvalidNodes(projectGraph) {
  const graph = createProjectGraphState(projectGraph);
  const reachable = selectReachableNodes(graph);
  const invalidEdges = selectInvalidEdges(graph);
  const invalidNodeIds = new Set(invalidEdges.flatMap((item) => [item.edge?.source, item.edge?.target]).filter(Boolean));
  const invalid = [];

  for (const node of Object.values(graph.nodes)) {
    const props = node.props || {};
    const incoming = selectIncomingEdges(graph, node.id);
    const outgoing = selectOutgoingEdges(graph, node.id);
    if (!ROOT_TYPES.has(node.type) && incoming.length === 0) {
      invalid.push({ nodeId: node.id, node, severity: 'warning', reason: 'orphan node' });
    }
    if (!reachable.has(node.id)) {
      invalid.push({ nodeId: node.id, node, severity: 'warning', reason: 'unreachable node' });
    }
    if (invalidNodeIds.has(node.id)) {
      invalid.push({ nodeId: node.id, node, severity: 'error', reason: 'invalid port connection' });
    }
    if (!TERMINAL_TYPES.has(node.type) && canonicalPortFor(node.type, 'out') != null && outgoing.length === 0) {
      invalid.push({ nodeId: node.id, node, severity: 'warning', reason: 'missing output' });
    }
    if (node.type === 'message' && !String(props.text || '').trim()) {
      invalid.push({ nodeId: node.id, node, severity: 'error', reason: 'empty message text' });
    }
    if (node.type === 'condition') {
      const branches = selectConditionBranches(graph, node.id);
      if (!String(props.cond || '').trim()) invalid.push({ nodeId: node.id, node, severity: 'error', reason: 'empty condition' });
      if (!branches.true || !branches.false) invalid.push({ nodeId: node.id, node, severity: 'warning', reason: 'dead branch' });
    }
  }

  return invalid;
}

export function selectExecutionPlan(projectGraph) {
  const graph = createProjectGraphState(projectGraph);
  const reachable = selectReachableNodes(graph);
  const outgoing = new Map();
  Object.keys(graph.nodes).forEach((id) => outgoing.set(id, []));
  Object.values(graph.edges).forEach((edge) => outgoing.get(edge.source)?.push(edge));
  for (const list of outgoing.values()) {
    list.sort((a, b) => String(a.label || a.id).localeCompare(String(b.label || b.id)));
  }

  const roots = nodesArray(graph)
    .filter((node) => reachable.has(node.id) && (ROOT_TYPES.has(node.type) || selectIncomingEdges(graph, node.id).length === 0))
    .sort((a, b) => (a.position?.y || 0) - (b.position?.y || 0) || (a.position?.x || 0) - (b.position?.x || 0));

  const ordered = [];
  const seen = new Set();
  const visit = (id, depth = 0) => {
    if (seen.has(id) || !graph.nodes[id]) return;
    seen.add(id);
    ordered.push({ node: graph.nodes[id], depth });
    for (const edge of outgoing.get(id) || []) visit(edge.target, depth + 1);
  };
  roots.forEach((node) => visit(node.id));
  return ordered;
}

export function selectGraphCycles(projectGraph) {
  const graph = createProjectGraphState(projectGraph);
  const outgoing = new Map();
  Object.keys(graph.nodes).forEach((id) => outgoing.set(id, []));
  Object.values(graph.edges).forEach((edge) => outgoing.get(edge.source)?.push(edge.target));

  const visiting = new Set();
  const visited = new Set();
  const cycles = new Set();
  const visit = (id, trail = []) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      trail.slice(trail.indexOf(id)).forEach((nodeId) => cycles.add(nodeId));
      return;
    }
    visiting.add(id);
    for (const target of outgoing.get(id) || []) visit(target, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  };
  Object.keys(graph.nodes).forEach((id) => visit(id));
  return cycles;
}

export function selectGraphValidationOverlay(projectGraph) {
  const graph = createProjectGraphState(projectGraph);
  const invalidNodes = selectInvalidNodes(graph);
  const invalidEdges = selectInvalidEdges(graph);
  const cycles = selectGraphCycles(graph);
  const reachable = selectReachableNodes(graph);
  const nodes = nodesArray(graph);
  return {
    cycles,
    reachable,
    invalidNodes,
    invalidEdges,
    unreachableNodes: nodes.filter((node) => !reachable.has(node.id)),
    orphanNodes: nodes.filter((node) => !ROOT_TYPES.has(node.type) && selectIncomingEdges(graph, node.id).length === 0),
    deadBranches: invalidNodes.filter((item) => item.reason === 'dead branch'),
    missingOutputs: invalidNodes.filter((item) => item.reason === 'missing output'),
  };
}
