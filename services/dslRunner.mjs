import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';

const SAFE_USER_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_CODE_BYTES = Number(process.env.DSL_MAX_CODE_BYTES || 100_000);
const MAX_RUNTIME_MS = Number(process.env.DSL_MAX_RUNTIME_MS || 5 * 60 * 1000);
const MAX_LOG_CHARS = Number(process.env.DSL_MAX_LOG_CHARS || 80_000);
const DSL_CPU_SECONDS = Math.max(1, Number(process.env.DSL_CPU_SECONDS || 60));
const DSL_MEMORY_BYTES = Math.max(64 * 1024 * 1024, Number(process.env.DSL_MEMORY_BYTES || 512 * 1024 * 1024));
const DSL_MAX_PROCESSES = Math.max(8, Number(process.env.DSL_MAX_PROCESSES || 64));
const DSL_SANDBOX_MODE = String(
  process.env.DSL_SANDBOX_MODE || (process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production' ? 'enforced' : 'auto'),
).trim().toLowerCase();
const SAFE_EXECUTABLE = /^(?:[a-zA-Z0-9_./:-]+)$/;

const runners = new Map(); // userId -> state
const recentRunnerResults = new Map(); // userId -> { endedAt, reason, code, signal, logs }

function safeFileName() {
  return `${crypto.randomUUID()}.ccd`;
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

function executableExists(bin) {
  if (!bin || typeof bin !== 'string' || bin.includes('\0') || !SAFE_EXECUTABLE.test(bin)) return false;
  if (bin.includes('/')) return fs.existsSync(bin);
  const pathDirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  return pathDirs.some((dir) => fs.existsSync(path.join(dir, bin)));
}

function sandboxExecutable() {
  if (process.platform !== 'linux') return null;
  if (executableExists('/usr/bin/bwrap')) return '/usr/bin/bwrap';
  if (executableExists('/bin/bwrap')) return '/bin/bwrap';
  if (executableExists('bwrap')) return 'bwrap';
  if (executableExists('/usr/bin/firejail')) return '/usr/bin/firejail';
  if (executableExists('firejail')) return 'firejail';
  return null;
}

function prlimitExecutable() {
  if (process.platform !== 'linux') return null;
  if (executableExists('/usr/bin/prlimit')) return '/usr/bin/prlimit';
  if (executableExists('/bin/prlimit')) return '/bin/prlimit';
  if (executableExists('prlimit')) return 'prlimit';
  return null;
}

function buildSandboxedCommand({ cicadaBin, userDir, runFile }) {
  if (!executableExists(cicadaBin)) throw new Error('invalid CICADA_BIN');
  const sandbox = sandboxExecutable();
  const prlimit = prlimitExecutable();
  let command = cicadaBin;
  let args = ['--dev', runFile];
  let sandboxed = false;

  if (sandbox && path.basename(sandbox) === 'bwrap') {
    command = sandbox;
    args = [
      '--die-with-parent',
      '--new-session',
      '--unshare-net',
      '--proc', '/proc',
      '--dev', '/dev',
      '--tmpfs', '/tmp',
      '--ro-bind', '/usr', '/usr',
      '--ro-bind', '/bin', '/bin',
      '--ro-bind-try', '/lib', '/lib',
      '--ro-bind-try', '/lib64', '/lib64',
      '--ro-bind-try', '/etc/ssl', '/etc/ssl',
      '--bind', userDir, userDir,
      '--chdir', userDir,
      cicadaBin,
      '--dev',
      runFile,
    ];
    sandboxed = true;
  } else if (sandbox && path.basename(sandbox) === 'firejail') {
    command = sandbox;
    args = [
      '--quiet',
      '--net=none',
      '--private-dev',
      '--rlimit-nproc=64',
      `--rlimit-as=${DSL_MEMORY_BYTES}`,
      `--timeout=00:00:${Math.max(1, DSL_CPU_SECONDS)}`,
      '--',
      cicadaBin,
      '--dev',
      runFile,
    ];
    sandboxed = true;
  } else if (DSL_SANDBOX_MODE === 'enforced') {
    throw new Error('DSL sandbox is enforced but bwrap/firejail is not available');
  }

  if (prlimit) {
    args = [
      `--cpu=${DSL_CPU_SECONDS}`,
      `--as=${DSL_MEMORY_BYTES}`,
      `--nproc=${DSL_MAX_PROCESSES}`,
      '--',
      command,
      ...args,
    ];
    command = prlimit;
  }

  return { command, args, sandboxed, limited: Boolean(prlimit) };
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

  const launch = buildSandboxedCommand({ cicadaBin, userDir, runFile });
  if (!launch.sandboxed && DSL_SANDBOX_MODE !== 'off') {
    onEvent?.('sandbox_fallback', { userId, message: 'bwrap/firejail unavailable; process limits only' });
  }

  const proc = spawn(launch.command, launch.args, {
    cwd: userDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
    env: {
      PATH: process.env.PATH,
      HOME: userDir,
      TMPDIR: '/tmp',
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
