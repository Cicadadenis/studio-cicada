import { CompletionItem, HoverResult, LspSemanticToken, Suggestion, WorkspaceSnapshot } from './types.js';
import { RecursiveDescentParser } from './parser.js';
import { IncrementalIndexer } from './indexing.js';

export interface EngineTx { readonly id: string; readonly uri: string; readonly version: number; readonly content: string; readonly baseVersion?: number }
export interface CollaborationEnvelope { readonly tx: EngineTx; readonly actorId: string; readonly vectorClock: ReadonlyMap<string, number> }


export interface AstMutation { readonly type: 'create-handler-node'|'remove-handler-node'|'rename-button'|'delete-button'; readonly payload: Readonly<Record<string,string>> }

export class TransactionEngine {
  private readonly parser = new RecursiveDescentParser();
  private readonly indexer = new IncrementalIndexer();
  private readonly listeners = new Set<(snapshot: WorkspaceSnapshot) => void>();
  private readonly workers = new Map<string, number>();

  apply(tx: EngineTx): WorkspaceSnapshot {
    const parsed = this.parser.parse(tx.uri, tx.version, tx.content);
    const snapshot = this.indexer.index(parsed);
    this.emit(snapshot);
    return snapshot;
  }
  applyRemote(envelope: CollaborationEnvelope): WorkspaceSnapshot { return this.apply(envelope.tx); }
  subscribe(fn: (snapshot: WorkspaceSnapshot) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  registerWorker(name: string, capacity = 1): void { this.workers.set(name, capacity); }
  applySuggestion(snapshot: WorkspaceSnapshot, suggestion: Suggestion): AstMutation {
    if (suggestion.kind === 'create-button-handler') return { type:'create-handler-node', payload:{ button:suggestion.stableKey.replace('button:','') } };
    if (suggestion.kind === 'remove-orphan-handler') return { type:'remove-handler-node', payload:{ nodeId:String(suggestion.targetNodeId) } };
    if (suggestion.kind === 'rename-button-sync') return { type:'rename-button', payload:{ stableKey:suggestion.stableKey } };
    return { type:'delete-button', payload:{ stableKey:suggestion.stableKey } };
  }
  private emit(snapshot: WorkspaceSnapshot): void { for (const l of this.listeners) l(snapshot); }
}

export class LspFacade {
  semanticTokens(snapshot: WorkspaceSnapshot): readonly LspSemanticToken[] {
    return snapshot.parse.tokens.filter((t)=>t.kind==='kw' || t.kind==='id').map((t) => ({ line:t.range.start.line, startChar:t.range.start.column, length:t.text.length, tokenType: t.kind === 'kw' ? 'keyword' : 'variable' }));
  }
  hover(snapshot: WorkspaceSnapshot, offset: number): HoverResult | undefined {
    const tok = snapshot.parse.tokens.find((t)=>t.range.start.offset <= offset && t.range.end.offset >= offset);
    if (!tok) return undefined;
    return { contents: tok.kind === 'kw' ? `Keyword: ${tok.text}` : `Identifier: ${tok.text}`, range: tok.range };
  }
  references(snapshot: WorkspaceSnapshot, symbol: string): readonly string[] {
    return [...snapshot.semantic.references.entries()].filter(([,refs]) => refs.includes(symbol)).map(([nid]) => nid as string);
  }
  rename(snapshot: WorkspaceSnapshot, from: string, to: string): { edits: readonly string[] } {
    const edits = [...snapshot.semantic.symbols.values()].filter((s)=>s.name===from).map((s)=>`rename:${s.nodeId}:${from}->${to}`);
    return { edits };
  }
  completion(snapshot: WorkspaceSnapshot, _offset: number): readonly CompletionItem[] {
    const kws: CompletionItem[] = ['event','handler','goto','reply','emit'].map((k) => ({ label:k, kind:'keyword' }));
    const symbols: CompletionItem[] = [...snapshot.semantic.symbols.values()].map((s) => ({ label:s.name, kind:s.kind, detail:`${s.kind} symbol` }));
    return [...kws, ...symbols];
  }
}
