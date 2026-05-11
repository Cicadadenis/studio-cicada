"""
Cicada Runtime — хранит состояние каждого пользователя.
"""


class UserContext:
    """Контекст одного пользователя: переменные, текущий сценарий, шаг."""

    def __init__(self, chat_id: int, username: str = "", user_id: int = None, last_name: str = "", globals_dict: dict = None):
        self.chat_id = chat_id
        self.user_id = user_id or chat_id
        self.vars: dict = {
            "имя": username or str(chat_id),
            "chat_id": str(chat_id),
            "user_id": str(user_id or chat_id),
            "фамилия": last_name,
        }
        # Объект пользователя для доступа через точку
        self.user_obj = {
            "id": str(user_id or chat_id),
            "имя": username or "",
            "фамилия": last_name,
            "chat_id": str(chat_id),
            "язык": "",
            "фото": "",
        }
        # Объект чата для доступа через точку
        self.chat_obj = {
            "id": str(chat_id),
            "тип": "личка",
        }
        self.scenario: str | None = None   # активный сценарий
        self.step: int = 0                 # текущий шаг сценария
        self.step_names: dict = {}          # имя шага → индекс
        self.waiting_for: str | None = None  # ждём ввод → переменная
        self._globals: dict = globals_dict or {}  # глобальные переменные

    def set_step_names(self, steps: list):
        """Устанавливает отображение имён шагов в индексы"""
        self.step_names = {}
        for i, step in enumerate(steps):
            if hasattr(step, 'name'):
                self.step_names[step.name] = i

    def get_step_index(self, name: str) -> int:
        """Возвращает индекс шага по имени"""
        return self.step_names.get(name, -1)

    def set(self, name: str, value):
        self.vars[name] = value

    def get(self, name: str, default=None):
        # Поддержка доступа через точку: пользователь.id, пользователь.имя
        if name.startswith("пользователь."):
            prop = name.split(".", 1)[1]
            return self.user_obj.get(prop, default)
        # Поддержка доступа через точку: чат.id
        if name.startswith("чат."):
            prop = name.split(".", 1)[1]
            return self.chat_obj.get(prop, default)
        # Сначала ищем в локальных переменных
        if name in self.vars:
            return self.vars[name]
        # Затем в глобальных
        if name in self._globals:
            return self._globals[name]
        return default

    def resolve(self, part):
        from cicada.parser import VarRef
        if isinstance(part, VarRef):
            return str(self.vars.get(part.name, f"[{part.name}]"))
        return str(part)

    def render(self, parts: list) -> str:
        return "".join(self.resolve(p) for p in parts)

    def to_dict(self) -> dict:
        """Сериализует FSM-состояние пользователя для внешнего storage."""
        return {
            "chat_id": self.chat_id,
            "user_id": self.user_id,
            "vars": dict(self.vars),
            "user_obj": dict(self.user_obj),
            "chat_obj": dict(self.chat_obj),
            "scenario": self.scenario,
            "step": self.step,
            "step_names": dict(self.step_names),
            "waiting_for": self.waiting_for,
            "pending_stmts": getattr(self, "_pending_stmts", []),
            "current_step_name": getattr(self, "current_step_name", None),
        }

    @classmethod
    def from_dict(cls, data: dict, globals_dict: dict = None) -> "UserContext":
        """Восстанавливает UserContext из to_dict()."""
        ctx = cls(
            int(data.get("chat_id", 0)),
            globals_dict=globals_dict,
            user_id=data.get("user_id"),
        )
        ctx.vars.update(data.get("vars") or {})
        ctx.user_obj.update(data.get("user_obj") or {})
        ctx.chat_obj.update(data.get("chat_obj") or {})
        ctx.scenario = data.get("scenario")
        ctx.step = int(data.get("step") or 0)
        ctx.step_names = dict(data.get("step_names") or {})
        ctx.waiting_for = data.get("waiting_for")
        ctx._pending_stmts = list(data.get("pending_stmts") or [])
        ctx.current_step_name = data.get("current_step_name")
        return ctx


class Runtime:
    def __init__(self, globals_dict: dict = None):
        self._users: dict[int, UserContext] = {}
        self._globals: dict = globals_dict or {}

    def user(self, chat_id: int, username: str = "", user_id: int = None,
             last_name: str = "", language_code: str = "", chat_type: str = "private") -> UserContext:
        _type_map = {"private": "личка", "group": "группа",
                     "supergroup": "супергруппа", "channel": "канал"}
        if chat_id not in self._users:
            self._users[chat_id] = UserContext(chat_id, username, user_id, last_name, self._globals)
        ctx = self._users[chat_id]
        if username:
            ctx.user_obj["имя"] = username
            ctx.user_obj["фамилия"] = last_name
            ctx.vars["имя"] = username
            ctx.vars["фамилия"] = last_name
        if language_code:
            ctx.user_obj["язык"] = language_code
        ctx.chat_obj["тип"] = _type_map.get(chat_type, chat_type)
        return ctx

    def update_user_photo(self, chat_id: int, photo_url: str) -> None:
        """Обновляет аватар пользователя в контексте."""
        if chat_id in self._users:
            self._users[chat_id].user_obj["фото"] = photo_url

    def to_dict(self) -> dict:
        """Сериализует весь runtime для сохранения между процессами."""
        return {
            "globals": dict(self._globals),
            "users": {str(chat_id): ctx.to_dict() for chat_id, ctx in self._users.items()},
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Runtime":
        """Восстанавливает runtime из to_dict()."""
        rt = cls(data.get("globals") or {})
        for chat_id, ctx_data in (data.get("users") or {}).items():
            rt._users[int(chat_id)] = UserContext.from_dict(ctx_data, rt._globals)
        return rt
