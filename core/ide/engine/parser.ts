import { AstEvent, AstHandler, AstProgram, AstStatement, AstStep, CstEventDecl, CstHandlerDecl, CstNode, CstProgram, CstRecoveryNode, CstStepDecl, DependencyGraph, DirtySet, GraphEdge, ParseDiagnostic, ParseSnapshot, SnapshotId, TextPos, TextRange, Token, TokenId, Trivia } from './types.js';

const kw = new Set(['event','handler','goto','reply','emit']);
const freeze = <T>(x: T): T => Object.freeze(x);

function pos(offset: number, line: number, column: number): TextPos { return { offset, line, column }; }
function range(start: TextPos, end: TextPos): TextRange { return { start, end }; }
function trivia(): Trivia { return { leading: [], trailing: [] }; }
function nid(s: string) { return s as any; }

export class Lexer {
  tokenize(source: string): readonly Token[] {
    const out: Token[] = []; let offset = 0; let line = 0; let col = 0; let i = 0;
    const mk = (kind: Token['kind'], text: string, s: TextPos, e: TextPos): Token => freeze({ id: (`tok:${s.offset}` as TokenId), kind, text, range: range(s,e), trivia: trivia() });
    while (i < source.length) {
      const ch = source[i];
      if (ch === ' ' || ch === '\t' || ch === '\r') { i++; offset++; col++; continue; }
      if (ch === '\n') { const s = pos(offset,line,col); i++; offset++; line++; col=0; out.push(mk('newline','\n',s,pos(offset,line,col))); continue; }
      const s = pos(offset,line,col);
      if (/[A-Za-z_]/.test(ch)) { let text=''; while (i<source.length && /[A-Za-z0-9_]/.test(source[i])) { text+=source[i]; i++; offset++; col++; } out.push(mk(kw.has(text)?'kw':'id', text, s, pos(offset,line,col))); continue; }
      if (ch === '"') { let text='"'; i++; offset++; col++; while (i<source.length && source[i] !== '"') { text += source[i++]; offset++; col++; } if (source[i] === '"') { text+='"'; i++; offset++; col++; out.push(mk('string', text, s, pos(offset,line,col))); } else out.push(mk('error', text, s, pos(offset,line,col))); continue; }
      out.push(mk('symbol', ch, s, pos(offset+1,line,col+1))); i++; offset++; col++;
    }
    out.push(freeze({ id: (`tok:eof:${offset}` as TokenId), kind:'eof', text:'', range: range(pos(offset,line,col), pos(offset,line,col)), trivia: trivia() }));
    return freeze(out);
  }
}

class TokenStream {
  constructor(private readonly tokens: readonly Token[], private i = 0) {}
  peek(k = 0) { return this.tokens[Math.min(this.i + k, this.tokens.length - 1)]; }
  next() { const t = this.peek(); this.i += 1; return t; }
  checkpoint() { return this.i; }
  rewind(cp: number) { this.i = cp; }
}

export class RecursiveDescentParser {
  parse(uri: string, version: number, source: string, prev?: ParseSnapshot): ParseSnapshot {
    const lexer = new Lexer(); const tokens = lexer.tokenize(source); const stream = new TokenStream(tokens);
    const diagnostics: ParseDiagnostic[] = []; const children: CstNode[] = []; const cstByLine = new Map<number, CstNode>();

    while (stream.peek().kind !== 'eof') {
      if (stream.peek().kind === 'newline') { stream.next(); continue; }
      const line = stream.peek().range.start.line;
      const node = this.parseDecl(stream, diagnostics);
      children.push(node);
      cstByLine.set(line, node);
      this.recoverToLineEnd(stream);
    }

    const cst = freeze<CstProgram>({ id:nid(`${uri}:cst:program:${version}`), kind:'CstProgram', range: range(tokens[0].range.start, tokens[tokens.length-1].range.end), children: freeze(children), recovery:false });
    const ast = this.toAst(uri, version, cst);
    const dep = this.buildDependency(cst, ast, prev);
    return freeze({ id: (`snap:${uri}:${version}` as SnapshotId), uri, version, tokens, cst, ast, diagnostics: freeze(diagnostics), dependencyGraph: dep });
  }

  private parseDecl(stream: TokenStream, diagnostics: ParseDiagnostic[]): CstNode {
    const t = stream.peek();
    if (t.kind === 'kw' && t.text === 'event') return this.parseEvent(stream, diagnostics);
    if (t.kind === 'kw' && t.text === 'handler') return this.parseHandler(stream, diagnostics);
    return this.recovery(stream, diagnostics, 'Unexpected token at declaration start');
  }
  private parseEvent(stream: TokenStream, diagnostics: ParseDiagnostic[]): CstEventDecl {
    const start = stream.next(); const name = stream.peek();
    if (!['id','kw'].includes(name.kind)) diagnostics.push({ code:'P001', message:'Expected event name', severity:'error', range:name.range, recoverable:true });
    const nameTok = stream.next();
    return freeze({ id:nid(`cst:event:${start.range.start.offset}`), kind:'CstEventDecl', name:nameTok, range:range(start.range.start,nameTok.range.end), children: freeze([]), recovery:false });
  }
  private parseHandler(stream: TokenStream, diagnostics: ParseDiagnostic[]): CstHandlerDecl {
    const start = stream.next(); const eventRef = stream.next();
    const steps: CstStepDecl[] = [];
    while (!['newline','eof'].includes(stream.peek().kind)) {
      const cp = stream.checkpoint(); const action = stream.next();
      if (!(action.kind === 'kw' && ['goto','reply','emit'].includes(action.text))) { stream.rewind(cp); break; }
      const target = !['newline','eof'].includes(stream.peek().kind) ? stream.next() : undefined;
      steps.push(freeze({ id:nid(`cst:step:${action.range.start.offset}`), kind:'CstStepDecl', action, target, range: range(action.range.start, (target ?? action).range.end), children: freeze([]), recovery:false }));
      if (stream.peek().kind === 'symbol' && stream.peek().text === '|') stream.next();
    }
    if (!eventRef || eventRef.kind === 'newline') diagnostics.push({ code:'P002', message:'Expected handler event reference', severity:'error', range:start.range, recoverable:true });
    return freeze({ id:nid(`cst:handler:${start.range.start.offset}`), kind:'CstHandlerDecl', eventRef, steps: freeze(steps), range: range(start.range.start, (steps.at(-1)?.range.end ?? eventRef.range.end)), children: freeze(steps), recovery:false });
  }
  private recovery(stream: TokenStream, diagnostics: ParseDiagnostic[], msg: string): CstRecoveryNode {
    const unexpected: Token[] = []; const start = stream.peek();
    while (!['newline','eof'].includes(stream.peek().kind)) unexpected.push(stream.next());
    diagnostics.push({ code:'P999', message:msg, severity:'error', range:start.range, recoverable:true });
    return freeze({ id:nid(`cst:recovery:${start.range.start.offset}`), kind:'CstRecovery', unexpected: freeze(unexpected), range: range(start.range.start, (unexpected.at(-1)?.range.end ?? start.range.end)), children: freeze([]), recovery:true });
  }
  private recoverToLineEnd(stream: TokenStream) { while (!['newline','eof'].includes(stream.peek().kind)) stream.next(); if (stream.peek().kind==='newline') stream.next(); }

  private toAst(uri: string, version: number, cst: CstProgram): AstProgram {
    const statements: AstStatement[] = [];
    for (const n of cst.children) {
      if (n.kind === 'CstEventDecl') statements.push(freeze<AstEvent>({ id:n.id, kind:'Event', name:n.name.text, range:n.range, trivia:n.name.trivia }));
      if (n.kind === 'CstHandlerDecl') statements.push(freeze<AstHandler>({ id:n.id, kind:'Handler', name:`on_${n.eventRef.text}`, eventRef:n.eventRef.text, steps: freeze(n.steps.map((s): AstStep => freeze({ id:s.id, kind:'Step', action:(['goto','reply','emit'].includes(s.action.text)?s.action.text:'reply') as AstStep['action'], target:s.target?.text, range:s.range, trivia:s.action.trivia }))), range:n.range, trivia:n.eventRef.trivia }));
    }
    return freeze({ id:nid(`${uri}:ast:${version}`), kind:'Program', statements: freeze(statements), uri, version, range:cst.range, trivia:trivia() });
  }

  private buildDependency(cst: CstProgram, ast: AstProgram, prev?: ParseSnapshot): DependencyGraph {
    const adjacency = new Map<any, GraphEdge[]>(); const reverse = new Map<any, GraphEdge[]>();
    const add = (e: GraphEdge) => { (adjacency.get(e.from) ?? adjacency.set(e.from, []).get(e.from)!).push(e); (reverse.get(e.to) ?? reverse.set(e.to, []).get(e.to)!).push(e); };
    cst.children.forEach((c) => add({ from: cst.id, to: c.id, type:'syntax' }));
    ast.statements.forEach((s) => add({ from: ast.id, to: s.id, type:'semantic' }));
    if (prev) add({ from: prev.ast.id, to: ast.id, type:'semantic' });
    return { adjacency, reverse };
  }

  diffDirty(prev: ParseSnapshot, nextText: string): DirtySet {
    const dirtyRanges: TextRange[] = [];
    const nextLines = nextText.split(/\r?\n/);
    const prevLines = prev.tokens.filter((t) => t.kind==='newline').length + 1;
    const lines = Math.max(prevLines, nextLines.length);
    for (let i=0; i<lines; i++) {
      const before = this.lineText(prev.tokens, i); const after = nextLines[i] ?? '';
      if (before !== after) dirtyRanges.push(range(pos(0,i,0), pos(after.length,i,after.length)));
    }
    return { dirtyNodes: new Set<NodeId>(), dirtyRanges };
  }
  private lineText(tokens: readonly Token[], line: number): string { return tokens.filter((t) => t.range.start.line===line && t.kind!=='newline').map((t)=>t.text).join(' '); }
}
