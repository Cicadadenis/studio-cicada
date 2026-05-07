"""
Процесс-воркер для превью бота: сохраняет Runtime между запросами одной сессии.

Ожидает по stdin строки JSON (newline-delimited). Отвечает одной строкой JSON на запрос.

Формат запроса:
{
  "sessionId": "uuid",
  "code": "<полный DSL>",
  "chatId": 990000001,
  "text": "сообщение пользователя",
  "callbackData": null | "данные кнопки"
}

Формат ответа:
{ "ok": true, "outbound": [...] } | { "ok": false, "error": "..." }
"""

from __future__ import annotations

import json
import os
import sys
import traceback

from cicada.adapters.mock_telegram import MockTelegramAdapter
from cicada.executor import CicadaRuntimeError, Executor
from cicada.parser import Parser

from cicada.preview_helpers import (
    callback_update,
    dsl_code_hash,
    ensure_bot_line,
    message_update,
)


_sessions: dict[str, dict] = {}


def _build_update(req: dict):
    chat_id = int(req.get("chatId") or 990_000_001)
    cb = req.get("callbackData")
    if cb is not None and cb != "":
        return callback_update(str(cb), chat_id)
    text = req.get("text")
    if text is None:
        text = ""
    return message_update(str(text), chat_id)


def _handle(req: dict) -> dict:
    sid = str(req.get("sessionId") or "")
    code = req.get("code")
    if not sid:
        return {"ok": False, "error": "sessionId required"}
    if not isinstance(code, str):
        return {"ok": False, "error": "code required"}

    code_norm = ensure_bot_line(code)
    h = dsl_code_hash(code_norm)

    slot = _sessions.get(sid)
    if slot is None or slot.get("code_hash") != h:
        try:
            base = req.get("basePath")
            if isinstance(base, str) and base.strip():
                bp = base.strip()
            else:
                bp = os.getcwd()
            program = Parser(code_norm, bp).parse()
        except SyntaxError as e:
            return {"ok": False, "error": str(e)}
        except Exception as e:
            return {"ok": False, "error": f"parse: {e}"}

        tg = MockTelegramAdapter()
        try:
            exe = Executor(program, tg)
        except Exception as e:
            return {"ok": False, "error": f"executor: {e}"}
        _sessions[sid] = {"code_hash": h, "executor": exe, "tg": tg, "msg_seq": 1}
        slot = _sessions[sid]

    exe: Executor = slot["executor"]
    tg: MockTelegramAdapter = slot["tg"]
    tg.clear_outbound()

    try:
        msg_id = int(slot.get("msg_seq") or 1)
        up = _build_update(req)
        if "message" in up and up["message"]:
            up["message"]["message_id"] = msg_id
        slot["msg_seq"] = msg_id + 1
        exe.handle(up)
    except CicadaRuntimeError as e:
        return {"ok": False, "error": str(e), "outbound": list(tg.outbound)}
    except Exception as e:
        return {
            "ok": False,
            "error": str(e),
            "trace": traceback.format_exc()[-4000:],
            "outbound": list(tg.outbound),
        }

    return {"ok": True, "outbound": list(tg.outbound)}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            print(json.dumps({"ok": False, "error": f"json: {e}"}, ensure_ascii=False), flush=True)
            continue
        try:
            out = _handle(req)
        except Exception as e:
            out = {"ok": False, "error": str(e), "trace": traceback.format_exc()[-4000:]}
        print(json.dumps(out, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
