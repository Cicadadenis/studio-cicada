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
import { sendVerificationEmail, sendPasswordResetEmail, sendEmailChangeCode } from './email.mjs';
import { startRunner, stopRunner, isRunnerActive, getRunnerStatus, listRunners, getRunnerLogs } from './services/dslRunner.mjs';
import { lintCicadaWithPython, requireParsedDSL, getDslHintsWithPython } from './services/pythonDslLint.mjs';
import { sendPreviewRequest } from './services/cicadaPreviewWorker.mjs';
import { runAiDslValidationPipeline } from './services/aiDslPipeline.mjs';
import { normalizeAdminTotpSecret, verifyTotp } from './services/adminTotp.mjs';
import { generateDSL } from './core/stacksToDsl.js';
import { lintDSLSchema, formatDSLDiagnostic } from './core/validator/schema.js';
import { repairCollapsedCicadaCode, stripThinkingFromAiRaw } from './core/validator/fixes.js';
import {
  canonicalIrToEditorStacks,
  extractAiCanonicalIrFromRaw,
  normalizeAiCanonicalIr,
  validateAiCanonicalIr,
} from './core/ai/aiCanonicalIr.mjs';
import { resolveFeatureDependencies } from './core/ai/featureDependencyResolver.mjs';
import { reconcileIrGraph } from './core/ai/graphReconciler.mjs';
import { buildIrSymbolRegistryPromptContext } from './core/ai/irSymbolRegistry.mjs';
import { formatIrDiagnostic, validateIrSemanticGate } from './core/ai/irSemanticGate.mjs';
import { repairIrDeterministic } from './core/ai/irRepairEngine.mjs';
import {
  hasExecutableIrHandlers,
  runDeterministicRecoveryPipeline,
} from './core/ai/irRecoveryTransforms.mjs';
import {
  applyIntentBudgetToIr,
  SEMANTIC_TEMPLATE_IDS,
  buildSemanticTemplateIr,
  buildIntentPlanPromptContext,
  intentPlanner,
} from './core/ai/intentPlanner.mjs';
import { repairIntentSatisfaction } from './core/ai/intentSatisfactionValidator.mjs';
import {
  AI_RECOVERY_INVALID_INPUT,
  IR_PRUNER_DEFAULTS,
  assertPrunedRecoveryIr,
  pruneIrForRecovery,
} from './core/ai/irPruner.mjs';
import {
  IR_FALLBACK_REASON,
  IR_FALLBACK_SKELETON_REASON_CODE,
  IR_SKELETON_STATE,
  buildIrSkeletonFallback,
} from './core/ai/irSkeletonFactory.mjs';
import { isPlaceholderBotToken } from './core/botTokenPlaceholders.mjs';

const { Pool } = pg;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

function isProductionEnv() {
  return (process.env.APP_ENV || process.env.NODE_ENV || '').trim() === 'production';
}

function cspNonce(req, res) {
  return `'nonce-${res.locals.cspNonce}'`;
}

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
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'none'; script-src 'none'; sandbox");
  },
}));

app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'", cspNonce, 'https://telegram.org'],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'"],
        frameSrc: ["'self'", 'https://oauth.telegram.org', 'https://telegram.org'],
        frameAncestors: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: isProductionEnv() ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }),
);

function corsAllowedOrigins() {
  if (CORS_ORIGINS.length > 0) return CORS_ORIGINS;
  const isProduction = isProductionEnv();
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
const jsonParser = express.json({ limit: '1mb' });
const avatarJsonParser = express.json({ limit: process.env.AVATAR_JSON_LIMIT || '7mb' });
const previewJsonParser = express.json({ limit: process.env.PREVIEW_JSON_LIMIT || '16mb' });
const supportJsonParser = express.json({ limit: process.env.SUPPORT_JSON_LIMIT || '8mb' });
const LARGE_JSON_ROUTE_PATHS = new Set(['/api/avatar', '/api/bot/preview']);

app.use((req, res, next) => {
  if (
    req.method === 'POST' &&
    (req.path === '/api/support/requests' || /^\/api\/support\/requests\/[^/]+\/messages$/.test(req.path))
  ) return next();
  if (LARGE_JSON_ROUTE_PATHS.has(req.path)) return next();
  return jsonParser(req, res, next);
});
app.use(cookieParser());
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    recordSecurityEvent('json_body_rejected', req, { reason: 'too_large', limit: LARGE_JSON_ROUTE_PATHS.has(req.path) ? 'upload' : '1mb' });
    return res.status(413).json({ error: 'Слишком большой запрос' });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    recordSecurityEvent('json_body_rejected', req, { reason: 'invalid_json' });
    return res.status(400).json({ error: 'Некорректный JSON' });
  }
  return next(err);
});
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
app.all(/^\/(?:satana|debug)(?:\/|\.|$)/, requireAdminPage, (req, res) => {
  res.redirect(302, '/admin');
});

app.all(/^\/admin(?:.*)?$/, requireAdminPage, (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).send('Method Not Allowed');
  res.sendFile(path.resolve('dist/index.html'));
});

app.use(express.static('dist'));

const BOTS_DIR = 'bots';
const recentSystemErrors = [];
const recentApiErrors = [];
const recentAuthErrors = [];
const recentSecurityEvents = [];
const recentAdminActions = [];
const recentUserActions = [];
const userLoginHistory = new Map(); // userId -> [{ at, ip, method }]
const recentSubscriptions = [];
const googleAuthStates = new Map(); // state -> { exp }
const oauthLoginHandoffs = new Map(); // code -> { userId, exp }
const authFailureBuckets = new Map(); // key -> timestamps

if (!fs.existsSync(BOTS_DIR)) {
  fs.mkdirSync(BOTS_DIR, { recursive: true });
}

function isSecureRequest(req) {
  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return Boolean(req?.secure || forwardedProto === 'https');
}

function strictCookieOptions(req, options = {}) {
  return {
    sameSite: 'strict',
    secure: isSecureRequest(req),
    path: '/',
    ...options,
  };
}

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

function redactSecrets(value) {
  return String(value || '')
    .replace(/\b\d{6,12}:[A-Za-z0-9_-]{25,}\b/g, '[redacted:bot-token]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 [redacted]')
    .replace(/\b(token|secret|api[_-]?key|password|passwd|authorization|client_secret)\b(\s*[:=]\s*)(["']?)[^\s"',;]+/gi, '$1$2$3[redacted]')
    .replace(/(бот\s+["'])[^"'\r\n]{8,}(["'])/giu, '$1[redacted]$2');
}

function recordApiError(req, statusCode, message) {
  if (!req?.path?.startsWith('/api/')) return;
  pushRing(recentApiErrors, {
    at: new Date().toISOString(),
    path: req.path,
    method: req.method,
    statusCode,
    message: String(message || ''),
    userId: req.authUserId || null,
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
  recordBruteForceSignal(type, req, identifier);
}

function recordSecurityEvent(type, req, details = {}) {
  pushRing(recentSecurityEvents, {
    at: new Date().toISOString(),
    type,
    path: req?.path || null,
    method: req?.method || null,
    ip: req?.ip || null,
    userId: req?.authUserId || null,
    details,
  }, 500);
}

function recordBruteForceSignal(type, req, identifier) {
  const now = Date.now();
  const key = `${type}|${String(identifier || '').toLowerCase()}|${rlIpSegment(req)}`;
  const windowMs = 15 * 60 * 1000;
  const curr = (authFailureBuckets.get(key) || []).filter((ts) => now - ts <= windowMs);
  curr.push(now);
  authFailureBuckets.set(key, curr);
  if (curr.length === 5 || curr.length === 10) {
    recordSecurityEvent('brute_force_suspected', req, {
      type,
      identifier: identifier || null,
      attempts: curr.length,
      windowSec: Math.floor(windowMs / 1000),
    });
  }
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

function rl429(req, res) {
  recordSecurityEvent('rate_limit_exceeded', req, { route: req?.route?.path || req?.path || null });
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

const uploadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `upload_${req.authUserId || rlIpSegment(req)}`,
  handler: rl429,
});

const dslLintRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `dsl_lint_${req.authUserId || rlIpSegment(req)}`,
  handler: rl429,
});

const botRunRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `bot_run_${req.authUserId || String(req.body?.userId || '') || rlIpSegment(req)}`,
  handler: rl429,
});

const aiGenerateRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `ai_generate_${req.authUserId || rlIpSegment(req)}`,
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

/** Скачивание дампа БД / исходников — только JWT role=admin, лимит по IP. */
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
const _isProd = isProductionEnv();

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
const USER_SESSION_COOKIE = 'user_session';
const OAUTH_JWT_HANDOFF_COOKIE = 'oauth_jwt_handoff';
const OAUTH_2FA_PENDING_COOKIE = 'oauth_2fa_pending';
const ADMIN_ROUTE_COOKIE = 'admin_route_session';

const ADMIN_JWT_EXPIRES_SEC = Number(process.env.ADMIN_JWT_EXPIRES_SEC || 8 * 60 * 60);
const ADMIN_ROUTE_EXPIRES_SEC = Number(process.env.ADMIN_ROUTE_EXPIRES_SEC || 20 * 60);

function issueUserJwt(userId) {
  return jwt.sign({ sub: userId, type: 'user' }, JWT_SECRET, { expiresIn: JWT_EXPIRES_SEC });
}

function issueUserSessionCookie(req, res, userId) {
  const jwtToken = issueUserJwt(userId);
  res.cookie(USER_SESSION_COOKIE, jwtToken, strictCookieOptions(req, {
    httpOnly: true,
    maxAge: JWT_EXPIRES_SEC * 1000,
  }));
  return jwtToken;
}

function issueOauthJwtHandoffCookie(res, userId) {
  const code = crypto.randomBytes(32).toString('base64url');
  oauthLoginHandoffs.set(code, {
    userId: String(userId),
    type: 'login',
    exp: Date.now() + 3 * 60 * 1000,
  });
  return code;
}

function issueOauth2faHandoffCode(userId) {
  const code = crypto.randomBytes(32).toString('base64url');
  oauthLoginHandoffs.set(code, {
    userId: String(userId),
    type: 'oauth_2fa_pending',
    exp: Date.now() + 3 * 60 * 1000,
  });
  return code;
}

function buildOauthRedirectUrl(code) {
  const target = new URL(APP_URL || '/');
  target.searchParams.set('oauth_login', code);
  return target.toString();
}

function clearUserSessionCookies(req, res) {
  const opts = strictCookieOptions(req, { httpOnly: true });
  res.clearCookie(USER_SESSION_COOKIE, opts);
  res.clearCookie(OAUTH_JWT_HANDOFF_COOKIE, opts);
}

function issueAdminSessionCookie(req, res) {
  const token = jwt.sign({ type: 'admin' }, JWT_SECRET, { expiresIn: ADMIN_JWT_EXPIRES_SEC });
  res.cookie('admin_session', token, strictCookieOptions(req, {
    httpOnly: true,
    maxAge: ADMIN_JWT_EXPIRES_SEC * 1000,
  }));
}

function issueAdminRouteCookie(req, res, userId) {
  const token = jwt.sign({ sub: String(userId), type: 'admin_route' }, JWT_SECRET, {
    expiresIn: ADMIN_ROUTE_EXPIRES_SEC,
  });
  res.cookie(ADMIN_ROUTE_COOKIE, token, strictCookieOptions(req, {
    httpOnly: true,
    maxAge: ADMIN_ROUTE_EXPIRES_SEC * 1000,
  }));
}

function getJwtUserId(req) {
  try {
    const token = String(req.cookies?.[USER_SESSION_COOKIE] || '').trim();
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
    if (!user || user.role !== 'admin' || user.banned) {
      return res.status(403).json({ error: 'Доступ только для администратора' });
    }
    req.appAdminUser = user;
    return next();
  } catch (err) {
    return sendInternalApiError(res, 'requireAppAdmin', err, 'Не удалось проверить права.', 500);
  }
}

async function requireAdminApi(req, res, next) {
  const jwtUserId = getJwtUserId(req);
  if (!jwtUserId) return res.status(403).json({ error: 'Forbidden' });
  req.authUserId = jwtUserId;
  return requireAppAdmin(req, res, next);
}

async function requireAdminPage(req, res, next) {
  const token = req.cookies?.[ADMIN_ROUTE_COOKIE];
  if (!token) return res.status(403).send('Forbidden');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded || decoded.type !== 'admin_route' || !decoded.sub) {
      return res.status(403).send('Forbidden');
    }
    const user = await findById(String(decoded.sub));
    if (!user || user.role !== 'admin' || user.banned) {
      return res.status(403).send('Forbidden');
    }
    req.authUserId = user.id;
    req.appAdminUser = user;
    return next();
  } catch {
    return res.status(403).send('Forbidden');
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

const CHILD_PROCESS_ALLOWLIST = new Set(['git', 'npm', 'pm2', 'gzip', 'tar', 'pg_dump']);

function assertSafeChildProcessArgs(command, args) {
  if (!CHILD_PROCESS_ALLOWLIST.has(command)) {
    throw new Error(`Command is not allowlisted: ${command}`);
  }
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) {
    throw new Error('Child process args must be a string array');
  }
  for (const arg of args) {
    if (arg.includes('\0')) throw new Error('Child process argument contains NUL byte');
  }
}

function safeSpawnSync(command, args = [], options = {}) {
  assertSafeChildProcessArgs(command, args);
  return spawnSync(command, args, {
    shell: false,
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
}

setInterval(() => {
  const now = Date.now();
  for (const [state, meta] of googleAuthStates.entries()) {
    if (!meta || meta.exp <= now) googleAuthStates.delete(state);
  }
  for (const [code, meta] of oauthLoginHandoffs.entries()) {
    if (!meta || meta.exp <= now) oauthLoginHandoffs.delete(code);
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
      messages   JSONB NOT NULL DEFAULT '[]'::jsonb,
      user_seen_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS messages JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await pool.query(`ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS user_seen_at TIMESTAMPTZ`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_support_requests_created_at ON support_requests(created_at DESC)`);

  // ── Paid subscriptions / CryptoBot invoices ────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscription_invoices (
      invoice_id   TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan         TEXT NOT NULL,
      asset        TEXT,
      amount       TEXT,
      status       TEXT NOT NULL DEFAULT 'created',
      paid_at      TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_subscription_invoices_user_id ON subscription_invoices(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_subscription_invoices_status ON subscription_invoices(status, processed_at)`);

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

function setCsrfCookie(req, res, token) {
  res.cookie(CSRF_COOKIE_NAME, token, strictCookieOptions(req, {
    httpOnly: false,
    maxAge: 12 * 60 * 60 * 1000,
  }));
}

app.get('/api/csrf-token', (req, res) => {
  let t = req.cookies?.[CSRF_COOKIE_NAME];
  if (!t || typeof t !== 'string' || t.length < 48) {
    t = crypto.randomBytes(32).toString('hex');
  }
  setCsrfCookie(req, res, t);
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

function verifyEmailPage({ success, title, message, emoji, nonce = '' }) {
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
  <script nonce="${nonce}">
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
    nonce: res.locals.cspNonce,
  }));

  if (Date.now() > user.verifyTokenExp) return res.send(verifyEmailPage({
    success: false, emoji: '⏰',
    title: 'Ссылка устарела',
    message: 'Срок действия ссылки истёк (24 часа).<br/>Пожалуйста, зарегистрируйтесь снова.',
    nonce: res.locals.cspNonce,
  }));

  await pool.query(
    'UPDATE users SET verified = TRUE, verify_token = NULL, verify_token_exp = NULL WHERE id = $1',
    [user.id]
  );

  return res.send(verifyEmailPage({
    success: true, emoji: '✅',
    title: 'Email подтверждён!',
    message: 'Ваш аккаунт активирован.<br/>Теперь вы можете войти в Cicada Studio.',
    nonce: res.locals.cspNonce,
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

  issueUserSessionCookie(req, res, user.id);
  recordUserLogin(user.id, req.ip, 'password');
  recordUserAction(user.id, 'login_success', { method: 'password' });
  res.json({ success: true, user: safeUser(user) });
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
    issueUserSessionCookie(req, res, user.id);
    recordUserLogin(user.id, req.ip, 'passkey');
    recordUserAction(user.id, 'login_success', { method: 'passkey' });
    res.json({ success: true, user: safeUser(user) });
  } catch (err) {
    recordAuthError('user_passkey_login', req, null, err.message);
    res.status(400).json({ error: err.message || 'Не удалось войти по passkey' });
  }
});
app.post('/api/logout', (req, res) => {
  clearUserSessionCookies(req, res);
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

function isLocalAvatarUrl(photoUrl) {
  return Boolean(avatarFilePathFromUrl(photoUrl));
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


app.post('/api/avatar', avatarJsonParser, requireUserAuth, uploadRateLimit, async (req, res) => {
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
app.post('/api/dsl/lint', dslLintRateLimit, (req, res) => {
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
/** Лимит одного файла в превью (base64 приходит в JSON) */
const PREVIEW_MAX_FILE_BYTES = Number(process.env.PREVIEW_MAX_FILE_BYTES || 12 * 1024 * 1024);
const SAFE_PREVIEW_SESSION = /^[a-zA-Z0-9._:-]{8,128}$/;
const SAFE_CHAT_ID = /^\d{1,16}$/;
const PREVIEW_DOCUMENT_EXT_WHITELIST = new Set(['pdf', 'txt', 'json', 'csv', 'zip']);
const PREVIEW_IMAGE_EXT_WHITELIST = new Set(['jpg', 'jpeg', 'png', 'webp']);
const BLOCKED_UPLOAD_EXTENSIONS = new Set(['svg', 'html', 'htm', 'xhtml']);
const BLOCKED_UPLOAD_MIME = new Set(['image/svg+xml', 'text/html', 'application/xhtml+xml']);

function fileExtFromName(fileName) {
  const ext = path.extname(String(fileName || '')).replace(/^\./, '').toLowerCase();
  return /^[a-z0-9]{1,12}$/.test(ext) ? ext : '';
}

function detectUploadKind(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: 'jpg', mimeType: 'image/jpeg', kind: 'image' };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mimeType: 'image/png', kind: 'image' };
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return { ext: 'webp', mimeType: 'image/webp', kind: 'image' };
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') return { ext: 'pdf', mimeType: 'application/pdf', kind: 'document' };
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return { ext: 'zip', mimeType: 'application/zip', kind: 'document' };
  return null;
}

function looksLikeTextUpload(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  if (sample.includes(0)) return false;
  return sample.every((b) => b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e) || b >= 0xc2);
}

function rejectDangerousUpload({ buffer, ext, mimeType }) {
  const normalizedExt = String(ext || '').toLowerCase();
  const normalizedMime = String(mimeType || '').toLowerCase();
  const sniff = buffer.subarray(0, Math.min(buffer.length, 512)).toString('utf8').trimStart().toLowerCase();
  if (BLOCKED_UPLOAD_EXTENSIONS.has(normalizedExt) || BLOCKED_UPLOAD_MIME.has(normalizedMime)) {
    throw new Error('SVG и HTML файлы запрещены');
  }
  if (sniff.startsWith('<svg') || sniff.startsWith('<!doctype html') || sniff.startsWith('<html') || sniff.includes('<script')) {
    throw new Error('Файл похож на SVG/HTML и отклонён');
  }
}

function validatePreviewUpload({ buffer, fileName, mimeType, imageOnly = false }) {
  const originalExt = fileExtFromName(fileName);
  const normalizedMime = String(mimeType || 'application/octet-stream').trim().toLowerCase();
  rejectDangerousUpload({ buffer, ext: originalExt, mimeType: normalizedMime });
  const detected = detectUploadKind(buffer);

  if (imageOnly) {
    if (!detected || detected.kind !== 'image' || !PREVIEW_IMAGE_EXT_WHITELIST.has(detected.ext)) {
      throw new Error('photo поддерживает только JPG, PNG или WebP');
    }
    return {
      safeFileName: `preview-${crypto.randomUUID()}.${detected.ext}`,
      mimeType: detected.mimeType,
      ext: detected.ext,
    };
  }

  if (detected) {
    const allowed = detected.kind === 'image'
      ? PREVIEW_IMAGE_EXT_WHITELIST.has(detected.ext)
      : PREVIEW_DOCUMENT_EXT_WHITELIST.has(detected.ext);
    if (!allowed) throw new Error('Тип файла не разрешён');
    if (originalExt && originalExt !== detected.ext && !(detected.ext === 'jpg' && originalExt === 'jpeg')) {
      throw new Error('Расширение файла не совпадает с содержимым');
    }
    return {
      safeFileName: `preview-${crypto.randomUUID()}.${detected.ext}`,
      mimeType: detected.mimeType,
      ext: detected.ext,
    };
  }

  if (looksLikeTextUpload(buffer) && ['txt', 'json', 'csv'].includes(originalExt)) {
    return {
      safeFileName: `preview-${crypto.randomUUID()}.${originalExt}`,
      mimeType: originalExt === 'json' ? 'application/json' : (originalExt === 'csv' ? 'text/csv' : 'text/plain'),
      ext: originalExt,
    };
  }
  throw new Error('Формат файла не разрешён или не распознан по magic bytes');
}

/** Симуляция Telegram один шаг за запрос (состояние сценария хранится в сессии на стороне воркера). */
app.post('/api/bot/preview', previewJsonParser, botPreviewRateLimit, async (req, res) => {
  try {
    const sessionId = req.body?.sessionId;
    const code = req.body?.code;
    const text = req.body?.text;
    const callbackData = req.body?.callbackData;
    const chatIdRaw = req.body?.chatId;
    const captionRaw = req.body?.caption;

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
    if (captionRaw != null && typeof captionRaw !== 'string') {
      return res.status(400).json({ error: 'caption должна быть строкой' });
    }

    let documentPayload = null;
    let photoPayload = null;
    const rawDoc = req.body?.document;
    const rawPhoto = req.body?.photo;
    if (rawDoc != null && rawPhoto != null) {
      return res.status(400).json({ error: 'Одновременно document и photo не поддерживаются' });
    }
    if (rawDoc != null) {
      if (typeof rawDoc !== 'object' || Array.isArray(rawDoc)) {
        return res.status(400).json({ error: 'document должен быть объектом' });
      }
      const fileName = typeof rawDoc.fileName === 'string' && rawDoc.fileName.trim()
        ? rawDoc.fileName.trim().slice(0, 512)
        : 'file.bin';
      const mimeType =
        typeof rawDoc.mimeType === 'string' && rawDoc.mimeType.trim()
          ? rawDoc.mimeType.trim().slice(0, 256)
          : 'application/octet-stream';
      const b64 = typeof rawDoc.data === 'string' ? rawDoc.data.trim() : '';
      if (!b64) {
        return res.status(400).json({ error: 'document.data обязателен (base64)' });
      }
      let buf;
      try {
        buf = Buffer.from(b64, 'base64');
      } catch {
        return res.status(400).json({ error: 'Некорректный base64 в document.data' });
      }
      if (!buf.length) {
        return res.status(400).json({ error: 'Пустой файл' });
      }
      if (buf.length > PREVIEW_MAX_FILE_BYTES) {
        return res.status(400).json({
          error: `Файл слишком большой для превью (>${PREVIEW_MAX_FILE_BYTES} байт)`,
        });
      }
      let safeUpload;
      try {
        safeUpload = validatePreviewUpload({ buffer: buf, fileName, mimeType });
      } catch (err) {
        recordSecurityEvent('upload_rejected', req, { reason: err.message, fileName, mimeType });
        return res.status(400).json({ error: err.message });
      }
      const fileId = `pv_${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 40)}`;
      documentPayload = {
        fileName: safeUpload.safeFileName,
        mimeType: safeUpload.mimeType,
        fileId,
        fileSize: buf.length,
      };
    } else if (rawPhoto != null) {
      if (typeof rawPhoto !== 'object' || Array.isArray(rawPhoto)) {
        return res.status(400).json({ error: 'photo должен быть объектом' });
      }
      const mimeType =
        typeof rawPhoto.mimeType === 'string' && rawPhoto.mimeType.trim()
          ? rawPhoto.mimeType.trim().slice(0, 256)
          : 'image/jpeg';
      if (!mimeType.startsWith('image/')) {
        return res.status(400).json({ error: 'photo.mimeType должен быть image/*' });
      }
      const b64 = typeof rawPhoto.data === 'string' ? rawPhoto.data.trim() : '';
      if (!b64) {
        return res.status(400).json({ error: 'photo.data обязателен (base64)' });
      }
      let buf;
      try {
        buf = Buffer.from(b64, 'base64');
      } catch {
        return res.status(400).json({ error: 'Некорректный base64 в photo.data' });
      }
      if (!buf.length) {
        return res.status(400).json({ error: 'Пустой файл' });
      }
      if (buf.length > PREVIEW_MAX_FILE_BYTES) {
        return res.status(400).json({
          error: `Файл слишком большой для превью (>${PREVIEW_MAX_FILE_BYTES} байт)`,
        });
      }
      let safeUpload;
      try {
        safeUpload = validatePreviewUpload({ buffer: buf, fileName: 'photo.jpg', mimeType, imageOnly: true });
      } catch (err) {
        recordSecurityEvent('upload_rejected', req, { reason: err.message, fileName: 'photo', mimeType });
        return res.status(400).json({ error: err.message });
      }
      const fileId = `pvimg_${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 40)}`;
      photoPayload = { mimeType: safeUpload.mimeType, fileId, fileSize: buf.length };
    }

    let chatId = '990000001';
    if (chatIdRaw != null && String(chatIdRaw).trim() !== '') {
      const s = String(chatIdRaw).trim();
      if (!SAFE_CHAT_ID.test(s)) {
        return res.status(400).json({ error: 'Некорректный chatId' });
      }
      chatId = s;
    }

    const cap =
      captionRaw != null && String(captionRaw).length > 0 ? String(captionRaw) : '';

    const out = await sendPreviewRequest({
      sessionId,
      code,
      chatId,
      text: text != null ? text : '',
      callbackData:
        callbackData != null && String(callbackData).length > 0 ? String(callbackData) : null,
      caption: cap,
      document: documentPayload,
      photo: photoPayload,
    });

    return res.json(out);
  } catch (e) {
    return sendInternalApiError(res, 'POST /api/bot/preview', e, 'Не удалось выполнить превью', 500);
  }
});

app.post('/api/run', requireUserAuth, botRunRateLimit, async (req, res) => {
  try {
    const { code } = req.body;
    const requestedUserId = String(req.body?.userId || '');
    if (!requestedUserId) return res.json({ error: 'no userId' });
    if (req.authUserId !== requestedUserId) return res.status(403).json({ error: 'Forbidden' });
    const userId = req.authUserId;
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
        if (event === 'sandbox_fallback') {
          recordSecurityEvent('dsl_sandbox_fallback', req, { userId: data.userId, message: data.message });
          pushSystemError('dsl_runner', data.message || 'sandbox fallback');
        }
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
      const safeTail = redactSecrets(tail);
      const last = info.lastExit || {};
      const humanError = safeTail
        ? `Бот завершился сразу после запуска\n\nЛог:\n${safeTail}`
        : `Бот завершился сразу после запуска (reason=${last.reason || 'exit'}, code=${last.code ?? 'null'}, signal=${last.signal ?? 'null'})`;
      return res.status(422).json({
        error: humanError,
        details: {
          reason: last.reason || 'exit',
          code: last.code ?? null,
          signal: last.signal ?? null,
          logTail: safeTail,
        },
      });
    }
    recordUserAction(userId, 'bot_start', { runtimeSec: Math.floor(meta.timeoutMs / 1000) });
    res.json({ status: 'started', autoStopIn: Math.floor(meta.timeoutMs / 1000) });
  } catch (e) {
    return sendInternalApiError(res, 'POST /api/run', e, 'Не удалось запустить бота', 500);
  }
});

app.post('/api/stop', requireUserAuth, (req, res) => {
  const requestedUserId = String(req.body?.userId || '');
  if (!requestedUserId || req.authUserId !== requestedUserId) return res.status(403).json({ error: 'Forbidden' });
  const userId = req.authUserId;
  if (!isRunnerActive(userId)) return res.json({ error: 'no bot' });
  stopRunner(userId, { reason: 'manual' });
  recordUserAction(userId, 'bot_stop', {});
  res.json({ status: 'stopped' });
});

app.get('/api/bots', requireUserAuth, (req, res) => {
  res.json(listRunners().filter((bot) => bot.userId === req.authUserId));
});

/** Логи процесса cicada для песочницы «Запуск» (тот же userId, что в POST /api/run). */
app.get('/api/bot/logs', requireUserAuth, (req, res) => {
  try {
    const requestedUserId = String(req.query.userId || '');
    if (!requestedUserId || !/^[a-zA-Z0-9_-]{1,64}$/.test(requestedUserId)) {
      return res.status(400).json({ error: 'invalid userId' });
    }
    if (req.authUserId !== requestedUserId) return res.status(403).json({ error: 'Forbidden' });
    const userId = req.authUserId;
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
const SUBSCRIPTION_MS_PER_DAY = 24 * 60 * 60 * 1000;

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

function parseCryptoBotDate(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function readCryptoBotInvoiceItems(result) {
  if (Array.isArray(result?.items)) return result.items;
  if (Array.isArray(result)) return result;
  return [];
}

function getCryptoBotInvoiceId(invoice) {
  const id = invoice?.invoice_id ?? invoice?.invoiceId;
  return id == null ? null : String(id);
}

function subscriptionReceiptRow(row) {
  const planInfo = PLANS[row.plan] || {};
  return row ? {
    invoiceId: row.invoice_id,
    plan: row.plan,
    planLabel: planInfo.label || row.plan,
    days: planInfo.days ?? null,
    amount: row.amount,
    asset: row.asset,
    status: row.status,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    processedAt: row.processed_at,
  } : null;
}

async function upsertSubscriptionInvoice(invoice, meta) {
  const invoiceId = getCryptoBotInvoiceId(invoice);
  if (!invoiceId || !meta?.userId || !meta?.plan) return null;

  const paidAt = parseCryptoBotDate(invoice?.paid_at);
  const createdAt = parseCryptoBotDate(invoice?.created_at);
  const status = String(invoice?.status || 'created');
  const asset = invoice?.asset == null ? null : String(invoice.asset);
  const amount = invoice?.amount == null ? null : String(invoice.amount);

  await pool.query(
    `
    INSERT INTO subscription_invoices
      (invoice_id, user_id, plan, asset, amount, status, paid_at, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,NOW()))
    ON CONFLICT (invoice_id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      plan    = EXCLUDED.plan,
      asset   = COALESCE(EXCLUDED.asset, subscription_invoices.asset),
      amount  = COALESCE(EXCLUDED.amount, subscription_invoices.amount),
      status  = EXCLUDED.status,
      paid_at = COALESCE(EXCLUDED.paid_at, subscription_invoices.paid_at)
    `,
    [invoiceId, String(meta.userId), String(meta.plan), asset, amount, status, paidAt, createdAt],
  );

  return invoiceId;
}

async function activateSubscriptionPayment({ userId, plan, invoiceId = null, source = 'payment' }) {
  const planInfo = PLANS[plan];
  if (!planInfo) return { activated: false, reason: 'invalid_plan' };

  const client = await pool.connect();
  let result;
  try {
    await client.query('BEGIN');

    if (invoiceId) {
      const invoiceLock = await client.query(
        'SELECT processed_at FROM subscription_invoices WHERE invoice_id=$1 FOR UPDATE',
        [String(invoiceId)],
      );
      if (invoiceLock.rows[0]?.processed_at) {
        await client.query('COMMIT');
        return { activated: false, alreadyProcessed: true };
      }
    }

    const { rows } = await client.query(
      'SELECT id, plan, subscription_exp FROM users WHERE id=$1 FOR UPDATE',
      [userId],
    );
    const user = rows[0];
    if (!user) {
      await client.query('COMMIT');
      return { activated: false, reason: 'user_not_found' };
    }

    const now = Date.now();
    const currentExp = coerceDbMillis(user.subscription_exp);
    const base = user.plan === 'pro' && currentExp && currentExp > now ? currentExp : now;
    const newExp = base + planInfo.days * SUBSCRIPTION_MS_PER_DAY;

    await client.query("UPDATE users SET plan='pro', subscription_exp=$1 WHERE id=$2", [newExp, userId]);
    if (invoiceId) {
      await client.query(
        "UPDATE subscription_invoices SET status='paid', processed_at=NOW() WHERE invoice_id=$1",
        [String(invoiceId)],
      );
    }

    await client.query('COMMIT');
    result = { activated: true, userId, plan, days: planInfo.days, subscriptionExp: newExp };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  pushRing(recentSubscriptions, {
    at: new Date().toISOString(),
    userId,
    source,
    plan,
    days: planInfo.days,
    subscriptionExp: result.subscriptionExp,
    invoiceId: invoiceId ? String(invoiceId) : undefined,
  }, 400);
  recordUserAction(userId, 'subscription_paid', {
    plan,
    days: planInfo.days,
    subscriptionExp: result.subscriptionExp,
    invoiceId: invoiceId ? String(invoiceId) : undefined,
  });
  console.log(`✅ Subscription: ${userId} → ${plan} until ${new Date(result.subscriptionExp).toISOString()}`);

  return result;
}

app.post('/api/subscription/create', requireUserAuth, async (req, res) => {
  const { plan, asset } = req.body;
  const requestedUserId = req.body?.userId == null ? req.authUserId : String(req.body.userId);
  if (requestedUserId !== req.authUserId) return res.status(403).json({ error: 'Forbidden' });
  const userId = req.authUserId;
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
    await upsertSubscriptionInvoice(invoice, { userId, plan });
    res.json({ ok: true, invoiceUrl: invoice.pay_url, invoiceId: getCryptoBotInvoiceId(invoice), amount, asset });
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

  const incomingInvoiceId = getCryptoBotInvoiceId(invoicePayload);
  if (!incomingInvoiceId) return res.json({ ok: true });

  let verifiedInvoice;
  try {
    const invoices = readCryptoBotInvoiceItems(
      await cryptobotRequest('getInvoices', { invoice_ids: [incomingInvoiceId] }),
    );
    verifiedInvoice = invoices.find((invoice) => getCryptoBotInvoiceId(invoice) === incomingInvoiceId);
  } catch (e) {
    return sendInternalApiError(
      res,
      'POST /api/subscription/webhook verify',
      e,
      'Не удалось проверить оплату. CryptoBot повторит webhook позже.',
      502,
    );
  }

  if (verifiedInvoice?.status !== 'paid') return res.json({ ok: true });

  let meta;
  try { meta = JSON.parse(verifiedInvoice?.payload); } catch { return res.json({ ok: true }); }

  const { userId, plan } = meta;
  const planInfo = PLANS[plan];
  if (!planInfo) return res.json({ ok: true });

  const invoiceId = await upsertSubscriptionInvoice(verifiedInvoice, { userId, plan });
  await activateSubscriptionPayment({ userId, plan, invoiceId, source: 'payment' });
  res.json({ ok: true });
});

app.post('/api/subscription/sync', requireUserAuth, async (req, res) => {
  const userId = req.authUserId;
  const { rows } = await pool.query(
    `
    SELECT invoice_id, plan
    FROM subscription_invoices
    WHERE user_id=$1
      AND processed_at IS NULL
      AND created_at > NOW() - INTERVAL '2 days'
    ORDER BY created_at DESC
    LIMIT 20
    `,
    [userId],
  );

  if (rows.length === 0) {
    const user = await findById(userId);
    return res.json({ ok: true, activated: false, user: user ? safeUser(user) : null });
  }

  try {
    const invoiceIds = rows.map((row) => row.invoice_id);
    const invoices = readCryptoBotInvoiceItems(
      await cryptobotRequest('getInvoices', { invoice_ids: invoiceIds }),
    );
    let activated = false;
    let subscriptionExp = null;

    for (const invoice of invoices) {
      if (invoice?.status !== 'paid') continue;

      let meta;
      try { meta = JSON.parse(invoice?.payload); } catch { continue; }
      if (String(meta?.userId) !== userId || !PLANS[meta?.plan]) continue;

      const invoiceId = await upsertSubscriptionInvoice(invoice, meta);
      const activation = await activateSubscriptionPayment({
        userId,
        plan: meta.plan,
        invoiceId,
        source: 'payment_sync',
      });
      if (activation.activated) {
        activated = true;
        subscriptionExp = activation.subscriptionExp;
      }
    }

    const user = await findById(userId);
    return res.json({
      ok: true,
      activated,
      subscriptionExp,
      user: user ? safeUser(user) : null,
    });
  } catch (e) {
    return sendInternalApiError(
      res,
      'POST /api/subscription/sync',
      e,
      'Не удалось проверить оплату. Попробуйте обновить страницу чуть позже.',
      502,
    );
  }
});

app.get('/api/subscription/purchases', requireUserAuth, async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT invoice_id, plan, asset, amount, status, paid_at, created_at, processed_at
    FROM subscription_invoices
    WHERE user_id=$1
    ORDER BY COALESCE(paid_at, created_at) DESC
    LIMIT 100
    `,
    [req.authUserId],
  );
  res.json({ purchases: rows.map(subscriptionReceiptRow).filter(Boolean) });
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

// OAuth/bootstrap now returns the user; JWT remains in HttpOnly SameSite cookie.
app.get('/api/auth/oauth-bootstrap', async (req, res) => {
  const handoffOpts = strictCookieOptions(req, { httpOnly: true });
  const pendingOpts = strictCookieOptions(req, { httpOnly: true, maxAge: 10 * 60 * 1000 });
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
  const handoffCode = String(req.query?.code || '').trim();
  if (handoffCode) {
    const meta = oauthLoginHandoffs.get(handoffCode);
    oauthLoginHandoffs.delete(handoffCode);
    if (!meta || meta.exp <= Date.now()) return res.json({ ok: false });
    const user = await findById(String(meta.userId));
    if (!user || user.banned) return res.json({ ok: false });
    if (meta.type === 'oauth_2fa_pending') {
      const pending = jwt.sign({ sub: String(user.id), type: 'oauth_2fa_pending' }, JWT_SECRET, { expiresIn: '10m' });
      res.cookie(OAUTH_2FA_PENDING_COOKIE, pending, strictCookieOptions(req, { httpOnly: true, maxAge: 10 * 60 * 1000 }));
      return res.json({ ok: false, twofaRequired: true, user: safeUser(user) });
    }
    issueUserSessionCookie(req, res, user.id);
    return res.json({ ok: true, user: safeUser(user) });
  }
  const cookieUserId = getJwtUserId(req);
  if (cookieUserId) {
    const user = await findById(cookieUserId);
    if (user && !user.banned) return res.json({ ok: true, user: safeUser(user) });
  }
  if (raw) {
    try {
      const d = jwt.verify(raw, JWT_SECRET);
      if (!d || d.type !== 'user' || !d.sub) return res.json({ ok: false });
      const user = await findById(String(d.sub));
      if (!user || user.banned) return res.json({ ok: false });
      issueUserSessionCookie(req, res, user.id);
      return res.json({ ok: true, user: safeUser(user) });
    } catch {
      return res.json({ ok: false });
    }
  }
  return res.json({ ok: false });
});

app.post('/api/auth/oauth-2fa/complete', async (req, res) => {
  const pendingOpts = strictCookieOptions(req, { httpOnly: true, maxAge: 10 * 60 * 1000 });
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
  issueUserSessionCookie(req, res, user.id);
  recordUserLogin(user.id, req.ip, 'oauth_2fa');
  recordUserAction(user.id, 'login_success', { method: 'oauth_2fa' });
  return res.json({ success: true, user: safeUser(user) });
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
  const proto = req.get('x-forwarded-proto') || (isSecureRequest(req) ? 'https' : req.protocol || 'http');
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
  if (req.appAdminUser?.role === 'admin') return true;
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
app.use('/api/admin', requireAdminApi);

app.post('/api/admin/enter', (req, res) => {
  issueAdminRouteCookie(req, res, req.authUserId);
  recordAdminAction(req, 'admin_route_enter', req.authUserId, {});
  res.json({ ok: true });
});

app.get('/api/admin/ui', (req, res) => {
  const html = fs.readFileSync(path.resolve('server/admin.html'), 'utf8')
    .replace("'__API_TARGET__'", "''");
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

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
    issueAdminSessionCookie(req, res);
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
  issueAdminSessionCookie(req, res);
  recordAdminAction(req, 'admin_login', null, {});
  res.json({ ok: true });
});

app.get('/api/admin/session', (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('admin_session', strictCookieOptions(req, { httpOnly: true }));
  res.clearCookie(ADMIN_ROUTE_COOKIE, strictCookieOptions(req, { httpOnly: true }));
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

  const [
    projectResult,
    purchaseResult,
    passkeyResult,
    supportResult,
  ] = await Promise.all([
    pool.query(
      `
      SELECT id, name, created_at AS "createdAt", updated_at AS "updatedAt"
      FROM projects
      WHERE user_id=$1
      ORDER BY updated_at DESC
      LIMIT 100
      `,
      [userId],
    ),
    pool.query(
      `
      SELECT invoice_id, plan, asset, amount, status, paid_at, created_at, processed_at
      FROM subscription_invoices
      WHERE user_id=$1
      ORDER BY COALESCE(paid_at, created_at) DESC
      LIMIT 100
      `,
      [userId],
    ),
    pool.query(
      `
      SELECT name, sign_count AS "signCount", created_at AS "createdAt", last_used_at AS "lastUsedAt"
      FROM user_passkeys
      WHERE user_id=$1
      ORDER BY created_at DESC
      LIMIT 50
      `,
      [userId],
    ),
    pool.query(
      `
      SELECT id, subject, status, created_at AS "createdAt", replied_at AS "repliedAt", user_seen_at AS "userSeenAt"
      FROM support_requests
      WHERE user_id=$1
      ORDER BY created_at DESC
      LIMIT 100
      `,
      [userId],
    ),
  ]);

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
    projects: projectResult.rows,
    purchases: purchaseResult.rows.map(subscriptionReceiptRow).filter(Boolean),
    passkeys: passkeyResult.rows,
    supportRequests: supportResult.rows,
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
    securityEvents: recentSecurityEvents.filter(includesQ).slice(-200),
    adminActions: recentAdminActions.filter(includesQ).slice(-200),
  });
});


function supportRequestRow(row) {
  const messages = supportMessagesFromRow(row);
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
    messages,
    attachments: messages.find((msg) => msg.author === 'user')?.attachments || [],
    userSeenAt: row.user_seen_at,
    createdAt: row.created_at,
    userName: row.user_name,
    userEmail: row.user_email,
  } : null;
}

const SUPPORT_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const SUPPORT_MAX_ATTACHMENTS = 3;
const SUPPORT_MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

function estimateBase64Bytes(base64) {
  const clean = String(base64 || '').replace(/\s/g, '');
  if (!clean) return 0;
  const padding = clean.endsWith('==') ? 2 : (clean.endsWith('=') ? 1 : 0);
  return Math.floor((clean.length * 3) / 4) - padding;
}

function normalizeSupportAttachments(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, SUPPORT_MAX_ATTACHMENTS).map((item) => {
    const dataUrl = String(item?.dataUrl || '');
    const match = dataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([a-z0-9+/=\s]+)$/i);
    if (!match) return null;
    const type = match[1].toLowerCase();
    if (!SUPPORT_IMAGE_MIME_TYPES.has(type)) return null;
    const size = estimateBase64Bytes(match[2]);
    if (size <= 0 || size > SUPPORT_MAX_ATTACHMENT_BYTES) return null;
    const rawName = String(item?.name || 'screenshot').replace(/[^\w.\- а-яА-ЯёЁ]/g, '').trim();
    return {
      id: crypto.randomUUID(),
      name: (rawName || 'screenshot').slice(0, 120),
      type,
      size,
      dataUrl,
    };
  }).filter(Boolean);
}

function supportMessageEntry(author, text, attachments = [], createdAt = new Date().toISOString()) {
  return {
    id: crypto.randomUUID(),
    author,
    text: String(text || '').trim().slice(0, 8000),
    attachments: normalizeSupportAttachments(attachments),
    createdAt,
  };
}

function supportMessagesFromRow(row) {
  if (!row) return [];
  let messages = [];
  try {
    messages = Array.isArray(row.messages) ? row.messages : JSON.parse(row.messages || '[]');
  } catch {
    messages = [];
  }
  messages = messages
    .filter((msg) => msg && (msg.text || (Array.isArray(msg.attachments) && msg.attachments.length)))
    .map((msg) => ({
      id: String(msg.id || crypto.randomUUID()),
      author: msg.author === 'admin' ? 'admin' : 'user',
      text: String(msg.text || '').slice(0, 8000),
      attachments: normalizeSupportAttachments(msg.attachments),
      createdAt: msg.createdAt || row.created_at || new Date().toISOString(),
    }));
  if (messages.length > 0) return messages;
  const fallback = [];
  if (row.message) fallback.push(supportMessageEntry('user', row.message, [], row.created_at));
  if (row.reply_text) fallback.push(supportMessageEntry('admin', row.reply_text, [], row.replied_at || row.created_at));
  return fallback;
}

app.post('/api/support/requests', supportJsonParser, requireUserAuth, async (req, res) => {
  const user = await findById(req.authUserId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  const from = String(req.body?.from || user.email || user.name || '').trim().slice(0, 200);
  const subject = String(req.body?.subject || '').trim().slice(0, 180);
  const messageText = String(req.body?.message || '').trim().slice(0, 8000);
  const attachments = normalizeSupportAttachments(req.body?.attachments);
  const message = messageText || (attachments.length ? 'Прикреплён скриншот' : '');
  const emailCandidate = String(req.body?.email || user.email || '').trim().slice(0, 200);
  const email = emailCandidate.includes('@') ? emailCandidate : (user.email || null);
  if (!from || !subject || !message) return res.status(400).json({ error: 'Заполните поля: кто, тема и суть вопроса' });
  const id = crypto.randomUUID();
  const messages = [supportMessageEntry('user', messageText, attachments)];
  await pool.query(
    `INSERT INTO support_requests (id, user_id, from_text, email, subject, message, messages, user_seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW())`,
    [id, user.id, from, email, subject, message, JSON.stringify(messages)]
  );
  recordUserAction(user.id, 'support_request_create', { supportRequestId: id, subject });
  const { rows } = await pool.query('SELECT * FROM support_requests WHERE id=$1', [id]);
  res.json({ success: true, id, request: supportRequestRow(rows[0]) });
});

app.get('/api/support/requests', requireUserAuth, async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM support_requests
    WHERE user_id=$1
    ORDER BY created_at DESC
    LIMIT 100
    `,
    [req.authUserId],
  );
  res.json({ requests: rows.map(supportRequestRow) });
});

app.post('/api/support/requests/seen', requireUserAuth, async (req, res) => {
  await pool.query(
    `UPDATE support_requests
     SET user_seen_at=NOW()
     WHERE user_id=$1 AND replied_at IS NOT NULL`,
    [req.authUserId],
  );
  res.json({ success: true, unread: 0 });
});

app.get('/api/support/unread-count', requireUserAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS unread_count
     FROM support_requests
     WHERE user_id=$1
       AND replied_at IS NOT NULL
       AND (user_seen_at IS NULL OR replied_at > user_seen_at)`,
    [req.authUserId],
  );
  res.json({ unread: Number(rows[0]?.unread_count || 0) });
});

app.post('/api/support/requests/:id/messages', supportJsonParser, requireUserAuth, async (req, res) => {
  const id = String(req.params.id || '');
  const text = String(req.body?.message || '').trim().slice(0, 8000);
  const attachments = normalizeSupportAttachments(req.body?.attachments);
  if (!text && attachments.length === 0) return res.status(400).json({ error: 'Введите сообщение или прикрепите скриншот' });
  const { rows } = await pool.query('SELECT * FROM support_requests WHERE id=$1 AND user_id=$2', [id, req.authUserId]);
  if (!rows[0]) return res.status(404).json({ error: 'Обращение не найдено' });
  const messages = supportMessagesFromRow(rows[0]).concat(supportMessageEntry('user', text, attachments));
  const updated = await pool.query(
    `UPDATE support_requests
     SET status='open', messages=$1::jsonb, user_seen_at=NOW()
     WHERE id=$2
     RETURNING *`,
    [JSON.stringify(messages), id],
  );
  recordUserAction(req.authUserId, 'support_request_message', { supportRequestId: id });
  res.json({ success: true, request: supportRequestRow(updated.rows[0]) });
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

app.get('/api/admin/support-count', requireUserAuth, requireAppAdmin, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS open_count
     FROM support_requests
     WHERE status = 'open'`
  );
  res.json({ open: Number(rows[0]?.open_count || 0) });
});

app.post('/api/admin/support-requests/:id/reply', async (req, res) => {
  if (!isAdminAuthed(req)) return res.status(403).json({ error: 'Forbidden' });
  const id = String(req.params.id || '');
  const reply = String(req.body?.reply || '').trim().slice(0, 8000);
  if (!reply) return res.status(400).json({ error: 'Введите текст ответа' });
  const { rows } = await pool.query('SELECT * FROM support_requests WHERE id=$1', [id]);
  const item = supportRequestRow(rows[0]);
  if (!item) return res.status(404).json({ error: 'Обращение не найдено' });
  if (!item.userId) return res.status(400).json({ error: 'У обращения нет пользователя для ответа в профиле' });
  const messages = supportMessagesFromRow(rows[0]).concat(supportMessageEntry('admin', reply));
  const updated = await pool.query(
    'UPDATE support_requests SET status=$1, reply_text=$2, replied_at=NOW(), messages=$3::jsonb WHERE id=$4 RETURNING *',
    ['answered', reply, JSON.stringify(messages), id],
  );
  recordAdminAction(req, 'support_request_reply', item.userId, { supportRequestId: id, delivery: 'profile' });
  res.json({ success: true, request: supportRequestRow(updated.rows[0]) });
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
    userAuth: 'JWT in HttpOnly Secure SameSite=Strict cookie',
    adminTotpConfigured: Boolean(ADMIN_TOTP_SECRET),
    adminPasskeysConfigured: loadAdminPasskeys().length,
    adminWebAuthnRpId: resolveAdminWebAuthnRpId(req),
    adminAuth: 'HttpOnly cookie пользователя + role=admin; /admin дополнительно открывается через короткую httpOnly cookie admin_route_session',
    userSessionsActive: 0,
    adminSessionsActive: 0,
    cookieSecurity: {
      httpOnly: true,
      sameSite: 'strict',
      secure: isSecureRequest(req),
    },
    controls: {
      rateLimitMiddleware: 'express-rate-limit',
      loginRateLimit: true,
      registerRateLimit: true,
      forgotPasswordRateLimit: true,
      resetPasswordRateLimit: true,
      uploadRateLimit: true,
      dslLintRateLimit: true,
      botRunRateLimit: true,
      aiGenerateRateLimit: true,
      verifyEmailRateLimit: true,
      emailChangeRateLimit: true,
      confirmEmailChangeRateLimit: true,
      adminLoginRateLimit: true,
      globalApiRateLimit: true,
      jsonBodyLimit: '1mb',
      helmet: 'CSP + HSTS + security headers',
      csrfProtection: true,
      authMiddleware: true,
      bruteForceDetection: true,
      auditSecurityLogging: true,
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
  const fetchRes = safeSpawnSync('git', ['-C', root, 'fetch', '--quiet'], { encoding: 'utf8', timeout: 30_000 });
  if (fetchRes.error) return res.status(500).json({ error: `git fetch: ${fetchRes.error.message}` });
  const localRes = safeSpawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const remoteRes = safeSpawnSync('git', ['-C', root, 'rev-parse', '@{u}'], { encoding: 'utf8' });
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
  const statusRes = safeSpawnSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8', timeout: 30_000 });
  if (statusRes.error || statusRes.status !== 0) {
    return res.status(500).json({ error: `git status: ${statusRes.error?.message || statusRes.stderr || 'ошибка'}` });
  }
  if (String(statusRes.stdout || '').trim()) {
    const stashRes = safeSpawnSync('git', ['-C', root, 'stash', 'push', '--include-untracked', '-m', stashName], { encoding: 'utf8', timeout: 60_000 });
    const stashCombined = `${stashRes.stdout || ''}\n${stashRes.stderr || ''}`;
    const noChangesToSave = /no local changes to save/i.test(stashCombined);
    if (stashRes.error || (stashRes.status !== 0 && !noChangesToSave)) {
      return res.status(500).json({ error: `git stash: ${stashRes.error?.message || stashRes.stderr || 'ошибка'}` });
    }
    autoStashed = !noChangesToSave;
  }

  const pullRes = safeSpawnSync('git', ['-C', root, 'pull', '--ff-only'], { encoding: 'utf8', timeout: 120_000 });
  if (pullRes.error || pullRes.status !== 0) {
    if (autoStashed) safeSpawnSync('git', ['-C', root, 'stash', 'pop'], { encoding: 'utf8', timeout: 60_000 });
    return res.status(500).json({ error: `git pull: ${pullRes.error?.message || pullRes.stderr || 'ошибка'}` });
  }
  const buildRes = safeSpawnSync('npm', ['run', 'build'], { cwd: root, encoding: 'utf8', timeout: 10 * 60_000 });
  if (buildRes.error || buildRes.status !== 0) {
    return res.status(500).json({ error: `npm run build: ${buildRes.error?.message || buildRes.stderr || 'ошибка'}` });
  }
  if (autoStashed) {
    const popRes = safeSpawnSync('git', ['-C', root, 'stash', 'pop'], { encoding: 'utf8', timeout: 60_000 });
    if (popRes.error || popRes.status !== 0) {
      return res.status(500).json({ error: `git stash pop: ${popRes.error?.message || popRes.stderr || 'разрешите конфликт и примените stash вручную'}` });
    }
  }

  recordAdminAction(req, 'system_update_apply', null, { ok: true });
  res.json({ success: true, message: 'Обновление установлено. Перезапуск сервера запущен.' });

  setTimeout(() => {
    try {
      const pm2Res = safeSpawnSync('pm2', ['restart', 'server.mjs', '--name', 'cicada-server'], { cwd: root, encoding: 'utf8', timeout: 60_000 });
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
    const tar = safeSpawnSync('git', ['-C', root, 'archive', '--format=tar', 'HEAD'], {
      maxBuffer: 250 * 1024 * 1024,
    });
    if (tar.error) return { error: `git: ${tar.error.message}` };
    if (tar.status !== 0) {
      return { error: tar.stderr?.toString() || `git archive (код ${tar.status})` };
    }
    const gz = safeSpawnSync('gzip', ['-9', '-c'], {
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
  const tb = safeSpawnSync('tar', args, { maxBuffer: 250 * 1024 * 1024 });
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
  const dump = safeSpawnSync(
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
      const handoffCode = issueOauth2faHandoffCode(user.id);
      return res.redirect(buildOauthRedirectUrl(handoffCode));
    } else {
      recordUserLogin(user.id, req.ip, 'google');
      recordUserAction(user.id, 'login_success', { method: 'google' });
      const handoffCode = issueOauthJwtHandoffCookie(res, user.id);
      return res.redirect(buildOauthRedirectUrl(handoffCode));
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
    const nextPhotoUrl = isLocalAvatarUrl(user.photo_url)
      ? user.photo_url
      : (photo_url ?? user.photo_url);
    await pool.query('UPDATE users SET name=$1, photo_url=$2 WHERE id=$3', [
      name,
      nextPhotoUrl,
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
    const handoffCode = issueOauthJwtHandoffCookie(res, result.user.id);
    return res.redirect(buildOauthRedirectUrl(handoffCode));
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

    issueUserSessionCookie(req, res, result.user.id);
    res.json({ success: true, user: safeUser(result.user) });
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

async function readSseTextStream(res, { extractTextDelta, onTextDelta } = {}) {
  if (!res.body?.getReader) {
    const e = new Error('LLM streaming response body is not readable.');
    e.llmKind = 'BAD_RESPONSE';
    throw e;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

  const handleEvent = (eventText) => {
    const dataLines = String(eventText || '')
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim());
    for (const dataLine of dataLines) {
      if (!dataLine || dataLine === '[DONE]') continue;
      let payload = null;
      try {
        payload = JSON.parse(dataLine);
      } catch {
        continue;
      }
      const delta = extractTextDelta?.(payload) || '';
      if (!delta) continue;
      content += delta;
      onTextDelta?.(delta, content, payload);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || '';
    for (const eventText of events) handleEvent(eventText);
  }
  buffer += decoder.decode();
  if (buffer.trim()) handleEvent(buffer);
  return { choices: [{ message: { content } }] };
}

function openAiStreamTextDelta(payload) {
  return payload?.choices?.[0]?.delta?.content || payload?.choices?.[0]?.message?.content || '';
}

function anthropicStreamTextDelta(payload) {
  if (payload?.type === 'content_block_delta' && payload?.delta?.type === 'text_delta') {
    return payload.delta.text || '';
  }
  if (payload?.type === 'content_block_start' && payload?.content_block?.type === 'text') {
    return payload.content_block.text || '';
  }
  return '';
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
  if (options.stream) body.stream = true;

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
      signal: options.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
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

  if (options.stream && res.ok) {
    return readSseTextStream(res, {
      extractTextDelta: anthropicStreamTextDelta,
      onTextDelta: options.onTextDelta,
    });
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
          ...(options.stream ? { stream: true } : {}),
        }),
        signal: options.signal,
      });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
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

    if (options.stream && res.ok) {
      return readSseTextStream(res, {
        extractTextDelta: openAiStreamTextDelta,
        onTextDelta: options.onTextDelta,
      });
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

// Статический разбор AI IR: structural validator + strict semantic gate + deterministic repair.

const AI_SYSTEM_PROMPT = `Ты — проектировщик runtime graph для Telegram-ботов Cicada Studio.
Верни ТОЛЬКО валидный JSON-объект Canonical AI IR. Первый символ {, последний }. Никакого текста до или после.

═══ БРЕНДИНГ ИИ ═══
Если в тексте сообщений бота нужно назвать ИИ, используй только название "Cicada 3301".
Никогда не используй названия моделей/вендоров вроде "Meta Llama 3", "Llama", "Qwen", "OpenAI", "Groq".

═══ CANONICAL AI IR (единственный выходной контракт) ═══
ИИ НЕ пишет DSL и НЕ пишет editor stacks. ИИ строит runtime graph:
{
  "irVersion": 1,
  "targetCore": "0.3.5",
  "compatibilityMode": "0.3.5 exact",
  "intent": {"primary": "..."},
  "state": {"globals": []},
  "handlers": [],
  "blocks": [],
  "scenarios": [],
  "transitions": [],
  "uiStates": []
}

Сервер сам выполнит: Canonical IR → IR Normalize → IR Semantic Gate → deterministic IR Repair → DSL serialization → runtime validation.
Не генерируй текст DSL, не генерируй массив stacks, не придумывай синтаксис.

Разрешены ТОЛЬКО следующие handler.type:
  start, command, callback, text

Разрешены ТОЛЬКО следующие action.type:
  message, buttons, inline_db, ask, remember, get, save, save_global, condition,
  run_scenario, goto_command, goto_block, goto_scenario, goto, use_block, stop, send_file, ui_state

Запрещено придумывать type вне списка (legacy callbacks, inline, http, pause, document, photo, media_received, append, insert и т.д.).
Если нужна другая возможность — только эквивалент из whitelist.

Для записи в KV используй только save/save_global. Не придумывай append/insert/update_many: если нужно изменить список, сначала собери новое значение в remember, затем save/save_global.

═══ АЛГОРИТМ ПОСТРОЕНИЯ ГРАФА (выполни мысленно, затем выведи только JSON) ═══

Даже если пользователь написал коротко или расплывчато, НЕ расширяй граф сверх IntentPlan и complexity budget.
Строй минимальный viable flow из IntentPlan: меньше handlers/scenarios лучше, чем сырой сложный IR.

1) ИНТЕНТ — что делает бот, цель и точка входа: /start или первая reply-кнопка.
2) СОСТОЯНИЯ — uiStates для экранов: text/message, buttons или inlineDb.
3) HANDLERS — start, command, callback, text; callback.trigger может быть "" для общего inline-router «при нажатии:».
4) ПЕРЕХОДЫ — через actions run_scenario/goto_command/goto_block/goto_scenario/use_block и дублируй важные связи в transitions.
5) УСЛОВИЯ — action condition с then/else.
6) ДАННЫЕ — любая {переменная} в message/condition объявлена выше ask/get/remember или это системная переменная из registry. get допустим только если сервер в режиме advanced и ключ get.key входит в разрешённый список. В safe-режиме get не используй — только remember/ask/save известных значений.

Промежуточный план уже будет передан сервером. Не печатай его — только JSON Canonical IR.

═══ IR SHAPES ═══

handler:
  {"id":"h_catalog","type":"callback","trigger":"📦 Каталог","actions":[...]}
  {"id":"h_inline_router","type":"callback","trigger":"","actions":[...]}  // общий handler для inline callback
  {"id":"h_catalog_cmd","type":"command","trigger":"/catalog","actions":[...]}

block:
  {"id":"b_menu","name":"главное_меню","actions":[...]}

scenario:
  {"id":"s_checkout","name":"оформление","steps":[{"id":"step_name","name":"имя","actions":[...]}]}

uiState:
  {"id":"ui_catalog","message":"📦 Категории:","buttons":"📦 Каталог, 🛒 Корзина"}
  {"id":"ui_categories","message":"Выберите категорию","inlineDb":{"key":"категории","callbackPrefix":"cat:","backText":"⬅️ Назад","backCallback":"back","columns":"2"}}

action examples:
  {"type":"message","text":"..."}
  {"type":"buttons","rows":"A, B\\nC"}
  {"type":"inline_db","key":"категории","callbackPrefix":"cat:","backText":"⬅️ Назад","backCallback":"back","columns":"2"}
  {"type":"condition","cond":"начинается_с(callback_data, \"cat:\")","then":[...],"else":[...]}
  {"type":"run_scenario","target":"оформление"}
  {"type":"goto_command","target":"/catalog"}
  {"type":"goto_block","target":"главное_меню"}
  {"type":"use_block","target":"главное_меню"}

═══ АРХИТЕКТУРА ═══

КНОПКИ + ОБРАБОТЧИКИ:
  start handler показывает uiState/menu.
  Reply buttons требуют отдельный callback handler с trigger == тексту кнопки.
  Inline из БД требует общий callback handler trigger == "" и conditions по переменной callback_data.

СЦЕНАРИЙ, НЕСКОЛЬКО ВОПРОСОВ:
  start/callback → run(имя) БЕЗ stop | scenario(имя) → step → ask → step → ask → … → message/condition → stop
  После ask всегда дай пользователю следующее message или кнопки.

УСЛОВИЕ:
  … → condition(cond) → message → else → message → stop

═══ СТРОГИЕ ПРАВИЛА ═══

1. Не указывай bot/token/editor coordinates — это сделает серверный generator.
2. Не ставь stop сразу после run_scenario в том же handler.
3. Для 2+ вопросов используй scenarios.steps, а handler только запускает scenario.
4. Reply callback trigger совпадает с текстом в buttons.rows.
5. Inline callback router: handler.type callback, trigger "".
6. Используй только объявленные переменные и canonical system variables; не придумывай бд/callback/data/state.
7. В ключе get.key при подстановке chat_id используй только корректные скобки: "поле_{chat_id}", не опечатывай }.

═══ ПЕРЕМЕННЫЕ ═══

Объявление: ask (varname), get (varname), remember (varname).
Системные без объявления: пользователь, текст, callback_data.

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
const FEW_SHOT_ASSISTANT_3 = `[{"id":"s0","x":40,"y":40,"blocks":[{"id":"b0","type":"bot","props":{"token":"YOUR_BOT_TOKEN"}}]},{"id":"s1","x":400,"y":40,"blocks":[{"id":"b1","type":"start","props":{}},{"id":"b2","type":"message","props":{"text":"Привет! 👋 Я создаю QR-коды для любого текста или ссылки."}},{"id":"b3","type":"buttons","props":{"rows":"📷 Создать QR-код"}},{"id":"b4","type":"stop","props":{}}]},{"id":"s2","x":760,"y":40,"blocks":[{"id":"b5","type":"callback","props":{"label":"📷 Создать QR-код"}},{"id":"b6","type":"run","props":{"name":"qr_сценарий"}}]},{"id":"s3","x":400,"y":380,"blocks":[{"id":"b8","type":"scenario","props":{"name":"qr_сценарий"}},{"id":"b9","type":"step","props":{"name":"ввод_текста"}},{"id":"b10","type":"ask","props":{"question":"Введите текст или ссылку для QR-кода:","varname":"qr_текст"}},{"id":"b11","type":"message","props":{"text":"📷 Ваш QR-код готов!\nhttps://api.qrserver.com/v1/create-qr-code/?size=300x300&data={кодировать_url(qr_текст)}"}},{"id":"b12","type":"buttons","props":{"rows":"🔄 Создать ещё, 🏠 Главная"}},{"id":"b13","type":"stop","props":{}}]},{"id":"s4","x":760,"y":380,"blocks":[{"id":"b14","type":"callback","props":{"label":"🔄 Создать ещё"}},{"id":"b15","type":"run","props":{"name":"qr_сценарий"}}]},{"id":"s5","x":1120,"y":380,"blocks":[{"id":"b17","type":"callback","props":{"label":"🏠 Главная"}},{"id":"b18","type":"message","props":{"text":"Главное меню 🏠"}},{"id":"b19","type":"buttons","props":{"rows":"📷 Создать QR-код"}},{"id":"b20","type":"stop","props":{}}]}]`;

const FEW_SHOT_USER_4 = `бот с авторизацией: при старте кнопка Авторизация, после нажатия спросить логин и пароль, если admin и 12345 — успех, иначе ошибка`;
const FEW_SHOT_ASSISTANT_4 = `[{"id":"s0","x":40,"y":40,"blocks":[{"id":"b0","type":"bot","props":{"token":"YOUR_BOT_TOKEN"}}]},{"id":"s1","x":400,"y":40,"blocks":[{"id":"b1","type":"start","props":{}},{"id":"b2","type":"message","props":{"text":"Добро пожаловать! Пожалуйста, авторизируйтесь."}},{"id":"b3","type":"buttons","props":{"rows":"Авторизация"}},{"id":"b4","type":"stop","props":{}}]},{"id":"s2","x":760,"y":40,"blocks":[{"id":"b5","type":"callback","props":{"label":"Авторизация"}},{"id":"b6","type":"run","props":{"name":"авторизация"}}]},{"id":"s3","x":1120,"y":40,"blocks":[{"id":"b7","type":"scenario","props":{"name":"авторизация"}},{"id":"b8","type":"step","props":{"name":"логин"}},{"id":"b9","type":"ask","props":{"question":"Введите ваш логин:","varname":"логин"}},{"id":"b10","type":"step","props":{"name":"пароль"}},{"id":"b11","type":"ask","props":{"question":"Введите ваш пароль:","varname":"пароль"}},{"id":"b12","type":"condition","props":{"cond":"логин == \"admin\" && пароль == \"12345\""}},{"id":"b13","type":"message","props":{"text":"Авторизация успешна! 🚀"}},{"id":"b14","type":"stop","props":{}},{"id":"b15","type":"else","props":{}},{"id":"b16","type":"message","props":{"text":"Неправильный логин или пароль. 😔"}},{"id":"b17","type":"stop","props":{}}]}]`;

const FEW_SHOT_USER_5 = `бот-хранилище файлов: меню «Загрузить» и «Получить»; загрузка через сценарий принимает файл и пишет в сообщении File ID; получение спрашивает File ID текстом и отправляет сам документ через send_file (не только текст с id)`;
const FEW_SHOT_ASSISTANT_5 = `[{"id":"s0","x":40,"y":40,"blocks":[{"id":"b0","type":"bot","props":{"token":"YOUR_BOT_TOKEN"}}]},{"id":"s1","x":400,"y":40,"blocks":[{"id":"b1","type":"start","props":{}},{"id":"b2","type":"message","props":{"text":"Привет! 📁 Принимаю файл и отдам по File ID."}},{"id":"b3","type":"buttons","props":{"rows":"📤 Загрузить, 📥 Получить"}},{"id":"b4","type":"stop","props":{}}]},{"id":"s2","x":760,"y":40,"blocks":[{"id":"b5","type":"callback","props":{"label":"📤 Загрузить"}},{"id":"b6","type":"run","props":{"name":"загрузка"}}]},{"id":"s3","x":1120,"y":40,"blocks":[{"id":"b7","type":"callback","props":{"label":"📥 Получить"}},{"id":"b8","type":"run","props":{"name":"выдача"}}]},{"id":"s4","x":40,"y":380,"blocks":[{"id":"b9","type":"scenario","props":{"name":"загрузка"}},{"id":"b10","type":"step","props":{"name":"ждём_файл"}},{"id":"b11","type":"ask","props":{"question":"Пришлите файл:","varname":"файл"}},{"id":"b12","type":"message","props":{"text":"✅ Сохранено. File ID:\\n{файл}"}},{"id":"b13","type":"buttons","props":{"rows":"📥 Получить, 🏠 Главная"}},{"id":"b14","type":"stop","props":{}}]},{"id":"s5","x":400,"y":380,"blocks":[{"id":"b15","type":"scenario","props":{"name":"выдача"}},{"id":"b16","type":"step","props":{"name":"запрос_id"}},{"id":"b17","type":"ask","props":{"question":"Введите File ID:","varname":"сохранённый_файл"}},{"id":"b18","type":"message","props":{"text":"📥 Ваш файл:"}},{"id":"b19","type":"send_file","props":{"file":"{сохранённый_файл}"}},{"id":"b20","type":"buttons","props":{"rows":"📤 Загрузить, 🏠 Главная"}},{"id":"b21","type":"stop","props":{}}]},{"id":"s6","x":760,"y":380,"blocks":[{"id":"b22","type":"callback","props":{"label":"🏠 Главная"}},{"id":"b23","type":"message","props":{"text":"Главное меню 🏠"}},{"id":"b24","type":"buttons","props":{"rows":"📤 Загрузить, 📥 Получить"}},{"id":"b25","type":"stop","props":{}}]}]`;

const FEW_SHOT_USER_6 = `бот по кнопке «Город» спрашивает название города, remember кладёт в переменную город_label строку «Город: {город}», затем message с {город_label}`;
const FEW_SHOT_ASSISTANT_6 = `[{"id":"s0","x":40,"y":40,"blocks":[{"id":"b0","type":"bot","props":{"token":"YOUR_BOT_TOKEN"}}]},{"id":"s1","x":400,"y":40,"blocks":[{"id":"b1","type":"start","props":{}},{"id":"b2","type":"message","props":{"text":"Выберите действие"}},{"id":"b3","type":"buttons","props":{"rows":"🌍 Указать город"}},{"id":"b4","type":"stop","props":{}}]},{"id":"s2","x":760,"y":40,"blocks":[{"id":"b5","type":"callback","props":{"label":"🌍 Указать город"}},{"id":"b6","type":"run","props":{"name":"город_fsm"}}]},{"id":"s3","x":1120,"y":40,"blocks":[{"id":"b7","type":"scenario","props":{"name":"город_fsm"}},{"id":"b8","type":"step","props":{"name":"ввод"}},{"id":"b9","type":"ask","props":{"question":"В каком вы городе?","varname":"город"}},{"id":"b10","type":"remember","props":{"varname":"город_label","value":"Город: {город}"}},{"id":"b11","type":"message","props":{"text":"Запомнил: {город_label}"}},{"id":"b12","type":"stop","props":{}}]}]`;

const IR_FEW_SHOT_USER = `бот принимает заказы: главное меню с кнопкой "Оформить заказ", сценарий спрашивает имя и телефон`;
const IR_FEW_SHOT_ASSISTANT = `{"irVersion":1,"targetCore":"0.3.5","compatibilityMode":"0.3.5 exact","intent":{"primary":"order_form"},"state":{"globals":[]},"uiStates":[{"id":"ui_start","message":"Добро пожаловать! Выберите действие:","buttons":"Оформить заказ, ℹ️ О нас"}],"handlers":[{"id":"h_start","type":"start","trigger":"","actions":[{"type":"ui_state","uiStateId":"ui_start"},{"type":"stop"}]},{"id":"h_order","type":"callback","trigger":"Оформить заказ","actions":[{"type":"message","text":"Отлично! Заполним данные для заказа."},{"type":"run_scenario","target":"оформление"}]},{"id":"h_about","type":"callback","trigger":"ℹ️ О нас","actions":[{"type":"message","text":"Мы — магазин на Cicada Studio."},{"type":"stop"}]}],"blocks":[],"scenarios":[{"id":"sc_order","name":"оформление","steps":[{"id":"step_name","name":"имя","actions":[{"type":"ask","question":"Введите ваше имя:","varname":"имя"}]},{"id":"step_phone","name":"телефон","actions":[{"type":"ask","question":"Введите ваш телефон:","varname":"телефон"},{"type":"message","text":"✅ Заказ принят! Имя: {имя}, телефон: {телефон}"},{"type":"stop"}]}]}],"transitions":[{"from":"h_order","to":"sc_order","type":"run_scenario"}]}`;

const IR_FEW_SHOT_USER_2 = `магазин: категории и товары через inline-кнопки из БД`;
const IR_FEW_SHOT_ASSISTANT_2 = `{"irVersion":1,"targetCore":"0.3.5","compatibilityMode":"0.3.5 exact","intent":{"primary":"db_inline_catalog"},"state":{"globals":[{"name":"категории","value":"[\\"Пицца\\", \\"Напитки\\"]"}]},"uiStates":[{"id":"ui_menu","message":"🏠 Главное меню","buttons":"📦 Каталог"},{"id":"ui_categories","message":"📦 Выберите категорию:","inlineDb":{"key":"категории","callbackPrefix":"cat:","backText":"⬅️ Назад","backCallback":"back","columns":"2"}}],"handlers":[{"id":"h_start","type":"start","trigger":"","actions":[{"type":"ui_state","uiStateId":"ui_menu"},{"type":"stop"}]},{"id":"h_catalog","type":"callback","trigger":"📦 Каталог","actions":[{"type":"ui_state","uiStateId":"ui_categories"},{"type":"stop"}]},{"id":"h_inline","type":"callback","trigger":"","actions":[{"type":"condition","cond":"начинается_с(callback_data, \\"cat:\\")","then":[{"type":"remember","varname":"категория","value":"срез(callback_data, 4)"},{"type":"message","text":"Товары категории: {категория}"},{"type":"inline_db","key":"товары","callbackPrefix":"prod:","backText":"⬅️ Категории","backCallback":"back_categories","columns":"1"},{"type":"stop"}],"else":[{"type":"condition","cond":"начинается_с(callback_data, \\"prod:\\")","then":[{"type":"remember","varname":"товар","value":"срез(callback_data, 5)"},{"type":"message","text":"📦 Товар: {товар}\\nЦена и описание берутся из БД."},{"type":"stop"}],"else":[{"type":"ui_state","uiStateId":"ui_categories"},{"type":"stop"}]}]}]}],"blocks":[],"scenarios":[],"transitions":[{"from":"h_catalog","to":"ui_categories","type":"ui_state"},{"from":"h_inline","to":"ui_categories","type":"inline_router"}]}`;

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

function readTextFileSafe(filePath, maxChars = 4000) {
  try {
    return fs.readFileSync(filePath, 'utf8').slice(0, maxChars);
  } catch {
    return '';
  }
}

function buildAiCoreContextAppendix() {
  const apiManifest = readTextFileSafe(path.resolve('core/manifests/api-manifest.json'), 5000);
  const parserCapabilities = readTextFileSafe(path.resolve('core/manifests/parser-capabilities.default.json'), 3000);
  const featureMatrix = readTextFileSafe(path.resolve('docs/dsl-feature-matrix.md'), 5000);
  return [
    '',
    '═══ CORE-AWARE GENERATOR CONTEXT (source of truth) ═══',
    'Use these manifests as constraints. If user asks for unsupported behavior, model it with supported constructs or omit it.',
    '',
    'api-manifest.json:',
    apiManifest || '(missing)',
    '',
    'parser-capabilities.default.json:',
    parserCapabilities || '(missing)',
    '',
    'dsl-feature-matrix.md:',
    featureMatrix || '(missing)',
  ].join('\n');
}

function buildIntentPlannedUserPrompt(prompt, intentPlan) {
  return [
    'Создай Canonical AI IR строго по IntentPlan и MinimalExecutionGraph ниже.',
    'Если исходный prompt просит больше, чем budget, сгенерируй minimal viable flow и НЕ добавляй extra handlers/scenarios.',
    '',
    'Original prompt:',
    prompt,
    '',
    'IntentPlan:',
    JSON.stringify(intentPlan, null, 2),
  ].join('\n');
}

function buildIrRepairUserPrompt(errors, irJsonSnippet) {
  return [
    'Предыдущий ответ НЕ прошёл проверку Canonical AI IR / core parity. Исправь ТОЛЬКО JSON-объект IR.',
    '',
    'Ошибки:',
    ...errors.slice(0, 20).map((e, i) => `${i + 1}. ${e}`),
    '',
    'Текущий IR для правки (сохрани handlers/blocks/scenarios где возможно):',
    irJsonSnippet,
    '',
    'Вернёшь один JSON-объект {...} без markdown и без текста до/после.',
  ].join('\n');
}

function buildNonJsonRepairPrompt() {
  return (
    'Ответ должен быть ОДНИМ JSON-объектом Canonical AI IR: с символа { до }. Без ```, без пояснений. Повтори попытку.'
  );
}

const AI_GENERATE_PUBLIC_ERROR = 'Cicada AI перегружен попробуйте позже';
const AI_PROMPT_MAX_CHARS = 50;
const AI_LLM_MAX_ATTEMPTS = 2; // initial generation + one LLM retry
const AI_IR_REPAIR_MAX_PASSES = 2;
const AI_GENERATE_TIMEOUT_MS = 9_000;
const AI_TIME_BUDGET_TIERS = Object.freeze({
  AI_PRIMARY: 1,
  AI_RECOVERY: 0.3,
  AI_PARTIAL: 0.2,
  FALLBACK_SKELETON: 0,
});
const AI_PRIMARY_TIMEOUT_MS = AI_GENERATE_TIMEOUT_MS;
const AI_RECOVERY_TIMEOUT_MS = Math.floor(AI_GENERATE_TIMEOUT_MS * AI_TIME_BUDGET_TIERS.AI_RECOVERY);
const AI_PARTIAL_TIMEOUT_MS = Math.floor(AI_GENERATE_TIMEOUT_MS * AI_TIME_BUDGET_TIERS.AI_PARTIAL);
const AI_PARTIAL_DIAGNOSTIC_LIMIT = 20;
let aiPrimaryTimeoutStreak = 0;
const AI_GENERATE_STATUS = Object.freeze({
  SUCCESS: 'success',
  PARTIAL_SUCCESS: 'partial_success',
  FALLBACK_SKELETON: 'fallback_skeleton',
  FAILED: 'failed',
});
const AI_EXECUTION_MODE = Object.freeze({
  AI_PRIMARY: 'AI_PRIMARY',
  AI_RECOVERY: 'AI_RECOVERY',
  AI_PARTIAL: 'AI_PARTIAL',
  FALLBACK_SKELETON: 'FALLBACK_SKELETON',
});
const AI_RETRY_BUDGET = Object.freeze({
  [AI_EXECUTION_MODE.AI_PRIMARY]: 2,
  [AI_EXECUTION_MODE.AI_RECOVERY]: 1,
  [AI_EXECUTION_MODE.AI_PARTIAL]: 1,
  [AI_EXECUTION_MODE.FALLBACK_SKELETON]: 0,
});
const AI_ROOT_CAUSE = Object.freeze({
  AI_TIMEOUT: 'AI_TIMEOUT',
  IR_REPAIR_FAILURE: 'IR_REPAIR_FAILURE',
  NO_VALID_IR: 'NO_VALID_IR',
});
const AI_IR_STATE = Object.freeze({
  FINAL: 'FINAL_IR',
  PARTIAL: 'PARTIAL_IR',
  SKELETON: IR_SKELETON_STATE,
  INVALID: 'INVALID_IR',
});
const AI_NEXT_ACTION = Object.freeze({
  USE_WITH_CAUTION: 'use_with_caution',
  RETRY: 'retry',
  FALLBACK_TEMPLATE: 'fallback_template',
});
const AI_TIMEOUT_CODE = Object.freeze({
  PRIMARY: 'PRIMARY_TIMEOUT',
  RECOVERY: 'RECOVERY_TIMEOUT',
  PARTIAL: 'PARTIAL_TIMEOUT',
});
const AI_PRIMARY_PARTIAL_IR_AVAILABLE_CODE = 'PRIMARY_PARTIAL_IR_AVAILABLE';
const AI_PRIMARY_NO_PARTIAL_IR_CODE = 'PRIMARY_NO_PARTIAL_IR';
const AI_PARTIAL_IR_SALVAGED_CODE = 'PARTIAL_IR_SALVAGED';
const IR_PRUNER_FAILED_REASON_CODE = 'IR_PRUNER_FAILED';
const AI_PARTIAL_REASON_CODES = Object.freeze({
  IR_REPAIR_LIMIT_REACHED: 'IR_REPAIR_LIMIT_REACHED',
  UNKNOWN_SYMBOLS_REPLACED: 'UNKNOWN_SYMBOLS_REPLACED',
  EMPTY_BRANCH_REMOVED: 'EMPTY_BRANCH_REMOVED',
  TIMEOUT_FALLBACK: 'TIMEOUT_FALLBACK',
  PRIMARY_PARTIAL_IR_AVAILABLE: AI_PRIMARY_PARTIAL_IR_AVAILABLE_CODE,
  PRIMARY_NO_PARTIAL_IR: AI_PRIMARY_NO_PARTIAL_IR_CODE,
  PARTIAL_IR_SALVAGED: AI_PARTIAL_IR_SALVAGED_CODE,
  IR_PRUNER_FAILED: IR_PRUNER_FAILED_REASON_CODE,
  IR_FALLBACK_SKELETON_USED: IR_FALLBACK_SKELETON_REASON_CODE,
});
const AI_PARTIAL_USER_ACTIONS = Object.freeze({
  RUN_PARTIAL_SCENARIO: 'run_partial_scenario',
  REGENERATE: 'regenerate',
  VIEW_DIAGNOSTICS: 'view_diagnostics',
});

class AiGenerateTimeoutError extends Error {
  constructor(stage, code = AI_TIMEOUT_CODE.PRIMARY) {
    super(`AI generation deadline exceeded during ${stage}`);
    this.name = 'AiGenerateTimeoutError';
    this.code = code;
    this.timeoutCode = code;
    this.stage = stage;
  }
}

function irDiagnosticMessages(diagnostics) {
  return (diagnostics || []).map((d) => formatIrDiagnostic(d)).filter(Boolean);
}

function aiTimeRemainingMs(deadline) {
  return Math.max(0, Number(deadline?.expiresAt || 0) - Date.now());
}

function assertAiDeadline(deadline, stage) {
  if (deadline && aiTimeRemainingMs(deadline) <= 0) {
    throw new AiGenerateTimeoutError(stage, deadline.code);
  }
}

function withAiDeadline(promise, deadline, stage) {
  const remaining = aiTimeRemainingMs(deadline);
  if (remaining <= 0) return Promise.reject(new AiGenerateTimeoutError(stage, deadline?.code));
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new AiGenerateTimeoutError(stage, deadline?.code)), remaining);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function isAiTimeoutError(error) {
  return error instanceof AiGenerateTimeoutError || Object.values(AI_TIMEOUT_CODE).includes(error?.code);
}

function timeoutCodeForExecutionMode(mode) {
  if (mode === AI_EXECUTION_MODE.AI_RECOVERY) return AI_TIMEOUT_CODE.RECOVERY;
  if (mode === AI_EXECUTION_MODE.AI_PARTIAL) return AI_TIMEOUT_CODE.PARTIAL;
  return AI_TIMEOUT_CODE.PRIMARY;
}

function timeBudgetMsForExecutionMode(mode) {
  if (mode === AI_EXECUTION_MODE.AI_RECOVERY) return AI_RECOVERY_TIMEOUT_MS;
  if (mode === AI_EXECUTION_MODE.AI_PARTIAL) return AI_PARTIAL_TIMEOUT_MS;
  if (mode === AI_EXECUTION_MODE.FALLBACK_SKELETON) return 0;
  return AI_PRIMARY_TIMEOUT_MS;
}

function createAiModeDeadline(mode, startedAt = Date.now()) {
  return {
    mode,
    code: timeoutCodeForExecutionMode(mode),
    budgetMs: timeBudgetMsForExecutionMode(mode),
    expiresAt: startedAt + timeBudgetMsForExecutionMode(mode),
  };
}

function aiStageTimeoutMs(deadline, stage, maxMs = 2_500) {
  const remaining = aiTimeRemainingMs(deadline);
  if (remaining <= 500) throw new AiGenerateTimeoutError(stage, deadline?.code);
  return Math.max(500, Math.min(maxMs, remaining - 250));
}

function normalizeAiDiagnosticForResponse(item) {
  if (typeof item === 'string') return { code: 'IR_DIAGNOSTIC', message: item };
  if (!item || typeof item !== 'object') return { code: 'IR_DIAGNOSTIC', message: String(item) };
  return {
    code: item.code || item.type || 'IR_DIAGNOSTIC',
    message: item.message || formatIrDiagnostic(item) || String(item),
    path: item.path,
    severity: item.severity || 'error',
    details: item.details,
  };
}

function aiArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueAiCodes(values) {
  return [...new Set(aiArray(values).filter(Boolean).map((value) => String(value)))];
}

function aiSectionItem(code, title, detail, severity = 'info') {
  return { code, title, detail, severity };
}

function deriveAiRepairReasonCodes(repairActions = []) {
  const codes = new Set();
  for (const action of aiArray(repairActions)) {
    const text = String(action || '');
    if (/UNKNOWN_SYMBOL|invented symbol aliases/i.test(text)) {
      codes.add(AI_PARTIAL_REASON_CODES.UNKNOWN_SYMBOLS_REPLACED);
    }
    if (/EMPTY_BRANCH|non-empty executable bodies/i.test(text)) {
      codes.add(AI_PARTIAL_REASON_CODES.EMPTY_BRANCH_REMOVED);
    }
  }
  return [...codes];
}

function deriveAiReasonCodes({ reason, diagnostics = [], repairActions = [], meta = {} }) {
  const codes = new Set(deriveAiRepairReasonCodes(repairActions));
  const normalizedReason = String(reason || '');
  if (normalizedReason === 'IR_REPAIR_FAILED') {
    codes.add(AI_PARTIAL_REASON_CODES.IR_REPAIR_LIMIT_REACHED);
  }
  if (normalizedReason === IR_FALLBACK_REASON || meta?.fallbackKind === AI_IR_STATE.SKELETON) {
    codes.add(AI_PARTIAL_REASON_CODES.IR_FALLBACK_SKELETON_USED);
  }
  if (normalizedReason === 'IR_REPAIR_TIMEOUT' || /TIMEOUT/i.test(normalizedReason) || meta?.timeoutMs) {
    codes.add(AI_PARTIAL_REASON_CODES.TIMEOUT_FALLBACK);
  }
  if (meta?.fallbackFrom === 'IR_REPAIR_TIMEOUT') {
    codes.add(AI_PARTIAL_REASON_CODES.TIMEOUT_FALLBACK);
  }
  if (normalizedReason === IR_PRUNER_FAILED_REASON_CODE || meta?.fallbackFrom === IR_PRUNER_FAILED_REASON_CODE) {
    codes.add(AI_PARTIAL_REASON_CODES.IR_PRUNER_FAILED);
  }
  if (normalizedReason === AI_PRIMARY_PARTIAL_IR_AVAILABLE_CODE || meta?.primaryPartialIrAvailable) {
    codes.add(AI_PARTIAL_REASON_CODES.PRIMARY_PARTIAL_IR_AVAILABLE);
  }
  if (normalizedReason === AI_PRIMARY_NO_PARTIAL_IR_CODE || meta?.primaryNoPartialIr) {
    codes.add(AI_PARTIAL_REASON_CODES.PRIMARY_NO_PARTIAL_IR);
  }
  if (meta?.partialIrSalvaged) {
    codes.add(AI_PARTIAL_REASON_CODES.PARTIAL_IR_SALVAGED);
  }
  for (const diagnostic of aiArray(diagnostics)) {
    if (diagnostic?.code === IR_PRUNER_FAILED_REASON_CODE) {
      codes.add(AI_PARTIAL_REASON_CODES.IR_PRUNER_FAILED);
    }
    if (diagnostic?.code === AI_PRIMARY_PARTIAL_IR_AVAILABLE_CODE) {
      codes.add(AI_PARTIAL_REASON_CODES.PRIMARY_PARTIAL_IR_AVAILABLE);
    }
    if (diagnostic?.code === AI_PRIMARY_NO_PARTIAL_IR_CODE) {
      codes.add(AI_PARTIAL_REASON_CODES.PRIMARY_NO_PARTIAL_IR);
    }
    if (diagnostic?.code === AI_PARTIAL_IR_SALVAGED_CODE) {
      codes.add(AI_PARTIAL_REASON_CODES.PARTIAL_IR_SALVAGED);
    }
    if (diagnostic?.code === 'IR_REPAIR_TIMEOUT') {
      codes.add(AI_PARTIAL_REASON_CODES.TIMEOUT_FALLBACK);
    }
  }
  return uniqueAiCodes([...codes]);
}

function describeAiRepairAction(action) {
  const detail = String(action || '').trim();
  if (/skeleton fallback|SKELETON_IR|базовая версия/i.test(detail)) {
    return aiSectionItem(
      AI_PARTIAL_REASON_CODES.IR_FALLBACK_SKELETON_USED,
      'Skeleton IR fallback generated',
      detail,
      'info',
    );
  }
  if (/UNKNOWN_SYMBOL|invented symbol aliases/i.test(detail)) {
    return aiSectionItem(
      AI_PARTIAL_REASON_CODES.UNKNOWN_SYMBOLS_REPLACED,
      'Unknown symbols replaced',
      detail,
      'warning',
    );
  }
  if (/EMPTY_BRANCH|non-empty executable bodies/i.test(detail)) {
    return aiSectionItem(
      AI_PARTIAL_REASON_CODES.EMPTY_BRANCH_REMOVED,
      'Empty branch removed',
      detail,
      'warning',
    );
  }
  return aiSectionItem('IR_AUTO_REPAIR', 'Automatic IR repair', detail, 'info');
}

function summarizeAiValidIrParts(canonicalIr, classification) {
  if (!canonicalIr || typeof canonicalIr !== 'object') {
    return [
      aiSectionItem(
        AI_PARTIAL_REASON_CODES.IR_FALLBACK_SKELETON_USED,
        'Skeleton IR fallback generated',
        'Запущена базовая версия сценария (без сложной логики).',
        'info',
      ),
    ];
  }
  const handlers = aiArray(canonicalIr.handlers);
  const scenarios = aiArray(canonicalIr.scenarios);
  const uiStates = aiArray(canonicalIr.uiStates);
  const blocks = aiArray(canonicalIr.blocks);
  const works = [];
  if (canonicalIr.intent?.primary === 'skeleton_fallback' || classification.irState === AI_IR_STATE.SKELETON) {
    works.push(aiSectionItem(
      AI_PARTIAL_REASON_CODES.IR_FALLBACK_SKELETON_USED,
      'Skeleton IR fallback is executable',
      'Запущена базовая версия сценария (без сложной логики).',
      'info',
    ));
  }
  if (classification.hasEntryPoint) {
    works.push(aiSectionItem('ENTRY_POINT_VALID', 'Entry point found', 'The IR contains a /start or start handler.'));
  } else {
    works.push(aiSectionItem('ENTRY_POINT_MISSING', 'Entry point missing', 'No /start or start handler was found.', 'error'));
  }
  if (handlers.length > 0) {
    works.push(aiSectionItem('HANDLERS_COMPILED', 'Handlers compiled', `${handlers.length} trigger handler(s) are present in the IR.`));
  }
  if (scenarios.length > 0) {
    works.push(aiSectionItem('SCENARIOS_COMPILED', 'Scenarios compiled', `${scenarios.length} scenario(s) are present in the IR.`));
  }
  if (uiStates.length > 0) {
    works.push(aiSectionItem('UI_STATES_COMPILED', 'UI states compiled', `${uiStates.length} UI state(s) are available for transitions.`));
  }
  if (blocks.length > 0) {
    works.push(aiSectionItem('REUSABLE_BLOCKS_COMPILED', 'Reusable blocks compiled', `${blocks.length} block(s) are available.`));
  }
  return works.length > 0
    ? works
    : [aiSectionItem('IR_PRESENT', 'IR object recovered', 'A Canonical IR object was recovered, but it has no executable handlers yet.', 'warning')];
}

function buildAiDiagnosticSections({ canonicalIr, classification, warnings, repairActions, reason, reasonCodes }) {
  const whatWasFixed = aiArray(repairActions)
    .slice(0, AI_PARTIAL_DIAGNOSTIC_LIMIT)
    .map(describeAiRepairAction);
  const isSkeletonFallback = (
    classification.irState === AI_IR_STATE.SKELETON ||
    reasonCodes.includes(AI_PARTIAL_REASON_CODES.IR_FALLBACK_SKELETON_USED)
  );
  const failureDiagnostics = aiArray(warnings).filter((diagnostic) => (
    diagnostic?.severity !== 'info' &&
    diagnostic?.code !== AI_PARTIAL_REASON_CODES.IR_FALLBACK_SKELETON_USED
  ));
  const whatFailed = failureDiagnostics.map((diagnostic) => aiSectionItem(
    diagnostic.code || 'IR_DIAGNOSTIC',
    diagnostic.code || 'IR diagnostic',
    diagnostic.path ? `${diagnostic.path}: ${diagnostic.message}` : diagnostic.message,
    diagnostic.severity || 'error',
  ));
  if (whatFailed.length === 0 && reason && !isSkeletonFallback) {
    whatFailed.push(aiSectionItem(
      reason,
      'Generation stopped before final IR',
      `Reason: ${reasonCodes.length ? reasonCodes.join(', ') : reason}`,
      'warning',
    ));
  }
  return {
    whatWorks: summarizeAiValidIrParts(canonicalIr, classification),
    whatWasFixed,
    whatFailed,
  };
}

function buildAiUserActions({ partial, safeToRun, hasDiagnostics, hasStacks, executionMode }) {
  if (!partial) return [];
  if (executionMode === AI_EXECUTION_MODE.FALLBACK_SKELETON) {
    return [
      {
        id: AI_PARTIAL_USER_ACTIONS.RUN_PARTIAL_SCENARIO,
        label: 'run emergency scenario',
        enabled: Boolean(safeToRun && hasStacks),
        disabledReason: 'Emergency skeleton has no executable entry point.',
      },
      {
        id: AI_PARTIAL_USER_ACTIONS.VIEW_DIAGNOSTICS,
        label: 'view diagnostics',
        enabled: Boolean(hasDiagnostics),
      },
    ];
  }
  return [
    {
      id: AI_PARTIAL_USER_ACTIONS.RUN_PARTIAL_SCENARIO,
      label: 'run partial scenario',
      enabled: Boolean(safeToRun && hasStacks),
      disabledReason: safeToRun && !hasStacks
        ? 'No executable stacks were produced for this partial IR.'
        : 'Partial IR still has blocking diagnostics.',
    },
    { id: AI_PARTIAL_USER_ACTIONS.REGENERATE, label: 'regenerate', enabled: true },
    {
      id: AI_PARTIAL_USER_ACTIONS.VIEW_DIAGNOSTICS,
      label: 'view diagnostics',
      enabled: Boolean(hasDiagnostics),
    },
  ];
}

function inferAiExecutionMode({ classification, resultStatus, executionMode, eds }) {
  if (executionMode) return executionMode;
  if (classification.irState === AI_IR_STATE.SKELETON || resultStatus === AI_GENERATE_STATUS.FALLBACK_SKELETON) {
    return AI_EXECUTION_MODE.FALLBACK_SKELETON;
  }
  if (classification.irState === AI_IR_STATE.FINAL && resultStatus === AI_GENERATE_STATUS.SUCCESS) {
    return AI_EXECUTION_MODE.AI_PRIMARY;
  }
  if (eds) return executionModeFromEds(eds);
  return AI_EXECUTION_MODE.AI_PARTIAL;
}

function inferAiRootCause({ rootCause, reason, meta = {} }) {
  if (rootCause) return rootCause;
  const normalizedReason = String(reason || meta?.fallbackFrom || '');
  if (
    normalizedReason === 'IR_REPAIR_TIMEOUT' ||
    /TIMEOUT/i.test(normalizedReason) ||
    meta?.timeoutMs ||
    meta?.fallbackFrom === 'IR_REPAIR_TIMEOUT'
  ) {
    return AI_ROOT_CAUSE.AI_TIMEOUT;
  }
  if (
    normalizedReason === 'IR_REPAIR_FAILED' ||
    normalizedReason === 'RUNTIME_VALIDATION_FAILED' ||
    normalizedReason === 'PARSER_UNAVAILABLE'
  ) {
    return AI_ROOT_CAUSE.IR_REPAIR_FAILURE;
  }
  if (
    normalizedReason === IR_FALLBACK_REASON ||
    meta?.fallbackKind === AI_IR_STATE.SKELETON ||
    normalizedReason
  ) {
    return AI_ROOT_CAUSE.NO_VALID_IR;
  }
  return null;
}

function clampAiScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function inferAiConfidenceFromLlmChoice(choice) {
  if (!choice || typeof choice !== 'object') return null;
  const explicit = Number(choice.confidence ?? choice.message?.confidence);
  if (Number.isFinite(explicit)) return clampAiScore(explicit);
  const finishReason = String(choice.finish_reason || choice.finishReason || '').toLowerCase();
  if (finishReason === 'stop') return 0.75;
  if (finishReason === 'length') return 0.45;
  if (finishReason) return 0.6;
  return null;
}

function aiConfidenceLabel(score) {
  const n = clampAiScore(score);
  if (n > 0.8) return 'HIGH';
  if (n > 0.4) return 'MEDIUM';
  return 'LOW';
}

function aiConfidenceLabelForExecutionMode(mode) {
  if (mode === AI_EXECUTION_MODE.AI_PRIMARY) return 'HIGH';
  if (mode === AI_EXECUTION_MODE.FALLBACK_SKELETON) return 'LOW';
  return 'MEDIUM';
}

function calculateIrCompleteness(canonicalIr, diagnostics = []) {
  if (!canonicalIr || typeof canonicalIr !== 'object') return 0;
  const normalizedDiagnostics = diagnostics.map(normalizeAiDiagnosticForResponse);
  const handlers = aiArray(canonicalIr.handlers);
  const executableHandlers = handlers.filter((handler) => aiArray(handler?.actions).length > 0);
  const hasEntryPoint = hasAiIrEntryPoint(canonicalIr);
  const hasInvalidSymbols = normalizedDiagnostics.some((d) => d.code === 'UNKNOWN_SYMBOL');
  const hasBrokenTransitions = normalizedDiagnostics.some(
    (d) => d.code === 'INVALID_TRANSITION' || d.code === 'MISSING_UI_STATE',
  );
  const hasEmptyBranches = normalizedDiagnostics.some((d) => d.code === 'EMPTY_BRANCH');
  let convertible = false;
  try {
    convertible = canonicalIrToEditorStacks(canonicalIr).length > 0;
  } catch {
    convertible = false;
  }
  return clampAiScore(
    0.2 +
      (hasEntryPoint ? 0.25 : 0) +
      (executableHandlers.length > 0 ? 0.2 : 0) +
      (!hasInvalidSymbols && !hasBrokenTransitions ? 0.2 : 0) +
      (!hasEmptyBranches ? 0.1 : 0) +
      (convertible ? 0.05 : 0),
  );
}

function canUseNonPrimaryLlm(canonicalIr, diagnostics = []) {
  const completeness = calculateIrCompleteness(canonicalIr, diagnostics);
  return completeness < 0.2 && !hasExecutableIrHandlers(canonicalIr);
}

function buildExecutionDecisionScore({ canonicalIr, diagnostics = [], repairActions = [], meta = {} }) {
  const irCompleteness = calculateIrCompleteness(canonicalIr, diagnostics);
  const aiConfidence = Number.isFinite(Number(meta?.aiConfidence))
    ? clampAiScore(meta.aiConfidence)
    : 0.65;
  const repairAttempts = Math.max(
    Number(meta?.repairPasses || 0),
    aiArray(repairActions).filter((action) => /^pass\s+\d+:/i.test(String(action || ''))).length,
  );
  const timedOut = Boolean(meta?.timeoutMs || meta?.timedOut || meta?.fallbackFrom === 'IR_REPAIR_TIMEOUT');
  const weighted = {
    irCompleteness: Number((irCompleteness * 0.75).toFixed(4)),
    aiConfidence: Number((aiConfidence * 0.25).toFixed(4)),
  };
  const penalties = {
    repairAttempts: Number(Math.min(0.25, repairAttempts * 0.1).toFixed(4)),
    timeout: timedOut ? 0.2 : 0,
  };
  const score = clampAiScore(weighted.irCompleteness + weighted.aiConfidence - penalties.repairAttempts - penalties.timeout);
  return {
    score: Number(score.toFixed(4)),
    label: aiConfidenceLabel(score),
    inputs: {
      irCompleteness: Number(irCompleteness.toFixed(4)),
      repairAttempts,
      aiConfidence: Number(aiConfidence.toFixed(4)),
      timedOut,
    },
    weighted,
    penalties,
  };
}

function executionModeFromEds(eds) {
  const score = clampAiScore(eds?.score);
  if (score > 0.8) return AI_EXECUTION_MODE.AI_PRIMARY;
  if (score > 0.4) return AI_EXECUTION_MODE.AI_PARTIAL;
  return AI_EXECUTION_MODE.FALLBACK_SKELETON;
}

function statusForExecutionMode(mode, requestedStatus) {
  if (requestedStatus === AI_GENERATE_STATUS.FAILED && mode !== AI_EXECUTION_MODE.FALLBACK_SKELETON) {
    return AI_GENERATE_STATUS.FAILED;
  }
  if (mode === AI_EXECUTION_MODE.AI_PRIMARY) return AI_GENERATE_STATUS.SUCCESS;
  if (mode === AI_EXECUTION_MODE.FALLBACK_SKELETON) return AI_GENERATE_STATUS.FALLBACK_SKELETON;
  return AI_GENERATE_STATUS.PARTIAL_SUCCESS;
}

function hasRetryBudget(mode, attemptNumber) {
  const budget = AI_RETRY_BUDGET[mode] ?? 0;
  return Number(attemptNumber || 0) < budget;
}

function jsonByteSize(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return 0;
  }
}

function parseJsonObjectLoose(text) {
  const source = String(text || '').trim();
  if (!source) return null;
  const candidates = [
    source,
    source.replace(/,\s*([}\]])/g, '$1'),
  ];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      // try next candidate
    }
  }
  return null;
}

function completePartialJsonObject(raw) {
  const cleaned = stripThinkingFromAiRaw(String(raw || ''))
    .replace(/```(?:json|javascript|js)?\s*/gi, '')
    .replace(/```/g, '');
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  let out = '';
  const stack = [];
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    out += ch;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = inString;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if ((ch === '}' || ch === ']') && stack[stack.length - 1] === ch) stack.pop();
    if (stack.length === 0 && out.trim().endsWith('}')) break;
  }
  if (!out.trim()) return null;
  if (escaped) out = out.slice(0, -1);
  if (inString) out += '"';
  out = out.replace(/,\s*$/g, '');
  while (stack.length > 0) {
    const closer = stack.pop();
    out = out.replace(/,\s*$/g, '');
    out += closer;
  }
  return out;
}

function extractPrimaryPartialIrFromRaw(raw) {
  const extracted = extractAiCanonicalIrFromRaw(raw);
  if (extracted?.ir) return normalizeAiCanonicalIr(extracted.ir);
  const completed = completePartialJsonObject(raw);
  const parsed = parseJsonObjectLoose(completed);
  if (!parsed) return null;
  const unwrapped = parsed.ir || parsed.canonicalIr || parsed.runtimeGraph || parsed.result || parsed;
  if (!unwrapped || typeof unwrapped !== 'object' || Array.isArray(unwrapped)) return null;
  if (!Array.isArray(unwrapped.handlers) && !Array.isArray(unwrapped.blocks) && !Array.isArray(unwrapped.scenarios)) {
    return null;
  }
  return normalizeAiCanonicalIr(unwrapped);
}

function buildPrimaryPartialIrArtifact(raw, { source = AI_EXECUTION_MODE.AI_PRIMARY } = {}) {
  const ir = extractPrimaryPartialIrFromRaw(raw);
  if (!ir) return null;
  return {
    ir,
    completeness: calculateIrCompleteness(ir, []),
    source,
    partial: true,
    byteSize: jsonByteSize(ir),
  };
}

async function callAiPrimaryWithPartialSnapshots(messages, {
  attemptDeadline,
  max_tokens,
  temperature,
  onPartialIrArtifact,
}) {
  const controller = new AbortController();
  const remaining = aiTimeRemainingMs(attemptDeadline);
  if (remaining <= 0) throw new AiGenerateTimeoutError('llm-attempt-primary-start', attemptDeadline?.code);
  const timer = setTimeout(() => controller.abort(), remaining);
  let rawSoFar = '';
  let lastSnapshotKey = '';

  const persistSnapshot = () => {
    const artifact = buildPrimaryPartialIrArtifact(rawSoFar, { source: AI_EXECUTION_MODE.AI_PRIMARY });
    if (!artifact) return;
    const key = `${artifact.byteSize}:${artifact.completeness}:${jsonByteSize(artifact.ir.handlers)}:${jsonByteSize(artifact.ir.scenarios)}`;
    if (key === lastSnapshotKey) return;
    lastSnapshotKey = key;
    console.log(
      '[AI] PARTIAL_IR_SALVAGED:',
      JSON.stringify({
        code: AI_PARTIAL_IR_SALVAGED_CODE,
        source: artifact.source,
        partial: artifact.partial,
        completeness: artifact.completeness,
        byteSize: artifact.byteSize,
      }),
    );
    onPartialIrArtifact?.(artifact);
  };

  try {
    const data = await callGroq(messages, {
      max_tokens,
      temperature,
      stream: true,
      signal: controller.signal,
      onTextDelta: (delta, content) => {
        rawSoFar = content || `${rawSoFar}${delta || ''}`;
        persistSnapshot();
      },
    });
    rawSoFar = data.choices?.[0]?.message?.content || rawSoFar;
    persistSnapshot();
    return data;
  } catch (e) {
    persistSnapshot();
    if (e?.name === 'AbortError') {
      throw new AiGenerateTimeoutError('llm-attempt-primary-stream', attemptDeadline?.code);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function assertRecoveryArtifactForAiRecovery(artifact) {
  if (!artifact || artifact.irPruned !== true || !artifact.ir || typeof artifact.ir !== 'object') {
    const error = new Error('AI_RECOVERY requires a transformed IR_PRUNED artifact.');
    error.code = AI_RECOVERY_INVALID_INPUT;
    error.details = {
      artifactIrPruned: Boolean(artifact?.irPruned),
      hasArtifactIr: Boolean(artifact?.ir),
      sourceStage: artifact?.sourceStage || null,
    };
    throw error;
  }
  assertPrunedRecoveryIr(artifact.ir, IR_PRUNER_DEFAULTS);
  return true;
}

function buildIrPrunedArtifact({ sourceIr, sourceArtifact, sourceStage = AI_EXECUTION_MODE.AI_PRIMARY }) {
  const inputArtifact = sourceArtifact && typeof sourceArtifact === 'object' ? sourceArtifact : null;
  const inputIr = inputArtifact?.ir || sourceIr;
  const inputStage = inputArtifact?.source || sourceStage;
  if (!inputIr || typeof inputIr !== 'object') {
    console.warn(
      '[AI] IR_PRUNER_FAILED:',
      JSON.stringify({
        code: IR_PRUNER_FAILED_REASON_CODE,
        sourceStage: inputStage,
        partialArtifact: Boolean(inputArtifact?.partial),
        message: 'No source IR artifact available for AI_RECOVERY handoff.',
      }),
    );
    return {
      ok: false,
      errorCode: IR_PRUNER_FAILED_REASON_CODE,
      diagnostics: [{
        code: IR_PRUNER_FAILED_REASON_CODE,
        severity: 'error',
        message: 'IR_PRUNER could not run because no PRIMARY partial IR snapshot was available.',
      }],
      repairActions: ['PRUNER: no source IR artifact available for AI_RECOVERY handoff'],
    };
  }

  try {
    const pruning = pruneIrForRecovery(inputIr, IR_PRUNER_DEFAULTS);
    const artifact = {
      ir: pruning.ir,
      irPruned: true,
      pruningReductionRatio: pruning.pruningReductionRatio,
      sourceStage: inputStage,
      sourcePartial: Boolean(inputArtifact?.partial),
      sourceCompleteness: Number(inputArtifact?.completeness ?? calculateIrCompleteness(inputIr, [])),
    };
    assertRecoveryArtifactForAiRecovery(artifact);
    const artifactByteSize = jsonByteSize(artifact);
    const enrichedPruning = {
      ...pruning,
      artifactByteSize,
      artifactSourceStage: inputStage,
      sourcePartial: artifact.sourcePartial,
      sourceCompleteness: artifact.sourceCompleteness,
    };
    console.log(
      '[AI] IR_PRUNED_CREATED:',
      JSON.stringify({
        code: 'IR_PRUNED_CREATED',
        pruningReductionRatio: pruning.pruningReductionRatio,
        artifactByteSize,
        sourceStage: inputStage,
        sourcePartial: artifact.sourcePartial,
        sourceCompleteness: artifact.sourceCompleteness,
        handoff: `${inputStage}->PARTIAL_IR_SNAPSHOTS->PRUNER->${AI_EXECUTION_MODE.AI_RECOVERY}`,
        beforeNodeCount: pruning.beforeNodeCount,
        afterNodeCount: pruning.afterNodeCount,
      }),
    );
    return {
      ok: true,
      artifact,
      pruning: enrichedPruning,
      diagnostics: [{
        code: 'IR_PRUNED_CREATED',
        severity: 'info',
        message:
          `IR_PRUNED_CREATED pruningReductionRatio=${pruning.pruningReductionRatio} ` +
          `artifactByteSize=${artifactByteSize} sourcePartial=${artifact.sourcePartial}`,
      }],
      repairActions: [`PRUNER: created IR_PRUNED artifact from ${inputStage}`],
    };
  } catch (e) {
    console.warn(
      '[AI] IR_PRUNER_FAILED:',
      JSON.stringify({
        code: IR_PRUNER_FAILED_REASON_CODE,
        sourceStage: inputStage,
        partialArtifact: Boolean(inputArtifact?.partial),
        message: e?.message || String(e),
        details: e?.details || null,
      }),
    );
    return {
      ok: false,
      errorCode: IR_PRUNER_FAILED_REASON_CODE,
      diagnostics: [{
        code: IR_PRUNER_FAILED_REASON_CODE,
        severity: 'error',
        message: e?.message || 'IR_PRUNER could not create an IR_PRUNED artifact.',
        details: e?.details,
      }],
      repairActions: [`PRUNER: failed to create IR_PRUNED artifact from ${inputStage}`],
    };
  }
}

function hasAiIrEntryPoint(ir) {
  return (ir?.handlers || []).some(
    (handler) =>
      handler?.type === 'start' ||
      (handler?.type === 'command' && String(handler?.trigger || '').replace(/^\/+/, '') === 'start'),
  );
}

function classifyAiIrState({ canonicalIr, diagnostics = [], final = false }) {
  const normalizedDiagnostics = diagnostics.map(normalizeAiDiagnosticForResponse);
  const hasIr = Boolean(canonicalIr && typeof canonicalIr === 'object');
  const hasEntryPoint = hasIr && hasAiIrEntryPoint(canonicalIr);
  const hasInvalidSymbols = normalizedDiagnostics.some((d) => d.code === 'UNKNOWN_SYMBOL');
  const hasBrokenTransitions = normalizedDiagnostics.some(
    (d) => d.code === 'INVALID_TRANSITION' || d.code === 'MISSING_UI_STATE',
  );
  const hasEmptyBranches = normalizedDiagnostics.some((d) => d.code === 'EMPTY_BRANCH');
  const hasBlockingDiagnostics = hasInvalidSymbols || hasBrokenTransitions || hasEmptyBranches || !hasEntryPoint;
  const safeToExecute = Boolean(hasIr && hasEntryPoint && !hasInvalidSymbols && !hasBrokenTransitions && !hasEmptyBranches);
  const isSkeleton = canonicalIr?.intent?.primary === 'skeleton_fallback';

  if (isSkeleton) {
    return {
      irState: AI_IR_STATE.SKELETON,
      validity: 'skeleton',
      safeToExecute: Boolean(hasEntryPoint),
      nextAction: null,
      hasEntryPoint,
      hasInvalidSymbols,
      hasBrokenTransitions,
      hasEmptyBranches,
    };
  }

  if (final && hasIr && hasEntryPoint && !hasBlockingDiagnostics) {
    return {
      irState: AI_IR_STATE.FINAL,
      validity: 'final',
      safeToExecute: true,
      nextAction: null,
      hasEntryPoint,
      hasInvalidSymbols: false,
      hasBrokenTransitions: false,
      hasEmptyBranches: false,
    };
  }

  if (!hasIr || hasInvalidSymbols || hasBrokenTransitions || !hasEntryPoint) {
    return {
      irState: AI_IR_STATE.INVALID,
      validity: 'invalid',
      safeToExecute: false,
      nextAction: hasIr ? AI_NEXT_ACTION.RETRY : AI_NEXT_ACTION.FALLBACK_TEMPLATE,
      hasEntryPoint,
      hasInvalidSymbols,
      hasBrokenTransitions,
      hasEmptyBranches,
    };
  }

  return {
    irState: AI_IR_STATE.PARTIAL,
    validity: 'partial',
    safeToExecute,
    nextAction: safeToExecute && !hasBlockingDiagnostics
      ? AI_NEXT_ACTION.USE_WITH_CAUTION
      : AI_NEXT_ACTION.RETRY,
    hasEntryPoint,
    hasInvalidSymbols,
    hasBrokenTransitions,
    hasEmptyBranches,
  };
}

function buildAiGenerationResult({
  status,
  reason,
  canonicalIr,
  diagnostics,
  repairActions,
  meta,
  final = false,
  safeToRun,
  stacks,
  executionMode,
  rootCause,
  executionDecisionScore,
}) {
  const warnings = (diagnostics || [])
    .slice(0, AI_PARTIAL_DIAGNOSTIC_LIMIT)
    .map(normalizeAiDiagnosticForResponse);
  const classification = classifyAiIrState({ canonicalIr, diagnostics: warnings, final });
  const initialStatus = status || (
    classification.irState === AI_IR_STATE.FINAL
      ? AI_GENERATE_STATUS.SUCCESS
      : (classification.irState === AI_IR_STATE.PARTIAL ? AI_GENERATE_STATUS.PARTIAL_SUCCESS : AI_GENERATE_STATUS.FAILED)
  );
  const responseDecisionScore = executionDecisionScore || buildExecutionDecisionScore({
    canonicalIr,
    diagnostics: warnings,
    repairActions,
    meta,
  });
  const responseExecutionMode = inferAiExecutionMode({
    classification,
    resultStatus: initialStatus,
    executionMode,
    eds: responseDecisionScore,
  });
  const resultStatus = statusForExecutionMode(responseExecutionMode, initialStatus);
  const partial = resultStatus !== AI_GENERATE_STATUS.SUCCESS;
  const responseSafeToRun = typeof safeToRun === 'boolean' ? safeToRun : classification.safeToExecute;
  const responseRootCause = inferAiRootCause({ rootCause, reason, meta });
  const isFallbackSkeleton = responseExecutionMode === AI_EXECUTION_MODE.FALLBACK_SKELETON;
  const responseConfidenceLabel = aiConfidenceLabelForExecutionMode(responseExecutionMode);
  console.log(
    '[AI] execution decision:',
    JSON.stringify({
      mode: responseExecutionMode,
      status: resultStatus,
      reason: reason || null,
      eds: responseDecisionScore,
    }),
  );
  const reasonCodes = deriveAiReasonCodes({
    reason,
    diagnostics: warnings,
    repairActions,
    meta,
  });
  const diagnosticSections = buildAiDiagnosticSections({
    canonicalIr,
    classification,
    warnings,
    repairActions,
    reason,
    reasonCodes,
  });
  const hasDiagnostics = (
    diagnosticSections.whatWorks.length +
    diagnosticSections.whatWasFixed.length +
    diagnosticSections.whatFailed.length
  ) > 0;
  const responseStacks = Array.isArray(stacks) ? stacks : null;

  return {
    status: resultStatus,
    reason: reason || null,
    reasonCodes,
    ir: canonicalIr || null,
    canonicalIr: canonicalIr || null,
    irState: classification.irState,
    validity: classification.validity,
    executionMode: responseExecutionMode,
    executionDecisionScore: responseDecisionScore,
    aiConfidence: responseDecisionScore.inputs.aiConfidence,
    aiConfidenceLabel: responseConfidenceLabel,
    rootCause: responseRootCause,
    isDegraded: responseExecutionMode !== AI_EXECUTION_MODE.AI_PRIMARY,
    isAIGenerated: responseExecutionMode !== AI_EXECUTION_MODE.FALLBACK_SKELETON,
    warnings,
    diagnostics: warnings,
    safeToRun: responseSafeToRun,
    safeToExecute: responseSafeToRun,
    nextAction: classification.nextAction,
    partial,
    repairActions: (repairActions || []).slice(0, AI_PARTIAL_DIAGNOSTIC_LIMIT),
    diagnosticSections,
    userActions: buildAiUserActions({
      partial,
      safeToRun: responseSafeToRun,
      hasDiagnostics,
      hasStacks: Boolean(responseStacks?.length),
      executionMode: responseExecutionMode,
    }),
    meta: {
      ...(meta || {}),
      hasEntryPoint: classification.hasEntryPoint,
      hasInvalidSymbols: classification.hasInvalidSymbols,
      hasBrokenTransitions: classification.hasBrokenTransitions,
      hasEmptyBranches: classification.hasEmptyBranches,
      executionMode: responseExecutionMode,
      executionDecisionScore: responseDecisionScore,
      aiConfidence: responseDecisionScore.inputs.aiConfidence,
      aiConfidenceLabel: responseConfidenceLabel,
      rootCause: responseRootCause,
      isDegraded: responseExecutionMode !== AI_EXECUTION_MODE.AI_PRIMARY,
      isAIGenerated: !isFallbackSkeleton,
    },
    ...(responseStacks ? { stacks: responseStacks } : {}),
  };
}

function fallbackSourceDiagnostics(diagnostics = []) {
  return aiArray(diagnostics)
    .slice(0, Math.max(0, AI_PARTIAL_DIAGNOSTIC_LIMIT - 1))
    .map((item) => {
      const diagnostic = normalizeAiDiagnosticForResponse(item);
      return {
        code: 'IR_FALLBACK_SOURCE_DIAGNOSTIC',
        severity: diagnostic.severity === 'error' ? 'warning' : diagnostic.severity,
        path: diagnostic.path,
        details: diagnostic.details,
        message: `[${diagnostic.code}] ${diagnostic.message}`,
      };
    });
}

function buildAiSkeletonFallbackResponse({
  fallbackFrom,
  prompt,
  sourceIr,
  diagnostics,
  repairActions,
  meta,
}) {
  const sourceDecisionScore = buildExecutionDecisionScore({
    canonicalIr: sourceIr,
    diagnostics,
    repairActions,
    meta,
  });
  const sourceRootCause = inferAiRootCause({ reason: fallbackFrom, meta });
  console.warn(
    '[AI] FALLBACK_SKELETON selected:',
    JSON.stringify({
      fallbackFrom: fallbackFrom || null,
      rootCause: sourceRootCause,
      eds: sourceDecisionScore,
      retryBudget: AI_RETRY_BUDGET,
    }),
  );
  const skeletonIr = buildIrSkeletonFallback({ prompt, reason: fallbackFrom || IR_FALLBACK_REASON });
  const skeletonValidation = validateIrSemanticGate(skeletonIr);
  const skeletonStacks = canonicalIrToEditorStacks(skeletonIr);
  const hasEntryPoint = hasAiIrEntryPoint(skeletonIr);
  const fallbackDiagnostics = [
    {
      code: AI_PARTIAL_REASON_CODES.IR_FALLBACK_SKELETON_USED,
      severity: 'info',
      message: 'Запущен аварийный режим (без AI логики).',
    },
    ...fallbackSourceDiagnostics(diagnostics),
  ];

  return buildAiGenerationResult({
    status: AI_GENERATE_STATUS.FALLBACK_SKELETON,
    reason: IR_FALLBACK_REASON,
    canonicalIr: skeletonIr,
    diagnostics: fallbackDiagnostics,
    repairActions: [
      ...(repairActions || []),
      `${AI_IR_STATE.SKELETON}: generated executable skeleton fallback`,
    ],
    safeToRun: Boolean(hasEntryPoint),
    executionMode: AI_EXECUTION_MODE.FALLBACK_SKELETON,
    rootCause: sourceRootCause,
    executionDecisionScore: sourceDecisionScore,
    stacks: skeletonStacks,
    meta: {
      ...(meta || {}),
      fallbackKind: AI_IR_STATE.SKELETON,
      fallbackFrom: fallbackFrom || null,
      fallbackLoopBlocked: true,
      fallbackDecisionScore: sourceDecisionScore,
      fallbackReason: `EDS ${sourceDecisionScore.score} <= 0.4 after retry budget exhaustion`,
      executionMode: AI_EXECUTION_MODE.FALLBACK_SKELETON,
      skeletonValidationOk: skeletonValidation.ok,
      skeletonDiagnostics: skeletonValidation.diagnostics || [],
    },
  });
}

function buildAiPartialResponse({
  errorCode,
  canonicalIr,
  diagnostics,
  repairActions,
  meta,
  safeToRun,
  prompt,
  executionMode = AI_EXECUTION_MODE.AI_PARTIAL,
  allowSkeletonFallback = false,
}) {
  const response = buildAiGenerationResult({
    status: canonicalIr ? AI_GENERATE_STATUS.PARTIAL_SUCCESS : AI_GENERATE_STATUS.FAILED,
    reason: errorCode,
    canonicalIr,
    diagnostics,
    repairActions,
    meta,
    safeToRun,
    executionMode,
  });
  if (allowSkeletonFallback && response.executionMode === AI_EXECUTION_MODE.FALLBACK_SKELETON) {
    return buildAiSkeletonFallbackResponse({
      fallbackFrom: errorCode,
      prompt,
      sourceIr: canonicalIr,
      diagnostics,
      repairActions,
      meta,
    });
  }
  if (!response.safeToRun || !canonicalIr) return response;
  try {
    const stacks = canonicalIrToEditorStacks(canonicalIr);
    if (Array.isArray(stacks) && stacks.length > 0) {
      return {
        ...response,
        stacks,
        userActions: buildAiUserActions({
          partial: response.partial,
          safeToRun: response.safeToRun,
          hasDiagnostics: true,
          hasStacks: true,
          executionMode: response.executionMode,
        }),
      };
    }
  } catch (e) {
    console.warn('[AI] partial IR could not be converted to stacks:', e?.message || e);
  }
  return response;
}

function runDeterministicIrRepairLoop(ir, options = {}) {
  let current = normalizeAiCanonicalIr(ir);
  const repairNotes = [];
  const graphDiagnostics = [];
  const maxRepairPasses = Math.min(
    AI_IR_REPAIR_MAX_PASSES,
    Math.max(0, Number(options.maxRepairPasses ?? AI_IR_REPAIR_MAX_PASSES) || 0),
  );
  for (let repairPass = 0; repairPass <= maxRepairPasses; repairPass += 1) {
    const reconciliation = reconcileIrGraph(current, options);
    current = normalizeAiCanonicalIr(reconciliation.ir);
    if (reconciliation.changed || reconciliation.diagnostics.length) {
      graphDiagnostics.push(...reconciliation.diagnostics);
      repairNotes.push(...reconciliation.notes.map((note) => `pass ${repairPass}: GRAPH_RECONCILER: ${note}`));
      console.log(
        `[AI] IR graph reconciliation pass ${repairPass}/${maxRepairPasses}: ` +
          `changed=${reconciliation.changed} unresolved=${reconciliation.unresolvedDiagnostics.length}`,
      );
    }
    assertAiDeadline(options.deadline, `ir-validate-${repairPass}`);
    const validation = validateIrSemanticGate(current, options);
    const mergedDiagnostics = {
      ...validation,
      diagnostics: [...graphDiagnostics, ...aiArray(validation.diagnostics)],
    };
    const messages = irDiagnosticMessages(validation.diagnostics);
    console.log(
      `[AI] IR validation iteration ${repairPass}/${maxRepairPasses}: ` +
        `ok=${validation.ok} errors=${messages.length}` +
        (messages.length ? ` :: ${messages.slice(0, 6).join(' | ')}` : ''),
    );
    if (validation.ok) return { ok: true, ir: current, validation: mergedDiagnostics, repairNotes };
    if (repairPass === maxRepairPasses) return { ok: false, ir: current, validation: mergedDiagnostics, repairNotes };
    assertAiDeadline(options.deadline, `ir-repair-${repairPass + 1}`);
    const repaired = repairIrDeterministic(current, validation.diagnostics, options);
    repairNotes.push(...repaired.notes.map((note) => `pass ${repairPass + 1}: ${note}`));
    console.log(
      `[AI] IR repair pass ${repairPass + 1}/${maxRepairPasses}: ` +
        `changed=${repaired.changed} actions=${repaired.notes.length}` +
        (repaired.notes.length ? ` :: ${repaired.notes.slice(0, 8).join(' | ')}` : ''),
    );
    current = normalizeAiCanonicalIr(repaired.ir);
    if (!repaired.changed) return { ok: false, ir: current, validation: mergedDiagnostics, repairNotes };
  }
  const reconciliation = reconcileIrGraph(current, options);
  current = normalizeAiCanonicalIr(reconciliation.ir);
  if (reconciliation.changed || reconciliation.diagnostics.length) {
    graphDiagnostics.push(...reconciliation.diagnostics);
    repairNotes.push(...reconciliation.notes.map((note) => `final: GRAPH_RECONCILER: ${note}`));
  }
  const validation = validateIrSemanticGate(current, options);
  return {
    ok: validation.ok,
    ir: current,
    validation: { ...validation, diagnostics: [...graphDiagnostics, ...aiArray(validation.diagnostics)] },
    repairNotes,
  };
}

function validateGeneratedAiDsl(dslFromStacks, options = {}) {
  const deadline = options.deadline;
  assertAiDeadline(deadline, 'dsl-validation-start');
  const unsupportedDslComments = findUnsupportedDslBlockComments(dslFromStacks);
  if (unsupportedDslComments.length > 0) {
    return {
      ok: false,
      retryable: true,
      diagnostics: unsupportedDslComments.map((row) => ({
        code: 'UNSUPPORTED_DSL_BLOCK',
        message: `стр.${row.line}: ${row.text}`,
      })),
    };
  }

  const schemaErrs = lintDSLSchema(dslFromStacks).filter((d) => d.severity === 'error');
  assertAiDeadline(deadline, 'dsl-schema-validation');
  if (schemaErrs.length > 0) {
    return {
      ok: false,
      retryable: true,
      diagnostics: schemaErrs.map((d) => ({
        code: d.code || 'DSL_SCHEMA_ERROR',
        message: formatDSLDiagnostic(d),
      })),
    };
  }

  try {
    requireParsedDSL(dslFromStacks, {
      timeoutMs: aiStageTimeoutMs(deadline, 'dsl-parser-validation'),
    });
  } catch (parserErr) {
    return {
      ok: false,
      retryable: !parserErr.parserUnavailable,
      parserUnavailable: Boolean(parserErr.parserUnavailable),
      diagnostics: (parserErr.diagnostics || []).length
        ? parserErr.diagnostics
        : [{ code: parserErr.parserUnavailable ? 'PARSER_UNAVAILABLE' : 'PARSER_REJECTED', message: parserErr.message }],
      error: parserErr,
    };
  }

  assertAiDeadline(deadline, 'runtime-parity-validation');
  const parity = runAiDslValidationPipeline({
    rawAiText: dslFromStacks,
    cwd: process.cwd(),
    skipSemantic: true,
    skipProjectGraph: true,
    syntaxTimeoutMs: aiStageTimeoutMs(deadline, 'runtime-parity-syntax'),
  });
  if (!parity.ok) {
    return {
      ok: false,
      retryable: true,
      diagnostics: parity.diagnostics || [],
    };
  }

  return { ok: true, diagnostics: [] };
}

function runtimeDiagnosticsForPrompt(result) {
  return (result?.diagnostics || [])
    .slice(0, 10)
    .map((d) => `[${d.code || 'RUNTIME_VALIDATION'}] ${d.message || String(d)}`);
}

async function tryAiRecoveryGeneration({
  recoveryArtifact,
  pruning,
  diagnostics = [],
  repairActions = [],
  astMode,
  allowedMemoryKeys,
  failureReason,
  responseMeta,
  intentPlan,
}) {
  const recoveryStartedAt = Date.now();
  const recoveryDeadline = createAiModeDeadline(AI_EXECUTION_MODE.AI_RECOVERY, recoveryStartedAt);
  assertRecoveryArtifactForAiRecovery(recoveryArtifact);
  const sourceIr = recoveryArtifact.ir;
  const recoveryInputSource = `${recoveryArtifact.sourceStage || 'UNKNOWN'}->PRUNER`;
  const artifactByteSize = pruning?.artifactByteSize ?? jsonByteSize(recoveryArtifact);
  const sourceCompleteness = Number(recoveryArtifact.sourceCompleteness ?? calculateIrCompleteness(sourceIr, diagnostics));
  const sourceExecutableHandlers = hasExecutableIrHandlers(sourceIr);
  const llmAllowedByPolicy = sourceCompleteness < 0.2 && !sourceExecutableHandlers;
  console.log(
    '[AI] AI_RECOVERY_INPUT:',
    JSON.stringify({
      recoveryInputSource,
      artifactByteSize,
      pruningReductionRatio: recoveryArtifact.pruningReductionRatio ?? sourceIr.meta?.pruningReductionRatio ?? 0,
      sourcePartial: Boolean(recoveryArtifact.sourcePartial),
      sourceCompleteness,
      sourceExecutableHandlers,
      llmAllowedByPolicy,
      llmUsed: false,
    }),
  );
  const recoveryRepairActions = [
    ...aiArray(repairActions),
    ...aiArray(pruning?.notes),
    `${AI_EXECUTION_MODE.AI_RECOVERY}: deterministic transform pipeline over IR_PRUNED snapshot with graph reconciliation`,
  ];
  const recoveryDiagnostics = [
    ...aiArray(diagnostics),
    {
      code: 'AI_RECOVERY_STARTED',
      severity: 'info',
      message: 'Запускаю deterministic recovery pipeline без LLM.',
    },
    {
      code: 'IR_PRUNED_CREATED',
      severity: 'info',
      message:
        `IR_PRUNED=true pruningReductionRatio=${recoveryArtifact.pruningReductionRatio ?? sourceIr.meta?.pruningReductionRatio ?? 0} ` +
        `artifactByteSize=${artifactByteSize} recoveryInputSource=${recoveryInputSource}`,
    },
    {
      code: 'RECOVERY_NO_LLM_REQUIRED',
      severity: 'info',
      message:
        'AI_RECOVERY выполняется через deterministic IR graph transforms; full LLM generation не используется.',
      details: {
        sourceCompleteness,
        sourceExecutableHandlers,
        llmAllowedByPolicy,
        llmUsed: false,
      },
    },
  ];

  try {
    assertAiDeadline(recoveryDeadline, 'ai-recovery-start');
    console.log(
      `[AI] ${AI_EXECUTION_MODE.AI_RECOVERY} deterministic pipeline, ` +
        `remainingMs=${aiTimeRemainingMs(recoveryDeadline)} input=${recoveryInputSource}`,
    );

    const transformed = runDeterministicRecoveryPipeline(sourceIr, {
      astMode,
      allowedMemoryKeys,
      intentPlan,
      maxConditionDepth: IR_PRUNER_DEFAULTS.maxDepth,
    });
    let candidate = transformed.ir;
    const allRepairActions = [
      ...recoveryRepairActions,
      ...aiArray(transformed.notes).map((note) => `${AI_EXECUTION_MODE.AI_RECOVERY}: ${note}`),
    ];
    const transformDiagnostics = [
      ...recoveryDiagnostics,
      {
        code: 'RECOVERY_TRANSFORM_APPLIED',
        severity: 'info',
        message:
          `Applied deterministic recovery passes: ${transformed.appliedPasses.length ? transformed.appliedPasses.join(', ') : 'none'}.`,
        details: { appliedPasses: transformed.appliedPasses },
      },
      ...aiArray(transformed.diagnostics),
      ...(transformed.graphPatched
        ? [{
          code: 'RECOVERY_GRAPH_PATCHED',
          severity: 'info',
          message: 'Recovery patched missing graph transitions/callback handlers deterministically.',
        }]
        : []),
    ];

    const structuralValidation = validateAiCanonicalIr(candidate, { astMode, allowedMemoryKeys });
    if (structuralValidation.errors.length > 0) {
      return {
        ok: false,
        errorCode: 'AI_RECOVERY_INVALID',
        sourceIr: candidate,
        diagnostics: [
          ...transformDiagnostics,
          ...structuralValidation.errors.map((message) => ({ code: 'IR_STRUCTURE_ERROR', message })),
        ],
        repairActions: allRepairActions,
      };
    }

    const repaired = runDeterministicIrRepairLoop(candidate, {
      astMode,
      allowedMemoryKeys,
      deadline: recoveryDeadline,
      maxRepairPasses: 1,
    });
    candidate = repaired.ir;
    const repairNotes = [...allRepairActions, ...repaired.repairNotes];
    if (!transformed.ok || !repaired.ok) {
      return {
        ok: false,
        errorCode: 'AI_RECOVERY_REPAIR_FAILED',
        sourceIr: candidate,
        diagnostics: [
          ...transformDiagnostics,
          ...aiArray(transformed.diagnostics),
          ...aiArray(repaired.validation?.diagnostics),
        ],
        repairActions: repairNotes,
      };
    }

    const stacks = canonicalIrToEditorStacks(candidate);
    assertAiDeadline(recoveryDeadline, 'ai-recovery-dsl-generation');
    const dslFromStacks = generateDSL(stacks);
    const runtimeValidation = validateGeneratedAiDsl(dslFromStacks, { deadline: recoveryDeadline });
    if (!runtimeValidation.ok) {
      return {
        ok: false,
        errorCode: runtimeValidation.parserUnavailable ? 'AI_RECOVERY_PARSER_UNAVAILABLE' : 'AI_RECOVERY_RUNTIME_FAILED',
        sourceIr: candidate,
        diagnostics: [
          ...transformDiagnostics,
          ...aiArray(runtimeValidation.diagnostics),
        ],
        repairActions: repairNotes,
      };
    }

    return {
      ok: true,
      response: buildAiGenerationResult({
        status: AI_GENERATE_STATUS.PARTIAL_SUCCESS,
        reason: failureReason,
        canonicalIr: candidate,
        diagnostics: transformDiagnostics,
        repairActions: repairNotes,
        meta: responseMeta({
          aiRecoveryAttempted: true,
          aiRecoverySucceeded: true,
          aiRecoveryLlmUsed: false,
          aiRecoveryLlmAllowedByPolicy: llmAllowedByPolicy,
          aiRecoveryElapsedMs: Date.now() - recoveryStartedAt,
          aiRecoveryBudgetMs: recoveryDeadline.budgetMs,
          IR_PRUNED: true,
          irPruned: true,
          recoveryPipeline: 'PRUNED_IR->DETERMINISTIC_REPAIR_PASSES->GRAPH_RECONCILER->PARTIAL_IR',
          recoveryAppliedPasses: transformed.appliedPasses,
          recoveryGraphPatched: transformed.graphPatched,
          pruningReductionRatio: recoveryArtifact.pruningReductionRatio ?? sourceIr.meta?.pruningReductionRatio ?? 0,
          recoveryInputSource,
          recoveryArtifactByteSize: artifactByteSize,
          recoveryArtifactSourceStage: recoveryArtifact.sourceStage || null,
          recoverySourcePartial: Boolean(recoveryArtifact.sourcePartial),
          recoverySourceCompleteness: sourceCompleteness,
          recoveredFrom: failureReason,
          executionMode: AI_EXECUTION_MODE.AI_RECOVERY,
        }),
        final: true,
        safeToRun: true,
        stacks,
        executionMode: AI_EXECUTION_MODE.AI_RECOVERY,
      }),
    };
  } catch (e) {
    const code = isAiTimeoutError(e) ? AI_TIMEOUT_CODE.RECOVERY : `AI_RECOVERY_${e?.llmKind || 'ERROR'}`;
    console.warn('[AI] AI_RECOVERY failed:', e?.message || e);
    return {
      ok: false,
      errorCode: code,
      sourceIr,
      diagnostics: [
        ...recoveryDiagnostics,
        {
          code,
          message: e?.message || 'AI recovery deterministic transform failed.',
        },
      ],
      repairActions: recoveryRepairActions,
    };
  }
}

async function buildAiRecoveryOrFallbackResponse({
  errorCode,
  canonicalIr,
  diagnostics,
  repairActions,
  meta,
  safeToRun,
  prompt,
  astMode,
  allowedMemoryKeys,
  responseMeta,
  sourceStage = AI_EXECUTION_MODE.AI_PRIMARY,
  recoverySourceArtifact,
  intentPlan,
}) {
  const recoveryIntentPlan = intentPlan || intentPlanner(prompt || '');
  const canInjectSemanticTemplate = recoveryIntentPlan?.knownCapabilityTemplate === SEMANTIC_TEMPLATE_IDS.CALCULATOR;
  const buildSemanticTemplateRecoveryResponse = (fallbackFrom, sourceDiagnostics = [], sourceRepairActions = [], extraMeta = {}) => {
    const budgetedTemplateIr = applyIntentBudgetToIr(
      buildSemanticTemplateIr(recoveryIntentPlan, { prompt }),
      recoveryIntentPlan,
    ).ir;
    const templateResolution = resolveFeatureDependencies(budgetedTemplateIr, {
      intentPlan: recoveryIntentPlan,
      astMode,
      allowedMemoryKeys,
    });
    const templateIr = templateResolution.ir;
    const templateStacks = canonicalIrToEditorStacks(templateIr);
    return buildAiGenerationResult({
      status: AI_GENERATE_STATUS.PARTIAL_SUCCESS,
      reason: fallbackFrom,
      canonicalIr: templateIr,
      diagnostics: [
        ...aiArray(sourceDiagnostics),
        ...templateResolution.diagnostics,
        {
          code: 'INTENT_NOT_SATISFIED',
          severity: 'warning',
          message: 'Original IR could not satisfy calculator intent; deterministic calculator template was injected.',
        },
        {
          code: 'MISSING_REQUIRED_CAPABILITY',
          severity: 'warning',
          message: 'Calculator intent requires arithmetic evaluation capability; generic text fallback is blocked.',
        },
      ].slice(0, AI_PARTIAL_DIAGNOSTIC_LIMIT),
      repairActions: [
        ...aiArray(sourceRepairActions),
        ...templateResolution.repairActions.map((action) => `FDR: ${action}`),
        'ISV: injected calculator semantic template during recovery',
        'ISV: blocked generic text fallback for calculator intent',
      ].slice(0, AI_PARTIAL_DIAGNOSTIC_LIMIT),
      meta: responseMeta({
        ...(meta || {}),
        ...extraMeta,
        aiRecoveryAttempted: true,
        aiRecoverySucceeded: true,
        intentTemplateRecovery: true,
        semanticTemplate: recoveryIntentPlan.knownCapabilityTemplate,
        executionMode: AI_EXECUTION_MODE.AI_RECOVERY,
      }),
      final: true,
      safeToRun: true,
      stacks: templateStacks,
      executionMode: AI_EXECUTION_MODE.AI_RECOVERY,
    });
  };
  const hasPartialRecoveryArtifact = Boolean(recoverySourceArtifact?.partial && recoverySourceArtifact?.ir);
  const sourceIrForRecovery = recoverySourceArtifact?.ir || canonicalIr;
  const prunedHandoff = buildIrPrunedArtifact({
    sourceIr: sourceIrForRecovery,
    sourceArtifact: recoverySourceArtifact,
    sourceStage,
  });
  if (!prunedHandoff.ok) {
    const prunerDiagnostics = [
      ...aiArray(diagnostics),
      ...aiArray(prunedHandoff.diagnostics),
    ].slice(0, AI_PARTIAL_DIAGNOSTIC_LIMIT);
    const prunerRepairActions = [
      ...aiArray(repairActions),
      ...aiArray(prunedHandoff.repairActions),
    ].slice(0, AI_PARTIAL_DIAGNOSTIC_LIMIT);
    if (canInjectSemanticTemplate) {
      return buildSemanticTemplateRecoveryResponse(
        IR_PRUNER_FAILED_REASON_CODE,
        prunerDiagnostics,
        prunerRepairActions,
        {
          aiRecoverySkippedReason: IR_PRUNER_FAILED_REASON_CODE,
          recoveryInputSource: `${sourceStage}->PRUNER`,
          recoveryArtifactSourceStage: sourceStage,
        },
      );
    }
    if (hasPartialRecoveryArtifact) {
      return buildAiPartialResponse({
        errorCode: IR_PRUNER_FAILED_REASON_CODE,
        canonicalIr: recoverySourceArtifact.ir,
        diagnostics: prunerDiagnostics,
        repairActions: prunerRepairActions,
        meta: responseMeta({
          ...(meta || {}),
          aiRecoveryAttempted: false,
          aiRecoverySkippedReason: IR_PRUNER_FAILED_REASON_CODE,
          recoveryInputSource: `${recoverySourceArtifact.source}->PARTIAL_IR_SNAPSHOTS->PRUNER`,
          primaryPartialIrAvailable: true,
          partialIrSalvaged: true,
          primaryPartialCompleteness: recoverySourceArtifact.completeness,
        }),
        safeToRun: false,
        prompt,
        executionMode: AI_EXECUTION_MODE.AI_PARTIAL,
        allowSkeletonFallback: false,
      });
    }
    return buildAiSkeletonFallbackResponse({
      fallbackFrom: IR_PRUNER_FAILED_REASON_CODE,
      prompt,
      sourceIr: sourceIrForRecovery,
      diagnostics: prunerDiagnostics,
      repairActions: prunerRepairActions,
      meta: responseMeta({
        ...(meta || {}),
        aiRecoveryAttempted: false,
        aiRecoverySkippedReason: IR_PRUNER_FAILED_REASON_CODE,
        primaryNoPartialIr: true,
        recoveryInputSource: `${sourceStage}->PRUNER`,
        recoveryArtifactSourceStage: sourceStage,
      }),
    });
  }

  let recovery;
  try {
    recovery = await tryAiRecoveryGeneration({
      recoveryArtifact: prunedHandoff.artifact,
      pruning: prunedHandoff.pruning,
      diagnostics,
      repairActions: [
        ...aiArray(repairActions),
        ...aiArray(prunedHandoff.repairActions),
      ],
      astMode,
      allowedMemoryKeys,
      failureReason: errorCode,
      responseMeta,
      intentPlan: recoveryIntentPlan,
    });
  } catch (e) {
    if (e?.code !== AI_RECOVERY_INVALID_INPUT) throw e;
    console.warn('[AI] AI_RECOVERY input contract blocked:', JSON.stringify(e.details || {}));
    recovery = {
      ok: false,
      errorCode: IR_PRUNER_FAILED_REASON_CODE,
      sourceIr: prunedHandoff.artifact?.ir || null,
      diagnostics: [{
        code: IR_PRUNER_FAILED_REASON_CODE,
        message: e.message || 'AI_RECOVERY requires an IR_PRUNED artifact.',
        details: e.details,
      }],
      repairActions: aiArray(repairActions),
    };
  }

  if (recovery.ok) return recovery.response;

  const recoveryMeta = responseMeta({
    ...(meta || {}),
    aiRecoveryAttempted: true,
    aiRecoverySucceeded: false,
    aiRecoveryFailureReason: recovery.errorCode,
    aiRecoveryBudgetMs: AI_RECOVERY_TIMEOUT_MS,
    IR_PRUNED: true,
    irPruned: true,
    pruningReductionRatio: prunedHandoff.artifact.pruningReductionRatio,
    recoveryInputSource: `${prunedHandoff.artifact.sourceStage}->PRUNER`,
    recoveryArtifactByteSize: prunedHandoff.pruning.artifactByteSize,
    recoveryArtifactSourceStage: prunedHandoff.artifact.sourceStage,
    recoverySourcePartial: prunedHandoff.artifact.sourcePartial,
    recoverySourceCompleteness: prunedHandoff.artifact.sourceCompleteness,
  });
  const combinedDiagnostics = [
    ...aiArray(diagnostics),
    ...aiArray(recovery.diagnostics),
  ].slice(0, AI_PARTIAL_DIAGNOSTIC_LIMIT);
  const combinedRepairActions = [
    ...aiArray(repairActions),
    ...aiArray(recovery.repairActions),
  ].slice(0, AI_PARTIAL_DIAGNOSTIC_LIMIT);
  const partialIr = recovery.sourceIr || prunedHandoff.artifact.ir;
  const recoveryTimedOut = recovery.errorCode === AI_TIMEOUT_CODE.RECOVERY;

  if (canInjectSemanticTemplate) {
    return buildSemanticTemplateRecoveryResponse(
      recovery.errorCode || errorCode,
      combinedDiagnostics,
      combinedRepairActions,
      {
        aiRecoveryFailureReason: recovery.errorCode,
        IR_PRUNED: true,
        irPruned: true,
        pruningReductionRatio: prunedHandoff.artifact.pruningReductionRatio,
        recoveryInputSource: `${prunedHandoff.artifact.sourceStage}->PRUNER`,
        recoveryArtifactByteSize: prunedHandoff.pruning.artifactByteSize,
        recoveryArtifactSourceStage: prunedHandoff.artifact.sourceStage,
        recoverySourcePartial: prunedHandoff.artifact.sourcePartial,
        recoverySourceCompleteness: prunedHandoff.artifact.sourceCompleteness,
      },
    );
  }

  if (recovery.errorCode === IR_PRUNER_FAILED_REASON_CODE) {
    if (hasPartialRecoveryArtifact) {
      return buildAiPartialResponse({
        errorCode: IR_PRUNER_FAILED_REASON_CODE,
        canonicalIr: partialIr,
        diagnostics: combinedDiagnostics,
        repairActions: combinedRepairActions,
        meta: recoveryMeta,
        safeToRun: false,
        prompt,
        executionMode: AI_EXECUTION_MODE.AI_PARTIAL,
        allowSkeletonFallback: false,
      });
    }
    return buildAiSkeletonFallbackResponse({
      fallbackFrom: IR_PRUNER_FAILED_REASON_CODE,
      prompt,
      sourceIr: partialIr,
      diagnostics: combinedDiagnostics,
      repairActions: combinedRepairActions,
      meta: recoveryMeta,
    });
  }

  if (recoveryTimedOut) {
    if (hasPartialRecoveryArtifact) {
      return buildAiPartialResponse({
        errorCode,
        canonicalIr: partialIr,
        diagnostics: combinedDiagnostics.length
          ? combinedDiagnostics
          : [{ code: recovery.errorCode, message: 'AI_RECOVERY exceeded reduced budget.' }],
        repairActions: combinedRepairActions,
        meta: recoveryMeta,
        safeToRun: false,
        prompt,
        executionMode: AI_EXECUTION_MODE.AI_PARTIAL,
        allowSkeletonFallback: false,
      });
    }
    return buildAiSkeletonFallbackResponse({
      fallbackFrom: recovery.errorCode,
      prompt,
      sourceIr: partialIr,
      diagnostics: combinedDiagnostics.length
        ? combinedDiagnostics
        : [{ code: recovery.errorCode, message: 'AI_RECOVERY exceeded reduced budget.' }],
      repairActions: combinedRepairActions,
      meta: recoveryMeta,
    });
  }

  if (partialIr) {
    return buildAiPartialResponse({
      errorCode,
      canonicalIr: partialIr,
      diagnostics: combinedDiagnostics,
      repairActions: combinedRepairActions,
      meta: recoveryMeta,
      safeToRun,
      prompt,
      executionMode: AI_EXECUTION_MODE.AI_PARTIAL,
      allowSkeletonFallback: false,
    });
  }

  return buildAiPartialResponse({
    errorCode,
    canonicalIr: null,
    diagnostics: combinedDiagnostics.length
      ? combinedDiagnostics
      : [{ code: recovery.errorCode || errorCode, message: 'AI_RECOVERY could not complete IR.' }],
    repairActions: combinedRepairActions,
    meta: recoveryMeta,
    safeToRun: false,
    prompt,
    executionMode: AI_EXECUTION_MODE.AI_PARTIAL,
    allowSkeletonFallback: false,
  });
}


function findUnsupportedDslBlockComments(dsl) {
  return String(dsl || '')
    .split('\n')
    .map((line, idx) => ({ line: idx + 1, text: line.trim() }))
    .filter((row) => /^#\s*блок\s+/.test(row.text));
}

function sendAiGenerateError(res, authUser, status, adminMessage) {
  return res.status(status).json({
    status: AI_GENERATE_STATUS.FAILED,
    reason: 'AI_GENERATE_ERROR',
    error: authUser?.role === 'admin' ? adminMessage : AI_GENERATE_PUBLIC_ERROR,
  });
}

app.post('/api/ai-generate', requireUserAuth, aiGenerateRateLimit, async (req, res) => {
  const authUser = await findById(req.authUserId);
  if (!authUser) return res.status(401).json({ status: AI_GENERATE_STATUS.FAILED, reason: 'AUTH_REQUIRED', error: 'Необходима авторизация' });
  if (!isProUser(authUser)) {
    return res.status(403).json({
      status: AI_GENERATE_STATUS.FAILED,
      reason: 'PRO_REQUIRED',
      error: 'AI-генерация доступна только с активной подпиской PRO.',
    });
  }

  const { prompt } = req.body;
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
    return res.status(400).json({ status: AI_GENERATE_STATUS.FAILED, reason: 'PROMPT_TOO_SHORT', error: 'Опиши своего бота подробнее' });
  }
  const promptText = prompt.trim();
  if (promptText.length > AI_PROMPT_MAX_CHARS) {
    return res.status(400).json({
      status: AI_GENERATE_STATUS.FAILED,
      reason: 'PROMPT_TOO_LONG',
      error: `Запрос должен быть не длиннее ${AI_PROMPT_MAX_CHARS} символов`,
    });
  }
  const startedAt = Date.now();
  const primaryDeadline = createAiModeDeadline(AI_EXECUTION_MODE.AI_PRIMARY, startedAt);
  let lastIrSnapshot = null;
  let lastValidIrSnapshot = null;
  let lastDiagnostics = [];
  let lastRepairActions = [];
  let lastAttempt = 0;
  let lastAiConfidence = null;
  let latestPrimaryPartialIrArtifact = null;
  const astMode = getAiAstMode();
  const allowedMemoryKeys = getAiAllowedMemoryKeys();
  const intentPlan = intentPlanner(promptText);
  const intentDiagnostics = [
    {
      code: 'INTENT_PLAN_CREATED',
      severity: 'info',
      message:
        `IntentPlan created: botType=${intentPlan.botType}, complexity=${intentPlan.complexityScore}.`,
      details: {
        botType: intentPlan.botType,
        requiredFeatures: intentPlan.requiredFeatures,
        complexityScore: intentPlan.complexityScore,
        budget: intentPlan.budget,
      },
    },
    {
      code: 'MINIMAL_GRAPH_GENERATED',
      severity: 'info',
      message:
        `MinimalExecutionGraph generated with ${intentPlan.minimalExecutionGraph.nodes.length} nodes and ` +
        `${intentPlan.minimalExecutionGraph.edges.length} edges.`,
      details: intentPlan.minimalExecutionGraph,
    },
  ];
  let intentPipelineDiagnostics = [...intentDiagnostics];
  const withIntentDiagnostics = (items = []) => [
    ...intentPipelineDiagnostics,
    ...aiArray(items),
  ].slice(0, AI_PARTIAL_DIAGNOSTIC_LIMIT);
  const systemContent =
    AI_SYSTEM_PROMPT +
    buildAiCoreContextAppendix() +
    buildIrSymbolRegistryPromptContext({ allowedMemoryKeys }) +
    buildIntentPlanPromptContext(intentPlan) +
    serverAiAstPolicyAppendix(astMode, allowedMemoryKeys);
  const responseMeta = (extra = {}) => ({
    attempts: lastAttempt,
    elapsedMs: Date.now() - startedAt,
    retryBudget: AI_RETRY_BUDGET,
    timeBudgetTiers: AI_TIME_BUDGET_TIERS,
    timeBudgetMs: {
      [AI_EXECUTION_MODE.AI_PRIMARY]: AI_PRIMARY_TIMEOUT_MS,
      [AI_EXECUTION_MODE.AI_RECOVERY]: AI_RECOVERY_TIMEOUT_MS,
      [AI_EXECUTION_MODE.AI_PARTIAL]: AI_PARTIAL_TIMEOUT_MS,
      [AI_EXECUTION_MODE.FALLBACK_SKELETON]: 0,
    },
    intentPlan: {
      botType: intentPlan.botType,
      requiredFeatures: intentPlan.requiredFeatures,
      complexityScore: intentPlan.complexityScore,
      budget: intentPlan.budget,
    },
    minimalExecutionGraph: intentPlan.minimalExecutionGraph,
    ...(lastAiConfidence != null ? { aiConfidence: lastAiConfidence } : {}),
    ...extra,
  });
  const persistLatestPrimaryPartialIrArtifact = (artifact) => {
    if (!artifact?.ir || artifact.source !== AI_EXECUTION_MODE.AI_PRIMARY) return;
    latestPrimaryPartialIrArtifact = artifact;
    lastIrSnapshot = artifact.ir;
  };
  try {
    const maxAttempts = Math.min(AI_LLM_MAX_ATTEMPTS, AI_RETRY_BUDGET[AI_EXECUTION_MODE.AI_PRIMARY]);

    const initialMessages = [
      { role: 'system', content: systemContent },
      { role: 'user', content: IR_FEW_SHOT_USER },
      { role: 'assistant', content: IR_FEW_SHOT_ASSISTANT },
      { role: 'user', content: IR_FEW_SHOT_USER_2 },
      { role: 'assistant', content: IR_FEW_SHOT_ASSISTANT_2 },
      { role: 'user', content: buildIntentPlannedUserPrompt(promptText, intentPlan) },
    ];

    const messages = [...initialMessages];
    let stacks = null;
    let canonicalIr = null;
    let lastRaw = '';
    let lastAstErrors = [];

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      lastAttempt = attempt + 1;
      const attemptMode = attempt === 0 ? AI_EXECUTION_MODE.AI_PRIMARY : AI_EXECUTION_MODE.AI_PARTIAL;
      const attemptDeadline = attempt === 0
        ? primaryDeadline
        : createAiModeDeadline(AI_EXECUTION_MODE.AI_PARTIAL);
      assertAiDeadline(attemptDeadline, `llm-attempt-${lastAttempt}-start`);
      const data = attemptMode === AI_EXECUTION_MODE.AI_PRIMARY
        ? await callAiPrimaryWithPartialSnapshots(messages, {
          attemptDeadline,
          max_tokens: 4000,
          temperature: 0.25,
          onPartialIrArtifact: persistLatestPrimaryPartialIrArtifact,
        })
        : await withAiDeadline(
          callGroq(messages, {
            max_tokens: 1800,
            temperature: 0.12,
          }),
          attemptDeadline,
          `llm-attempt-${lastAttempt}`,
        );
      if (attemptMode === AI_EXECUTION_MODE.AI_PRIMARY) aiPrimaryTimeoutStreak = 0;
      lastAiConfidence = inferAiConfidenceFromLlmChoice(data.choices?.[0]);
      lastRaw = data.choices?.[0]?.message?.content || '';
      console.log(
        `[AI] ${attemptMode} LLM attempt ${lastAttempt}/${maxAttempts}, ` +
          `budgetMs=${attemptDeadline.budgetMs} remainingMs=${aiTimeRemainingMs(attemptDeadline)}, raw (first 300):`,
        lastRaw.slice(0, 300),
      );

      const extracted = extractAiCanonicalIrFromRaw(lastRaw);
      if (!extracted) {
        lastDiagnostics = withIntentDiagnostics([{ code: 'IR_EXTRACTION_FAILED', message: 'AI response did not contain Canonical IR JSON' }]);
        if (
          attempt < maxAttempts - 1 &&
          hasRetryBudget(AI_EXECUTION_MODE.AI_PARTIAL, attempt) &&
          canUseNonPrimaryLlm(lastIrSnapshot, lastDiagnostics)
        ) {
          messages.push({ role: 'assistant', content: lastRaw.slice(0, 12000) });
          messages.push({ role: 'user', content: buildNonJsonRepairPrompt() });
          continue;
        }
        const cleaned = stripThinkingFromAiRaw(lastRaw);
        console.error('AI вернул не Canonical IR после очистки:', cleaned.slice(0, 400));
        return res.json(await buildAiRecoveryOrFallbackResponse({
          errorCode: 'IR_EXTRACTION_FAILED',
          canonicalIr: lastIrSnapshot,
          diagnostics: lastDiagnostics,
          repairActions: lastRepairActions,
          meta: responseMeta(),
          prompt: prompt.trim(),
          systemContent,
          astMode,
          allowedMemoryKeys,
          responseMeta,
          sourceStage: attemptMode,
        }));
      }

      let candidate = normalizeAiCanonicalIr(extracted.ir);
      const budgeted = applyIntentBudgetToIr(candidate, intentPlan);
      candidate = budgeted.ir;
      if (budgeted.changed) {
        const complexityDiagnostic = {
          code: 'COMPLEXITY_REDUCED',
          severity: 'info',
          message:
            `IR reduced to ${intentPlan.complexityScore} complexity budget: ${budgeted.notes.join('; ') || 'budget enforced'}.`,
          details: {
            complexityScore: intentPlan.complexityScore,
            budget: intentPlan.budget,
            notes: budgeted.notes,
          },
        };
        intentPipelineDiagnostics = [...intentDiagnostics, complexityDiagnostic];
        lastRepairActions = [
          ...lastRepairActions,
          ...budgeted.notes.map((note) => `INTENT_PLAN: ${note}`),
        ];
      }
      const intentRepair = repairIntentSatisfaction(candidate, {
        prompt: promptText,
        intentPlan,
      });
      if (intentRepair.changed) {
        candidate = applyIntentBudgetToIr(intentRepair.ir, intentPlan).ir;
        intentPipelineDiagnostics = [
          ...intentPipelineDiagnostics,
          ...intentRepair.diagnostics,
        ].slice(0, AI_PARTIAL_DIAGNOSTIC_LIMIT);
        lastRepairActions = [
          ...lastRepairActions,
          ...intentRepair.repairNotes,
        ];
      }
      const featureResolution = resolveFeatureDependencies(candidate, {
        intentPlan,
        astMode,
        allowedMemoryKeys,
      });
      candidate = featureResolution.ir;
      if (featureResolution.diagnostics.length) {
        intentPipelineDiagnostics = [
          ...intentPipelineDiagnostics,
          ...featureResolution.diagnostics,
        ].slice(0, AI_PARTIAL_DIAGNOSTIC_LIMIT);
      }
      if (featureResolution.changed) {
        lastRepairActions = [
          ...lastRepairActions,
          ...featureResolution.repairActions.map((action) => `FDR: ${action}`),
        ];
      }
      lastIrSnapshot = candidate;
      if (!candidate || typeof candidate !== 'object') {
        lastAstErrors = ['Ожидался JSON-объект Canonical AI IR'];
        lastDiagnostics = withIntentDiagnostics(lastAstErrors.map((message) => ({ code: 'IR_STRUCTURE_ERROR', message })));
        if (
          attempt < maxAttempts - 1 &&
          hasRetryBudget(AI_EXECUTION_MODE.AI_PARTIAL, attempt) &&
          canUseNonPrimaryLlm(lastIrSnapshot, lastDiagnostics)
        ) {
          messages.push({ role: 'assistant', content: lastRaw.slice(0, 12000) });
          messages.push({ role: 'user', content: buildIrRepairUserPrompt(lastAstErrors, '{}') });
          continue;
        }
        return res.json(await buildAiRecoveryOrFallbackResponse({
          errorCode: 'IR_INVALID',
          canonicalIr: lastIrSnapshot,
          diagnostics: lastDiagnostics,
          repairActions: lastRepairActions,
          meta: responseMeta(),
          prompt: prompt.trim(),
          systemContent,
          astMode,
          allowedMemoryKeys,
          responseMeta,
          sourceStage: attemptMode,
        }));
      }

      const structuralValidation = validateAiCanonicalIr(candidate, { astMode, allowedMemoryKeys });
      lastAstErrors = structuralValidation.errors;
      lastDiagnostics = withIntentDiagnostics(lastAstErrors.map((message) => ({ code: 'IR_STRUCTURE_ERROR', message })));
      if (lastAstErrors.length > 0) {
        console.error('[AI] Canonical IR structure:', lastAstErrors.join(' | '));
        if (
          attempt < maxAttempts - 1 &&
          hasRetryBudget(AI_EXECUTION_MODE.AI_PARTIAL, attempt) &&
          canUseNonPrimaryLlm(candidate, lastDiagnostics)
        ) {
          messages.push({ role: 'assistant', content: lastRaw.slice(0, 12000) });
          messages.push({
            role: 'user',
            content: buildIrRepairUserPrompt(lastAstErrors, JSON.stringify(candidate).slice(0, 14000)),
          });
          continue;
        }
        return res.json(await buildAiRecoveryOrFallbackResponse({
          errorCode: 'IR_INVALID',
          canonicalIr: lastIrSnapshot,
          diagnostics: lastDiagnostics,
          repairActions: lastRepairActions,
          meta: responseMeta(),
          prompt: prompt.trim(),
          systemContent,
          astMode,
          allowedMemoryKeys,
          responseMeta,
          sourceStage: attemptMode,
        }));
      }

      lastValidIrSnapshot = candidate;
      const repaired = runDeterministicIrRepairLoop(candidate, {
        astMode,
        allowedMemoryKeys,
        deadline: attemptDeadline,
        maxRepairPasses: AI_IR_REPAIR_MAX_PASSES,
      });
      lastIrSnapshot = repaired.ir;
      lastDiagnostics = withIntentDiagnostics(repaired.validation?.diagnostics || []);
      lastRepairActions = [...lastRepairActions, ...repaired.repairNotes];
      if (!repaired.ok) {
        const semanticErrors = irDiagnosticMessages(repaired.validation.diagnostics);
        console.error('[AI] IR semantic gate:', semanticErrors.join(' | '));
        if (
          attempt < maxAttempts - 1 &&
          hasRetryBudget(AI_EXECUTION_MODE.AI_PARTIAL, attempt) &&
          canUseNonPrimaryLlm(repaired.ir, repaired.validation.diagnostics)
        ) {
          messages.push({ role: 'assistant', content: JSON.stringify(repaired.ir).slice(0, 12000) });
          messages.push({
            role: 'user',
            content: buildIrRepairUserPrompt(
              semanticErrors.length ? semanticErrors : ['IR semantic repair failed'],
              JSON.stringify(repaired.ir).slice(0, 14000),
            ),
          });
          continue;
        }
        return res.json(await buildAiRecoveryOrFallbackResponse({
          errorCode: 'IR_REPAIR_FAILED',
          canonicalIr: repaired.ir,
          diagnostics: lastDiagnostics,
          repairActions: lastRepairActions,
          meta: {
            repairPasses: AI_IR_REPAIR_MAX_PASSES,
            ...responseMeta(),
          },
          prompt: prompt.trim(),
          systemContent,
          astMode,
          allowedMemoryKeys,
          responseMeta,
          sourceStage: attemptMode,
        }));
      }

      if (repaired.repairNotes.length > 0) {
        console.log('[AI] deterministic IR repair:', repaired.repairNotes.join(' | '));
      }

      canonicalIr = repaired.ir;
      lastValidIrSnapshot = canonicalIr;
      stacks = canonicalIrToEditorStacks(canonicalIr);

      assertAiDeadline(attemptDeadline, 'dsl-generation');
      const dslFromStacks = generateDSL(stacks);
      const runtimeValidation = validateGeneratedAiDsl(dslFromStacks, { deadline: attemptDeadline });
      if (!runtimeValidation.ok) {
        const runtimeErrors = runtimeDiagnosticsForPrompt(runtimeValidation);
        lastDiagnostics = withIntentDiagnostics(runtimeValidation.diagnostics || []);
        console.error('[AI] Runtime validation rejected generated DSL:', runtimeErrors.join(' | '));
        if (runtimeValidation.parserUnavailable) {
          return res.json(await buildAiRecoveryOrFallbackResponse({
            errorCode: 'PARSER_UNAVAILABLE',
            canonicalIr,
            prompt: prompt.trim(),
            diagnostics: lastDiagnostics,
            repairActions: lastRepairActions,
            meta: responseMeta(),
            systemContent,
            astMode,
            allowedMemoryKeys,
            responseMeta,
            sourceStage: attemptMode,
          }));
        }
        if (
          attempt < maxAttempts - 1 &&
          runtimeValidation.retryable !== false &&
          hasRetryBudget(AI_EXECUTION_MODE.AI_PARTIAL, attempt) &&
          canUseNonPrimaryLlm(canonicalIr, runtimeValidation.diagnostics)
        ) {
          messages.push({ role: 'assistant', content: JSON.stringify(canonicalIr).slice(0, 12000) });
          messages.push({
            role: 'user',
            content: buildIrRepairUserPrompt(
              runtimeErrors.length ? runtimeErrors : ['Runtime validation rejected generated DSL'],
              JSON.stringify(canonicalIr).slice(0, 14000),
            ),
          });
          stacks = null;
          canonicalIr = null;
          continue;
        }
        return res.json(await buildAiRecoveryOrFallbackResponse({
          errorCode: 'RUNTIME_VALIDATION_FAILED',
          canonicalIr,
          diagnostics: lastDiagnostics,
          repairActions: lastRepairActions,
          meta: responseMeta(),
          safeToRun: false,
          prompt: prompt.trim(),
          systemContent,
          astMode,
          allowedMemoryKeys,
          responseMeta,
          sourceStage: attemptMode,
        }));
      }

      break;
    }

    if (!stacks) {
      return res.json(await buildAiRecoveryOrFallbackResponse({
        errorCode: 'IR_INVALID',
        canonicalIr: lastIrSnapshot,
        diagnostics: lastDiagnostics,
        repairActions: lastRepairActions,
        meta: responseMeta(),
        prompt: prompt.trim(),
        systemContent,
        astMode,
        allowedMemoryKeys,
        responseMeta,
        sourceStage: lastAttempt > 1 ? AI_EXECUTION_MODE.AI_PARTIAL : AI_EXECUTION_MODE.AI_PRIMARY,
      }));
    }

    res.json({
      ...buildAiGenerationResult({
        status: AI_GENERATE_STATUS.SUCCESS,
        reason: null,
        canonicalIr,
        diagnostics: intentPipelineDiagnostics,
        repairActions: lastRepairActions,
        meta: responseMeta(),
        final: true,
        stacks,
      }),
    });

  } catch (e) {
    if (isAiTimeoutError(e)) {
      if (e?.code === AI_TIMEOUT_CODE.PRIMARY) aiPrimaryTimeoutStreak += 1;
      const elapsedMs = Date.now() - startedAt;
      const skipFullRetry = e?.code === AI_TIMEOUT_CODE.PRIMARY && aiPrimaryTimeoutStreak < 2;
      const primaryTimedOut = e?.code === AI_TIMEOUT_CODE.PRIMARY;
      const primaryPartialArtifact = primaryTimedOut ? latestPrimaryPartialIrArtifact : null;
      const primaryPartialDiagnostics = primaryTimedOut
        ? (primaryPartialArtifact
          ? [
            {
              code: AI_PRIMARY_PARTIAL_IR_AVAILABLE_CODE,
              severity: 'info',
              message: `PRIMARY timeout preserved partial IR artifact with completeness=${primaryPartialArtifact.completeness}.`,
            },
            {
              code: AI_PARTIAL_IR_SALVAGED_CODE,
              severity: 'info',
              message: 'Latest parseable AI_PRIMARY partial IR was salvaged for PRUNER/RECOVERY.',
            },
          ]
          : [{
            code: AI_PRIMARY_NO_PARTIAL_IR_CODE,
            severity: 'warning',
            message: 'AI_PRIMARY timed out before any parseable partial IR snapshot was available.',
          }])
        : [];
      console.error(
        `[AI] ${e.code || 'AI_TIMEOUT'} stage=${e.stage || 'unknown'} ` +
          `attempts=${lastAttempt} elapsedMs=${elapsedMs} diagnostics=${lastDiagnostics.length}` +
          (primaryPartialArtifact ? ` partialIrCompleteness=${primaryPartialArtifact.completeness}` : '') +
          (skipFullRetry ? ' performanceGuard=skip_full_primary_retry' : ''),
      );
      return res.json(await buildAiRecoveryOrFallbackResponse({
        errorCode: primaryPartialArtifact ? AI_PRIMARY_PARTIAL_IR_AVAILABLE_CODE : (e.code || AI_TIMEOUT_CODE.PRIMARY),
        canonicalIr: primaryPartialArtifact?.ir || lastValidIrSnapshot || lastIrSnapshot,
        diagnostics: [
          ...primaryPartialDiagnostics,
          ...(lastDiagnostics.length
            ? lastDiagnostics
            : [{ code: e.code || 'AI_TIMEOUT', message: 'AI generation exceeded time budget.' }]),
        ],
        repairActions: lastRepairActions,
        meta: responseMeta({
          timeoutMs: timeBudgetMsForExecutionMode(
            e?.code === AI_TIMEOUT_CODE.PARTIAL ? AI_EXECUTION_MODE.AI_PARTIAL : AI_EXECUTION_MODE.AI_PRIMARY,
          ),
          timedOut: true,
          timeoutCode: e.code,
          stage: e.stage,
          primaryTimeoutStreak: aiPrimaryTimeoutStreak,
          performanceGuard: skipFullRetry ? 'skip_full_primary_retry' : null,
          primaryPartialIrAvailable: Boolean(primaryPartialArtifact),
          primaryNoPartialIr: primaryTimedOut && !primaryPartialArtifact,
          partialIrSalvaged: Boolean(primaryPartialArtifact),
          primaryPartialCompleteness: primaryPartialArtifact?.completeness ?? null,
        }),
        prompt: prompt.trim(),
        systemContent,
        astMode,
        allowedMemoryKeys,
        responseMeta,
        sourceStage: e?.code === AI_TIMEOUT_CODE.PARTIAL ? AI_EXECUTION_MODE.AI_PARTIAL : AI_EXECUTION_MODE.AI_PRIMARY,
        recoverySourceArtifact: primaryPartialArtifact || undefined,
      }));
    }
    const kind = e?.llmKind;
    if (kind === 'NETWORK') {
      console.error('POST /api/ai-generate', e.message);
      return res.json(await buildAiRecoveryOrFallbackResponse({
        errorCode: 'AI_NETWORK_ERROR',
        canonicalIr: lastValidIrSnapshot || lastIrSnapshot,
        prompt: prompt.trim(),
        diagnostics: [{ code: 'AI_NETWORK_ERROR', message: e.message }],
        repairActions: lastRepairActions,
        meta: responseMeta(),
        systemContent,
        astMode,
        allowedMemoryKeys,
        responseMeta,
        sourceStage: lastAttempt > 1 ? AI_EXECUTION_MODE.AI_PARTIAL : AI_EXECUTION_MODE.AI_PRIMARY,
      }));
    }
    if (kind === 'RATE_LIMIT') {
      console.error('POST /api/ai-generate', e.message);
      return res.json(await buildAiRecoveryOrFallbackResponse({
        errorCode: 'AI_RATE_LIMIT',
        canonicalIr: lastValidIrSnapshot || lastIrSnapshot,
        prompt: prompt.trim(),
        diagnostics: [{ code: 'AI_RATE_LIMIT', message: e.message }],
        repairActions: lastRepairActions,
        meta: responseMeta(),
        systemContent,
        astMode,
        allowedMemoryKeys,
        responseMeta,
        sourceStage: lastAttempt > 1 ? AI_EXECUTION_MODE.AI_PARTIAL : AI_EXECUTION_MODE.AI_PRIMARY,
      }));
    }
    if (kind === 'API' || kind === 'BAD_RESPONSE') {
      console.error('POST /api/ai-generate', e.message);
      return res.json(await buildAiRecoveryOrFallbackResponse({
        errorCode: `AI_${kind}`,
        canonicalIr: lastValidIrSnapshot || lastIrSnapshot,
        prompt: prompt.trim(),
        diagnostics: [{
          code: `AI_${kind}`,
          message:
            `Провайдер ИИ вернул ошибку. Проверьте ${llmConfigHint()} и лимиты. ` +
            (e.message?.length < 400 ? e.message : ''),
        }],
        repairActions: lastRepairActions,
        meta: responseMeta(),
        systemContent,
        astMode,
        allowedMemoryKeys,
        responseMeta,
        sourceStage: lastAttempt > 1 ? AI_EXECUTION_MODE.AI_PARTIAL : AI_EXECUTION_MODE.AI_PRIMARY,
      }));
    }
    console.error('POST /api/ai-generate', e);
    pushSystemError('POST /api/ai-generate', e instanceof Error ? e : new Error(String(e)));
    return res.json(await buildAiRecoveryOrFallbackResponse({
      errorCode: 'AI_INTERNAL_ERROR',
      canonicalIr: lastValidIrSnapshot || lastIrSnapshot,
      prompt: prompt.trim(),
      diagnostics: [{ code: 'AI_INTERNAL_ERROR', message: e?.message || 'Внутренняя ошибка сервера.' }],
      repairActions: lastRepairActions,
      meta: responseMeta(),
      systemContent,
      astMode,
      allowedMemoryKeys,
      responseMeta,
      sourceStage: lastAttempt > 1 ? AI_EXECUTION_MODE.AI_PARTIAL : AI_EXECUTION_MODE.AI_PRIMARY,
    }));
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
