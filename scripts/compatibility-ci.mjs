#!/usr/bin/env node
import { spawnSync } from 'child_process';

const steps = [
  {
    id: 'core_guard',
    title: 'Core hash/signature/API guard',
    command: ['node', ['scripts/core-guard.mjs']],
  },
  {
    id: 'parser_parity',
    title: 'Parser parity tests',
    command: ['node', ['scripts/parser-batch-check.mjs']],
    env: { CI: 'true' },
  },
  {
    id: 'dsl_snapshot',
    title: 'DSL regression snapshot tests',
    command: ['node', ['scripts/parser-batch-check.mjs', '--regression']],
    env: { CI: 'true' },
  },
  {
    id: 'runtime_parity',
    title: 'Runtime parity tests',
    command: ['python3', ['scripts/callback-parser-check.py']],
  },
  {
    id: 'validator_flow',
    title: 'Validator control-flow parity',
    command: ['node', ['scripts/ui-flow-analysis-check.mjs']],
  },
  {
    id: 'ai_canonical_ir',
    title: 'AI canonical IR golden corpus',
    command: ['node', ['--test', 'core/tests/ai-canonical-ir.test.mjs', 'core/tests/ir-semantic-gate.test.mjs']],
  },
  {
    id: 'preview_parity',
    title: 'Preview worker parity',
    command: ['python3', ['-c', `
import json, subprocess, sys
code = 'бот "TEST"\\nпри старте:\\n    ответ "ok"\\n'
proc = subprocess.Popen([sys.executable, '-u', '-m', 'cicada.preview_worker'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
req = {"sessionId": "compat-preview", "code": code, "chatId": 7001, "text": "/start"}
out, err = proc.communicate(json.dumps(req, ensure_ascii=False) + "\\n", timeout=10)
if proc.returncode not in (0, None):
    raise SystemExit(err or out)
line = out.strip().splitlines()[-1] if out.strip() else ''
data = json.loads(line)
if not data.get('ok'):
    raise SystemExit(data)
print(json.dumps({"ok": True, "outbound": data.get("outbound", [])}, ensure_ascii=False))
`.trim()]],
  },
  {
    id: 'adapter_compat',
    title: 'Adapter compatibility tests',
    command: ['python3', ['-c', `
from cicada.adapters.mock_telegram import MockTelegramAdapter
from cicada.adapters.telegram import TelegramAdapter
from cicada.core import TelegramUpdateNormalizer, MessageEvent, CallbackEvent, MediaEvent
mock = MockTelegramAdapter()
assert hasattr(mock, 'send_message') and hasattr(mock, 'send_inline_keyboard')
assert hasattr(TelegramAdapter, 'call') and hasattr(TelegramAdapter, 'get_updates')
msg = TelegramUpdateNormalizer.from_update({"message":{"message_id":1,"chat":{"id":1,"type":"private"},"from":{"id":2},"text":"hi"}})
cb = TelegramUpdateNormalizer.from_update({"callback_query":{"id":"c","data":"x","from":{"id":2},"message":{"message_id":1,"chat":{"id":1,"type":"private"}}}})
media = TelegramUpdateNormalizer.from_update({"message":{"message_id":1,"chat":{"id":1,"type":"private"},"from":{"id":2},"document":{"file_id":"f","file_name":"a.txt"}}})
assert isinstance(msg, MessageEvent)
assert isinstance(cb, CallbackEvent)
assert isinstance(media, MediaEvent)
print('adapter compatibility ok')
`.trim()]],
  },
];

const results = [];
for (const step of steps) {
  const [bin, args] = step.command;
  const proc = spawnSync(bin, args, {
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, ...(step.env || {}) },
  });
  results.push({
    id: step.id,
    title: step.title,
    ok: proc.status === 0,
    status: proc.status,
    stdout: String(proc.stdout || '').trim().slice(-4000),
    stderr: String(proc.stderr || '').trim().slice(-4000),
  });
  const mark = proc.status === 0 ? '✓' : '✗';
  console.log(`${mark} ${step.title}`);
  if (proc.status !== 0) {
    console.error(proc.stdout || '');
    console.error(proc.stderr || '');
    break;
  }
}

const ok = results.every((r) => r.ok) && results.length === steps.length;
console.log(JSON.stringify({ ok, results: results.map(({ id, ok: pass }) => ({ id, ok: pass })) }, null, 2));
if (!ok) process.exit(1);
