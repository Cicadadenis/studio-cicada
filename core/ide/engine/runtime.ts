import { Parser } from './parser.js';
import { QuickActionsEngine } from './actions.js';
import { IncrementalIndex } from './indexing.js';
import { WorkspaceSnapshot } from './types.js';

export interface EventBusEvent { readonly type: 'snapshot'|'transaction'; readonly snapshot?: WorkspaceSnapshot }

export interface PluginHost {
  parserPlugins: Array<(source: string) => string>;
  diagnosticsPlugins: Array<(snapshot: WorkspaceSnapshot) => WorkspaceSnapshot>;
  codeActionPlugins: Array<(actions: readonly import('./types.js').CodeAction[]) => readonly import('./types.js').CodeAction[]>;
  rendererPlugins: Array<(snapshot: WorkspaceSnapshot) => WorkspaceSnapshot>;
  semanticAnalyzers: Array<(snapshot: WorkspaceSnapshot) => WorkspaceSnapshot>;
}

export class EventBus {
  private listeners = new Set<(event: EventBusEvent) => void>();
  emit(event: EventBusEvent): void { for (const l of this.listeners) l(event); }
  subscribe(listener: (event: EventBusEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
}

export class EngineRuntime {
  private readonly parser = new Parser();
  private readonly index = new IncrementalIndex();
  private readonly actions = new QuickActionsEngine();
  private readonly history: WorkspaceSnapshot[] = [];
  private readonly redoStack: WorkspaceSnapshot[] = [];
  private readonly bus = new EventBus();

  constructor(private readonly plugins: PluginHost = { parserPlugins: [], diagnosticsPlugins: [], codeActionPlugins: [], rendererPlugins: [], semanticAnalyzers: [] }) {}

  update(uri: string, version: number, source: string): WorkspaceSnapshot {
    const transformed = this.plugins.parserPlugins.reduce((src, p) => p(src), source);
    const ast = this.parser.parse(uri, version, transformed);
    let snapshot = this.index.compute(ast);
    snapshot = { ...snapshot, codeActions: this.actions.getActions(snapshot) };
    snapshot = this.plugins.semanticAnalyzers.reduce((s, p) => p(s), snapshot);
    snapshot = this.plugins.diagnosticsPlugins.reduce((s, p) => p(s), snapshot);
    snapshot = { ...snapshot, codeActions: this.plugins.codeActionPlugins.reduce((a, p) => p(a), snapshot.codeActions) };
    snapshot = this.plugins.rendererPlugins.reduce((s, p) => p(s), snapshot);

    this.history.push(snapshot);
    this.redoStack.length = 0;
    this.bus.emit({ type: 'snapshot', snapshot });
    return snapshot;
  }

  subscribe(fn: (event: EventBusEvent) => void): () => void { return this.bus.subscribe(fn); }
  undo(): WorkspaceSnapshot | undefined { const current = this.history.pop(); if (current) this.redoStack.push(current); return this.history[this.history.length - 1]; }
  redo(): WorkspaceSnapshot | undefined { const next = this.redoStack.pop(); if (!next) return undefined; this.history.push(next); return next; }
}
