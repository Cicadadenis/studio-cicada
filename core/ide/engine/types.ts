export type NodeId = string;
export type SymbolId = string;
export type DocumentUri = string;

export interface TextRange { readonly start: number; readonly end: number; readonly line: number; readonly column: number }
export interface AstNodeBase { readonly id: NodeId; readonly kind: string; readonly range: TextRange; readonly parentId?: NodeId; readonly frozen: true }

export interface AstProgram extends AstNodeBase { readonly kind: 'Program'; readonly body: readonly AstStatement[]; readonly version: number; readonly uri: DocumentUri; readonly hash: string }
export interface AstEvent extends AstNodeBase { readonly kind: 'Event'; readonly name: string }
export interface AstHandler extends AstNodeBase { readonly kind: 'Handler'; readonly name: string; readonly eventRef: string; readonly steps: readonly AstStep[] }
export interface AstStep extends AstNodeBase { readonly kind: 'Step'; readonly action: 'goto' | 'reply' | 'emit'; readonly target?: string; readonly payload?: string }
export type AstStatement = AstEvent | AstHandler;

export interface AstSnapshot { readonly program: AstProgram; readonly createdAt: number }

export interface SymbolRecord { readonly id: SymbolId; readonly name: string; readonly kind: 'event' | 'handler' | 'flow'; readonly nodeId: NodeId; readonly scope: string }
export interface Scope { readonly id: string; readonly name: string; readonly symbols: ReadonlyMap<string, SymbolRecord[]>; readonly parent?: string }
export interface RelationEdge { readonly id: string; readonly from: NodeId; readonly to: NodeId; readonly kind: 'handles' | 'transition' | 'emits'; readonly valid: boolean }

export interface SemanticModel {
  readonly symbolTable: ReadonlyMap<SymbolId, SymbolRecord>;
  readonly scopes: ReadonlyMap<string, Scope>;
  readonly references: ReadonlyMap<NodeId, SymbolId[]>;
  readonly relationGraph: ReadonlyMap<string, RelationEdge>;
}

export interface Diagnostic { readonly code: string; readonly severity: 'error'|'warning'|'info'; readonly message: string; readonly nodeId: NodeId }
export interface CodeAction { readonly id: string; readonly title: string; readonly kind: 'quickfix'|'refactor.extract'|'refactor.rename'; readonly diagnosticCodes: readonly string[]; readonly execute(tx: WorkspaceTransaction): void }

export interface WorkspaceTransaction {
  createHandler(uri: string, eventName: string): void;
  rename(uri: string, from: string, to: string): void;
  removeHandler(uri: string, handlerName: string): void;
  createTransition(uri: string, fromHandler: string, toEvent: string): void;
  extractReusableFlow(uri: string, handlerName: string, flowName: string): void;
}

export interface WorkspaceSnapshot {
  readonly uri: string;
  readonly version: number;
  readonly ast: AstSnapshot;
  readonly semantic: SemanticModel;
  readonly diagnostics: readonly Diagnostic[];
  readonly codeActions: readonly CodeAction[];
  readonly navigationTargets: ReadonlyMap<NodeId, readonly NodeId[]>;
}
