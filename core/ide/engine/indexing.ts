import { AstSnapshot, WorkspaceSnapshot } from './types.js';
import { Binder, SemanticDiagnostics } from './semantic.js';

export class IncrementalIndex {
  private readonly byUri = new Map<string, WorkspaceSnapshot>();
  private readonly byAst = new WeakMap<object, WorkspaceSnapshot>();
  private readonly binder = new Binder();
  private readonly diagnostics = new SemanticDiagnostics();

  compute(ast: AstSnapshot): WorkspaceSnapshot {
    const memo = this.byAst.get(ast.program);
    if (memo) return memo;

    const semantic = this.binder.bind(ast.program);
    const diagnostics = this.diagnostics.analyze(ast.program, semantic);
    const snapshot: WorkspaceSnapshot = {
      uri: ast.program.uri,
      version: ast.program.version,
      ast,
      semantic,
      diagnostics,
      codeActions: [],
      navigationTargets: new Map(),
    };

    this.byUri.set(snapshot.uri, snapshot);
    this.byAst.set(ast.program, snapshot);
    return snapshot;
  }
}
