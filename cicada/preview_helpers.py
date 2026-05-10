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


def document_message_update(
    chat_id: int,
    *,
    file_name: str,
    file_id: str,
    mime_type: str = "application/octet-stream",
    file_size: int = 0,
    caption: str = "",
    message_id: int = 1,
    user_id: int = 10001,
) -> dict:
    msg: dict = {
        "message_id": message_id,
        "from": {
            "id": user_id,
            "is_bot": False,
            "first_name": "Preview",
            "username": "preview_user",
        },
        "chat": {"id": chat_id, "type": "private"},
        "date": 0,
        "document": {
            "file_name": file_name,
            "mime_type": mime_type,
            "file_id": file_id,
            "file_unique_id": file_id[-32:] if len(file_id) >= 32 else file_id,
            "file_size": int(file_size or 0),
        },
    }
    cap = (caption or "").strip()
    if cap:
        msg["caption"] = cap
    return {"update_id": message_id, "message": msg}


def photo_message_update(
    chat_id: int,
    *,
    file_id: str,
    caption: str = "",
    message_id: int = 1,
    user_id: int = 10001,
) -> dict:
    fid = file_id
    msg: dict = {
        "message_id": message_id,
        "from": {
            "id": user_id,
            "is_bot": False,
            "first_name": "Preview",
            "username": "preview_user",
        },
        "chat": {"id": chat_id, "type": "private"},
        "date": 0,
        "photo": [
            {"file_id": f"{fid}_thumb", "width": 90, "height": 90, "file_size": 1200},
            {"file_id": fid, "width": 1280, "height": 720, "file_size": 95000},
        ],
    }
    cap = (caption or "").strip()
    if cap:
        msg["caption"] = cap
    return {"update_id": message_id, "message": msg}


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
