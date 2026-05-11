import { ParseSnapshot, WorkspaceSnapshot } from './types.js';
import { SemanticEngine } from './semantic.js';
import { SuggestionsEngine } from './suggestions.js';

const freeze = <T>(x: T): T => Object.freeze(x);

export class PersistentSnapshotStore {
  private readonly byUri = new Map<string, WorkspaceSnapshot[]>();
  append(snapshot: WorkspaceSnapshot): void { const list = this.byUri.get(snapshot.parse.uri) ?? []; list.push(snapshot); this.byUri.set(snapshot.parse.uri, list); }
  latest(uri: string): WorkspaceSnapshot | undefined { const list = this.byUri.get(uri); return list?.[list.length - 1]; }
}

export class IncrementalIndexer {
  private readonly semantic = new SemanticEngine();
  private readonly parseMemo = new WeakMap<object, WorkspaceSnapshot>();
  private readonly store = new PersistentSnapshotStore();
  private readonly suggestions = new SuggestionsEngine();

  index(parse: ParseSnapshot): WorkspaceSnapshot {
    const memo = this.parseMemo.get(parse.ast);
    if (memo) return memo;
    const prev = this.store.latest(parse.uri);
    const dirty = new Set(parse.ast.statements.map((s) => s.id));
    const { model, diagnostics } = this.semantic.analyze(parse, prev?.semantic, dirty);
    const suggestions = this.suggestions.getSuggestions(parse.ast, model, diagnostics);
    const snap = freeze({ snapshotId: parse.id, parse, semantic: model, diagnostics, suggestions, createdAt: Date.now() });
    this.parseMemo.set(parse.ast, snap);
    this.store.append(snap);
    return snap;
  }
}
