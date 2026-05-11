import { AstHandler, AstProgram, DependencyGraph, GraphEdge, NodeId, ParseSnapshot, SemanticDiagnostic, SemanticModel, SymbolInfo } from './types.js';

const freeze = <T>(x: T): T => Object.freeze(x);

export class SemanticEngine {
  analyze(snapshot: ParseSnapshot, prev?: SemanticModel, dirty?: ReadonlySet<NodeId>): { model: SemanticModel; diagnostics: readonly SemanticDiagnostic[] } {
    const symbols = new Map<string, SymbolInfo>(prev?.symbols ?? []);
    const references = new Map(prev?.references ?? []);
    const transitions = new Map<string, readonly string[]>(prev?.transitions ?? []);
    const diagnostics: SemanticDiagnostic[] = [];

    const handlers = snapshot.ast.statements.filter((s): s is AstHandler => s.kind === 'Handler');
    const events = new Set(snapshot.ast.statements.filter((s) => s.kind === 'Event').map((e: any) => e.name));

    for (const st of snapshot.ast.statements) {
      if (dirty && !dirty.has(st.id) && prev) continue;
      if (st.kind === 'Event') symbols.set(`event:${st.name}`, freeze({ id:`event:${st.name}`, name:st.name, nodeId:st.id, kind:'event' }));
      if (st.kind === 'Handler') {
        symbols.set(`handler:${st.name}`, freeze({ id:`handler:${st.name}`, name:st.name, nodeId:st.id, kind:'handler' }));
        references.set(st.id, freeze([`event:${st.eventRef}`]));
        transitions.set(st.name, freeze(st.steps.filter((x)=>x.action==='goto' && x.target).map((x)=>x.target!)));
      }
    }

    this.semanticDiagnostics(events, handlers, transitions, diagnostics);
    const dependencyGraph = this.patchGraph(snapshot.dependencyGraph, transitions);
    return { model: freeze({ symbols, references, transitions, dependencyGraph }), diagnostics: freeze(diagnostics) };
  }

  private semanticDiagnostics(events: Set<string>, handlers: AstHandler[], transitions: Map<string, readonly string[]>, out: SemanticDiagnostic[]): void {
    for (const e of events) {
      const hs = handlers.filter((h) => h.eventRef === e);
      if (!hs.length) out.push({ code:'missing-handler', message:`No handler for event '${e}'`, severity:'error', nodeId:(`event:${e}` as any) });
      if (hs.length > 1) out.push({ code:'duplicate-handler', message:`Multiple handlers for '${e}'`, severity:'warning', nodeId:hs[0].id });
    }
    for (const h of handlers) {
      if (!events.has(h.eventRef)) out.push({ code:'dangling-reference', message:`Unknown event '${h.eventRef}'`, severity:'error', nodeId:h.id });
      if (!h.steps.length) out.push({ code:'orphan-handler', message:`Handler '${h.name}' has no steps`, severity:'warning', nodeId:h.id });
      if (h.name.startsWith('on_btn_') && !h.steps.some((x)=>x.action==='reply' || x.action==='goto')) out.push({ code:'orphan-button-handler', message:`Button handler '${h.name}' is orphan`, severity:'warning', nodeId:h.id });
      if (this.detectInfiniteLoop(h, transitions)) out.push({ code:'infinite-loop', message:`Potential infinite loop in '${h.name}'`, severity:'warning', nodeId:h.id });
      if (this.detectRecursiveTransition(h.name, transitions, new Set())) out.push({ code:'recursive-transition', message:`Recursive transition from '${h.name}'`, severity:'warning', nodeId:h.id });
    }
    const reachable = this.flowReachable('start', transitions);
    for (const e of events) if (!reachable.has(e) && e !== 'start') out.push({ code:'dead-state', message:`Dead state '${e}' unreachable from start`, severity:'info', nodeId:(`event:${e}` as any) });
  }

  private detectRecursiveTransition(name: string, transitions: Map<string, readonly string[]>, seen: Set<string>): boolean {
    if (seen.has(name)) return true; seen.add(name);
    for (const t of transitions.get(name) ?? []) if (this.detectRecursiveTransition(`on_${t}`, transitions, new Set(seen))) return true;
    return false;
  }
  private detectInfiniteLoop(handler: AstHandler, transitions: Map<string, readonly string[]>): boolean {
    const targets = transitions.get(handler.name) ?? [];
    return targets.includes(handler.eventRef) || (targets.length === 1 && targets[0] === handler.eventRef);
  }
  private flowReachable(start: string, transitions: Map<string, readonly string[]>): Set<string> {
    const q = [`on_${start}`]; const seen = new Set<string>([start]);
    while (q.length) { const h = q.shift()!; for (const e of transitions.get(h) ?? []) if (!seen.has(e)) { seen.add(e); q.push(`on_${e}`); } }
    return seen;
  }
  private patchGraph(prev: DependencyGraph, transitions: Map<string, readonly string[]>): DependencyGraph {
    const adjacency = new Map(prev.adjacency); const reverse = new Map(prev.reverse);
    transitions.forEach((targets, handler) => targets.forEach((e) => {
      const edge: GraphEdge = { from: (`node:${handler}` as any), to: (`event:${e}` as any), type:'transition' };
      adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge]);
      reverse.set(edge.to, [...(reverse.get(edge.to) ?? []), edge]);
    }));
    return { adjacency, reverse };
  }
}
