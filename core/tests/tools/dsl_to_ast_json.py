#!/usr/bin/env python3
"""
Читает DSL из stdin (UTF-8), парсит найденный parser.py, пишет JSON AST в stdout.

Поиск parser.py:
  1) переменная окружения CICADA_PARSER_PATH (файл или каталог)
  2) вверх от core/tests/tools: parser.py, cicada/parser.py, vendor/.../parser.py

  python tests/tools/dsl_to_ast_json.py < program.dsl

Выходной JSON:
  - корень Program дополняется полем schemaVersion (= schemas/schema-versions.json → astSchemaVersion);
  - каноническая сериализация: tests/tools/canonical_ast_json.dumps_canonical (sort_keys, indent=2, UTF-8, завершающий \\n).

Используется roundtrip-тестами IR → DSL → AST.
"""
from __future__ import annotations

import dataclasses
import importlib.util
import os
import sys
from pathlib import Path

from canonical_ast_json import dumps_canonical

# Совпадает с schemas/schema-versions.json → astSchemaVersion
AST_ROOT_SCHEMA_VERSION = 1


def _find_parser_file() -> Path:
    env = os.environ.get("CICADA_PARSER_PATH")
    if env:
        p = Path(env).expanduser().resolve()
        if p.is_file() and p.name == "parser.py":
            return p
        if (p / "parser.py").is_file():
            return p / "parser.py"
    # каталог core/ (родитель tests/tools)
    start = Path(__file__).resolve().parents[2]
    chain = [start, *list(start.parents)[:5]]
    candidates = []
    for ancestor in chain:
        candidates.extend(
            [
                ancestor / "parser.py",
                ancestor / "cicada" / "parser.py",
                ancestor / "vendor" / "cicada-dsl-parser" / "cicada" / "parser.py",
            ]
        )
    for cand in candidates:
        if cand.is_file():
            return cand
    raise FileNotFoundError(
        "Не найден parser.py (задайте CICADA_PARSER_PATH или положите parser рядом с core/)"
    )


def _load_parser():
    path = _find_parser_file()
    spec = importlib.util.spec_from_file_location(f"cicada_parser_rt_{path.stem}", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"parser.py: {path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod.Parser, path


def _to_jsonable(obj):
    if obj is None:
        return None
    if isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, dict):
        return {k: _to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_to_jsonable(x) for x in obj]
    if dataclasses.is_dataclass(obj):
        return {
            "__type__": type(obj).__name__,
            **{
                f.name: _to_jsonable(getattr(obj, f.name))
                for f in dataclasses.fields(obj)
            },
        }
    return str(obj)


def main() -> int:
    src = sys.stdin.read()
    Parser, parser_path = _load_parser()
    prog = Parser(src, str(parser_path.parent)).parse()
    data = _to_jsonable(prog)
    if isinstance(data, dict) and data.get("__type__") == "Program":
        merged = dict(data)
        merged["schemaVersion"] = AST_ROOT_SCHEMA_VERSION
        data = merged
    sys.stdout.write(dumps_canonical(data))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
