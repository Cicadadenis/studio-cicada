"""
Миграция контрактов IR / AST: схема v1 → v2.

Пока заглушка: интерфейс для последующих ломающих изменений полей (rename, split nodes).

Использование (пример):

    from migrations.v1_to_v2 import migrate_ast_document, migrate_ir_document

    doc2 = migrate_ast_document(ast_v1)
"""
from __future__ import annotations

from copy import deepcopy
from typing import Any, Mapping

IR_SCHEMA_VERSION_V1 = 1
IR_SCHEMA_VERSION_V2 = 2
AST_SCHEMA_VERSION_V1 = 1
AST_SCHEMA_VERSION_V2 = 2


def migrate_ir_document(doc: Mapping[str, Any]) -> dict[str, Any]:
    """IR JSON (Studio / renderIr) v1 → v2. Сейчас — no-op с проверкой версии."""
    ver = doc.get("schemaVersion", IR_SCHEMA_VERSION_V1)
    if ver != IR_SCHEMA_VERSION_V1:
        raise ValueError(f"migrate_ir_document: ожидался IR schemaVersion {IR_SCHEMA_VERSION_V1}, получено {ver!r}")
    out = deepcopy(dict(doc))
    # TODO: поля v2
    out["schemaVersion"] = IR_SCHEMA_VERSION_V2
    return out


def migrate_ast_document(doc: Mapping[str, Any]) -> dict[str, Any]:
    """Корневой AST (объект Program) v1 → v2. Сейчас — no-op с проверкой версии."""
    if doc.get("__type__") != "Program":
        raise ValueError("migrate_ast_document: ожидается объект с __type__ == 'Program'")
    ver = doc.get("schemaVersion", AST_SCHEMA_VERSION_V1)
    if ver != AST_SCHEMA_VERSION_V1:
        raise ValueError(f"migrate_ast_document: ожидался AST schemaVersion {AST_SCHEMA_VERSION_V1}, получено {ver!r}")
    out = deepcopy(dict(doc))
    # TODO: переименование узлов / полей
    out["schemaVersion"] = AST_SCHEMA_VERSION_V2
    return out
