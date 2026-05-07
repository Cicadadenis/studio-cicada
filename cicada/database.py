"""
Cicada Database — простое JSON-хранилище для постоянных данных.
"""

import json
import os
from pathlib import Path


class Database:
    """Хранит данные в JSON-файле per user."""

    def __init__(self, db_path: str = "cicada_data.json"):
        self.db_path = Path(db_path)
        self._data = {}
        self._load()

    def _load(self):
        """Загружает данные из файла."""
        if self.db_path.exists():
            try:
                with open(self.db_path, "r", encoding="utf-8") as f:
                    self._data = json.load(f)
            except (json.JSONDecodeError, IOError):
                self._data = {}
        else:
            self._data = {}

    def _save(self):
        """Сохраняет данные в файл."""
        try:
            with open(self.db_path, "w", encoding="utf-8") as f:
                json.dump(self._data, f, ensure_ascii=False, indent=2)
        except IOError as e:
            print(f"⚠️ Ошибка сохранения БД: {e}")

    def set(self, user_id: str, key: str, value):
        """Сохраняет значение для пользователя."""
        if user_id not in self._data:
            self._data[user_id] = {}
        self._data[user_id][key] = value
        self._save()

    def get(self, user_id: str, key: str, default=None):
        """Получает значение для пользователя."""
        return self._data.get(user_id, {}).get(key, default)

    def delete(self, user_id: str, key: str):
        """Удаляет ключ для пользователя."""
        if user_id in self._data and key in self._data[user_id]:
            del self._data[user_id][key]
            self._save()

    def get_all(self, user_id: str):
        """Возвращает все данные пользователя."""
        return self._data.get(user_id, {}).copy()

    def get_all_user_ids(self) -> list:
        """Возвращает список всех user_id (кроме служебных ключей)."""
        return [uid for uid in self._data.keys() if not uid.startswith("_")]

    def get_all_keys(self, user_id: str) -> list:
        """Возвращает список всех ключей пользователя."""
        return list(self._data.get(user_id, {}).keys())

    # ─── Глобальное хранилище (не per-user) ───────────────────────────

    def set_global(self, key: str, value) -> None:
        """Сохраняет значение в глобальном (не per-user) пространстве."""
        if "_global_" not in self._data:
            self._data["_global_"] = {}
        self._data["_global_"][key] = value
        self._save()

    def get_global(self, key: str, default=None):
        """Получает глобальное значение."""
        return self._data.get("_global_", {}).get(key, default)

    def delete_global(self, key: str) -> None:
        """Удаляет глобальный ключ."""
        if "_global_" in self._data and key in self._data["_global_"]:
            del self._data["_global_"][key]
            self._save()

    def get_all_global_keys(self) -> list:
        """Возвращает все глобальные ключи."""
        return list(self._data.get("_global_", {}).keys())


# Глобальный экземпляр БД
_db_instance = None


def get_db(db_path: str = "cicada_data.json") -> Database:
    """Возвращает глобальный экземпляр БД."""
    global _db_instance
    if _db_instance is None:
        _db_instance = Database(db_path)
    return _db_instance


def reset_db():
    """Сбрасывает глобальный экземпляр (для тестов)."""
    global _db_instance
    _db_instance = None
