#!/usr/bin/env node
/**
 * Проверяет, что каждый блок из палитры конструктора генерирует DSL,
 * который принимает vendored Cicada core parser (parser.py через lint_cicada.py).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { generateDSL } from '../core/stacksToDsl.js';
import { lintCicadaWithPython } from '../services/pythonDslLint.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function readPaletteTypes() {
  const app = fs.readFileSync(path.join(REPO_ROOT, 'src', 'App.jsx'), 'utf8');
  const block = app.match(/export const BLOCK_TYPES = \[([\s\S]*?)\n\];/);
  if (!block) throw new Error('Не найден BLOCK_TYPES в src/App.jsx');
  const rows = [...block[1].matchAll(/\{\s*type:\s*'([^']+)'\s*,\s*label:\s*'([^']+)'/g)];
  return rows.map((m) => ({ type: m[1], label: m[2] }));
}

const sampleProps = {
  version: { version: '1.0' },
  bot: { token: 'TEST' },
  commands: { commands: '/start - Запуск\n/help - Помощь' },
  global: { varname: 'счет', value: '0' },
  block: { name: 'общий_блок' },
  use: { blockname: 'общий_блок' },
  command: { cmd: 'help' },
  callback: { label: 'Заказ' },
  message: { text: 'Ок' },
  buttons: { rows: 'Заказ, Помощь' },
  inline: { buttons: 'Да|cb_yes\nСайт|url:https://example.com' },
  inline_db: { key: 'категории', labelField: 'name', callbackPrefix: 'category:', backText: 'Назад', backCallback: 'back', columns: '1' },
  menu: { title: 'Меню', items: 'Каталог\nПомощь' },
  condition: { cond: 'текст == "да"' },
  switch: { varname: 'текст', cases: 'да\nнет' },
  ask: { question: 'Имя?', varname: 'имя' },
  remember: { varname: 'x', value: '1' },
  get: { key: 'k_{chat_id}', varname: 'x' },
  save: { key: 'k_{chat_id}', value: '1' },
  random: { variants: 'Первый\nВторой' },
  loop: { mode: 'count', count: '2' },
  http: { method: 'GET', url: 'https://example.com', varname: 'ответ_api' },
  delay: { seconds: '1' },
  typing: { seconds: '1' },
  goto: { label: 'шаг2' },
  log: { level: 'info', message: 'ok' },
  notify: { target: 'user_id', text: 'Привет' },
  database: { query: 'select 1', varname: 'rows' },
  payment: { provider: 'stripe', amount: '10', currency: 'USD', title: 'Тест' },
  analytics: { event: 'opened', params: 'source: bot' },
  classify: { intents: 'заказ\nпомощь', varname: 'намерение' },
  role: { varname: 'роль', roles: 'admin\nuser' },
  photo: { url: 'https://example.com/a.jpg', caption: 'Подпись' },
  video: { url: 'https://example.com/a.mp4', caption: 'Видео' },
  audio: { url: 'https://example.com/a.mp3' },
  document: { url: 'https://example.com/a.pdf', filename: 'a.pdf' },
  sticker: { file_id: 'STICKER_ID' },
  contact: { phone: '+10000000000', first_name: 'Имя', last_name: 'Фамилия' },
  location: { lat: '55.75', lon: '37.62' },
  poll: { question: 'Выбор?', options: 'Да\nНет' },
  scenario: { name: 'анкета' },
  step: { name: 'шаг1' },
  middleware: { type: 'before' },
  check_sub: { channel: '@channel', varname: 'подписан' },
  member_role: { channel: '@channel', user_id: 'user_id', varname: 'роль' },
  forward_msg: { target: 'ADMIN_ID' },
  broadcast: { mode: 'all', text: 'Новость' },
  db_delete: { key: 'k_{chat_id}' },
  save_global: { key: 'global_key', value: '1' },
  get_user: { user_id: 'user_id', key: 'k', varname: 'x' },
  all_keys: { varname: 'ключи' },
  call_block: { blockname: 'общий_блок', varname: 'результат' },
};

const rootTypes = new Set([
  'version', 'bot', 'commands', 'global', 'block', 'start', 'command', 'callback',
  'on_photo', 'on_voice', 'on_document', 'on_sticker', 'on_location', 'on_contact',
  'scenario', 'middleware',
]);

function block(type, id = `b_${type}`) {
  return { id, type, props: sampleProps[type] || {} };
}

function caseFor(type) {
  if (type === 'bot') return [{ id: 's0', x: 40, y: 40, blocks: [block('bot')] }];
  if (['version', 'commands', 'global'].includes(type)) {
    return [
      { id: 's0', x: 40, y: 40, blocks: [block('bot')] },
      { id: `s_${type}`, x: 400, y: 40, blocks: [block(type)] },
    ];
  }
  if (type === 'block') {
    return [
      { id: 's0', x: 40, y: 40, blocks: [block('bot')] },
      { id: 's_block', x: 400, y: 40, blocks: [block('block'), block('message'), block('stop')] },
    ];
  }
  if (type === 'use') {
    return [
      { id: 's0', x: 40, y: 40, blocks: [block('bot')] },
      { id: 's_block', x: 400, y: 40, blocks: [block('block'), block('message'), block('stop')] },
      { id: 's_start', x: 760, y: 40, blocks: [block('start'), block('use'), block('stop')] },
    ];
  }
  if (type === 'else') {
    return [
      { id: 's0', x: 40, y: 40, blocks: [block('bot')] },
      { id: 's_start', x: 400, y: 40, blocks: [block('start'), block('condition'), block('message', 'b_then'), block('else'), block('message', 'b_else'), block('stop')] },
    ];
  }
  if (type === 'goto') {
    return [
      { id: 's0', x: 40, y: 40, blocks: [block('bot')] },
      { id: 's_scenario', x: 400, y: 40, blocks: [block('scenario'), block('step', 'b_step1'), block('goto'), { id: 'b_step2', type: 'step', props: { name: 'шаг2' } }, block('message'), block('stop')] },
    ];
  }
  if (type === 'step') {
    return [
      { id: 's0', x: 40, y: 40, blocks: [block('bot')] },
      { id: 's_scenario', x: 400, y: 40, blocks: [block('scenario'), block('step'), block('message'), block('stop')] },
    ];
  }
  if (type === 'scenario') {
    return [
      { id: 's0', x: 40, y: 40, blocks: [block('bot')] },
      { id: 's_scenario', x: 400, y: 40, blocks: [block('scenario'), block('step'), block('message'), block('stop')] },
    ];
  }
  if (rootTypes.has(type)) {
    return [
      { id: 's0', x: 40, y: 40, blocks: [block('bot')] },
      { id: `s_${type}`, x: 400, y: 40, blocks: [block(type), block('message'), block('stop')] },
    ];
  }
  return [
    { id: 's0', x: 40, y: 40, blocks: [block('bot')] },
    { id: `s_${type}`, x: 400, y: 40, blocks: [block('start'), block(type), block('stop')] },
  ];
}

function parserHasError(py) {
  return !py.available || !py.ok || (py.diagnostics && py.diagnostics.length > 0) || !!py.error;
}

const rows = readPaletteTypes().map(({ type, label }) => {
  const dsl = generateDSL(caseFor(type));
  const py = lintCicadaWithPython({ code: dsl, cwd: REPO_ROOT });
  const unsupportedComments = dsl
    .split('\n')
    .map((line, idx) => ({ line: idx + 1, text: line.trim() }))
    .filter((row) => /^#\s*блок\s+/.test(row.text));
  return { type, label, dsl, py, unsupportedComments, ok: !parserHasError(py) && unsupportedComments.length === 0 };
});

for (const row of rows) {
  const mark = row.ok ? '✓' : '✗';
  console.log(`${mark} ${row.type} — ${row.label}`);
  if (!row.ok) {
    const diag = row.py.diagnostics?.[0];
    if (row.unsupportedComments?.length) {
      console.log(`  unsupported: ${row.unsupportedComments.map((x) => `стр.${x.line} ${x.text}`).join(' | ')}`);
    }
    console.log(`  ${diag?.line ? `стр.${diag.line} ` : ''}${diag?.message || row.py.error || 'parser error'}`);
    console.log(row.dsl.split('\n').map((line, idx) => `${String(idx + 1).padStart(3, ' ')}: ${line}`).join('\n'));
  }
}

const failed = rows.filter((r) => !r.ok);
console.log(`\nИтого: ${rows.length - failed.length}/${rows.length} блоков палитры соответствуют parser.py.`);
if (failed.length) {
  process.exit(1);
}
