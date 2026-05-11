import { AstProgram, AstStatement, Diagnostic, RelationEdge, Scope, SemanticModel, SymbolRecord } from './types.js';
import { StableId } from './parser.js';

export class Binder {
  bind(program: AstProgram): SemanticModel {
    const symbolTable = new Map<string, SymbolRecord>();
    const rootScope: Scope = { id:'root', name:'root', symbols:new Map() };
    const scopes = new Map([[rootScope.id, rootScope]]);
    const references = new Map<string, string[]>();
    const relationGraph = new Map<string, RelationEdge>();

    for (const statement of program.body) {
      if (statement.kind === 'Event') {
        const s: SymbolRecord = { id: `sym:event:${statement.name}`, name: statement.name, kind:'event', nodeId: statement.id, scope:'root' };
        symbolTable.set(s.id, s);
        this.push(rootScope, statement.name, s);
      }
      if (statement.kind === 'Handler') {
        const s: SymbolRecord = { id: `sym:handler:${statement.name}`, name: statement.name, kind:'handler', nodeId: statement.id, scope:'root' };
        symbolTable.set(s.id, s);
        this.push(rootScope, statement.name, s);
        references.set(statement.id, [`sym:event:${statement.eventRef}`]);
        const relationId = StableId.create(program.uri, 'rel:handles', statement.range, statement.eventRef);
        relationGraph.set(relationId, { id: relationId, from: statement.id, to: `node:event:${statement.eventRef}`, kind:'handles', valid: true });
        statement.steps.forEach((step) => {
          if (step.action === 'goto' && step.target) {
            const tid = StableId.create(program.uri, 'rel:transition', step.range, `${statement.name}->${step.target}`);
            relationGraph.set(tid, { id: tid, from: statement.id, to: `node:event:${step.target}`, kind:'transition', valid: true });
          }
        });
      }
    }
    return { symbolTable, scopes, references, relationGraph };
  }

  private push(scope: Scope, key: string, symbol: SymbolRecord): void {
    const existing = scope.symbols.get(key) ?? [];
    scope.symbols.set(key, [...existing, symbol]);
  }
}

export class SemanticDiagnostics {
  analyze(program: AstProgram, semantic: SemanticModel): readonly Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const eventNames = new Set(program.body.filter((n): n is Extract<AstStatement,{kind:'Event'}> => n.kind==='Event').map((e)=>e.name));
    const handlers = program.body.filter((n): n is Extract<AstStatement,{kind:'Handler'}> => n.kind==='Handler');

    for (const event of eventNames) {
      const eventHandlers = handlers.filter((h)=>h.eventRef===event);
      if (eventHandlers.length === 0) diagnostics.push({ code:'missing-handlers', severity:'error', message:`Missing handler for ${event}`, nodeId:`node:event:${event}` });
      if (eventHandlers.length > 1) diagnostics.push({ code:'duplicate-handlers', severity:'warning', message:`Duplicate handlers for ${event}`, nodeId:eventHandlers[0].id });
    }

    for (const handler of handlers) {
      if (!eventNames.has(handler.eventRef)) diagnostics.push({ code:'dangling-references', severity:'error', message:`Handler ${handler.name} references unknown event ${handler.eventRef}`, nodeId:handler.id });
      if (handler.steps.length === 0) diagnostics.push({ code:'orphan-handlers', severity:'warning', message:`Orphan handler ${handler.name} has no transitions`, nodeId:handler.id });
      for (const step of handler.steps) {
        if (step.action === 'goto' && step.target && !eventNames.has(step.target)) diagnostics.push({ code:'invalid-transitions', severity:'error', message:`Invalid transition to ${step.target}`, nodeId:step.id });
      }
    }

    const transitionTargets = handlers.flatMap((h)=>h.steps.filter((s)=>s.action==='goto' && s.target).map((s)=>s.target!));
    for (const event of eventNames) if (!transitionTargets.includes(event) && !handlers.some((h)=>h.eventRef===event)) diagnostics.push({ code:'unreachable-flows', severity:'info', message:`Unreachable flow ${event}`, nodeId:`node:event:${event}` });

    // naive cycle check
    for (const handler of handlers) {
      if (handler.steps.some((s)=>s.action==='goto' && s.target===handler.eventRef)) diagnostics.push({ code:'cyclic-navigation', severity:'warning', message:`Cyclic navigation in ${handler.name}`, nodeId:handler.id });
    }
    return diagnostics;
  }
}
