"""
Cicada Core — платформо-независимые события, эффекты и сервисы ядра.

Этот модуль не знает о Telegram Bot API: адаптеры должны переводить внешние
updates в CoreEvent, а исполнитель — возвращать/записывать CoreEffect.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol



# ─────────────────────────── Events ────────────────────────────

@dataclass
class CoreEvent:
    """Базовое входящее событие для ядра Cicada."""

    chat_id: int
    user_id: int | None = None
    username: str = ""
    first_name: str = ""
    last_name: str = ""
    language_code: str = ""
    chat_type: str = "private"
    message_id: int = 0

    @property
    def display_name(self) -> str:
        return self.first_name or self.username


@dataclass
class MessageEvent(CoreEvent):
    """Текстовое сообщение пользователя."""

    text: str = ""


@dataclass
class CallbackEvent(CoreEvent):
    """Нажатие inline/reply-кнопки."""

    data: str = ""
    callback_id: str = ""


@dataclass
class MediaEvent(CoreEvent):
    """Нормализованное медиа-событие без привязки к Telegram update."""

    media_type: str = ""
    file_id: str = ""
    file_name: str = ""
    sticker_emoji: str = ""
    latitude: float | None = None
    longitude: float | None = None
    contact_name: str = ""
    contact_phone: str = ""


class TelegramUpdateNormalizer:
    """Преобразует Telegram update dict в платформо-независимый CoreEvent."""

    @staticmethod
    def from_update(update: dict) -> CoreEvent | None:
        callback_query = update.get("callback_query")
        if callback_query:
            return TelegramUpdateNormalizer.from_callback(callback_query)
        msg = update.get("message")
        if msg:
            return TelegramUpdateNormalizer.from_message(msg)
        return None

    @staticmethod
    def _base_from_message(msg: dict, user_info: dict | None = None) -> dict:
        chat = msg.get("chat", {})
        user = user_info or msg.get("from", {})
        return {
            "chat_id": int(chat.get("id", 0)),
            "user_id": user.get("id"),
            "username": user.get("username", ""),
            "first_name": user.get("first_name", ""),
            "last_name": user.get("last_name", ""),
            "language_code": user.get("language_code", ""),
            "chat_type": chat.get("type", "private"),
            "message_id": int(msg.get("message_id", 0) or 0),
        }

    @staticmethod
    def from_callback(callback_query: dict) -> CallbackEvent | None:
        msg = callback_query.get("message", {})
        chat_id = msg.get("chat", {}).get("id")
        if not chat_id:
            return None
        return CallbackEvent(
            **TelegramUpdateNormalizer._base_from_message(
                msg, callback_query.get("from", {})
            ),
            data=callback_query.get("data", ""),
            callback_id=callback_query.get("id", ""),
        )

    @staticmethod
    def from_message(msg: dict) -> CoreEvent:
        base = TelegramUpdateNormalizer._base_from_message(msg)
        # Вложения важнее поля text: иначе сообщение с подписью/аномальным text
        # стало бы MessageEvent без document/photo — ломается сценарий после спросить.
        if msg.get("photo"):
            return MediaEvent(**base, media_type="фото", file_id=msg["photo"][-1]["file_id"])
        if msg.get("document"):
            doc = msg["document"]
            return MediaEvent(**base, media_type="документ", file_id=doc["file_id"], file_name=doc.get("file_name", ""))
        if msg.get("voice"):
            return MediaEvent(**base, media_type="голосовое", file_id=msg["voice"]["file_id"])
        if msg.get("audio"):
            return MediaEvent(**base, media_type="аудио", file_id=msg["audio"]["file_id"])
        if msg.get("sticker"):
            sticker = msg["sticker"]
            return MediaEvent(**base, media_type="стикер", file_id=sticker["file_id"], sticker_emoji=sticker.get("emoji", ""))
        if msg.get("location"):
            loc = msg["location"]
            return MediaEvent(**base, media_type="геолокация", latitude=loc.get("latitude"), longitude=loc.get("longitude"))
        if msg.get("contact"):
            contact = msg["contact"]
            return MediaEvent(**base, media_type="контакт", contact_name=contact.get("first_name", ""), contact_phone=contact.get("phone_number", ""))
        if "text" in msg:
            return MessageEvent(**base, text=msg.get("text", ""))
        return MessageEvent(**base, text="")


# ─────────────────────────── Effects ────────────────────────────

@dataclass
class CoreEffect:
    """Базовый исходящий эффект ядра."""

    kind: str
    chat_id: int | None = None
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass
class MessageEffect(CoreEffect):
    text: str = ""

    def __init__(self, chat_id: int, text: str):
        super().__init__("message", chat_id, {"text": text})
        self.text = text


@dataclass
class ButtonsEffect(CoreEffect):
    text: str = ""
    buttons: list = field(default_factory=list)

    def __init__(self, chat_id: int, text: str, buttons: list):
        super().__init__("buttons", chat_id, {"text": text, "buttons": buttons})
        self.text = text
        self.buttons = buttons


@dataclass
class InlineKeyboardEffect(CoreEffect):
    text: str = ""
    keyboard: list = field(default_factory=list)

    def __init__(self, chat_id: int, text: str, keyboard: list):
        super().__init__("inline_keyboard", chat_id, {"text": text, "keyboard": keyboard})
        self.text = text
        self.keyboard = keyboard


@dataclass
class MediaEffect(CoreEffect):
    media_type: str = ""
    file: str = ""
    caption: str = ""

    def __init__(self, chat_id: int, media_type: str, file: str, caption: str = ""):
        super().__init__("media", chat_id, {"media_type": media_type, "file": file, "caption": caption})
        self.media_type = media_type
        self.file = file
        self.caption = caption


@dataclass
class PlatformEffect(CoreEffect):
    """Эффект для platform/capability операций, например Telegram-only API."""

    def __init__(self, kind: str, chat_id: int | None = None, **payload):
        super().__init__(kind, chat_id, payload)


def effect_to_dict(effect: CoreEffect) -> dict[str, Any]:
    """Сериализует CoreEffect в JSON-friendly dict для preview/tests."""
    return {**effect.payload, "kind": effect.kind, "chat_id": effect.chat_id}


def effects_to_dicts(effects: list[CoreEffect]) -> list[dict[str, Any]]:
    return [effect_to_dict(effect) for effect in effects]


# ─────────────────────────── Service protocols ────────────────────────────

class HttpResponse(Protocol):
    text: str


class HttpClient(Protocol):
    def get(self, url: str, *, headers: dict | None = None, timeout: int = 30) -> HttpResponse: ...
    def post(self, url: str, *, json: Any = None, data: Any = None, headers: dict | None = None, timeout: int = 30) -> HttpResponse: ...
    def patch(self, url: str, *, json: Any = None, data: Any = None, headers: dict | None = None, timeout: int = 30) -> HttpResponse: ...
    def put(self, url: str, *, json: Any = None, data: Any = None, headers: dict | None = None, timeout: int = 30) -> HttpResponse: ...
    def delete(self, url: str, *, headers: dict | None = None, timeout: int = 30) -> HttpResponse: ...


class RequestsHttpClient:
    """Default HTTP client для core-инструкций HTTP."""

    def get(self, url: str, *, headers: dict | None = None, timeout: int = 30):
        import requests
        return requests.get(url, headers=headers, timeout=timeout)

    def post(self, url: str, *, json: Any = None, data: Any = None, headers: dict | None = None, timeout: int = 30):
        import requests
        return requests.post(url, json=json, data=data, headers=headers, timeout=timeout)

    def patch(self, url: str, *, json: Any = None, data: Any = None, headers: dict | None = None, timeout: int = 30):
        import requests
        return requests.patch(url, json=json, data=data, headers=headers, timeout=timeout)

    def put(self, url: str, *, json: Any = None, data: Any = None, headers: dict | None = None, timeout: int = 30):
        import requests
        return requests.put(url, json=json, data=data, headers=headers, timeout=timeout)

    def delete(self, url: str, *, headers: dict | None = None, timeout: int = 30):
        import requests
        return requests.delete(url, headers=headers, timeout=timeout)


class KeyValueStore(Protocol):
    def set(self, user_id: str, key: str, value): ...
    def get(self, user_id: str, key: str, default=None): ...
    def delete(self, user_id: str, key: str): ...
    def get_all_keys(self, user_id: str) -> list: ...
    def get_all_user_ids(self) -> list: ...
    def set_global(self, key: str, value) -> None: ...
    def get_global(self, key: str, default=None): ...
    def delete_global(self, key: str) -> None: ...
    def get_all_global_keys(self) -> list: ...
