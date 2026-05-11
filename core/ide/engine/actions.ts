import { CodeAction, WorkspaceSnapshot, WorkspaceTransaction } from './types.js';

export class QuickActionsEngine {
  getActions(snapshot: WorkspaceSnapshot): readonly CodeAction[] {
    const actions: CodeAction[] = [];
    snapshot.diagnostics.forEach((d) => {
      if (d.code === 'missing-handlers') actions.push(this.createMissingHandlerAction(d.nodeId));
      if (d.code === 'orphan-handlers') actions.push(this.removeOrphanAction(d.nodeId));
      if (d.code === 'invalid-transitions') actions.push(this.createTransitionAction(d.nodeId));
    });
    actions.push(this.extractReusableFlowAction());
    return Object.freeze(actions);
  }

  renamePropagation(uri: string, from: string, to: string): CodeAction {
    return { id:`rename:${from}:${to}`, title:`Rename ${from} → ${to}`, kind:'refactor.rename', diagnosticCodes:[], execute: (tx: WorkspaceTransaction) => tx.rename(uri, from, to) };
  }

  private createMissingHandlerAction(eventNodeId: string): CodeAction {
    const eventName = eventNodeId.replace('node:event:','');
    return { id:`create:${eventName}`, title:`Create missing handler for ${eventName}`, kind:'quickfix', diagnosticCodes:['missing-handlers'], execute: (tx) => tx.createHandler('active', eventName) };
  }

  private removeOrphanAction(handlerNodeId: string): CodeAction {
    return { id:`remove:${handlerNodeId}`, title:'Remove orphan handler', kind:'quickfix', diagnosticCodes:['orphan-handlers'], execute: (tx) => tx.removeHandler('active', handlerNodeId) };
  }

  private createTransitionAction(handlerNodeId: string): CodeAction {
    return { id:`transition:${handlerNodeId}`, title:'Create transition', kind:'quickfix', diagnosticCodes:['invalid-transitions'], execute: (tx) => tx.createTransition('active', handlerNodeId, 'target_event') };
  }

  private extractReusableFlowAction(): CodeAction {
    return { id:'extract:flow', title:'Extract reusable flow', kind:'refactor.extract', diagnosticCodes:[], execute: (tx) => tx.extractReusableFlow('active', 'handler', 'shared_flow') };
  }
}
