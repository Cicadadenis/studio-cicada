"""Одноразовый превью-шаг (CLI / отладка) без сохранения сессии."""

from __future__ import annotations

import json
import os
import sys
import traceback

from cicada.adapters.mock_telegram import MockTelegramAdapter
from cicada.executor import CicadaRuntimeError, Executor
from cicada.parser import Parser

from cicada.preview_helpers import callback_update, ensure_bot_line, message_update


def run_preview_turn(
    code: str,
    *,
    text: str = "",
    callback_data: str | None = None,
    chat_id: int = 990_000_001,
    base_path: str | None = None,
) -> dict:
    code_norm = ensure_bot_line(code)
    bp = base_path.strip() if isinstance(base_path, str) and base_path.strip() else os.getcwd()

    try:
        program = Parser(code_norm, bp).parse()
    except SyntaxError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        return {"ok": False, "error": f"parse: {e}"}

    tg = MockTelegramAdapter()
    try:
        exe = Executor(program, tg)
        if callback_data is not None and callback_data != "":
            exe.handle(callback_update(str(callback_data), int(chat_id)))
        else:
            exe.handle(message_update(str(text), int(chat_id)))
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
    req = json.load(sys.stdin)
    code = req.get("code", "")
    out = run_preview_turn(
        code,
        text=str(req.get("text") or ""),
        callback_data=req.get("callbackData"),
        chat_id=int(req.get("chatId") or 990_000_001),
        base_path=req.get("basePath"),
    )
    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
