#!/usr/bin/env bash
# Полный сброс Docker Compose: удаляет тома (включая БД), пересобирает и поднимает заново.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "⚠️  Удаляю тома и контейнеры этого compose-проекта (данные PostgreSQL будут стерты)."
docker compose down -v --remove-orphans
docker compose up -d --build
echo "✅ Готово. Проверка: docker compose ps"
