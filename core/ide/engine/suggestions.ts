import { AstHandler, AstProgram, SemanticDiagnostic, SemanticModel, Suggestion } from './types.js';

const freeze = <T>(x: T): T => Object.freeze(x);

export class SuggestionsEngine {
  private readonly memo = new WeakMap<object, readonly Suggestion[]>();

  collectButtons(ast: AstProgram): readonly { label: string; sourceNodeId: string }[] {
    const buttons: Array<{ label: string; sourceNodeId: string }> = [];
    for (const h of ast.statements.filter((s): s is AstHandler => s.kind === 'Handler')) {
      for (const step of h.steps) {
        if (step.action === 'reply' && step.target) buttons.push({ label: step.target, sourceNodeId: String(step.id) });
      }
    }
    return freeze(buttons);
  }

  detectMissingButtonHandlers(ast: AstProgram, semantic: SemanticModel): readonly Suggestion[] {
    const buttons = this.collectButtons(ast);
    const existingHandlers = new Set([...semantic.symbols.values()].filter((s) => s.kind === 'handler').map((s) => s.name));
    const missing = buttons
      .filter((b) => !existingHandlers.has(`on_${b.label}`))
      .map((b) => freeze<Suggestion>({
        id: `sug:create:${b.label}`,
        kind: 'create-button-handler',
        title: `➕ Добавить при нажатии '${b.label}'`,
        description: `Создать обработчик кнопки '${b.label}'`,
        targetNodeId: b.sourceNodeId as any,
        stableKey: `button:${b.label}`,
      }));
    return freeze(missing);
  }

  getSuggestions(ast: AstProgram, semantic: SemanticModel, diagnostics: readonly SemanticDiagnostic[]): readonly Suggestion[] {
    const cached = this.memo.get(ast);
    if (cached) return cached;
    const missing = this.detectMissingButtonHandlers(ast, semantic);
    const orphan = diagnostics.filter((d) => d.code === 'orphan-button-handler').map((d) => freeze<Suggestion>({
      id: `sug:remove:${String(d.nodeId)}`,
      kind: 'remove-orphan-handler',
      title: 'Удалить orphan button handler',
      description: d.message,
      targetNodeId: d.nodeId,
      stableKey: `orphan:${String(d.nodeId)}`,
    }));
    const all = freeze([...missing, ...orphan]);
    this.memo.set(ast, all);
    return all;
  }
}
