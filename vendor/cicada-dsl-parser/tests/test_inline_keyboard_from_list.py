import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from cicada.parser import Parser, InlineKeyboardFromList
from cicada.executor import Executor


class _TG:
    def __init__(self):
        self.inline_calls = []

    def send_inline_keyboard(self, chat_id, keyboard, text=""):
        self.inline_calls.append((chat_id, keyboard, text))


class _Ctx(dict):
    def __init__(self, data=None):
        super().__init__(data or {})
        self.chat_id = 42
        self._pending_message = None

    def get(self, k, d=None):
        return super().get(k, d)

    def set(self, k, v):
        self[k] = v


def test_dynamic_inline_keyboard_with_back_button():
    program = Parser('''
старт:
  inline-кнопки: из товары по name/id callback=товар_ columns=2 append_back=true
''').parse()

    stmt = program.handlers[0].body[0]
    assert isinstance(stmt, InlineKeyboardFromList)

    tg = _TG()
    ex = Executor(program, tg)
    ctx = _Ctx({
        "товары": [
            {"id": 1, "name": "Товар 1"},
            {"id": 2, "name": "Товар 2"},
            {"id": 3, "name": "Товар 3"},
        ]
    })

    ex._exec_inline_keyboard_from_list(stmt, ctx)

    assert len(tg.inline_calls) == 1
    _, keyboard, _ = tg.inline_calls[0]
    assert keyboard[0][0]["callback_data"] == "товар_1"
    assert keyboard[0][1]["callback_data"] == "товар_2"
    assert keyboard[1][0]["callback_data"] == "товар_3"
    assert keyboard[-1][0]["text"] == "🔙 Назад"
    assert keyboard[-1][0]["callback_data"] == "back"
