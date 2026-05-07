import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const SAFE_USER_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_CODE_BYTES = Number(process.env.DSL_MAX_CODE_BYTES || 100_000);
const MAX_RUNTIME_MS = Number(process.env.DSL_MAX_RUNTIME_MS || 5 * 60 * 1000);
const MAX_LOG_CHARS = Number(process.env.DSL_MAX_LOG_CHARS || 80_000);

const runners = new Map(); // userId -> state
const recentRunnerResults = new Map(); // userId -> { endedAt, reason, code, signal, logs }

function safeFileName() {
  return `${Math.floor(10000 + Math.random() * 90000)}.ccd`;
}

function validateInputs(userId, code) {
  if (!userId || !SAFE_USER_ID.test(String(userId))) {
    throw new Error('invalid userId');
  }
  if (!code || typeof code !== 'string') {
    throw new Error('invalid code');
  }
  if (Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) {
    throw new Error(`code too large (>${MAX_CODE_BYTES} bytes)`);
  }
}

function ensureUserDir(botsDir, userId) {
  const dir = path.resolve(botsDir, userId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupUserCcdFiles(dir) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach((file) => {
    if (file.endsWith('.ccd')) {
      try { fs.unlinkSync(path.join(dir, file)); } catch {}
    }
  });
}

function appendLog(state, chunk) {
  const text = String(chunk || '');
  state.logs += text;
  if (state.logs.length > MAX_LOG_CHARS) {
    state.logs = state.logs.slice(state.logs.length - MAX_LOG_CHARS);
  }
}

function saveRunnerResult(userId, payload) {
  recentRunnerResults.set(userId, {
    ...payload,
    logs: String(payload.logs || '').slice(-MAX_LOG_CHARS),
  });
}

function hardKill(state) {
  if (!state?.proc || state.proc.killed) return;
  try { state.proc.kill('SIGTERM'); } catch {}
  setTimeout(() => {
    if (!state.proc.killed) {
      try { state.proc.kill('SIGKILL'); } catch {}
    }
  }, 1500).unref();
}

export function startRunner({ userId, code, cicadaBin, botsDir, onEvent }) {
  validateInputs(userId, code);
  if (!cicadaBin) throw new Error('CICADA_BIN is not configured');

  stopRunner(userId, { keepLog: false, reason: 'restart' });

  const userDir = ensureUserDir(botsDir, userId);
  cleanupUserCcdFiles(userDir);
  const file = path.join(userDir, safeFileName());
  fs.writeFileSync(file, code, 'utf8');
  const runFile = path.basename(file);

  const proc = spawn(cicadaBin, ['--dev', runFile], {
    cwd: userDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
    },
  });

  const state = {
    userId,
    file,
    proc,
    startedAt: Date.now(),
    logs: '',
    timeout: null,
  };
  runners.set(userId, state);

  state.timeout = setTimeout(() => {
    onEvent?.('timeout', { userId });
    hardKill(state);
  }, MAX_RUNTIME_MS);

  proc.stdout?.on('data', (chunk) => appendLog(state, chunk));
  proc.stderr?.on('data', (chunk) => appendLog(state, chunk));
  proc.on('error', (err) => {
    appendLog(state, `\n[runner-error] ${err?.message || String(err)}\n`);
    saveRunnerResult(userId, {
      endedAt: Date.now(),
      reason: 'spawn_error',
      code: null,
      signal: null,
      logs: state.logs,
    });
    onEvent?.('error', { userId, message: err?.message || String(err) });
  });
  proc.on('exit', (codeValue, signal) => {
    clearTimeout(state.timeout);
    saveRunnerResult(userId, {
      endedAt: Date.now(),
      reason: 'exit',
      code: codeValue,
      signal,
      logs: state.logs,
    });
    onEvent?.('exit', { userId, code: codeValue, signal });
    try { fs.unlinkSync(file); } catch {}
    runners.delete(userId);
  });

  return { startedAt: state.startedAt, timeoutMs: MAX_RUNTIME_MS };
}

export function stopRunner(userId, { keepLog = false, reason = 'manual' } = {}) {
  const state = runners.get(userId);
  if (!state) return false;
  clearTimeout(state.timeout);
  hardKill(state);
  saveRunnerResult(userId, {
    endedAt: Date.now(),
    reason,
    code: null,
    signal: 'SIGTERM',
    logs: state.logs,
  });
  if (!keepLog) {
    try { fs.unlinkSync(state.file); } catch {}
  }
  runners.delete(userId);
  return true;
}

export function isRunnerActive(userId) {
  return runners.has(userId);
}

export function getRunnerStatus(userId) {
  const state = runners.get(userId);
  if (!state) return null;
  return { startedAt: state.startedAt, file: state.file };
}

export function listRunners() {
  const out = [];
  runners.forEach((state, userId) => {
    out.push({ userId, startedAt: state.startedAt, file: state.file });
  });
  return out;
}

export function getRunnerLogs(userId, limitLines = 120) {
  const state = runners.get(userId);
  if (!state) {
    const last = recentRunnerResults.get(userId);
    if (!last) return { running: false, logs: '' };
    const lines = String(last.logs || '').split(/\r?\n/).slice(-limitLines).join('\n');
    return {
      running: false,
      logs: lines,
      lastExit: {
        reason: last.reason || 'exit',
        code: last.code,
        signal: last.signal,
        endedAt: last.endedAt || null,
      },
    };
  }
  const lines = String(state.logs || '').split(/\r?\n/).slice(-limitLines).join('\n');
  return { running: true, logs: lines };
}
