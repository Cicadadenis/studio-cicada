import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const MAX_CODE_BYTES = Number(process.env.DSL_MAX_CODE_BYTES || 100_000);

/**
 * Резолвит путь к lint_cicada.py.
 * Сначала пробует vendor/cicada-dsl-parser/, затем корень проекта.
 */
function resolveLintScript(rootDir = process.cwd()) {
  const vendorScript = path.resolve(rootDir, 'vendor', 'cicada-dsl-parser', 'lint_cicada.py');
  if (fs.existsSync(vendorScript)) return vendorScript;
  // Запасной путь — lint_cicada.py в корне проекта (ручная установка)
  const rootScript = path.resolve(rootDir, 'lint_cicada.py');
  if (fs.existsSync(rootScript)) return rootScript;
  return vendorScript; // вернём vendor-путь, чтобы ошибка была информативной
}

/**
 * Выбирает интерпретатор Python (Windows-friendly).
 */
function pythonCmd() {
  const fromEnv = process.env.PYTHON || process.env.PYTHON3;
  if (fromEnv) return fromEnv;
  if (process.platform === 'win32') return 'python';
  // В non-interactive контейнерах pyenv-shim для python3 может зависать на
  // разрешении версии. Системный Python даёт тот же парсеру интерпретатор без
  // лишнего shim-слоя и корректно завершается по timeout.
  if (fs.existsSync('/usr/bin/python3')) return '/usr/bin/python3';
  return 'python3';
}


function findUnsupportedBlockComment(line) {
  let inQuote = false;
  let escaped = false;
  const text = String(line || '');
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = inQuote;
      continue;
    }
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && text.slice(i).match(/^#\s*блок\s+/)) return i;
  }
  return -1;
}

function unsupportedBlockCommentDiagnostics(code) {
  return String(code || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line, idx) => ({ line, idx, col: findUnsupportedBlockComment(line) }))
    .filter((row) => row.col !== -1)
    .map((row) => ({
      type: 'UnsupportedBlockComment',
      code: 'DSL-UNSUPPORTED-BLOCK-COMMENT',
      severity: 'error',
      line: row.idx + 1,
      column: row.col + 1,
      offset: row.col + 1,
      message: 'Неподдерживаемый блок сгенерирован как комментарий «# блок ...» и не будет выполняться ботом.',
      sourceLine: row.line,
      help: 'Замените комментарий на реальную инструкцию DSL, например «запустить имя_сценария», или пересоберите блоки в конструкторе.',
      suggestions: [],
    }));
}

/**
 * Запускает Python-парсер Cicada для проверки DSL-кода.
 *
 * @param {{ code: string, cwd?: string }} opts
 * @returns {{
 *   ok: boolean,
 *   available: boolean,
 *   diagnostics: Array<{code:string, severity:string, line:number, message:string, help:string}>,
 *   error?: string
 * }}
 */
export function lintCicadaWithPython(opts) {
  const code = String(opts.code ?? '');
  const cwd  = opts.cwd ?? process.cwd();
  const script = resolveLintScript(cwd);
  const timeoutMs = Math.max(
    1_000,
    Math.min(15_000, Number.isFinite(Number(opts.timeoutMs)) ? Number(opts.timeoutMs) : 15_000),
  );

  // ── скрипт не найден ────────────────────────────────────────────────────
  if (!fs.existsSync(script)) {
    return {
      ok: false,
      available: false,
      diagnostics: [],
      error: `Lint-скрипт не найден: ${script}. Убедитесь, что vendor/cicada-dsl-parser/lint_cicada.py существует.`,
    };
  }

  const unsupportedCommentDiags = unsupportedBlockCommentDiagnostics(code);
  if (unsupportedCommentDiags.length) {
    return {
      ok: false,
      available: true,
      diagnostics: unsupportedCommentDiags,
      error: 'DSL содержит неподдерживаемые комментарии «# блок ...» вместо исполняемых инструкций.',
    };
  }

  // ── слишком большой код ──────────────────────────────────────────────────
  if (Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) {
    return {
      ok: false,
      available: true,
      diagnostics: [],
      error: `Код слишком большой для проверки (>${MAX_CODE_BYTES} байт)`,
    };
  }

  // ── пишем во временный файл ──────────────────────────────────────────────
  const tmp = path.join(os.tmpdir(), `cicada-lint-${process.pid}-${Date.now()}.ccd`);
  try {
    fs.writeFileSync(tmp, code, 'utf8');

    const py = pythonCmd();
    const proc = spawnSync(py, [script, tmp], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
      timeout: timeoutMs,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1',
      },
    });

    const errText = (proc.stderr || '').trim();

    // ── Python не найден или упал с OS-ошибкой ────────────────────────────
    if (proc.error) {
      const msg =
        proc.error.code === 'ENOENT'
          ? `Python не найден (${py}). Укажите переменную PYTHON в .env.`
          : proc.error.message;
      return { ok: false, available: false, diagnostics: [], error: msg };
    }

    const out = String(proc.stdout || '').trim();

    // ── парсим JSON-ответ ────────────────────────────────────────────────
    let data = null;
    try {
      data = JSON.parse(out);
    } catch {
      return {
        ok: false,
        available: false,
        diagnostics: [],
        error: errText || out || `python lint завершился с кодом ${proc.status}`,
      };
    }

    // Нормализуем поля
    if (data.available == null) data.available = true;
    if (!Array.isArray(data.diagnostics)) data.diagnostics = [];

    return data;

  } finally {
    try { fs.unlinkSync(tmp); } catch { /* noop */ }
  }
}

/**
 * Обёртка для AI-пайплайна: бросает ошибку если парсер недоступен или нашёл проблемы.
 * Используется в /api/ai-generate чтобы ГАРАНТИРОВАТЬ прохождение через парсер.
 *
 * @param {string} dslCode — сгенерированный DSL
 * @param {{ cwd?: string }} opts
 * @throws {Error} если парсер недоступен ИЛИ нашёл синтаксические ошибки
 */
export function requireParsedDSL(dslCode, opts = {}) {
  const result = lintCicadaWithPython({ code: dslCode, ...opts });

  // Парсер недоступен — блокирующая ошибка
  if (!result.available) {
    const e = new Error(
      `Парсер Cicada недоступен — невозможно проверить DSL от AI. ` +
      `${result.error || 'Проверьте наличие Python и файла vendor/cicada-dsl-parser/lint_cicada.py'}`
    );
    e.parserUnavailable = true;
    throw e;
  }

  // Парсер нашёл ошибки
  if (!result.ok || result.diagnostics.length > 0) {
    const msgs = result.diagnostics
      .slice(0, 5)
      .map((d) => {
        const line = d.line != null ? ` (стр. ${d.line})` : '';
        return `${d.message || d.code || 'ошибка'}${line}`;
      })
      .join('; ');
    const e = new Error(msgs || result.error || 'Парсер Cicada отклонил DSL');
    e.parserRejected = true;
    e.diagnostics = result.diagnostics;
    throw e;
  }

  return result;
}

/**
 * Получает DSL-aware hints из vendor/cicada-dsl-parser/cicada/hints.py.
 * Возвращает пустой список, если модуль/интерпретатор недоступен.
 */
export function getDslHintsWithPython(opts) {
  const code = String(opts.code ?? '');
  const cwd = opts.cwd ?? process.cwd();
  const py = pythonCmd();
  const bootstrap = `
import json, sys
from pathlib import Path
root = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(root / "vendor" / "cicada-dsl-parser"))
from cicada.hints import dsl_aware_hints
src = Path(sys.argv[2]).read_text(encoding="utf-8")
print(json.dumps(dsl_aware_hints(src), ensure_ascii=False))
`.trim();

  const tmp = path.join(os.tmpdir(), `cicada-hints-${process.pid}-${Date.now()}.ccd`);
  try {
    fs.writeFileSync(tmp, code, 'utf8');
    const proc = spawnSync(py, ['-c', bootstrap, cwd, tmp], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
      timeout: 15_000,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1',
      },
    });
    if (proc.error) return { ok: false, hints: [], error: proc.error.message };
    const out = String(proc.stdout || '').trim();
    if (!out) return { ok: false, hints: [], error: String(proc.stderr || '').trim() || 'empty hints output' };
    try {
      const parsed = JSON.parse(out);
      return parsed && typeof parsed === 'object' ? parsed : { ok: false, hints: [] };
    } catch {
      return { ok: false, hints: [], error: out };
    }
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* noop */ }
  }
}
