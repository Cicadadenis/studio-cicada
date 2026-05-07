"""
DSL-aware hints and block affinity derived from the real Cicada parser/executor AST.

Цель: подсказки должны опираться на фактические узлы ядра, а не на UI-эвристики.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from .parser import (
    Parser,
    Program,
    Handler,
    Reply,
    Ask,
    If,
    Buttons,
    InlineKeyboard,
    StartScenario,
    Step,
    SaveToDB,
    LoadFromDB,
    UseBlock,
    GotoStep,
    EndScenario,
    ReturnFromScenario,
    RepeatStep,
    HttpGet,
    HttpPost,
)


@dataclass(frozen=True)
class Suggestion:
    key: str
    snippet: str
    reason: str


BLOCK_AFFINITY_RULES: dict[str, set[str]] = {
    # root handlers
    "start": {"reply", "buttons", "inline", "ask", "if", "use", "start_scenario", "http_get", "http_post"},
    "command": {"reply", "buttons", "inline", "ask", "if", "use", "start_scenario", "http_get", "http_post"},
    "callback": {"reply", "buttons", "inline", "ask", "if", "use", "start_scenario", "http_get", "http_post"},
    # flow/control
    "if": {"reply", "buttons", "inline", "ask", "save_db", "load_db", "goto_step", "end_scenario"},
    "ask": {"if", "save_db", "start_scenario", "goto_step", "reply"},
    "start_scenario": {"step"},
    "step": {"reply", "ask", "if", "save_db", "load_db", "goto_step", "repeat_step", "return_scenario", "end_scenario"},
    # io
    "http_get": {"if", "reply", "save_db"},
    "http_post": {"if", "reply", "save_db"},
}


def _node_kind(stmt) -> str:
    if isinstance(stmt, Reply):
        return "reply"
    if isinstance(stmt, Buttons):
        return "buttons"
    if isinstance(stmt, InlineKeyboard):
        return "inline"
    if isinstance(stmt, Ask):
        return "ask"
    if isinstance(stmt, If):
        return "if"
    if isinstance(stmt, StartScenario):
        return "start_scenario"
    if isinstance(stmt, Step):
        return "step"
    if isinstance(stmt, SaveToDB):
        return "save_db"
    if isinstance(stmt, LoadFromDB):
        return "load_db"
    if isinstance(stmt, UseBlock):
        return "use"
    if isinstance(stmt, GotoStep):
        return "goto_step"
    if isinstance(stmt, EndScenario):
        return "end_scenario"
    if isinstance(stmt, ReturnFromScenario):
        return "return_scenario"
    if isinstance(stmt, RepeatStep):
        return "repeat_step"
    if isinstance(stmt, HttpGet):
        return "http_get"
    if isinstance(stmt, HttpPost):
        return "http_post"
    return "unknown"


def _default_suggestions() -> list[Suggestion]:
    return [
        Suggestion("reply", 'ответ "Готово"', "Базовый ответ пользователю"),
        Suggestion("buttons", 'кнопки "Да" "Нет"', "Добавить быстрый выбор"),
        Suggestion("if", 'если текст == "да":', "Ветвление сценария"),
    ]


def suggest_next_blocks_from_body(body: Iterable[object], context: str = "start") -> list[Suggestion]:
    """
    Next-block suggestions based on last AST node + compatibility map.
    """
    body = list(body or [])
    if not body:
        allowed = BLOCK_AFFINITY_RULES.get(context, BLOCK_AFFINITY_RULES["start"])
    else:
        last_kind = _node_kind(body[-1])
        allowed = BLOCK_AFFINITY_RULES.get(last_kind, set())
        if not allowed:
            return _default_suggestions()

    mapping = {
        "reply": Suggestion("reply", 'ответ "..."', "Отправить сообщение"),
        "buttons": Suggestion("buttons", 'кнопки "A" "B"', "Добавить клавиатуру"),
        "inline": Suggestion("inline", "inline-кнопки:", "Добавить inline-кнопки"),
        "ask": Suggestion("ask", 'спросить "Вопрос?" → переменная', "Собрать ввод пользователя"),
        "if": Suggestion("if", 'если условие:', "Логическое ветвление"),
        "save_db": Suggestion("save_db", 'сохранить "ключ" = значение', "Сохранить состояние"),
        "load_db": Suggestion("load_db", 'получить "ключ" → значение', "Прочитать состояние"),
        "use": Suggestion("use", "использовать блок_имя", "Переиспользовать блок"),
        "start_scenario": Suggestion("start_scenario", 'запустить "сценарий"', "Перейти в сценарий"),
        "goto_step": Suggestion("goto_step", 'перейти к шаг "имя"', "Навигация по шагам"),
        "end_scenario": Suggestion("end_scenario", "завершить сценарий", "Явно завершить сценарий"),
    }
    return [mapping[k] for k in allowed if k in mapping]


def dsl_aware_hints(source: str) -> dict:
    """
    Parse DSL and return semantic hints strictly based on parser AST.
    """
    try:
        prog: Program = Parser(source).parse()
    except SyntaxError as e:
        return {"ok": False, "error": str(e), "hints": []}

    hints: list[dict] = []
    for h in prog.handlers:
        if not isinstance(h, Handler):
            continue
        suggestions = suggest_next_blocks_from_body(h.body, context=h.kind if h.kind in BLOCK_AFFINITY_RULES else "start")
        hints.append(
            {
                "handler": h.kind,
                "trigger": h.trigger,
                "next": [s.__dict__ for s in suggestions[:5]],
            }
        )
    return {"ok": True, "hints": hints}
