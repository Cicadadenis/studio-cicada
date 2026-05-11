export type Brand<K, T> = K & { __brand: T };
export type NodeId = Brand<string, 'NodeId'>;
export type SnapshotId = Brand<string, 'SnapshotId'>;
export type TokenId = Brand<string, 'TokenId'>;

export interface TextPos { readonly offset: number; readonly line: number; readonly column: number }
export interface TextRange { readonly start: TextPos; readonly end: TextPos }
export interface Trivia { readonly leading: readonly string[]; readonly trailing: readonly string[] }

export interface Token { readonly id: TokenId; readonly kind: 'kw'|'id'|'string'|'symbol'|'newline'|'eof'|'error'; readonly text: string; readonly range: TextRange; readonly trivia: Trivia }
export interface ParseDiagnostic { readonly code: string; readonly message: string; readonly severity: 'error'|'warning'; readonly range: TextRange; readonly recoverable: boolean }

export interface CstNodeBase { readonly id: NodeId; readonly kind: string; readonly range: TextRange; readonly children: readonly CstNode[]; readonly recovery: boolean }
export interface CstProgram extends CstNodeBase { readonly kind: 'CstProgram' }
export interface CstEventDecl extends CstNodeBase { readonly kind: 'CstEventDecl'; readonly name: Token }
export interface CstHandlerDecl extends CstNodeBase { readonly kind: 'CstHandlerDecl'; readonly eventRef: Token; readonly steps: readonly CstStepDecl[] }
export interface CstStepDecl extends CstNodeBase { readonly kind: 'CstStepDecl'; readonly action: Token; readonly target?: Token }
export interface CstRecoveryNode extends CstNodeBase { readonly kind: 'CstRecovery'; readonly unexpected: readonly Token[] }
export type CstNode = CstProgram | CstEventDecl | CstHandlerDecl | CstStepDecl | CstRecoveryNode;

export interface AstNodeBase { readonly id: NodeId; readonly kind: string; readonly range: TextRange; readonly trivia: Trivia }
export interface AstProgram extends AstNodeBase { readonly kind: 'Program'; readonly statements: readonly AstStatement[]; readonly uri: string; readonly version: number }
export interface AstEvent extends AstNodeBase { readonly kind: 'Event'; readonly name: string }
export interface AstHandler extends AstNodeBase { readonly kind: 'Handler'; readonly name: string; readonly eventRef: string; readonly steps: readonly AstStep[] }
export interface AstStep extends AstNodeBase { readonly kind: 'Step'; readonly action: 'goto'|'reply'|'emit'; readonly target?: string }
export type AstStatement = AstEvent | AstHandler;

export interface ParseSnapshot { readonly id: SnapshotId; readonly uri: string; readonly version: number; readonly tokens: readonly Token[]; readonly cst: CstProgram; readonly ast: AstProgram; readonly diagnostics: readonly ParseDiagnostic[]; readonly dependencyGraph: DependencyGraph }

export interface GraphEdge { readonly from: NodeId; readonly to: NodeId; readonly type: 'syntax'|'semantic'|'transition'|'reference' }
export interface DependencyGraph { readonly adjacency: ReadonlyMap<NodeId, readonly GraphEdge[]>; readonly reverse: ReadonlyMap<NodeId, readonly GraphEdge[]> }
export interface DirtySet { readonly dirtyNodes: ReadonlySet<NodeId>; readonly dirtyRanges: readonly TextRange[] }

export interface SymbolInfo { readonly id: string; readonly name: string; readonly nodeId: NodeId; readonly kind: 'event'|'handler' }
export interface SemanticModel { readonly symbols: ReadonlyMap<string, SymbolInfo>; readonly references: ReadonlyMap<NodeId, readonly string[]>; readonly transitions: ReadonlyMap<string, readonly string[]>; readonly dependencyGraph: DependencyGraph }
export interface SemanticDiagnostic { readonly code: string; readonly message: string; readonly severity: 'error'|'warning'|'info'; readonly nodeId: NodeId }

export interface Suggestion { readonly id: string; readonly kind: 'create-button-handler'|'remove-orphan-handler'|'rename-button-sync'|'remove-button-handler'; readonly title: string; readonly description: string; readonly targetNodeId: NodeId; readonly stableKey: string }

export interface WorkspaceSnapshot { readonly snapshotId: SnapshotId; readonly parse: ParseSnapshot; readonly semantic: SemanticModel; readonly diagnostics: readonly SemanticDiagnostic[]; readonly suggestions: readonly Suggestion[]; readonly createdAt: number }

export interface LspSemanticToken { readonly line: number; readonly startChar: number; readonly length: number; readonly tokenType: 'keyword'|'function'|'variable'|'string'|'operator' }
export interface HoverResult { readonly contents: string; readonly range: TextRange }
export interface CompletionItem { readonly label: string; readonly kind: 'event'|'handler'|'keyword'; readonly detail?: string }
