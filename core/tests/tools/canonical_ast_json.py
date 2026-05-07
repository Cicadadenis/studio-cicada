"""
Детерминированная сериализация AST (и любого JSON-совместимого дерева) в текст UTF-8.

Правила (канон):
  - json.dumps(..., sort_keys=True, indent=2, ensure_ascii=False)
  - завершающий символ новой строки \\n

Одинаковое дерево → одинаковые байты строки → хеши, кеш, диффы в git.
"""
from __future__ import annotations

import json
from typing import Any


def dumps_canonical(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
