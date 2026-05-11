"""Общие утилиты для симуляции входящих Telegram update (Studio preview)."""

from __future__ import annotations

import hashlib
import os


def dsl_code_hash(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def ensure_bot_line(code: str) -> str:
    stripped = code.lstrip("\ufeff")
    for line in stripped.splitlines():
        s = line.strip()
        if s.startswith("бот "):
            return stripped
        if s:
            break
    return 'бот "__STUDIO_PREVIEW__"\n\n' + stripped


def message_update(text: str, chat_id: int, message_id: int = 1, user_id: int = 10001) -> dict:
    return {
        "update_id": message_id,
        "message": {
            "message_id": message_id,
            "from": {
                "id": user_id,
                "is_bot": False,
                "first_name": "Preview",
                "username": "preview_user",
            },
            "chat": {"id": chat_id, "type": "private"},
            "date": 0,
            "text": text,
        },
    }


def callback_update(callback_data: str, chat_id: int, *, user_id: int = 10001) -> dict:
    return {
        "update_id": 10_000 + abs(hash(callback_data)) % 100_000,
        "callback_query": {
            "id": f"cb_{abs(hash(callback_data)) % 10**9}",
            "from": {"id": user_id, "is_bot": False, "first_name": "Preview"},
            "message": {
                "message_id": 1,
                "chat": {"id": chat_id, "type": "private"},
                "from": {"id": 777000, "is_bot": True},
            },
            "chat_instance": "preview",
            "data": callback_data,
        },
    }
