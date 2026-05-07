Сюда кладите JSON ответы /api/ai-generate (массив стеков), как их вернул редактор после вызова ИИ.

Проверка всех *.json:
  npm run parser-smoke:regression

Добавляйте новые кейсы при багах парсера — скрипт прогоняет generateDSL + schema + Python-парсер.
