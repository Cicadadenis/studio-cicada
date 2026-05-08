"""
Cicada Executor — обходит AST и вызывает Telegram API.

Архитектура: dispatch-таблица вместо if/elif цепочки.
Каждая инструкция — отдельный метод _exec_<тип>.
"""

import time
import json as _json
import datetime as _dt
import os as _os
import requests

from cicada.parser import (
    Program, Handler, Reply, RandomReply, SwitchStmt, Ask, Remember, If,
    parse_condition,
    Buttons, InlineButton, InlineKeyboard, Photo, PhotoVar, Sticker,
    GlobalVar,
    StartScenario, Step,
    Condition, VarRef, FunctionCall, ComplexCondition,
    ForwardPhoto, SaveFile,
    SendDocument, SendAudio, SendVideo, SendVoice,
    SendLocation, SendContact, SendPoll, SendInvoice,
    SendGame, SendMarkdown, DownloadFile,
    EndScenario, ReturnFromScenario, RepeatStep, GotoStep,
    SaveToDB, LoadFromDB,
    HttpGet, HttpPost,
    Log, Sleep,
    TelegramAPI,
    UseBlock,
    # Expression AST
    Literal, Variable, BinaryOp, UnaryOp, Call,
    # Составные типы и коллекции
    ListLiteral, DictLiteral, Index, Attr, ForEach,
    # Новые узлы ядра v2
    WhileLoop, BreakLoop, ContinueLoop, Timeout,
    Notify, Broadcast,
    CheckSubscription, GetChatMemberRole, ForwardMsg,
    LoadJson, SaveJson, DeleteFile, DeleteDictKey, SetDictKey,
    HttpPatch, HttpPut, HttpDelete, SetHttpHeaders,
    DeleteFromDB, GetAllDBKeys, SaveGlobalDB, LoadFromUserDB,
    ReturnValue, CallBlock,
)
from cicada.database import get_db
from cicada.runtime import Runtime


# ══════════════════════════════════════════════════════════════════
#  Сигналы управления циклом
# ══════════════════════════════════════════════════════════════════

class _BreakSignal(Exception):
    """Сигнал прерывания цикла (прервать)"""


class _ContinueSignal(Exception):
    """Сигнал продолжения следующей итерации (продолжить)"""


# ══════════════════════════════════════════════════════════════════
#  Исключения с контекстом сценария/шага/строки  (п. 4)
# ══════════════════════════════════════════════════════════════════

class CicadaRuntimeError(Exception):
    """Ошибка времени выполнения с контекстом"""
    def __init__(self, message: str, stmt=None,
                 scenario: str = None, step_name: str = None, line: int = None):
        self.stmt      = stmt
        self.scenario  = scenario
        self.step_name = step_name
        self.line      = line
        super().__init__(self._format(message))

    def _format(self, msg: str) -> str:
        parts = [msg]
        if self.scenario:
            parts.append(f"Сценарий: {self.scenario}")
        if self.step_name:
            parts.append(f"Шаг: {self.step_name}")
        if self.line is not None:
            parts.append(f"Строка: {self.line}")
        return "\n".join(parts)


class CicadaUndefinedVariable(CicadaRuntimeError):
    """Обращение к несуществующей переменной"""
    pass


class CicadaTypeError(CicadaRuntimeError):
    """Несовместимые типы в операции"""
    pass


class CicadaIndexError(CicadaRuntimeError):
    """Выход за пределы списка или несуществующий ключ"""
    pass


# ══════════════════════════════════════════════════════════════════
#  Система типов
# ══════════════════════════════════════════════════════════════════

_NUMERIC        = (int, float)
_ARITHMETIC_OPS = {"-", "*", "/", "//", "%", "**"}
_COMPARE_OPS    = {">", "<", ">=", "<="}


def _cicada_type(val) -> str:
    """Имя типа для сообщений об ошибках."""
    if isinstance(val, bool):   return "логический"
    if isinstance(val, int):    return "целое"
    if isinstance(val, float):  return "дробное"
    if isinstance(val, str):    return "строка"
    if val is None:             return "пусто"
    if isinstance(val, list):   return "список"
    if isinstance(val, dict):   return "объект"
    return type(val).__name__


def _truthy(val) -> bool:
    """
    Единое правило истинности в Cicada:
      False  ->  None, "", 0, 0.0, False, [], {}
      True   ->  всё остальное
    """
    if val is None:               return False
    if val is False:              return False
    if isinstance(val, bool):     return val
    if isinstance(val, _NUMERIC): return val != 0
    if isinstance(val, str):      return val != ""
    if isinstance(val, list):     return len(val) > 0
    if isinstance(val, dict):     return len(val) > 0
    return True


def _to_number(val, op: str, side: str):
    if isinstance(val, bool):
        raise CicadaTypeError(
            f"Операция '{op}': ожидается число, получен логический ({val!r}).\n"
            f"Используйте в_число(переменная) для явного преобразования."
        )
    if isinstance(val, _NUMERIC):
        return float(val)
    if isinstance(val, str):
        try:
            return float(val)
        except ValueError:
            raise CicadaTypeError(
                f"Операция '{op}': {side} — строка {val!r}, не является числом.\n"
                f"Используйте в_число(переменная) для проверки перед операцией."
            )
    raise CicadaTypeError(
        f"Операция '{op}': {side} имеет тип '{_cicada_type(val)}', ожидается число."
    )


def _coerce_numeric(left, right, op: str):
    l = _to_number(left,  op, "левый операнд")
    r = _to_number(right, op, "правый операнд")
    return l, r


# ══════════════════════════════════════════════════════════════════
#  п. 6 — Реестр пользовательских функций (плагины / cicada install)
# ══════════════════════════════════════════════════════════════════

_USER_FUNCS: dict = {}   # name -> callable(args: list) -> value


def register_func(name: str, fn) -> None:
    """
    Регистрирует пользовательскую функцию, доступную в DSL.

    Пример:
        from cicada.executor import register_func

        def my_discount(args):
            price, pct = float(args[0]), float(args[1])
            return price * (1 - pct / 100)

        register_func("скидка", my_discount)

    После этого в Cicada-сценарии:
        запомни итог = скидка(цена, 10)
    """
    _USER_FUNCS[name] = fn


# ══════════════════════════════════════════════════════════════════
#  Call sandbox
# ══════════════════════════════════════════════════════════════════

_BUILTIN_FUNCS = {
    # строковые
    "содержит", "длина", "начинается_с", "верхний", "нижний",
    "обрезать", "разделить", "соединить",
    # новые строковые
    "заменить", "найти", "срез",
    # типизация
    "число", "тип",
    # явные преобразования
    "в_число", "в_строку", "в_булево",
    # арифметика
    "округлить", "абс", "мин", "макс",
    # случайные числа
    "случайное_число",
    # списки/объекты
    "длина_списка", "добавить", "содержит_элемент", "ключи", "значения", "удалить_ключ",
    # дата/время
    "формат_даты",
    # JSON
    "разобрать_json", "в_json",
}

_FORBIDDEN_FUNCS = {
    "exec", "eval", "compile", "open", "import",
    "__import__", "getattr", "setattr", "delattr",
}


# ══════════════════════════════════════════════════════════════════
#  Expression Engine
# ══════════════════════════════════════════════════════════════════

def eval_expr(node, ctx, strict: bool = True):
    """Вычисляет узел Expression AST в контексте ctx."""

    if isinstance(node, Literal):
        return node.value

    if isinstance(node, Variable):
        return _get_var(node.name, ctx, strict)

    # п. 1 — составные типы
    if isinstance(node, ListLiteral):
        return [eval_expr(item, ctx, strict) for item in node.items]

    if isinstance(node, DictLiteral):
        return {k: eval_expr(v, ctx, strict) for k, v in node.pairs}

    if isinstance(node, Index):
        target = eval_expr(node.target, ctx, strict)
        key    = eval_expr(node.key,    ctx, strict)
        return _eval_index(target, key)

    if isinstance(node, Attr):
        target = eval_expr(node.target, ctx, strict)
        return _eval_attr(target, node.name)

    if isinstance(node, BinaryOp):
        return _eval_binop(node, ctx, strict)

    if isinstance(node, UnaryOp):
        val = eval_expr(node.operand, ctx, strict)
        if node.op == "не":
            return not _truthy(val)
        if node.op == "-":
            n = _to_number(val, "унарный -", "операнд")
            return -n
        raise CicadaRuntimeError(f"Неизвестный унарный оператор: {node.op!r}")

    if isinstance(node, Call):
        return _eval_call(node, ctx, strict)

    # обратная совместимость
    if isinstance(node, VarRef):
        return _get_var(node.name, ctx, strict)

    if isinstance(node, FunctionCall):
        args = [eval_expr(a, ctx, strict) for a in node.args]
        return _call_builtin(node.name, args)

    if isinstance(node, Condition):
        return _eval_legacy_condition(node, ctx, strict)

    if isinstance(node, ComplexCondition):
        return _eval_legacy_complex(node, ctx, strict)

    if isinstance(node, (str, int, float, bool)):
        return node
    if isinstance(node, (list, dict)):
        return node
    if node is None:
        return None

    raise CicadaRuntimeError(f"Неизвестный тип узла: {type(node).__name__}")


def _eval_index(target, key):
    """список[0] или объект["ключ"] с понятными ошибками."""
    if isinstance(target, list):
        if not isinstance(key, _NUMERIC) or isinstance(key, bool):
            raise CicadaTypeError(
                f"Индекс списка должен быть числом, получен {_cicada_type(key)} ({key!r})."
            )
        idx = int(key)
        if idx < 0 or idx >= len(target):
            raise CicadaIndexError(
                f"Индекс {idx} вне диапазона списка (длина {len(target)}).\n"
                f"         {'~'} ожидалось 0..{len(target)-1}"
            )
        return target[idx]

    if isinstance(target, dict):
        str_key = str(key)
        if str_key not in target:
            available = ", ".join(f'"{k}"' for k in target.keys())
            raise CicadaIndexError(
                f"Ключ {str_key!r} не найден в объекте.\n"
                f"Доступные ключи: {available}"
            )
        return target[str_key]

    raise CicadaTypeError(
        f"Индексирование недоступно для типа '{_cicada_type(target)}'."
    )


def _eval_attr(target, name: str):
    """объект.поле — синтаксический сахар над dict-доступом."""
    if isinstance(target, dict):
        if name not in target:
            available = ", ".join(target.keys())
            raise CicadaIndexError(
                f"Поле '{name}' не найдено в объекте.\n"
                f"Доступные поля: {available}"
            )
        return target[name]
    raise CicadaTypeError(
        f"Доступ к полю '{name}' недоступен для типа '{_cicada_type(target)}'."
    )


def _normalize_var_name(name: str) -> str:
    """Возвращает имя переменной без шаблонных обёрток.

    Старый парсер условий иногда отдаёт VarRef с исходным фрагментом
    вроде ``{логин}`` (или с пробелами/кавычками вокруг него). В строгом
    режиме это приводило к ошибке "Переменная '{логин}' не определена",
    хотя в контексте уже была переменная ``логин``. Нормализуем имя перед
    поиском, чтобы шаблонный синтаксис работал одинаково в условиях,
    ответах и выражениях.
    """
    if not isinstance(name, str):
        return name

    normalized = name.strip()

    # Допускаем одинарные/двойные кавычки вокруг шаблонного имени, которые
    # могут остаться после legacy fallback: "{логин}" -> логин.
    if len(normalized) >= 2 and normalized[0] == normalized[-1] and normalized[0] in ("'", '"'):
        inner = normalized[1:-1].strip()
        if inner.startswith("{") and inner.endswith("}"):
            normalized = inner

    # Поддерживаем шаблонный синтаксис {переменная} в выражениях
    # (например, если {логин} == "admin":). Делаем это в цикле, чтобы
    # безопасно обработать двойную обёртку вида {{логин}}.
    while len(normalized) >= 3 and normalized.startswith("{") and normalized.endswith("}"):
        inner = normalized[1:-1].strip()
        if inner == normalized:
            break
        normalized = inner

    return normalized


def _get_var(name: str, ctx, strict: bool):
    name = _normalize_var_name(name)

    # Встроенные динамические переменные
    if name == "текущая_дата":
        return _dt.datetime.now().strftime("%d.%m.%Y")
    if name == "текущее_время":
        return _dt.datetime.now().strftime("%H:%M:%S")
    if name == "текущий_timestamp":
        return int(_dt.datetime.now().timestamp())

    val = ctx.get(name)
    if name in ctx.vars or name in ctx._globals:
        return val
    if name.startswith("пользователь.") or name.startswith("чат."):
        return val

    # Доступ через точку для пользовательских переменных: объект.поле
    if "." in name:
        parts = name.split(".", 1)
        obj_name, prop = parts
        obj = ctx.get(obj_name)
        if isinstance(obj, dict):
            if prop == "ключи":
                return list(obj.keys())
            if prop == "значения":
                return list(obj.values())
            if prop == "длина":
                return len(obj)
            if prop in obj:
                return obj[prop]
        if isinstance(obj, list):
            if prop == "длина":
                return len(obj)
        if obj is not None:
            return obj  # объект не dict — вернём как есть
        # не нашли объект — упадём ниже на strict-проверку

    if strict:
        available = ", ".join(sorted(ctx.vars.keys())) or "(нет переменных)"
        raise CicadaUndefinedVariable(
            f"Переменная '{name}' не определена.\n"
            f"Доступные: {available}"
        )
    return ""


def _eval_binop(node: BinaryOp, ctx, strict: bool):
    op = node.op

    if op == "или":
        left = eval_expr(node.left, ctx, strict)
        return left if _truthy(left) else eval_expr(node.right, ctx, strict)
    if op == "и":
        left = eval_expr(node.left, ctx, strict)
        return left if not _truthy(left) else eval_expr(node.right, ctx, strict)

    left  = eval_expr(node.left,  ctx, strict)
    right = eval_expr(node.right, ctx, strict)

    if op == "+":
        if isinstance(left, bool) or isinstance(right, bool):
            raise CicadaTypeError(
                f"Операция '+': нельзя складывать логическое значение.\n"
                f"Получено: {left!r} + {right!r}"
            )
        if isinstance(left, _NUMERIC) and isinstance(right, _NUMERIC):
            return left + right
        if isinstance(left, str) or isinstance(right, str):
            l_str = "" if left  is None else str(left)
            r_str = "" if right is None else str(right)
            return l_str + r_str
        if isinstance(left, _NUMERIC) and isinstance(right, str):
            try:    return left + float(right)
            except ValueError: return str(left) + right
        if isinstance(left, str) and isinstance(right, _NUMERIC):
            try:    return float(left) + right
            except ValueError: return left + str(right)
        return str(left) + str(right)

    if op == "содержит":
        return str(right).lower() in str(left).lower()
    if op == "начинается_с":
        return str(left).lower().startswith(str(right).lower())
    if op == "в":
        if isinstance(right, dict):
            return str(left) in right
        if isinstance(right, (list, str)):
            return left in right
        raise CicadaTypeError(
            f"Оператор 'в': ожидается список, объект или строка, "
            f"получен '{_cicada_type(right)}'."
        )

    if op == "==":
        return _cicada_eq(left, right)
    if op == "!=":
        return not _cicada_eq(left, right)

    if op in _ARITHMETIC_OPS:
        l, r = _coerce_numeric(left, right, op)
        if op == "-":  return l - r
        if op == "*":  return l * r
        if op == "/":
            if r == 0: raise CicadaRuntimeError("Деление на ноль")
            return l / r
        if op == "//":
            if r == 0: raise CicadaRuntimeError("Целочисленное деление на ноль")
            return int(l // r)
        if op == "%":  return l % r
        if op == "**": return l ** r

    if op in _COMPARE_OPS:
        l, r = _coerce_numeric(left, right, op)
        if op == ">":  return l > r
        if op == "<":  return l < r
        if op == ">=": return l >= r
        if op == "<=": return l <= r

    raise CicadaRuntimeError(f"Неизвестный оператор: {op!r}")


def _cicada_eq(left, right) -> bool:
    if left is None and right is None:  return True
    if left is None or right is None:   return False
    if isinstance(left, _NUMERIC) and not isinstance(left, bool) \
       and isinstance(right, _NUMERIC) and not isinstance(right, bool):
        return left == right
    if isinstance(left, _NUMERIC) and isinstance(right, str):
        try:   return float(left) == float(right)
        except ValueError: return False
    if isinstance(left, str) and isinstance(right, _NUMERIC):
        try:   return float(left) == float(right)
        except ValueError: return False
    return str(left).lower() == str(right).lower()


def _eval_call(node: Call, ctx, strict: bool):
    """
    Порядок поиска (п. 6):
      1. _FORBIDDEN_FUNCS  — немедленная ошибка
      2. _BUILTIN_FUNCS    — встроенные
      3. _USER_FUNCS       — пользовательские (плагины)
      4. ошибка
    """
    name = node.name

    if name in _FORBIDDEN_FUNCS:
        raise CicadaRuntimeError(
            f"Функция '{name}' запрещена по соображениям безопасности."
        )

    args = [eval_expr(a, ctx, strict) for a in node.args]

    if name in _BUILTIN_FUNCS:
        return _call_builtin(name, args)

    if name in _USER_FUNCS:
        try:
            return _USER_FUNCS[name](args)
        except CicadaRuntimeError:
            raise
        except Exception as e:
            raise CicadaRuntimeError(
                f"Ошибка в пользовательской функции '{name}': {e}"
            )

    available_all = sorted(_BUILTIN_FUNCS | set(_USER_FUNCS.keys()))
    raise CicadaRuntimeError(
        f"Неизвестная функция '{name}'.\n"
        f"Доступные: {', '.join(available_all)}"
    )


def _call_builtin(name: str, args: list):
    """Реализация встроенных функций."""

    # строковые
    if name == "содержит":
        return len(args) >= 2 and str(args[1]).lower() in str(args[0]).lower()
    if name == "длина":
        v = args[0] if args else ""
        return len(v) if isinstance(v, (str, list, dict)) else len(str(v))
    if name == "начинается_с":
        return len(args) >= 2 and str(args[0]).lower().startswith(str(args[1]).lower())
    if name == "верхний":
        return str(args[0]).upper() if args else ""
    if name == "нижний":
        return str(args[0]).lower() if args else ""
    if name == "обрезать":
        return str(args[0]).strip() if args else ""
    if name == "разделить":
        s   = str(args[0]) if args else ""
        sep = str(args[1]) if len(args) > 1 else " "
        return s.split(sep)
    if name == "соединить":
        sep   = str(args[0]) if args else ""
        items = args[1] if len(args) > 1 else []
        return sep.join(str(i) for i in (items if isinstance(items, list) else [items]))

    # типизация — старые
    if name == "число":
        try:   float(str(args[0])); return True
        except (ValueError, IndexError): return False
    if name == "тип":
        return _cicada_type(args[0]) if args else "пусто"

    # п. 3: явные функции преобразования
    if name == "в_число":
        if not args:
            raise CicadaTypeError("в_число(): нужен хотя бы один аргумент.")
        v = args[0]
        if isinstance(v, bool):     return 1 if v else 0
        if isinstance(v, _NUMERIC): return float(v)
        if isinstance(v, str):
            try:    return float(v)
            except ValueError:
                raise CicadaTypeError(
                    f"в_число(): не удаётся преобразовать {v!r} в число."
                )
        raise CicadaTypeError(
            f"в_число(): тип '{_cicada_type(v)}' не поддерживается."
        )

    if name == "в_строку":
        if not args: return ""
        v = args[0]
        return "" if v is None else str(v)

    if name == "в_булево":
        if not args: return False
        return _truthy(args[0])

    # арифметика
    if name == "округлить":
        n = _to_number(args[0] if args else 0, "округлить", "аргумент")
        digits = int(args[1]) if len(args) > 1 else 0
        return round(n, digits) if digits else int(round(n))
    if name == "абс":
        n = _to_number(args[0] if args else 0, "абс", "аргумент")
        return abs(n)
    if name == "мин":
        nums = [_to_number(a, "мин", f"аргумент {i+1}") for i, a in enumerate(args)]
        return min(nums) if nums else None
    if name == "макс":
        nums = [_to_number(a, "макс", f"аргумент {i+1}") for i, a in enumerate(args)]
        return max(nums) if nums else None

    # п. 1: списковые/объектные вспомогательные функции
    if name == "длина_списка":
        v = args[0] if args else []
        if isinstance(v, (list, dict, str)): return len(v)
        raise CicadaTypeError(
            f"длина_списка(): ожидается список/объект/строка, получен '{_cicada_type(v)}'."
        )
    if name == "добавить":
        if len(args) < 2 or not isinstance(args[0], list):
            raise CicadaTypeError("добавить(список, элемент): первый аргумент — список.")
        return args[0] + [args[1]]
    if name == "содержит_элемент":
        if len(args) < 2: return False
        lst, item = args[0], args[1]
        if isinstance(lst, list): return item in lst
        if isinstance(lst, dict): return str(item) in lst
        return str(item) in str(lst)
    if name == "ключи":
        if not args or not isinstance(args[0], dict):
            raise CicadaTypeError("ключи(): ожидается объект.")
        return list(args[0].keys())
    if name == "значения":
        if not args or not isinstance(args[0], dict):
            raise CicadaTypeError("значения(): ожидается объект.")
        return list(args[0].values())

    if name == "удалить_ключ":
        if len(args) < 2 or not isinstance(args[0], dict):
            raise CicadaTypeError("удалить_ключ(объект, ключ): первый аргумент — объект.")
        result = dict(args[0])
        result.pop(str(args[1]), None)
        return result

    # ── Строковые операции ──────────────────────────────────────────────

    if name == "заменить":
        if len(args) < 3:
            raise CicadaTypeError("заменить(строка, что, чем): нужно 3 аргумента.")
        return str(args[0]).replace(str(args[1]), str(args[2]))

    if name == "найти":
        if len(args) < 2:
            raise CicadaTypeError("найти(строка, подстрока): нужно 2 аргумента.")
        return str(args[0]).find(str(args[1]))

    if name == "срез":
        if not args:
            raise CicadaTypeError("срез(строка/список, от, до): нужен хотя бы 1 аргумент.")
        s = args[0]
        start = int(args[1]) if len(args) > 1 else 0
        end   = int(args[2]) if len(args) > 2 else (len(s) if isinstance(s, (str, list)) else 0)
        if isinstance(s, (str, list)):
            return s[start:end]
        return str(s)[start:end]

    # ── Случайные числа ────────────────────────────────────────────────

    if name == "случайное_число":
        import random as _rand
        a = int(args[0]) if args else 0
        b = int(args[1]) if len(args) > 1 else 100
        return _rand.randint(a, b)

    # ── Дата/время ─────────────────────────────────────────────────────

    if name == "формат_даты":
        date_val = str(args[0]) if args else ""
        fmt      = str(args[1]) if len(args) > 1 else "DD.MM.YYYY"
        # Преобразуем маску в strftime
        fmt_py = (fmt
                  .replace("YYYY", "%Y").replace("YY", "%y")
                  .replace("MM", "%m").replace("DD", "%d")
                  .replace("HH", "%H").replace("mm", "%M").replace("SS", "%S"))
        for parse_fmt in ["%d.%m.%Y", "%Y-%m-%d", "%d/%m/%Y", "%Y.%m.%d",
                          "%d.%m.%Y %H:%M:%S", "%Y-%m-%d %H:%M:%S"]:
            try:
                dt = _dt.datetime.strptime(date_val, parse_fmt)
                return dt.strftime(fmt_py)
            except ValueError:
                continue
        return date_val  # fallback

    # ── JSON ────────────────────────────────────────────────────────────

    if name == "разобрать_json":
        s = str(args[0]) if args else "{}"
        try:
            return _json.loads(s)
        except _json.JSONDecodeError as e:
            raise CicadaRuntimeError(f"разобрать_json(): ошибка разбора: {e}")

    if name == "в_json":
        v = args[0] if args else {}
        try:
            return _json.dumps(v, ensure_ascii=False)
        except TypeError as e:
            raise CicadaRuntimeError(f"в_json(): не удаётся сериализовать: {e}")

    raise CicadaRuntimeError(f"Неизвестная функция: '{name}'")


def _looks_like_compound_legacy_rhs(value) -> bool:
    """Проверяет legacy RHS, который на самом деле содержит хвост условия."""
    if not isinstance(value, VarRef) or not isinstance(value.name, str):
        return False
    raw = value.name
    return "&&" in raw or "||" in raw or " и " in raw or " или " in raw


def _eval_legacy_condition(cond: Condition, ctx, strict: bool) -> bool:
    if _looks_like_compound_legacy_rhs(cond.right):
        # Старый fallback мог разобрать выражение вида
        # {логин} == "admin" && пароль == "123" как одно сравнение,
        # где RHS = '"admin" && пароль == "123"'. Перед вычислением
        # собираем исходную строку обратно и отдаём современному parser/evaluator.
        left_raw = cond.left.name if isinstance(cond.left, VarRef) else str(eval_expr(cond.left, ctx, strict))
        repaired = parse_condition(f"{left_raw} {cond.op} {cond.right.name}")
        result = eval_expr(repaired, ctx, strict)
        result = result if isinstance(result, bool) else _truthy(result)
        return not result if cond.negate else result

    left  = eval_expr(cond.left, ctx, strict)
    right = eval_expr(cond.right, ctx, strict)
    op    = cond.op
    result = _eval_binop(BinaryOp(Literal(left), op, Literal(right)), ctx, strict)
    if not isinstance(result, bool):
        result = _truthy(result)
    return not result if cond.negate else result


def _eval_legacy_complex(cond: ComplexCondition, ctx, strict: bool) -> bool:
    results = [_eval_legacy_condition(c, ctx, strict) for c in cond.conditions]
    result  = results[0]
    for i, op in enumerate(cond.operators):
        if op == "и":    result = result and results[i + 1]
        elif op == "или": result = result or results[i + 1]
    return result


class Executor:
    def __init__(self, program: Program, tg, debug: bool = False):
        self.program = program
        self.tg      = tg
        self.debug   = debug
        self.runtime = Runtime(program.globals)

        self._dispatch: dict = {
            Reply:              self._exec_reply,
            Ask:                self._exec_ask,
            Remember:           self._exec_remember,
            If:                 self._exec_if,
            SwitchStmt:         self._exec_switch,
            Buttons:            self._exec_buttons,
            InlineButton:       self._exec_inline_button,
            InlineKeyboard:     self._exec_inline_keyboard,
            Photo:              self._exec_photo,
            Sticker:            self._exec_sticker,
            ForwardPhoto:       self._exec_forward_photo,
            SaveFile:           self._exec_save_file,
            StartScenario:      self._exec_start_scenario_stmt,
            SendMarkdown:       self._exec_send_markdown,
            SendDocument:       self._exec_send_document,
            SendAudio:          self._exec_send_audio,
            SendVideo:          self._exec_send_video,
            SendVoice:          self._exec_send_voice,
            SendLocation:       self._exec_send_location,
            SendContact:        self._exec_send_contact,
            SendPoll:           self._exec_send_poll,
            SendInvoice:        self._exec_send_invoice,
            SendGame:           self._exec_send_game,
            DownloadFile:       self._exec_download_file,
            Step:               self._exec_step,
            EndScenario:        self._exec_end_scenario,
            ReturnFromScenario: self._exec_return,
            RepeatStep:         self._exec_repeat_step,
            GotoStep:           self._exec_goto_step,
            SaveToDB:           self._exec_save_to_db,
            LoadFromDB:         self._exec_load_from_db,
            HttpGet:            self._exec_http_get,
            HttpPost:           self._exec_http_post,
            Log:                self._exec_log,
            Sleep:              self._exec_sleep,
            TelegramAPI:        self._exec_tg_api,
            UseBlock:           self._exec_use_block,
            RandomReply:        self._exec_random_reply,
            GlobalVar:          self._exec_global_var,
            PhotoVar:           self._exec_photo_var,
            # Циклы
            ForEach:            self._exec_for_each,
            WhileLoop:          self._exec_while,
            BreakLoop:          self._exec_break,
            ContinueLoop:       self._exec_continue,
            Timeout:            self._exec_timeout,
            # Уведомления и рассылка
            Notify:             self._exec_notify,
            Broadcast:          self._exec_broadcast,
            # Telegram-специфика
            CheckSubscription:  self._exec_check_subscription,
            GetChatMemberRole:  self._exec_get_chat_member_role,
            ForwardMsg:         self._exec_forward_msg,
            # Файлы и JSON
            LoadJson:           self._exec_load_json,
            SaveJson:           self._exec_save_json,
            DeleteFile:         self._exec_delete_file,
            DeleteDictKey:      self._exec_delete_dict_key,
            SetDictKey:         self._exec_set_dict_key,
            # HTTP расширения
            HttpPatch:          self._exec_http_patch,
            HttpPut:            self._exec_http_put,
            HttpDelete:         self._exec_http_delete,
            SetHttpHeaders:     self._exec_set_http_headers,
            # БД расширения
            DeleteFromDB:       self._exec_delete_from_db,
            GetAllDBKeys:       self._exec_get_all_db_keys,
            SaveGlobalDB:       self._exec_save_global_db,
            LoadFromUserDB:     self._exec_load_from_user_db,
            # Управление потоком
            ReturnValue:        self._exec_return_value,
            CallBlock:          self._exec_call_block,
        }

    # ══════════════════════════════════════════════════════════════
    #  Логирование + enriched errors  (п. 4)
    # ══════════════════════════════════════════════════════════════

    def _log(self, level: str, message: str, ctx=None):
        prefix = {"INFO": "[INFO] ", "DEBUG": "[DEBUG] ", "ERROR": "[ERROR] "}.get(level, "")
        user   = f"[user:{ctx.chat_id}] " if ctx else ""
        print(f"[{level}] {prefix}{user}{message}")

    def _enrich_error(self, err: CicadaRuntimeError, ctx=None) -> CicadaRuntimeError:
        """Добавляет сценарий/шаг к ошибке если они известны."""
        if ctx and not err.scenario and ctx.scenario:
            err.scenario  = ctx.scenario
            err.step_name = getattr(ctx, "current_step_name", None)
        return err

    def _eval(self, node, ctx):
        strict = not self.debug
        try:
            return eval_expr(node, ctx, strict=strict)
        except CicadaUndefinedVariable as e:
            if self.debug:
                self._log("DEBUG", str(e), ctx)
                return ""
            raise self._enrich_error(e, ctx)
        except CicadaRuntimeError as e:
            raise self._enrich_error(e, ctx)
        except Exception as e:
            raise CicadaRuntimeError(f"Ошибка вычисления выражения: {e}")

    def _render_parts(self, parts: list, ctx) -> str:
        from cicada.parser import Literal

        def _unwrap(val):
            # Разворачиваем Literal объекты
            if isinstance(val, Literal):
                return val.value
            return val

        def _fmt(val):
            if val is None:
                return ""
            # Разворачиваем Literal
            val = _unwrap(val)
            if isinstance(val, list):
                return ", ".join(str(_unwrap(x)) for x in val)
            if isinstance(val, dict):
                return ", ".join(f"{_unwrap(k)}={_unwrap(v)}" for k, v in val.items())
            return str(val)

        result = []
        for part in parts:
            if isinstance(part, str):
                result.append(part)
            else:
                val = self._eval(part, ctx)
                result.append(_fmt(val))
        return "".join(result)

    def _resolve_val(self, val, ctx):
        return self._eval(val, ctx)

    # ═══════════════════════════════════════════════════════════════
    #  Entry point
    # ═══════════════════════════════════════════════════════════════

    def handle(self, update: dict):
        callback_query = update.get("callback_query")
        if callback_query:
            self._handle_callback(callback_query)
            return
        msg = update.get("message")
        if msg:
            self._handle_message(msg)

    def _payload_matches_menu_button(self, payload: str) -> bool:
        """Совпадает ли payload с триггером «при нажатии …» (inline или текст кнопки)."""
        if not payload:
            return False
        p = payload.strip()
        for h in self.program.handlers:
            if h.kind == "callback" and h.trigger is not None and h.trigger.strip() == p:
                return True
        return False

    def _handle_callback(self, callback_query: dict):
        msg     = callback_query.get("message", {})
        chat_id = msg.get("chat", {}).get("id")
        if not chat_id:
            return

        user_info = callback_query.get("from", {})
        ctx = self.runtime.user(
            chat_id,
            user_info.get("first_name", "") or user_info.get("username", ""),
            user_info.get("id"),
            user_info.get("last_name", ""),
            language_code=user_info.get("language_code", ""),
            chat_type=msg.get("chat", {}).get("type", "private"),
        )
        # Сбрасываем флаг "вернуть" для каждого входящего update.
        # Иначе он может протечь между разными сообщениями/коллбэками.
        ctx._return_requested = False
        ctx.set("сообщение_id", msg.get("message_id", 0))
        data = callback_query.get("data", "")
        ctx.set("кнопка", data)
        ctx.set("текст", data)

        try:
            self.tg.answer_callback(callback_query["id"])
        except Exception:
            pass

        # Запускаем before_each middleware (как и для обычных сообщений)
        for h in self.program.handlers:
            if h.kind == "before_each":
                self._exec_body(h.body, ctx)

        # Если middleware сделал "вернуть" — прекращаем обработку update.
        if getattr(ctx, "_return_requested", False):
            return

        if ctx.waiting_for:
            # Колбэк из меню бота не считается ответом на «спросить» (иначе в
            # переменную попадает подпись кнопки, а не file_id / текст ответа).
            if self._payload_matches_menu_button(data):
                ctx.waiting_for = None
                ctx._pending_stmts = []
                if ctx.scenario:
                    ctx.scenario = None
                    ctx.step = 0
                    ctx.current_step_name = None
            else:
                ctx.set(ctx.waiting_for, data)
                ctx.waiting_for = None
                if ctx.scenario:
                    self._continue_scenario(ctx)
                # `вернуть` должен влиять только на текущую обработку тела,
                # но не на after_each middleware.
                ctx._return_requested = False
                self._run_after_each(ctx)
                return

        matched = False
        for h in self.program.handlers:
            if h.kind == "callback" and (h.trigger is None or h.trigger == data):
                self._exec_body(h.body, ctx)
                matched = True
                break

        if not matched:
            matched = self._run_text_handlers(ctx)
        if not matched:
            self._run_fallback(ctx)

        # FSM: если был переход в сценарии, продолжаем выполнение
        if ctx.scenario and getattr(ctx, "_transition_made", False):
            ctx._transition_made = False
            self._continue_scenario(ctx)

        # `вернуть` не должен обрезать after_each.
        ctx._return_requested = False
        self._run_after_each(ctx)

    def _handle_message(self, msg: dict):
        chat_id   = msg["chat"]["id"]
        user_info = msg.get("from", {})
        ctx = self.runtime.user(
            chat_id,
            user_info.get("first_name", "") or user_info.get("username", ""),
            user_info.get("id"),
            user_info.get("last_name", ""),
            language_code=user_info.get("language_code", ""),
            chat_type=msg.get("chat", {}).get("type", "private"),
        )
        # Сбрасываем флаг "вернуть" для каждого входящего update.
        ctx._return_requested = False
        ctx.set("сообщение_id", msg.get("message_id", 0))
        text = msg.get("text", "")
        ctx.set("текст", text)  # Устанавливаем текст ДО middleware

        for h in self.program.handlers:
            if h.kind == "before_each":
                self._exec_body(h.body, ctx)

        # Если middleware сделал "вернуть" — прекращаем обработку update.
        if getattr(ctx, "_return_requested", False):
            return

        media_kind = self._detect_media(msg, ctx)

        if media_kind:
            if not hasattr(ctx, "_pending_stmts"):
                ctx._pending_stmts = []
            self._log("DEBUG", f"[media] kind={media_kind} waiting_for={ctx.waiting_for!r} файл_id={ctx.get('файл_id')!r} scenario={ctx.scenario!r} pending={len(getattr(ctx,'_pending_stmts',[]))}", ctx)
            if ctx.waiting_for and ctx.get("файл_id"):
                ctx.set(ctx.waiting_for, ctx.get("файл_id"))
                self._log("DEBUG", f"[media] → сохранили файл_id в {ctx.waiting_for!r}, pending_stmts={len(ctx._pending_stmts)}", ctx)
                ctx.waiting_for = None
                if ctx.scenario:
                    self._log("DEBUG", f"[media] → _continue_scenario({ctx.scenario!r})", ctx)
                    self._continue_scenario(ctx)
                elif getattr(ctx, "_pending_stmts", None):
                    pending = ctx._pending_stmts
                    ctx._pending_stmts = []
                    self._exec_body(pending, ctx)
                ctx._return_requested = False
                self._run_after_each(ctx)
                return
            for h in self.program.handlers:
                if h.kind == media_kind:
                    self._exec_body(h.body, ctx)
            ctx._return_requested = False
            self._run_after_each(ctx)
            return

        if ctx.waiting_for and text and not text.startswith("/"):
            if self._payload_matches_menu_button(text):
                ctx.waiting_for = None
                ctx._pending_stmts = []
                if ctx.scenario:
                    ctx.scenario = None
                    ctx.step = 0
                    ctx.current_step_name = None
            else:
                ctx.set(ctx.waiting_for, text)
                ctx.waiting_for = None
                if ctx.scenario:
                    self._continue_scenario(ctx)
                elif getattr(ctx, "_pending_stmts", None):
                    pending = ctx._pending_stmts
                    ctx._pending_stmts = []
                    self._exec_body(pending, ctx)
                ctx._return_requested = False
                self._run_after_each(ctx)
                return

        if text == "/start":
            for h in self.program.handlers:
                if h.kind == "start":
                    self._exec_body(h.body, ctx)
            # `вернуть` не должен обрезать after_each.
            ctx._return_requested = False
            self._run_after_each(ctx)
            return

        if text.startswith("/"):
            cmd = text.split()[0]
            for h in self.program.handlers:
                if h.kind == "command" and h.trigger == cmd:
                    self._exec_body(h.body, ctx)
            # `вернуть` не должен обрезать after_each.
            ctx._return_requested = False
            self._run_after_each(ctx)
            return

        if not self._run_text_handlers(ctx):
            self._run_fallback(ctx)

        # `вернуть` не должен обрезать after_each.
        ctx._return_requested = False
        self._run_after_each(ctx)

    def _detect_media(self, msg: dict, ctx) -> "str | None":
        if msg.get("photo"):
            ctx.set("файл_id", msg["photo"][-1]["file_id"])
            ctx.set("тип_файла", "фото")
            return "photo_received"
        if msg.get("document"):
            ctx.set("файл_id", msg["document"]["file_id"])
            ctx.set("имя_файла", msg["document"].get("file_name", ""))
            ctx.set("тип_файла", "документ")
            return "document_received"
        if msg.get("voice"):
            ctx.set("файл_id", msg["voice"]["file_id"])
            ctx.set("тип_файла", "голосовое")
            return "voice_received"
        if msg.get("audio"):
            ctx.set("файл_id", msg["audio"]["file_id"])
            ctx.set("тип_файла", "аудио")
            return "voice_received"
        if msg.get("sticker"):
            ctx.set("файл_id", msg["sticker"]["file_id"])
            ctx.set("стикер_emoji", msg["sticker"].get("emoji", ""))
            ctx.set("тип_файла", "стикер")
            return "sticker_received"
        if msg.get("location"):
            loc = msg["location"]
            ctx.set("широта",  str(loc["latitude"]))
            ctx.set("долгота", str(loc["longitude"]))
            ctx.set("тип_файла", "геолокация")
            return "location_received"
        if msg.get("contact"):
            c = msg["contact"]
            ctx.set("контакт_имя",     c.get("first_name", ""))
            ctx.set("контакт_телефон", c.get("phone_number", ""))
            ctx.set("тип_файла", "контакт")
            return "contact_received"
        return None

    def _run_text_handlers(self, ctx) -> bool:
        matched = False
        text = ctx.get("текст") or ""
        for h in self.program.handlers:
            if h.kind == "text":
                # Если задан триггер — матчим только по нему (точное совпадение или без учёта регистра)
                if h.trigger is not None:
                    if h.trigger.strip().lower() != text.strip().lower():
                        continue
                if self._exec_body(h.body, ctx):
                    matched = True
            # Reply-keyboard кнопки приходят как текст, но объявлены через
            # «при нажатии "..."» (callback). Если текст совпадает — выполняем.
            elif h.kind == "callback" and h.trigger and h.trigger.strip() == text.strip():
                self._exec_body(h.body, ctx)
                matched = True
                break
        return matched

    def _run_after_each(self, ctx):
        for h in self.program.handlers:
            if h.kind == "after_each":
                self._exec_body(h.body, ctx)

    def _run_fallback(self, ctx):
        for h in self.program.handlers:
            if h.kind in ("any", "else"):
                self._exec_body(h.body, ctx)
                break

    # ═══════════════════════════════════════════════════════════════
    #  Body execution
    # ═══════════════════════════════════════════════════════════════

    def _exec_body(self, stmts: list, ctx) -> bool:
        executed = False

        self._reset_pending(ctx)
        ctx._ask_sent = False  # сбрасываем флаг перед выполнением

        signal = None
        try:
            # enumerate: stmts.index(stmt) ломается для равных по значению dataclass-узлов
            # (например два одинаковых «ответ "..."»), из-за чего обрезается хвост шага.
            for i, stmt in enumerate(stmts):
                result = self._exec(stmt, ctx)

                if isinstance(stmt, If):
                    if result:
                        executed = True
                else:
                    executed = True

                if getattr(ctx, "_return_requested", False):
                    break

                if getattr(ctx, "_repeat_requested", False):
                    break

                # FSM semantics: `спросить ... → var` должен поставить ожидание и
                # остановить выполнение текущего шага до ввода пользователя.
                if getattr(ctx, "waiting_for", None):
                    # Хвост текущего тела (напр. «стоп» после «запустить» в «при нажатии»).
                    tail = stmts[i + 1 :]
                    # Внутри «запустить» уже мог отложиться хвост шага сценария (спросить → …).
                    # Нельзя затирать его — иначе остаётся только внешний хвост (часто один «стоп»).
                    prev = getattr(ctx, "_pending_stmts", None)
                    if prev is not None:
                        ctx._pending_stmts = list(prev) + list(tail)
                    else:
                        ctx._pending_stmts = list(tail)
                    break
        except (_BreakSignal, _ContinueSignal) as e:
            signal = e

        # Единая точка отправки: flush всегда
        self._flush(ctx)

        if signal is not None:
            raise signal

        return executed

    def _exec(self, stmt, ctx):
        handler = self._dispatch.get(type(stmt))
        if handler:
            return handler(stmt, ctx)
        print(f"⚠️  Неизвестная инструкция: {type(stmt).__name__}")

    # ═══════════════════════════════════════════════════════════════
    #  Инструкции
    # ═══════════════════════════════════════════════════════════════

    def _reset_pending(self, ctx):
        """Гарантирует структуру _pending_message ВСЕГДА"""
        if getattr(ctx, "_pending_message", None) is None:
            ctx._pending_message = {
                "text": "",
                "buttons": None
            }

    def _flush(self, ctx):
        """Единая точка отправки накопленного сообщения"""
        msg = getattr(ctx, "_pending_message", None)
        if not msg:
            return

        text = msg.get("text", "") or ""
        buttons = msg.get("buttons")

        if buttons:
            if not text.strip():
                text = "\u200b"
            self.tg.send_buttons_matrix(ctx.chat_id, buttons, text=text)
        elif text.strip():
            self.tg.send_message(ctx.chat_id, text)

        ctx._pending_message = None

    def _exec_reply(self, stmt: Reply, ctx):
        self._reset_pending(ctx)
        text = self._render_parts(stmt.parts, ctx)

        existing = ctx._pending_message.get("text", "")
        if existing:
            sep = "\n" if not existing.endswith("\n") else ""
            ctx._pending_message["text"] = existing + sep + text
        else:
            ctx._pending_message["text"] = text

    def _exec_random_reply(self, stmt, ctx):
        import random as _random
        variant = _random.choice(stmt.variants)
        self._reset_pending(ctx)
        existing = ctx._pending_message.get("text", "")
        if existing:
            sep = "\n" if not existing.endswith("\n") else ""
            ctx._pending_message["text"] = existing + sep + variant
        else:
            ctx._pending_message["text"] = variant

    def _exec_ask(self, stmt: Ask, ctx):
        self._flush(ctx)  # отправляем накопленное перед вопросом
        # Буферим вопрос вместо прямой отправки
        ctx._pending_message = {
            "text": stmt.question,
            "buttons": None
        }
        ctx.waiting_for = stmt.variable
        ctx._ask_sent = True  # флаг: вопрос буферизирован, flush будет в _exec_body

    def _exec_remember(self, stmt: Remember, ctx):
        value = self._resolve_val(stmt.value, ctx)
        ctx.set(stmt.name, value)

    def _exec_if(self, stmt: If, ctx):
        if self._eval_condition(stmt.condition, ctx):
            self._exec_body(stmt.then_body, ctx)
            return True
        elif stmt.else_body:
            self._exec_body(stmt.else_body, ctx)
            return True
        return False

    def _exec_switch(self, stmt: SwitchStmt, ctx):
        raw = ctx.get(stmt.variable)
        val = "" if raw is None else str(raw)
        for lit, body in stmt.cases:
            if val == lit:
                self._exec_body(body, ctx)
                break

    def _exec_global_var(self, stmt: GlobalVar, ctx):
        """Установить глобальную переменную (доступна всем пользователям)"""
        value = self._resolve_val(stmt.value, ctx)
        ctx._globals[stmt.name] = value

    def _exec_photo_var(self, stmt: PhotoVar, ctx):
        """Отправить картинку по URL из переменной"""
        url = self._eval(stmt, ctx) if hasattr(stmt, 'value') else ctx.get(stmt.var_name, "")
        url = ctx.get(stmt.var_name, "")
        if url:
            self.tg.send_photo(ctx.chat_id, url)
        else:
            self.tg.send_message(ctx.chat_id, "⚠️ URL картинки не задан")

    # ── Циклы ─────────────────────────────────────────────────────────

    def _exec_for_each(self, stmt: ForEach, ctx):
        """для каждого <var> в <iterable>: <body>"""
        iterable = self._eval(stmt.collection, ctx)

        if not isinstance(iterable, (list, str, dict)):
            raise CicadaTypeError(
                f"'для ... в': ожидается список, строка или объект, "
                f"получен '{_cicada_type(iterable)}'."
            )

        items = list(iterable.keys()) if isinstance(iterable, dict) else iterable
        for item in items:
            ctx.set(stmt.variable, item)
            try:
                self._exec_body(stmt.body, ctx)
            except _BreakSignal:
                break
            except _ContinueSignal:
                continue

    def _exec_while(self, stmt: WhileLoop, ctx):
        """пока <condition>: <body>"""
        max_iters = 100_000  # защита от бесконечного цикла
        iters = 0
        while iters < max_iters and self._eval_condition(stmt.condition, ctx):
            iters += 1
            try:
                self._exec_body(stmt.body, ctx)
            except _BreakSignal:
                break
            except _ContinueSignal:
                continue
        if iters >= max_iters:
            self._log("ERROR", f"Цикл 'пока' прерван после {max_iters} итераций (защита).", ctx)

    def _exec_break(self, stmt: BreakLoop, ctx):
        raise _BreakSignal()

    def _exec_continue(self, stmt: ContinueLoop, ctx):
        raise _ContinueSignal()

    def _exec_timeout(self, stmt: Timeout, ctx):
        """таймаут N секунд: <body> — выполнение с ограничением по времени."""
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            future = ex.submit(self._exec_body, stmt.body, ctx)
            try:
                future.result(timeout=stmt.seconds)
            except concurrent.futures.TimeoutError:
                self._log("DEBUG", f"Таймаут {stmt.seconds}с истёк, выполнение прервано.", ctx)
            except Exception as e:
                raise

    def _exec_buttons(self, stmt: Buttons, ctx):
        from cicada.parser import Literal as CicadaLiteral, Variable

        def _unwrap(v):
            if isinstance(v, CicadaLiteral):
                return str(v.value)
            if isinstance(v, Variable):
                return str(self._eval(v, ctx))
            return str(v)

        new_rows = (
            [[_unwrap(lbl) for lbl in row] for row in stmt.labels]
            if stmt.labels and isinstance(stmt.labels[0], list)
            else [[_unwrap(lbl) for lbl in stmt.labels]]
        )
        existing = ctx._pending_message.get("buttons") or []
        ctx._pending_message["buttons"] = existing + new_rows

    def _exec_inline_button(self, stmt: InlineButton, ctx):
        """
        Одиночная inline-кнопка (устаревший путь — «кнопка "X" -> "cb"»).
        Оборачиваем в InlineKeyboard с одним рядом из одной кнопки
        и делегируем в _exec_inline_keyboard.
        """
        self._exec_inline_keyboard(InlineKeyboard(rows=[[stmt]]), ctx)

    def _exec_inline_keyboard(self, stmt: InlineKeyboard, ctx):
        """
        Inline-клавиатура из блока inline-кнопки:
            ["Да" → "cb_yes", "Нет" → "cb_no"]
            ["Отмена" → "cb_cancel"]
        Отправляется ВМЕСТЕ с накопленным текстом в одном сообщении.
        """
        # Строим матрицу кнопок для Telegram InlineKeyboardMarkup
        keyboard = []
        for row in stmt.rows:
            kb_row = []
            for btn in row:
                if btn.url:
                    kb_row.append({"text": btn.text, "url": btn.url})
                else:
                    kb_row.append({"text": btn.text, "callback_data": btn.callback or btn.text})
            if kb_row:
                keyboard.append(kb_row)
        if not keyboard:
            return

        # Забираем накопленный текст — отправим ВМЕСТЕ с клавиатурой в одном сообщении
        msg = getattr(ctx, "_pending_message", None) or {}
        pending_text = (msg.get("text", "") or "").strip()
        pending_buttons = msg.get("buttons")

        if pending_buttons:
            # Если есть накопленные reply-кнопки — флашим их отдельно
            self._flush(ctx)
            pending_text = ""
        else:
            # Потребляем накопленный текст, чтобы финальный _flush не дублировал его
            ctx._pending_message = None

        self.tg.send_inline_keyboard(ctx.chat_id, keyboard, text=pending_text or "\u200b")

    def _exec_photo(self, stmt: Photo, ctx):
        self.tg.send_photo(ctx.chat_id, stmt.url)

    def _exec_sticker(self, stmt: Sticker, ctx):
        self.tg.send_sticker(ctx.chat_id, stmt.file_id)

    def _exec_forward_photo(self, stmt: ForwardPhoto, ctx):
        file_id = ctx.get("файл_id", "")
        if file_id:
            self.tg.send_photo(ctx.chat_id, file_id, caption=stmt.caption)
        else:
            self.tg.send_message(ctx.chat_id, "⚠️ Нет фото для пересылки")

    def _exec_save_file(self, stmt: SaveFile, ctx):
        ctx.set(stmt.variable, ctx.get("файл_id", ""))

    def _exec_start_scenario_stmt(self, stmt: StartScenario, ctx):
        self._start_scenario(ctx, stmt.name)

    def _exec_send_markdown(self, stmt: SendMarkdown, ctx):
        self.tg.send_markdown(ctx.chat_id, self._render_parts(stmt.parts, ctx))

    def _exec_send_document(self, stmt: SendDocument, ctx):
        file = eval_expr(stmt.file, ctx) if not isinstance(stmt.file, str) else stmt.file
        self.tg.send_document(ctx.chat_id, str(file), stmt.caption)

    def _exec_send_audio(self, stmt: SendAudio, ctx):
        file = eval_expr(stmt.file, ctx) if not isinstance(stmt.file, str) else stmt.file
        self.tg.send_audio(ctx.chat_id, str(file), stmt.caption)

    def _exec_send_video(self, stmt: SendVideo, ctx):
        file = eval_expr(stmt.file, ctx) if not isinstance(stmt.file, str) else stmt.file
        self.tg.send_video(ctx.chat_id, str(file), stmt.caption)

    def _exec_send_voice(self, stmt: SendVoice, ctx):
        file = eval_expr(stmt.file, ctx) if not isinstance(stmt.file, str) else stmt.file
        self.tg.send_voice(ctx.chat_id, str(file), stmt.caption)

    def _exec_send_location(self, stmt: SendLocation, ctx):
        self.tg.send_location(ctx.chat_id, stmt.latitude, stmt.longitude)

    def _exec_send_contact(self, stmt: SendContact, ctx):
        self.tg.send_contact(ctx.chat_id, stmt.phone, stmt.name)

    def _exec_send_poll(self, stmt: SendPoll, ctx):
        self.tg.send_poll(ctx.chat_id, stmt.question, stmt.options)

    def _exec_send_invoice(self, stmt: SendInvoice, ctx):
        self.tg.send_invoice(ctx.chat_id, stmt.title, stmt.description, stmt.amount)

    def _exec_send_game(self, stmt: SendGame, ctx):
        self.tg.send_game(ctx.chat_id, stmt.short_name)

    def _exec_download_file(self, stmt: DownloadFile, ctx):
        file_id = ctx.get("файл_id", "")
        if not file_id:
            raise CicadaRuntimeError("Ошибка скачивания: нет файл_id в контексте", stmt)
        try:
            self.tg.download_file(file_id, stmt.save_path)
            ctx.set("скачан", stmt.save_path)
        except Exception as e:
            raise CicadaRuntimeError(f"Ошибка скачивания файла: {e}", stmt)

    def _exec_step(self, stmt: Step, ctx):
        ctx.current_step_name = getattr(stmt, "name", None)  # для п. 4
        if not hasattr(ctx, "_pending_stmts"):
            ctx._pending_stmts = []
        self._exec_body(stmt.body, ctx)

    def _exec_end_scenario(self, stmt: EndScenario, ctx):
        ctx.scenario          = None
        ctx.step              = 0
        ctx.waiting_for       = None
        ctx.current_step_name = None

    def _exec_return(self, stmt: ReturnFromScenario, ctx):
        ctx._return_requested = True

    def _exec_repeat_step(self, stmt: RepeatStep, ctx):
        # ctx.step уже указывает на СЛЕДУЮЩИЙ шаг (инкремент был до exec).
        # Чтобы вернуться на ПРЕДЫДУЩИЙ шаг (тот что задал вопрос),
        # нужно отнять 2: -1 = текущий, -2 = предыдущий.
        if ctx.scenario and ctx.step >= 2:
            ctx.step -= 2
        elif ctx.scenario:
            ctx.step = 0
        # Сигнализируем что нужно прервать выполнение текущего шага
        ctx._repeat_requested = True
        # Сбрасываем waiting_for чтобы следующий спросить сработал корректно
        ctx.waiting_for = None

    def _exec_goto_step(self, stmt: GotoStep, ctx):
        target = stmt.step_name
        # 1. Переход на команду: перейти "/cmd"
        if target.startswith("/"):
            cmd = target.split()[0]
            for h in self.program.handlers:
                if h.kind == "command" and h.trigger == cmd:
                    self._exec_body(h.body, ctx)
                    return
            return
        # 2. Переход на сценарий по имени (вне сценария)
        if not ctx.scenario:
            if target in self.program.scenarios:
                self._start_scenario(ctx, target)
            return
        # 3. Переход на шаг внутри текущего сценария
        idx = ctx.get_step_index(target)
        if idx >= 0:
            ctx.step = idx
            ctx._transition_made = True
        elif target in self.program.scenarios:
            # 4. Переход на другой сценарий из сценария
            self._start_scenario(ctx, target)
        else:
            raise CicadaRuntimeError(
                f"Шаг или сценарий '{target}' не найден", stmt
            )

    def _interpolate_key(self, key: str, ctx) -> str:
        """Интерполирует {var} в строке ключа БД."""
        if '{' not in str(key):
            return str(key)
        from cicada.parser import parse_string_expr
        parts = parse_string_expr(f'"{key}"')
        return self._render_parts(parts, ctx)

    def _exec_save_to_db(self, stmt: SaveToDB, ctx):
        value = self._resolve_val(stmt.value, ctx)
        key = self._interpolate_key(stmt.key, ctx)
        get_db().set(str(ctx.user_id), key, value)

    def _exec_load_from_db(self, stmt: LoadFromDB, ctx):
        key = self._interpolate_key(stmt.key, ctx)
        value = get_db().get(str(ctx.user_id), key)
        ctx.set(stmt.variable, value if value is not None else "")

    def _exec_log(self, stmt: Log, ctx):
        message = self._render_parts(stmt.parts, ctx)
        self._log("DEBUG" if self.debug else "INFO", message, ctx)

    def _exec_sleep(self, stmt: Sleep, ctx):
        time.sleep(stmt.seconds)

    def _exec_tg_api(self, stmt: TelegramAPI, ctx):
        try:
            self.tg.call(stmt.method, stmt.params)
        except Exception as e:
            raise CicadaRuntimeError(f"Telegram API {stmt.method}: {e}", stmt)

    def _exec_use_block(self, stmt: UseBlock, ctx):
        block = self.program.blocks.get(stmt.name)
        if not block:
            raise CicadaRuntimeError(f"Блок '{stmt.name}' не найден", stmt)
        self._exec_body(block.body, ctx)

    # ── Уведомления и рассылка ────────────────────────────────────────

    def _exec_notify(self, stmt: Notify, ctx):
        """уведомить USER_ID "текст" — отправить сообщение конкретному пользователю."""
        user_id = self._resolve_val(stmt.user_id, ctx)
        text    = self._render_parts(stmt.parts, ctx)
        try:
            self.tg.send_message(int(user_id), text)
        except Exception as e:
            self._log("ERROR", f"уведомить {user_id}: {e}", ctx)

    def _exec_broadcast(self, stmt: Broadcast, ctx):
        """рассылка всем / рассылка группе — массовая рассылка."""
        text    = self._render_parts(stmt.parts, ctx)
        db      = get_db()
        all_ids = db.get_all_user_ids()
        sent = 0
        for uid in all_ids:
            if stmt.segment:
                seg = db.get(uid, "_сегмент")
                if seg != stmt.segment:
                    continue
            try:
                self.tg.send_message(int(uid), text)
                sent += 1
            except Exception as e:
                self._log("DEBUG", f"Рассылка: ошибка для {uid}: {e}", ctx)
        self._log("INFO", f"Рассылка отправлена {sent} пользователям.", ctx)

    # ── Telegram-специфика ────────────────────────────────────────────

    def _exec_check_subscription(self, stmt: CheckSubscription, ctx):
        """проверить подписку @канал → переменная."""
        channel = self._resolve_val(stmt.channel, ctx) if not isinstance(stmt.channel, str) else stmt.channel
        user_id = int(ctx.user_id)
        try:
            result  = self.tg.get_chat_member(channel, user_id)
            status  = result.get("result", {}).get("status", "left")
            is_sub  = status in ("creator", "administrator", "member", "restricted")
            ctx.set(stmt.variable, is_sub)
        except Exception as e:
            self._log("ERROR", f"проверить подписку {channel}: {e}", ctx)
            ctx.set(stmt.variable, False)

    def _exec_get_chat_member_role(self, stmt: GetChatMemberRole, ctx):
        """роль @канал USER_ID → переменная."""
        chat    = self._resolve_val(stmt.chat, ctx)    if not isinstance(stmt.chat, str)    else stmt.chat
        user_id = self._resolve_val(stmt.user_id, ctx)
        try:
            result = self.tg.get_chat_member(chat, int(user_id))
            status = result.get("result", {}).get("status", "left")
            ctx.set(stmt.variable, status)
        except Exception as e:
            self._log("ERROR", f"роль в {chat}: {e}", ctx)
            ctx.set(stmt.variable, "left")

    def _exec_forward_msg(self, stmt: ForwardMsg, ctx):
        """переслать сообщение USER_ID — пересылает текущее сообщение."""
        to_id    = self._resolve_val(stmt.to_user_id, ctx)
        msg_id   = ctx.get("сообщение_id", 0)
        from_id  = ctx.chat_id
        try:
            self.tg.forward_message(int(to_id), from_id, int(msg_id))
        except Exception as e:
            self._log("ERROR", f"переслать сообщение {to_id}: {e}", ctx)

    # ── Файлы и JSON ─────────────────────────────────────────────────

    def _exec_load_json(self, stmt: LoadJson, ctx):
        """json_файл "путь" → переменная."""
        path = self._resolve_val(stmt.path, ctx) if not isinstance(stmt.path, str) else stmt.path
        try:
            with open(path, "r", encoding="utf-8") as f:
                ctx.set(stmt.variable, _json.load(f))
        except FileNotFoundError:
            raise CicadaRuntimeError(f"json_файл: файл не найден: {path}", stmt)
        except _json.JSONDecodeError as e:
            raise CicadaRuntimeError(f"json_файл: ошибка разбора JSON: {e}", stmt)

    def _exec_save_json(self, stmt: SaveJson, ctx):
        """сохранить_json "путь" = переменная."""
        path = self._resolve_val(stmt.path, ctx) if not isinstance(stmt.path, str) else stmt.path
        data = ctx.get(stmt.source_var)
        try:
            with open(path, "w", encoding="utf-8") as f:
                _json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            raise CicadaRuntimeError(f"сохранить_json: ошибка записи: {e}", stmt)

    def _exec_delete_file(self, stmt: DeleteFile, ctx):
        """удалить_файл "путь"."""
        path = self._resolve_val(stmt.path, ctx) if not isinstance(stmt.path, str) else stmt.path
        try:
            _os.remove(path)
        except FileNotFoundError:
            self._log("DEBUG", f"удалить_файл: файл не найден: {path}", ctx)
        except Exception as e:
            raise CicadaRuntimeError(f"удалить_файл: {e}", stmt)

    def _exec_delete_dict_key(self, stmt: DeleteDictKey, ctx):
        """удалить объект["ключ"]."""
        obj = ctx.get(stmt.target)
        if not isinstance(obj, dict):
            raise CicadaTypeError(f"удалить ключ: '{stmt.target}' не является объектом.")
        key = self._resolve_val(stmt.key, ctx) if not isinstance(stmt.key, str) else stmt.key
        obj.pop(str(key), None)
        ctx.set(stmt.target, obj)

    def _exec_set_dict_key(self, stmt: SetDictKey, ctx):
        """объект["ключ"] = значение."""
        obj = ctx.get(stmt.target)
        if obj is None:
            obj = {}
        if not isinstance(obj, dict):
            raise CicadaTypeError(f"присваивание поля: '{stmt.target}' не является объектом.")
        key   = self._resolve_val(stmt.key, ctx)   if not isinstance(stmt.key, str)   else stmt.key
        value = self._resolve_val(stmt.value, ctx)
        obj[str(key)] = value
        ctx.set(stmt.target, obj)

    # ── HTTP расширения ───────────────────────────────────────────────

    def _get_http_headers(self, stmt_headers: dict, ctx) -> dict:
        """Возвращает объединённые заголовки: ctx._http_headers + заголовки инструкции."""
        base = dict(getattr(ctx, "_http_headers", {}) or {})
        base.update(stmt_headers or {})
        return base

    def _resolve_http_data(self, data, ctx):
        """Разрешает тело запроса; dict → отправляется как json."""
        resolved = self._resolve_val(data, ctx)
        return resolved

    def _exec_http_patch(self, stmt: HttpPatch, ctx):
        url     = self._resolve_val(stmt.url, ctx) if not isinstance(stmt.url, str) else stmt.url
        data    = self._resolve_http_data(stmt.data, ctx)
        headers = self._get_http_headers(stmt.headers, ctx)
        try:
            if isinstance(data, dict):
                resp = requests.patch(url, json=data, headers=headers, timeout=30)
            else:
                resp = requests.patch(url, data=str(data) if data is not None else None,
                                      headers=headers, timeout=30)
            ctx.set(stmt.variable, resp.text)
        except Exception as e:
            ctx.set(stmt.variable, "")
            raise CicadaRuntimeError(f"HTTP PATCH {url}: {e}", stmt)

    def _exec_http_put(self, stmt: HttpPut, ctx):
        url     = self._resolve_val(stmt.url, ctx) if not isinstance(stmt.url, str) else stmt.url
        data    = self._resolve_http_data(stmt.data, ctx)
        headers = self._get_http_headers(stmt.headers, ctx)
        try:
            if isinstance(data, dict):
                resp = requests.put(url, json=data, headers=headers, timeout=30)
            else:
                resp = requests.put(url, data=str(data) if data is not None else None,
                                    headers=headers, timeout=30)
            ctx.set(stmt.variable, resp.text)
        except Exception as e:
            ctx.set(stmt.variable, "")
            raise CicadaRuntimeError(f"HTTP PUT {url}: {e}", stmt)

    def _exec_http_delete(self, stmt: HttpDelete, ctx):
        url     = self._resolve_val(stmt.url, ctx) if not isinstance(stmt.url, str) else stmt.url
        headers = self._get_http_headers(stmt.headers, ctx)
        try:
            resp = requests.delete(url, headers=headers, timeout=30)
            ctx.set(stmt.variable, resp.text)
        except Exception as e:
            ctx.set(stmt.variable, "")
            raise CicadaRuntimeError(f"HTTP DELETE {url}: {e}", stmt)

    def _exec_set_http_headers(self, stmt: SetHttpHeaders, ctx):
        """http_заголовки переменная — устанавливает заголовки для следующих HTTP-вызовов."""
        headers = ctx.get(stmt.variable)
        if not isinstance(headers, dict):
            raise CicadaTypeError(
                f"http_заголовки: переменная '{stmt.variable}' должна быть объектом (dict)."
            )
        ctx._http_headers = headers

    # ── HTTP GET/POST теперь тоже используют _http_headers ──────────

    def _exec_http_get(self, stmt: HttpGet, ctx):
        try:
            headers = self._get_http_headers(stmt.headers, ctx)
            resp    = requests.get(stmt.url, headers=headers, timeout=30)
            ctx.set(stmt.variable, resp.text)
        except Exception as e:
            ctx.set(stmt.variable, "")
            raise CicadaRuntimeError(f"HTTP GET {stmt.url}: {e}", stmt)

    def _exec_http_post(self, stmt: HttpPost, ctx):
        try:
            data    = self._resolve_val(stmt.data, ctx)
            headers = self._get_http_headers(stmt.headers, ctx)
            if isinstance(data, dict):
                resp = requests.post(stmt.url, json=data, headers=headers, timeout=30)
            else:
                resp = requests.post(stmt.url, data=str(data) if data is not None else None,
                                     headers=headers, timeout=30)
            ctx.set(stmt.variable, resp.text)
        except Exception as e:
            ctx.set(stmt.variable, "")
            raise CicadaRuntimeError(f"HTTP POST {stmt.url}: {e}", stmt)

    # ── База данных расширения ─────────────────────────────────────────

    def _exec_delete_from_db(self, stmt: DeleteFromDB, ctx):
        """удалить "ключ" — удаление ключа из БД."""
        key = self._resolve_val(stmt.key, ctx) if not isinstance(stmt.key, str) else stmt.key
        get_db().delete(str(ctx.user_id), str(key))

    def _exec_get_all_db_keys(self, stmt: GetAllDBKeys, ctx):
        """все_ключи → список — все ключи пользователя в БД."""
        keys = get_db().get_all_keys(str(ctx.user_id))
        ctx.set(stmt.variable, keys)

    def _exec_save_global_db(self, stmt: SaveGlobalDB, ctx):
        """сохранить_глобально "ключ" = значение."""
        key   = self._resolve_val(stmt.key, ctx)   if not isinstance(stmt.key, str)   else stmt.key
        value = self._resolve_val(stmt.value, ctx)
        get_db().set_global(str(key), value)

    def _exec_load_from_user_db(self, stmt: LoadFromUserDB, ctx):
        """получить от USER_ID "ключ" → переменная."""
        uid   = self._resolve_val(stmt.user_id, ctx)
        key   = self._resolve_val(stmt.key, ctx) if not isinstance(stmt.key, str) else stmt.key
        value = get_db().get(str(uid), str(key))
        ctx.set(stmt.variable, value if value is not None else "")

    # ── Управление потоком расширения ──────────────────────────────────

    def _exec_return_value(self, stmt: ReturnValue, ctx):
        """вернуть значение — возврат из блока с значением."""
        value = self._resolve_val(stmt.value, ctx)
        ctx._return_value   = value
        ctx._return_requested = True

    def _exec_call_block(self, stmt: CallBlock, ctx):
        """вызвать "блок" → переменная — блок как функция с возвращаемым значением."""
        block = self.program.blocks.get(stmt.name)
        if not block:
            raise CicadaRuntimeError(f"Блок '{stmt.name}' не найден", stmt)
        ctx._return_value = None
        prev_return = getattr(ctx, "_return_requested", False)
        ctx._return_requested = False
        self._exec_body(block.body, ctx)
        result = getattr(ctx, "_return_value", None)
        ctx._return_requested = prev_return  # восстанавливаем флаг
        ctx._return_value = None
        if stmt.variable:
            ctx.set(stmt.variable, result if result is not None else "")

    # ═══════════════════════════════════════════════════════════════
    #  Условия
    # ═══════════════════════════════════════════════════════════════

    def _eval_condition(self, cond, ctx) -> bool:
        result = self._eval(cond, ctx)
        return _truthy(result)

    def _eval_single_condition(self, cond, ctx) -> bool:
        return self._eval_condition(cond, ctx)

    # ═══════════════════════════════════════════════════════════════
    #  FSM — сценарии
    # ═══════════════════════════════════════════════════════════════

    def _start_scenario(self, ctx, name: str):
        if name not in self.program.scenarios:
            raise CicadaRuntimeError(f"Сценарий '{name}' не найден")
        ctx.scenario          = name
        ctx.step              = 0
        ctx.current_step_name = None
        ctx._transition_made  = False
        ctx._pending_stmts    = []
        ctx.set_step_names(self.program.scenarios[name])
        self._continue_scenario(ctx)

    def _continue_scenario(self, ctx):
        if not ctx.scenario:
            return

        # Если есть отложенные инструкции текущего шага — выполняем их первыми
        pending = getattr(ctx, "_pending_stmts", None)
        if pending:
            ctx._pending_stmts = []
            self._exec_body(pending, ctx)
            # Если снова ждём ввода — останавливаемся
            if getattr(ctx, "waiting_for", None):
                return
            # Иначе продолжаем к следующему шагу
            if ctx.scenario:
                self._continue_scenario(ctx)
            return

        steps = self.program.scenarios.get(ctx.scenario, [])
        if ctx.step >= len(steps):
            ctx.scenario          = None
            ctx.step              = 0
            ctx.waiting_for       = None
            ctx.current_step_name = None
            return
        stmt = steps[ctx.step]
        ctx.step += 1
        ctx._repeat_requested = False  # сбрасываем флаг перед каждым шагом
        ctx._transition_made = False  # сбрасываем флаг перехода
        self._exec(stmt, ctx)
        if getattr(ctx, "_repeat_requested", False):
            # повторить шаг: ctx.step уже отмотан назад — запускаем нужный шаг
            ctx._repeat_requested = False
            self._continue_scenario(ctx)
            return
        elif getattr(ctx, "_transition_made", False):
            # был явный переход через "перейти" — продолжаем автоматически
            ctx._transition_made = False
            self._continue_scenario(ctx)
            return
        elif ctx.waiting_for is None:
            # FSM: шаг выполнен, ожидания ввода нет — переходим к следующему шагу
            self._continue_scenario(ctx)
            return
