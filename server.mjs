import 'dotenv/config';
import express from 'express';
import {
  API_PORT,
  API_HOST,
  CICADA_BIN,
  CORS_ORIGINS,
  CRYPTOBOT_TOKEN,
  APP_URL,
  getAiAstMode,
  getAiAllowedMemoryKeys,
  getAiAstRepairRounds,
} from './config.js';
import fs from 'fs';
import crypto from 'crypto';
import cors from 'cors';
import { spawnSync } from 'child_process';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';
import path from 'path';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { sendVerificationEmail, sendPasswordResetEmail, sendEmailChangeCode, sendSupportReplyEmail } from './email.mjs';
import { startRunner, stopRunner, isRunnerActive, getRunnerStatus, listRunners, getRunnerLogs } from './services/dslRunner.mjs';
import { lintCicadaWithPython, requireParsedDSL, getDslHintsWithPython } from './services/pythonDslLint.mjs';
import { sendPreviewRequest } from './services/cicadaPreviewWorker.mjs';
import { normalizeAdminTotpSecret, verifyTotp } from './services/adminTotp.mjs';
import { generateDSL } from './core/stacksToDsl.js';
import { lintDSLSchema, formatDSLDiagnostic } from './core/validator/schema.js';
import { validateDSL as validateUiDsl } from './core/validator/uiDslValidator.js';
import { extractAiGeneratedStacksFromRaw, normalizeAiGeneratedStacks, repairCollapsedCicadaCode, stripThinkingFromAiRaw } from './core/validator/fixes.js';
import { validateAstSchema } from './core/validator/aiAstValidate.mjs';
import { semanticValidate } from './core/validator/aiSemanticValidate.mjs';
import { isPlaceholderBotToken } from './core/botTokenPlaceholders.mjs';

const { Pool } = pg;

const app = express();

const AVATAR_UPLOAD_DIR = path.resolve('uploads/avatars');
const AVATAR_URL_PREFIX = '/api/avatars';
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_MIME_EXT = new Map([
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

app.use(AVATAR_URL_PREFIX, express.static(AVATAR_UPLOAD_DIR, {
  fallthrough: false,
  immutable: true,
  maxAge: '30d',
}));

app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);

function corsAllowedOrigins() {
  if (CORS_ORIGINS.length > 0) return CORS_ORIGINS;
  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction) {
    return [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:3001',
      'http://127.0.0.1:3001',
    ];
  }
  const base = (process.env.APP_URL || `https://${API_HOST}`).replace(/\/$/, '');
  return base ? [base] : [];
}

app.use(
  cors({
    origin(origin, callback) {
      const allowed = corsAllowedOrigins();
      if (!origin) {
        return callback(null, true);
      }
      if (allowed.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: '30mb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  const origJson = res.json.bind(res);
  res.json = (payload) => {
    if (payload?.error) {
      const statusCode = res.statusCode && res.statusCode >= 100 ? res.statusCode : 200;
      recordApiError(req, statusCode, payload.error);
    }
    return origJson(payload);
  };
  res.on('finish', () => {
    if (res.statusCode >= 400) {
      recordApiError(req, res.statusCode, res.statusMessage || 'HTTP error');
    }
  });
  next();
});
app.use(express.static('dist'));
app.get('/satana', (req, res) => {
  const html = fs.readFileSync(path.resolve('public/satana.html'), 'utf8')
    .replace("'__API_TARGET__'", "''");  // пустая строка = same-origin, cookie работает
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

app.get('/satana.html', (req, res) => {
  res.redirect(301, '/satana');
});

const BOTS_DIR = 'bots';
const recentSystemErrors = [];
const recentApiErrors = [];
const recentAuthErrors = [];
const recentAdminActions = [];
const recentUserActions = [];
const userLoginHistory = new Map(); // userId -> [{ at, ip, method }]
const recentSubscriptions = [];
const googleAuthStates = new Map(); // state -> { exp }

if (!fs.existsSync(BOTS_DIR)) {
  fs.mkdirSync(BOTS_DIR, { recursive: true });
}

const isHttps = process.env.API_HOST && process.env.API_HOST !== 'localhost';

function pushSystemError(source, err) {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  recentSystemErrors.push({
    at: new Date().toISOString(),
    source,
    message,
  });
  if (recentSystemErrors.length > 30) recentSystemErrors.shift();
}

/** Log full error server-side; never send err.message/stack in API JSON (SQL, internals). */
function sendInternalApiError(res, source, err, publicMessage = 'Произошла ошибка. Попробуйте позже.', status = 500) {
  console.error(source, err);
  pushSystemError(source, err instanceof Error ? err : new Error(String(err)));
  return res.status(status).json({ error: publicMessage });
}

function pushRing(list, item, max = 100) {
  list.push(item);
  if (list.length > max) list.shift();
}

function recordApiError(req, statusCode, message) {
  if (!req?.path?.startsWith('/api/')) return;
  pushRing(recentApiErrors, {
    at: new Date().toISOString(),
    path: req.path,
    method: req.method,
    statusCode,
    message: String(message || ''),
    userId: req.body?.userId || req.query?.userId || null,
    ip: req.ip || null,
  }, 300);
}

function recordAuthError(type, req, identifier, message) {
  pushRing(recentAuthErrors, {
    at: new Date().toISOString(),
    type,
    identifier: identifier || null,
    message: String(message || ''),
    ip: req?.ip || null,
  }, 300);
}

function recordAdminAction(req, action, targetUserId, details = {}) {
  pushRing(recentAdminActions, {
    at: new Date().toISOString(),
    action,
    targetUserId: targetUserId || null,
    details,
    ip: req?.ip || null,
  }, 400);
}

function recordUserAction(userId, action, details = {}) {
  if (!userId) return;
  pushRing(recentUserActions, {
    at: new Date().toISOString(),
    userId,
    action,
    details,
  }, 600);
}

function recordUserLogin(userId, ip, method) {
  if (!userId) return;
  const curr = userLoginHistory.get(userId) || [];
  curr.push({ at: new Date().toISOString(), ip: ip || null, method: method || 'unknown' });
  if (curr.length > 30) curr.shift();
  userLoginHistory.set(userId, curr);
}

process.on('uncaughtException', (err) => {
  pushSystemError('uncaughtException', err);
  console.error('[uncaughtException]', err);
});

process.on('unhandledRejection', (reason) => {
  pushSystemError('unhandledRejection', reason);
  console.error('[unhandledRejection]', reason);
});

function rl429(_, res) {
  res.status(429).json({ error: 'Слишком много попыток. Попробуйте позже.' });
}

/** IPv6-safe client key for express-rate-limit custom keyGenerators (see ERR_ERL_KEY_GEN_IPV6). */
function rlIpSegment(req) {
  return ipKeyGenerator(req.ip ?? 'unknown');
}

const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${rlIpSegment(req)}|${String(req.body?.email ?? '').toLowerCase()}`,
  handler: rl429,
});

const registerRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${rlIpSegment(req)}|${String(req.body?.email ?? '').toLowerCase()}`,
  handler: rl429,
});

/** Сброс пароля: запрос письма (защита от спама почты и перебора). */
const forgotPasswordRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${rlIpSegment(req)}|${String(req.body?.email ?? '').toLowerCase()}`,
  handler: rl429,
});

const resetPasswordSubmitRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => rlIpSegment(req),
  handler: rl429,
});

/** Подтверждение по ссылке из письма (GET — перебор токена / нагрузка). */
const verifyEmailRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => rlIpSegment(req),
  handler: rl429,
});

const emailChangeRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    `${rlIpSegment(req)}|${String(req.body?.newEmail ?? '').toLowerCase()}|${req.authUserId ?? req.body?.userId ?? ''}`,
  handler: rl429,
});

const botPreviewRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 90,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${rlIpSegment(req)}|${String(req.body?.sessionId ?? '').slice(0, 48)}`,
  handler: rl429,
});

/** Подтверждение смены email по коду (защита от перебора кода). */
const confirmEmailChangeRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    `${rlIpSegment(req)}|${String(req.body?.userId ?? '').toLowerCase()}`,
  handler: rl429,
});

/** Конвертация Python-бота → DSL: только для role=admin, лимит на пользователя. */
const pythonBotConvertRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 24,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `py2ccd_${req.authUserId || rlIpSegment(req)}`,
  handler: rl429,
});

/** Скачивание дампа БД / исходников — только cookie admin_session, лимит по IP. */
const adminAssetDownloadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 24,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `adm_dl_${rlIpSegment(req)}`,
  handler: rl429,
});

const adminLoginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => rlIpSegment(req),
  handler: rl429,
});

const MIN_JWT_SECRET_LEN = 32;
const _rawJwtSecret = (process.env.JWT_SECRET || '').trim();
const _isProd = process.env.NODE_ENV === 'production';

if (_isProd && !_rawJwtSecret) {
  console.error('FATAL: задайте JWT_SECRET в .env (не менее 32 символов) перед запуском в production.');
  process.exit(1);
}
if (_isProd && _rawJwtSecret.length < MIN_JWT_SECRET_LEN) {
  console.error(`FATAL: JWT_SECRET слишком короткий (нужно ≥ ${MIN_JWT_SECRET_LEN} символов).`);
  process.exit(1);
}

const JWT_SECRET = _rawJwtSecret.length >= MIN_JWT_SECRET_LEN
  ? _rawJwtSecret
  : (() => {
      const gen = crypto.randomBytes(48).toString('hex');
      if (_rawJwtSecret.length > 0) {
        console.warn(`⚠️  JWT_SECRET короче ${MIN_JWT_SECRET_LEN} символов — до перезапуска используется случайный ключ. Задайте стабильный секрет в .env.`);
      } else {
        console.warn('⚠️  JWT_SECRET не задан — используется временный ключ до перезапуска. Установите JWT_SECRET в .env.');
      }
      return gen;
    })();
const JWT_EXPIRES_SEC = Number(process.env.JWT_EXPIRES_SEC || 30 * 24 * 60 * 60); // 30 дней по умолчанию

/** Одноразовая передача JWT в SPA после OAuth-редиректа (httpOnly cookie). */
const OAUTH_JWT_HANDOFF_COOKIE = 'oauth_jwt_handoff';
const OAUTH_2FA_PENDING_COOKIE = 'oauth_2fa_pending';

const ADMIN_JWT_EXPIRES_SEC = Number(process.env.ADMIN_JWT_EXPIRES_SEC || 8 * 60 * 60);

function issueUserJwt(userId) {
  return jwt.sign({ sub: userId, type: 'user' }, JWT_SECRET, { expiresIn: JWT_EXPIRES_SEC });
}

function issueOauthJwtHandoffCookie(res, userId) {
  const jwtToken = issueUserJwt(userId);
  res.cookie(OAUTH_JWT_HANDOFF_COOKIE, jwtToken, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isHttps,
    maxAge: 3 * 60 * 1000,
    path: '/',
  });
}

function issueAdminSessionCookie(res) {
  const token = jwt.sign({ type: 'admin' }, JWT_SECRET, { expiresIn: ADMIN_JWT_EXPIRES_SEC });
  res.cookie('admin_session', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isHttps,
    maxAge: ADMIN_JWT_EXPIRES_SEC * 1000,
    path: '/',
  });
}

function getJwtUserId(req) {
  try {
    const header = String(req.headers?.authorization || '');
    if (!header.startsWith('Bearer ')) return null;
    const token = header.slice('Bearer '.length).trim();
    if (!token) return null;
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded || decoded.type !== 'user' || !decoded.sub) return null;
    return String(decoded.sub);
  } catch {
    return null;
  }
}

function requireUserAuth(req, res, next) {
  const jwtUserId = getJwtUserId(req);
  if (!jwtUserId) return res.status(401).json({ error: 'Необходима авторизация' });
  req.authUserId = jwtUserId;
  return next();
}

async function requireAppAdmin(req, res, next) {
  try {
    const user = await findById(req.authUserId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Доступ только для администратора' });
    }
    return next();
  } catch (err) {
    return sendInternalApiError(res, 'requireAppAdmin', err, 'Не удалось проверить права.', 500);
  }
}

function timingSafeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function timingSafeEqualLoose(a, b) {
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [state, meta] of googleAuthStates.entries()) {
    if (!meta || meta.exp <= now) googleAuthStates.delete(state);
  }
}, 5 * 60 * 1000).unref();

// ================= DATABASE =================

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'cicada',
  user:     process.env.DB_USER     || 'cicada_user',
  password: process.env.DB_PASSWORD,
  ssl:      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 10,
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id                    TEXT PRIMARY KEY,
      name                  TEXT NOT NULL,
      email                 TEXT UNIQUE,
      password              TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      verified              BOOLEAN NOT NULL DEFAULT FALSE,
      verify_token          TEXT,
      verify_token_exp      BIGINT,
      reset_token           TEXT,
      reset_token_exp       BIGINT,
      plan                  TEXT NOT NULL DEFAULT 'trial',
      subscription_exp      BIGINT,
      role                  TEXT NOT NULL DEFAULT 'user',
      access_level          TEXT NOT NULL DEFAULT 'basic',
      banned                BOOLEAN NOT NULL DEFAULT FALSE,
      tg_id                 TEXT UNIQUE,
      google_id             TEXT UNIQUE,
      username              TEXT,
      photo_url             TEXT,
      ui_language           TEXT NOT NULL DEFAULT 'ru',
      auth_method           TEXT,
      email_change_code     TEXT,
      email_change_code_exp BIGINT,
      email_change_pending  TEXT,
      twofa_secret          TEXT,
      twofa_enabled         BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);
  // Миграция: добавляем role если ещё нет (для существующих БД)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS access_level TEXT NOT NULL DEFAULT 'basic'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS test_token TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ui_language TEXT NOT NULL DEFAULT 'ru'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS twofa_secret TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS twofa_enabled BOOLEAN NOT NULL DEFAULT FALSE`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_passkeys (
      credential_id TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      public_key    TEXT NOT NULL,
      sign_count    BIGINT NOT NULL DEFAULT 0,
      name          TEXT NOT NULL DEFAULT 'Passkey',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at  TIMESTAMPTZ
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_passkeys_user_id ON user_passkeys(user_id)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_requests (
      id         TEXT PRIMARY KEY,
      user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
      from_text  TEXT NOT NULL,
      email      TEXT,
      subject    TEXT NOT NULL,
      message    TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'open',
      reply_text TEXT,
      replied_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_support_requests_created_at ON support_requests(created_at DESC)`);

  // ── User libraries ───────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_libraries (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      items       JSONB NOT NULL DEFAULT '[]',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // ── Projects table ──────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      stacks      JSONB NOT NULL DEFAULT '[]',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id)`);
  console.log('✅ DB ready');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientDbConnectError(err) {
  const c = err && err.code;
  if (c === 'ECONNREFUSED' || c === 'ETIMEDOUT' || c === 'ENOTFOUND' || c === 'EAI_AGAIN') return true;
  // PostgreSQL: cannot accept connections (startup / recovery)
  if (c === '57P03') return true;
  return false;
}

/** Пока Postgres поднимается (Docker, рестарт), даём несколько попыток. */
async function initDBWithRetry({ attempts = 30, delayMs = 2000 } = {}) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      await initDB();
      return;
    } catch (err) {
      last = err;
      if (isTransientDbConnectError(err) && i < attempts) {
        console.warn(`⏳ DB недоступна, повтор ${i}/${attempts}: ${err.message}`);
        await sleep(delayMs);
        continue;
      }
      throw err;
    }
  }
  throw last;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/** BIGINT из pg / BigInt → безопасное число для JSON и сравнений на клиенте. */
function coerceDbMillis(v) {
  if (v == null || v === '') return undefined;
  try {
    const n = typeof v === 'bigint' ? Number(v) : Number(v);
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

function rowToUser(row) {
  if (!row) return null;
  return {
    id:                   row.id,
    name:                 row.name,
    email:                row.email,
    password:             row.password,
    createdAt:            row.created_at,
    verified:             row.verified,
    verifyToken:          row.verify_token          ?? undefined,
    verifyTokenExp:       row.verify_token_exp      ?? undefined,
    resetToken:           row.reset_token           ?? undefined,
    resetTokenExp:        row.reset_token_exp       ?? undefined,
    plan:                 row.plan,
    subscriptionExp:      coerceDbMillis(row.subscription_exp),
    role:                 row.role                  ?? 'user',
    accessLevel:          row.access_level          ?? 'basic',
    banned:               row.banned                ?? false,
    tgId:                 row.tg_id                 ?? undefined,
    googleId:             row.google_id             ?? undefined,
    username:             row.username              ?? undefined,
    photo_url:            row.photo_url             ?? undefined,
    uiLanguage:           row.ui_language           ?? 'ru',
    test_token:           row.test_token            ?? null,
    authMethod:           row.auth_method           ?? undefined,
    emailChangeCode:      row.email_change_code     ?? undefined,
    emailChangeCodeExp:   row.email_change_code_exp ?? undefined,
    emailChangePending:   row.email_change_pending  ?? undefined,
    twofaSecret:         row.twofa_secret          ?? undefined,
    twofaEnabled:        row.twofa_enabled         ?? false,
  };
}

function safeUser(user) {
  const { password, verifyToken, verifyTokenExp, resetToken, resetTokenExp,
          emailChangeCode, emailChangeCodeExp, emailChangePending, ...safe } = user;
  return safe;
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function checkPassword(plain, hash) {
  if (!hash) return false;
  // Поддержка старых SHA-256 хэшей (миграция из users.json)
  if (hash.length === 64 && !/^\$2/.test(hash)) {
    return crypto.createHash('sha256').update(plain).digest('hex') === hash;
  }
  return bcrypt.compareSync(plain, hash);
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function randomBase32Secret(length = 32) {
  let out = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i += 1) out += BASE32[bytes[i] % BASE32.length];
  return out;
}

const NEW_USER_PREMIUM_DAYS = 3;

function getNewUserPremiumExp() {
  return Date.now() + NEW_USER_PREMIUM_DAYS * 24 * 60 * 60 * 1000;
}

async function findByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  return rowToUser(rows[0] ?? null);
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rowToUser(rows[0] ?? null);
}

const USER_LOOKUP_BY_TOKEN_COLUMNS = ['verify_token', 'reset_token'];

async function findByToken(field, token) {
  if (!USER_LOOKUP_BY_TOKEN_COLUMNS.includes(field)) {
    throw new Error('Invalid user lookup field');
  }
  const { rows } = await pool.query(`SELECT * FROM users WHERE ${field} = $1`, [token]);
  return rowToUser(rows[0] ?? null);
}

async function findByTgId(tgId) {
  const { rows } = await pool.query('SELECT * FROM users WHERE tg_id = $1', [tgId]);
  return rowToUser(rows[0] ?? null);
}

async function findByGoogleId(googleId) {
  const { rows } = await pool.query('SELECT * FROM users WHERE google_id = $1', [googleId]);
  return rowToUser(rows[0] ?? null);
}

// ================= MIGRATE users.json → PostgreSQL =================

async function migrateUsersJson() {
  const jsonFile = 'users.json';
  if (!fs.existsSync(jsonFile)) return;

  let rows;
  try { rows = JSON.parse(fs.readFileSync(jsonFile, 'utf8')); } catch { return; }

  let count = 0;
  for (const u of rows) {
    await pool.query(`
      INSERT INTO users
        (id, name, email, password, created_at, verified,
         verify_token, verify_token_exp, reset_token, reset_token_exp,
         plan, subscription_exp, tg_id, username, photo_url, auth_method)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (id) DO NOTHING
    `, [
      u.id, u.name, u.email ?? null, u.password ?? null,
      u.createdAt ?? new Date().toISOString(), u.verified ?? false,
      u.verifyToken ?? null, u.verifyTokenExp ?? null,
      u.resetToken  ?? null, u.resetTokenExp  ?? null,
      u.plan ?? 'trial', u.subscriptionExp ?? null,
      u.tgId ?? null, u.username ?? null, u.photo_url ?? null, u.authMethod ?? null,
    ]);
    count++;
  }

  console.log(`✅ Migrated ${count} users from users.json → PostgreSQL`);
  fs.renameSync(jsonFile, jsonFile + '.migrated');
}

// ─── CSRF (double-submit: cookie + заголовок) + общий лимит /api ─────────────
const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER = 'x-csrf-token';
const CSRF_PATH_EXEMPT = new Set(['/api/subscription/webhook']);

const globalApiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => rlIpSegment(req),
  handler: rl429,
});

function setCsrfCookie(res, token) {
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    sameSite: 'strict',
    secure: isHttps,
    path: '/',
    maxAge: 12 * 60 * 60 * 1000,
  });
}

app.get('/api/csrf-token', (req, res) => {
  let t = req.cookies?.[CSRF_COOKIE_NAME];
  if (!t || typeof t !== 'string' || t.length < 48) {
    t = crypto.randomBytes(32).toString('hex');
  }
  setCsrfCookie(res, t);
  res.json({ csrfToken: t });
});

app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) return next();
  if (req.path === '/api/health') return next();
  return globalApiRateLimit(req, res, next);
});

app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) return next();
  const m = req.method;
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return next();
  if (CSRF_PATH_EXEMPT.has(req.path)) return next();
  const headerTok = req.get(CSRF_HEADER);
  const cookieTok = req.cookies?.[CSRF_COOKIE_NAME];
  if (!headerTok || !cookieTok || !timingSafeEqualLoose(headerTok, cookieTok)) {
    return res.status(403).json({ error: 'Недействительный CSRF-токен. Обновите страницу.' });
  }
  next();
});

// ================= AUTH =================

app.post('/api/register', registerRateLimit, async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.json({ error: 'Все поля обязательны' });

  if (await findByEmail(email)) return res.json({ error: 'Email уже существует' });

  const verifyToken = generateToken();

  const trialExp = getNewUserPremiumExp();
  await pool.query(`
    INSERT INTO users (id, name, email, password, verified, verify_token, verify_token_exp, plan, subscription_exp)
    VALUES ($1,$2,$3,$4,$5,$6,$7,'pro',$8)
  `, [
    Date.now().toString(36), name, email, hashPassword(password),
    false, verifyToken, Date.now() + 24 * 60 * 60 * 1000, trialExp,
  ]);

  try { await sendVerificationEmail(email, name, verifyToken); }
  catch (e) { console.error('Email send error:', e); }

  res.json({ success: true, needVerify: true });
});

function verifyEmailPage({ success, title, message, emoji }) {
  const color = success ? '#3ecf8e' : '#f87171';
  const glow  = success ? 'rgba(62,207,142,0.15)' : 'rgba(248,113,113,0.12)';
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${title} — Cicada Studio</title>
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&display=swap" rel="stylesheet"/>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center;
      background:#0d0d0f;font-family:system-ui,-apple-system,sans-serif;color:#fff;overflow:hidden}
    body::before{content:'';position:fixed;inset:0;
      background:radial-gradient(ellipse 60% 50% at 50% 0%,${glow} 0%,transparent 65%),
                 radial-gradient(ellipse 35% 25% at 85% 85%,rgba(255,215,0,0.05) 0%,transparent 50%);
      pointer-events:none}
    .card{position:relative;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);
      border-radius:28px;padding:56px 48px 48px;max-width:440px;width:90%;text-align:center;
      backdrop-filter:blur(12px)}
    .card::before{content:'';position:absolute;inset:0;border-radius:28px;
      background:radial-gradient(ellipse 80% 60% at 50% -10%,${glow} 0%,transparent 60%);
      pointer-events:none}
    .icon-ring{width:88px;height:88px;border-radius:50%;margin:0 auto 28px;display:flex;
      align-items:center;justify-content:center;font-size:40px;position:relative;
      background:rgba(255,255,255,0.04);border:1.5px solid ${color}22}
    .icon-ring::before{content:'';position:absolute;inset:-6px;border-radius:50%;
      border:1px solid ${color}18}
    .logo{font-family:'Syne',system-ui;font-size:13px;font-weight:700;
      color:rgba(255,255,255,0.25);letter-spacing:0.18em;text-transform:uppercase;margin-bottom:32px}
    h1{font-family:'Syne',system-ui;font-size:26px;font-weight:800;
      color:${color};margin-bottom:14px;letter-spacing:-0.01em}
    p{font-size:15px;color:rgba(255,255,255,0.5);line-height:1.7;margin-bottom:36px}
    a{display:inline-flex;align-items:center;gap:8px;padding:14px 32px;
      background:linear-gradient(135deg,#ffd700,#ffaa00);color:#111;font-weight:700;
      font-family:'Syne',system-ui;font-size:14px;letter-spacing:0.02em;
      border-radius:14px;text-decoration:none;box-shadow:0 8px 24px rgba(255,215,0,0.3);transition:all 0.2s}
    a:hover{transform:translateY(-2px);box-shadow:0 12px 32px rgba(255,215,0,0.45)}
    .dots{position:fixed;inset:0;pointer-events:none;overflow:hidden}
    .dot{position:absolute;border-radius:50%;background:${color};animation:float linear infinite}
    @keyframes float{0%{opacity:0;transform:translateY(0) scale(0)}
      10%{opacity:0.6}90%{opacity:0.2}100%{opacity:0;transform:translateY(-100vh) scale(1.5)}}
    @keyframes pop{0%{transform:scale(0.7);opacity:0}60%{transform:scale(1.1)}100%{transform:scale(1);opacity:1}}
    .card{animation:pop 0.5s cubic-bezier(0.34,1.56,0.64,1) both}
  </style>
</head>
<body>
  <div class="dots" id="dots"></div>
  <div class="card">
    <div class="logo">✦ Cicada Studio</div>
    <div class="icon-ring">${emoji}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="/">→ Открыть Cicada Studio</a>
  </div>
  <script>
    const d=document.getElementById('dots'),c='${color}';
    for(let i=0;i<18;i++){const el=document.createElement('div');el.className='dot';
      const s=Math.random()*4+2;
      el.style.cssText='width:'+s+'px;height:'+s+'px;left:'+Math.random()*100+'%;'
        +'bottom:'+(-s)+'px;animation-duration:'+(Math.random()*12+8)+'s;'
        +'animation-delay:'+(Math.random()*10)+'s;opacity:0.4;background:'+c;
      d.appendChild(el);}
  </script>
</body>
</html>`;
}

app.get('/api/verify-email', verifyEmailRateLimit, async (req, res) => {
  const { token } = req.query;
  const user = await findByToken('verify_token', token);

  if (!user) return res.send(verifyEmailPage({
    success: false, emoji: '🔗',
    title: 'Ссылка недействительна',
    message: 'Эта ссылка для подтверждения email не найдена.<br/>Попробуйте зарегистрироваться снова.',
  }));

  if (Date.now() > user.verifyTokenExp) return res.send(verifyEmailPage({
    success: false, emoji: '⏰',
    title: 'Ссылка устарела',
    message: 'Срок действия ссылки истёк (24 часа).<br/>Пожалуйста, зарегистрируйтесь снова.',
  }));

  await pool.query(
    'UPDATE users SET verified = TRUE, verify_token = NULL, verify_token_exp = NULL WHERE id = $1',
    [user.id]
  );

  return res.send(verifyEmailPage({
    success: true, emoji: '✅',
    title: 'Email подтверждён!',
    message: 'Ваш аккаунт активирован.<br/>Теперь вы можете войти в Cicada Studio.',
  }));
});

app.post('/api/login', loginRateLimit, async (req, res) => {
  const { email, password } = req.body;

  const user = await findByEmail(email);
  if (!user || !checkPassword(password, user.password)) {
    recordAuthError('login', req, email, 'invalid_credentials');
    return res.json({ error: 'Неверный email или пароль' });
  }

  if (user.banned) {
    recordAuthError('login', req, email, 'banned_user');
    return res.status(403).json({ error: 'Аккаунт заблокирован администратором' });
  }

  if (!user.verified)
    return res.json({ error: 'Email не подтверждён — проверьте почту' });

  if (user.role === 'admin' && user.twofaEnabled) {
    const totp = String(req.body?.totp || '').replace(/\s/g, '');
    if (!verifyTotp(user.twofaSecret, totp, 1)) {
      if (!totp) return res.status(401).json({ twofaRequired: true, error: 'Требуется код 2FA' });
      return res.status(401).json({ twofaRequired: true, error: 'Неверный код 2FA' });
    }
  }

  // Апгрейд старого SHA-256 хэша до bcrypt
  if (user.password && user.password.length === 64 && !/^\$2/.test(user.password)) {
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashPassword(password), user.id]);
  }

  const authToken = issueUserJwt(user.id);
  recordUserLogin(user.id, req.ip, 'password');
  recordUserAction(user.id, 'login_success', { method: 'password' });
  res.json({ success: true, user: safeUser(user), token: authToken });
});

/** Свежие данные пользователя из БД (план, подписка после выдачи в админке и т.д.) — клиент синхронизирует cicada_session. */
app.get('/api/me', requireUserAuth, async (req, res) => {
  try {
    const user = await findById(req.authUserId);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    if (user.banned) return res.status(403).json({ error: 'Аккаунт заблокирован администратором' });
    return res.json({ user: safeUser(user) });
  } catch (err) {
    return sendInternalApiError(res, 'GET /api/me', err, 'Не удалось загрузить профиль.', 500);
  }
});

app.get('/api/2fa/setup', requireUserAuth, async (req, res) => {
  const userId = String(req.query.userId || '');
  if (!userId || req.authUserId !== userId) return res.status(403).json({ error: 'Forbidden' });
  const user = await findById(userId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  const secret = user.twofaSecret || randomBase32Secret(32);
  if (!user.twofaSecret) await pool.query('UPDATE users SET twofa_secret=$1 WHERE id=$2', [secret, userId]);
  const issuer = encodeURIComponent('Cicada Studio');
  const label = encodeURIComponent(`Cicada:${user.email || user.id}`);
  const otpAuthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(otpAuthUrl)}`;
  return res.json({ success: true, secret, otpAuthUrl, qrUrl, enabled: Boolean(user.twofaEnabled) });
});

app.post('/api/2fa/enable', requireUserAuth, async (req, res) => {
  const { userId, code } = req.body || {};
  if (!userId || req.authUserId !== userId) return res.status(403).json({ error: 'Forbidden' });
  const user = await findById(userId);
  if (!user || !user.twofaSecret) return res.status(400).json({ error: 'Сначала получите секрет 2FA' });
  if (!verifyTotp(user.twofaSecret, String(code || '').replace(/\s/g, ''), 1)) return res.status(400).json({ error: 'Неверный код 2FA' });
  await pool.query('UPDATE users SET twofa_enabled=TRUE WHERE id=$1', [userId]);
  const updated = await findById(userId);
  return res.json({ success: true, user: safeUser(updated) });
});

app.post('/api/2fa/disable', requireUserAuth, async (req, res) => {
  const { userId, code } = req.body || {};
  if (!userId || req.authUserId !== userId) return res.status(403).json({ error: 'Forbidden' });
  const user = await findById(userId);
  if (!user || !user.twofaSecret || !user.twofaEnabled) return res.status(400).json({ error: '2FA уже выключена' });
  if (!verifyTotp(user.twofaSecret, String(code || '').replace(/\s/g, ''), 1)) return res.status(400).json({ error: 'Неверный код 2FA' });
  await pool.query('UPDATE users SET twofa_enabled=FALSE WHERE id=$1', [userId]);
  const updated = await findById(userId);
  return res.json({ success: true, user: safeUser(updated) });
});


function userPasskeyRow(row) {
  return row ? {
    credentialId: row.credential_id,
    userId: row.user_id,
    publicKey: row.public_key,
    signCount: Number(row.sign_count || 0),
    name: row.name || 'Passkey',
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  } : null;
}

async function listUserPasskeys(userId) {
  const { rows } = await pool.query(
    'SELECT credential_id, user_id, public_key, sign_count, name, created_at, last_used_at FROM user_passkeys WHERE user_id=$1 ORDER BY created_at DESC',
    [userId]
  );
  return rows.map(userPasskeyRow);
}

function buildUserPasskeyOptions(req, kind, userId = null) {
  const challenge = b64url(crypto.randomBytes(32));
  putUserWebAuthnChallenge(kind, challenge, userId);
  return {
    challenge,
    rpId: resolveAdminWebAuthnRpId(req),
    origin: resolveAdminWebAuthnOrigin(req),
  };
}

function verifyUserPasskeyAssertion(req, credential, expectedUserId = null) {
  const { id, response } = req.body || {};
  const clientDataJSON = fromB64url(response?.clientDataJSON);
  const authenticatorData = fromB64url(response?.authenticatorData);
  const signature = fromB64url(response?.signature);
  const parsed = parseAuthenticatorData(authenticatorData);
  verifyClientData(clientDataJSON, {
    type: 'webauthn.get',
    challenge: req.body?.challenge,
    origin: resolveAdminWebAuthnOrigin(req),
  });
  if (!consumeUserWebAuthnChallenge('login', req.body?.challenge, expectedUserId)) throw new Error('Challenge истёк');
  if (!parsed.rpIdHash.equals(expectedRpIdHash(req))) throw new Error('RP ID не совпадает');
  if ((parsed.flags & 0x01) === 0) throw new Error('Пользователь не подтверждён authenticator');
  const signed = Buffer.concat([authenticatorData, crypto.createHash('sha256').update(clientDataJSON).digest()]);
  const ok = crypto.verify('sha256', signed, credential.publicKey, signature);
  if (!ok || id !== credential.credentialId) throw new Error('Подпись passkey не прошла проверку');
  return parsed.signCount;
}

app.get('/api/passkeys', requireUserAuth, async (req, res) => {
  const rows = await listUserPasskeys(req.authUserId);
  res.json({ success: true, passkeys: rows.map(({ credentialId, name, createdAt, lastUsedAt }) => ({ credentialId, name, createdAt, lastUsedAt })) });
});

app.post('/api/passkey/register-options', requireUserAuth, async (req, res) => {
  const user = await findById(req.authUserId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  const existing = await listUserPasskeys(user.id);
  const base = buildUserPasskeyOptions(req, 'register', user.id);
  res.json({
    publicKey: {
      challenge: base.challenge,
      rp: { name: 'Cicada Studio', id: base.rpId },
      user: { id: b64url(Buffer.from(user.id)), name: user.email || user.id, displayName: user.name || user.email || user.id },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      timeout: 60000,
      authenticatorSelection: { userVerification: 'required', residentKey: 'required', requireResidentKey: true },
      excludeCredentials: existing.map((c) => ({ type: 'public-key', id: c.credentialId })),
      attestation: 'none',
    },
    challenge: base.challenge,
  });
});

app.post('/api/passkey/register', requireUserAuth, async (req, res) => {
  try {
    const clientDataJSON = fromB64url(req.body?.response?.clientDataJSON);
    const attestationObject = fromB64url(req.body?.response?.attestationObject);
    verifyClientData(clientDataJSON, {
      type: 'webauthn.create',
      challenge: req.body?.challenge,
      origin: resolveAdminWebAuthnOrigin(req),
    });
    if (!consumeUserWebAuthnChallenge('register', req.body?.challenge, req.authUserId)) throw new Error('Challenge истёк');
    const parsed = extractRegistrationCredential(attestationObject);
    const authData = decodeCborFirst(attestationObject).get('authData');
    if (!parseAuthenticatorData(authData).rpIdHash.equals(expectedRpIdHash(req))) throw new Error('RP ID не совпадает');
    await pool.query(
      `INSERT INTO user_passkeys (credential_id, user_id, public_key, sign_count, name)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (credential_id) DO UPDATE SET user_id=EXCLUDED.user_id, public_key=EXCLUDED.public_key, sign_count=EXCLUDED.sign_count`,
      [parsed.credentialId, req.authUserId, parsed.publicKey, parsed.signCount, String(req.body?.name || 'Passkey').slice(0, 80)]
    );
    recordUserAction(req.authUserId, 'passkey_register', { credentialId: parsed.credentialId.slice(0, 12) });
    res.json({ success: true, passkeys: (await listUserPasskeys(req.authUserId)).map(({ credentialId, name, createdAt, lastUsedAt }) => ({ credentialId, name, createdAt, lastUsedAt })) });
  } catch (err) {
    recordAuthError('user_passkey_register', req, req.authUserId, err.message);
    res.status(400).json({ error: err.message || 'Не удалось зарегистрировать passkey' });
  }
});

app.post('/api/passkey/login-options', loginRateLimit, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const user = email ? await findByEmail(email) : null;

  if (email) {
    if (!user || user.banned || !user.verified) return res.status(404).json({ error: 'Passkey для этого email не найден' });
    const passkeys = await listUserPasskeys(user.id);
    if (!passkeys.length) return res.status(404).json({ error: 'Passkey для этого email не найден' });
    const base = buildUserPasskeyOptions(req, 'login', user.id);
    return res.json({
      publicKey: {
        challenge: base.challenge,
        rpId: base.rpId,
        timeout: 60000,
        userVerification: 'required',
        allowCredentials: passkeys.map((c) => ({ type: 'public-key', id: c.credentialId })),
      },
      challenge: base.challenge,
    });
  }

  // Empty allowCredentials asks the browser to show a discoverable (resident) passkey,
  // so mobile users can sign in by fingerprint / Face ID without entering email first.
  const base = buildUserPasskeyOptions(req, 'login', null);
  res.json({
    publicKey: {
      challenge: base.challenge,
      rpId: base.rpId,
      timeout: 60000,
      userVerification: 'required',
    },
    challenge: base.challenge,
  });
});

app.post('/api/passkey/login', loginRateLimit, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT credential_id, user_id, public_key, sign_count, name, created_at, last_used_at FROM user_passkeys WHERE credential_id=$1',
      [String(req.body?.id || '')]
    );
    const credential = userPasskeyRow(rows[0]);
    if (!credential) throw new Error('Passkey не найден');
    const signCount = verifyUserPasskeyAssertion(req, credential, credential.userId);
    const user = await findById(credential.userId);
    if (!user || user.banned || !user.verified) throw new Error('Аккаунт недоступен');
    await pool.query('UPDATE user_passkeys SET sign_count=$1, last_used_at=NOW() WHERE credential_id=$2', [signCount, credential.credentialId]);
    const authToken = issueUserJwt(user.id);
    recordUserLogin(user.id, req.ip, 'passkey');
    recordUserAction(user.id, 'login_success', { method: 'passkey' });
    res.json({ success: true, user: safeUser(user), token: authToken });
  } catch (err) {
    recordAuthError('user_passkey_login', req, null, err.message);
    res.status(400).json({ error: err.message || 'Не удалось войти по passkey' });
  }
});
app.post('/api/logout', (req, res) => {
  res.clearCookie(OAUTH_JWT_HANDOFF_COOKIE, {
    path: '/', httpOnly: true, sameSite: 'strict', secure: isHttps,
  });
  res.clearCookie('session_token', { path: '/' });
  res.json({ ok: true });
});


function parseAvatarDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) {
    const err = new Error('Неверный формат аватара. Загрузите JPG, PNG или WebP.');
    err.publicMessage = err.message;
    throw err;
  }
  const mime = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const ext = AVATAR_MIME_EXT.get(mime);
  if (!ext) {
    const err = new Error('Поддерживаются только JPG, PNG и WebP');
    err.publicMessage = err.message;
    throw err;
  }
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length || buffer.length > AVATAR_MAX_BYTES) {
    const err = new Error('Аватар слишком большой. Максимум 5MB после сжатия.');
    err.publicMessage = err.message;
    throw err;
  }
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng = buffer.length >= 8 && buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = buffer.length >= 12 && buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP';
  if ((mime === 'image/jpeg' && !isJpeg) || (mime === 'image/png' && !isPng) || (mime === 'image/webp' && !isWebp)) {
    const err = new Error('Файл аватара повреждён или не совпадает с выбранным форматом');
    err.publicMessage = err.message;
    throw err;
  }
  return { buffer, ext };
}

function avatarFilePathFromUrl(photoUrl) {
  if (typeof photoUrl !== 'string' || !photoUrl.startsWith(`${AVATAR_URL_PREFIX}/`)) return null;
  const fileName = path.basename(photoUrl.slice(AVATAR_URL_PREFIX.length + 1));
  if (!/^avatar-[a-f0-9-]+\.(?:jpg|png|webp)$/i.test(fileName)) return null;
  return path.join(AVATAR_UPLOAD_DIR, fileName);
}

function cleanupLocalAvatar(photoUrl) {
  const filePath = avatarFilePathFromUrl(photoUrl);
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch {}
}

function saveAvatarDataUrl(dataUrl, oldPhotoUrl = null) {
  const { buffer, ext } = parseAvatarDataUrl(dataUrl);
  fs.mkdirSync(AVATAR_UPLOAD_DIR, { recursive: true });
  const fileName = `avatar-${crypto.randomUUID()}.${ext}`;
  const filePath = path.join(AVATAR_UPLOAD_DIR, fileName);
  fs.writeFileSync(filePath, buffer, { flag: 'wx' });
  cleanupLocalAvatar(oldPhotoUrl);
  return `${AVATAR_URL_PREFIX}/${fileName}`;
}

async function updateUserAvatar(userId, dataUrl) {
  const user = await findById(userId);
  if (!user) {
    const err = new Error('Пользователь не найден');
    err.publicMessage = err.message;
    throw err;
  }
  const photoUrl = saveAvatarDataUrl(dataUrl, user.photo_url);
  await pool.query('UPDATE users SET photo_url=$1 WHERE id=$2', [photoUrl, userId]);
  recordUserAction(userId, 'avatar_update', { storage: 'local_file' });
  return findById(userId);
}


app.post('/api/avatar', requireUserAuth, async (req, res) => {
  const { userId, dataUrl } = req.body || {};
  if (!userId || req.authUserId !== userId) return res.status(403).json({ error: 'Forbidden' });
  try {
    const updated = await updateUserAvatar(userId, dataUrl);
    return res.json({ success: true, user: safeUser(updated) });
  } catch (e) {
    console.error('POST /api/avatar', e?.message || e);
    return res.status(400).json({ error: e?.publicMessage || 'Не удалось сохранить аватар' });
  }
});

app.post('/api/update', requireUserAuth, async (req, res) => {
  const { userId, updates } = req.body;
  if (!userId || !updates) return res.json({ error: 'Неверный запрос' });
  if (req.authUserId !== userId) return res.status(403).json({ error: 'Forbidden' });

  const user = await findById(userId);
  if (!user) return res.json({ error: 'Пользователь не найден' });

  if (updates.password) {
    if (updates.currentPassword && !checkPassword(updates.currentPassword, user.password))
      return res.json({ error: 'Текущий пароль неверный' });
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashPassword(updates.password), userId]);
  }

  const newName  = updates.name  ?? user.name;
  const newEmail = updates.email ?? user.email;
  let newPhotoUrl = user.photo_url ?? null;
  if (Object.prototype.hasOwnProperty.call(updates, 'photo_url')) {
    const candidate = updates.photo_url;
    if (candidate === null || candidate === '') {
      cleanupLocalAvatar(user.photo_url);
      newPhotoUrl = null;
    } else if (typeof candidate === 'string') {
      if (candidate.startsWith('data:image/')) {
        try {
          newPhotoUrl = saveAvatarDataUrl(candidate, user.photo_url);
        } catch (e) {
          return res.status(400).json({ error: e?.publicMessage || 'Неверный формат аватара' });
        }
      } else if (candidate.length > 2048) {
        return res.json({ error: 'Ссылка на аватар слишком длинная' });
      } else {
        newPhotoUrl = candidate;
      }
    } else {
      return res.json({ error: 'Неверный формат аватара' });
    }
  }

  let newTestToken = user.test_token ?? null;
  if (Object.prototype.hasOwnProperty.call(updates, 'test_token')) {
    const t = updates.test_token;
    newTestToken = (t === null || t === '') ? null : String(t).trim().slice(0, 200);
  }

  let newUiLanguage = user.uiLanguage ?? 'ru';
  if (Object.prototype.hasOwnProperty.call(updates, 'ui_language')) {
    const langCandidate = String(updates.ui_language ?? '').trim().toLowerCase();
    const allowedLanguages = new Set(['ru', 'en', 'uk']);
    if (!allowedLanguages.has(langCandidate)) {
      return res.json({ error: 'Недопустимый язык интерфейса' });
    }
    newUiLanguage = langCandidate;
  }

  await pool.query(
    'UPDATE users SET name = $1, email = $2, photo_url = $3, test_token = $4, ui_language = $5 WHERE id = $6',
    [newName, newEmail, newPhotoUrl, newTestToken, newUiLanguage, userId]
  );

  const updated = await findById(userId);
  recordUserAction(userId, 'profile_update', { changed: Object.keys(updates || {}) });
  res.json({ success: true, user: safeUser(updated) });
});

// ================= EMAIL CHANGE =================

app.post('/api/request-email-change', requireUserAuth, emailChangeRateLimit, async (req, res) => {
  const { userId, currentEmail, newEmail } = req.body;
  if (!userId || !currentEmail || !newEmail) return res.json({ error: 'Неверный запрос' });
  if (req.authUserId !== userId) return res.status(403).json({ error: 'Forbidden' });

  const user = await findById(userId);
  if (!user)                       return res.json({ error: 'Пользователь не найден' });
  if (user.email !== currentEmail) return res.json({ error: 'Текущий email не совпадает' });
  if (await findByEmail(newEmail)) return res.json({ error: 'Этот email уже используется' });

  const code = String(Math.floor(100000 + Math.random() * 900000));
  await pool.query(
    'UPDATE users SET email_change_code=$1, email_change_code_exp=$2, email_change_pending=$3 WHERE id=$4',
    [code, Date.now() + 15 * 60 * 1000, newEmail, userId]
  );

  try { await sendEmailChangeCode(currentEmail, user.name, code, newEmail); }
  catch (e) { console.error('Email change send error:', e); return res.json({ error: 'Не удалось отправить письмо.' }); }

  res.json({ success: true });
});

app.post('/api/confirm-email-change', confirmEmailChangeRateLimit, async (req, res) => {
  const { userId, code, newEmail } = req.body;
  if (!userId || !code || !newEmail) return res.json({ error: 'Неверный запрос' });

  const user = await findById(userId);
  if (!user)                                      return res.json({ error: 'Пользователь не найден' });
  if (!user.emailChangeCode)                      return res.json({ error: 'Код не был запрошен' });
  if (Date.now() > user.emailChangeCodeExp)       return res.json({ error: 'Код устарел' });
  if (user.emailChangeCode !== code.trim())       return res.json({ error: 'Неверный код подтверждения' });
  if (user.emailChangePending !== newEmail)       return res.json({ error: 'Email не совпадает с запрошенным' });

  await pool.query(
    'UPDATE users SET email=$1, email_change_code=NULL, email_change_code_exp=NULL, email_change_pending=NULL WHERE id=$2',
    [newEmail, userId]
  );
  const updated = await findById(userId);
  res.json({ success: true, user: safeUser(updated) });
});

// ================= PASSWORD RESET =================

app.post('/api/forgot-password', forgotPasswordRateLimit, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.json({ error: 'Введите email' });

  const user = await findByEmail(email);
  if (!user) return res.json({ success: true });

  const resetToken = generateToken();
  await pool.query(
    'UPDATE users SET reset_token=$1, reset_token_exp=$2 WHERE id=$3',
    [resetToken, Date.now() + 60 * 60 * 1000, user.id]
  );

  try { await sendPasswordResetEmail(email, user.name, resetToken); }
  catch (e) { console.error('Reset email error:', e); return res.json({ error: 'Не удалось отправить письмо.' }); }

  res.json({ success: true });
});

app.post('/api/reset-password', resetPasswordSubmitRateLimit, async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password)  return res.json({ error: 'Неверный запрос' });
  if (password.length < 6)  return res.json({ error: 'Минимум 6 символов' });

  const user = await findByToken('reset_token', token);
  if (!user)                        return res.json({ error: 'Недействительная ссылка' });
  if (Date.now() > user.resetTokenExp) return res.json({ error: 'Ссылка устарела' });

  await pool.query(
    'UPDATE users SET password=$1, reset_token=NULL, reset_token_exp=NULL WHERE id=$2',
    [hashPassword(password), user.id]
  );
  res.json({ success: true });
});

// ================= BOT HELPERS =================

// ================= BOT API =================

/** Проверка DSL: схема (schema + плейсхолдер токена) + Python-парсер Cicada. */
app.post('/api/dsl/lint', (req, res) => {
  try {
    const code = req.body?.code;
    if (typeof code !== 'string') {
      return res.status(400).json({ error: 'no code', available: false, ok: false, diagnostics: [] });
    }
    const schemaDiags = lintDSLSchema(code);
    const py = lintCicadaWithPython({ code });
    const hintPack = getDslHintsWithPython({ code });
    const pyDiags = py.diagnostics || [];
    const merged = [...schemaDiags, ...pyDiags];
    const hasErr = (d) => d.severity === 'error';
    const schemaErr = schemaDiags.filter(hasErr).length;
    const pyErr = pyDiags.filter(hasErr).length;
    const ok =
      py.available &&
      py.ok &&
      schemaErr === 0 &&
      pyErr === 0 &&
      !py.error;
    return res.json({
      ok,
      available: py.available,
      diagnostics: merged,
      hints: Array.isArray(hintPack?.hints) ? hintPack.hints : [],
      error: py.error,
    });
  } catch (e) {
    return sendInternalApiError(res, 'POST /api/dsl/lint', e, 'Не удалось проверить код', 500);
  }
});

const PREVIEW_MAX_CODE_BYTES = Number(process.env.DSL_MAX_CODE_BYTES || 100_000);
const SAFE_PREVIEW_SESSION = /^[a-zA-Z0-9._:-]{8,128}$/;
const SAFE_CHAT_ID = /^\d{1,16}$/;

/** Симуляция Telegram один шаг за запрос (состояние сценария хранится в сессии на стороне воркера). */
app.post('/api/bot/preview', botPreviewRateLimit, async (req, res) => {
  try {
    const sessionId = req.body?.sessionId;
    const code = req.body?.code;
    const text = req.body?.text;
    const callbackData = req.body?.callbackData;
    const chatIdRaw = req.body?.chatId;

    if (!sessionId || typeof sessionId !== 'string' || !SAFE_PREVIEW_SESSION.test(sessionId)) {
      return res.status(400).json({ error: 'Некорректный sessionId' });
    }
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Нет кода DSL' });
    }
    if (Buffer.byteLength(code, 'utf8') > PREVIEW_MAX_CODE_BYTES) {
      return res.status(400).json({ error: `Код слишком большой (>${PREVIEW_MAX_CODE_BYTES} байт)` });
    }

    if (callbackData != null && callbackData !== '' && typeof callbackData !== 'string') {
      return res.status(400).json({ error: 'callbackData должна быть строкой' });
    }
    if (text != null && typeof text !== 'string') {
      return res.status(400).json({ error: 'text должна быть строкой' });
    }

    let chatId = '990000001';
    if (chatIdRaw != null && String(chatIdRaw).trim() !== '') {
      const s = String(chatIdRaw).trim();
      if (!SAFE_CHAT_ID.test(s)) {
        return res.status(400).json({ error: 'Некорректный chatId' });
      }
      chatId = s;
    }

    const out = await sendPreviewRequest({
      sessionId,
      code,
      chatId,
      text: text != null ? text : '',
      callbackData:
        callbackData != null && String(callbackData).length > 0 ? String(callbackData) : null,
    });

    return res.json(out);
  } catch (e) {
    return sendInternalApiError(res, 'POST /api/bot/preview', e, 'Не удалось выполнить превью', 500);
  }
});

app.post('/api/run', async (req, res) => {
  try {
    const { code, userId } = req.body;
    if (!userId) return res.json({ error: 'no userId' });
    if (!code)   return res.json({ error: 'no code' });
    const tokenMatch = String(code).match(/^\s*бот\s+"([^"]*)"/m);
    const token = tokenMatch?.[1]?.trim() || '';
    if (!token) {
      return res.status(400).json({
        error: 'Укажи токен бота в строке: бот "TOKEN"',
      });
    }
    if (isPlaceholderBotToken(token)) {
      return res.status(400).json({
        error: 'Замените шаблонный токен на реальный токен от @BotFather',
      });
    }
    const meta = startRunner({
      userId,
      code,
      cicadaBin: CICADA_BIN,
      botsDir: BOTS_DIR,
      onEvent: (event, data) => {
        if (event === 'timeout') recordUserAction(data.userId, 'bot_timeout', {});
        if (event === 'output_limit') {
          recordUserAction(data.userId, 'bot_output_limit', { outputBytes: data.outputBytes });
          pushSystemError('dsl_runner', `output_limit:${data.outputBytes}`);
        }
        if (event === 'error') pushSystemError('dsl_runner', data.message || 'runner error');
        if (event === 'exit' && (data.code !== 0 || data.signal)) {
          recordUserAction(data.userId, 'bot_exit', { code: data.code, signal: data.signal });
        }
      },
    });
    // Если процесс падает сразу после старта, возвращаем причину сразу в ответ API.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    if (!isRunnerActive(userId)) {
      const info = getRunnerLogs(userId, 80);
      const tail = String(info.logs || '').trim().split(/\r?\n/).slice(-8).join('\n');
      const last = info.lastExit || {};
      const humanError = tail
        ? `Бот завершился сразу после запуска\n\nЛог:\n${tail}`
        : `Бот завершился сразу после запуска (reason=${last.reason || 'exit'}, code=${last.code ?? 'null'}, signal=${last.signal ?? 'null'})`;
      return res.status(422).json({
        error: humanError,
        details: {
          reason: last.reason || 'exit',
          code: last.code ?? null,
          signal: last.signal ?? null,
          logTail: tail,
        },
      });
    }
    recordUserAction(userId, 'bot_start', { runtimeSec: Math.floor(meta.timeoutMs / 1000) });
    res.json({ status: 'started', autoStopIn: Math.floor(meta.timeoutMs / 1000) });
  } catch (e) {
    return sendInternalApiError(res, 'POST /api/run', e, 'Не удалось запустить бота', 500);
  }
});

app.post('/api/stop', (req, res) => {
  const { userId } = req.body;
  if (!isRunnerActive(userId)) return res.json({ error: 'no bot' });
  stopRunner(userId, { reason: 'manual' });
  recordUserAction(userId, 'bot_stop', {});
  res.json({ status: 'stopped' });
});

app.get('/api/bots', (req, res) => {
  res.json(listRunners());
});

/** Логи процесса cicada для песочницы «Запуск» (тот же userId, что в POST /api/run). */
app.get('/api/bot/logs', (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId || typeof userId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(userId)) {
      return res.status(400).json({ error: 'invalid userId' });
    }
    const info = getRunnerLogs(userId, 280);
    res.json(info);
  } catch (e) {
    return sendInternalApiError(res, 'GET /api/bot/logs', e, 'Не удалось получить логи бота', 500);
  }
});

// ================= SUBSCRIPTION =================

const PLANS = {
  '2w': { label: '2 недели',  days: 14,  usd: 5  },
  '1m': { label: '1 месяц',   days: 30,  usd: 8  },
  '3m': { label: '3 месяца',  days: 90,  usd: 20 },
  '6m': { label: '6 месяцев', days: 180, usd: 35 },
  '1y': { label: '1 год',     days: 365, usd: 60 },
};

const CRYPTOBOT_API = 'https://pay.crypt.bot/api';

async function cryptobotRequest(method, params = {}) {
  const r = await fetch(`${CRYPTOBOT_API}/${method}`, {
    method: 'POST',
    headers: { 'Crypto-Pay-API-Token': CRYPTOBOT_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await r.json();
  if (!data.ok) throw new Error(data.error?.name || 'CryptoBot error');
  return data.result;
}

async function getRateToUSD(asset) {
  try {
    const rates = await cryptobotRequest('getExchangeRates');
    const r = rates.find(r => r.source === asset && (r.target === 'USDT' || r.target === 'USD'));
    if (r) return parseFloat(r.rate);
    const inv = rates.find(r => r.target === asset && (r.source === 'USDT' || r.source === 'USD'));
    if (inv) return 1 / parseFloat(inv.rate);
    return null;
  } catch { return null; }
}

app.post('/api/subscription/create', async (req, res) => {
  const { userId, plan, asset } = req.body;
  const planInfo = PLANS[plan];
  if (!planInfo) return res.json({ error: 'Неверный план' });
  if (!['USDT','TRX','LTC'].includes(asset)) return res.json({ error: 'Неверная валюта' });

  const user = await findById(userId);
  if (!user) return res.json({ error: 'Пользователь не найден' });

  let amount;
  if (asset === 'USDT') {
    amount = planInfo.usd.toFixed(2);
  } else {
    const rate = await getRateToUSD(asset);
    if (!rate) return res.json({ error: 'Не удалось получить курс' });
    amount = (planInfo.usd / rate).toFixed(6);
  }

  try {
    const invoice = await cryptobotRequest('createInvoice', {
      asset, amount,
      description: `Cicada Studio — ${planInfo.label}`,
      payload: JSON.stringify({ userId, plan }),
      paid_btn_name: 'openBot', paid_btn_url: APP_URL,
      allow_comments: false, allow_anonymous: false, expires_in: 3600,
    });
    res.json({ ok: true, invoiceUrl: invoice.pay_url, amount, asset });
  } catch (e) {
    return sendInternalApiError(
      res,
      'POST /api/subscription/create',
      e,
      'Не удалось создать счёт. Попробуйте позже.',
      502,
    );
  }
});

app.post('/api/subscription/webhook', async (req, res) => {
  const { update_type, payload: invoicePayload } = req.body;
  if (update_type !== 'invoice_paid') return res.json({ ok: true });

  let meta;
  try { meta = JSON.parse(invoicePayload.payload); } catch { return res.json({ ok: true }); }

  const { userId, plan } = meta;
  const planInfo = PLANS[plan];
  if (!planInfo) return res.json({ ok: true });

  const user = await findById(userId);
  if (!user) return res.json({ ok: true });

  const now  = Date.now();
  const base = user.plan === 'pro' && user.subscriptionExp && user.subscriptionExp > now
    ? user.subscriptionExp : now;
  const newExp = base + planInfo.days * 24 * 60 * 60 * 1000;

  await pool.query("UPDATE users SET plan='pro', subscription_exp=$1 WHERE id=$2", [newExp, userId]);
  pushRing(recentSubscriptions, {
    at: new Date().toISOString(),
    userId,
    source: 'payment',
    plan,
    days: planInfo.days,
    subscriptionExp: newExp,
  }, 400);
  recordUserAction(userId, 'subscription_paid', { plan, days: planInfo.days, subscriptionExp: newExp });
  console.log(`✅ Subscription: ${userId} → ${plan} until ${new Date(newExp).toISOString()}`);
  res.json({ ok: true });
});

app.get('/api/subscription/status', async (req, res) => {
  const { userId } = req.query;
  const user = await findById(userId);
  if (!user) return res.json({ error: 'Пользователь не найден' });

  const now    = Date.now();
  const active = user.plan === 'pro' && user.subscriptionExp && user.subscriptionExp > now;
  res.json({
    plan:            active ? 'pro' : 'trial',
    subscriptionExp: user.subscriptionExp ?? null,
    daysLeft:        active ? Math.ceil((user.subscriptionExp - now) / 86400000) : 0,
  });
});

// Публичный эндпоинт — цены для фронтенда
app.get('/api/plans', (req, res) => {
  res.json({ plans: PLANS });
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    uptimeSec: Math.floor(process.uptime()),
    nowIso: new Date().toISOString(),
  });
});

// Одноразовый обмен cookie → JWT в localStorage после Google OAuth
app.get('/api/auth/oauth-bootstrap', async (req, res) => {
  const handoffOpts = { path: '/', httpOnly: true, sameSite: 'strict', secure: isHttps };
  const pendingOpts = { path: '/', httpOnly: true, sameSite: 'strict', secure: isHttps, maxAge: 10 * 60 * 1000 };
  const pendingRaw = req.cookies?.[OAUTH_2FA_PENDING_COOKIE];
  if (pendingRaw) {
    try {
      const d = jwt.verify(pendingRaw, JWT_SECRET);
      if (d?.type === 'oauth_2fa_pending' && d?.sub) {
        const user = await findById(String(d.sub));
        if (user && user.role === 'admin' && user.twofaEnabled && !user.banned) {
          return res.json({ ok: false, twofaRequired: true, user: safeUser(user) });
        }
      }
    } catch {}
    res.clearCookie(OAUTH_2FA_PENDING_COOKIE, pendingOpts);
  }
  const raw = req.cookies?.[OAUTH_JWT_HANDOFF_COOKIE];
  res.clearCookie(OAUTH_JWT_HANDOFF_COOKIE, handoffOpts);
  if (!raw) return res.json({ ok: false });
  try {
    const d = jwt.verify(raw, JWT_SECRET);
    if (!d || d.type !== 'user' || !d.sub) return res.json({ ok: false });
    const user = await findById(String(d.sub));
    if (!user || user.banned) return res.json({ ok: false });
    return res.json({ ok: true, token: raw, user: safeUser(user) });
  } catch {
    return res.json({ ok: false });
  }
});

app.post('/api/auth/oauth-2fa/complete', async (req, res) => {
  const pendingOpts = { path: '/', httpOnly: true, sameSite: 'strict', secure: isHttps, maxAge: 10 * 60 * 1000 };
  const raw = req.cookies?.[OAUTH_2FA_PENDING_COOKIE];
  if (!raw) return res.status(401).json({ error: 'Сессия 2FA истекла. Войдите снова через OAuth.' });
  let userId = null;
  try {
    const d = jwt.verify(raw, JWT_SECRET);
    if (!d || d.type !== 'oauth_2fa_pending' || !d.sub) throw new Error('bad');
    userId = String(d.sub);
  } catch {
    res.clearCookie(OAUTH_2FA_PENDING_COOKIE, pendingOpts);
    return res.status(401).json({ error: 'Сессия 2FA недействительна. Войдите снова через OAuth.' });
  }
  const user = await findById(userId);
  const totp = String(req.body?.totp || '').replace(/\s/g, '');
  if (!user || user.banned) return res.status(403).json({ error: 'Аккаунт недоступен' });
  if (user.role !== 'admin' || !user.twofaEnabled) return res.status(400).json({ error: '2FA отключена для аккаунта' });
  if (!verifyTotp(user.twofaSecret, totp, 1)) return res.status(401).json({ error: 'Неверный код 2FA', twofaRequired: true });

  res.clearCookie(OAUTH_2FA_PENDING_COOKIE, pendingOpts);
  const authToken = issueUserJwt(user.id);
  return res.json({ success: true, token: authToken, user: safeUser(user) });
});

// ================= PROJECTS (PostgreSQL) =================

// Список проектов пользователя
app.get('/api/projects', requireUserAuth, async (req, res) => {
  const userId = req.authUserId;
  try {
    const { rows } = await pool.query(
      `SELECT id, name, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM projects WHERE user_id=$1 ORDER BY updated_at DESC`,
      [userId]
    );
    res.json({ projects: rows });
  } catch (e) {
    console.error('GET /api/projects error:', e);
    res.status(500).json({ error: 'Ошибка базы данных' });
  }
});

// Создать или обновить проект (upsert по user_id + name)
app.post('/api/projects', requireUserAuth, async (req, res) => {
  const userId = req.authUserId;
  const { name, stacks } = req.body;
  if (!name || !stacks) return res.status(400).json({ error: 'name и stacks обязательны' });
  if (name.length > 100) return res.status(400).json({ error: 'Название проекта слишком длинное' });
  const stacksStr = JSON.stringify(stacks);
  if (Buffer.byteLength(stacksStr) > 512_000)
    return res.status(400).json({ error: 'Проект слишком большой (макс 512 КБ)' });
  try {
    const id = `${userId.slice(0, 8)}_${Buffer.from(name).toString('hex').slice(0, 16)}`;
    const { rows } = await pool.query(
      `INSERT INTO projects(id, user_id, name, stacks, updated_at)
         VALUES($1,$2,$3,$4::jsonb,NOW())
       ON CONFLICT(id) DO UPDATE
         SET stacks=$4::jsonb, name=$3, updated_at=NOW()
       RETURNING id, name, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [id, userId, name, stacksStr]
    );
    res.json({ project: rows[0] });
  } catch (e) {
    console.error('POST /api/projects error:', e);
    res.status(500).json({ error: 'Ошибка сохранения' });
  }
});

// Загрузить проект с данными
app.get('/api/projects/:id', requireUserAuth, async (req, res) => {
  const userId = req.authUserId;
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT id, user_id AS "userId", name, stacks,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM projects WHERE id=$1 AND user_id=$2`,
      [id, userId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Проект не найден' });
    res.json({ project: rows[0] });
  } catch (e) {
    console.error('GET /api/projects/:id error:', e);
    res.status(500).json({ error: 'Ошибка базы данных' });
  }
});

// Удалить проект
app.delete('/api/projects/:id', requireUserAuth, async (req, res) => {
  const userId = req.authUserId;
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM projects WHERE id=$1 AND user_id=$2`,
      [id, userId]
    );
    if (!rowCount) return res.status(404).json({ error: 'Проект не найден' });
    res.json({ success: true });
  } catch (e) {
    console.error('DELETE /api/projects/:id error:', e);
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

// ================= USER LIBRARIES =================

const LIBRARY_LIMIT_TRIAL = 3;

function isProUser(user) {
  return user.plan === 'pro' && user.subscriptionExp && user.subscriptionExp > Date.now();
}

app.get('/api/libraries', requireUserAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, description, items,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM user_libraries WHERE user_id=$1 ORDER BY created_at DESC`,
      [req.authUserId]
    );
    res.json({ libraries: rows });
  } catch (e) {
    console.error('GET /api/libraries error:', e);
    res.status(500).json({ error: 'Ошибка загрузки библиотек' });
  }
});

app.post('/api/libraries', requireUserAuth, async (req, res) => {
  try {
    const user = await findById(req.authUserId);
    if (!user) return res.status(401).json({ error: 'Нет доступа' });

    if (!isProUser(user)) {
      const { rowCount } = await pool.query(
        'SELECT 1 FROM user_libraries WHERE user_id=$1', [req.authUserId]
      );
      if (rowCount >= LIBRARY_LIMIT_TRIAL) {
        return res.status(403).json({
          error: `Лимит ${LIBRARY_LIMIT_TRIAL} библиотеки на Trial-плане. Перейди на Pro для безлимита.`,
          limitReached: true,
        });
      }
    }

    const { name, description = '' } = req.body;
    if (!name || typeof name !== 'string' || !name.trim())
      return res.status(400).json({ error: 'Введи название библиотеки' });

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await pool.query(
      `INSERT INTO user_libraries (id, user_id, name, description, items) VALUES ($1,$2,$3,$4,'[]')`,
      [id, req.authUserId, name.trim().slice(0, 80), description.trim().slice(0, 200)]
    );
    const { rows } = await pool.query(
      `SELECT id, name, description, items,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM user_libraries WHERE id=$1`, [id]
    );
    res.json({ library: rows[0] });
  } catch (e) {
    console.error('POST /api/libraries error:', e);
    res.status(500).json({ error: 'Ошибка создания' });
  }
});

app.put('/api/libraries/:id', requireUserAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, items } = req.body;

    const { rows } = await pool.query(
      'SELECT * FROM user_libraries WHERE id=$1 AND user_id=$2', [id, req.authUserId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Библиотека не найдена' });

    const lib = rows[0];
    await pool.query(
      `UPDATE user_libraries SET name=$1, description=$2, items=$3, updated_at=NOW() WHERE id=$4`,
      [
        (name ?? lib.name).toString().trim().slice(0, 80),
        (description ?? lib.description).toString().trim().slice(0, 200),
        JSON.stringify(Array.isArray(items) ? items : lib.items),
        id,
      ]
    );
    const { rows: updated } = await pool.query(
      `SELECT id, name, description, items,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM user_libraries WHERE id=$1`, [id]
    );
    res.json({ library: updated[0] });
  } catch (e) {
    console.error('PUT /api/libraries/:id error:', e);
    res.status(500).json({ error: 'Ошибка обновления' });
  }
});

app.delete('/api/libraries/:id', requireUserAuth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM user_libraries WHERE id=$1 AND user_id=$2',
      [req.params.id, req.authUserId]
    );
    res.json({ success: true });
  } catch (e) {
    console.error('DELETE /api/libraries/:id error:', e);
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

// ================= ADMIN =================

const ADMIN_KEY = process.env.ADMIN_KEY;

/** Если задан (Base32 ≥16 символов после trim), вход в админку требует код из Authenticator (TOTP). */
const ADMIN_TOTP_SECRET = normalizeAdminTotpSecret(process.env.ADMIN_TOTP_SECRET);

const ADMIN_PASSKEYS_FILE = process.env.ADMIN_PASSKEYS_FILE || path.resolve('data/admin-passkeys.json');
const ADMIN_WEBAUTHN_RP_NAME = process.env.ADMIN_WEBAUTHN_RP_NAME || 'Cicada Studio Admin';
const ADMIN_WEBAUTHN_RP_ID = String(process.env.ADMIN_WEBAUTHN_RP_ID || '').trim();
const ADMIN_WEBAUTHN_ORIGIN = String(process.env.ADMIN_WEBAUTHN_ORIGIN || APP_URL || '').replace(/\/$/, '');
const adminWebAuthnChallenges = new Map();
const userWebAuthnChallenges = new Map();

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function fromB64url(value) {
  return Buffer.from(String(value || ''), 'base64url');
}

function resolveAdminWebAuthnOrigin(req) {
  if (ADMIN_WEBAUTHN_ORIGIN) return ADMIN_WEBAUTHN_ORIGIN;
  const proto = req.get('x-forwarded-proto') || req.protocol || (isHttps ? 'https' : 'http');
  const host = req.get('x-forwarded-host') || req.get('host') || API_HOST || 'localhost';
  return `${String(proto).split(',')[0]}://${String(host).split(',')[0]}`.replace(/\/$/, '');
}

function resolveAdminWebAuthnRpId(req) {
  if (ADMIN_WEBAUTHN_RP_ID) return ADMIN_WEBAUTHN_RP_ID;
  try {
    return new URL(resolveAdminWebAuthnOrigin(req)).hostname;
  } catch {
    return String(API_HOST || 'localhost').split(':')[0];
  }
}

function putAdminWebAuthnChallenge(kind, challenge) {
  adminWebAuthnChallenges.set(challenge, { kind, exp: Date.now() + 5 * 60 * 1000 });
}

function consumeAdminWebAuthnChallenge(kind, challenge) {
  const meta = adminWebAuthnChallenges.get(challenge);
  adminWebAuthnChallenges.delete(challenge);
  return Boolean(meta && meta.kind === kind && meta.exp > Date.now());
}

function putUserWebAuthnChallenge(kind, challenge, userId = null) {
  userWebAuthnChallenges.set(challenge, { kind, userId, exp: Date.now() + 5 * 60 * 1000 });
}

function consumeUserWebAuthnChallenge(kind, challenge, userId = null) {
  const meta = userWebAuthnChallenges.get(challenge);
  userWebAuthnChallenges.delete(challenge);
  return Boolean(
    meta
    && meta.kind === kind
    && meta.exp > Date.now()
    && (meta.userId == null || userId == null || meta.userId === userId)
  );
}

setInterval(() => {
  const now = Date.now();
  for (const [challenge, meta] of adminWebAuthnChallenges.entries()) {
    if (!meta || meta.exp <= now) adminWebAuthnChallenges.delete(challenge);
  }
  for (const [challenge, meta] of userWebAuthnChallenges.entries()) {
    if (!meta || meta.exp <= now) userWebAuthnChallenges.delete(challenge);
  }
}, 5 * 60 * 1000).unref();

function loadAdminPasskeys() {
  try {
    const raw = fs.readFileSync(ADMIN_PASSKEYS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.credentials) ? parsed.credentials : [];
  } catch {
    return [];
  }
}

function saveAdminPasskeys(credentials) {
  fs.mkdirSync(path.dirname(ADMIN_PASSKEYS_FILE), { recursive: true });
  fs.writeFileSync(ADMIN_PASSKEYS_FILE, JSON.stringify({ credentials }, null, 2));
}

function decodeCborFirst(buf) {
  let offset = 0;
  function readLen(add) {
    if (add < 24) return add;
    if (add === 24) return buf[offset++];
    if (add === 25) { const v = buf.readUInt16BE(offset); offset += 2; return v; }
    if (add === 26) { const v = buf.readUInt32BE(offset); offset += 4; return v; }
    throw new Error('CBOR length is not supported');
  }
  function readItem() {
    const head = buf[offset++];
    const major = head >> 5;
    const add = head & 31;
    const len = readLen(add);
    if (major === 0) return len;
    if (major === 1) return -1 - len;
    if (major === 2) { const v = buf.subarray(offset, offset + len); offset += len; return v; }
    if (major === 3) { const v = buf.subarray(offset, offset + len).toString('utf8'); offset += len; return v; }
    if (major === 4) return Array.from({ length: len }, () => readItem());
    if (major === 5) {
      const m = new Map();
      for (let i = 0; i < len; i += 1) m.set(readItem(), readItem());
      return m;
    }
    if (major === 7) {
      if (add === 20) return false;
      if (add === 21) return true;
      if (add === 22) return null;
    }
    throw new Error('CBOR type is not supported');
  }
  return readItem();
}

function cosePublicKeyToPem(coseKey) {
  const kty = coseKey.get(1);
  const alg = coseKey.get(3);
  const crv = coseKey.get(-1);
  const x = coseKey.get(-2);
  const y = coseKey.get(-3);
  if (kty !== 2 || alg !== -7 || crv !== 1 || !Buffer.isBuffer(x) || !Buffer.isBuffer(y)) {
    throw new Error('Поддерживаются passkeys ES256/P-256');
  }
  const jwk = { kty: 'EC', crv: 'P-256', x: b64url(x), y: b64url(y) };
  return crypto.createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'pem' });
}

function parseAuthenticatorData(authData) {
  if (!Buffer.isBuffer(authData) || authData.length < 37) throw new Error('Некорректные authenticatorData');
  return {
    rpIdHash: authData.subarray(0, 32),
    flags: authData[32],
    signCount: authData.readUInt32BE(33),
    restOffset: 37,
  };
}

function extractRegistrationCredential(attestationObject) {
  const att = decodeCborFirst(attestationObject);
  const authData = att instanceof Map ? att.get('authData') : null;
  const parsed = parseAuthenticatorData(authData);
  if ((parsed.flags & 0x01) === 0) throw new Error('Пользователь не подтверждён authenticator');
  if ((parsed.flags & 0x40) === 0) throw new Error('Нет attested credential data');
  let o = parsed.restOffset + 16; // AAGUID
  const credIdLen = authData.readUInt16BE(o);
  o += 2;
  const credentialId = authData.subarray(o, o + credIdLen);
  o += credIdLen;
  const publicKey = cosePublicKeyToPem(decodeCborFirst(authData.subarray(o)));
  return { credentialId: b64url(credentialId), publicKey, signCount: parsed.signCount };
}

function expectedRpIdHash(req) {
  return crypto.createHash('sha256').update(resolveAdminWebAuthnRpId(req)).digest();
}

function verifyClientData(clientDataJSON, { type, challenge, origin }) {
  const clientData = JSON.parse(clientDataJSON.toString('utf8'));
  if (clientData.type !== type) throw new Error('Некорректный WebAuthn type');
  if (clientData.challenge !== challenge) throw new Error('Некорректный challenge');
  if (clientData.origin !== origin) throw new Error('Некорректный origin');
}

function verifyAdminPasskeyAssertion(req, credential) {
  const { id, response } = req.body || {};
  const clientDataJSON = fromB64url(response?.clientDataJSON);
  const authenticatorData = fromB64url(response?.authenticatorData);
  const signature = fromB64url(response?.signature);
  const parsed = parseAuthenticatorData(authenticatorData);
  verifyClientData(clientDataJSON, {
    type: 'webauthn.get',
    challenge: req.body?.challenge,
    origin: resolveAdminWebAuthnOrigin(req),
  });
  if (!consumeAdminWebAuthnChallenge('login', req.body?.challenge)) throw new Error('Challenge истёк');
  if (!parsed.rpIdHash.equals(expectedRpIdHash(req))) throw new Error('RP ID не совпадает');
  if ((parsed.flags & 0x01) === 0) throw new Error('Пользователь не подтверждён authenticator');
  const signed = Buffer.concat([authenticatorData, crypto.createHash('sha256').update(clientDataJSON).digest()]);
  const ok = crypto.verify('sha256', signed, credential.publicKey, signature);
  if (!ok || id !== credential.credentialId) throw new Error('Подпись passkey не прошла проверку');
  return parsed.signCount;
}

function buildAdminPasskeyOptions(req, kind) {
  const challenge = b64url(crypto.randomBytes(32));
  putAdminWebAuthnChallenge(kind, challenge);
  return {
    challenge,
    rpId: resolveAdminWebAuthnRpId(req),
    origin: resolveAdminWebAuthnOrigin(req),
  };
}

function isAdminAuthed(req) {
  const token = req.cookies?.admin_session;
  if (!token) return false;
  try {
    const d = jwt.verify(token, JWT_SECRET);
    return d?.type === 'admin';
  } catch {
    return false;
  }
}

/** Подсказка для страницы входа: включён ли второй фактор (не раскрывает ключ). */
app.get('/api/admin/login-config', adminLoginRateLimit, (req, res) => {
  res.json({
    totpRequired: Boolean(ADMIN_TOTP_SECRET),
    passkeyEnabled: loadAdminPasskeys().length > 0,
    webauthn: { rpId: resolveAdminWebAuthnRpId(req), origin: resolveAdminWebAuthnOrigin(req) },
  });
});

app.post('/api/admin/passkey/login-options', adminLoginRateLimit, (req, res) => {
  const credentials = loadAdminPasskeys();
  if (!credentials.length) return res.status(404).json({ error: 'Отпечаток / Face ID для админки ещё не зарегистрирован' });
  const base = buildAdminPasskeyOptions(req, 'login');
  res.json({
    publicKey: {
      challenge: base.challenge,
      rpId: base.rpId,
      timeout: 60000,
      userVerification: 'required',
      allowCredentials: credentials.map((c) => ({ type: 'public-key', id: c.credentialId })),
    },
  });
});

app.post('/api/admin/passkey/login', adminLoginRateLimit, (req, res) => {
  try {
    const credential = loadAdminPasskeys().find((c) => c.credentialId === req.body?.id);
    if (!credential) throw new Error('Отпечаток / Face ID не найден');
    const signCount = verifyAdminPasskeyAssertion(req, credential);
    const credentials = loadAdminPasskeys().map((c) => (
      c.credentialId === credential.credentialId
        ? { ...c, signCount: Math.max(Number(c.signCount || 0), signCount), lastUsedAt: new Date().toISOString() }
        : c
    ));
    saveAdminPasskeys(credentials);
    issueAdminSessionCookie(res);
    recordAdminAction(req, 'admin_passkey_login', null, { credentialId: credential.credentialId.slice(0, 12) });
    res.json({ ok: true });
  } catch (err) {
    recordAuthError('admin_passkey_login', req, null, err.message);
    res.status(403).json({ error: 'Forbidden' });
  }
});

app.post('/api/admin/passkey/register-options', adminLoginRateLimit, (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  const credentials = loadAdminPasskeys();
  const base = buildAdminPasskeyOptions(req, 'register');
  res.json({
    publicKey: {
      challenge: base.challenge,
      rp: { name: ADMIN_WEBAUTHN_RP_NAME, id: base.rpId },
      user: { id: b64url(Buffer.from('admin')), name: 'admin', displayName: 'Cicada Admin' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      timeout: 60000,
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'required', requireResidentKey: true },
      attestation: 'none',
      excludeCredentials: credentials.map((c) => ({ type: 'public-key', id: c.credentialId })),
    },
  });
});

app.post('/api/admin/passkey/register', adminLoginRateLimit, (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const clientDataJSON = fromB64url(req.body?.response?.clientDataJSON);
    const attestationObject = fromB64url(req.body?.response?.attestationObject);
    verifyClientData(clientDataJSON, {
      type: 'webauthn.create',
      challenge: req.body?.challenge,
      origin: resolveAdminWebAuthnOrigin(req),
    });
    if (!consumeAdminWebAuthnChallenge('register', req.body?.challenge)) throw new Error('Challenge истёк');
    const parsed = extractRegistrationCredential(attestationObject);
    const authData = decodeCborFirst(attestationObject).get('authData');
    if (!parseAuthenticatorData(authData).rpIdHash.equals(expectedRpIdHash(req))) throw new Error('RP ID не совпадает');
    const credentials = loadAdminPasskeys().filter((c) => c.credentialId !== parsed.credentialId);
    credentials.push({
      credentialId: parsed.credentialId,
      publicKey: parsed.publicKey,
      signCount: parsed.signCount,
      createdAt: new Date().toISOString(),
    });
    saveAdminPasskeys(credentials);
    recordAdminAction(req, 'admin_passkey_register', null, { credentialId: parsed.credentialId.slice(0, 12) });
    res.json({ ok: true, count: credentials.length });
  } catch (err) {
    recordAuthError('admin_passkey_register', req, null, err.message);
    res.status(400).json({ error: err.message || 'Не удалось зарегистрировать passkey' });
  }
});

app.post('/api/admin/login', adminLoginRateLimit, (req, res) => {
  const { key } = req.body;
  if (!ADMIN_KEY || ADMIN_KEY.length < 16) {
    recordAuthError('admin_login', req, null, 'admin_key_not_configured');
    return res.status(503).json({ error: 'ADMIN_KEY не настроен безопасно на сервере' });
  }
  if (!key || !timingSafeEqual(key, ADMIN_KEY)) {
    recordAuthError('admin_login', req, null, 'invalid_admin_key');
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (ADMIN_TOTP_SECRET) {
    const rawTotp = req.body?.totp;
    if (
      typeof rawTotp !== 'string'
      || !verifyTotp(ADMIN_TOTP_SECRET, rawTotp.replace(/\s/g, ''), 1)
    ) {
      recordAuthError('admin_login', req, null, 'invalid_admin_totp');
      return res.status(403).json({ error: 'Forbidden' });
    }
  }
  issueAdminSessionCookie(res);
  recordAdminAction(req, 'admin_login', null, {});
  res.json({ ok: true });
});

app.get('/api/admin/session', (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('admin_session', { path: '/', httpOnly: true, sameSite: 'strict', secure: isHttps });
  recordAdminAction(req, 'admin_logout', null, {});
  res.json({ ok: true });
});

app.get('/api/admin/users', async (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  const { rows } = await pool.query('SELECT * FROM users');
  const users = rows.map(row => {
    const u = rowToUser(row);
    const bot = getRunnerStatus(u.id);
    return { ...safeUser(u), botRunning: Boolean(bot), botStartedAt: bot?.startedAt || null };
  });
  res.json({ users });
});

app.post('/api/admin/grant-subscription', async (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  const { userId, days } = req.body;
  if (!userId || !days || days < 1) return res.json({ error: 'Неверные параметры' });

  const user = await findById(userId);
  if (!user) return res.json({ error: 'Пользователь не найден' });

  const now  = Date.now();
  const base = user.plan === 'pro' && user.subscriptionExp && user.subscriptionExp > now
    ? user.subscriptionExp : now;
  const newExp = base + days * 24 * 60 * 60 * 1000;

  await pool.query("UPDATE users SET plan='pro', subscription_exp=$1 WHERE id=$2", [newExp, userId]);
  pushRing(recentSubscriptions, {
    at: new Date().toISOString(),
    userId,
    source: 'admin',
    days,
    subscriptionExp: newExp,
  }, 400);
  recordAdminAction(req, 'grant_subscription', userId, { days, subscriptionExp: newExp });
  console.log(`[Admin] Grant: ${userId} +${days}d until ${new Date(newExp).toISOString()}`);
  res.json({ success: true, subscriptionExp: newExp });
});

app.post('/api/admin/revoke-subscription', async (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  const { userId } = req.body;
  if (!userId) return res.json({ error: 'userId обязателен' });

  const user = await findById(userId);
  if (!user) return res.json({ error: 'Пользователь не найден' });

  await pool.query("UPDATE users SET plan='trial', subscription_exp=NULL WHERE id=$1", [userId]);
  pushRing(recentSubscriptions, {
    at: new Date().toISOString(),
    userId,
    source: 'admin_revoke',
  }, 400);
  recordAdminAction(req, 'revoke_subscription', userId, {
    previousPlan: user.plan,
    previousSubscriptionExp: user.subscriptionExp ?? null,
  });
  console.log(`[Admin] Revoke PRO: ${userId}`);
  res.json({ success: true });
});

app.get('/api/admin/plans', (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  res.json({ plans: PLANS });
});

app.post('/api/admin/plans', (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  const { updates } = req.body;
  if (!updates || typeof updates !== 'object') return res.json({ error: 'Неверный формат' });
  for (const [planKey, vals] of Object.entries(updates)) {
    if (PLANS[planKey] && typeof vals.usd === 'number' && vals.usd > 0) PLANS[planKey].usd = vals.usd;
  }
  recordAdminAction(req, 'update_plans', null, { planKeys: Object.keys(updates) });
  res.json({ success: true, plans: PLANS });
});

app.post('/api/admin/delete-user', async (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  const { userId } = req.body;
  if (!userId) return res.json({ error: 'userId обязателен' });
  // Останавливаем бота если запущен
  if (isRunnerActive(userId)) stopRunner(userId, { reason: 'admin_delete' });
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  recordAdminAction(req, 'delete_user', userId, {});
  console.log(`[Admin] Deleted user: ${userId}`);
  res.json({ success: true });
});

app.get('/api/admin/user/:userId', async (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  const { userId } = req.params;
  const user = await findById(userId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  const loginHistory = userLoginHistory.get(userId) || [];
  const userActions = recentUserActions.filter((x) => x.userId === userId).slice(-40);
  const adminActions = recentAdminActions.filter((x) => x.targetUserId === userId).slice(-40);
  const subscriptions = recentSubscriptions.filter((x) => x.userId === userId).slice(-40);
  const authErrors = recentAuthErrors.filter((x) => x.identifier === user.email || x.identifier === user.tgId || x.identifier === userId).slice(-20);
  const apiErrors = recentApiErrors.filter((x) => x.userId === userId).slice(-20);

  const lastLogin = loginHistory.length ? loginHistory[loginHistory.length - 1] : null;
  const onlineGuess = lastLogin
    && Date.now() - new Date(lastLogin.at).getTime() < 15 * 60 * 1000;

  const status = {
    online: Boolean(onlineGuess),
    botRunning: isRunnerActive(userId),
    botStartedAt: getRunnerStatus(userId)?.startedAt || null,
  };

  res.json({
    user: safeUser(user),
    status,
    loginHistory,
    uniqueIps: [...new Set(loginHistory.map((x) => x.ip).filter(Boolean))],
    actions: userActions,
    adminActions,
    subscriptions,
    authErrors,
    apiErrors,
  });
});

app.post('/api/admin/user/ban', async (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  const { userId, banned } = req.body;
  if (!userId || typeof banned !== 'boolean') return res.status(400).json({ error: 'Неверные параметры' });
  await pool.query('UPDATE users SET banned = $1 WHERE id = $2', [banned, userId]);
  recordAdminAction(req, banned ? 'ban_user' : 'unban_user', userId, {});
  res.json({ success: true });
});

app.post('/api/admin/user/reset-password', async (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  const { userId, newPassword } = req.body;
  if (!userId || !newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  }
  await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashPassword(String(newPassword)), userId]);
  recordAdminAction(req, 'admin_reset_password', userId, {});
  res.json({ success: true });
});

app.post('/api/admin/user/role', async (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  const { userId, role } = req.body;
  const allowed = new Set(['user', 'moderator', 'admin']);
  if (!userId || !allowed.has(role)) return res.status(400).json({ error: 'Неверная роль' });
  await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, userId]);
  recordAdminAction(req, 'set_role', userId, { role });
  res.json({ success: true });
});

app.post('/api/admin/user/access', async (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  const { userId, accessLevel } = req.body;
  const allowed = new Set(['basic', 'pro', 'full']);
  if (!userId || !allowed.has(accessLevel)) return res.status(400).json({ error: 'Неверный доступ' });
  await pool.query('UPDATE users SET access_level = $1 WHERE id = $2', [accessLevel, userId]);
  recordAdminAction(req, 'set_access', userId, { accessLevel });
  res.json({ success: true });
});

app.get('/api/admin/user/:userId/bot-logs', (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  const { userId } = req.params;
  res.json(getRunnerLogs(userId, 120));
});

app.get('/api/admin/logs', (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  const q = req.query.user ? String(req.query.user).trim().toLowerCase() : '';
  const includesQ = (obj) => {
    if (!q) return true;
    return JSON.stringify(obj).toLowerCase().includes(q);
  };
  res.json({
    apiErrors: recentApiErrors.filter(includesQ).slice(-200),
    authErrors: recentAuthErrors.filter(includesQ).slice(-200),
    adminActions: recentAdminActions.filter(includesQ).slice(-200),
  });
});


function supportRequestRow(row) {
  return row ? {
    id: row.id,
    userId: row.user_id,
    from: row.from_text,
    email: row.email,
    subject: row.subject,
    message: row.message,
    status: row.status,
    replyText: row.reply_text,
    repliedAt: row.replied_at,
    createdAt: row.created_at,
    userName: row.user_name,
    userEmail: row.user_email,
  } : null;
}

app.post('/api/support/requests', requireUserAuth, async (req, res) => {
  const user = await findById(req.authUserId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  const from = String(req.body?.from || user.email || user.name || '').trim().slice(0, 200);
  const subject = String(req.body?.subject || '').trim().slice(0, 180);
  const message = String(req.body?.message || '').trim().slice(0, 8000);
  const emailCandidate = String(req.body?.email || user.email || '').trim().slice(0, 200);
  const email = emailCandidate.includes('@') ? emailCandidate : (user.email || null);
  if (!from || !subject || !message) return res.status(400).json({ error: 'Заполните поля: кто, тема и суть вопроса' });
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO support_requests (id, user_id, from_text, email, subject, message)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, user.id, from, email, subject, message]
  );
  recordUserAction(user.id, 'support_request_create', { supportRequestId: id, subject });
  res.json({ success: true, id });
});

app.get('/api/admin/support-requests', async (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  const { rows } = await pool.query(
    `SELECT sr.*, u.name AS user_name, u.email AS user_email
     FROM support_requests sr
     LEFT JOIN users u ON u.id = sr.user_id
     ORDER BY sr.created_at DESC
     LIMIT 300`
  );
  res.json({ requests: rows.map(supportRequestRow) });
});

app.post('/api/admin/support-requests/:id/reply', async (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  const id = String(req.params.id || '');
  const reply = String(req.body?.reply || '').trim().slice(0, 8000);
  if (!reply) return res.status(400).json({ error: 'Введите текст ответа' });
  const { rows } = await pool.query('SELECT * FROM support_requests WHERE id=$1', [id]);
  const item = supportRequestRow(rows[0]);
  if (!item) return res.status(404).json({ error: 'Обращение не найдено' });
  if (!item.email) return res.status(400).json({ error: 'У обращения нет email для ответа' });
  await sendSupportReplyEmail(item.email, item.from || item.userName || 'пользователь', item.subject, reply);
  await pool.query('UPDATE support_requests SET status=$1, reply_text=$2, replied_at=NOW() WHERE id=$3', ['answered', reply, id]);
  recordAdminAction(req, 'support_request_reply', item.userId, { supportRequestId: id });
  res.json({ success: true });
});

app.post('/api/admin/support-requests/:id/status', async (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  const id = String(req.params.id || '');
  const status = String(req.body?.status || 'open').trim();
  if (!['open', 'answered', 'closed'].includes(status)) return res.status(400).json({ error: 'Некорректный статус' });
  await pool.query('UPDATE support_requests SET status=$1 WHERE id=$2', [status, id]);
  recordAdminAction(req, 'support_request_status', null, { supportRequestId: id, status });
  res.json({ success: true });
});

app.delete('/api/admin/support-requests/:id', async (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  const id = String(req.params.id || '');
  await pool.query('DELETE FROM support_requests WHERE id=$1', [id]);
  recordAdminAction(req, 'support_request_delete', null, { supportRequestId: id });
  res.json({ success: true });
});

app.get('/api/admin/security', (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  const adminKeyLen = String(process.env.ADMIN_KEY || '').length;
  const jwtSecretLen = String(process.env.JWT_SECRET || '').length;
  res.json({
    passwordHashing: 'bcrypt',
    adminKeyConfigured: adminKeyLen >= 16,
    adminKeyLength: adminKeyLen,
    jwtConfigured: jwtSecretLen >= 32,
    jwtSecretLength: jwtSecretLen,
    userAuth: 'JWT Bearer (server-side session map не используется)',
    adminTotpConfigured: Boolean(ADMIN_TOTP_SECRET),
    adminPasskeysConfigured: loadAdminPasskeys().length,
    adminWebAuthnRpId: resolveAdminWebAuthnRpId(req),
    adminAuth:
      loadAdminPasskeys().length > 0
        ? 'Отпечаток/Face ID (Passkey/WebAuthn) или ADMIN_KEY' + (ADMIN_TOTP_SECRET ? ' + TOTP' : '') + ', затем JWT в cookie admin_session'
        : (ADMIN_TOTP_SECRET != null
            ? 'ADMIN_KEY + TOTP (RFC 6238), затем JWT в cookie admin_session'
            : 'ADMIN_KEY, затем JWT в httpOnly cookie admin_session (stateless)'),
    userSessionsActive: 0,
    adminSessionsActive: 0,
    cookieSecurity: {
      httpOnly: true,
      sameSite: 'strict',
      secure: Boolean(isHttps),
    },
    controls: {
      rateLimitMiddleware: 'express-rate-limit',
      loginRateLimit: true,
      registerRateLimit: true,
      forgotPasswordRateLimit: true,
      resetPasswordRateLimit: true,
      verifyEmailRateLimit: true,
      emailChangeRateLimit: true,
      confirmEmailChangeRateLimit: true,
      adminLoginRateLimit: true,
      globalApiRateLimit: true,
      jsonBodyLimit: '1mb',
      helmet: true,
      csrfProtection: true,
      authMiddleware: true,
    },
  });
});

app.get('/api/admin/system', (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  const mem = process.memoryUsage();
  res.json({
    uptimeSec: Math.floor(process.uptime()),
    nodeVersion: process.version,
    platform: process.platform,
    pid: process.pid,
    activeBots: listRunners().length,
    memory: {
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
    },
    recentErrors: recentSystemErrors,
    nowIso: new Date().toISOString(),
  });
});

app.get('/api/admin/update-status', (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  const root = path.resolve(process.cwd());
  const fetchRes = spawnSync('git', ['-C', root, 'fetch', '--quiet'], { encoding: 'utf8', timeout: 30_000 });
  if (fetchRes.error) return res.status(500).json({ error: `git fetch: ${fetchRes.error.message}` });
  const localRes = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const remoteRes = spawnSync('git', ['-C', root, 'rev-parse', '@{u}'], { encoding: 'utf8' });
  if (localRes.status !== 0 || remoteRes.status !== 0) return res.status(500).json({ error: 'Не удалось получить состояние Git (проверьте upstream ветки).' });
  const local = String(localRes.stdout || '').trim();
  const remote = String(remoteRes.stdout || '').trim();
  return res.json({ success: true, hasUpdate: Boolean(local && remote && local !== remote), local, remote });
});

app.post('/api/admin/update-apply', (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  const root = path.resolve(process.cwd());

  const stashName = `cicada-auto-update-${Date.now()}`;
  let autoStashed = false;
  const statusRes = spawnSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8', timeout: 30_000 });
  if (statusRes.error || statusRes.status !== 0) {
    return res.status(500).json({ error: `git status: ${statusRes.error?.message || statusRes.stderr || 'ошибка'}` });
  }
  if (String(statusRes.stdout || '').trim()) {
    const stashRes = spawnSync('git', ['-C', root, 'stash', 'push', '--include-untracked', '-m', stashName], { encoding: 'utf8', timeout: 60_000 });
    const stashCombined = `${stashRes.stdout || ''}\n${stashRes.stderr || ''}`;
    const noChangesToSave = /no local changes to save/i.test(stashCombined);
    if (stashRes.error || (stashRes.status !== 0 && !noChangesToSave)) {
      return res.status(500).json({ error: `git stash: ${stashRes.error?.message || stashRes.stderr || 'ошибка'}` });
    }
    autoStashed = !noChangesToSave;
  }

  const pullRes = spawnSync('git', ['-C', root, 'pull', '--ff-only'], { encoding: 'utf8', timeout: 120_000 });
  if (pullRes.error || pullRes.status !== 0) {
    if (autoStashed) spawnSync('git', ['-C', root, 'stash', 'pop'], { encoding: 'utf8', timeout: 60_000 });
    return res.status(500).json({ error: `git pull: ${pullRes.error?.message || pullRes.stderr || 'ошибка'}` });
  }
  const buildRes = spawnSync('npm', ['run', 'build'], { cwd: root, encoding: 'utf8', timeout: 10 * 60_000 });
  if (buildRes.error || buildRes.status !== 0) {
    return res.status(500).json({ error: `npm run build: ${buildRes.error?.message || buildRes.stderr || 'ошибка'}` });
  }
  if (autoStashed) {
    const popRes = spawnSync('git', ['-C', root, 'stash', 'pop'], { encoding: 'utf8', timeout: 60_000 });
    if (popRes.error || popRes.status !== 0) {
      return res.status(500).json({ error: `git stash pop: ${popRes.error?.message || popRes.stderr || 'разрешите конфликт и примените stash вручную'}` });
    }
  }

  recordAdminAction(req, 'system_update_apply', null, { ok: true });
  res.json({ success: true, message: 'Обновление установлено. Перезапуск сервера запущен.' });

  setTimeout(() => {
    try {
      const pm2Res = spawnSync('pm2', ['restart', 'server.mjs', '--name', 'cicada-server'], { cwd: root, encoding: 'utf8', timeout: 60_000 });
      if (pm2Res.error || pm2Res.status !== 0) {
        pushSystemError('admin:update-apply:pm2', new Error(pm2Res.error?.message || pm2Res.stderr || 'pm2 restart failed'));
      }
    } catch (err) {
      pushSystemError('admin:update-apply:pm2', err);
    }
  }, 150);
  return;
});

function buildCicadaSourceArchiveBuffer() {
  const root = path.resolve(process.cwd());
  const gitDir = path.join(root, '.git');
  if (fs.existsSync(gitDir)) {
    const tar = spawnSync('git', ['-C', root, 'archive', '--format=tar', 'HEAD'], {
      maxBuffer: 250 * 1024 * 1024,
    });
    if (tar.error) return { error: `git: ${tar.error.message}` };
    if (tar.status !== 0) {
      return { error: tar.stderr?.toString() || `git archive (код ${tar.status})` };
    }
    const gz = spawnSync('gzip', ['-9', '-c'], {
      input: tar.stdout,
      maxBuffer: 250 * 1024 * 1024,
    });
    if (gz.error) return { error: `gzip: ${gz.error.message}` };
    if (gz.status !== 0) return { error: gz.stderr?.toString() || 'gzip' };
    return { buffer: gz.stdout };
  }
  const parent = path.dirname(root);
  const base = path.basename(root);
  const excludes = ['node_modules', 'dist', 'build', 'coverage', '.cache', 'bots', '.git', '.env', '.DS_Store'];
  const args = ['-czf', '-', '-C', parent];
  for (const ex of excludes) args.push(`--exclude=${ex}`);
  args.push(base);
  const tb = spawnSync('tar', args, { maxBuffer: 250 * 1024 * 1024 });
  if (tb.error) return { error: `tar: ${tb.error.message}` };
  if (tb.status !== 0) return { error: tb.stderr?.toString() || `tar (код ${tb.status})` };
  return { buffer: tb.stdout };
}

app.get('/api/admin/download-database', adminAssetDownloadRateLimit, (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  const host = process.env.DB_HOST || 'localhost';
  const port = String(Number(process.env.DB_PORT) || 5432);
  const database = process.env.DB_NAME || 'cicada';
  const dbUser = process.env.DB_USER || 'cicada_user';
  const password = process.env.DB_PASSWORD || '';
  const env = { ...process.env, PGPASSWORD: password };
  const dump = spawnSync(
    'pg_dump',
    ['-h', host, '-p', port, '-U', dbUser, '-d', database, '--no-owner', '--format=plain'],
    { env, encoding: 'utf8', maxBuffer: 80 * 1024 * 1024 },
  );
  if (dump.error) {
    console.error('[admin] pg_dump spawn:', dump.error);
    return res.status(500).json({ error: 'Не удалось запустить pg_dump. Установите клиент PostgreSQL на сервере.' });
  }
  if (dump.status !== 0) {
    console.error('[admin] pg_dump stderr:', dump.stderr);
    return res.status(500).json({ error: dump.stderr?.toString() || 'Ошибка pg_dump' });
  }
  const fname = `cicada-${database}-${new Date().toISOString().slice(0, 10)}.sql`;
  recordAdminAction(req, 'download_database', null, { database });
  res.setHeader('Content-Type', 'application/sql; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
  res.send(dump.stdout);
});

app.get('/api/admin/download-source', adminAssetDownloadRateLimit, (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  const out = buildCicadaSourceArchiveBuffer();
  if (out.error) {
    console.error('[admin] source archive:', out.error);
    return res.status(500).json({ error: out.error });
  }
  const fname = `cicada-studio-src-${new Date().toISOString().slice(0, 10)}.tar.gz`;
  recordAdminAction(req, 'download_source', null, {});
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
  res.send(out.buffer);
});

// ================= GOOGLE AUTH =================

const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || '').trim();
const GOOGLE_CLIENT_SECRET = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
const GOOGLE_CALLBACK_URL = String(process.env.GOOGLE_CALLBACK_URL || '').trim();

function googleAuthConfigured() {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_CALLBACK_URL);
}

function redirectAppAuthError(res, message) {
  const target = new URL(APP_URL || 'http://localhost');
  target.searchParams.set('auth_error', message);
  res.redirect(target.toString());
}

app.get('/api/auth/google/start', (req, res) => {
  if (!googleAuthConfigured()) {
    return redirectAppAuthError(res, 'Google авторизация не настроена на сервере');
  }
  const state = crypto.randomBytes(20).toString('hex');
  googleAuthStates.set(state, { exp: Date.now() + 10 * 60 * 1000 });

  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  u.searchParams.set('redirect_uri', GOOGLE_CALLBACK_URL);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'openid email profile');
  u.searchParams.set('prompt', 'select_account');
  u.searchParams.set('state', state);
  return res.redirect(u.toString());
});

app.get('/api/auth/google/callback', async (req, res) => {
  try {
    if (!googleAuthConfigured()) {
      return redirectAppAuthError(res, 'Google авторизация не настроена');
    }
    const code = String(req.query?.code || '');
    const state = String(req.query?.state || '');
    if (!code || !state) {
      return redirectAppAuthError(res, 'Google не вернул код авторизации');
    }
    const stateMeta = googleAuthStates.get(state);
    googleAuthStates.delete(state);
    if (!stateMeta || stateMeta.exp <= Date.now()) {
      return redirectAppAuthError(res, 'Сессия Google авторизации истекла');
    }

    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_CALLBACK_URL,
        grant_type: 'authorization_code',
        code,
      }),
    });
    const tokenData = await tokenResp.json().catch(() => ({}));
    if (!tokenResp.ok || !tokenData.access_token) {
      return redirectAppAuthError(res, 'Не удалось получить токен Google');
    }

    const profileResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileResp.json().catch(() => ({}));
    if (!profileResp.ok || !profile.sub || !profile.email) {
      return redirectAppAuthError(res, 'Не удалось получить профиль Google');
    }
    if (profile.email_verified === false) {
      return redirectAppAuthError(res, 'Подтвердите email в Google аккаунте');
    }

    const googleId = String(profile.sub);
    const email = String(profile.email).toLowerCase();
    const name = String(profile.name || profile.given_name || email.split('@')[0] || 'Google User').slice(0, 120);
    const photo = profile.picture ? String(profile.picture) : null;

    let user = await findByGoogleId(googleId);
    if (!user) user = await findByEmail(email);

    if (!user) {
      const newId = Date.now().toString(36) + Math.random().toString(36).slice(2);
      const premiumExp = getNewUserPremiumExp();
      await pool.query(`
        INSERT INTO users (id, name, email, password, verified, plan, subscription_exp, google_id, photo_url, auth_method)
        VALUES ($1,$2,$3,NULL,TRUE,'pro',$4,$5,$6,'google')
      `, [newId, name, email, premiumExp, googleId, photo]);
      user = await findByGoogleId(googleId);
    } else {
      if (user.banned) {
        recordAuthError('google', req, email, 'banned_user');
        return redirectAppAuthError(res, 'Аккаунт заблокирован');
      }
      await pool.query(
        'UPDATE users SET name=$1, photo_url=COALESCE($2, photo_url), google_id=COALESCE(google_id, $3), auth_method=COALESCE(auth_method, $4), verified=TRUE WHERE id=$5',
        [name || user.name, photo, googleId, 'google', user.id],
      );
      user = await findById(user.id);
    }

    if (user.role === 'admin' && user.twofaEnabled) {
      const pending = jwt.sign({ sub: String(user.id), type: 'oauth_2fa_pending' }, JWT_SECRET, { expiresIn: '10m' });
      res.cookie(OAUTH_2FA_PENDING_COOKIE, pending, { httpOnly: true, sameSite: 'strict', secure: isHttps, path: '/', maxAge: 10 * 60 * 1000 });
    } else {
      recordUserLogin(user.id, req.ip, 'google');
      recordUserAction(user.id, 'login_success', { method: 'google' });
      issueOauthJwtHandoffCookie(res, user.id);
    }
    return res.redirect(APP_URL || '/');
  } catch (e) {
    console.error('Google auth callback error:', e);
    return redirectAppAuthError(res, 'Ошибка Google авторизации');
  }
});

// ================= TELEGRAM AUTH =================

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || '';

function telegramAuthMisconfigured() {
  return !TG_BOT_TOKEN || !String(TG_BOT_TOKEN).trim();
}

/** Проверка подписи Login Widget по https://core.telegram.org/widgets/login#checking-authorization */
function verifyTelegramAuth(raw) {
  if (telegramAuthMisconfigured() || !raw || typeof raw !== 'object') return false;
  const hash = raw.hash != null ? String(raw.hash).trim() : '';
  if (!hash) return false;

  const rest = { ...raw };
  delete rest.hash;

  // Только переданные поля; null/undefined/пустая строка — как у Telegram в query (поля просто отсутствуют).
  const keys = Object.keys(rest)
    .filter((k) => rest[k] != null && rest[k] !== '')
    .sort();
  const checkString = keys.map((k) => `${k}=${String(rest[k])}`).join('\n');

  const secretKey = crypto.createHash('sha256').update(TG_BOT_TOKEN).digest();
  const hmac = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');
  let ok = false;
  try {
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(hmac, 'hex');
    ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    ok = false;
  }
  if (!ok) return false;
  if (Date.now() / 1000 - Number(rest.auth_date) > 86400) return false;
  return true;
}

/** Общая логика: создать/обновить пользователя после успешной подписи. */
async function upsertUserFromTelegramPayload(body, req) {
  const { id, first_name, last_name, username, photo_url } = body;
  const tgId = String(id);

  let user = await findByTgId(tgId);
  if (!user) {
    const newId = Date.now().toString(36) + Math.random().toString(36).substr(2);
    const name = [first_name, last_name].filter(Boolean).join(' ') || username || `tg_${tgId}`;
    const premiumExp = getNewUserPremiumExp();
    await pool.query(
      `
      INSERT INTO users (id, name, email, password, verified, plan, subscription_exp, tg_id, username, photo_url, auth_method)
      VALUES ($1,$2,NULL,NULL,TRUE,'pro',$3,$4,$5,$6,'telegram')
    `,
      [newId, name, premiumExp, tgId, username ?? null, photo_url ?? null],
    );
    user = await findByTgId(tgId);
  } else {
    if (user.banned) return { banned: true };
    const name = [first_name, last_name].filter(Boolean).join(' ') || username || user.name;
    await pool.query('UPDATE users SET name=$1, photo_url=$2 WHERE id=$3', [
      name,
      photo_url ?? user.photo_url,
      user.id,
    ]);
    user = await findByTgId(tgId);
  }

  recordUserLogin(user.id, req.ip, 'telegram');
  recordUserAction(user.id, 'login_success', { method: 'telegram' });
  return { user };
}

async function telegramAuthFromPayload(payload, req) {
  if (telegramAuthMisconfigured()) return { misconfigured: true };
  if (!verifyTelegramAuth(payload)) return { badSignature: true };
  const { id } = payload;
  const out = await upsertUserFromTelegramPayload(payload, req);
  if (out?.banned) return { banned: true };
  return { user: out.user };
}

/** Редирект после авторизации Telegram (виджет с data-auth-url). */
app.get('/api/auth/telegram/callback', async (req, res) => {
  try {
    if (telegramAuthMisconfigured()) {
      return redirectAppAuthError(res, 'Вход через Telegram не настроен (TG_BOT_TOKEN)');
    }
    const q = req.query || {};
    const result = await telegramAuthFromPayload(q, req);
    if (result.misconfigured) {
      return redirectAppAuthError(res, 'Вход через Telegram не настроен (TG_BOT_TOKEN)');
    }
    if (result.badSignature) {
      recordAuthError('telegram', req, String(q.id || ''), 'bad_signature');
      return redirectAppAuthError(res, 'Telegram вернул неверную подпись (разные бот-токены или устарело)');
    }
    if (result.banned) {
      recordAuthError('telegram', req, String(req.query?.id || ''), 'banned_user');
      return redirectAppAuthError(res, 'Аккаунт заблокирован администратором');
    }
    issueOauthJwtHandoffCookie(res, result.user.id);
    return res.redirect((APP_URL || '/').replace(/\/$/, '') + '/');
  } catch (e) {
    console.error('telegram callback error:', e);
    return redirectAppAuthError(res, 'Ошибка входа через Telegram');
  }
});

app.post('/api/auth/telegram', async (req, res) => {
  try {
    if (telegramAuthMisconfigured()) {
      recordAuthError('telegram', req, String(req.body?.id || ''), 'not_configured');
      return res.status(503).json({ error: 'Вход через Telegram не настроен на сервере (TG_BOT_TOKEN)' });
    }
    const result = await telegramAuthFromPayload(req.body, req);
    if (result.badSignature) {
      recordAuthError('telegram', req, String(req.body?.id || ''), 'bad_signature');
      return res.status(403).json({ error: 'Неверная подпись Telegram — проверьте, что TG_BOT_TOKEN и логин-бот совпадают' });
    }
    if (result.banned) {
      recordAuthError('telegram', req, String(req.body?.id || ''), 'banned_user');
      return res.status(403).json({ error: 'Аккаунт заблокирован администратором' });
    }

    const authToken = issueUserJwt(result.user.id);
    res.json({ success: true, user: safeUser(result.user), token: authToken });
  } catch (e) {
    console.error('telegram POST auth error:', e);
    recordAuthError('telegram', req, String(req.body?.id || ''), 'exception');
    return res.status(500).json({ error: 'Не удалось завершить вход через Telegram' });
  }
});


// ================= AI GENERATE =================

function trimEnvStr(value) {
  return String(value ?? '').trim();
}

// ── Token rotation (Groq / OpenAI-compatible providers) ──
let GROQ_TOKENS = [];

function refreshGroqTokensFromEnv() {
  GROQ_TOKENS = [
    process.env.GROQ_API_KEY,
    process.env.GROQ_TOKEN_1,
    process.env.GROQ_TOKEN,
    process.env.GROQ_TOKEN_2,
    process.env.GROQ_TOKEN_3,
  ]
    .map(trimEnvStr)
    .filter(Boolean);
  GROQ_TOKENS = [...new Set(GROQ_TOKENS)];
}

refreshGroqTokensFromEnv();

/** Round-robin: с каждым запросом первым пробуем следующий ключ из пула. */
let groqKeyRoundRobinOffset = 0;

function groqKeysForRequest(keys) {
  const list = keys.length ? [...keys] : [];
  if (list.length <= 1) return list;
  const start = groqKeyRoundRobinOffset % list.length;
  groqKeyRoundRobinOffset += 1;
  return [...list.slice(start), ...list.slice(0, start)];
}

/**
 * Базовый URL OpenAI-compatible API с суффиксом /v1 (без финального слэша).
 * Примеры: https://api.groq.com/openai/v1 , http://127.0.0.1:11434/v1
 */
function normalizeOpenAiV1Base(baseRaw) {
  let b = trimEnvStr(baseRaw).replace(/\/+$/, '');
  if (!b) return '';
  if (!b.endsWith('/v1')) b = `${b}/v1`;
  return b;
}

function resolveAiProvider() {
  const explicit = trimEnvStr(process.env.AI_PROVIDER).toLowerCase();
  if (explicit === 'groq') return 'groq';
  if (explicit === 'ollama') return 'ollama';
  if (explicit === 'anthropic') return 'anthropic';
  if (trimEnvStr(process.env.ANTHROPIC_API_KEY)) return 'anthropic';
  if (GROQ_TOKENS.length > 0) return 'groq';
  const ollamaUrl = trimEnvStr(process.env.OLLAMA_URL).toLowerCase();
  if (ollamaUrl.includes('groq.com')) return 'groq';
  return 'ollama';
}

/** База Groq `.../openai/v1` для админ-проверок, даже если сейчас выбран Ollama. */
function getGroqProbeBaseUrl() {
  let base = trimEnvStr(process.env.GROQ_BASE_URL);
  if (!base) {
    const legacy = trimEnvStr(process.env.OLLAMA_URL);
    if (legacy.toLowerCase().includes('groq.com')) base = normalizeOpenAiV1Base(legacy);
  } else {
    base = normalizeOpenAiV1Base(base);
  }
  if (!base) base = 'https://api.groq.com/openai/v1';
  return base;
}

function getGroqProbeModel() {
  return (
    trimEnvStr(process.env.GROQ_MODEL) ||
    trimEnvStr(process.env.OLLAMA_MODEL) ||
    'llama-3.3-70b-versatile'
  );
}

function maskGroqKeyHint(tokenRaw) {
  const t = String(tokenRaw ?? '').trim();
  if (!t) return '';
  if (t.length <= 10) return '***';
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
}

function collectGroqRateHeaders(res) {
  const out = {};
  try {
    res.headers.forEach((value, key) => {
      if (/^x-ratelimit-/i.test(key) || /^retry-after$/i.test(key)) out[key.toLowerCase()] = value;
    });
  } catch {
    /**/
  }
  return out;
}

async function probeGroqKeyLimits(slotName, apiKey) {
  const base = getGroqProbeBaseUrl().replace(/\/+$/, '');
  const url = `${base}/models`;
  const token = String(apiKey ?? '').trim();
  if (!token) {
    return {
      slot: slotName,
      configured: false,
      keyHint: '',
      limits: {},
    };
  }
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 18000);
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: ac.signal,
    });
  } catch (err) {
    clearTimeout(to);
    return {
      slot: slotName,
      configured: true,
      keyHint: maskGroqKeyHint(token),
      httpStatus: null,
      ok: false,
      limits: {},
      networkError: err.name === 'AbortError' ? 'Таймаут запроса к Groq (~18 с)' : err.message,
    };
  }
  clearTimeout(to);
  const limits = collectGroqRateHeaders(res);
  const bodyText = await res.text().catch(() => '');
  let errorMessage = null;
  if (!res.ok) {
    try {
      const j = JSON.parse(bodyText);
      errorMessage = j?.error?.message || bodyText.slice(0, 500);
    } catch {
      errorMessage = bodyText.slice(0, 500) || res.statusText;
    }
  }
  return {
    slot: slotName,
    configured: true,
    keyHint: maskGroqKeyHint(token),
    httpStatus: res.status,
    ok: res.ok,
    limits,
    apiError: errorMessage,
    note:
      Object.keys(limits).length === 0 && res.ok
        ? 'Заголовков x-ratelimit-* нет в ответе /models — смотрите лимиты в консоли Groq или вкладке «Ответ провайдера» при ошибке 429.'
        : undefined,
  };
}

function getLlmChatConfig() {
  const provider = resolveAiProvider();
  if (provider === 'anthropic') {
    let base = trimEnvStr(process.env.ANTHROPIC_BASE_URL) || 'https://api.anthropic.com/v1';
    base = base.replace(/\/+$/, '');
    const model =
      trimEnvStr(process.env.ANTHROPIC_MODEL) || 'claude-sonnet-4-6';
    return { provider: 'anthropic', baseUrl: base, model, requireAuth: true };
  }
  if (provider === 'groq') {
    let base = trimEnvStr(process.env.GROQ_BASE_URL);
    if (!base) {
      const legacy = trimEnvStr(process.env.OLLAMA_URL);
      if (legacy.toLowerCase().includes('groq.com')) {
        base = normalizeOpenAiV1Base(legacy);
      }
    } else {
      base = normalizeOpenAiV1Base(base);
    }
    if (!base) base = 'https://api.groq.com/openai/v1';
    const model =
      trimEnvStr(process.env.GROQ_MODEL) ||
      trimEnvStr(process.env.OLLAMA_MODEL) ||
      'llama-3.3-70b-versatile';
    return { provider, baseUrl: base, model, requireAuth: true };
  }
  const base = normalizeOpenAiV1Base(trimEnvStr(process.env.OLLAMA_URL) || 'http://127.0.0.1:11434');
  const model = trimEnvStr(process.env.OLLAMA_MODEL) || 'qwen2.5:3b';
  return { provider: 'ollama', baseUrl: base, model, requireAuth: false };
}

function llmConfigHint() {
  const p = getLlmChatConfig().provider;
  if (p === 'anthropic') {
    return 'ANTHROPIC_API_KEY, ANTHROPIC_MODEL, ANTHROPIC_BASE_URL (при Groq: AI_PROVIDER=groq и GROQ_*; при Ollama: AI_PROVIDER=ollama и OLLAMA_*).';
  }
  if (p === 'groq') {
    return 'GROQ_API_KEY / GROQ_TOKEN, GROQ_BASE_URL, GROQ_MODEL (или OLLAMA_* для локального Ollama; для Anthropic: ANTHROPIC_API_KEY).';
  }
  return 'OLLAMA_URL, OLLAMA_MODEL (или GROQ_*, ANTHROPIC_API_KEY при смене AI_PROVIDER).';
}

function chatCompletionsUrl(baseUrlV1) {
  return `${baseUrlV1.replace(/\/+$/, '')}/chat/completions`;
}

const _initialLlm = getLlmChatConfig();
console.log(
  `[AI] provider=${_initialLlm.provider} model=${_initialLlm.model} url=${
    _initialLlm.provider === 'anthropic'
      ? `${_initialLlm.baseUrl}/messages`
      : chatCompletionsUrl(_initialLlm.baseUrl)
  } auth=${(() => {
    if (!_initialLlm.requireAuth) return 'none';
    if (_initialLlm.provider === 'anthropic') {
      return trimEnvStr(process.env.ANTHROPIC_API_KEY) ? 'anthropic_key' : 'MISSING_KEY';
    }
    return GROQ_TOKENS.length > 0 ? `bearer_keys:${GROQ_TOKENS.length}` : 'MISSING_KEY';
  })()}`,
);

function updateEnvFileValues(updates) {
  const envPath = path.resolve('.env');
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const lines = existing ? existing.split(/\r?\n/) : [];
  const idxByKey = new Map();
  lines.forEach((line, idx) => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) idxByKey.set(m[1], idx);
  });
  Object.entries(updates).forEach(([key, val]) => {
    const safeVal = String(val ?? '').replace(/\r?\n/g, '');
    const nextLine = `${key}=${safeVal}`;
    if (idxByKey.has(key)) lines[idxByKey.get(key)] = nextLine;
    else lines.push(nextLine);
  });
  fs.writeFileSync(envPath, lines.join('\n').replace(/\n+$/g, '\n'));
}

app.get('/api/admin/groq-tokens', (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  res.json({
    token1: process.env.GROQ_TOKEN || '',
    token2: process.env.GROQ_TOKEN_2 || '',
    token3: process.env.GROQ_TOKEN_3 || '',
  });
});

app.post('/api/admin/groq-tokens', (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  const { token1, token2, token3 } = req.body || {};
  updateEnvFileValues({
    GROQ_TOKEN: String(token1 || '').trim(),
    GROQ_TOKEN_2: String(token2 || '').trim(),
    GROQ_TOKEN_3: String(token3 || '').trim(),
  });
  process.env.GROQ_TOKEN = String(token1 || '').trim();
  process.env.GROQ_TOKEN_2 = String(token2 || '').trim();
  process.env.GROQ_TOKEN_3 = String(token3 || '').trim();
  refreshGroqTokensFromEnv();
  recordAdminAction(req, 'update_groq_tokens', null, { updated: true });
  res.json({ success: true, count: GROQ_TOKENS.length });
});

app.get('/api/admin/llm-model', (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  const cfg = getLlmChatConfig();
  const ak = trimEnvStr(process.env.ANTHROPIC_API_KEY);
  res.json({
    groqModel: trimEnvStr(process.env.GROQ_MODEL),
    ollamaModel: trimEnvStr(process.env.OLLAMA_MODEL),
    anthropicModel: trimEnvStr(process.env.ANTHROPIC_MODEL),
    aiProviderEnv: trimEnvStr(process.env.AI_PROVIDER),
    anthropicKeyHint: ak ? maskGroqKeyHint(ak) : '',
    anthropicKeyConfigured: Boolean(ak),
    resolvedProvider: resolveAiProvider(),
    effectiveModel: cfg.model,
  });
});

app.post('/api/admin/llm-model', (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  const { groqModel, ollamaModel, anthropicModel, anthropicApiKey } = req.body || {};
  const gm = trimEnvStr(groqModel);
  const om = trimEnvStr(ollamaModel);
  const am = trimEnvStr(anthropicModel);
  const apRaw = trimEnvStr(req.body?.aiProvider ?? req.body?.ai_provider).toLowerCase();
  let providerVal = '';
  if (!apRaw || apRaw === 'auto') providerVal = '';
  else if (apRaw === 'anthropic' || apRaw === 'groq' || apRaw === 'ollama') providerVal = apRaw;
  else {
    return res.status(400).json({
      error: 'AI_PROVIDER: допустимо пусто/auto, anthropic, groq или ollama',
    });
  }
  const newAnthropicKey = trimEnvStr(anthropicApiKey);

  const updates = {
    GROQ_MODEL: gm,
    OLLAMA_MODEL: om,
    ANTHROPIC_MODEL: am,
    AI_PROVIDER: providerVal,
  };
  if (newAnthropicKey) {
    updates.ANTHROPIC_API_KEY = newAnthropicKey;
  }
  updateEnvFileValues(updates);

  process.env.GROQ_MODEL = gm;
  process.env.OLLAMA_MODEL = om;
  process.env.ANTHROPIC_MODEL = am;
  process.env.AI_PROVIDER = providerVal;
  if (newAnthropicKey) process.env.ANTHROPIC_API_KEY = newAnthropicKey;

  const cfg = getLlmChatConfig();
  recordAdminAction(req, 'update_llm_model', null, {
    groqModel: gm || '(пусто)',
    ollamaModel: om || '(пусто)',
    anthropicModel: am || '(пусто)',
    aiProvider: providerVal || '(auto)',
    anthropicKeyRotated: Boolean(newAnthropicKey),
    effectiveModel: cfg.model,
    resolvedProvider: resolveAiProvider(),
  });
  res.json({
    success: true,
    effectiveModel: cfg.model,
    resolvedProvider: resolveAiProvider(),
  });
});

const GROQ_LIMIT_SLOT_ENVS = [
  'GROQ_API_KEY',
  'GROQ_TOKEN_1',
  'GROQ_TOKEN',
  'GROQ_TOKEN_2',
  'GROQ_TOKEN_3',
];

app.get('/api/admin/groq-limits', async (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  recordAdminAction(req, 'check_groq_limits', null, {});
  const slots = await Promise.all(
    GROQ_LIMIT_SLOT_ENVS.map((envName) => probeGroqKeyLimits(envName, process.env[envName])),
  );
  res.json({
    baseUrl: getGroqProbeBaseUrl(),
    probe: 'GET /v1/models',
    model: getGroqProbeModel(),
    docHint:
      'Заголовки x-ratelimit-* у Groq в основном показывают суточный лимит запросов (RPD) и токены в минуту (TPM). Суточный лимит токенов модели (TPD) часто указан только в тексте ошибки при HTTP 429 и в консоли Groq → Settings → Limits.',
    slots,
  });
});

function parseLlmErrorBody(bodyText) {
  if (!bodyText) return null;
  try {
    return JSON.parse(bodyText);
  } catch {
    return null;
  }
}

function openAiMessagesToAnthropicPayload(messages) {
  const systemParts = [];
  const tail = [];
  for (const m of messages) {
    const role = m.role;
    const content = typeof m.content === 'string' ? m.content : String(m.content ?? '');
    if (role === 'system') {
      systemParts.push(content);
    } else if (role === 'user' || role === 'assistant') {
      tail.push({ role, content });
    }
  }
  const merged = [];
  for (const m of tail) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) {
      last.content = `${last.content}\n\n${m.content}`;
    } else {
      merged.push({ role: m.role, content: m.content });
    }
  }
  if (merged.length && merged[0].role === 'assistant') {
    systemParts.push(
      'Контекст (ответ ассистента, заданный до первого сообщения пользователя):\n' + merged.shift().content,
    );
  }
  return {
    system: systemParts.length ? systemParts.join('\n\n') : undefined,
    messages: merged,
  };
}

function anthropicResponseToOpenAiShape(data) {
  const blocks = data?.content;
  let text = '';
  if (Array.isArray(blocks)) {
    for (const b of blocks) {
      if (b?.type === 'text' && typeof b.text === 'string') text += b.text;
    }
  }
  return {
    choices: [{ message: { content: text } }],
  };
}

/** Anthropic Messages API — тот же контракт ответа, что у OpenAI chat.completions (choices[0].message.content). */
async function callAnthropicMessages(messages, options = {}) {
  const maxTokens = Number(options.max_tokens) > 0 ? Number(options.max_tokens) : 2800;
  const temperature = typeof options.temperature === 'number' ? options.temperature : 0.25;
  const cfg = getLlmChatConfig();
  const apiKey = trimEnvStr(process.env.ANTHROPIC_API_KEY);
  if (!apiKey) {
    const e = new Error(
      'Нет ключа Anthropic: задайте ANTHROPIC_API_KEY в .env (без пробелов вокруг «=») и перезапустите backend.',
    );
    e.llmKind = 'API';
    e.httpStatus = 401;
    throw e;
  }
  const base = cfg.baseUrl.replace(/\/+$/, '');
  const url = `${base}/messages`;
  const payload = openAiMessagesToAnthropicPayload(messages);
  if (!payload.messages.length) {
    const e = new Error('Пустой диалог для Anthropic (нет сообщений user/assistant).');
    e.llmKind = 'API';
    throw e;
  }
  const body = {
    model: cfg.model,
    max_tokens: maxTokens,
    temperature,
    messages: payload.messages,
  };
  if (payload.system) body.system = payload.system;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const cause = err?.cause || err;
    const code = cause?.code;
    const e = new Error(
      code === 'ECONNREFUSED' || code === 'ENOTFOUND'
        ? `Сервис Anthropic недоступен (${url}). Проверьте сеть и ANTHROPIC_BASE_URL при прокси.`
        : `Ошибка сети при запросе к ИИ: ${err.message}`,
    );
    e.llmKind = 'NETWORK';
    throw e;
  }

  const bodyText = await res.text();

  if (res.status === 401 || res.status === 403) {
    const j = parseLlmErrorBody(bodyText);
    const apiBrief =
      j?.error?.message || j?.message || (bodyText && bodyText.slice(0, 300)) || res.statusText;
    const e = new Error(apiBrief || `HTTP ${res.status}`);
    e.llmKind = 'API';
    e.httpStatus = res.status;
    throw e;
  }

  if (res.status === 429) {
    const j = parseLlmErrorBody(bodyText);
    const raw =
      j?.error?.message ||
      j?.message ||
      'Лимит запросов к Anthropic. Подождите или проверьте план в консоли Anthropic.';
    const e = new Error(raw);
    e.llmKind = 'RATE_LIMIT';
    throw e;
  }

  if (!res.ok) {
    const j = parseLlmErrorBody(bodyText);
    const apiMsg =
      j?.error?.message || j?.message || (bodyText && bodyText.slice(0, 500)) || res.statusText;
    console.error('[AI] Anthropic HTTP', res.status, bodyText.slice(0, 800));
    const e = new Error(apiMsg || `HTTP ${res.status}`);
    e.llmKind = 'API';
    e.httpStatus = res.status;
    throw e;
  }

  let data;
  try {
    data = JSON.parse(bodyText);
  } catch {
    const e = new Error('Ответ ИИ не является JSON.');
    e.llmKind = 'BAD_RESPONSE';
    throw e;
  }
  if (data?.error) {
    const apiMsg = data.error?.message || JSON.stringify(data.error);
    const e = new Error(apiMsg);
    e.llmKind = 'API';
    throw e;
  }

  return anthropicResponseToOpenAiShape(data);
}

async function callGroq(messages, options = {}) {
  const _route = getLlmChatConfig();
  if (_route.provider === 'anthropic') {
    return callAnthropicMessages(messages, options);
  }
  const maxTokens = Number(options.max_tokens) > 0 ? Number(options.max_tokens) : 2800;
  const temperature = typeof options.temperature === 'number' ? options.temperature : 0.25;
  const cfg = getLlmChatConfig();
  const endpoint = chatCompletionsUrl(cfg.baseUrl);

  let tokenList;
  if (cfg.requireAuth) {
    if (GROQ_TOKENS.length === 0) {
      const e = new Error(
        'Нет ключа Groq в окружении: задайте GROQ_API_KEY, GROQ_TOKEN_1 или GROQ_TOKEN (и при ротации _2, _3). В .env без пробелов вокруг «=»; затем перезапустите backend.',
      );
      e.llmKind = 'API';
      e.httpStatus = 401;
      throw e;
    }
    tokenList = groqKeysForRequest(GROQ_TOKENS);
  } else {
    tokenList = [null];
  }

  for (let ti = 0; ti < tokenList.length; ti++) {
    const token = tokenList[ti];
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.requireAuth && token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: maxTokens,
          temperature,
          messages,
        }),
      });
    } catch (err) {
      if (cfg.requireAuth && tokenList.length > 1 && ti < tokenList.length - 1) {
        console.warn(
          `[AI] Ошибка сети для ключа ${ti + 1}/${tokenList.length}: ${err.message} — пробуем следующий.`,
        );
        continue;
      }
      const cause = err?.cause || err;
      const code = cause?.code;
      const e = new Error(
        code === 'ECONNREFUSED' || code === 'ENOTFOUND'
          ? `Сервис ИИ недоступен (${endpoint}). Groq: GROQ_BASE_URL=https://api.groq.com/openai/v1 и ключ GROQ_API_KEY. Локально: OLLAMA_URL и запущенная модель.`
          : `Ошибка сети при запросе к ИИ: ${err.message}`,
      );
      e.llmKind = 'NETWORK';
      throw e;
    }

    const bodyText = await res.text();

    if (res.status === 401 || res.status === 403) {
      const j = parseLlmErrorBody(bodyText);
      const apiBrief = j?.error?.message || (bodyText && bodyText.slice(0, 300)) || res.statusText;
      console.warn(
        `[AI] Groq ключ #${ti + 1}/${tokenList.length} отклонён (${res.status}): ${(apiBrief || '').slice(0, 200)}`,
      );
      if (ti < tokenList.length - 1) continue;
      const e = new Error(apiBrief || `HTTP ${res.status}`);
      e.llmKind = 'API';
      e.httpStatus = res.status;
      throw e;
    }

    if (res.status === 429) {
      console.warn(`[AI] Rate limit 429 (ключ ${ti + 1}/${tokenList.length})`);
      if (ti < tokenList.length - 1) continue;
      const j = parseLlmErrorBody(bodyText);
      const raw =
        j?.error?.message ||
        'Лимит запросов к ИИ. Подождите минуту или добавьте ещё ключей (GROQ_TOKEN_2, GROQ_TOKEN_3).';
      const isDailyTokens =
        /tokens per day|\bTPD\b|Rate limit reached.*model/i.test(String(raw));
      const msg = isDailyTokens
        ? `Дневной лимит токенов Groq исчерпан (бесплатный тариф). Подождите до сброса квоты, подключите платный тариф в консоли Groq, либо настройте локальный Ollama (OLLAMA_URL). Текст от сервиса: ${raw}`
        : raw;
      const e = new Error(msg);
      e.llmKind = 'RATE_LIMIT';
      throw e;
    }

    if (!res.ok) {
      const j = parseLlmErrorBody(bodyText);
      const apiMsg = j?.error?.message || (bodyText && bodyText.slice(0, 500)) || res.statusText;
      console.error('[AI] LLM HTTP', res.status, bodyText.slice(0, 800));
      const e = new Error(apiMsg || `HTTP ${res.status}`);
      e.llmKind = 'API';
      e.httpStatus = res.status;
      throw e;
    }

    let data;
    try {
      data = JSON.parse(bodyText);
    } catch {
      const e = new Error('Ответ ИИ не является JSON.');
      e.llmKind = 'BAD_RESPONSE';
      throw e;
    }
    if (data?.error) {
      const apiMsg = data.error?.message || JSON.stringify(data.error);
      console.error('[AI] LLM error payload:', apiMsg);
      const e = new Error(apiMsg);
      e.llmKind = 'API';
      throw e;
    }
    return data;
  }

  const e = new Error('Не удалось получить ответ от ИИ: исчерпан пул ключей или лимиты.');
  e.llmKind = 'RATE_LIMIT';
  throw e;
}

/** Выделяет текст .ccd из ответа ИИ (снимает обёртку \`\`\`ccd ... \`\`\`). */
function extractCicadaCodeFromLlm(raw) {
  const cleaned = stripThinkingFromAiRaw(String(raw ?? ''));
  const m = cleaned.match(/```(?:ccd|txt|dsl|text)?\s*([\s\S]*?)```/i);
  const code = m ? m[1].trim() : cleaned.trim();
  return repairCollapsedCicadaCode(code);
}

const PYTHON_CONVERT_MAX_CHARS = 200_000;

const PYTHON_TO_CICADA_SYSTEM = `Ты переводишь код Telegram-бота на Python 3 (библиотеки python-telegram-bot, aiogram, pyTelegramBotAPI, telebot и т.п.) в язык Cicada DSL (.ccd) для редактора Cicada Studio.

Правила вывода:
1) Верни ТОЛЬКО текст сценария .ccd на русском DSL. Никаких пояснений до или после.
2) Первая строка: версия "1.0" (рекомендуется). Вторая: бот "YOUR_BOT_TOKEN" — всегда этот плейсхолдер.
3) Соответствия Python → Cicada:
   - CommandHandler / команды /start, /help → при старте: или при команде "/help":
   - MessageHandler TEXT / эхо → иначе: или цепочка спросить; входящий текст: {текст}
   - ReplyKeyboardMarkup / KeyboardButton → кнопки "А" "Б" или форма с [ "Одна строка" ] и новая строка следующего ряда
   - callback_query / InlineKeyboardMarkup → при нажатии "Подпись кнопки" (как текст для пользователя)
   - ConversationHandler / FSM → сценарий имя: и шаги шаг имя: … ; между соседними шагами без ветвления НЕ нужен перейти — ядро переходит к следующему шагу само
4) Ответ пользователю: ответ "текст с {переменная}"
5) Вопрос: спросить "Вопрос?" → имя_переменной
6) Условия: если выражение: / иначе:
7) БД: сохранить "ключ" = значение ; получить "ключ" → переменная
8) Отправить файл по file_id из переменной: отправить файл имя_переменной (или выражение в фигурных скобках) — не путать с ответ "…{file_id}…", это только текст
9) стоп — только там, где нужно явно завершить цепочку; НИКОГДА не ставь стоп сразу после запустить сценарий в том же обработчике (/start, при нажатии и т.д.) — это ломает FSM ядра Cicada.

Сохраняй порядок и смысл обработчиков. Токен из Python не копируй — только YOUR_BOT_TOKEN.`;

// Статический разбор AI-AST: validateAstSchema (JSON-правила) + semanticValidate (переменные, get, режим).
// См. core/schemas/aiStacks.schema.json и core/validator/aiSemanticValidate.mjs.

const AI_SYSTEM_PROMPT = `Ты — генератор JSON-схем для визуального редактора Telegram-ботов Cicada Studio.
Верни ТОЛЬКО валидный JSON-массив стеков. Первый символ [, последний ]. Никакого текста до или после.

═══ БРЕНДИНГ ИИ ═══
Если в тексте сообщений бота нужно назвать ИИ, используй только название "Cicada 3301".
Никогда не используй названия моделей/вендоров вроде "Meta Llama 3", "Llama", "Qwen", "OpenAI", "Groq".

═══ СТРОГИЙ WHITELIST AST (поле blocks[].type) ═══
Выходной формат — JSON-массив стеков (AST редактора). Сервер компилирует JSON → Cicada DSL; не генерируй текст DSL сам.

Разрешены ТОЛЬКО следующие типы блоков:
  bot, start, callback, scenario, step, message, buttons, ask, remember, get, condition, else, run, stop, send_file

Соответствие инструкциям Cicada в DSL:
  бот→bot · при старте→start · при нажатии→callback · сценарий→scenario · шаг→step · ответ→message · кнопки→buttons · спросить→ask · запомнить→remember · получить→get · если→condition · иначе→else · запустить→run · стоп→stop · отправить файл→send_file

Запрещено придумывать типы вне списка (command, goto, inline, save, http, pause, document, photo, медиа-триггеры document_received и т.д.).
Если нужна другая возможность — только эквивалент из whitelist.

🔥 НЕ используй и не упоминай как блок: сохранить, save, store, append, insert (ни в type, ни в описании логики). В whitelist нет инструкции записи в KV через AI — её не генерировать.

═══ АЛГОРИТМ ПОСТРОЕНИЯ ГРАФА (выполни мысленно, затем выведи только JSON) ═══

Даже если пользователь написал коротко или расплывчато, всё равно построй полную схему стеков и переходов.

1) ИНТЕНТ — что делает бот, цель и точка входа: /start или первая reply-кнопка.
2) СОСТОЯНИЯ — логические узлы. Триггеры только start или callback; текст кнопки = callback.label.
3) ПЕРЕХОДЫ — из экрана с кнопками: отдельный стек callback или run(сценарий). Не оставляй обрывов.
4) УСЛОВИЯ — condition + else там, где нужна вилка.
5) ДАННЫЕ — любая {переменная} в message/condition объявлена выше ask/get/remember в том же стеке или это системная переменная. Блок get допустим только если сервер в режиме advanced и ключ get.key входит в разрешённый список (см. политику сервера в конце системного промпта). В safe-режиме get не используй — только remember и ask.
6) СБОРКА — s0 только bot; координаты/id по правилам ниже; после run в стеке с корнем start/callback нет stop.

Промежуточный план не печатай — только JSON.

═══ ТИПЫ БЛОКОВ (только whitelist) ═══

КОРНЕВЫЕ (первый блок стека):
  bot       {token:"YOUR_BOT_TOKEN"}   — только s0
  start     {}                           — при старте (/start)
  callback  {label:"Текст кнопки"}      — при нажатии reply-кнопки
  scenario  {name:"имя_сценария"}       — объявление FSM-сценария

ВНУТРИ СТЕКОВ:
  message    {text:"..."}                      — ответ пользователю; допускает {переменная}
  buttons    {rows:"A, B\\nновый ряд"}         — подписи через ЗАПЯТУЮ; новый ряд = \\n; не используй синтаксис inline |
  ask        {question:"...", varname:"имя"}  — ввод текста или file_id через Telegram
  remember   {varname:"x", value:"..."}       — положить значение в переменную (сессия диалога)
  get        {key:"ключ", varname:"результат"} — только в режиме advanced; key должен быть в списке сервера (см. конец промпта)
  condition  {cond:"..."}                     — если
  else       {}                               — иначе
  run        {name:"сценарий"}               — запустить сценарий из start/callback
  step       {name:"шаг"}                     — шаг внутри scenario
  stop       {}                               — конец цепочки (см. правила run+stop)
  send_file  {file:"{переменная}"}            — Telegram sendDocument по file_id (вложение). НЕ путать с message: текст с id — это не файл.

═══ DSL, КОТОРЫЙ СТРОИТ РЕДАКТОР ═══
Reply-ряд: кнопки "A" "B". В JSON: "rows":"A, B" (подписи через запятую и пробел при одном ряду).

═══ АРХИТЕКТУРА ═══

КНОПКИ + ОБРАБОТЧИКИ:
  s0: bot | s1: start→message→buttons→stop | s2: callback→message→stop | … или callback→run→(без stop)

СЦЕНАРИЙ, НЕСКОЛЬКО ВОПРОСОВ:
  start/callback → run(имя) БЕЗ stop | scenario(имя) → step → ask → step → ask → … → message/condition → stop
  После ask всегда дай пользователю следующее message или кнопки.

УСЛОВИЕ:
  … → condition(cond) → message → else → message → stop

═══ СТРОГИЕ ПРАВИЛА ═══

1. s0 — ТОЛЬКО bot.
2. id стеков s0,s1,… | id блоков b0,b1,… — уникальны глобально.
3. Координаты: x=40+(i*360), y=40; если стеков >5: y += 320 для i>=5.
4. Не ставь несколько ask подряд в start/callback. Для 2+ вопросов — scenario+step и run без stop после run.
5. ЗАПРЕЩЕНО: stop сразу после run в том же стеке с корнем start/callback.
6. В стеках без run в конце — последний блок stop.
7. Стек scenario завершается stop после финального действия.
8. callback.label совпадает с текстом в buttons.rows.
9. Русские имена переменных: имя, телефон, город.
10. В JSON bot.token = литерал YOUR_BOT_TOKEN.
11. В ключе get.key при подстановке chat_id используй только корректные скобки: "поле_{chat_id}", не опечатывай }.

═══ ПЕРЕМЕННЫЕ ═══

Объявление: ask (varname), get (varname), remember (varname).
Системные без объявления: chat_id, user_id, текст, сообщение_id, имя, фамилия, кнопка.

ЗАПРЕЩЕНО ссылаться на {переменная} в message/condition/send_file.props.file, если она не объявлена выше в этом стеке и не системная.

═══ ФАЙЛ ОТ ПОЛЬЗОВАТЕЛЯ (без медиа-триггеров) ═══

В whitelist нет document_received — принимай файл только через ask в сценарии: пользователь может прислать документ, бот кладёт Telegram file_id в переменную varname.
Пример приёма: step → ask("Пришлите файл", varname:"файл") → message("Принято. File ID: {файл}") → stop
Не используй {файл_id} — только имя из varname (например {файл}).

ВЫДАТЬ ФАЙЛ ОБРАТНО (хранилище, «скачать», по введённому File ID):
- После ask, где пользователь вставил или прислал идентификатор, в переменной лежит строка file_id.
- Обязателен блок send_file с тем же именем: {"type":"send_file","props":{"file":"{имя_переменной_из_ask}"}}
- Можно краткий message перед send_file (например «📥 Ваш файл:»), затем send_file — пользователь получит вложение-документ, а не текст с id.
- ЗАПРЕЩЕНО выдавать file_id только через message — это не отправит файл в Telegram.
`;

// Few-shot примеры — показывают правильные паттерны
const FEW_SHOT_USER = `бот принимает заказы: главное меню с 2 кнопками, при нажатии "Оформить заказ" спрашивает имя и телефон`;
const FEW_SHOT_ASSISTANT = `[{"id":"s0","x":40,"y":40,"blocks":[{"id":"b0","type":"bot","props":{"token":"YOUR_BOT_TOKEN"}}]},{"id":"s1","x":400,"y":40,"blocks":[{"id":"b1","type":"start","props":{}},{"id":"b2","type":"message","props":{"text":"Добро пожаловать! 🛒 Выберите действие:"}},{"id":"b3","type":"buttons","props":{"rows":"Оформить заказ, ℹ️ О нас"}},{"id":"b4","type":"stop","props":{}}]},{"id":"s2","x":760,"y":40,"blocks":[{"id":"b5","type":"callback","props":{"label":"Оформить заказ"}},{"id":"b6","type":"message","props":{"text":"Отлично! Заполним данные для заказа."}},{"id":"b7","type":"run","props":{"name":"оформление"}}]},{"id":"s3","x":1120,"y":40,"blocks":[{"id":"b9","type":"callback","props":{"label":"ℹ️ О нас"}},{"id":"b10","type":"message","props":{"text":"Мы — лучший магазин! 🌟"}},{"id":"b11","type":"stop","props":{}}]},{"id":"s4","x":400,"y":380,"blocks":[{"id":"b12","type":"scenario","props":{"name":"оформление"}},{"id":"b13","type":"step","props":{"name":"шаг_имя"}},{"id":"b14","type":"ask","props":{"question":"Введите ваше имя:","varname":"имя"}},{"id":"b16","type":"step","props":{"name":"шаг_телефон"}},{"id":"b17","type":"ask","props":{"question":"Введите ваш телефон:","varname":"телефон"}},{"id":"b18","type":"message","props":{"text":"✅ Заказ принят! Имя: {имя}, Телефон: {телефон}"}},{"id":"b19","type":"stop","props":{}}]}]`;

const FEW_SHOT_USER_2 = `бот с условием: спрашивает возраст, если >= 18 показывает контент для взрослых, иначе отказывает`;
const FEW_SHOT_ASSISTANT_2 = `[{"id":"s0","x":40,"y":40,"blocks":[{"id":"b0","type":"bot","props":{"token":"YOUR_BOT_TOKEN"}}]},{"id":"s1","x":400,"y":40,"blocks":[{"id":"b1","type":"start","props":{}},{"id":"b2","type":"message","props":{"text":"Привет! Нужно проверить ваш возраст."}},{"id":"b3","type":"run","props":{"name":"проверка_возраста"}}]},{"id":"s2","x":760,"y":40,"blocks":[{"id":"b5","type":"scenario","props":{"name":"проверка_возраста"}},{"id":"b6","type":"step","props":{"name":"ввод_возраста"}},{"id":"b7","type":"ask","props":{"question":"Сколько вам лет?","varname":"возраст"}},{"id":"b8","type":"condition","props":{"cond":"возраст >= 18"}},{"id":"b9","type":"message","props":{"text":"✅ Добро пожаловать! Контент доступен."}},{"id":"b10","type":"else","props":{}},{"id":"b11","type":"message","props":{"text":"❌ Доступ разрешён только с 18 лет."}},{"id":"b12","type":"stop","props":{}}]}]`;

const FEW_SHOT_USER_3 = `бот генерирует QR-код по тексту пользователя, с кнопкой "Создать ещё" и "Главная"`;
const FEW_SHOT_ASSISTANT_3 = `[{"id":"s0","x":40,"y":40,"blocks":[{"id":"b0","type":"bot","props":{"token":"YOUR_BOT_TOKEN"}}]},{"id":"s1","x":400,"y":40,"blocks":[{"id":"b1","type":"start","props":{}},{"id":"b2","type":"message","props":{"text":"Привет! 👋 Я создаю QR-коды для любого текста или ссылки."}},{"id":"b3","type":"buttons","props":{"rows":"📷 Создать QR-код"}},{"id":"b4","type":"stop","props":{}}]},{"id":"s2","x":760,"y":40,"blocks":[{"id":"b5","type":"callback","props":{"label":"📷 Создать QR-код"}},{"id":"b6","type":"run","props":{"name":"qr_сценарий"}}]},{"id":"s3","x":400,"y":380,"blocks":[{"id":"b8","type":"scenario","props":{"name":"qr_сценарий"}},{"id":"b9","type":"step","props":{"name":"ввод_текста"}},{"id":"b10","type":"ask","props":{"question":"Введите текст или ссылку для QR-кода:","varname":"qr_текст"}},{"id":"b11","type":"message","props":{"text":"📷 Ваш QR-код готов!\nhttps://api.qrserver.com/v1/create-qr-code/?size=300x300&data={qr_текст}"}},{"id":"b12","type":"buttons","props":{"rows":"🔄 Создать ещё, 🏠 Главная"}},{"id":"b13","type":"stop","props":{}}]},{"id":"s4","x":760,"y":380,"blocks":[{"id":"b14","type":"callback","props":{"label":"🔄 Создать ещё"}},{"id":"b15","type":"run","props":{"name":"qr_сценарий"}}]},{"id":"s5","x":1120,"y":380,"blocks":[{"id":"b17","type":"callback","props":{"label":"🏠 Главная"}},{"id":"b18","type":"message","props":{"text":"Главное меню 🏠"}},{"id":"b19","type":"buttons","props":{"rows":"📷 Создать QR-код"}},{"id":"b20","type":"stop","props":{}}]}]`;

const FEW_SHOT_USER_4 = `бот с авторизацией: при старте кнопка Авторизация, после нажатия спросить логин и пароль, если admin и 12345 — успех, иначе ошибка`;
const FEW_SHOT_ASSISTANT_4 = `[{"id":"s0","x":40,"y":40,"blocks":[{"id":"b0","type":"bot","props":{"token":"YOUR_BOT_TOKEN"}}]},{"id":"s1","x":400,"y":40,"blocks":[{"id":"b1","type":"start","props":{}},{"id":"b2","type":"message","props":{"text":"Добро пожаловать! Пожалуйста, авторизируйтесь."}},{"id":"b3","type":"buttons","props":{"rows":"Авторизация"}},{"id":"b4","type":"stop","props":{}}]},{"id":"s2","x":760,"y":40,"blocks":[{"id":"b5","type":"callback","props":{"label":"Авторизация"}},{"id":"b6","type":"run","props":{"name":"авторизация"}}]},{"id":"s3","x":1120,"y":40,"blocks":[{"id":"b7","type":"scenario","props":{"name":"авторизация"}},{"id":"b8","type":"step","props":{"name":"логин"}},{"id":"b9","type":"ask","props":{"question":"Введите ваш логин:","varname":"логин"}},{"id":"b10","type":"step","props":{"name":"пароль"}},{"id":"b11","type":"ask","props":{"question":"Введите ваш пароль:","varname":"пароль"}},{"id":"b12","type":"condition","props":{"cond":"логин == \"admin\" && пароль == \"12345\""}},{"id":"b13","type":"message","props":{"text":"Авторизация успешна! 🚀"}},{"id":"b14","type":"stop","props":{}},{"id":"b15","type":"else","props":{}},{"id":"b16","type":"message","props":{"text":"Неправильный логин или пароль. 😔"}},{"id":"b17","type":"stop","props":{}}]}]`;

const FEW_SHOT_USER_5 = `бот-хранилище файлов: меню «Загрузить» и «Получить»; загрузка через сценарий принимает файл и пишет в сообщении File ID; получение спрашивает File ID текстом и отправляет сам документ через send_file (не только текст с id)`;
const FEW_SHOT_ASSISTANT_5 = `[{"id":"s0","x":40,"y":40,"blocks":[{"id":"b0","type":"bot","props":{"token":"YOUR_BOT_TOKEN"}}]},{"id":"s1","x":400,"y":40,"blocks":[{"id":"b1","type":"start","props":{}},{"id":"b2","type":"message","props":{"text":"Привет! 📁 Принимаю файл и отдам по File ID."}},{"id":"b3","type":"buttons","props":{"rows":"📤 Загрузить, 📥 Получить"}},{"id":"b4","type":"stop","props":{}}]},{"id":"s2","x":760,"y":40,"blocks":[{"id":"b5","type":"callback","props":{"label":"📤 Загрузить"}},{"id":"b6","type":"run","props":{"name":"загрузка"}}]},{"id":"s3","x":1120,"y":40,"blocks":[{"id":"b7","type":"callback","props":{"label":"📥 Получить"}},{"id":"b8","type":"run","props":{"name":"выдача"}}]},{"id":"s4","x":40,"y":380,"blocks":[{"id":"b9","type":"scenario","props":{"name":"загрузка"}},{"id":"b10","type":"step","props":{"name":"ждём_файл"}},{"id":"b11","type":"ask","props":{"question":"Пришлите файл:","varname":"файл"}},{"id":"b12","type":"message","props":{"text":"✅ Сохранено. File ID:\\n{файл}"}},{"id":"b13","type":"buttons","props":{"rows":"📥 Получить, 🏠 Главная"}},{"id":"b14","type":"stop","props":{}}]},{"id":"s5","x":400,"y":380,"blocks":[{"id":"b15","type":"scenario","props":{"name":"выдача"}},{"id":"b16","type":"step","props":{"name":"запрос_id"}},{"id":"b17","type":"ask","props":{"question":"Введите File ID:","varname":"сохранённый_файл"}},{"id":"b18","type":"message","props":{"text":"📥 Ваш файл:"}},{"id":"b19","type":"send_file","props":{"file":"{сохранённый_файл}"}},{"id":"b20","type":"buttons","props":{"rows":"📤 Загрузить, 🏠 Главная"}},{"id":"b21","type":"stop","props":{}}]},{"id":"s6","x":760,"y":380,"blocks":[{"id":"b22","type":"callback","props":{"label":"🏠 Главная"}},{"id":"b23","type":"message","props":{"text":"Главное меню 🏠"}},{"id":"b24","type":"buttons","props":{"rows":"📤 Загрузить, 📥 Получить"}},{"id":"b25","type":"stop","props":{}}]}]`;

const FEW_SHOT_USER_6 = `бот по кнопке «Город» спрашивает название города, remember кладёт в переменную город_label строку «Город: {город}», затем message с {город_label}`;
const FEW_SHOT_ASSISTANT_6 = `[{"id":"s0","x":40,"y":40,"blocks":[{"id":"b0","type":"bot","props":{"token":"YOUR_BOT_TOKEN"}}]},{"id":"s1","x":400,"y":40,"blocks":[{"id":"b1","type":"start","props":{}},{"id":"b2","type":"message","props":{"text":"Выберите действие"}},{"id":"b3","type":"buttons","props":{"rows":"🌍 Указать город"}},{"id":"b4","type":"stop","props":{}}]},{"id":"s2","x":760,"y":40,"blocks":[{"id":"b5","type":"callback","props":{"label":"🌍 Указать город"}},{"id":"b6","type":"run","props":{"name":"город_fsm"}}]},{"id":"s3","x":1120,"y":40,"blocks":[{"id":"b7","type":"scenario","props":{"name":"город_fsm"}},{"id":"b8","type":"step","props":{"name":"ввод"}},{"id":"b9","type":"ask","props":{"question":"В каком вы городе?","varname":"город"}},{"id":"b10","type":"remember","props":{"varname":"город_label","value":"Город: {город}"}},{"id":"b11","type":"message","props":{"text":"Запомнил: {город_label}"}},{"id":"b12","type":"stop","props":{}}]}]`;

function serverAiAstPolicyAppendix(astMode, allowedMemoryKeys) {
  const lines = [
    '',
    '═══ ПОЛИТИКА СЕРВЕРА (обязательно; проверяется до компиляции) ═══',
  ];
  if (astMode === 'safe') {
    lines.push(
      'Режим SAFE: блок с type "get" ЗАПРЕЩЁН. KV-чтение недоступно. Используй ask + remember.',
    );
  } else {
    lines.push(
      'Режим ADVANCED: get разрешён только если строка props.key ТОЧНО совпадает с одним из литералов:',
    );
    lines.push(
      (allowedMemoryKeys || []).length
        ? allowedMemoryKeys.map((k) => JSON.stringify(String(k))).join(', ')
        : '(список пуст на сервере — get будет отклонён)',
    );
    lines.push('Любой другой get.key недопустим.');
  }
  return lines.join('\n');
}

function validateAiStacksForGenerate(stacks, astMode, allowedMemoryKeys) {
  return [...validateAstSchema(stacks), ...semanticValidate(stacks, { astMode, allowedMemoryKeys })];
}

function buildAstRepairUserPrompt(errors, stacksJsonSnippet) {
  return [
    'Предыдущий ответ НЕ прошёл проверку JSON Schema / семантики. Исправь ТОЛЬКО JSON-массив стеков.',
    '',
    'Ошибки:',
    ...errors.slice(0, 20).map((e, i) => `${i + 1}. ${e}`),
    '',
    'Текущий (неверный) AST для правки (сохрани id стеков/блоков где возможно):',
    stacksJsonSnippet,
    '',
    'Вернёшь один JSON-массив [...] без markdown и без текста до/после.',
  ].join('\n');
}

function buildNonJsonRepairPrompt() {
  return (
    'Ответ должен быть ОДНИМ JSON-массивом стеков: с символа [ до ]. Без ```, без пояснений. Повтори попытку.'
  );
}

const AI_GENERATE_PUBLIC_ERROR = 'Cicada AI перегружен попробуйте позже';


function findUnsupportedDslBlockComments(dsl) {
  return String(dsl || '')
    .split('\n')
    .map((line, idx) => ({ line: idx + 1, text: line.trim() }))
    .filter((row) => /^#\s*блок\s+/.test(row.text));
}

function sendAiGenerateError(res, authUser, status, adminMessage) {
  return res.status(status).json({
    error: authUser?.role === 'admin' ? adminMessage : AI_GENERATE_PUBLIC_ERROR,
  });
}

app.post('/api/ai-generate', requireUserAuth, async (req, res) => {
  const authUser = await findById(req.authUserId);
  if (!authUser) return res.status(401).json({ error: 'Необходима авторизация' });
  if (!isProUser(authUser)) {
    return res.status(403).json({
      error: 'AI-генерация доступна только с активной подпиской PRO.',
    });
  }

  const { prompt } = req.body;
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
    return res.status(400).json({ error: 'Опиши своего бота подробнее' });
  }
  try {
    const astMode = getAiAstMode();
    const allowedMemoryKeys = getAiAllowedMemoryKeys();
    const repairRounds = getAiAstRepairRounds();
    const maxAttempts = 1 + repairRounds;

    const systemContent = AI_SYSTEM_PROMPT + serverAiAstPolicyAppendix(astMode, allowedMemoryKeys);

    const initialMessages = [
      { role: 'system', content: systemContent },
      { role: 'user', content: FEW_SHOT_USER },
      { role: 'assistant', content: FEW_SHOT_ASSISTANT },
      { role: 'user', content: FEW_SHOT_USER_2 },
      { role: 'assistant', content: FEW_SHOT_ASSISTANT_2 },
      { role: 'user', content: FEW_SHOT_USER_3 },
      { role: 'assistant', content: FEW_SHOT_ASSISTANT_3 },
      { role: 'user', content: FEW_SHOT_USER_4 },
      { role: 'assistant', content: FEW_SHOT_ASSISTANT_4 },
      { role: 'user', content: FEW_SHOT_USER_5 },
      { role: 'assistant', content: FEW_SHOT_ASSISTANT_5 },
      { role: 'user', content: FEW_SHOT_USER_6 },
      { role: 'assistant', content: FEW_SHOT_ASSISTANT_6 },
      { role: 'user', content: prompt.trim() },
    ];

    const messages = [...initialMessages];
    let stacks = null;
    let lastRaw = '';
    let lastAstErrors = [];

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const data = await callGroq(messages, { max_tokens: 4000 });
      lastRaw = data.choices?.[0]?.message?.content || '';
      console.log(`[AI] attempt ${attempt + 1}/${maxAttempts}, raw (first 300):`, lastRaw.slice(0, 300));

      const extracted = extractAiGeneratedStacksFromRaw(lastRaw);
      if (!extracted) {
        if (attempt < maxAttempts - 1) {
          messages.push({ role: 'assistant', content: lastRaw.slice(0, 12000) });
          messages.push({ role: 'user', content: buildNonJsonRepairPrompt() });
          continue;
        }
        const cleaned = stripThinkingFromAiRaw(lastRaw);
        console.error('AI вернул не JSON-схему после очистки:', cleaned.slice(0, 400));
        return sendAiGenerateError(res, authUser, 422, 'AI не смог сгенерировать схему. Попробуй описать подробнее.');
      }

      let candidate = extracted.stacks;
      if (!Array.isArray(candidate) || candidate.length === 0) {
        lastAstErrors = ['Ожидался непустой JSON-массив стеков'];
        if (attempt < maxAttempts - 1) {
          messages.push({ role: 'assistant', content: lastRaw.slice(0, 12000) });
          messages.push({ role: 'user', content: buildAstRepairUserPrompt(lastAstErrors, '[]') });
          continue;
        }
        return sendAiGenerateError(res, authUser, 422, 'AI вернул пустую схему.');
      }

      stacks = normalizeAiGeneratedStacks(candidate);

      const badStack = stacks.find((s) => !s || !Array.isArray(s.blocks) || s.blocks.length === 0);
      if (badStack) {
        lastAstErrors = ['Есть стек без блоков (blocks пустой или отсутствует)'];
        if (attempt < maxAttempts - 1) {
          messages.push({ role: 'assistant', content: lastRaw.slice(0, 12000) });
          messages.push({
            role: 'user',
            content: buildAstRepairUserPrompt(lastAstErrors, JSON.stringify(stacks).slice(0, 14000)),
          });
          continue;
        }
        return sendAiGenerateError(res, authUser, 422, 'AI вернул неполную схему (есть пустой стек блоков).');
      }

      lastAstErrors = validateAiStacksForGenerate(stacks, astMode, allowedMemoryKeys);
      if (lastAstErrors.length > 0) {
        console.error('[AI] AST validation:', lastAstErrors.join(' | '));
        if (attempt < maxAttempts - 1) {
          messages.push({ role: 'assistant', content: lastRaw.slice(0, 12000) });
          messages.push({
            role: 'user',
            content: buildAstRepairUserPrompt(lastAstErrors, JSON.stringify(stacks).slice(0, 14000)),
          });
          continue;
        }
        return sendAiGenerateError(
          res,
          authUser,
          422,
          `Схема не прошла проверку после ${maxAttempts} попыток (JSON Schema / семантика). ` +
            lastAstErrors.slice(0, 8).join(' | '),
        );
      }

      break;
    }

    if (!stacks) {
      return sendAiGenerateError(res, authUser, 422, 'AI не вернул валидную схему.');
    }

    const dslFromStacks = generateDSL(stacks);
    const unsupportedDslComments = findUnsupportedDslBlockComments(dslFromStacks);
    if (unsupportedDslComments.length > 0) {
      const hint = unsupportedDslComments
        .slice(0, 5)
        .map((row) => `стр.${row.line}: ${row.text}`)
        .join(' | ');
      console.error('[AI] Unsupported DSL comments after generation:', hint);
      return sendAiGenerateError(
        res,
        authUser,
        422,
        `AI вернул блоки, которые генератор не смог превратить в рабочий DSL. ${hint}`,
      );
    }

    const schemaDiags = lintDSLSchema(dslFromStacks);
    const schemaErrs = schemaDiags.filter((d) => d.severity === 'error');
    if (schemaErrs.length > 0) {
      const hint = schemaErrs
        .slice(0, 5)
        .map((d) => formatDSLDiagnostic(d))
        .join(' ');
      console.error('[AI] DSL schema lint failed:', hint);
      return sendAiGenerateError(
        res,
        authUser,
        422,
        `Схема от AI не прошла проверку синтаксиса. Попробуй ещё раз или опиши задачу иначе. ${hint}`,
      );
    }

    // ── Обязательная проверка через Python-парсер Cicada ─────────────────
    // requireParsedDSL бросает исключение если парсер недоступен ИЛИ нашёл ошибки.
    // AI-ответ никогда не уходит клиенту без прохождения через парсер.
    try {
      requireParsedDSL(dslFromStacks);
    } catch (parserErr) {
      if (parserErr.parserUnavailable) {
        // Парсер не установлен / Python не найден — сервер настроен неправильно
        console.error('[AI] Cicada parser unavailable:', parserErr.message);
        return sendAiGenerateError(
          res,
          authUser,
          503,
          `Парсер Cicada недоступен на сервере. Проверьте установку Python и vendor/cicada-dsl-parser. ${parserErr.message}`,
        );
      }
      // Парсер отклонил DSL — просим AI попробовать ещё раз
      console.error('[AI] Cicada parser rejected DSL:', parserErr.message);
      return sendAiGenerateError(
        res,
        authUser,
        422,
        `Схема от AI не прошла парсер Cicada. Попробуй ещё раз. ${parserErr.message}`.trim(),
      );
    }

    // ── UI-валидатор конструктора ────────────────────────────────────────
    // Python-парсер отвечает только за грамматику. Перед отправкой схемы в
    // редактор прогоняем те же правила, что вкладка «Проверка ошибок» в UI.
    const uiValidation = validateUiDsl(dslFromStacks, stacks);
    const uiDiagnostics = [...uiValidation.errors, ...uiValidation.warnings];
    if (uiDiagnostics.length > 0) {
      const hint = uiDiagnostics.slice(0, 5).join(' ');
      console.error('[AI] UI validator rejected schema:', hint);
      return sendAiGenerateError(
        res,
        authUser,
        422,
        `Схема от AI не прошла UI-валидатор конструктора. Попробуй ещё раз. ${hint}`.trim(),
      );
    }

    res.json({ stacks });

  } catch (e) {
    const kind = e?.llmKind;
    if (kind === 'NETWORK') {
      console.error('POST /api/ai-generate', e.message);
      return sendAiGenerateError(res, authUser, 503, e.message);
    }
    if (kind === 'RATE_LIMIT') {
      console.error('POST /api/ai-generate', e.message);
      return sendAiGenerateError(res, authUser, 429, e.message);
    }
    if (kind === 'API' || kind === 'BAD_RESPONSE') {
      console.error('POST /api/ai-generate', e.message);
      return sendAiGenerateError(
        res,
        authUser,
        502,
        `Провайдер ИИ вернул ошибку. Проверьте ${llmConfigHint()} и лимиты. ` +
          (e.message?.length < 400 ? e.message : ''),
      );
    }
    console.error('POST /api/ai-generate', e);
    pushSystemError('POST /api/ai-generate', e instanceof Error ? e : new Error(String(e)));
    return sendAiGenerateError(
      res,
      authUser,
      500,
      'Внутренняя ошибка сервера. Попробуйте позже.',
    );
  }
});

/** Только role=admin: конвертация исходника Python-бота в текст .ccd через ИИ. */
app.post(
  '/api/convert-python-bot',
  requireUserAuth,
  requireAppAdmin,
  pythonBotConvertRateLimit,
  async (req, res) => {
    const python = typeof req.body?.python === 'string' ? req.body.python : '';
    if (python.trim().length < 20) {
      return res.status(400).json({ error: 'Вставьте код Python бота (минимум ~20 символов)' });
    }
    if (python.length > PYTHON_CONVERT_MAX_CHARS) {
      return res.status(400).json({ error: `Слишком длинный исходник (макс. ${PYTHON_CONVERT_MAX_CHARS} символов)` });
    }

    try {
      const data = await callGroq(
        [
          { role: 'system', content: PYTHON_TO_CICADA_SYSTEM },
          {
            role: 'user',
            content:
              'Переведи следующий Python-код Telegram-бота в один файл Cicada DSL (.ccd).\n\n---\n' + python + '\n---',
          },
        ],
        { max_tokens: 12000, temperature: 0.15 },
      );

      let raw = data.choices?.[0]?.message?.content || '';
      const code = extractCicadaCodeFromLlm(raw);
      if (!code || code.length < 15) {
        return res.status(422).json({ error: 'ИИ вернул пустой или слишком короткий DSL' });
      }

      const schemaDiags = lintDSLSchema(code).filter((d) => d.severity === 'error');
      const pyLint = lintCicadaWithPython({ code });

      recordUserAction(req.authUserId, 'python_to_cicada', {
        chars: python.length,
        outChars: code.length,
        schemaErrors: schemaDiags.length,
        pyOk: pyLint.ok,
      });

      return res.json({
        code,
        schemaErrors: schemaDiags.slice(0, 12).map((d) => formatDSLDiagnostic(d)),
        pythonLint: {
          ok: pyLint.ok,
          available: pyLint.available !== false,
          error: pyLint.error || null,
          diagnostics: (pyLint.diagnostics || []).slice(0, 15),
        },
      });
    } catch (e) {
      const kind = e?.llmKind;
      if (kind === 'NETWORK') {
        return sendAiGenerateError(res, authUser, 503, e.message);
      }
      if (kind === 'RATE_LIMIT') {
        return sendAiGenerateError(res, authUser, 429, e.message);
      }
      if (kind === 'API' || kind === 'BAD_RESPONSE') {
        return res.status(502).json({
          error:
            `Провайдер ИИ вернул ошибку. Проверьте ${llmConfigHint()} и лимиты. ` +
            (e.message?.length < 320 ? e.message : ''),
        });
      }
      return sendInternalApiError(res, 'POST /api/convert-python-bot', e, 'Ошибка конвертации', 500);
    }
  },
);

// ================= START =================

console.log('PORT =', API_PORT);

initDBWithRetry()
  .then(() => migrateUsersJson())
  .then(() => {
    app.listen(API_PORT, () => console.log('🚀 Server running on port', API_PORT));
  })
  .catch((err) => {
    console.error('❌ DB init failed:', err.message);
    if (err.code) console.error('   code:', err.code);
    if (err.detail) console.error('   detail:', err.detail);
    if (/could not write init file/i.test(String(err.message))) {
      console.error(
        '   Подсказка: PostgreSQL не может писать в каталог данных (часто полный диск, права на volume, малый /dev/shm в Docker). Проверьте df -h и логи postgres. Для полного сброса тома БД в Docker: npm run docker:nuke',
      );
    }
    process.exit(1);
  });
