#!/usr/bin/env python3
"""
Минимальный AST(JSON) → DSL для roundtrip-тестов AST → DSL → AST.

Поддержка узлов из эталонов roundtrip: Program, Handler(command), Reply,
If + Condition/BinaryOp/Variable/Literal, SwitchStmt.

Читает JSON из stdin или из одного файла (путь аргументом), пишет DSL в stdout.

Полный codegen дерева — отдельная задача; здесь только канонический слой для регрессий.
"""
from __future__ import annotations

import json
import sys
from typing import Any, List


def _escape_reply_text(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def emit_expr(node: dict) -> str:
    if not node:
        return ""
    t = node.get("__type__")
    if t == "Variable":
        return node.get("name", "")
    if t == "Literal":
        v = node.get("value")
        if isinstance(v, str):
            return f'"{v}"'
        if isinstance(v, bool):
            return "истина" if v else "ложь"
        return str(v)
    if t == "VarRef":
        return node.get("name", "")
    if t == "BinaryOp":
        return f'{emit_expr(node.get("left"))} {node.get("op", "")} {emit_expr(node.get("right"))}'
    if t == "UnaryOp":
        inner = emit_expr(node.get("operand"))
        op = node.get("op", "")
        return f"{op} {inner}".strip()
    if t == "Condition":
        base = f'{emit_expr(node.get("left"))} {node.get("op", "")} {emit_expr(node.get("right"))}'
        if node.get("negate"):
            return f"не ({base})"
        return base
    return str(node)


def emit_stmt(stmt: dict, indent: int) -> List[str]:
    pad = "    " * indent
    if not stmt:
        return []
    t = stmt.get("__type__")
    if t == "Reply":
        parts = stmt.get("parts") or []
        chunks: List[str] = []
        for p in parts:
            if isinstance(p, str):
                chunks.append(p)
            elif isinstance(p, dict):
                chunks.append(emit_expr(p))
            else:
                chunks.append(str(p))
        text = "".join(chunks)
        return [f'{pad}ответ "{_escape_reply_text(text)}"']

    if t == "If":
        cond = stmt.get("condition") or {}
        line = f'{pad}если {emit_expr(cond)}:'
        lines = [line]
        for s in stmt.get("then_body") or []:
            lines.extend(emit_stmt(s, indent + 1))
        eb = stmt.get("else_body") or []
        if eb:
            lines.append(f'{pad}иначе:')
            for s in eb:
                lines.extend(emit_stmt(s, indent + 1))
        return lines

    if t == "SwitchStmt":
        var = stmt.get("variable", "текст")
        lines = [f"{pad}переключить {var}:"]
        for case in stmt.get("cases") or []:
            if len(case) < 2:
                continue
            lit, body = case[0], case[1]
            lines.append(f'{pad}    "{lit}":')
            for s in body:
                lines.extend(emit_stmt(s, indent + 2))
        return lines

    return [f"{pad}# [emit:{t}]"]


def emit_handler(h: dict) -> List[str]:
    kind = h.get("kind")
    lines: List[str] = []
    body = h.get("body") or []

    if kind == "command":
        tr = h.get("trigger") or "/t"
        if not str(tr).startswith("/"):
            tr = "/" + str(tr).lstrip("/")
        lines.append(f'при команде "{tr}":')
        for stmt in body:
            lines.extend(emit_stmt(stmt, 1))
        return lines

    if kind == "start":
        lines.append("при старте:")
        for stmt in body:
            lines.extend(emit_stmt(stmt, 1))
        return lines

    lines.append(f"# [handler:{kind}]")
    for stmt in body:
        lines.extend(emit_stmt(stmt, 0))
    return lines


def emit_program(p: dict) -> str:
    cfg = p.get("config") or {}
    out: List[str] = []
    if "version" in cfg:
        out.append(f'версия "{cfg["version"]}"')
    tok = cfg.get("token")
    if tok is not None:
        out.append(f'бот "{tok}"')
    out.append("")
    for h in p.get("handlers") or []:
        out.extend(emit_handler(h))
        out.append("")
    while out and out[-1] == "":
        out.pop()
    return "\n".join(out) + "\n"


def _usage() -> None:
    prog = sys.argv[0] if sys.argv else "ast_json_emit.py"
    sys.stderr.write(
        f"usage: python {prog} [AST.json]\n"
        "  With no args: read AST JSON from stdin.\n"
        "  With one path: read AST JSON from that file.\n",
    )


def main() -> int:
    args = sys.argv[1:]
    if "-h" in args or "--help" in args:
        _usage()
        return 0
    if len(args) > 1:
        sys.stderr.write(
            "error: at most one input file; otherwise pipe JSON on stdin.\n",
        )
        _usage()
        return 2
    if len(args) == 1:
        with open(args[0], encoding="utf-8") as f:
            raw = f.read()
    else:
        raw = sys.stdin.read()
    data = json.loads(raw)
    sys.stdout.write(emit_program(data))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
