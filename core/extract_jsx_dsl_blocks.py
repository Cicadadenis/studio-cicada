#!/usr/bin/env python3
"""
Извлекает DSL-блоки из App.jsx (EXAMPLE_ECHO / SHOP / FULL) и проверочную
программу по умолчанию из DSLPanel.jsx (конструкции nodeDSL), парсит parser.py.

Запуск:
  python extract_jsx_dsl_blocks.py
  python3 extract_jsx_dsl_blocks.py
"""
from __future__ import annotations

import importlib.util
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
APP_JSX = ROOT / "App.jsx"
DSL_PANEL = ROOT / "DSLPanel.jsx"
OUT_FILE = ROOT / "jsx_dsl_extracted.txt"
SEP = "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~"


def _load_parser_class():
    path = ROOT / "parser.py"
    spec = importlib.util.spec_from_file_location("cicada_parser_local", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"parser.py: {path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod.Parser


Parser = _load_parser_class()


def decode_js_double_quoted(src: str, start: int) -> tuple[str, int]:
    """Декодирует содержимое JS-строки в двойных кавычках, начиная с src[start]=='\"'."""
    if start >= len(src) or src[start] != '"':
        raise ValueError("expected opening quote")
    i = start + 1
    out: list[str] = []
    while i < len(src):
        c = src[i]
        if c == "\\":
            i += 1
            if i >= len(src):
                break
            esc = src[i]
            if esc == "n":
                out.append("\n")
            elif esc == "r":
                out.append("\r")
            elif esc == "t":
                out.append("\t")
            elif esc in '"\'\\':
                out.append(esc)
            elif esc == "u" and i + 4 < len(src):
                hexpart = src[i + 1 : i + 5]
                out.append(chr(int(hexpart, 16)))
                i += 5
                continue
            else:
                out.append(esc)
            i += 1
        elif c == '"':
            return "".join(out), i + 1
        else:
            out.append(c)
            i += 1
    raise ValueError("unterminated JS string")


def extract_example_echo_full(text: str) -> tuple[str, str]:
    m_echo = re.search(
        r"const EXAMPLE_ECHO = `([\s\S]*?)`\s*\n\s*const EXAMPLE_SHOP",
        text,
    )
    m_full = re.search(
        r"const EXAMPLE_FULL = `([\s\S]*?)`\s*\n\s*const loadExampleFromFile",
        text,
    )
    if not m_echo or not m_full:
        raise ValueError("Не найдены EXAMPLE_ECHO или EXAMPLE_FULL в App.jsx")
    return m_echo.group(1).strip(), m_full.group(1).strip()


def extract_example_shop(text: str) -> str:
    key = 'const EXAMPLE_SHOP = "'
    pos = text.find(key)
    if pos < 0:
        raise ValueError("Не найден EXAMPLE_SHOP в App.jsx")
    decoded, _ = decode_js_double_quoted(text, pos + len(key) - 1)
    return decoded.strip()


def dsl_panel_smoke_program() -> str:
    """
    Одна программа, покрывающая конструкции из dslCodegen.js / DSLPanel (дефолты props).
    """
    return r'''версия "1.0"
бот "0:dummy"

команды:
    "/start" - "🚀 Запуск"

глобально var = value

блок block_name:
    ответ "..."

до каждого:
    лог[info] "..."

после каждого:
    лог[debug] "..."

при старте:
    ответ "Привет!"
    использовать block_name

при команде "/help":
    ответ "Кнопка 1, Кнопка 2"
    кнопки "Кнопка 1" "Кнопка 2"
    inline-кнопки:
        ["Да" → "cb_yes", "Нет" → "cb_no"]
    если текст == "да":
        ответ "Да"
    иначе:
        ответ "..."
    опрос "Ваш выбор?" "Вариант 1" "Вариант 2"
    спросить "Как вас зовут?" → имя
    запомни счёт = 0
    получить "key" → var
    сохранить "key" = value
    рандом:
        "Привет!"
        "Здорово!"
    запомни тест_switch = "да"
    переключить тест_switch:
        "да":
            ответ "switch_ok"
        "нет":
            ответ "switch_no"
    фото "https://example.com/p.jpg"
    видео "https://example.com/v.mp4"
    аудио "https://example.com/a.mp3"
    документ "https://example.com/d.pdf"
    стикер "FILE_ID"
    контакт "+79001234567" "Иван" "Петров"
    локация 55.75 37.62
    подождать 2
    печатает 1с
    запрос GET "https://api.example.com" → результат
    уведомление → user_id "..."
    запрос_бд "SELECT 1" → результат
    классифицировать ["заказ" | "жалоба"] → намерение
    лог[info] "..."
    если роль == "admin":
        ответ "Доступ разрешён"
    оплата stripe 9.99 USD "Подписка"
    событие "action"
    пока 1 > 2:
        ответ "loop"
    повторять 3 раз:
        ответ "..."

сценарий регистрация:
    шаг начало:
        ответ "Начинаем!"
    шаг шаг1:
        ответ "..."

при нажатии "Кнопка":
    ответ "..."

если текст != "":
    ответ "Получил текст!"

при фото:
    ответ "Получил фото!"

при голосовом:
    ответ "Получил голосовое!"

при документе:
    ответ "Получил документ!"

при стикере:
    ответ "Классный стикер!"

при геолокации:
    ответ "Получил геолокацию!"

при контакте:
    ответ "Получил контакт!"

иначе:
    ответ "..."

при команде "/menu_like":
    ответ "Пункт 1\nПункт 2"
    кнопки:
        ["Пункт 1"]
        ["Пункт 2"]
'''


def main() -> int:
    if not APP_JSX.is_file():
        print(f"[ERR] Нет {APP_JSX}", file=sys.stderr)
        return 2
    if not DSL_PANEL.is_file():
        print(f"[ERR] Нет {DSL_PANEL}", file=sys.stderr)
        return 2

    app_text = APP_JSX.read_text(encoding="utf-8")
    echo, full = extract_example_echo_full(app_text)
    shop = extract_example_shop(app_text)

    blocks: list[tuple[str, str]] = [
        ("### app_EXAMPLE_ECHO", echo),
        ("### app_EXAMPLE_SHOP", shop),
        ("### app_EXAMPLE_FULL", full),
        ("### dsl_panel_smoke (defaults from DSLPanel.jsx)", dsl_panel_smoke_program()),
    ]

    lines_out: list[str] = []
    for title, body in blocks:
        lines_out.append(title)
        lines_out.append(body.rstrip())
        lines_out.append("")
        lines_out.append(SEP)
        lines_out.append("")

    OUT_FILE.write_text("\n".join(lines_out).rstrip() + "\n", encoding="utf-8")

    ok = 0
    failures: list[tuple[str, str]] = []
    for title, body in blocks:
        label = title.replace("### ", "").strip()
        try:
            Parser(body.strip(), str(ROOT)).parse()
            ok += 1
            print(f"OK  {label}")
        except SyntaxError as e:
            failures.append((label, f"SyntaxError: {e}"))
            print(f"FAIL {label}: SyntaxError: {e}")
        except Exception as e:
            failures.append((label, f"{type(e).__name__}: {e}"))
            print(f"FAIL {label}: {type(e).__name__}: {e}")

    print(f"\nУспешно: {ok} / {len(blocks)}")
    print(f"Записано: {OUT_FILE.name}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
