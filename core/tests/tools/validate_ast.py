#!/usr/bin/env python3
"""
Проверка JSON AST по schemas/ast.schema.json (JSON Schema draft 2020-12).

Использование:
  python tests/tools/validate_ast.py < program.ast.json
  python tests/tools/validate_ast.py path/to/file.ast.json

Переменные окружения:
  CICADA_AST_SCHEMA_PATH — путь к ast.schema.json (файл).

Зависимость: pip install jsonschema  (см. requirements-dev.txt)

Выход: 0 если валидно, иначе 1 и сообщения jsonschema в stderr.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def _schema_path() -> Path:
    env = os.environ.get("CICADA_AST_SCHEMA_PATH")
    if env:
        return Path(env).expanduser().resolve()
    here = Path(__file__).resolve().parent  # …/core/tests/tools
    core_root = here.parents[1]
    return core_root / "schemas" / "ast.schema.json"


def _load_json(path: Path | None, stdin_fallback: bool) -> tuple[dict, str]:
    if path is not None:
        text = path.read_text(encoding="utf-8")
        label = str(path)
    elif stdin_fallback:
        text = sys.stdin.read()
        label = "<stdin>"
    else:
        raise SystemExit("Укажите файл или передайте JSON в stdin.")
    text = text.replace("\r\n", "\n").strip()
    if not text:
        raise SystemExit("Пустой ввод.")
    return json.loads(text), label


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate Cicada AST JSON against ast.schema.json")
    parser.add_argument(
        "file",
        nargs="?",
        default=None,
        help="JSON файл AST (иначе читается stdin)",
    )
    parser.add_argument(
        "-q",
        "--quiet",
        action="store_true",
        help="Не печатать ничего при успехе",
    )
    args = parser.parse_args()

    schema_file = _schema_path()
    if not schema_file.is_file():
        print(f"Не найдена схема: {schema_file}", file=sys.stderr)
        return 2

    try:
        from jsonschema import Draft202012Validator
    except ImportError:
        print(
            "Нужен пакет jsonschema: pip install jsonschema\n"
            "  или: pip install -r requirements-dev.txt",
            file=sys.stderr,
        )
        return 2

    instance, label = _load_json(Path(args.file) if args.file else None, stdin_fallback=args.file is None)
    schema = json.loads(schema_file.read_text(encoding="utf-8"))

    validator = Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(instance), key=lambda err: getattr(err, "json_path", "") or "")

    if errors:
        print(f"AST не проходит схему ({label}):", file=sys.stderr)
        for e in errors:
            loc = getattr(e, "json_path", None) or "$"
            print(f"  {loc}: {e.message}", file=sys.stderr)
        return 1

    if not args.quiet:
        print(f"OK — валидный AST ({label})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
