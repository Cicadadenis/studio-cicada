"""
Cicada Parser — превращает .cicada файл в AST (дерево программы).

Синтаксис поддерживается:
    бот "TOKEN"
    при старте: ...
    если текст == "X": ...
    иначе: ...
    ответ "текст" / ответ "текст" + переменная
    спросить "вопрос" → переменная
    запомни переменная = значение
    сценарий имя: ...
    кнопки "A" "B" "C"
    кнопки "A|B|C"          — то же, что три кнопки в один ряд (разделитель | внутри строки)
    картинка "url"
    стикер "file_id"
"""

import json as _json
import re
import random
from dataclasses import dataclass, field
from typing import Any


# ─────────────────────────── AST nodes ────────────────────────────

@dataclass
class Program:
    config: dict = field(default_factory=dict)
    handlers: list = field(default_factory=list)   # on_start, on_text, on_command
    scenarios: dict = field(default_factory=dict)  # name → list[Node]
    blocks: dict = field(default_factory=dict)      # name → Block
    globals: dict = field(default_factory=dict)     # глобальные переменные




def merge_programs(target: Program, imported: Program) -> Program:
    """Объединяет импортированный модуль с текущей программой.

    Импортированные handlers добавляются в конец, сценарии/блоки/globals
    дополняют текущую программу, а config заполняется только отсутствующими ключами,
    чтобы основной файл оставался главным источником настроек.
    """
    for key, value in imported.config.items():
        target.config.setdefault(key, value)
    target.handlers.extend(imported.handlers)
    target.scenarios.update(imported.scenarios)
    target.blocks.update(imported.blocks)
    target.globals.update(imported.globals)
    return target

@dataclass
class Handler:
    kind: str          # "start" | "text" | "command" | "button"
    trigger: Any       # None / str / list[str]
    body: list = field(default_factory=list)


@dataclass
class Scenario:
    name: str
    steps: list = field(default_factory=list)


# ── statement nodes ──

@dataclass
class Reply:
    parts: list   # list of str / VarRef


@dataclass
class Ask:
    question: str
    variable: str


@dataclass
class RandomReply:
    """Случайный ответ из списка вариантов"""
    variants: list  # список строк


@dataclass
class Remember:
    name: str
    value: Any    # str | int | float | VarRef | Expr


@dataclass
class If:
    condition: "Condition"
    then_body: list
    else_body: list = field(default_factory=list)


@dataclass
class Condition:
    left: Any
    op: str
    right: Any
    negate: bool = False  # для оператора "не"


@dataclass
class ComplexCondition:
    """Сложное условие с логическими операторами (и, или)"""
    conditions: list  # список Condition
    operators: list   # список операторов: "и" или "или"


@dataclass
class Buttons:
    labels: list  # может быть списком строк или списком списков (матрица)


@dataclass
class InlineButton:
    """Кнопка с callback_data или URL"""
    text: str
    callback: str = ""      # callback_data
    url: str = ""           # URL для открытия
    data: str = ""          # дополнительные данные


@dataclass
class InlineKeyboard:
    """
    Inline-клавиатура: матрица кнопок — список рядов, каждый ряд список InlineButton.
    Парсится из блока:
        inline-кнопки:
            ["Да" → "cb_yes", "Нет" → "cb_no"]
            ["Отмена" → "cb_cancel"]
    Весь блок = одно сообщение с InlineKeyboardMarkup.
    """
    rows: list   # list[list[InlineButton]]


@dataclass
class InlineKeyboardFromList:
    """Динамическая inline-клавиатура из списка объектов/строк."""
    items_expr: Any
    text_field: str = "name"
    id_field: str = "id"
    callback_prefix: str = "товар_"
    columns: int = 1
    append_back: bool = True


@dataclass
class InlineKeyboardFromDB:
    """Динамическая inline-клавиатура из списка в БД текущего пользователя."""
    key: object
    text_field: str = "name"
    id_field: str = "id"
    callback_prefix: str = ""
    columns: int = 1
    back_text: str = ""
    back_callback: str = ""


@dataclass
class Photo:
    url: str


@dataclass
class PhotoVar:
    """Картинка из переменной"""
    var_name: str


@dataclass
class Sticker:
    file_id: str


@dataclass
class StartScenario:
    """Запустить именованный сценарий"""
    name: str


@dataclass
class Step:
    """Именованный шаг внутри сценария"""
    name: str
    body: list = field(default_factory=list)


@dataclass
class ReturnFromScenario:
    """Вернуться из сценария (прервать текущий шаг, но не сценарий полностью)"""
    pass


@dataclass
class RepeatStep:
    """Повторить текущий шаг сценария"""
    pass


@dataclass
class GotoStep:
    """Перейти к конкретному шагу сценария"""
    step_name: str


@dataclass
class EndScenario:
    """Прерывает выполнение текущего сценария"""
    pass


@dataclass
class SaveToDB:
    """Сохраняет значение в базу данных"""
    key: str
    value: Any


@dataclass
class LoadFromDB:
    """Загружает значение из базы данных"""
    variable: str
    key: str


@dataclass
class ForwardPhoto:
    caption: str = ""


@dataclass
class SaveFile:
    variable: str


@dataclass
class SendDocument:
    file: str
    caption: str = ""


@dataclass
class SendAudio:
    file: str
    caption: str = ""


@dataclass
class SendVideo:
    file: str
    caption: str = ""


@dataclass
class SendVoice:
    file: str
    caption: str = ""


@dataclass
class SendLocation:
    latitude: float
    longitude: float


@dataclass
class SendContact:
    phone: str
    name: str


@dataclass
class SendPoll:
    question: str
    options: list


@dataclass
class SendInvoice:
    title: str
    description: str
    amount: int


@dataclass
class SendGame:
    short_name: str


@dataclass
class SendMarkdown:
    parts: list


@dataclass
class DownloadFile:
    variable: str
    save_path: str = ""


@dataclass
class HttpGet:
    """HTTP GET запрос"""
    url: object
    variable: str  # куда сохранить результат
    headers: dict = field(default_factory=dict)


@dataclass
class HttpPost:
    """HTTP POST запрос"""
    url: object
    data: Any      # тело запроса
    variable: str  # куда сохранить результат
    headers: dict = field(default_factory=dict)


@dataclass
class Log:
    """Вывод значения в консоль (для отладки)"""
    parts: list   # список str / VarRef для вывода


@dataclass
class Sleep:
    """Задержка в секундах"""
    seconds: float


@dataclass
class TelegramAPI:
    """Универсальный вызов Telegram API"""
    method: str      # метод API (sendMessage, editMessageText и т.д.)
    params: dict     # параметры вызова


@dataclass
class GlobalVar:
    """Глобальная переменная (доступна всем пользователям)"""
    name: str
    value: Any


@dataclass
class BeforeEach:
    """Middleware — выполняется перед каждым сообщением"""
    body: list


@dataclass
class AfterEach:
    """Middleware — выполняется после каждого сообщения"""
    body: list


@dataclass
class Block:
    """Переиспользуемый блок кода"""
    name: str
    body: list


@dataclass
class UseBlock:
    """Использование (вставка) блока"""
    name: str


@dataclass
class VarRef:
    """Устаревший узел — оставлен для совместимости. Используйте Variable."""
    name: str


@dataclass
class Expr:
    """Устаревший узел — оставлен для совместимости."""
    parts: list   # mix of str / VarRef


@dataclass
class FunctionCall:
    """Устаревший узел — оставлен для совместимости. Используйте Call."""
    name: str
    args: list


# ── Составные типы и коллекции ─────────────────────────────

@dataclass
class ListLiteral:
    """Литерал массива: [1, 2, 3] или ['a', 'b']"""
    items: list


@dataclass
class DictLiteral:
    """Литерал словаря: {ключ: значение, ...}"""
    pairs: list  # список (key, value) tuples


@dataclass
class Index:
    """Индексация: массив[0] или словарь['ключ']"""
    target: object  # что индексируем
    key: object     # ключ/индекс


@dataclass
class Attr:
    """Доступ к атрибуту: пользователь.имя, чат.id"""
    target: object  # объект
    name: str       # имя атрибута


@dataclass
class ForEach:
    """Цикл по коллекции: для каждого элемента в списке"""
    variable: str   # имя переменной
    collection: object  # что перебираем
    body: list      # тело цикла


@dataclass
class WhileLoop:
    """Цикл while: пока условие: тело"""
    condition: object
    body: list


@dataclass
class BreakLoop:
    """Прервать цикл (break)"""
    pass


@dataclass
class ContinueLoop:
    """Продолжить следующую итерацию (continue)"""
    pass


@dataclass
class Timeout:
    """Выполнение с ограничением времени: таймаут N секунд: тело"""
    seconds: float
    body: list


# ── Уведомления и рассылка ────────────────────────────────────────────

@dataclass
class Notify:
    """уведомить USER_ID "текст" — отправка сообщения конкретному пользователю"""
    user_id: object   # выражение → user_id
    parts: list       # список частей текста


@dataclass
class Broadcast:
    """рассылка всем: текст / рассылка группе TAG: текст"""
    parts: list       # список частей текста
    segment: str = "" # "" = все, иначе — имя сегмента


# ── Telegram-специфика ───────────────────────────────────────────────

@dataclass
class CheckSubscription:
    """проверить подписку @канал → переменная"""
    channel: object   # "@channel" или выражение
    variable: str


@dataclass
class GetChatMemberRole:
    """роль @канал USER_ID → переменная"""
    chat: object      # chat_id / "@channel"
    user_id: object   # user_id
    variable: str


@dataclass
class ForwardMsg:
    """переслать сообщение USER_ID — пересылает текущее сообщение другому пользователю"""
    to_user_id: object


# ── Файлы и JSON ────────────────────────────────────────────────────

@dataclass
class LoadJson:
    """json_файл "путь" → переменная"""
    path: object
    variable: str


@dataclass
class ParseJson:
    """разобрать_json источник → переменная"""
    source: object
    variable: str


@dataclass
class SaveJson:
    """сохранить_json "путь" = переменная"""
    path: object
    source_var: str


@dataclass
class DeleteFile:
    """удалить_файл 'путь' — удаление файла с диска"""
    path: object


@dataclass
class DeleteDictKey:
    """удалить объект["ключ"] — удаление поля из dict"""
    target: str    # имя переменной
    key: object    # ключ (выражение)


@dataclass
class SetDictKey:
    """объект["ключ"] = значение — присваивание поля dict"""
    target: str    # имя переменной
    key: object    # ключ (выражение)
    value: object  # значение (выражение)


# ── HTTP расширения ──────────────────────────────────────────────────

@dataclass
class HttpPatch:
    """HTTP PATCH запрос"""
    url: object
    data: object
    variable: str
    headers: dict = field(default_factory=dict)


@dataclass
class HttpPut:
    """HTTP PUT запрос"""
    url: object
    data: object
    variable: str
    headers: dict = field(default_factory=dict)


@dataclass
class HttpDelete:
    """HTTP DELETE запрос"""
    url: object
    variable: str
    headers: dict = field(default_factory=dict)


@dataclass
class SetHttpHeaders:
    """http_заголовки переменная — устанавливает заголовки для следующих HTTP-вызовов"""
    variable: str


@dataclass
class FetchJson:
    """fetch_json url → переменная — GET + JSON.parse"""
    url: object
    variable: str
    headers: dict = field(default_factory=dict)


# ── База данных расширения ────────────────────────────────────────────

@dataclass
class DeleteFromDB:
    """удалить "ключ" — удаление ключа из БД текущего пользователя"""
    key: object


@dataclass
class GetAllDBKeys:
    """все_ключи → переменная — все ключи пользователя из БД"""
    variable: str


@dataclass
class SaveGlobalDB:
    """сохранить_глобально "ключ" = значение"""
    key: object
    value: object


@dataclass
class LoadFromUserDB:
    """получить от USER_ID "ключ" → переменная"""
    user_id: object
    key: object
    variable: str


# ── Управление потоком расширения ────────────────────────────────────

@dataclass
class ReturnValue:
    """вернуть значение — возврат значения из блока"""
    value: object


@dataclass
class CallBlock:
    """вызвать "блок" → переменная — вызов блока как функции"""
    name: str
    variable: str = ""


# ─────────────────────────── Expression AST ───────────────────────────
# Полноценное дерево выражений: поддерживает арифметику, сравнения,
# вложенные вызовы функций, логические операторы.

@dataclass
class Literal:
    """Константа: число, строка, bool."""
    value: object   # int | float | str | bool

    def __repr__(self):
        return f"Literal({self.value!r})"


@dataclass
class Variable:
    """Ссылка на переменную контекста (заменяет VarRef)."""
    name: str

    def __repr__(self):
        return f"Variable({self.name!r})"


@dataclass
class BinaryOp:
    """Бинарная операция: left OP right.

    Поддерживаемые OP:
      арифметика : +  -  *  /  //  %  **
      сравнение  : ==  !=  >  <  >=  <=
      строки     : содержит  начинается_с
      логика     : и  или
    """
    left: object
    op: str
    right: object

    def __repr__(self):
        return f"BinaryOp({self.left!r} {self.op} {self.right!r})"


@dataclass
class UnaryOp:
    """Унарная операция: не / унарный минус."""
    op: str     # "не" | "-"
    operand: object

    def __repr__(self):
        return f"UnaryOp({self.op} {self.operand!r})"


@dataclass
class Call:
    """Вызов встроенной функции: имя(арг1, арг2, ...)."""
    name: str
    args: list

    def __repr__(self):
        return f"Call({self.name}({', '.join(repr(a) for a in self.args)}))"


# ─────────────────────────── Expression parser ────────────────────

def parse_expr(raw: str):
    """
    Парсит строку в дерево выражений (Expression AST).

    Приоритет операторов (от низкого к высокому):
      1. или
      2. и
      3. не
      4. ==  !=  >  <  >=  <=  содержит  начинается_с
      5. +  -
      6. *  /  //  %
      7. **  (правоассоциативный)
      8. унарный -
      9. атом: literal, variable, func(), (expr)
    """
    tokens = _tokenize_expr(raw.strip())
    if not tokens:
        return Literal("")
    ep = _ExprParser(tokens)
    node = ep.parse_or()
    if ep.pos < len(tokens):
        remaining = " ".join(str(t) for t in tokens[ep.pos:])
        raise SyntaxError(f"Непарсированный остаток выражения: {remaining!r}")
    return node


def _tokenize_expr(src: str) -> list:
    """Разбивает строку выражения на токены."""
    token_re = re.compile(
        r'"[^"]*"'                                      # строка в двойных кавычках
        r"|'[^']*'"                                     # строка в одинарных кавычках
        r'|\d+(?:\.\d+)?'                               # число
        # Идентификаторы И ключевые слова — одним паттерном.
        # Ключевые слова выделяются постобработкой, а не отдельным альтернативным
        # паттерном, чтобы «или» в «переменная» не съедало часть идентификатора.
        r'|[а-яёА-ЯЁa-zA-Z_][а-яёА-ЯЁa-zA-Z0-9_.]*'  # идентификатор / ключевое слово
        r'|\*\*|//|>=|<=|==|!='                        # двойные операторы
        r'|[+\-*/%><!(),\[\]]'                         # одиночные операторы
        r'|\s+'                                         # пробелы
    )
    return [m.group() for m in token_re.finditer(src) if m.group().strip()]


class _ExprParser:
    def __init__(self, tokens: list):
        self.tokens = tokens
        self.pos = 0

    def peek(self):
        return self.tokens[self.pos] if self.pos < len(self.tokens) else None

    def consume(self, expected=None):
        t = self.peek()
        if expected is not None and t != expected:
            raise SyntaxError(f"Ожидалось {expected!r}, получено {t!r}")
        self.pos += 1
        return t

    def parse_or(self):
        node = self.parse_and()
        while self.peek() == "или":
            self.consume()
            node = BinaryOp(node, "или", self.parse_and())
        return node

    def parse_and(self):
        node = self.parse_not()
        while self.peek() == "и":
            self.consume()
            node = BinaryOp(node, "и", self.parse_not())
        return node

    def parse_not(self):
        if self.peek() == "не":
            self.consume()
            return UnaryOp("не", self.parse_not())
        return self.parse_comparison()

    def parse_comparison(self):
        node = self.parse_addition()
        ops = {"==", "!=", ">", "<", ">=", "<=", "содержит", "начинается_с", "в"}
        while self.peek() in ops:
            op = self.consume()
            node = BinaryOp(node, op, self.parse_addition())
        return node

    def parse_addition(self):
        node = self.parse_multiplication()
        while self.peek() in ("+", "-"):
            op = self.consume()
            node = BinaryOp(node, op, self.parse_multiplication())
        return node

    def parse_multiplication(self):
        node = self.parse_power()
        while self.peek() in ("*", "/", "//", "%"):
            op = self.consume()
            node = BinaryOp(node, op, self.parse_power())
        return node

    def parse_power(self):
        node = self.parse_unary()
        if self.peek() == "**":
            self.consume()
            node = BinaryOp(node, "**", self.parse_power())   # правоассоциативный
        return node

    def parse_unary(self):
        if self.peek() == "-":
            self.consume()
            return UnaryOp("-", self.parse_unary())
        return self.parse_atom()

    def parse_atom(self):
        t = self.peek()
        if t is None:
            raise SyntaxError("Неожиданный конец выражения")

        # скобки
        if t == "(":
            self.consume("(")
            node = self.parse_or()
            self.consume(")")
            return self._parse_postfix(node)

        # список [a, b, c]
        if t == "[":
            self.consume("[")
            items = []
            while self.peek() != "]":
                if items:
                    self.consume(",")
                items.append(self.parse_or())
            self.consume("]")
            return self._parse_postfix(ListLiteral(items))

        # строки
        if t.startswith('"') or t.startswith("'"):
            self.consume()
            return Literal(t[1:-1].replace('\\n', '\n'))

        # bool / None
        if t in ("истина", "true"):
            self.consume(); return Literal(True)
        if t in ("ложь", "false"):
            self.consume(); return Literal(False)
        if t in ("пусто", "None", "null"):
            self.consume(); return Literal(None)

        # числа
        if re.match(r'^\d+(?:\.\d+)?$', t):
            self.consume()
            return Literal(int(t) if '.' not in t else float(t))

        # идентификатор, вызов функции или индексирование
        if re.match(r'^[а-яёА-ЯЁa-zA-Z_][а-яёА-ЯЁa-zA-Z0-9_.]*$', t):
            name = self.consume()
            if self.peek() == "(":
                self.consume("(")
                args = []
                while self.peek() != ")":
                    if args:
                        self.consume(",")
                    args.append(self.parse_or())
                self.consume(")")
                return self._parse_postfix(Call(name, args))
            return self._parse_postfix(Variable(name))

        raise SyntaxError(f"Неожиданный токен в выражении: {t!r}")

    def _parse_postfix(self, node):
        """Обрабатывает постфиксные операторы: obj[key]."""
        while self.peek() == "[":
            self.consume("[")
            key = self.parse_or()
            self.consume("]")
            node = Index(node, key)
        return node


# ─────────────────────────── Tokeniser ────────────────────────────

def tokenise(text: str):
    """Split source into logical lines, stripping comments."""
    lines = []
    for raw in text.splitlines():
        line = raw.split("#")[0].rstrip()
        if line.strip():
            lines.append(line)
    return lines


def indent_of(line: str) -> int:
    return len(line) - len(line.lstrip())


def parse_string_expr(raw: str) -> list:
    """
    Разбирает строку-шаблон в список частей [str | Variable | BinaryOp ...].

    Поддерживает:
      "Привет " + имя + " как дела"  →  [str, Variable, str]
      "Привет {имя}!"                →  [str, Variable, str]
      имя + " баланс: " + баланс     →  цепочка через +

    Возвращает список, совместимый с ctx.render().
    """
    raw = raw.strip()

    # Шаблон вида "Привет {имя}!" — строка с {} внутри
    stripped_quote = None
    if (raw.startswith('"') and raw.endswith('"')) or (raw.startswith("'") and raw.endswith("'")):
        stripped_quote = raw[1:-1].replace('\\n', '\n')
    if stripped_quote and '{' in stripped_quote:
        parts = []
        pattern = r'\{([^}]+)\}'
        last_end = 0
        for match in re.finditer(pattern, stripped_quote):
            if match.start() > last_end:
                parts.append(stripped_quote[last_end:match.start()])
            # внутри {} может быть любое выражение
            inner = match.group(1).strip()
            try:
                parts.append(parse_expr(inner))
            except SyntaxError:
                parts.append(Variable(inner))
            last_end = match.end()
        if last_end < len(stripped_quote):
            parts.append(stripped_quote[last_end:])
        return parts if parts else [""]

    # Парсим как полное выражение через Expression AST
    try:
        node = parse_expr(raw)
        # Если это просто строковый Literal — возвращаем напрямую
        if isinstance(node, Literal) and isinstance(node.value, str):
            return [node.value]
        # Если это BinaryOp(+) на верхнем уровне — раскладываем в список
        return _flatten_concat(node)
    except SyntaxError:
        # Фоллбэк: вернуть как строку
        return [raw]


def _flatten_concat(node) -> list:
    """Разворачивает цепочку BinaryOp('+') в плоский список частей."""
    if isinstance(node, BinaryOp) and node.op == "+":
        return _flatten_concat(node.left) + _flatten_concat(node.right)
    if isinstance(node, Literal) and isinstance(node.value, str):
        return [node.value]
    if isinstance(node, Literal):
        return [str(node.value)]
    # Variable и всё остальное — оставляем как есть (executor вычислит)
    return [node]


def _unwrap_literal(node):
    """Разворачивает Literal в примитивное значение (для кнопок, globals и т.д.)"""
    if isinstance(node, Literal):
        return node.value
    return node


def parse_value(raw: str):
    """Обёртка для обратной совместимости — делегирует в parse_expr."""
    raw = raw.strip()
    if raw.startswith(("[", "{")) and raw.endswith(("]", "}")):
        try:
            return _json.loads(raw)
        except _json.JSONDecodeError:
            pass
    # Массив: ["A", "B", "C"] — не поддерживается expression-парсером
    if raw.startswith('[') and raw.endswith(']'):
        items_str = raw[1:-1].strip()
        if not items_str:
            return []
        items = []
        for item in re.split(r',\s*', items_str):
            items.append(parse_value(item.strip()))
        return items
    try:
        node = parse_expr(raw)
        # Для простых литералов сразу возвращаем значение (не Literal-обёртку)
        # чтобы они не ломали JSON-сериализацию в кнопках и globals
        return _unwrap_literal(node)
    except SyntaxError:
        return VarRef(raw)  # совместимость: нераспознанное → VarRef


def _parse_inline_button_row_labels(rest: str) -> list:
    """
    Список подписей для одного ряда кнопок после слова «кнопки».
    Поддержка:
      кнопки "A" "B" "C"
      кнопки "A|B|C"     — один ряд из трёх кнопок (частый формат из документации DSL)
    """
    rest = rest.strip()
    labels = re.findall(r'"([^"]+)"', rest)
    if len(labels) == 1 and "|" in labels[0]:
        return [part.strip() for part in labels[0].split("|") if part.strip()]
    return labels


def parse_simple_condition(raw: str) -> "BinaryOp | UnaryOp | Variable | Literal":
    """Парсит одно условие через Expression AST.

    Возвращает Expression-узел, который executor вычислит через eval_expr().
    Для совместимости может вернуть Condition (старый путь) если parse_expr не справился.
    """
    raw = raw.strip()
    try:
        return parse_expr(raw)
    except SyntaxError:
        # Фоллбэк на старый парсер условий
        negate = False
        if raw.startswith("не "):
            negate = True
            raw = raw[3:].strip()
        for op in ("==", "!=", ">=", "<=", ">", "<", "содержит"):
            if op in raw:
                left, right = raw.split(op, 1)
                return Condition(VarRef(left.strip()), op, VarRef(right.strip()), negate)
        return Condition(VarRef(raw), "!=", "", negate)


def parse_condition(raw: str):
    """Парсит условие (простое или сложное) через Expression AST."""
    raw = raw.strip()
    try:
        return parse_expr(raw)
    except SyntaxError:
        # Фоллбэк на старый парсер для совместимости
        or_parts = re.split(r'\s+или\s+', raw)
        if len(or_parts) > 1:
            conditions = [parse_simple_condition(p) for p in or_parts]
            return ComplexCondition(conditions, ["или"] * (len(conditions) - 1))
        and_parts = re.split(r'\s+и\s+', raw)
        if len(and_parts) > 1:
            conditions = [parse_simple_condition(p) for p in and_parts]
            return ComplexCondition(conditions, ["и"] * (len(conditions) - 1))
        return parse_simple_condition(raw)




# ─────────────────────────── Parser ───────────────────────────────

class Parser:
    def __init__(self, source: str, base_path: str = ""):
        self.lines = tokenise(source)
        self.pos = 0
        self.base_path = base_path  # для разрешения импортов

    def peek(self):
        if self.pos < len(self.lines):
            return self.lines[self.pos]
        return None

    def consume(self):
        line = self.lines[self.pos]
        self.pos += 1
        return line

    def parse(self) -> Program:
        prog = Program()

        while self.pos < len(self.lines):
            line = self.peek().strip()

            # ── версия "1.0" ──
            m = re.match(r'^версия\s+"([^"]+)"$', line)
            if m:
                prog.config["version"] = m.group(1)
                self.consume()
                continue

            # ── команды: (меню бота) ──
            if line == "команды:" or line == "команды":
                self.consume()
                commands = self._parse_commands_block()
                prog.config["commands"] = commands
                continue

            # ── глобально переменная = значение ──
            m = re.match(r'^глобально\s+(\w+)\s*=\s*(.+)$', line)
            if m:
                self.consume()
                prog.globals[m.group(1)] = parse_value(m.group(2))
                continue

            # ── бот "TOKEN" ──
            m = re.match(r'^бот\s+"([^"]+)"$', line)
            if m:
                prog.config["token"] = m.group(1)
                self.consume()
                continue

            # ── импорт "файл.ccd" или импорт "cicada.shop" ──
            m = re.match(r'^импорт\s+"([^"]+)"$', line)
            if m:
                import_path = m.group(1)
                self.consume()
                # Загружаем и парсим импортированный файл
                try:
                    import os
                    # Пакетная система: cicada.shop -> cicada_modules/shop/index.ccd
                    if import_path.startswith("cicada."):
                        package_parts = import_path.split(".")
                        package_path = os.path.join("cicada_modules", *package_parts[1:], "index.ccd")
                        full_path = os.path.join(self.base_path, package_path)
                        # Если не найден как пакет, пробуем как обычный путь
                        if not os.path.exists(full_path):
                            alt_path = os.path.join(self.base_path, *package_parts[1:]) + ".ccd"
                            if os.path.exists(alt_path):
                                full_path = alt_path
                    else:
                        full_path = os.path.join(self.base_path, import_path)
                    
                    with open(full_path, "r", encoding="utf-8") as f:
                        import_source = f.read()
                    import_dir = os.path.dirname(full_path)
                    import_parser = Parser(import_source, import_dir)
                    import_prog = import_parser.parse()
                    # Объединяем модуль целиком: config, globals, blocks, handlers, scenarios
                    merge_programs(prog, import_prog)
                except FileNotFoundError:
                    raise SyntaxError(f"Импорт не найден: {import_path}")
                except Exception as e:
                    raise SyntaxError(f"Ошибка импорта {import_path}: {e}")
                continue

            # ── кнопки: (блочный формат с матрицей) ──
            if line == "кнопки:" or line == "кнопки":
                self.consume()
                matrix = []
                base_indent = None
                while self.pos < len(self.lines):
                    row_line = self.lines[self.pos]
                    stripped = row_line.strip()
                    if not stripped:
                        self.consume()
                        continue
                    # Определяем базовый отступ
                    if base_indent is None and row_line.startswith(" "):
                        base_indent = len(row_line) - len(row_line.lstrip())
                    current_indent = len(row_line) - len(row_line.lstrip()) if row_line.startswith(" ") else 0
                    # Если отступ уменьшился и строка не пустая - конец блока
                    if base_indent and current_indent < base_indent and stripped:
                        break
                    # Парсим строку как массив
                    if stripped.startswith("[") and stripped.endswith("]"):
                        self.consume()
                        row = parse_value(stripped)
                        if isinstance(row, list):
                            matrix.append(row)
                    else:
                        # Неизвестная строка - выходим
                        break
                if matrix:
                    prog.handlers.append(Handler("reply", None, [Buttons(matrix)]))
                continue

            # ── до каждого: (middleware) ──
            if line.startswith("до каждого:") or line == "до каждого":
                self.consume()
                body = self._parse_block()
                prog.handlers.append(Handler("before_each", None, body))
                continue

            # ── после каждого: (middleware) ──
            if line.startswith("после каждого:") or line == "после каждого":
                self.consume()
                body = self._parse_block()
                prog.handlers.append(Handler("after_each", None, body))
                continue

            # ── при старте: или старт: ──
            if line.startswith("при старте:") or line == "при старте" or line.startswith("старт:") or line == "старт":
                self.consume()
                body = self._parse_block()
                prog.handlers.append(Handler("start", None, body))
                continue

            # ── при команде "/cmd": или команда "/cmd": ──
            m = re.match(r'^при команде\s+"(/\w+)"\s*:', line)
            if not m:
                m = re.match(r'^команда\s+"(/\w+)"\s*:', line)
            if m:
                cmd = m.group(1)
                self.consume()
                body = self._parse_block()
                prog.handlers.append(Handler("command", cmd, body))
                continue

            # ── при тексте "слово": — хендлер на конкретный текст ──
            m = re.match(r'^при тексте\s+"([^"]+)"\s*:', line)
            if m:
                self.consume()
                body = self._parse_block()
                prog.handlers.append(Handler("text", m.group(1), body))
                continue

            # ── при тексте: — хендлер на любой текст ──
            if line.startswith("при тексте:") or line == "при тексте":
                self.consume()
                body = self._parse_block()
                prog.handlers.append(Handler("text", None, body))
                continue

            # ── при нажатии "callback": или при нажатии: ──
            m = re.match(r'^при нажатии\s+"([^"]+)"\s*:', line)
            if m:
                callback = m.group(1)
                self.consume()
                body = self._parse_block()
                prog.handlers.append(Handler("callback", callback, body))
                continue
            
            if line.startswith("при нажатии:") or line == "при нажатии":
                self.consume()
                body = self._parse_block()
                prog.handlers.append(Handler("callback", None, body))
                continue

            # ── иначе: (верхнеуровневый) ──
            if line.startswith("иначе:") or line == "иначе":
                self.consume()
                body = self._parse_block()
                prog.handlers.append(Handler("else", None, body))
                continue

            # ── если условие: ──
            m = re.match(r'^если\s+(.+):\s*$', line)
            if m:
                self.consume()
                cond = parse_condition(m.group(1))
                then_body = self._parse_block()
                prog.handlers.append(
                    Handler("text", None, [If(cond, then_body, [])])
                )
                continue

            # ── при получении фото: ──
            if line.startswith("при фото:") or line == "при фото":
                self.consume()
                body = self._parse_block()
                prog.handlers.append(Handler("photo_received", None, body))
                continue

            # ── при получении документа: ──
            # README и сценарии часто пишут «при документ:» — поддерживаем наряду с «при документе:»
            if (
                line.startswith("при документе:")
                or line == "при документе"
                or line.startswith("при документ:")
                or line == "при документ"
            ):
                self.consume()
                body = self._parse_block()
                prog.handlers.append(Handler("document_received", None, body))
                continue

            # ── при получении голосового: ──
            if line.startswith("при голосовом:") or line == "при голосовом":
                self.consume()
                body = self._parse_block()
                prog.handlers.append(Handler("voice_received", None, body))
                continue

            # ── при получении стикера: ──
            if line.startswith("при стикере:") or line == "при стикере":
                self.consume()
                body = self._parse_block()
                prog.handlers.append(Handler("sticker_received", None, body))
                continue

            # ── при геолокации: ──
            if line.startswith("при геолокации:") or line == "при геолокации":
                self.consume()
                body = self._parse_block()
                prog.handlers.append(Handler("location_received", None, body))
                continue

            # ── при контакте: ──
            if line.startswith("при контакте:") or line == "при контакте":
                self.consume()
                body = self._parse_block()
                prog.handlers.append(Handler("contact_received", None, body))
                continue

            # ── сценарий имя: ──
            m = re.match(r'^сценарий\s+(\w+)\s*:', line)
            if m:
                name = m.group(1)
                self.consume()
                steps = self._parse_block()
                prog.scenarios[name] = steps
                continue

            # ── блок имя: ──
            m = re.match(r'^блок\s+(\w+)\s*:', line)
            if m:
                name = m.group(1)
                self.consume()
                body = self._parse_block()
                prog.blocks[name] = Block(name, body)
                continue

            # любые другие верхнеуровневые инструкции → в дефолтный обработчик
            stmt = self._parse_stmt(self.consume())
            if stmt:
                prog.handlers.append(Handler("any", None, [stmt]))

        return prog

    def _parse_block(self) -> list:
        """Читает с отступом блок инструкций."""
        stmts = []
        base = None
        while self.pos < len(self.lines):
            line = self.peek()
            ind = indent_of(line)
            stripped = line.strip()

            if base is None:
                if ind == 0:
                    break
                base = ind
            else:
                if ind < base:
                    break

            # вложенные если
            m = re.match(r'^если\s+(.+):\s*$', stripped)
            if m:
                self.consume()
                cond = parse_condition(m.group(1))
                then_body = self._parse_block()
                else_body = []
                if self.peek() and self.peek().strip().startswith("иначе"):
                    self.consume()
                    else_body = self._parse_block()
                stmts.append(If(cond, then_body, else_body))
                continue

            # шаг в сценарии
            m = re.match(r'^шаг\s+(\w+):\s*$', stripped)
            if m:
                self.consume()
                step_name = m.group(1)
                step_body = self._parse_block()
                stmts.append(Step(step_name, step_body))
                continue

            # для каждого VAR в COLLECTION:
            m = re.match(r'^для каждого\s+(\w+)\s+в\s+(.+):\s*$', stripped)
            if m:
                self.consume()
                var_name = m.group(1)
                collection = parse_value(m.group(2).strip())
                body = self._parse_block()
                stmts.append(ForEach(variable=var_name, collection=collection, body=body))
                continue

            # пока условие: (цикл while — настоящий)
            m = re.match(r'^пока\s+(.+):\s*$', stripped)
            if m:
                self.consume()
                cond = parse_condition(m.group(1))
                body = self._parse_block()
                stmts.append(WhileLoop(condition=cond, body=body))
                continue

            # прервать — break
            if stripped == "прервать":
                self.consume()
                stmts.append(BreakLoop())
                continue

            # продолжить — continue
            if stripped == "продолжить":
                self.consume()
                stmts.append(ContinueLoop())
                continue

            # таймаут N секунд: тело
            m = re.match(r'^таймаут\s+([\d.]+)\s*(?:секунд|с)?\s*:\s*$', stripped)
            if m:
                self.consume()
                body = self._parse_block()
                stmts.append(Timeout(seconds=float(m.group(1)), body=body))
                continue

            # повторять N раз: (теперь реальный цикл через ForEach)
            m = re.match(r'^повторять\s+([\d]+)\s+раз:\s*$', stripped)
            if m:
                self.consume()
                n = int(m.group(1))
                body = self._parse_block()
                stmts.append(ForEach(
                    variable="_",
                    collection=[i for i in range(n)],
                    body=body,
                ))
                continue

            # рандом: (блок случайного ответа)
            if stripped == "рандом:" or stripped == "рандом":
                self.consume()
                variants = []
                while self.pos < len(self.lines):
                    row_line = self.lines[self.pos]
                    row_stripped = row_line.strip()
                    if not row_stripped:
                        self.consume()
                        continue
                    row_ind = len(row_line) - len(row_line.lstrip()) if row_line.startswith(" ") else 0
                    if row_ind <= base:
                        break
                    # строки вида "текст"
                    m2 = re.match(r'^"([^"]+)"$', row_stripped)
                    if m2:
                        variants.append(m2.group(1))
                        self.consume()
                    else:
                        break
                if variants:
                    stmts.append(RandomReply(variants))
                continue

            # inline-кнопки: (блок inline кнопок)
            # Все ряды [...] собираются в один InlineKeyboard — одно сообщение с InlineKeyboardMarkup
            if stripped.startswith("inline-кнопки:") or stripped == "inline-кнопки":
                dyn_match = re.match(r'^inline-кнопки:\s*из\s+(.+?)\s+по\s+([A-Za-z_][\w]*)\s*/\s*([A-Za-z_][\w]*)(?:\s+callback=([^\s]+))?(?:\s+columns=(\d+))?(?:\s+append_back=(true|false))?$', stripped)
                if dyn_match:
                    self.consume()
                    stmts.append(InlineKeyboardFromList(
                        items_expr=parse_expr(dyn_match.group(1)),
                        text_field=dyn_match.group(2),
                        id_field=dyn_match.group(3),
                        callback_prefix=dyn_match.group(4) or "товар_",
                        columns=int(dyn_match.group(5) or "1"),
                        append_back=(dyn_match.group(6) or "true") == "true",
                    ))
                    continue

                self.consume()
                keyboard_rows = []
                while self.pos < len(self.lines):
                    row_line = self.lines[self.pos]
                    row_stripped = row_line.strip()
                    if not row_stripped:
                        self.consume()
                        continue
                    row_ind = len(row_line) - len(row_line.lstrip()) if row_line.startswith(" ") else 0
                    if row_ind <= base:
                        break
                    # строки вида ["Текст" → "cb", "Текст2" → "cb2"]
                    if row_stripped.startswith("[") and row_stripped.endswith("]"):
                        self.consume()
                        inner = row_stripped[1:-1]
                        row_btns = []
                        for btn_str in re.split(r',\s*', inner):
                            btn_str = btn_str.strip()
                            # "Текст" → "callback"
                            bm = re.match(r'"([^"]+)"\s*[→>-]+\s*"([^"]+)"', btn_str)
                            if bm:
                                row_btns.append(InlineButton(text=bm.group(1), callback=bm.group(2)))
                                continue
                            # "Текст" → url "https://..."
                            bmu = re.match(r'"([^"]+)"\s*[→>-]+\s*url\s+"([^"]+)"', btn_str)
                            if bmu:
                                row_btns.append(InlineButton(text=bmu.group(1), url=bmu.group(2)))
                        if row_btns:
                            keyboard_rows.append(row_btns)
                    else:
                        break
                if keyboard_rows:
                    stmts.append(InlineKeyboard(rows=keyboard_rows))
                continue

            # кнопки: (блочный формат с матрицей)
            if stripped == "кнопки:" or stripped == "кнопки":
                self.consume()
                matrix = []
                while self.pos < len(self.lines):
                    row_line = self.lines[self.pos]
                    row_stripped = row_line.strip()
                    if not row_stripped:
                        self.consume()
                        continue
                    row_ind = len(row_line) - len(row_line.lstrip()) if row_line.startswith(" ") else 0
                    # Проверяем отступ - должен быть больше base
                    if row_ind <= base:
                        break
                    if row_stripped.startswith("[") and row_stripped.endswith("]"):
                        self.consume()
                        row = parse_value(row_stripped)
                        if isinstance(row, list):
                            matrix.append(row)
                    else:
                        break
                if matrix:
                    stmts.append(Buttons(matrix))
                continue

            self.consume()
            stmt = self._parse_stmt(stripped)
            if stmt:
                stmts.append(stmt)

        return stmts

    def _parse_stmt(self, line: str):
        line = line.strip()

        # ответ "текст" / ответ "текст" + переменная
        m = re.match(r'^ответ\s+(.+)$', line)
        if m:
            return Reply(parse_string_expr(m.group(1)))

        # спросить "вопрос" → переменная  (поддержка → и ->)
        m = re.match(r'^спросить\s+"([^"]+)"\s*(?:→|->)\s*(\w+)$', line)
        if m:
            return Ask(m.group(1), m.group(2))
        # спросить "вопрос" без переменной — показываем вопрос как ответ
        m = re.match(r'^спросить\s+"([^"]+)"$', line)
        if m:
            return Ask(m.group(1), "_last_answer")

        # запомни переменная = значение
        m = re.match(r'^запомни\s+(\w+)\s*=\s*(.+)$', line)
        if m:
            return Remember(m.group(1), parse_value(m.group(2)))

        # пусть переменная = значение (типизированное объявление)
        m = re.match(r'^пусть\s+(\w+)\s*=\s*(.+)$', line)
        if m:
            return Remember(m.group(1), parse_value(m.group(2)))

        # кнопки "A" "B" - одна строка
        # кнопки:
        #     ["A", "B"]
        #     ["C"]
        m = re.match(r'^кнопки\s+(.+)$', line)
        if m:
            rest = m.group(1).strip()
            # Проверяем, начинается ли с [ - значит это матрица
            if rest.startswith('['):
                # Парсим как значение (список списков)
                matrix = parse_value(rest)
                if isinstance(matrix, list) and all(isinstance(row, list) for row in matrix):
                    return Buttons(matrix)
                else:
                    return Buttons([matrix])
            else:
                # Один ряд кнопок
                labels = _parse_inline_button_row_labels(rest)
                return Buttons([labels])  # оборачиваем в список для единообразия

        # кнопка "Текст" -> "callback"
        m = re.match(r'^кнопка\s+"([^"]+)"\s*->\s*"([^"]+)"$', line)
        if m:
            return InlineButton(text=m.group(1), callback=m.group(2))

        # кнопка "Текст" -> url "https://..."
        m = re.match(r'^кнопка\s+"([^"]+)"\s*->\s*url\s+"([^"]+)"$', line)
        if m:
            return InlineButton(text=m.group(1), url=m.group(2))

        # inline из бд "ключ" [текст "name"] [id "id"] [callback "prefix"] [columns=2] [назад "Назад" → "cb"]
        m = re.match(r'^(?:inline|inline-кнопки)\s+из\s+бд\s+(.+)$', line)
        if m:
            rest = m.group(1).strip()
            key_match = re.match(r'^("[^"]+"|\w+)', rest)
            if not key_match:
                raise SyntaxError(f"Не понимаю ключ БД в inline из бд: {line}")
            key_raw = key_match.group(1)
            options = rest[key_match.end():].strip()

            text_field = "name"
            id_field = "id"
            callback_prefix = ""
            columns = 1
            back_text = ""
            back_callback = ""

            opt = re.search(r'\bтекст\s+"([^"]+)"', options)
            if opt:
                text_field = opt.group(1)
            opt = re.search(r'\bid\s+"([^"]+)"', options)
            if opt:
                id_field = opt.group(1)
            opt = re.search(r'\bcallback\s+"([^"]*)"', options)
            if opt:
                callback_prefix = opt.group(1)
            opt = re.search(r'\bcolumns\s*=?\s*(\d+)', options)
            if opt:
                columns = int(opt.group(1))
            opt = re.search(r'\bколонки\s+(\d+)', options)
            if opt:
                columns = int(opt.group(1))
            opt = re.search(r'\bназад\s+"([^"]+)"\s*(?:→|->)\s*"([^"]+)"', options)
            if opt:
                back_text = opt.group(1)
                back_callback = opt.group(2)

            return InlineKeyboardFromDB(
                key=parse_value(key_raw),
                text_field=text_field,
                id_field=id_field,
                callback_prefix=callback_prefix,
                columns=columns,
                back_text=back_text,
                back_callback=back_callback,
            )

        # картинка/фото "url" или картинка/фото переменная
        m = re.match(r'^(?:картинка|фото)\s+"([^"]+)"$', line)
        if m:
            return Photo(m.group(1))
        m = re.match(r'^(?:картинка|фото)\s+(\w+)$', line)
        if m:
            return PhotoVar(m.group(1))

        # стикер "file_id"
        m = re.match(r'^стикер\s+"([^"]+)"$', line)
        if m:
            return Sticker(m.group(1))

        # переслать фото (с подписью или без)
        m = re.match(r'^переслать фото\s*"([^"]*)"$', line)
        if m:
            return ForwardPhoto(m.group(1))
        if line == "переслать фото":
            return ForwardPhoto()

        # переслать документ — алиас для отправки текущего document file_id обратно
        m = re.match(r'^переслать документ\s*"([^"]*)"$', line)
        if m:
            return SendDocument(Variable("файл_id"), m.group(1))
        if line == "переслать документ":
            return SendDocument(Variable("файл_id"), "")

        # запомни файл → переменная
        m = re.match(r'^запомни файл\s*→\s*(\w+)$', line)
        if m:
            return SaveFile(m.group(1))

        # запустить сценарий
        m = re.match(r'^запустить\s+(\w+)$', line)
        if m:
            return StartScenario(m.group(1))

        # ответить_md / ответ_md "текст"
        m = re.match(r'^ответ_md\s+(.+)$', line)
        if m:
            return SendMarkdown(parse_string_expr(m.group(1)))

        # документ "путь" / документ "путь" "подпись" / документ "путь" имя="name" / документ переменная
        m = re.match(r'^документ\s+"([^"]+)"(?:\s+имя="[^"]*")?(?:\s+"([^"]*)")?$', line)
        if m:
            return SendDocument(m.group(1), m.group(2) or "")
        m = re.match(r'^документ\s+(\w+)$', line)
        if m:
            return SendDocument(Variable(m.group(1)), "")

        # отправить файл … — алиас «документ» (иначе строка не попадает в AST и молча пропускается)
        m = re.match(r'^отправить файл\s+"([^"]+)"(?:\s+имя="[^"]*")?(?:\s+"([^"]*)")?$', line)
        if m:
            return SendDocument(m.group(1), m.group(2) or "")
        m = re.match(r'^отправить файл\s+(\w+)$', line)
        if m:
            return SendDocument(Variable(m.group(1)), "")

        # аудио "путь" / аудио "путь" "подпись" / аудио переменная
        m = re.match(r'^аудио\s+"([^"]+)"\s*(?:"([^"]*)")?$', line)
        if m:
            return SendAudio(m.group(1), m.group(2) or "")
        m = re.match(r'^аудио\s+(\w+)$', line)
        if m:
            return SendAudio(Variable(m.group(1)), "")

        # видео "путь" / видео "путь" "подпись" / видео переменная
        m = re.match(r'^видео\s+"([^"]+)"\s*(?:"([^"]*)")?$', line)
        if m:
            return SendVideo(m.group(1), m.group(2) or "")
        m = re.match(r'^видео\s+(\w+)$', line)
        if m:
            return SendVideo(Variable(m.group(1)), "")

        # голос "путь" / голос переменная
        m = re.match(r'^голос\s+"([^"]+)"\s*(?:"([^"]*)")?$', line)
        if m:
            return SendVoice(m.group(1), m.group(2) or "")
        m = re.match(r'^голос\s+(\w+)$', line)
        if m:
            return SendVoice(Variable(m.group(1)), "")

        # локация широта долгота
        m = re.match(r'^локация\s+([\d.\-]+)\s+([\d.\-]+)$', line)
        if m:
            return SendLocation(float(m.group(1)), float(m.group(2)))

        # контакт "+телефон" "Имя"
        m = re.match(r'^контакт\s+"([^"]+)"\s+"([^"]+)"$', line)
        if m:
            return SendContact(m.group(1), m.group(2))

        # опрос "вопрос" "вариант1" "вариант2" ...
        m = re.match(r'^опрос\s+"([^"]+)"\s+(.+)$', line)
        if m:
            options = re.findall(r'"([^"]+)"', m.group(2))
            return SendPoll(m.group(1), options)

        # счёт "название" "описание" сумма
        m = re.match(r'^счёт\s+"([^"]+)"\s+"([^"]+)"\s+(\d+)$', line)
        if m:
            return SendInvoice(m.group(1), m.group(2), int(m.group(3)))

        # игра "short_name"
        m = re.match(r'^игра\s+"([^"]+)"$', line)
        if m:
            return SendGame(m.group(1))

        # скачать файл → путь
        m = re.match(r'^скачать\s+файл\s*→\s*"([^"]+)"$', line)
        if m:
            return DownloadFile("файл_id", m.group(1))

        # fetch/http_get URL → переменная
        m = re.match(r'^(?:fetch|http_get)\s+(.+?)\s*→\s*(\w+)$', line)
        if m:
            return HttpGet(url=parse_value(m.group(1)), variable=m.group(2))

        # fetch_json URL → переменная (GET + JSON.parse)
        m = re.match(r'^fetch_json\s+(.+?)\s*→\s*(\w+)$', line)
        if m:
            return FetchJson(url=parse_value(m.group(1)), variable=m.group(2))

        # http_post URL json body → переменная
        m = re.match(r'^http_post\s+(.+?)\s+json\s+(.+?)\s*→\s*(\w+)$', line)
        if m:
            return HttpPost(url=parse_value(m.group(1)), data=parse_value(m.group(2)), variable=m.group(3))

        # http_post URL с data → переменная
        m = re.match(r'^http_post\s+(.+?)\s+с\s+(.+?)\s*→\s*(\w+)$', line)
        if m:
            return HttpPost(url=parse_value(m.group(1)), data=parse_value(m.group(2)), variable=m.group(3))

        # лог "сообщение" / лог[level] "сообщение"
        m = re.match(r'^лог(?:\[[^\]]*\])?\s+(.+)$', line)
        if m:
            return Log(parse_string_expr(m.group(1)))

        # подождать X / пауза Xс / пауза X
        m = re.match(r'^(?:подождать|пауза)\s+([\d.]+)с?$', line)
        if m:
            return Sleep(float(m.group(1)))

        # печатает Xс — typing action (реализуем как Sleep)
        m = re.match(r'^печатает\s+([\d.]+)с?$', line)
        if m:
            return Sleep(float(m.group(1)))

        # tg "sendMessage", {chat_id: чат, text: "..."}
        m = re.match(r'^tg\s+"([^"]+)"\s*,\s*(.+)$', line)
        if m:
            method = m.group(1)
            params_str = m.group(2)
            # Простой парсинг JSON-подобного объекта
            params = {}
            # Извлекаем пары ключ: значение
            for match in re.finditer(r'(\w+)\s*:\s*([^,}]+)', params_str):
                key = match.group(1)
                val = match.group(2).strip().strip('"').strip("'")
                params[key] = val
            return TelegramAPI(method, params)

        # запрос GET url → var  /  запрос POST url → var
        m = re.match(r'^запрос\s+(GET|POST|get|post)\s+(.+?)\s*→\s*(\w+)$', line)
        if m:
            method = m.group(1).upper()
            url = parse_value(m.group(2))
            var = m.group(3)
            if method == "GET":
                return HttpGet(url=url, variable=var)
            else:
                return HttpPost(url=url, data={}, variable=var)

        # уведомление → target "текст"
        m = re.match(r'^уведомление\s*→\s*(\S+)\s+"([^"]+)"$', line)
        if m:
            return Log([f"[уведомление → {m.group(1)}] {m.group(2)}"])

        # запрос_бд "sql" → var
        m = re.match(r'^запрос_бд\s+"([^"]+)"\s*→\s*(\w+)$', line)
        if m:
            return Log([f"[запрос_бд] {m.group(1)} → {m.group(2)}"])

        # классифицировать [...] → var
        m = re.match(r'^классифицировать\s+\[([^\]]+)\]\s*→\s*(\w+)$', line)
        if m:
            return Log([f"[классифицировать] {m.group(1)} → {m.group(2)}"])

        # событие "name" { params }  /  событие "name"
        m = re.match(r'^событие\s+"([^"]+)"', line)
        if m:
            return Log([f"[событие] {m.group(1)}"])

        # оплата provider amount currency "title"
        m = re.match(r'^оплата\s+(\S+)\s+(\S+)\s+(\S+)\s+"([^"]+)"$', line)
        if m:
            return SendInvoice(title=m.group(4), description="", amount=int(float(m.group(2)) * 100))

        # меню "title": (нет поддержки в ядре — пропускаем тело, шлём ответ)
        m = re.match(r'^меню\s+"([^"]+)"\s*:', line)
        if m:
            return Reply([m.group(1)])

        # стоп — завершить сценарий (алиас)
        if line == "стоп":
            return EndScenario()

        # завершить сценарий
        if line == "завершить сценарий":
            return EndScenario()

        # вернуть (из текущего шага сценария)
        if line == "вернуть":
            return ReturnFromScenario()

        # повторить шаг
        if line == "повторить шаг":
            return RepeatStep()

        # перейти к шаг имя  (или сокращённо: перейти имя / перейти "имя")
        m = re.match(r'^перейти к шаг\s+(\w+)$', line)
        if m:
            return GotoStep(m.group(1))
        m = re.match(r'^перейти\s+"([^"]+)"$', line)
        if m:
            return GotoStep(m.group(1))
        m = re.match(r'^перейти\s+(\w+)$', line)
        if m:
            return GotoStep(m.group(1))

        # сохранить "ключ" = значение
        m = re.match(r'^сохранить\s+"([^"]+)"\s*=\s*(.+)$', line)
        if m:
            return SaveToDB(m.group(1), parse_value(m.group(2)))

        # получить "ключ" → переменная
        m = re.match(r'^получить\s+"([^"]+)"\s*→\s*(\w+)$', line)
        if m:
            return LoadFromDB(m.group(2), m.group(1))

        # использовать блок
        m = re.match(r'^использовать\s+(\w+)$', line)
        if m:
            return UseBlock(m.group(1))

        # вызвать "блок" → переменная
        m = re.match(r'^вызвать\s+"([^"]+)"\s*→\s*(\w+)$', line)
        if m:
            return CallBlock(name=m.group(1), variable=m.group(2))
        m = re.match(r'^вызвать\s+"([^"]+)"$', line)
        if m:
            return CallBlock(name=m.group(1), variable="")

        # глобально переменная = значение (внутри хендлера)
        m = re.match(r'^глобально\s+(\w+)\s*=\s*(.+)$', line)
        if m:
            return GlobalVar(m.group(1), parse_value(m.group(2)))

        # ── Уведомления ─────────────────────────────────────────────────

        # уведомить EXPR "текст..." или уведомить EXPR: "текст"
        m = re.match(r'^уведомить\s+(.+?):\s*"(.+)"$', line)
        if not m:
            m = re.match(r'^уведомить\s+(.+?)\s+"(.+)"$', line)
        if m:
            return Notify(user_id=parse_value(m.group(1).strip()),
                          parts=parse_string_expr(f'"{m.group(2)}"'))

        # рассылка всем: "текст"
        m = re.match(r'^рассылка всем:\s*(.+)$', line)
        if m:
            return Broadcast(parts=parse_string_expr(m.group(1)), segment="")

        # рассылка группе TAG: "текст"
        m = re.match(r'^рассылка группе\s+(\S+):\s*(.+)$', line)
        if m:
            return Broadcast(parts=parse_string_expr(m.group(2)), segment=m.group(1))

        # ── Telegram-специфика ────────────────────────────────────────────

        # проверить подписку @канал → переменная
        m = re.match(r'^проверить подписку\s+(@\S+)\s*→\s*(\w+)$', line)
        if m:
            return CheckSubscription(channel=m.group(1), variable=m.group(2))

        # роль @канал USER_ID → переменная
        m = re.match(r'^роль\s+(@?\S+)\s+(.+?)\s*→\s*(\w+)$', line)
        if m:
            return GetChatMemberRole(chat=m.group(1), user_id=parse_value(m.group(2)),
                                     variable=m.group(3))

        # переслать сообщение USER_ID
        m = re.match(r'^переслать сообщение\s+(.+)$', line)
        if m:
            return ForwardMsg(to_user_id=parse_value(m.group(1).strip()))

        # ── Работа с файлами и JSON ──────────────────────────────────────

        # json_файл "путь" → переменная
        m = re.match(r'^json_файл\s+"([^"]+)"\s*→\s*(\w+)$', line)
        if m:
            return LoadJson(path=m.group(1), variable=m.group(2))
        m = re.match(r'^json_файл\s+(\w+)\s*→\s*(\w+)$', line)
        if m:
            return LoadJson(path=parse_value(m.group(1)), variable=m.group(2))

        # разобрать_json источник → переменная
        m = re.match(r'^разобрать_json\s+(.+?)\s*→\s*(\w+)$', line)
        if m:
            return ParseJson(source=parse_value(m.group(1)), variable=m.group(2))

        # сохранить_json "путь" = переменная
        m = re.match(r'^сохранить_json\s+"([^"]+)"\s*=\s*(\w+)$', line)
        if m:
            return SaveJson(path=m.group(1), source_var=m.group(2))

        # удалить_файл "путь"
        m = re.match(r'^удалить_файл\s+"([^"]+)"$', line)
        if m:
            return DeleteFile(path=m.group(1))
        m = re.match(r'^удалить_файл\s+(\w+)$', line)
        if m:
            return DeleteFile(path=parse_value(m.group(1)))

        # удалить объект["ключ"] — удаление поля dict (перед общим 'удалить "ключ"')
        m = re.match(r'^удалить\s+(\w+)\["([^"]+)"\]$', line)
        if m:
            return DeleteDictKey(target=m.group(1), key=m.group(2))
        m = re.match(r'^удалить\s+(\w+)\[(\w+)\]$', line)
        if m:
            return DeleteDictKey(target=m.group(1), key=parse_value(m.group(2)))

        # объект["ключ"] = значение — присваивание поля dict
        m = re.match(r'^(\w+)\["([^"]+)"\]\s*=\s*(.+)$', line)
        if m:
            return SetDictKey(target=m.group(1), key=m.group(2), value=parse_value(m.group(3)))
        m = re.match(r'^(\w+)\[(\w+)\]\s*=\s*(.+)$', line)
        if m:
            return SetDictKey(target=m.group(1), key=parse_value(m.group(2)),
                              value=parse_value(m.group(3)))

        # ── HTTP расширения ───────────────────────────────────────────────

        # http_patch url с data → var  /  http_patch url json body → var
        m = re.match(r'^http_patch\s+(.+?)\s+json\s+(.+?)\s*→\s*(\w+)$', line)
        if m:
            return HttpPatch(url=parse_value(m.group(1)), data=parse_value(m.group(2)), variable=m.group(3))
        m = re.match(r'^http_patch\s+(.+?)\s+с\s+(.+?)\s*→\s*(\w+)$', line)
        if m:
            return HttpPatch(url=parse_value(m.group(1)), data=parse_value(m.group(2)), variable=m.group(3))

        # http_put url с data → var  /  http_put url json body → var
        m = re.match(r'^http_put\s+(.+?)\s+json\s+(.+?)\s*→\s*(\w+)$', line)
        if m:
            return HttpPut(url=parse_value(m.group(1)), data=parse_value(m.group(2)), variable=m.group(3))
        m = re.match(r'^http_put\s+(.+?)\s+с\s+(.+?)\s*→\s*(\w+)$', line)
        if m:
            return HttpPut(url=parse_value(m.group(1)), data=parse_value(m.group(2)), variable=m.group(3))

        # http_delete url → var
        m = re.match(r'^http_delete\s+(.+?)\s*→\s*(\w+)$', line)
        if m:
            return HttpDelete(url=parse_value(m.group(1)), variable=m.group(2))

        # http_заголовки переменная — устанавливает заголовки для HTTP-вызовов
        m = re.match(r'^http_заголовки\s+(\w+)$', line)
        if m:
            return SetHttpHeaders(variable=m.group(1))

        # ── База данных расширения ─────────────────────────────────────────

        # удалить "ключ" — удаление ключа из БД (после проверки удалить объект["ключ"])
        m = re.match(r'^удалить\s+"([^"]+)"$', line)
        if m:
            return DeleteFromDB(key=m.group(1))

        # все_ключи → список
        m = re.match(r'^все_ключи\s*→\s*(\w+)$', line)
        if m:
            return GetAllDBKeys(variable=m.group(1))

        # сохранить_глобально "ключ" = значение
        m = re.match(r'^сохранить_глобально\s+"([^"]+)"\s*=\s*(.+)$', line)
        if m:
            return SaveGlobalDB(key=m.group(1), value=parse_value(m.group(2)))

        # получить от USER_ID "ключ" → переменная
        m = re.match(r'^получить от\s+(.+?)\s+"([^"]+)"\s*→\s*(\w+)$', line)
        if m:
            return LoadFromUserDB(user_id=parse_value(m.group(1).strip()),
                                  key=m.group(2), variable=m.group(3))

        # ── Управление потоком расширения ──────────────────────────────────

        # вернуть значение
        m = re.match(r'^вернуть\s+(.+)$', line)
        if m:
            return ReturnValue(value=parse_value(m.group(1)))

        # иначе / при старте / etc — пропустим на верхнем уровне
        return None

    def _parse_commands_block(self) -> list:
        """Парсит блок команд бота для меню.
        
        команды:
            "/start" - "Запуск"
            "/help" - "Помощь"
        """
        commands = []
        while self.pos < len(self.lines):
            line = self.peek()
            if line is None:
                break
            
            # Проверяем отступ - должен быть больше базового
            ind = indent_of(line)
            if ind < 4:  # не с отступом - выходим
                break
            
            stripped = line.strip()
            if not stripped:
                self.consume()
                continue
            
            # Парсим: "/команда" - "Описание" или /команда - Описание
            m = re.match(r'^[\s]*"([^"]+)"\s*-\s*"([^"]+)"$', stripped)
            if not m:
                m = re.match(r'^[\s]*"([^"]+)"\s*-\s*(.+)$', stripped)
            if m:
                commands.append({"command": m.group(1), "description": m.group(2)})
            self.consume()
        
        return commands
