import { getBlockDefaultProps, getBlockDefinition } from '../blockRegistry.js';
import { createProjectGraphState, normalizeGraphEdge, normalizeGraphNode } from './model.js';
import { areGraphPortsCompatible, selectNodePorts } from './selectors.js';

function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
}

function commandResult(graph, command) {
  return {
    ok: true,
    graph: createProjectGraphState(graph),
    transaction: { type: command.type, timestamp: Date.now(), command },
  };
}

export function validateGraphCommand(projectGraph, command) {
  const graph = createProjectGraphState(projectGraph);
  if (!command?.type) return { ok: false, reason: 'Command type is required' };
  if (command.type !== 'CONNECT_PORTS') return { ok: true };

  const source = graph.nodes[command.sourceNodeId];
  const target = graph.nodes[command.targetNodeId];
  if (!source || !target) return { ok: false, reason: 'Unknown source or target node' };
  if (source.id === target.id) return { ok: false, reason: 'Node cannot connect to itself' };

  const sourcePort = selectNodePorts(graph, source.id).outputs.find((port) => port.id === (command.sourcePort || 'flow'));
  const targetPort = selectNodePorts(graph, target.id).inputs.find((port) => port.id === (command.targetPort || 'flow'));
  if (!sourcePort || !targetPort) return { ok: false, reason: 'Missing source or target port' };
  if (!areGraphPortsCompatible(sourcePort.type, targetPort.type)) {
    return { ok: false, reason: `${sourcePort.type} -> ${targetPort.type} is not allowed` };
  }
  if (Object.values(graph.edges).some((edge) => edge.source === source.id && edge.target === target.id && edge.sourcePort === sourcePort.id)) {
    return { ok: false, reason: 'Connection already exists' };
  }
  return { ok: true };
}

export function dispatchGraphCommand(projectGraph, command) {
  const graph = createProjectGraphState(projectGraph);
  switch (command?.type) {
    case 'ADD_NODE': {
      const definition = getBlockDefinition(command.blockType);
      if (!definition) return { ok: false, error: `Unknown block type: ${command.blockType}` };
      const node = normalizeGraphNode({
        id: command.nodeId || uid('node'),
        type: definition.type,
        props: { ...getBlockDefaultProps(definition.type), ...(command.props || {}) },
        position: command.position || { x: 260, y: 160 },
      });
      return commandResult({ ...graph, nodes: { ...graph.nodes, [node.id]: node } }, command);
    }
    case 'UPDATE_NODE': {
      const current = graph.nodes[command.nodeId];
      if (!current) return { ok: false, error: 'Unknown node' };
      const node = normalizeGraphNode({
        ...current,
        props: command.props ? { ...(current.props || {}), ...command.props } : current.props,
        position: command.position || current.position,
        uiAttachments: command.uiAttachments || current.uiAttachments,
      });
      return commandResult({ ...graph, nodes: { ...graph.nodes, [node.id]: node } }, command);
    }
    case 'MOVE_NODE': {
      return dispatchGraphCommand(graph, { type: 'UPDATE_NODE', nodeId: command.nodeId, position: command.position });
    }
    case 'DELETE_NODE': {
      const nodes = { ...graph.nodes };
      delete nodes[command.nodeId];
      const edges = Object.fromEntries(Object.entries(graph.edges).filter(([, edge]) => edge.source !== command.nodeId && edge.target !== command.nodeId));
      return commandResult({ ...graph, nodes, edges }, command);
    }
    case 'CONNECT_PORTS': {
      const validation = validateGraphCommand(graph, command);
      if (!validation.ok) return { ok: false, error: validation.reason };
      const edge = normalizeGraphEdge({
        id: command.edgeId || uid('edge'),
        source: command.sourceNodeId,
        target: command.targetNodeId,
        sourcePort: command.sourcePort || 'flow',
        targetPort: command.targetPort || 'flow',
        label: command.label || command.sourcePort || '',
        condition: command.condition || command.sourcePort || '',
      });
      return commandResult({ ...graph, edges: { ...graph.edges, [edge.id]: edge } }, command);
    }
    case 'DELETE_EDGE': {
      const edges = { ...graph.edges };
      delete edges[command.edgeId];
      return commandResult({ ...graph, edges }, command);
    }
    default:
      return { ok: false, error: `Unsupported graph command: ${command?.type || 'unknown'}` };
  }
}
import { getBlockDefinition, getBlockFlowConstraints } from '../blockRegistry.js';
import {
  createProjectGraphState,
  normalizeGraphEdge,
  normalizeGraphNode,
} from './model.js';
import {
  areGraphPortsCompatible,
  selectNodeById,
  selectNodePorts,
  selectOutgoingEdges,
} from './selectors.js';

function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
}

function ok(graph, transaction) {
  return { ok: true, graph: createProjectGraphState(graph), transaction };
}

function fail(graph, reason) {
  return { ok: false, graph: createProjectGraphState(graph), error: reason, validation: { ok: false, reason } };
}

function maxOutputsFor(node) {
  const flow = getBlockFlowConstraints(node?.type);
  if (Number.isFinite(flow?.maxOutputs)) return Number(flow.maxOutputs);
  return 1;
}

function resolveOutputPort(graph, nodeId, portId) {
  const ports = selectNodePorts(graph, nodeId).outputs;
  return ports.find((port) => port.id === portId)
    || ports.find((port) => port.transportPort === portId)
    || ports[0]
    || null;
}

function resolveInputPort(graph, nodeId, portId) {
  const ports = selectNodePorts(graph, nodeId).inputs;
  return ports.find((port) => port.id === portId)
    || ports.find((port) => port.transportPort === portId)
    || ports[0]
    || null;
}

function patchGraphNode(graph, nodeId, updates = {}) {
  const current = graph.nodes[nodeId];
  if (!current) return null;
  return normalizeGraphNode({
    ...current,
    ...updates,
    props: updates.props ? { ...(current.props || {}), ...updates.props } : current.props,
    uiAttachments: updates.uiAttachments ?? current.uiAttachments,
    position: updates.position ?? current.position,
  });
}

export function validateGraphCommand(projectGraph, command = {}) {
  const graph = createProjectGraphState(projectGraph);
  if (command.type !== 'CONNECT_PORTS') return { ok: true };

  const sourceId = command.sourceNodeId || command.source;
  const targetId = command.targetNodeId || command.target;
  const source = selectNodeById(graph, sourceId);
  const target = selectNodeById(graph, targetId);
  if (!source || !target) return { ok: false, reason: 'Unknown source or target node' };
  if (source.id === target.id) return { ok: false, reason: 'Node cannot connect to itself' };

  const sourcePort = resolveOutputPort(graph, source.id, command.sourcePort || command.sourcePortId || 'flow');
  const targetPort = resolveInputPort(graph, target.id, command.targetPort || command.targetPortId || 'flow');
  if (!areGraphPortsCompatible(sourcePort, targetPort)) {
    return {
      ok: false,
      reason: `${sourcePort?.type || 'UnknownPort'} -> ${targetPort?.type || 'UnknownPort'} is not compatible`,
      sourcePort,
      targetPort,
    };
  }

  const outgoing = selectOutgoingEdges(graph, source.id);
  const branchLabel = command.label || command.condition || sourcePort.edgeLabel || '';
  const duplicate = outgoing.some((edge) => (
    edge.target === target.id &&
    (edge.sourcePort || 'flow') === sourcePort.transportPort &&
    (edge.targetPort || 'flow') === targetPort.transportPort &&
    String(edge.label || edge.condition || '') === String(branchLabel)
  ));
  if (duplicate) return { ok: false, reason: 'Connection already exists' };

  const maxOutputs = maxOutputsFor(source);
  if (maxOutputs <= 0) return { ok: false, reason: `${source.type} has no output port` };
  if (source.type === 'condition') {
    const sameBranch = outgoing.filter((edge) => String(edge.label || edge.condition || '').toLowerCase() === String(branchLabel).toLowerCase());
    if (sameBranch.length >= 1) return { ok: false, reason: `${branchLabel || 'branch'} already has an output` };
  } else if (outgoing.length >= maxOutputs) {
    return { ok: false, reason: `${source.type} allows only ${maxOutputs} output connection(s)` };
  }

  return { ok: true, sourcePort, targetPort, label: branchLabel };
}

export function dispatchGraphCommand(projectGraph, command = {}) {
  const graph = createProjectGraphState(projectGraph);
  const tx = {
    id: command.transactionId || uid('tx'),
    type: command.type,
    label: command.label || command.type,
    timestamp: Date.now(),
  };

  switch (command.type) {
    case 'ADD_NODE': {
      const definition = getBlockDefinition(command.blockType || command.nodeType || command.typeName);
      if (!definition) return fail(graph, `Unknown block type: ${command.blockType || command.nodeType || command.typeName}`);
      const node = normalizeGraphNode({
        id: command.nodeId || command.id || uid('node'),
        type: definition.type,
        props: command.props,
        position: command.position || { x: 260, y: 160 },
        uiAttachments: command.uiAttachments,
      });
      return ok({ ...graph, nodes: { ...graph.nodes, [node.id]: node } }, { ...tx, nodeId: node.id });
    }

    case 'UPDATE_NODE':
    case 'MOVE_NODE': {
      const nodeId = command.nodeId || command.id;
      const node = patchGraphNode(graph, nodeId, {
        props: command.props,
        position: command.position,
        uiAttachments: command.uiAttachments,
      });
      if (!node) return fail(graph, `Unknown node: ${nodeId}`);
      return ok({ ...graph, nodes: { ...graph.nodes, [node.id]: node } }, { ...tx, nodeId: node.id });
    }

    case 'DELETE_NODE': {
      const nodeId = command.nodeId || command.id;
      if (!graph.nodes[nodeId]) return fail(graph, `Unknown node: ${nodeId}`);
      const { [nodeId]: _deleted, ...nodes } = graph.nodes;
      const edges = Object.fromEntries(Object.values(graph.edges).filter((edge) => edge.source !== nodeId && edge.target !== nodeId).map((edge) => [edge.id, edge]));
      return ok({ ...graph, nodes, edges }, { ...tx, nodeId });
    }

    case 'CONNECT_PORTS': {
      const validation = validateGraphCommand(graph, command);
      if (!validation.ok) return fail(graph, validation.reason);
      const sourceId = command.sourceNodeId || command.source;
      const targetId = command.targetNodeId || command.target;
      const edge = normalizeGraphEdge({
        id: command.edgeId || uid('edge'),
        source: sourceId,
        target: targetId,
        sourcePort: validation.sourcePort.transportPort,
        targetPort: validation.targetPort.transportPort,
        label: validation.label,
        condition: validation.label,
      });
      return ok({ ...graph, edges: { ...graph.edges, [edge.id]: edge } }, { ...tx, edgeId: edge.id });
    }

    case 'DELETE_EDGE': {
      const edgeId = command.edgeId || command.id;
      if (!graph.edges[edgeId]) return fail(graph, `Unknown edge: ${edgeId}`);
      const { [edgeId]: _deleted, ...edges } = graph.edges;
      return ok({ ...graph, edges }, { ...tx, edgeId });
    }

    case 'SET_VIEWPORT': {
      return ok({ ...graph, viewport: command.viewport || graph.viewport }, tx);
    }

    default:
      return fail(graph, `Unknown graph command: ${command.type || 'EMPTY_COMMAND'}`);
  }
}
