"""
Cicada Telegram Adapter — тонкая обёртка над Bot API.
"""

import requests


class TelegramAdapter:
    def __init__(self, token: str):
        self.base = f"https://api.telegram.org/bot{token}/"
        self._session = requests.Session()

    def call(self, method: str, data: dict = None) -> dict:
        payload = data or {}
        resp = self._session.post(self.base + method, json=payload, timeout=35)
        resp.raise_for_status()
        return resp.json()

    # ─────────────── polling ───────────────

    def get_updates(self, offset=None) -> dict:
        payload = {"timeout": 30}
        if offset is not None:
            payload["offset"] = offset
        return self.call("getUpdates", payload)

    # ─────────────── messages ───────────────

    def send_message(self, chat_id: int, text: str, **kwargs) -> dict:
        return self.call("sendMessage", {"chat_id": chat_id, "text": text, **kwargs})

    def send_buttons(self, chat_id: int, labels: list, text: str = None) -> dict:
        keyboard = {
            "inline_keyboard": [[{"text": lbl, "callback_data": lbl} for lbl in labels]]
        }
        return self.call("sendMessage", {
            "chat_id": chat_id,
            "text": text if text is not None else " ",
            "reply_markup": keyboard,
        })

    def send_buttons_matrix(self, chat_id: int, matrix: list, text: str = None) -> dict:
        keyboard = {
            "inline_keyboard": [
                [{"text": lbl, "callback_data": lbl} for lbl in row]
                for row in matrix
            ]
        }
        return self.call("sendMessage", {
            "chat_id": chat_id,
            "text": text if text is not None else " ",
            "reply_markup": keyboard,
        })

    def set_my_commands(self, commands: list) -> dict:
        """Устанавливает команды меню бота (которые появляются при вводе /)"""
        # Преобразуем список команд в формат API
        api_commands = []
        for cmd in commands:
            if isinstance(cmd, dict):
                api_commands.append({
                    "command": cmd["command"].lstrip("/"),
                    "description": cmd["description"]
                })
        return self.call("setMyCommands", {"commands": api_commands})

    def send_inline_button(self, chat_id: int, text: str, callback: str = "", url: str = "", message: str = "Нажмите:") -> dict:
        """Отправляет одну inline кнопку с callback_data или URL"""
        button = {"text": text}
        if url:
            button["url"] = url
        elif callback:
            button["callback_data"] = callback
        else:
            button["callback_data"] = text
        
        keyboard = {"inline_keyboard": [[button]]}
        return self.call("sendMessage", {
            "chat_id": chat_id,
            "text": message,
            "reply_markup": keyboard,
        })

    def send_inline_keyboard(self, chat_id: int, keyboard: list, text: str = "​") -> dict:
        """
        Отправляет сообщение с inline-клавиатурой (матрица кнопок).

        keyboard — список рядов, каждый ряд список словарей:
            [
                [{"text": "Да",     "callback_data": "cb_yes"},
                 {"text": "Нет",    "callback_data": "cb_no"}],
                [{"text": "Отмена", "callback_data": "cb_cancel"}],
            ]
        """
        # Telegram требует непустой text — защита от пустой строки
        if not text or not text.strip():
            text = "\u200b"
        return self.call("sendMessage", {
            "chat_id": chat_id,
            "text": text,
            "reply_markup": {"inline_keyboard": keyboard},
        })

    # ─────────────── file resolution ───────────────

    @staticmethod
    def _is_url(s: str) -> bool:
        return s.startswith("http://") or s.startswith("https://")

    @staticmethod
    def _is_local(s: str) -> bool:
        import os
        return s.startswith("/") or s.startswith("./") or s.startswith("../") or os.path.exists(s)

    def _send_media(self, method: str, field: str, chat_id: int, file: str, caption: str = "") -> dict:
        """Универсальная отправка медиа.

        file может быть:
          - URL          (http/https)  → передаётся как строка в JSON
          - file_id      (строка)      → передаётся как строка в JSON
          - локальный путь             → отправляется multipart/form-data
        """
        import os
        if self._is_url(file) or (not self._is_local(file)):
            # URL или file_id — передаём напрямую
            return self.call(method, {
                "chat_id": chat_id,
                field: file,
                "caption": caption,
            })
        # Локальный файл
        with open(file, "rb") as f:
            resp = self._session.post(
                self.base + method,
                data={"chat_id": chat_id, "caption": caption},
                files={field: (os.path.basename(file), f)},
                timeout=60,
            )
        resp.raise_for_status()
        return resp.json()

    # ─────────────── media ───────────────

    def send_photo(self, chat_id: int, file: str, caption: str = "") -> dict:
        """file — URL, file_id или локальный путь к изображению"""
        return self._send_media("sendPhoto", "photo", chat_id, file, caption)

    def send_document(self, chat_id: int, file: str, caption: str = "") -> dict:
        """file — URL, file_id или локальный путь"""
        return self._send_media("sendDocument", "document", chat_id, file, caption)

    def send_audio(self, chat_id: int, file: str, caption: str = "") -> dict:
        """file — URL, file_id или локальный путь"""
        return self._send_media("sendAudio", "audio", chat_id, file, caption)

    def send_video(self, chat_id: int, file: str, caption: str = "") -> dict:
        """file — URL, file_id или локальный путь"""
        return self._send_media("sendVideo", "video", chat_id, file, caption)

    def send_voice(self, chat_id: int, file: str, caption: str = "") -> dict:
        """file — URL, file_id или локальный путь"""
        return self._send_media("sendVoice", "voice", chat_id, file, caption)

    def send_sticker(self, chat_id: int, file_id: str) -> dict:
        return self.call("sendSticker", {"chat_id": chat_id, "sticker": file_id})

    def answer_callback(self, callback_query_id: str, text: str = "") -> dict:
        return self.call("answerCallbackQuery", {
            "callback_query_id": callback_query_id,
            "text": text,
        })

    # ─────────────── markdown ───────────────

    def send_markdown(self, chat_id: int, text: str) -> dict:
        return self.call("sendMessage", {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "Markdown",
        })

        # ─────────────── location & contact ───────────────

    def send_location(self, chat_id: int, latitude: float, longitude: float) -> dict:
        return self.call("sendLocation", {
            "chat_id": chat_id,
            "latitude": latitude,
            "longitude": longitude,
        })

    def send_contact(self, chat_id: int, phone: str, name: str) -> dict:
        parts = name.strip().split(" ", 1)
        return self.call("sendContact", {
            "chat_id": chat_id,
            "phone_number": phone,
            "first_name": parts[0],
            "last_name": parts[1] if len(parts) > 1 else "",
        })

    # ─────────────── poll ───────────────

    def send_poll(self, chat_id: int, question: str, options: list,
                  is_anonymous: bool = True) -> dict:
        return self.call("sendPoll", {
            "chat_id": chat_id,
            "question": question,
            "options": options,
            "is_anonymous": is_anonymous,
        })

    # ─────────────── invoice ───────────────

    def send_invoice(self, chat_id: int, title: str, description: str,
                     amount: int, currency: str = "RUB",
                     provider_token: str = "") -> dict:
        """amount в копейках/центах (100 = 1 руб)"""
        return self.call("sendInvoice", {
            "chat_id": chat_id,
            "title": title,
            "description": description,
            "payload": "cicada_payment",
            "provider_token": provider_token,
            "currency": currency,
            "prices": [{"label": title, "amount": amount * 100}],
        })

    # ─────────────── game ───────────────

    def send_game(self, chat_id: int, game_short_name: str) -> dict:
        return self.call("sendGame", {
            "chat_id": chat_id,
            "game_short_name": game_short_name,
        })

    # ─────────────── chat membership ───────────────

    def get_chat_member(self, chat_id, user_id: int) -> dict:
        """Возвращает объект ChatMember для пользователя в чате/канале.

        Поле .status: "creator" | "administrator" | "member" |
                      "restricted" | "left" | "kicked"
        """
        return self.call("getChatMember", {"chat_id": chat_id, "user_id": user_id})

    def forward_message(self, to_chat_id, from_chat_id, message_id: int) -> dict:
        """Пересылает сообщение из from_chat_id в to_chat_id."""
        return self.call("forwardMessage", {
            "chat_id": to_chat_id,
            "from_chat_id": from_chat_id,
            "message_id": message_id,
        })

    def get_user_profile_photos(self, user_id: int, limit: int = 1) -> dict:
        """Возвращает фотографии профиля пользователя."""
        return self.call("getUserProfilePhotos", {"user_id": user_id, "limit": limit})

    # ─────────────── file download ───────────────

    def get_file_url(self, file_id: str) -> str:
        """Получить прямую ссылку на файл по file_id"""
        result = self.call("getFile", {"file_id": file_id})
        file_path = result["result"]["file_path"]
        token = self.base.split("/bot")[1].rstrip("/")
        return f"https://api.telegram.org/file/bot{token}/{file_path}"

    def download_file(self, file_id: str, save_path: str) -> str:
        """Скачать файл по file_id, сохранить локально"""
        url = self.get_file_url(file_id)
        resp = self._session.get(url, timeout=60)
        resp.raise_for_status()
        with open(save_path, "wb") as f:
            f.write(resp.content)
        return save_path
