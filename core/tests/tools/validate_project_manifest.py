#!/usr/bin/env python3
"""
Проверка bot project manifest по schemas/project.manifest.schema.json.

  python tests/tools/validate_project_manifest.py path/to/project.manifest.json

Переменная окружения: CICADA_PROJECT_MANIFEST_SCHEMA_PATH — путь к JSON Schema.

Зависимость: pip install jsonschema (requirements-dev.txt)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def _schema_path() -> Path:
    env = os.environ.get("CICADA_PROJECT_MANIFEST_SCHEMA_PATH")
    if env:
        return Path(env).expanduser().resolve()
    here = Path(__file__).resolve().parent  # …/core/tests/tools
    core_root = here.parents[1]
    return core_root / "schemas" / "project.manifest.schema.json"


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate bot project manifest JSON")
    parser.add_argument("file", help="project.manifest.json или *.example.json")
    parser.add_argument("-q", "--quiet", action="store_true")
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

    manifest_path = Path(args.file).expanduser().resolve()
    instance = json.loads(manifest_path.read_text(encoding="utf-8"))
    schema = json.loads(schema_file.read_text(encoding="utf-8"))

    validator = Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(instance), key=lambda err: getattr(err, "json_path", "") or "")

    if errors:
        print(f"Manifest не проходит схему ({manifest_path}):", file=sys.stderr)
        for e in errors:
            loc = getattr(e, "json_path", None) or "$"
            print(f"  {loc}: {e.message}", file=sys.stderr)
        return 1

    if not args.quiet:
        print(f"OK — валидный project manifest ({manifest_path})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
