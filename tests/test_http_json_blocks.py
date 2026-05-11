import json

from cicada.adapters.mock_telegram import MockTelegramAdapter
from cicada.executor import Executor
from cicada.parser import Parser


class _Response:
    def __init__(self, text):
        self.text = text

    def json(self):
        return json.loads(self.text)


def _run_start(source):
    program = Parser(source).parse()
    tg = MockTelegramAdapter()
    Executor(program, tg).handle({
        "message": {
            "chat": {"id": 1},
            "from": {"id": 1, "first_name": "Ada"},
            "text": "/start",
        }
    })
    return tg


def test_fetch_json_result_passes_to_regular_block(monkeypatch):
    def fake_get(url, headers=None, timeout=None):
        assert url == "https://api.example.com/weather?q=Berlin"
        assert headers == {}
        assert timeout == 30
        return _Response('{"current": {"temp_c": 21}}')

    monkeypatch.setattr("cicada.executor.requests.get", fake_get)

    tg = _run_start("""
старт:
  запомни город = "Berlin"
  fetch_json "https://api.example.com/weather?q={город}" → weather
  использовать формат

блок формат:
  ответ "Температура: {weather['current']['temp_c']}"
""")

    assert tg.outbound[-1]["text"] == "Температура: 21"


def test_fetch_and_parse_json_result_can_be_returned_from_block(monkeypatch):
    def fake_get(url, headers=None, timeout=None):
        assert url == "https://api.example.com/news"
        return _Response('{"title": "Cicada ships JSON"}')

    monkeypatch.setattr("cicada.executor.requests.get", fake_get)

    tg = _run_start("""
старт:
  вызвать "получить_новость" → title
  ответ "Новость: {title}"

блок получить_новость:
  fetch "https://api.example.com/news" → raw
  разобрать_json raw → data
  вернуть data["title"]
""")

    assert tg.outbound[-1]["text"] == "Новость: Cicada ships JSON"


def test_http_post_renders_template_body(monkeypatch):
    seen = {}

    def fake_post(url, data=None, json=None, headers=None, timeout=None):
        seen.update({
            "url": url,
            "data": data,
            "json": json,
            "headers": headers,
            "timeout": timeout,
        })
        return _Response("ok")

    monkeypatch.setattr("cicada.executor.requests.post", fake_post)

    tg = _run_start("""
старт:
  запомни город = "Berlin"
  http_post "https://api.example.com/search" с "city={город}" → raw
  ответ "{raw}"
""")

    assert seen == {
        "url": "https://api.example.com/search",
        "data": "city=Berlin",
        "json": None,
        "headers": {},
        "timeout": 30,
    }
    assert tg.outbound[-1]["text"] == "ok"
