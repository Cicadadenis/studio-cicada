import { AstEvent, AstHandler, AstProgram, AstSnapshot, AstStep, AstStatement, NodeId, TextRange } from './types.js';

interface Token { readonly type: 'kw'|'id'|'str'|'sym'; readonly value: string; readonly pos: number; readonly line: number; readonly column: number }

export class StableId {
  static create(uri: string, kind: string, range: Pick<TextRange,'start'|'end'>, key = ''): NodeId {
    return `${uri}:${kind}:${range.start}-${range.end}:${key}`;
  }
}

export class Lexer {
  tokenize(source: string): readonly Token[] {
    const tokens: Token[] = [];
    const lines = source.split(/\r?\n/);
    lines.forEach((line, lineNumber) => {
      let offset = 0;
      for (const part of line.trim().split(/\s+/).filter(Boolean)) {
        const type: Token['type'] = ['event','handler','goto','reply','emit'].includes(part) ? 'kw' : 'id';
        tokens.push({ type, value: part, pos: offset, line: lineNumber, column: offset });
        offset += part.length + 1;
      }
      tokens.push({ type: 'sym', value: '\n', pos: offset, line: lineNumber, column: offset });
    });
    return Object.freeze(tokens);
  }
}

export class AstFactory {
  freeze<T>(value: T): T { return Object.freeze(value); }
}

export class Parser {
  private readonly lexer = new Lexer();
  private readonly ast = new AstFactory();

  parse(uri: string, version: number, source: string): AstSnapshot {
    const lines = source.split(/\r?\n/);
    const _tokens = this.lexer.tokenize(source);
    const body: AstStatement[] = [];
    for (let i=0;i<lines.length;i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const [head, ...rest] = line.split(/\s+/);
      if (head === 'event') {
        const name = rest.join(' ');
        body.push(this.ast.freeze<AstEvent>({ id: StableId.create(uri,'Event',{start:i,end:i},name), kind:'Event', name, range:{start:i,end:i,line:i,column:0}, frozen:true }));
      } else if (head === 'handler') {
        const [eventRef, ...tail] = rest;
        const steps = this.parseSteps(uri, i, tail.join(' '));
        body.push(this.ast.freeze<AstHandler>({ id: StableId.create(uri,'Handler',{start:i,end:i},eventRef), kind:'Handler', name:`on_${eventRef}`, eventRef, steps, range:{start:i,end:i,line:i,column:0}, frozen:true }));
      }
    }
    const program = this.ast.freeze<AstProgram>({ id: StableId.create(uri,'Program',{start:0,end:lines.length}), kind:'Program', body:this.ast.freeze(body), version, uri, hash:`${uri}:${version}:${body.length}`, range:{start:0,end:lines.length,line:0,column:0}, frozen:true });
    return this.ast.freeze({ program, createdAt: Date.now() });
  }

  private parseSteps(uri: string, line: number, raw: string): readonly AstStep[] {
    if (!raw) return Object.freeze([]);
    return Object.freeze(raw.split('|').map((chunk, idx) => {
      const [action, ...rest] = chunk.trim().split(/\s+/);
      const target = rest[0];
      return Object.freeze<AstStep>({ id: StableId.create(uri,'Step',{start:line,end:line},`${idx}:${action}`), kind:'Step', action: (action as AstStep['action']) || 'reply', target, payload: rest.slice(1).join(' '), range:{start:line,end:line,line,column:0}, frozen:true });
    }));
  }
}
