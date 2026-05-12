import { spawn } from 'child_process';
import { CICADA_TG_ROOT } from '../config.js';

let child = null;
let readyQueue = [];

function pythonCmd() {
  const fromEnv = process.env.PYTHON || process.env.PYTHON3;
  if (fromEnv) return fromEnv;
  if (process.platform === 'win32') return 'python';
  return 'python3';
}

function cicadaPkgRoot() {
  return String(CICADA_TG_ROOT || '').trim();
}

function spawnWorker(pkgRoot) {
  if (child && !child.killed) return child;

  const py = pythonCmd();
  const sep = process.platform === 'win32' ? ';' : ':';
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUNBUFFERED: '1',
    ...(pkgRoot
      ? { PYTHONPATH: pkgRoot + (process.env.PYTHONPATH ? `${sep}${process.env.PYTHONPATH}` : '') }
      : {}),
  };

  const proc = spawn(py, ['-u', '-m', 'cicada.preview_worker'], {
    cwd: pkgRoot || process.cwd(),
    env,
    shell: false,
    windowsHide: true,
  });

  let buf = '';
  proc.stdout?.on('data', (chunk) => {
    buf += String(chunk);
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        const q = readyQueue.shift();
        if (q) {
          clearTimeout(q.timer);
          q.resolve(msg);
        }
      } catch {
        const q = readyQueue.shift();
        if (q) {
          clearTimeout(q.timer);
          q.resolve({ ok: false, error: 'Некорректный ответ процесса превью' });
        }
      }
    }
  });

  proc.stderr?.on('data', (ch) => {
    console.error('[preview-worker]', String(ch));
  });

  proc.on('error', (err) => {
    for (const q of readyQueue) {
      clearTimeout(q.timer);
      q.resolve({ ok: false, error: String(err.message || err) });
    }
    readyQueue = [];
    child = null;
  });

  proc.on('exit', () => {
    for (const q of readyQueue) {
      clearTimeout(q.timer);
      q.resolve({ ok: false, error: 'Процесс превью завершился' });
    }
    readyQueue = [];
    child = null;
  });

  child = proc;
  return proc;
}

/**
 * @param {object} body
 * @returns {Promise<object>}
 */
export function sendPreviewRequest(body) {
  const pkgRoot = cicadaPkgRoot();
  spawnWorker(pkgRoot);

  if (!child?.stdin) {
    return Promise.resolve({ ok: false, error: 'Не удалось запустить процесс превью' });
  }

  const line = `${JSON.stringify(body)}\n`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const i = readyQueue.findIndex((x) => x.timer === timer);
      if (i >= 0) readyQueue.splice(i, 1);
      resolve({ ok: false, error: 'Превью: таймаут выполнения' });
    }, 25_000);

    readyQueue.push({ resolve, timer });

    const write = () => {
      child.stdin.write(line, (err) => {
        if (err) {
          const q = readyQueue.shift();
          if (q) {
            clearTimeout(q.timer);
            q.resolve({ ok: false, error: String(err.message || err) });
          }
        }
      });
    };
    write();
  });
}

export function previewWorkerStatus() {
  return {
    running: Boolean(child && !child.killed),
    cicadaRoot: cicadaPkgRoot() || 'installed-package',
  };
}
