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
