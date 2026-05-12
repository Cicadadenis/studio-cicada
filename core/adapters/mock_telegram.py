"""
Mock Telegram API — записывает исходящие действия для превью в Studio.
"""


class MockTelegramAdapter:
    """Совместим с вызовами Executor; не выполняет сетевые запросы."""

    def __init__(self):
        self.outbound = []

    def clear_outbound(self):
        self.outbound = []

    def _emit(self, kind: str, **fields):
        self.outbound.append({"type": kind, **fields})

    def call(self, method: str, data: dict = None):
        payload = data or {}
        self._emit("api_call", method=method, params=payload.copy() if isinstance(payload, dict) else payload)
        if method == "getMe":
            return {"ok": True, "result": {"id": 0, "is_bot": True, "first_name": "Preview", "username": "preview_bot"}}
        return {"ok": True, "result": {}}

    def get_updates(self, offset=None) -> dict:
        return {"ok": True, "result": []}

    def send_message(self, chat_id: int, text: str, **kwargs) -> dict:
        extra = {k: v for k, v in kwargs.items() if v is not None}
        self._emit("send_message", chat_id=chat_id, text=text or "", **extra)
        return {"ok": True, "result": {"message_id": len(self.outbound)}}

    def send_buttons(self, chat_id: int, labels: list, text: str = None) -> dict:
        matrix = [[lbl] for lbl in labels]
        return self.send_buttons_matrix(chat_id, matrix, text=text)

    def send_buttons_matrix(self, chat_id: int, matrix: list, text: str = None) -> dict:
        rows = []
        for row in matrix:
            row_out = []
            for lbl in row:
                cb = lbl if isinstance(lbl, str) else str(lbl)
                row_out.append({"text": cb, "callback_data": cb})
            rows.append(row_out)
        t = text if text is not None else ""
        self._emit("reply_keyboard", chat_id=chat_id, text=t, keyboard=matrix)
        return {"ok": True, "result": {"message_id": len(self.outbound)}}

    def set_my_commands(self, commands: list) -> dict:
        self._emit("set_commands", commands=list(commands) if commands else [])
        return {"ok": True, "result": True}

    def send_inline_button(self, chat_id: int, text: str, callback: str = "", url: str = "",
                           message: str = "Нажмите:") -> dict:
        self._emit("inline_single", chat_id=chat_id, button_text=text, callback=callback, url=url, message=message)
        return {"ok": True, "result": {}}

    def send_inline_keyboard(self, chat_id: int, keyboard: list, text: str = "\u200b") -> dict:
        if not text or not text.strip():
            text = "\u200b"
        flat = []
        for row in keyboard or []:
            r = []
            for btn in row or []:
                if isinstance(btn, dict):
                    r.append({
                        "text": btn.get("text", ""),
                        "callback_data": btn.get("callback_data"),
                        "url": btn.get("url"),
                    })
            flat.append(r)
        self._emit("inline_keyboard", chat_id=chat_id, text=text, keyboard=flat)
        return {"ok": True, "result": {}}

    def send_photo(self, chat_id: int, file: str, caption: str = "") -> dict:
        self._emit("photo", chat_id=chat_id, source=str(file), caption=caption or "")
        return {"ok": True, "result": {}}

    def send_document(self, chat_id: int, file: str, caption: str = "") -> dict:
        self._emit("document", chat_id=chat_id, path=str(file), caption=caption or "")
        return {"ok": True, "result": {}}

    def send_audio(self, chat_id: int, file: str, caption: str = "") -> dict:
        self._emit("audio", chat_id=chat_id, path=str(file), caption=caption or "")
        return {"ok": True, "result": {}}

    def send_video(self, chat_id: int, file: str, caption: str = "") -> dict:
        self._emit("video", chat_id=chat_id, path=str(file), caption=caption or "")
        return {"ok": True, "result": {}}

    def send_voice(self, chat_id: int, file: str, caption: str = "") -> dict:
        self._emit("voice", chat_id=chat_id, path=str(file), caption=caption or "")
        return {"ok": True, "result": {}}

    def send_sticker(self, chat_id: int, file_id: str) -> dict:
        self._emit("sticker", chat_id=chat_id, file_id=str(file_id))
        return {"ok": True, "result": {}}

    def answer_callback(self, callback_query_id: str, text: str = "") -> dict:
        self._emit("answer_callback", callback_query_id=callback_query_id, text=text or "")
        return {"ok": True, "result": True}

    def send_markdown(self, chat_id: int, text: str) -> dict:
        self._emit("markdown", chat_id=chat_id, text=text or "")
        return {"ok": True, "result": {}}

    def send_html(self, chat_id: int, text: str) -> dict:
        self._emit("html", chat_id=chat_id, text=text or "")
        return {"ok": True, "result": {}}

    def send_markdown_v2(self, chat_id: int, text: str) -> dict:
        self._emit("markdown_v2", chat_id=chat_id, text=text or "")
        return {"ok": True, "result": {}}

    def send_location(self, chat_id: int, latitude: float, longitude: float) -> dict:
        self._emit("location", chat_id=chat_id, latitude=float(latitude), longitude=float(longitude))
        return {"ok": True, "result": {}}

    def send_contact(self, chat_id: int, phone: str, name: str) -> dict:
        self._emit("contact", chat_id=chat_id, phone=str(phone), name=str(name))
        return {"ok": True, "result": {}}

    def send_poll(self, chat_id: int, question: str, options: list, is_anonymous: bool = True) -> dict:
        self._emit("poll", chat_id=chat_id, question=str(question),
                   options=list(options or []), is_anonymous=is_anonymous)
        return {"ok": True, "result": {}}

    def send_invoice(self, chat_id: int, title: str, description: str,
                     amount: int, currency: str = "RUB", provider_token: str = "") -> dict:
        self._emit("invoice", chat_id=chat_id, title=title, description=description,
                   amount=int(amount), currency=currency)
        return {"ok": True, "result": {}}

    def send_game(self, chat_id: int, game_short_name: str) -> dict:
        self._emit("game", chat_id=chat_id, short_name=str(game_short_name))
        return {"ok": True, "result": {}}

    def get_chat_member(self, chat_id, user_id: int) -> dict:
        self._emit("get_chat_member", chat_id=str(chat_id), user_id=int(user_id))
        return {"ok": True, "result": {"status": "member", "user": {"id": int(user_id)}}}

    def forward_message(self, to_chat_id, from_chat_id, message_id: int) -> dict:
        self._emit("forward", to_chat_id=int(to_chat_id), from_chat_id=int(from_chat_id), message_id=int(message_id))
        return {"ok": True, "result": {}}

    def get_user_profile_photos(self, user_id: int, limit: int = 1) -> dict:
        self._emit("profile_photos", user_id=int(user_id))
        return {"ok": True, "result": {"total_count": 0, "photos": []}}

    def get_file_url(self, file_id: str) -> str:
        return f"preview://file/{file_id}"

    def download_file(self, file_id: str, save_path: str) -> str:
        import os
        self._emit("download_file_stub", file_id=str(file_id), save_path=str(save_path))
        d = os.path.dirname(save_path)
        if d:
            os.makedirs(d, exist_ok=True)
        with open(save_path, "wb") as f:
            f.write(b"")
        return save_path
