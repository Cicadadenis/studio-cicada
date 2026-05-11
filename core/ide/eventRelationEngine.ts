/*
 * Event Relation Engine for Visual Bot IDE
 * Production-style TypeScript architecture focusing on immutable AST,
 * stable node IDs, incremental indexing, diagnostics, and quick actions.
 */

export type NodeId = string;
export type SymbolId = string;
export type Version = number;

export interface TextRange {
  readonly start: number;
  readonly end: number;
}

export interface AstBaseNode {
  readonly id: NodeId;
  readonly kind: string;
  readonly range: TextRange;
  readonly parentId?: NodeId;
  readonly revision: Version;
}

export interface EventNode extends AstBaseNode {
  readonly kind: 'Event';
  readonly name: string;
  readonly triggers: readonly string[];
}

export interface HandlerNode extends AstBaseNode {
  readonly kind: 'Handler';
  readonly eventRef: string;
  readonly body: readonly AstNode[];
}

export interface ActionNode extends AstBaseNode {
  readonly kind: 'Action';
  readonly opcode: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type AstNode = EventNode | HandlerNode | ActionNode;

export interface AstDocument {
  readonly uri: string;
  readonly version: Version;
  readonly root: readonly AstNode[];
  readonly hash: string;
}

export interface SymbolRecord {
  readonly symbolId: SymbolId;
  readonly nodeId: NodeId;
  readonly name: string;
  readonly kind: 'event' | 'handler';
  readonly uri: string;
  readonly version: Version;
}

export interface SymbolGraph {
  readonly byId: ReadonlyMap<SymbolId, SymbolRecord>;
  readonly byName: ReadonlyMap<string, readonly SymbolId[]>;
  readonly outgoing: ReadonlyMap<SymbolId, readonly SymbolId[]>;
  readonly incoming: ReadonlyMap<SymbolId, readonly SymbolId[]>;
}

export interface RelationEdge {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly relation: 'handles' | 'references' | 'emits';
}

export interface RelationIndex {
  readonly uri: string;
  readonly version: Version;
  readonly edges: readonly RelationEdge[];
  readonly byNode: ReadonlyMap<NodeId, readonly RelationEdge[]>;
}

export interface Diagnostic {
  readonly code: 'missing-handler' | 'dangling-event-ref' | 'duplicate-symbol';
  readonly message: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly nodeId: NodeId;
  readonly uri: string;
}

export interface CodeAction {
  readonly title: string;
  readonly kind: 'quickfix' | 'refactor';
  readonly diagnosticCode?: Diagnostic['code'];
  readonly apply: (tx: MutableWorkspaceTransaction) => void;
}

export interface MutableWorkspaceTransaction {
  insertHandler(uri: string, eventName: string): void;
  renameSymbol(uri: string, oldName: string, nextName: string): void;
}

export interface ParseResult {
  readonly ast: AstDocument;
  readonly parseDiagnostics: readonly Diagnostic[];
}

export interface Parser {
  parse(uri: string, version: Version, source: string): ParseResult;
}

export interface RendererSnapshot {
  readonly uri: string;
  readonly version: Version;
  readonly graphNodes: number;
  readonly graphEdges: number;
  readonly diagnostics: readonly Diagnostic[];
}

interface IndexBundle {
  readonly ast: AstDocument;
  readonly symbols: SymbolGraph;
  readonly relations: RelationIndex;
  readonly diagnostics: readonly Diagnostic[];
}

export class StableIdFactory {
  public static nodeId(uri: string, kind: string, range: TextRange, salt = ''): NodeId {
    return `${uri}#${kind}:${range.start}-${range.end}:${salt}`;
  }

  public static symbolId(uri: string, kind: SymbolRecord['kind'], name: string): SymbolId {
    return `${uri}::${kind}::${name}`;
  }
}

export class ImmutableAstParser implements Parser {
  parse(uri: string, version: Version, source: string): ParseResult {
    const lines = source.split(/\r?\n/);
    const root: AstNode[] = [];
    const diagnostics: Diagnostic[] = [];

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line) continue;
      if (line.startsWith('event ')) {
        const name = line.replace('event ', '').trim();
        root.push(Object.freeze({
          id: StableIdFactory.nodeId(uri, 'Event', { start: i, end: i }, name),
          kind: 'Event',
          name,
          triggers: Object.freeze([name]),
          range: Object.freeze({ start: i, end: i }),
          revision: version,
        } satisfies EventNode));
        continue;
      }
      if (line.startsWith('handler ')) {
        const eventRef = line.replace('handler ', '').trim();
        root.push(Object.freeze({
          id: StableIdFactory.nodeId(uri, 'Handler', { start: i, end: i }, eventRef),
          kind: 'Handler',
          eventRef,
          body: Object.freeze([]),
          range: Object.freeze({ start: i, end: i }),
          revision: version,
        } satisfies HandlerNode));
        continue;
      }
      diagnostics.push({
        code: 'dangling-event-ref',
        message: `Unknown statement: ${line}`,
        severity: 'warning',
        nodeId: StableIdFactory.nodeId(uri, 'Unknown', { start: i, end: i }),
        uri,
      });
    }

    return {
      ast: Object.freeze({ uri, version, root: Object.freeze(root), hash: `${uri}:${version}:${root.length}` }),
      parseDiagnostics: Object.freeze(diagnostics),
    };
  }
}

export class IncrementalIndexer {
  private readonly cacheByUri = new Map<string, IndexBundle>();
  private readonly weakByAst = new WeakMap<AstDocument, IndexBundle>();

  index(ast: AstDocument): IndexBundle {
    const memo = this.weakByAst.get(ast);
    if (memo) return memo;

    const prev = this.cacheByUri.get(ast.uri);
    const symbols = this.buildSymbols(ast, prev?.symbols);
    const relations = this.buildRelations(ast);
    const diagnostics = this.buildDiagnostics(ast, symbols, relations);

    const bundle: IndexBundle = Object.freeze({ ast, symbols, relations, diagnostics });
    this.cacheByUri.set(ast.uri, bundle);
    this.weakByAst.set(ast, bundle);
    return bundle;
  }

  private buildSymbols(ast: AstDocument, prev?: SymbolGraph): SymbolGraph {
    const byId = new Map<SymbolId, SymbolRecord>();
    const byName = new Map<string, SymbolId[]>();

    for (const node of ast.root) {
      if (node.kind !== 'Event' && node.kind !== 'Handler') continue;
      const kind: SymbolRecord['kind'] = node.kind === 'Event' ? 'event' : 'handler';
      const name = node.kind === 'Event' ? node.name : node.eventRef;
      const symbolId = StableIdFactory.symbolId(ast.uri, kind, name);
      const reused = prev?.byId.get(symbolId);
      const record: SymbolRecord = reused && reused.version <= ast.version
        ? reused
        : { symbolId, nodeId: node.id, name, kind, uri: ast.uri, version: ast.version };
      byId.set(symbolId, record);
      const bucket = byName.get(name) ?? [];
      bucket.push(symbolId);
      byName.set(name, bucket);
    }

    return { byId, byName, outgoing: new Map(), incoming: new Map() };
  }

  private buildRelations(ast: AstDocument): RelationIndex {
    const edges: RelationEdge[] = [];
    const byNode = new Map<NodeId, RelationEdge[]>();
    const events = ast.root.filter((n): n is EventNode => n.kind === 'Event');
    const handlers = ast.root.filter((n): n is HandlerNode => n.kind === 'Handler');

    for (const handler of handlers) {
      const target = events.find((event) => event.name === handler.eventRef);
      if (!target) continue;
      const edge: RelationEdge = { from: handler.id, to: target.id, relation: 'handles' };
      edges.push(edge);
      const list = byNode.get(handler.id) ?? [];
      list.push(edge);
      byNode.set(handler.id, list);
    }

    return { uri: ast.uri, version: ast.version, edges, byNode };
  }

  private buildDiagnostics(ast: AstDocument, symbols: SymbolGraph, relations: RelationIndex): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const [name, symbolIds] of symbols.byName.entries()) {
      if (symbolIds.length <= 2) continue;
      diagnostics.push({
        code: 'duplicate-symbol',
        message: `Duplicate symbol '${name}'`,
        severity: 'warning',
        nodeId: symbols.byId.get(symbolIds[0])?.nodeId ?? 'unknown',
        uri: ast.uri,
      });
    }

    const handledTargets = new Set(relations.edges.map((edge) => edge.to));
    for (const node of ast.root) {
      if (node.kind === 'Event' && !handledTargets.has(node.id)) {
        diagnostics.push({
          code: 'missing-handler',
          message: `Event '${node.name}' has no handler`,
          severity: 'error',
          nodeId: node.id,
          uri: ast.uri,
        });
      }
      if (node.kind === 'Handler' && !relations.byNode.get(node.id)?.length) {
        diagnostics.push({
          code: 'dangling-event-ref',
          message: `Handler references unknown event '${node.eventRef}'`,
          severity: 'error',
          nodeId: node.id,
          uri: ast.uri,
        });
      }
    }
    return diagnostics;
  }
}

export class QuickActionsEngine {
  getActions(bundle: IndexBundle): readonly CodeAction[] {
    return bundle.diagnostics.flatMap((diag) => {
      if (diag.code === 'missing-handler') {
        const eventNode = bundle.ast.root.find((n) => n.id === diag.nodeId);
        if (!eventNode || eventNode.kind !== 'Event') return [];
        return [HandlerGenerator.createForEvent(bundle.ast.uri, eventNode.name)];
      }
      return [];
    });
  }
}

export class HandlerGenerator {
  static createForEvent(uri: string, eventName: string): CodeAction {
    return {
      title: `Create handler for '${eventName}'`,
      kind: 'quickfix',
      diagnosticCode: 'missing-handler',
      apply: (tx) => tx.insertHandler(uri, eventName),
    };
  }
}

export class RenamePropagation {
  rename(bundle: IndexBundle, oldName: string, nextName: string): CodeAction {
    return {
      title: `Rename '${oldName}' to '${nextName}' across relations`,
      kind: 'refactor',
      apply: (tx) => tx.renameSymbol(bundle.ast.uri, oldName, nextName),
    };
  }
}

export class EventRelationEngine {
  private readonly parser: Parser;
  private readonly indexer: IncrementalIndexer;
  private readonly quickActions: QuickActionsEngine;
  private readonly subscribers = new Set<(snapshot: RendererSnapshot) => void>();

  constructor(parser: Parser = new ImmutableAstParser()) {
    this.parser = parser;
    this.indexer = new IncrementalIndexer();
    this.quickActions = new QuickActionsEngine();
  }

  upsertDocument(uri: string, version: Version, source: string): RendererSnapshot {
    const parseResult = this.parser.parse(uri, version, source);
    const bundle = this.indexer.index(parseResult.ast);
    const diagnostics = [...parseResult.parseDiagnostics, ...bundle.diagnostics];

    const snapshot: RendererSnapshot = {
      uri,
      version,
      graphNodes: bundle.ast.root.length,
      graphEdges: bundle.relations.edges.length,
      diagnostics,
    };

    this.publish(snapshot);
    return snapshot;
  }

  getCodeActions(uri: string, version: Version, source: string): readonly CodeAction[] {
    const parseResult = this.parser.parse(uri, version, source);
    const bundle = this.indexer.index(parseResult.ast);
    return this.quickActions.getActions(bundle);
  }

  subscribe(onUpdate: (snapshot: RendererSnapshot) => void): () => void {
    this.subscribers.add(onUpdate);
    return () => this.subscribers.delete(onUpdate);
  }

  private publish(snapshot: RendererSnapshot): void {
    for (const subscriber of this.subscribers) subscriber(snapshot);
  }
}
