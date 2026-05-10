// Все секреты берутся из .env (через dotenv в server.mjs)
// Фронтенд ВСЕГДА ходит через /api
export const API_HOST   = process.env.API_HOST   || 'localhost';
export const API_PORT   = Number(process.env.API_PORT) || 3001;
export const CICADA_BIN = process.env.CICADA_BIN || '/usr/local/bin/cicada';

/** Абсолютный путь к корню репозитория cicada-tg (папка, внутри которой лежит `cicada/`). Нужен для чата-превью в Studio (`/api/bot/preview`). */
export const CICADA_TG_ROOT = (process.env.CICADA_TG_ROOT || '').trim();

export const RESEND_API_KEY = process.env.RESEND_API_KEY;
export const EMAIL_FROM     = process.env.EMAIL_FROM     || `Cicada Studio <noreply@${API_HOST}>`;

export const APP_URL = `https://${API_HOST}`;

export const CRYPTOBOT_TOKEN = process.env.CRYPTOBOT_TOKEN;

/** Comma-separated browser origins allowed with credentials (e.g. https://app.example.com). */
export const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const API_URL = `/api`;

/**
 * Режим AST для /api/ai-generate: safe — без блока get (только сессия remember/ask);
 * advanced — get разрешён, но ключ KV только из allowlist (см. getAiAllowedMemoryKeys).
 */
export function getAiAstMode() {
  const v = String(process.env.AI_AST_MODE || 'safe').trim().toLowerCase();
  return v === 'advanced' ? 'advanced' : 'safe';
}

/**
 * Ключи KV для блока get в advanced-режиме (точное совпадение строки key после trim).
 * JSON-массив в .env или список через запятую. По умолчанию — короткий безопасный набор.
 */
export function getAiAllowedMemoryKeys() {
  const raw = process.env.AI_ALLOWED_MEMORY_KEYS;
  if (raw != null && String(raw).trim().startsWith('[')) {
    try {
      const arr = JSON.parse(String(raw));
      if (Array.isArray(arr)) {
        return arr.map((x) => String(x).trim()).filter(Boolean);
      }
    } catch {
      // fall through
    }
  }
  if (raw != null && String(raw).trim()) {
    return String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return ['город', 'имя', 'файл'];
}

/** Сколько дополнительных вызовов LLM «repair» после первой генерации (0 = только одна попытка). */
export function getAiAstRepairRounds() {
  const n = Number(process.env.AI_AST_REPAIR_ROUNDS);
  if (!Number.isFinite(n) || n < 0) return 2;
  return Math.min(5, Math.floor(n));
}
