#!/usr/bin/env python3
"""
Пакетная проверка сниппетов из all_modules.txt парсером Cicada.
Каждый блок между линиями ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ подмешивается
к заголовку версия + бот (если в блоке ещё нет объявления бота).

Запуск:
  Windows (PowerShell):  python test_all_modules.py
  Linux / WSL:            python3 test_all_modules.py

Пакет cicada в pip не обязателен — подхватывается parser.py из этой же папки.
"""
from __future__ import annotations

import importlib.util
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent


def _load_parser_class():
    """Класс Parser из локального parser.py (без установки пакета cicada)."""
    path = ROOT / "parser.py"
    if not path.is_file():
        raise FileNotFoundError(f"Нет parser.py рядом со скриптом: {path}")
    spec = importlib.util.spec_from_file_location("cicada_parser_local", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Не удалось загрузить модуль: {path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod.Parser


Parser = _load_parser_class()
MODULES_FILE = ROOT / "all_modules.txt"
SEP = "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~"


def wrap_snippet(chunk: str) -> str:
    c = chunk.strip()
    if not c:
        return c
    lines = c.splitlines()
    has_bot = any(re.match(r"^\s*бот\s+\"", line) for line in lines)
    has_ver = any(re.match(r"^\s*версия\s+\"", line) for line in lines)
    head: list[str] = []
    if not has_ver:
        head.append('версия "1.0"')
    if not has_bot:
        head.append('бот "0:dummy"')
    if head:
        return "\n".join(head + ["", c])
    return c


def main() -> int:
    if not MODULES_FILE.is_file():
        print(f"[ERR] Нет файла: {MODULES_FILE}", file=sys.stderr)
        return 2

    raw = MODULES_FILE.read_text(encoding="utf-8")
    chunks = [c.strip() for c in raw.split(SEP) if c.strip()]

    ok = 0
    failures: list[tuple[int, str, str]] = []

    for idx, chunk in enumerate(chunks, start=1):
        src = wrap_snippet(chunk)
        title_line = next(
            (
                ln.strip()
                for ln in chunk.splitlines()
                if ln.strip().startswith("### ")
            ),
            "(без заголовка ###)",
        )
        try:
            Parser(src, str(ROOT)).parse()
            ok += 1
        except SyntaxError as e:
            failures.append((idx, f"SyntaxError: {e}", title_line))
        except Exception as e:
            failures.append((idx, f"{type(e).__name__}: {e}", title_line))

    print(f"Успешно: {ok} / {len(chunks)}")
    if failures:
        print(f"Ошибок: {len(failures)}")
        for num, err, title in failures:
            print(f"\n--- [{num}/{len(chunks)}] {title}")
            print(f"    {err}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
