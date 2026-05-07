#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Проверка .ccd через Cicada Parser (AST). Печатает JSON в stdout (UTF-8).
Использование: python lint_cicada.py <file.ccd>
"""
from __future__ import annotations

import io
import json
import os
import sys

# Поток stdout в UTF-8 (Windows / перенаправление)
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True)

# Локальный парсер: каталог этого файла — корень vendor-пакета (рядом лежит cicada/).
# Добавляем его первым, чтобы проверка шла через vendor, а не через pip cicada-tg.
_VENDOR_ROOT = os.path.dirname(os.path.abspath(__file__))
if _VENDOR_ROOT not in sys.path:
    sys.path.insert(0, _VENDOR_ROOT)

from cicada.parser import Parser  # noqa: E402


def _diag_from_syntax_error(e: SyntaxError) -> dict:
    lineno = int(getattr(e, "lineno", None) or 1)
    msg = getattr(e, "msg", None) or (e.args[0] if e.args else str(e)) or str(e)
    offset = getattr(e, "offset", None)
    text = getattr(e, "text", None)
    column = None
    if offset is not None and isinstance(offset, int):
        column = offset
    src_line = None
    if isinstance(text, str):
        src_line = text.rstrip("\n")
    return {
        "type": "SyntaxError",
        "code": "DSL-PY",
        "severity": "error",
        "line": lineno,
        "column": column,
        "offset": offset if isinstance(offset, int) else None,
        "message": str(msg),
        "sourceLine": src_line,
        "help": "Проверь синтаксис строки.",
        "suggestions": [],
    }


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "available": True, "error": "usage: lint_cicada.py <file.ccd>"}))
        sys.exit(2)
    path = os.path.abspath(sys.argv[1])
    base = os.path.dirname(path)
    with open(path, "r", encoding="utf-8") as f:
        source = f.read()
    try:
        Parser(source, base_path=base).parse()
        print(json.dumps({"ok": True, "available": True, "diagnostics": []}, ensure_ascii=False))
        sys.exit(0)
    except SyntaxError as e:
        diag = _diag_from_syntax_error(e)
        print(json.dumps({"ok": False, "available": True, "diagnostics": [diag]}, ensure_ascii=False))
        sys.exit(1)
    except Exception as e:
        diag = {
            "type": "ParserError",
            "code": "DSL-PY",
            "severity": "error",
            "line": 1,
            "column": None,
            "offset": None,
            "message": str(e),
            "help": str(e),
            "suggestions": [],
        }
        print(json.dumps({"ok": False, "available": True, "diagnostics": [diag]}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
