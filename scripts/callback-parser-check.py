#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Проверяет путь «кнопки → при нажатии» на vendored parser.py + executor.py.

Зачем отдельная проверка:
- parser-batch-check.mjs гарантирует синтаксис через lint_cicada.py;
- этот smoke-тест дополнительно исполняет AST через executor.py с фейковым Telegram,
  чтобы убедиться, что reply-кнопка приходит как текст и попадает в Handler("callback"),
  а inline callback_query попадает в тот же обработчик по callback_data.
"""
from __future__ import annotations

import json
import os
import sys
import types
from typing import Any

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
VENDOR_ROOT = os.path.join(REPO_ROOT, "vendor", "cicada-dsl-parser")
if VENDOR_ROOT not in sys.path:
    sys.path.insert(0, VENDOR_ROOT)


class SmokeContext:
    def __init__(self, chat_id: int, first_name: str = "", user_id: int | None = None, **_: Any):
        self.chat_id = chat_id
        self.user_id = user_id or chat_id
        self.vars: dict[str, Any] = {
            "chat_id": chat_id,
            "user_id": self.user_id,
            "first_name": first_name,
            "текст": "",
            "кнопка": "",
        }
        self.waiting_for = None
        self.scenario = None
        self.step = 0
        self.current_step_name = None
        self._pending_message = None
        self._ask_sent = False
        self._return_requested = False
        self._repeat_requested = False
        self._transition_made = False

    def set(self, key: str, value: Any) -> None:
        self.vars[key] = value

    def get(self, key: str, default: Any = None) -> Any:
        return self.vars.get(key, default)

    def set_step_names(self, _steps: list[Any]) -> None:
        # Не используется в этом smoke-тесте, но executor ожидает метод для сценариев.
        return None


class SmokeRuntime:
    def __init__(self, globals_: dict[str, Any] | None = None):
        self.globals = globals_ or {}
        self._users: dict[int, SmokeContext] = {}

    def user(self, chat_id: int, first_name: str = "", user_id: int | None = None, *args: Any, **kwargs: Any) -> SmokeContext:
        if chat_id not in self._users:
            ctx = SmokeContext(chat_id, first_name=first_name, user_id=user_id, **kwargs)
            for key, value in self.globals.items():
                ctx.set(key, value)
            self._users[chat_id] = ctx
        return self._users[chat_id]


# executor.py импортирует requests, cicada.runtime и cicada.database. В vendored
# parser-smoke эти зависимости не нужны для проверки кнопок, поэтому подставляем
# минимальные стабы до импорта executor.py.
requests_mod = types.ModuleType("requests")
requests_mod.get = lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("requests.get недоступен в callback smoke-тесте"))
requests_mod.post = lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("requests.post недоступен в callback smoke-тесте"))
sys.modules.setdefault("requests", requests_mod)

runtime_mod = types.ModuleType("cicada.runtime")
runtime_mod.Runtime = SmokeRuntime
sys.modules["cicada.runtime"] = runtime_mod


class SmokeDB:
    def __init__(self):
        self.values: dict[tuple[str, str], Any] = {}
        self.global_values: dict[str, Any] = {}

    def set(self, user_id: str, key: str, value: Any) -> None:
        self.values[(user_id, key)] = value

    def get(self, user_id: str, key: str) -> Any:
        return self.values.get((user_id, key))

    def delete(self, user_id: str, key: str) -> None:
        self.values.pop((user_id, key), None)

    def get_all_keys(self, user_id: str) -> list[str]:
        return [key for uid, key in self.values if uid == user_id]

    def set_global(self, key: str, value: Any) -> None:
        self.global_values[key] = value


SMOKE_DB = SmokeDB()
database_mod = types.ModuleType("cicada.database")
database_mod.get_db = lambda: SMOKE_DB
sys.modules["cicada.database"] = database_mod

from cicada.parser import Handler, Parser  # noqa: E402
from cicada.executor import Executor  # noqa: E402


DSL = '''бот "TEST"
при старте:
    ответ "Меню"
    кнопки "Заказ" "Помощь"
    стоп
при нажатии "Заказ":
    ответ "Reply-кнопка обработана"
    стоп
при нажатии "cb_help":
    ответ "Inline-кнопка обработана"
    стоп
'''


class FakeTelegram:
    def __init__(self):
        self.events: list[dict[str, Any]] = []

    def send_message(self, chat_id: int, text: str, **kwargs: Any) -> None:
        self.events.append({"type": "message", "chat_id": chat_id, "text": text, "kwargs": kwargs})

    def send_buttons_matrix(self, chat_id: int, buttons: list[list[str]], text: str = "") -> None:
        self.events.append({"type": "buttons", "chat_id": chat_id, "text": text, "buttons": buttons})

    def answer_callback(self, callback_id: str) -> None:
        self.events.append({"type": "answer_callback", "id": callback_id})


DB_DSL = '''бот "TEST"
при старте:
    ответ "Добро пожаловать в Drop Box! 📦"
    кнопки "📁 Загрузить файл" "📝 О нас"
    стоп

при нажатии "📁 Загрузить файл":
    запустить загрузка
    стоп

сценарий загрузка:
    шаг шаг_загрузки:
        спросить "Отправьте файл для загрузки:" → файл
        сохранить "f_{chat_id}" = {файл}
        ответ "Файл загружен! 📦"
        кнопки "📁 Загрузить ещё" "📝 Мои файлы"
        стоп

при нажатии "📝 Мои файлы":
    получить "f_{chat_id}" → файл
    ответ "Ваш файл: {файл}"
    стоп
'''


def check_db_template_keys() -> None:
    SMOKE_DB.values.clear()
    program = Parser(DB_DSL).parse()
    tg = FakeTelegram()
    executor = Executor(program, tg, debug=True)

    executor.handle({
        "message": {
            "message_id": 10,
            "chat": {"id": 2002, "type": "private"},
            "from": {"id": 2002, "first_name": "Smoke"},
            "text": "📁 Загрузить файл",
        }
    })
    assert_true(
        any(e["type"] == "message" and e["text"] == "Отправьте файл для загрузки:" for e in tg.events),
        "executor.py не задал вопрос из сценария загрузки",
    )

    executor.handle({
        "message": {
            "message_id": 11,
            "chat": {"id": 2002, "type": "private"},
            "from": {"id": 2002, "first_name": "Smoke"},
            "document": {"file_id": "file-123", "file_name": "box.txt"},
        }
    })

    assert_true(
        ("2002", "f_2002") in SMOKE_DB.values,
        "executor.py не отрендерил шаблон ключа БД f_{chat_id} при сохранении",
    )
    assert_true(
        SMOKE_DB.values[("2002", "f_2002")] == "file-123",
        "executor.py не продолжил шаг после получения файла и не сохранил file_id",
    )
    assert_true(
        any(e["type"] == "buttons" and e["text"] == "Файл загружен! 📦" for e in tg.events),
        "executor.py не выполнил инструкции после спросить в том же шаге",
    )

    executor.handle({
        "message": {
            "message_id": 12,
            "chat": {"id": 2002, "type": "private"},
            "from": {"id": 2002, "first_name": "Smoke"},
            "text": "📝 Мои файлы",
        }
    })
    assert_true(
        any(e["type"] == "message" and e["text"] == "Ваш файл: file-123" for e in tg.events),
        "executor.py не загрузил значение по отрендеренному ключу f_{chat_id}",
    )


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> None:
    program = Parser(DSL).parse()

    callback_handlers = [h for h in program.handlers if isinstance(h, Handler) and h.kind == "callback"]
    triggers = {h.trigger for h in callback_handlers}
    assert_true("Заказ" in triggers, "parser.py не создал callback handler для reply-кнопки «Заказ»")
    assert_true("cb_help" in triggers, "parser.py не создал callback handler для inline callback_data «cb_help»")

    tg = FakeTelegram()
    executor = Executor(program, tg, debug=True)

    executor.handle({
        "message": {
            "message_id": 1,
            "chat": {"id": 1001, "type": "private"},
            "from": {"id": 1001, "first_name": "Smoke"},
            "text": "/start",
        }
    })
    assert_true(
        any(e["type"] == "buttons" and e["buttons"] == [["Заказ", "Помощь"]] for e in tg.events),
        "executor.py не отправил reply-кнопки из блока «кнопки»",
    )

    executor.handle({
        "message": {
            "message_id": 2,
            "chat": {"id": 1001, "type": "private"},
            "from": {"id": 1001, "first_name": "Smoke"},
            "text": "Заказ",
        }
    })
    assert_true(
        any(e["type"] == "message" and e["text"] == "Reply-кнопка обработана" for e in tg.events),
        "executor.py не выполнил «при нажатии \"Заказ\"» при тексте reply-кнопки",
    )

    executor.handle({
        "callback_query": {
            "id": "cb-smoke-1",
            "data": "cb_help",
            "from": {"id": 1001, "first_name": "Smoke"},
            "message": {"message_id": 3, "chat": {"id": 1001, "type": "private"}},
        }
    })
    assert_true(
        any(e["type"] == "answer_callback" and e["id"] == "cb-smoke-1" for e in tg.events),
        "executor.py не подтвердил callback_query через answer_callback",
    )
    assert_true(
        any(e["type"] == "message" and e["text"] == "Inline-кнопка обработана" for e in tg.events),
        "executor.py не выполнил «при нажатии \"cb_help\"» при callback_query.data",
    )

    check_db_template_keys()

    print(json.dumps({"ok": True, "checked": ["reply_button_text", "inline_callback_data", "db_template_key", "scenario_ask_resume"]}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 — smoke-тест печатает понятную ошибку для CI.
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise
