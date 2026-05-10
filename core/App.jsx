import React, { useState, useRef, useCallback, useEffect } from 'react';
import cicadaLogo from './cicada-logo_1778117072446.jpeg';
import { ModuleLibraryButton, ModuleLibraryModal } from './ModuleLibrary';
import { lintDSLSchema, formatDSLDiagnostic } from '../core/validator/schema.js';
import { validateDSL } from '../core/validator/uiDslValidator.js';
import { RUNTIME_PROPERTY_NAMES } from '../core/runtime/rules.js';
import { generateDSL, stackToDSL } from '../core/stacksToDsl.js';
import { getCsrfTokenForRequest, resetCsrfPrefetch } from './csrf.js';
import confetti from 'canvas-confetti';

function fireRegistrationConfetti() {
  const opts = { origin: { y: 0.72 }, zIndex: 10050 };
  const colors = ['#ffd700', '#f59e0b', '#fbbf24', '#22c55e', '#38bdf8', '#a78bfa', '#fb7185'];
  confetti({ ...opts, particleCount: 130, spread: 88, startVelocity: 42, colors });
  setTimeout(() => { confetti({ ...opts, particleCount: 85, angle: 58, spread: 52, colors }); }, 160);
  setTimeout(() => { confetti({ ...opts, particleCount: 85, angle: 122, spread: 52, colors }); }, 320);
  setTimeout(() => { confetti({ ...opts, particleCount: 70, spread: 100, scalar: 0.85, ticks: 220, colors }); }, 500);
}

// ═══════════════════════════════════════════════════════════════════════════
// PROJECTS STORAGE — PostgreSQL via API
// ═══════════════════════════════════════════════════════════════════════════

async function saveProjectToCloud(_userId, projectName, stacks) {
  const data = await apiFetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: projectName, stacks }),
  });
  return data.project;
}

async function getUserProjects(_userId) {
  try {
    const data = await apiFetch('/api/projects');
    return data.projects || [];
  } catch {
    return [];
  }
}

async function deleteProject(projectId) {
  await apiFetch(`/api/projects/${projectId}`, { method: 'DELETE' });
}

async function loadProjectFromCloud(projectId) {
  try {
    const data = await apiFetch(`/api/projects/${projectId}`);
    return data.project || null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SERVER AUTH API
// ═══════════════════════════════════════════════════════════════════════════


const API_URL = import.meta.env.VITE_API_URL ?? "/api";

// ─── JWT helpers ────────────────────────────────────────────────────────────
const JWT_KEY = 'cicada_jwt';
function getStoredJwt() { return localStorage.getItem(JWT_KEY) || null; }
function storeJwt(token) { if (token) localStorage.setItem(JWT_KEY, token); }
function clearJwt() {
  resetCsrfPrefetch();
  localStorage.removeItem(JWT_KEY);
}

// ─── Универсальный fetch с человекочитаемыми ошибками ───────────────────────
async function apiFetch(url, options = {}, retryCsrf = true) {
  const method = (options.method || 'GET').toUpperCase();
  const jwt = getStoredJwt();
  const authHeaders = jwt ? { Authorization: `Bearer ${jwt}` } : {};
  const csrfHeaders = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
    ? { 'x-csrf-token': await getCsrfTokenForRequest() }
    : {};
  const mergedHeaders = { ...authHeaders, ...csrfHeaders, ...(options.headers || {}) };
  let res;
  try {
    res = await fetch(url, { credentials: 'include', ...options, headers: mergedHeaders });
  } catch (e) {
    // Сеть недоступна или сервер не запущен
    throw new Error('⚠️ Сервер не запущен или недоступен');
  }

  // При 401 — JWT/сессия устарела, сбрасываем и просим повторный вход
  if (res.status === 401) {
    clearJwt();
    localStorage.removeItem('cicada_session');
    window.dispatchEvent(new CustomEvent('cicada:session-expired'));
    throw new Error('⚠️ Сессия истекла — войдите заново');
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    // Nginx/прокси вернул HTML вместо JSON — сервер упал
    if (res.status === 502 || res.status === 503) throw new Error('⚠️ Сервер временно недоступен (502/503)');
    if (res.status === 500) throw new Error('⚠️ Внутренняя ошибка сервера (500)');
    if (res.status === 404) throw new Error('⚠️ Эндпоинт не найден (404)');
    throw new Error('⚠️ Сервер не запущен или вернул неверный ответ');
  }

  const data = await res.json();

  if (retryCsrf && res.status === 403 && typeof data?.error === 'string' && data.error.includes('CSRF')) {
    resetCsrfPrefetch();
    return apiFetch(url, options, false);
  }

  if (data.error) throw new Error(data.error);
  return data;
}

async function postJsonWithCsrf(url, body) {
  const token = await getCsrfTokenForRequest();
  return fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': token,
    },
    body: JSON.stringify(body ?? {}),
  });
}

async function fetchOauthBootstrapUser() {
  const r = await fetch('/api/auth/oauth-bootstrap', { credentials: 'include' });
  const data = await r.json().catch(() => ({}));
  if (data?.twofaRequired) {
    const e = new Error('Требуется код 2FA');
    e.twofaRequired = true;
    e.oauth2fa = true;
    throw e;
  }
  if (data?.ok && data.token && data.user) {
    storeJwt(data.token);
    return data.user;
  }
  return null;
}

async function completeOauth2fa(totp = '') {
  const res = await postJsonWithCsrf('/api/auth/oauth-2fa/complete', { totp });
  const data = await res.json().catch(() => ({}));
  if (data?.twofaRequired) {
    const e = new Error(data.error || 'Требуется код 2FA');
    e.twofaRequired = true;
    throw e;
  }
  if (data?.error) throw new Error(data.error);
  if (data.token) storeJwt(data.token);
  return data.user;
}

async function registerUser(name, email, password) {
  return await apiFetch(`${API_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });
}

async function loginUser(email, password, totp = '') {
  const res = await fetch(`${API_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password, totp }),
  });
  const data = await res.json().catch(() => ({}));
  if (data?.twofaRequired) {
    const e = new Error(data.error || 'Требуется код 2FA');
    e.twofaRequired = true;
    throw e;
  }
  if (data?.error) throw new Error(data.error);
  if (data.token) storeJwt(data.token);
  return data.user;
}

async function forgotPassword(email) {
  return await apiFetch(`${API_URL}/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

async function resetPassword(token, password) {
  return await apiFetch(`${API_URL}/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password }),
  });
}

async function requestEmailChange(userId, currentEmail, newEmail) {
  return await apiFetch(`${API_URL}/request-email-change`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, currentEmail, newEmail }),
  });
}

async function confirmEmailChange(userId, code, newEmail) {
  return await apiFetch(`${API_URL}/confirm-email-change`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, code, newEmail }),
  });
}

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function updateUser(userId, updates, currentUser = null) {
  const data = await apiFetch(`${API_URL}/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, updates }),
  });

  const rawUser = data?.user || {};
  const normalized = {
    ...(currentUser || {}),
    ...rawUser,
  };

  if (Object.prototype.hasOwnProperty.call(updates || {}, 'photo_url')) {
    normalized.photo_url = updates.photo_url ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(updates || {}, 'ui_language')) {
    normalized.uiLanguage = String(updates.ui_language || 'ru').toLowerCase();
  } else if (!normalized.uiLanguage && rawUser?.ui_language) {
    normalized.uiLanguage = String(rawUser.ui_language).toLowerCase();
  }

  return normalized;
}

async function fetch2FASetup(userId) {
  return apiFetch(`${API_URL}/2fa/setup?userId=${encodeURIComponent(userId)}`);
}

async function enable2FA(userId, code) {
  return apiFetch(`${API_URL}/2fa/enable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, code }),
  });
}

async function disable2FA(userId, code) {
  return apiFetch(`${API_URL}/2fa/disable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, code }),
  });
}

// session utils — без изменений
function saveSession(user) {
  if (user) {
    localStorage.setItem('cicada_session', JSON.stringify(user));
  } else {
    localStorage.removeItem('cicada_session');
  }
}

function getSession() {
  try {
    const data = localStorage.getItem('cicada_session');
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

function clearSession() {
  resetCsrfPrefetch();
  localStorage.removeItem('cicada_session');
  clearJwt();
}

/** Свежие plan/subscription из БД (после выдачи подписки в админке и т.д.). */
async function fetchSessionUserFromServer() {
  if (!getStoredJwt()) return null;
  try {
    const data = await apiFetch(`${API_URL}/me`);
    return data?.user ?? null;
  } catch {
    return null;
  }
}

// Re-export from users.js for compatibility

// ─── BLOCK INFO CONTEXT ──────────────────────────────────────────────────────
const BlockInfoContext = React.createContext(null);
const AddBlockContext = React.createContext(null);

const LANDING_PAGE_CONTENT = {
  features:  { type: 'features',  title: 'Возможности' },
  templates: { type: 'templates', title: 'Шаблоны' },
  docs:      { type: 'docs',      title: 'Документация' },
  pricing:   { type: 'pricing',   title: 'Тарифы' },
};

// ─── BLOCK DEFINITIONS ───────────────────────────────────────────────────────

export const BLOCK_TYPES = [
  // Настройки (standalone, no stacking allowed as children)
  { type:'version',    label:'Версия',         icon:'📌', color:'#6b7280', group:'Настройки',  canBeRoot:true,  canStack:false },
  { type:'bot',        label:'Бот',            icon:'🤖', color:'#3ecf8e', group:'Настройки',  canBeRoot:true,  canStack:false },
  { type:'commands',   label:'Команды меню',   icon:'📋', color:'#fbbf24', group:'Настройки',  canBeRoot:true,  canStack:false },
  { type:'global',     label:'Глобальная',     icon:'🌍', color:'#10b981', group:'Настройки',  canBeRoot:true,  canStack:false },
  { type:'block',      label:'Блок',           icon:'🧱', color:'#8b5cf6', group:'Настройки',  canBeRoot:true,  canStack:true  },
  { type:'use',        label:'Использовать',   icon:'⚡', color:'#a78bfa', group:'Настройки',  canBeRoot:false, canStack:true  },
    // Блоки (пусто, оставляем для совместимости)
  // Основные
  { type:'start',      label:'Старт',          icon:'▶',  color:'#3ecf8e', group:'Основные',   canBeRoot:true,  canStack:true  },
  { type:'command',    label:'Команда',         icon:'/',  color:'#fbbf24', group:'Основные',   canBeRoot:true,  canStack:true  },
  { type:'callback',   label:'При нажатии',    icon:'⊙',  color:'#60a5fa', group:'Основные',   canBeRoot:true,  canStack:true  },
  { type:'on_photo',   label:'При фото',       icon:'📷', color:'#34d399', group:'Основные',   canBeRoot:true,  canStack:true  },
  { type:'on_voice',   label:'При голосовом',  icon:'🎤', color:'#818cf8', group:'Основные',   canBeRoot:true,  canStack:true  },
  { type:'on_document',label:'При документе',  icon:'📎', color:'#94a3b8', group:'Основные',   canBeRoot:true,  canStack:true  },
  { type:'on_sticker', label:'При стикере',    icon:'🎭', color:'#f472b6', group:'Основные',   canBeRoot:true,  canStack:true  },
  { type:'on_location',label:'При локации',    icon:'📍', color:'#ef4444', group:'Основные',   canBeRoot:true,  canStack:true  },
  { type:'on_contact', label:'При контакте',   icon:'👤', color:'#0ea5e9', group:'Основные',   canBeRoot:true,  canStack:true  },
  { type:'message',    label:'Ответ',          icon:'✉',  color:'#5b7cf6', group:'Основные',   canBeRoot:false, canStack:true  },
  { type:'buttons',    label:'Кнопки',         icon:'⊞',  color:'#a78bfa', group:'Основные',   canBeRoot:false, canStack:true  },
  { type:'inline',     label:'Inline-кнопки',  icon:'▦',  color:'#7c3aed', group:'Основные',   canBeRoot:false, canStack:true  },
  { type:'menu',       label:'Меню',           icon:'≡',  color:'#8b5cf6', group:'Основные',   canBeRoot:false, canStack:true  },
  // Логика
  { type:'condition',  label:'Если',           icon:'◇',  color:'#fb923c', group:'Логика',     canBeRoot:false, canStack:true  },
  { type:'else',       label:'Иначе',          icon:'⎇',  color:'#f97316', group:'Логика',     canBeRoot:false, canStack:true  },
  { type:'switch',     label:'Переключатель',  icon:'⇄',  color:'#f59e0b', group:'Логика',     canBeRoot:false, canStack:true  },
  { type:'ask',        label:'Спросить',       icon:'?',  color:'#f87171', group:'Логика',     canBeRoot:false, canStack:true  },
  { type:'remember',   label:'Запомнить',      icon:'♦',  color:'#94a3b8', group:'Логика',     canBeRoot:false, canStack:true  },
  { type:'get',        label:'Получить',       icon:'📥', color:'#0ea5e9', group:'Логика',     canBeRoot:false, canStack:true  },
  { type:'save',       label:'Сохранить',      icon:'💾', color:'#059669', group:'Логика',     canBeRoot:false, canStack:true  },
  { type:'random',     label:'Рандом',         icon:'⚄',  color:'#c084fc', group:'Логика',     canBeRoot:false, canStack:true  },
  { type:'loop',       label:'Цикл',           icon:'↻',  color:'#f59e0b', group:'Логика',     canBeRoot:false, canStack:true  },
  // Действия
  { type:'http',       label:'HTTP-запрос',    icon:'↗',  color:'#0ea5e9', group:'Действия',   canBeRoot:false, canStack:true  },
  { type:'delay',      label:'Пауза',          icon:'⏱',  color:'#64748b', group:'Действия',   canBeRoot:false, canStack:true  },
  { type:'typing',     label:'Печатает...',    icon:'…',  color:'#475569', group:'Действия',   canBeRoot:false, canStack:true  },
  { type:'stop',       label:'Стоп',           icon:'■',  color:'#ef4444', group:'Действия',   canBeRoot:false, canStack:false },
  { type:'goto',       label:'Переход',        icon:'→',  color:'#a3a3a3', group:'Действия',   canBeRoot:false, canStack:false },
  { type:'log',        label:'Лог',            icon:'📋', color:'#6b7280', group:'Действия',   canBeRoot:false, canStack:true  },
  { type:'notify',     label:'Уведомление',    icon:'🔔', color:'#06b6d4', group:'Действия',   canBeRoot:false, canStack:true  },
  { type:'database',   label:'БД-запрос',      icon:'🗄', color:'#10b981', group:'Действия',   canBeRoot:false, canStack:true  },
  { type:'payment',    label:'Оплата',         icon:'💳', color:'#16a34a', group:'Действия',   canBeRoot:false, canStack:true  },
  { type:'analytics',  label:'Аналитика',      icon:'📊', color:'#0284c7', group:'Действия',   canBeRoot:false, canStack:true  },
  { type:'classify',   label:'Классификация',  icon:'🧠', color:'#ec4899', group:'Действия',   canBeRoot:false, canStack:true  },
  { type:'role',       label:'Проверка роли',  icon:'🔐', color:'#dc2626', group:'Действия',   canBeRoot:false, canStack:true  },
  // Медиа
  { type:'photo',      label:'Фото',           icon:'🖼', color:'#34d399', group:'Медиа',      canBeRoot:false, canStack:true  },
  { type:'video',      label:'Видео',          icon:'▷',  color:'#2dd4bf', group:'Медиа',      canBeRoot:false, canStack:true  },
  { type:'audio',      label:'Аудио',          icon:'♪',  color:'#818cf8', group:'Медиа',      canBeRoot:false, canStack:true  },
  { type:'document',   label:'Документ',       icon:'📄', color:'#94a3b8', group:'Медиа',      canBeRoot:false, canStack:true  },
  { type:'send_file',  label:'Отправить файл', icon:'📎', color:'#64748b', group:'Медиа',      canBeRoot:false, canStack:true  },
  { type:'sticker',    label:'Стикер',         icon:'◉',  color:'#f472b6', group:'Медиа',      canBeRoot:false, canStack:true  },
  { type:'contact',    label:'Контакт',         icon:'👤', color:'#0ea5e9', group:'Медиа',      canBeRoot:false, canStack:true  },
  { type:'location',   label:'Локация',         icon:'📍', color:'#ef4444', group:'Медиа',      canBeRoot:false, canStack:true  },
  { type:'poll',       label:'Опрос',           icon:'📊', color:'#8b5cf6', group:'Медиа',      canBeRoot:false, canStack:true  },
  // Сценарии
  { type:'scenario',   label:'Сценарий',       icon:'↺',  color:'#34d399', group:'Сценарии',   canBeRoot:true,  canStack:true  },
  { type:'step',       label:'Шаг',            icon:'»',  color:'#059669', group:'Сценарии',   canBeRoot:false, canStack:true  },
  // Middleware
  { type:'middleware',  label:'Middleware',    icon:'⚙',  color:'#64748b', group:'Middleware',  canBeRoot:true,  canStack:true  },
  // ── Telegram расширения ──────────────────────────────────────────────────
  { type:'check_sub',   label:'Проверка подписки', icon:'✅', color:'#10b981', group:'Telegram', canBeRoot:false, canStack:true  },
  { type:'member_role', label:'Роль участника',    icon:'👮', color:'#059669', group:'Telegram', canBeRoot:false, canStack:true  },
  { type:'forward_msg', label:'Переслать',         icon:'↗', color:'#34d399', group:'Telegram', canBeRoot:false, canStack:true  },
  { type:'broadcast',   label:'Рассылка',          icon:'📡', color:'#0ea5e9', group:'Telegram', canBeRoot:false, canStack:true  },
  // ── Данные (расширенная БД) ──────────────────────────────────────────────
  { type:'db_delete',   label:'Удалить из БД',     icon:'🗑', color:'#ef4444', group:'Данные',  canBeRoot:false, canStack:true  },
  { type:'save_global', label:'Глобальная БД',      icon:'🌐', color:'#10b981', group:'Данные',  canBeRoot:false, canStack:true  },
  { type:'get_user',    label:'Данные польз-ля',   icon:'👤', color:'#0ea5e9', group:'Данные',  canBeRoot:false, canStack:true  },
  { type:'all_keys',    label:'Все ключи',          icon:'🗂', color:'#64748b', group:'Данные',  canBeRoot:false, canStack:true  },
  // ── Блоки-функции ───────────────────────────────────────────────────────
  { type:'call_block',  label:'Вызвать блок',       icon:'⚡', color:'#8b5cf6', group:'Настройки', canBeRoot:false, canStack:true  },
];

// ─── COMPATIBILITY: what can stack BELOW a given type ─────────────────────
// Базовый набор без buttons и inline — они только после message
const FLOW_CHILDREN = ['message','typing','delay','condition','else','switch','ask','remember','get','save','random','loop','http','log','notify','broadcast','role','payment','analytics','photo','video','audio','document','send_file','sticker','contact','location','poll','database','classify','use','stop','goto','menu','check_sub','member_role','forward_msg','db_delete','save_global','get_user','all_keys','call_block'];
const FLOW_NO_MEDIA = ['message','typing','delay','condition','switch','ask','remember','get','save','random','loop','http','log','stop','goto','use'];
const TERMINAL = [];

const CAN_STACK_BELOW = {
  start:      [...FLOW_CHILDREN],
  command:    [...FLOW_CHILDREN],
  callback:   [...FLOW_CHILDREN],
  on_photo:   [...FLOW_CHILDREN],
  on_voice:   [...FLOW_CHILDREN],
  on_document:[...FLOW_CHILDREN],
  on_sticker: [...FLOW_CHILDREN],
  on_location:[...FLOW_CHILDREN],
  on_contact: [...FLOW_CHILDREN],
  middleware: [...FLOW_CHILDREN],
  message:    [...FLOW_CHILDREN, 'buttons', 'inline'],  // кнопки и inline — только после текста
  buttons:    [...FLOW_CHILDREN],                        // после кнопок нельзя снова кнопки/inline
  menu:       ['message','typing','delay','condition','stop','goto'],
  condition:  [...FLOW_CHILDREN],
  else:       [...FLOW_CHILDREN],
  switch:     [...FLOW_CHILDREN],
  ask:        ['message','remember','get','save','condition','http','log','notify','stop','goto','use'],
  remember:   [...FLOW_NO_MEDIA, 'notify'],
  get:        [...FLOW_NO_MEDIA],
  save:       [...FLOW_NO_MEDIA],
  random:     ['message','typing','delay','condition','goto','stop','use','log'],
  loop:       [...FLOW_CHILDREN],
  http:       ['message','remember','save','condition','log','stop','goto','use'],
  delay:      ['message','typing','condition','ask','remember','get','save','http','log','stop','goto','use'],
  typing:     ['message','photo','video','audio','document','send_file','sticker','condition','ask','delay','stop','goto','use'],
  photo:      ['message','typing','delay','condition','ask','stop','goto','use','log'],
  video:      ['message','typing','delay','condition','ask','stop','goto','use','log'],
  audio:      ['message','typing','delay','condition','ask','stop','goto','use','log'],
  document:   ['message','typing','delay','condition','ask','stop','goto','use','log'],
  send_file:  ['message','typing','delay','condition','ask','stop','goto','use','log'],
  sticker:    ['message','typing','delay','condition','ask','stop','goto','use','log'],
  contact:    ['message','typing','delay','condition','ask','stop','goto','use','log'],
  location:   ['message','typing','delay','condition','ask','stop','goto','use','log'],
  poll:       ['message','typing','delay','condition','ask','stop','goto','use','log'],
  log:        [...FLOW_NO_MEDIA, 'notify'],
  notify:     ['message','typing','delay','stop','goto','log'],
  database:   ['message','remember','get','save','condition','log','stop','goto','use'],
  payment:    ['message','condition','stop','goto','log'],
  analytics:  ['message','stop','goto','log'],
  classify:   ['message','condition','stop','goto','use','log'],
  role:       ['message','condition','stop','goto','use','log'],
  block:      [...FLOW_CHILDREN],
  scenario:   ['step','message','typing','delay','condition','switch','ask','remember','get','save','random','loop','http','log','stop','goto','use'],
  step:       ['message','typing','delay','condition','switch','ask','remember','get','save','random','loop','http','log','stop','goto','use','step'],
  inline:     ['message','condition','stop','goto'],     // после inline тоже можно message
  use:        [...FLOW_CHILDREN],
  stop:       TERMINAL,
  goto:       TERMINAL,
  bot:        TERMINAL,
  version:    TERMINAL,
  global:     TERMINAL,
  commands:   TERMINAL,
  // ── Новые типы ───────────────────────────────────────────────────────────
  check_sub:   ['message','condition','stop','goto','use','log'],
  member_role: ['message','condition','remember','save','stop','goto','log'],
  forward_msg: ['message','condition','stop','goto','log'],
  broadcast:   ['message','stop','goto','log'],
  db_delete:   [...FLOW_NO_MEDIA, 'notify'],
  save_global: [...FLOW_NO_MEDIA],
  get_user:    [...FLOW_NO_MEDIA, 'notify'],
  all_keys:    [...FLOW_NO_MEDIA, 'notify'],
  call_block:  ['message','remember','save','condition','log','stop','goto','use'],
};

function canStackBelow(parentType, childType) {
  return (CAN_STACK_BELOW[parentType] || []).includes(childType);
}

/** Высота стека в координатах холста (согласовано с расчётом snap при перетаскивании стека) */
function getStackBlocksHeight(stack) {
  if (!stack?.blocks?.length) return 0;
  return stack.blocks.reduce((acc, b, i) => {
    const def = getBlockDef(b.type);
    const h = i === 0 ? ROOT_H : BLOCK_H;
    return acc + h + (def?.canStack && !['stop', 'goto', 'bot', 'version', 'global', 'commands'].includes(b.type) ? 0 : 0);
  }, 0);
}

const SNAP_NEW_TO_STACK_DX = 70;
const SNAP_NEW_TO_STACK_DY = 50;

/** Подносим новый блок с палитры к низу стека: в зоне snap — { stackId, valid }; иначе null */
function findNewBlockSnapTarget(stacks, worldGhostLeft, worldGhostTop, newType) {
  let best = null;
  let bestScore = Infinity;
  for (const s of stacks) {
    const last = s.blocks[s.blocks.length - 1];
    if (!last) continue;
    const stackBottom = s.y + getStackBlocksHeight(s);
    const dx = Math.abs(worldGhostLeft - s.x);
    const dy = Math.abs(worldGhostTop - stackBottom);
    if (dx < SNAP_NEW_TO_STACK_DX && dy < SNAP_NEW_TO_STACK_DY) {
      const score = dx + dy;
      if (score < bestScore) {
        bestScore = score;
        best = {
          stackId: s.id,
          valid: canStackBelow(last.type, newType),
          parentType: last.type,
        };
      }
    }
  }
  return best;
}

function snapAttachRejectHint(parentType, childType) {
  if ((childType === 'buttons' || childType === 'inline') && parentType !== 'message') {
    return '«Кнопки» и «Inline» — только после «Ответ»';
  }
  if (childType === 'inline' && parentType === 'inline') {
    return 'Подряд два inline нельзя — сначала «Ответ»';
  }
  return 'Сюда этот тип блока нельзя';
}

// Порядок подсказки «что поставить ниже» — сначала самые нужные новичку
const NEXT_BLOCK_PRIORITY = [
  'message', 'buttons', 'inline', 'condition', 'else', 'ask', 'remember', 'use',
  'typing', 'delay', 'get', 'save', 'random', 'photo', 'video', 'stop', 'goto',
  'log', 'loop', 'switch', 'http', 'menu', 'poll', 'document', 'send_file', 'audio', 'sticker',
  'contact', 'location', 'notify', 'broadcast', 'database', 'classify', 'role', 'payment', 'analytics',
  'check_sub', 'member_role', 'forward_msg', 'db_delete', 'save_global', 'get_user', 'all_keys', 'call_block',
];

function getSuggestedNextBlockLabels(parentType, max = 14) {
  const allowed = CAN_STACK_BELOW[parentType];
  if (!allowed?.length) return [];
  const set = new Set(allowed);
  const out = [];
  for (const t of NEXT_BLOCK_PRIORITY) {
    if (set.has(t)) {
      out.push(getBlockDef(t)?.label || t);
      if (out.length >= max) return out;
    }
  }
  for (const t of allowed) {
    const label = getBlockDef(t)?.label || t;
    if (!out.includes(label) && out.length < max) out.push(label);
  }
  return out;
}

/** Короткие подсказки для панели свойств (новичок) */
const BEGINNER_GUIDE = {
  version: 'Версия бота в шапке .ccd — для себя, один раз.',
  bot: 'Токен от @BotFather. Обязателен для запуска.',
  commands: 'Команды в меню Telegram (строка = одна команда). Показываются при вводе /.',
  global: 'Общая переменная на весь бот (одно значение для всех пользователей).',
  block: 'Именованный шаблон: внутри стека — обычная цепочка (ответ, кнопки…). Снаружи вызывай блоком «Использовать» с тем же именем (часто называют «приветствие», «главное_меню»).',
  use: 'Подставляет сюда код из блока «Блок» с тем же именем. Имя должно совпадать.',
  start: 'Точка входа при /start. Обычно: ответ приветствия → кнопки меню.',
  command: 'Реакция на /команда. В поле — имя без слэша (help для /help).',
  callback: 'Реакция на нажатие: для reply-клавиатуры — точный текст кнопки; для inline — callback из поля после «|».',
  on_photo: 'Срабатывает, когда пользователь прислал фото. Дальше — ответ, подпись к медиа и т.д.',
  on_voice: 'Срабатывает на голосовое сообщение.',
  on_document: 'Срабатывает на файл-документ.',
  on_sticker: 'Срабатывает на стикер.',
  on_location: 'Срабатывает на геолокацию (в DSL: при геолокации:).',
  on_contact: 'Срабатывает на отправленный контакт.',
  message: 'Текст ответа пользователю. Поддерживаются {переменные} и выражения в фигурных скобках.',
  buttons: 'Reply-клавиатура. Только после блока «Ответ» (нужен текст сообщения). Под «При нажатии» укажи тот же текст кнопки.',
  inline: 'Inline-кнопки под сообщением. Только после «Ответ». Формат: Текст|callback — под «При нажатии» укажи callback.',
  menu: 'Упрощённое меню из пунктов; часто перед переходами.',
  condition: 'Ветка если условие истинно. После можно добавить «Иначе» на том же уровне.',
  else: 'Ветка «во всех остальных случаях». Ставь сразу под связанным «Если».',
  switch: 'Много вариантов по значению переменной (аналог switch).',
  ask: 'Бот задаёт вопрос и ждёт ответа пользователя; дальнейшие блоки идут после ввода.',
  remember: 'Временная переменная в сессии пользователя (до перезапуска диалога).',
  get: 'Читает значение из постоянного хранилища по ключу в переменную.',
  save: 'Пишет значение в постоянное хранилище по ключу.',
  random: 'Случайно выбирает одну строку из списка; обычно дальше — «Ответ».',
  loop: 'Повторяет вложенные блоки. Добавь «Стоп» или «Переход», чтобы не зациклиться.',
  http: 'Запрос к URL; ответ можно сохранить в переменную из поля.',
  delay: 'Пауза в секундах перед следующим блоком.',
  typing: 'Индикатор «печатает…» перед следующим сообщением или медиа.',
  stop: 'Прерывает сценарий; дальше по этому стеку ничего не выполняется.',
  goto: 'Переход к сценарию, команде или шагу по имени из поля.',
  log: 'Запись в консоль сервера — удобно для отладки.',
  notify: 'Отправляет прямое сообщение пользователю по его Telegram ID. Поле «target» — числовой ID или переменная с ним.',
  broadcast: 'Рассылка всем (mode=all) или группе (mode=group + тег). Тег — значение поля _сегмент в профиле пользователя.',
  check_sub: 'Проверяет подписку через getChatMember API. Результат true/false сохраняется в переменную. Используй в условии «если» дальше.',
  member_role: 'Возвращает роль участника в канале/группе: creator, administrator, member, restricted, left, kicked.',
  forward_msg: 'Пересылает последнее входящее сообщение пользователя другому Telegram ID.',
  db_delete: 'Полностью удаляет ключ из БД (не обнуляет, а удаляет запись). Используй вместо сохранить "" = "".',
  save_global: 'Сохраняет значение в глобальную БД (общую для всех пользователей). Читать через обычный «Получить».',
  get_user: 'Читает данные ДРУГОГО пользователя по его ID. Только для adminской логики.',
  all_keys: 'Возвращает список всех ключей текущего пользователя в БД. Удобно для отладки и динамических операций.',
  call_block: 'Вызывает именованный блок и сохраняет значение «вернуть» в переменную. Блок должен содержать «вернуть значение».',
  database: 'SQL к внешней БД (если настроена).',
  payment: 'Инициация оплаты; нужны провайдер и сумма.',
  analytics: 'Событие для аналитики.',
  classify: 'Классификация текста по намерениям (AI).',
  role: 'Проверка роли пользователя.',
  photo: 'Отправка фото по URL или file_id.',
  video: 'Отправка видео.',
  audio: 'Отправка аудио.',
  document: 'Отправка файла.',
  send_file: 'Отправка уже сохранённого файла по Telegram file_id (не текстом). Укажите переменную или выражение.',
  sticker: 'Отправка стикера по file_id.',
  contact: 'Отправка контакта.',
  location: 'Отправка точки на карте.',
  poll: 'Опрос с вариантами ответа.',
  scenario: 'Именованный сценарий из шагов. На него можно перейти блоком «Переход».',
  step: 'Шаг внутри сценария. Переходы между шагами — блок «Переход».',
  middleware: 'Код до/после каждого сообщения (логирование, фильтры). Тип before или after.',
};

const NO_CHILD_HINT_TYPES = new Set(['stop', 'goto', 'bot', 'version', 'global', 'commands']);

function getBeginnerPanelHint(block, opts = {}) {
  const { omitSuggestedList = false } = opts;
  const t = block.type;
  const props = block.props || {};
  const parts = [];
  const base = BEGINNER_GUIDE[t];
  if (base) parts.push(base);

  if (t === 'block' && props.name?.trim()) {
    parts.push(`Сейчас имя «${props.name.trim()}». Вызов в другом месте: блок «Использовать» → то же имя (использовать ${props.name.trim()}).`);
  }
  if (t === 'use' && props.blockname?.trim()) {
    parts.push(`Должен быть отдельный стек с корнем «Блок» и именем «${props.blockname.trim()}».`);
  }
  if (t === 'command' && props.cmd) {
    parts.push(`В Telegram это команда /${String(props.cmd).replace(/^\//, '')}.`);
  }

  if (!omitSuggestedList && !NO_CHILD_HINT_TYPES.has(t)) {
    const next = getSuggestedNextBlockLabels(t, 16);
    if (next.length) {
      parts.push(`Ниже по цепочке (если разрешено редактором): ${next.join(' · ')}.`);
    }
  } else if (t === 'stop' || t === 'goto') {
    parts.push('Блоки под этим в стеке не выполняются — ставь «Стоп»/«Переход» в конце цепочки.');
  }

  return parts.filter(Boolean).join('\n\n');
}

// ─── DEFAULT PROPS ────────────────────────────────────────────────────────
const DEFAULT_PROPS = {
  version:    { version: '1.0' },
  bot:        { token: '' },
  commands:   { commands: '/start - Главное меню\n/help - Помощь' },
  global:     { varname: 'переменная', value: 'значение' },
  block:      { name: 'мой_блок' },
  use:        { blockname: 'мой_блок' },
  middleware:  { type: 'before' },
  start:      {},
  on_photo:   {},
  on_voice:   {},
  on_document:{},
  on_sticker: {},
  on_location:{},
  on_contact: {},
  message:    { text: 'Привет, {пользователь.имя}!' },
  buttons:    { rows: 'Кнопка 1, Кнопка 2' },
  command:    { cmd: 'start' },
  callback:   { label: 'Кнопка' },
  condition:  { cond: 'текст == "да"' },
  switch:     { varname: 'текст', cases: 'да\nнет' },
  ask:        { question: 'Как вас зовут?', varname: 'имя' },
  remember:   { varname: 'счёт', value: '0' },
  get:        { key: 'посещений', varname: 'счётчик' },
  save:       { key: 'посещений', value: 'счётчик' },
  scenario:   { name: 'регистрация' },
  random:     { variants: 'Привет!\nЗдорово!\nДаров!' },
  loop:       { mode: 'count', count: '3', cond: 'счёт > 0', var: 'элемент', collection: 'список', seconds: '5' },
  menu:       { title: 'Меню', items: 'Пункт 1\nПункт 2' },
  photo:      { url: '', caption: '' },
  video:      { url: '', caption: '' },
  audio:      { url: '' },
  document:   { url: '', filename: 'file.pdf' },
  send_file:  { file: '{сохранённый_файл}' },
  sticker:    { file_id: '' },
  contact:    { phone: '', first_name: '', last_name: '' },
  location:   { lat: '', lon: '' },
  poll:       { question: 'Ваш выбор?', options: 'Вариант 1\nВариант 2', type: 'regular' },
  delay:      { seconds: '2' },
  typing:     { seconds: '1' },
  http:       { method: 'GET', url: 'https://api.example.com/data', varname: 'результат', body: '', jsonVar: '', isJson: 'false' },
  goto:       { target: 'сценарий' },
  stop:       {},
  step:       { name: 'шаг1', text: 'Следующий шаг' },
  inline:     { buttons: 'Да|callback_да, Нет|callback_нет; навер|callback_нав' },
  notify:     { text: 'Ваш заказ готов!', target: 'user_id' },
  database:   { query: 'SELECT * FROM users', varname: 'результат' },
  classify:   { intents: 'заказ\nжалоба\nвопрос', varname: 'намерение' },
  log:        { message: '...', level: 'info' },
  role:       { roles: 'admin\nuser', varname: 'роль' },
  payment:    { provider: 'stripe', amount: '9.99', currency: 'USD', title: 'Подписка' },
  analytics:  { event: 'purchase' },
  // ── Новые типы ────────────────────────────────────────────────────────────
  check_sub:   { channel: '@mychannel', varname: 'подписан' },
  member_role: { channel: '@mychannel', user_id: 'пользователь.id', varname: 'роль_участника' },
  forward_msg: { target: 'ADMIN_ID' },
  broadcast:   { mode: 'all', text: 'Привет всем!', tag: '' },
  db_delete:   { key: 'мой_ключ' },
  save_global: { key: 'global_key', value: 'значение' },
  get_user:    { user_id: 'target_id', key: 'профиль_имя', varname: 'имя' },
  all_keys:    { varname: 'ключи' },
  call_block:  { blockname: 'мой_блок', varname: 'результат' },
};

/** Токен для нового блока «Бот»: test_token из профиля или первый непустой токен с холста. */
function resolveBotTokenForNewBlock(stacks, currentUser) {
  const fromProfile = currentUser?.test_token?.trim();
  if (fromProfile) return fromProfile;
  if (!Array.isArray(stacks)) return '';
  for (const s of stacks) {
    for (const b of s.blocks || []) {
      if (b.type === 'bot') {
        const t = String(b.props?.token ?? '').trim();
        if (t) return t;
      }
    }
  }
  return '';
}

// ─── PROPS FIELDS ─────────────────────────────────────────────────────────
const FIELDS = {
  version:   [{ key:'version',   label:'версия (например 1.0)',                        tag:'input' }],
  bot:       [{ key:'token',     label:'Telegram Bot Token',                           tag:'input' }],
  commands:  [{ key:'commands',  label:'команды (каждая с новой строки)\n/cmd - Описание', tag:'textarea', rows:5 }],
  global:    [{ key:'varname',   label:'имя переменной',  tag:'input' },
              { key:'value',     label:'значение',         tag:'input' }],
  block:     [{ key:'name',      label:'имя блока',        tag:'input' }],
  use:       [{ key:'blockname', label:'имя блока',        tag:'input' }],
  middleware: [{ key:'type',     label:'тип: before или after', tag:'input' },
              { key:'return',    label:'вернуть после (true/false)', tag:'input' }],
  start:     [],
  on_photo:  [],
  on_voice:  [],
  on_document:[],
  on_sticker:[],
  on_location:[],
  on_contact:[],
  message:   [{ key:'text',      label:'текст ответа',     tag:'textarea', rows:3 }],
  buttons:   [{ key:'rows',      label:'кнопки (запятая = в ряд, Enter = новый ряд)', tag:'textarea', rows:4 }],
  command:   [{ key:'cmd',       label:'команда (без /)',   tag:'input' }],
  callback:  [{ key:'label',     label:'текст кнопки',     tag:'input' },
              { key:'return',    label:'вернуть после (true/false)', tag:'input' }],
  condition: [{ key:'cond',      label:'условие',           tag:'input' }],
  else:      [],
  switch:    [{ key:'varname',   label:'переменная',        tag:'input' },
              { key:'cases',     label:'значения (каждое с новой строки)', tag:'textarea', rows:3 }],
  ask:       [{ key:'question',  label:'вопрос',            tag:'textarea', rows:2 },
              { key:'varname',   label:'переменная →',      tag:'input' }],
  remember:  [{ key:'varname',   label:'переменная',        tag:'input' },
              { key:'value',     label:'значение',           tag:'input' }],
  get:       [{ key:'key',       label:'ключ',              tag:'input' },
              { key:'varname',   label:'переменная →',      tag:'input' }],
  save:      [{ key:'key',       label:'ключ',              tag:'input' },
              { key:'value',     label:'значение',           tag:'input' }],
  scenario:  [{ key:'name',      label:'название',          tag:'input' }],
  step:      [{ key:'name',      label:'имя шага',          tag:'input' },
              { key:'text',      label:'текст',              tag:'textarea', rows:2 }],
  random:    [{ key:'variants',  label:'варианты (каждый с новой строки)', tag:'textarea', rows:4 }],
  loop:      [{ key:'mode',       label:'режим: count / while / foreach / timeout', tag:'input' },
              { key:'count',     label:'кол-во повторений (count)',                 tag:'input' },
              { key:'cond',      label:'условие (while)',                            tag:'input' },
              { key:'var',       label:'переменная элемента (foreach)',              tag:'input' },
              { key:'collection',label:'коллекция (foreach)',                        tag:'input' },
              { key:'seconds',   label:'секунд (timeout)',                           tag:'input' }],
  menu:      [{ key:'title',     label:'заголовок меню',    tag:'input' },
              { key:'items',     label:'пункты (каждый с новой строки)', tag:'textarea', rows:4 }],
  photo:     [{ key:'url',       label:'URL фото или file_id', tag:'input' },
              { key:'caption',   label:'подпись (опц.)',     tag:'textarea', rows:2 }],
  video:     [{ key:'url',       label:'URL видео или file_id', tag:'input' },
              { key:'caption',   label:'подпись (опц.)',     tag:'textarea', rows:2 }],
  audio:     [{ key:'url',       label:'URL аудио или file_id', tag:'input' }],
  document:  [{ key:'url',       label:'URL файла или file_id', tag:'input' },
              { key:'filename',  label:'имя файла',          tag:'input' }],
  send_file: [{ key:'file',      label:'file_id или {переменная}', tag:'input' }],
  sticker:   [{ key:'file_id',   label:'file_id стикера',   tag:'input' }],
  contact:   [{ key:'phone',     label:'номер телефона',     tag:'input' },
              { key:'first_name',label:'имя',                tag:'input' },
              { key:'last_name', label:'фамилия (опц.)',     tag:'input' }],
  location:  [{ key:'lat',       label:'широта (latitude)',  tag:'input' },
              { key:'lon',       label:'долгота (longitude)',tag:'input' }],
  poll:      [{ key:'question',  label:'вопрос',             tag:'input' },
              { key:'options',   label:'варианты (каждый с новой строки)', tag:'textarea', rows:3 },
              { key:'type',      label:'тип: regular или quiz', tag:'input' }],
  delay:     [{ key:'seconds',   label:'секунд',             tag:'input' }],
  typing:    [{ key:'seconds',   label:'секунд',             tag:'input' }],
  http:      [{ key:'method',  label:'метод: GET / POST / PATCH / PUT / DELETE / HEADERS', tag:'input' },
              { key:'url',     label:'URL (не нужен для HEADERS)',                           tag:'input' },
              { key:'body',    label:'тело с "данные" (опц., для POST/PATCH/PUT)',           tag:'input' },
              { key:'jsonVar', label:'json-переменная (опц., вместо body)',                  tag:'input' },
              { key:'isJson',  label:'тело — json-переменная? (true/false)',                 tag:'input' },
              { key:'varname', label:'переменная → (результат или имя переменной заголовков)', tag:'input' }],
  goto:      [{ key:'target',    label:'имя сценария',       tag:'input' }],
  stop:      [],
  inline:    [{ key:'buttons',   label:'кнопки: Текст|callback, ...\n(запятая = в ряд, Enter = новый ряд)', tag:'textarea', rows:4 }],
  database:  [{ key:'query',     label:'SQL запрос',         tag:'textarea', rows:3 },
              { key:'varname',   label:'переменная →',      tag:'input' }],
  classify:  [{ key:'intents',   label:'намерения (каждое с новой строки)', tag:'textarea', rows:3 },
              { key:'varname',   label:'переменная →',      tag:'input' }],
  log:       [{ key:'message',   label:'сообщение',          tag:'input' },
              { key:'level',     label:'уровень: info/warn/error', tag:'input' }],
  role:      [{ key:'roles',     label:'роли (каждая с новой строки)', tag:'textarea', rows:3 },
              { key:'varname',   label:'переменная с ролью', tag:'input' }],
  payment:   [{ key:'provider',  label:'провайдер: stripe / telegram', tag:'input' },
              { key:'amount',    label:'сумма',              tag:'input' },
              { key:'currency',  label:'валюта (USD, EUR...)', tag:'input' },
              { key:'title',     label:'название платежа',   tag:'input' }],
  analytics: [{ key:'event',     label:'название события',   tag:'input' },
              { key:'params',    label:'параметры (опц.)',    tag:'textarea', rows:2 }],
  // ── Новые типы ────────────────────────────────────────────────────────────
  notify:      [{ key:'target',  label:'user_id или переменная',                  tag:'input' },
                { key:'text',    label:'текст уведомления',                        tag:'textarea', rows:2 }],
  broadcast:   [{ key:'mode',   label:'режим: all или group',                     tag:'input' },
                { key:'tag',    label:'тег группы (если mode=group)',              tag:'input' },
                { key:'text',   label:'текст рассылки',                            tag:'textarea', rows:2 }],
  check_sub:   [{ key:'channel',label:'канал (например @mychannel)',               tag:'input' },
                { key:'varname',label:'переменная → (true/false)',                 tag:'input' }],
  member_role: [{ key:'channel',label:'канал (например @mychannel)',               tag:'input' },
                { key:'user_id',label:'user_id (или переменная)',                  tag:'input' },
                { key:'varname',label:'переменная → (creator/admin/member/left)',  tag:'input' }],
  forward_msg: [{ key:'target', label:'user_id или переменная',                   tag:'input' }],
  db_delete:   [{ key:'key',    label:'ключ для удаления из БД',                  tag:'input' }],
  save_global: [{ key:'key',   label:'ключ (глобальная БД)',                       tag:'input' },
                { key:'value', label:'значение',                                   tag:'input' }],
  get_user:    [{ key:'user_id',label:'user_id другого пользователя',             tag:'input' },
                { key:'key',   label:'ключ в его БД',                              tag:'input' },
                { key:'varname',label:'переменная →',                             tag:'input' }],
  all_keys:    [{ key:'varname',label:'переменная → (список ключей)',              tag:'input' }],
  call_block:  [{ key:'blockname',label:'имя блока (вернуть внутри)',              tag:'input' },
                { key:'varname', label:'переменная → (результат вернуть)',         tag:'input' }],
};

function getBlockDef(type) { return BLOCK_TYPES.find(b => b.type === type); }

// ─── SMART PROP INFERENCE ─────────────────────────────────────────────────────
// Смотрит на блок-родитель (верхний в стеке) и подставляет умные дефолты
// для нового блока типа newType. Возвращает объект props или {} если ничего не нашёл.
function inferPropsFromParent(parentBlock, newType, allBlocksInStack) {
  if (!parentBlock) return {};
  const p = parentBlock.props || {};
  const parentType = parentBlock.type;

  // Собираем все переменные, определённые выше в стеке (ask → varname, get → varname, remember → varname)
  const definedVars = [];
  (allBlocksInStack || []).forEach(b => {
    if (b.props?.varname) definedVars.push(b.props.varname);
    if (b.props?.key) definedVars.push(b.props.key);
  });
  const lastVar = definedVars[definedVars.length - 1] || '';

  switch (newType) {

    // ── Сохранить: берём ключ и значение из контекста родителя ───────────────
    case 'save': {
      // После ask — сохраняем то что спросили
      if (parentType === 'ask') {
        return { key: p.varname || '', value: p.varname || '' };
      }
      // После get — сохраняем обратно по тому же ключу
      if (parentType === 'get') {
        return { key: p.key || '', value: p.varname || '' };
      }
      // После remember — тот же varname
      if (parentType === 'remember') {
        return { key: p.varname || '', value: p.varname || '' };
      }
      // После http — сохраняем результат запроса
      if (parentType === 'http') {
        return { key: p.varname || 'результат', value: p.varname || 'результат' };
      }
      // Если в стеке есть переменная — предлагаем её
      if (lastVar) {
        return { key: lastVar, value: lastVar };
      }
      return {};
    }

    // ── Получить: берём ключ из контекста ────────────────────────────────────
    case 'get': {
      if (parentType === 'save') {
        return { key: p.key || '', varname: p.key || '' };
      }
      if (parentType === 'ask') {
        return { key: p.varname || '', varname: p.varname || '' };
      }
      if (lastVar) {
        return { key: lastVar, varname: lastVar };
      }
      return {};
    }

    // ── Запомнить: берём varname из ask/get ──────────────────────────────────
    case 'remember': {
      if (parentType === 'ask') {
        return { varname: p.varname || '', value: '' };
      }
      if (parentType === 'get') {
        return { varname: p.varname || '', value: p.varname || '' };
      }
      if (lastVar) {
        return { varname: lastVar, value: '' };
      }
      return {};
    }

    // ── Условие: строим условие из переменной родителя ───────────────────────
    case 'condition': {
      if (parentType === 'ask') {
        return { cond: `${p.varname || 'ответ'} == ""` };
      }
      if (parentType === 'get') {
        return { cond: `${p.varname || 'значение'} == ""` };
      }
      if (parentType === 'remember') {
        return { cond: `${p.varname || 'переменная'} == ""` };
      }
      if (parentType === 'save') {
        return { cond: `${p.key || 'ключ'} == ""` };
      }
      if (parentType === 'http') {
        return { cond: `${p.varname || 'результат'} != ""` };
      }
      return {};
    }

    // ── Ответ: подсказываем использовать переменную ───────────────────────────
    case 'message': {
      if (parentType === 'ask') {
        return { text: `Вы ввели: {${p.varname || 'ответ'}}` };
      }
      if (parentType === 'get') {
        return { text: `{${p.varname || 'значение'}}` };
      }
      if (parentType === 'http') {
        return { text: `{${p.varname || 'результат'}}` };
      }
      return {};
    }

    // ── Переход: берём цель из контекста ─────────────────────────────────────
    case 'goto': {
      // После callback — часто переходят к сценарию с похожим именем
      if (parentType === 'callback') {
        return { target: (p.label || '').toLowerCase().replace(/\s+/g, '_') };
      }
      return {};
    }

    // ── Спросить: берём вопрос из текста ответа выше ─────────────────────────
    case 'ask': {
      if (parentType === 'message') {
        // Если текст выглядит как вопрос — предлагаем varname
        const text = p.text || '';
        const isQuestion = text.includes('?') || text.includes(':');
        return isQuestion ? { question: text, varname: '' } : {};
      }
      return {};
    }

    // ── Переключатель: берём varname из контекста ────────────────────────────
    case 'switch': {
      if (lastVar) return { varname: lastVar, cases: '' };
      return {};
    }

    default:
      return {};
  }
}

function getPreview(type, props) {
  const p = props || {};
  switch(type) {
    case 'version':    return `v${p.version||'1.0'}`;
    case 'bot':        return (p.token||'TOKEN').slice(0,20);
    case 'commands':   return (p.commands||'').split('\n')[0]?.slice(0,28)||'';
    case 'global':     return `${p.varname||''} = ${p.value||''}`;
    case 'block':      return p.name||'';
    case 'use':        return p.blockname||'';
    case 'middleware':  return p.type === 'before' ? 'до каждого' : 'после каждого';
    case 'message':    return `"${(p.text||'').slice(0,28)}"`;
    case 'buttons':    return (p.rows||'').split('\n')[0]?.slice(0,28)||'';
    case 'command':    return `"/${p.cmd||'start'}"`;
    case 'callback':   return `"${p.label||'Кнопка'}"`;
    case 'condition':  return p.cond?.slice(0,28)||'';
    case 'else':       return 'иначе';
    case 'switch':     return `${p.varname||'текст'}: ...`;
    case 'ask':        return `"${(p.question||'').slice(0,24)}"`;
    case 'remember':   return `${p.varname||''} = ${p.value||''}`;
    case 'get':        return `"${p.key||''}" → ${p.varname||''}`;
    case 'save':       return `"${p.key||''}" = ${p.value||''}`;
    case 'goto':       return `→ "${p.target||''}"`;
    case 'delay':      return `${p.seconds||'2'}с`;
    case 'typing':     return `${p.seconds||'1'}с`;
    case 'http':       return `${p.method||'GET'} ${(p.url||'').slice(0,20)}`;
    case 'scenario':   return p.name||'';
    case 'step':       return p.name||'';
    case 'menu':       return p.title||'';
    case 'log':        return `[${p.level||'info'}]`;
    case 'notify':     return (p.text||'').slice(0,24);
    case 'payment':    return `${p.provider||'stripe'} ${p.amount||''}`;
    case 'analytics':  return p.event||'';
    case 'loop':       return p.mode === 'while' ? `пока ${p.cond||'...'}` : `×${p.count||'3'}`;
    case 'sticker':    return (p.file_id||'FILE_ID').slice(0,20);
    case 'contact':    return `${p.first_name||''} ${p.phone||''}`.trim();
    case 'location':   return `${p.lat||'0'}, ${p.lon||'0'}`;
    case 'poll':       return (p.question||'').slice(0,28);
    case 'send_file':  return (p.file||'file').slice(0,24);
    case 'on_photo':   return 'входящее фото';
    case 'on_voice':   return 'голосовое';
    case 'on_document':return 'входящий документ';
    case 'on_sticker': return 'стикер';
    case 'on_location':return 'геолокация';
    case 'on_contact': return 'контакт';
    default: return '';
  }
}

// ─── ID GENERATOR ─────────────────────────────────────────────────────────
let seq = 1;
const uid = () => `b${seq++}`;

// ─── PUZZLE SVG PATH ──────────────────────────────────────────────────────
// Blocks snap vertically. Tab protrudes from bottom, socket on top.
function puzzlePath(w, h, hasTopSocket, hasBottomTab) {
  const R  = 6;   // corner radius
  const TW = 10;  // tab width (horizontal protrusion from bottom)
  const TH = 8;   // tab height (vertical)
  const TX = 22;  // tab X from left

  // Top edge: flat with socket notch if hasTopSocket
  let top = `M ${R} 0`;
  if (hasTopSocket) {
    top += ` L ${TX} 0 C ${TX} -${TH} ${TX+TW} -${TH} ${TX+TW} 0`;
  }
  top += ` L ${w-R} 0 Q ${w} 0 ${w} ${R}`;

  // Right edge
  const right = `L ${w} ${h-R} Q ${w} ${h} ${w-R} ${h}`;

  // Bottom edge: tab protrudes down if hasBottomTab
  let bottom;
  if (hasBottomTab) {
    bottom = `L ${TX+TW} ${h} C ${TX+TW} ${h+TH} ${TX} ${h+TH} ${TX} ${h} L ${R} ${h} Q 0 ${h} 0 ${h-R}`;
  } else {
    bottom = `L ${R} ${h} Q 0 ${h} 0 ${h-R}`;
  }

  // Left edge
  const left = `L 0 ${R} Q 0 0 ${R} 0`;

  return `${top} ${right} ${bottom} ${left} Z`;
}

function darken(hex, amt = 40) {
  const n = parseInt(hex.replace('#',''), 16);
  const r = Math.max(0, (n >> 16) - amt);
  const g = Math.max(0, ((n >> 8) & 0xff) - amt);
  const b = Math.max(0, (n & 0xff) - amt);
  return `rgb(${r},${g},${b})`;
}

// ─── BLOCK DIMENSIONS ────────────────────────────────────────────────────
const BLOCK_W  = 200;
const BLOCK_H  = 36;  // regular block
const ROOT_H   = 42;  // first block in stack (root)

// ─── SINGLE BLOCK VISUAL ──────────────────────────────────────────────────
// Предупреждения и заметки для конкретных блоков
const BLOCK_NOTES = {
  start:    { icon: '💡', color: '#3ecf8e', text: 'Точка входа /start. Часто: «Ответ» или «Использовать» с именем блока «приветствие» / главное_меню.' },
  command:  { icon: '💡', color: '#fbbf24', text: 'Своя команда: в поле имя без / (help → /help). Можно связать с пунктом из «Команды меню».' },
  block:    { icon: '💡', color: '#a78bfa', text: 'Именованный фрагмент сценария. Внутри — цепочка блоков; снаружи вызывай «Использовать» с тем же именем.' },
  message:  { icon: '💡', color: '#5b7cf6', text: 'Текст сообщения. Перед «Кнопки» и «Inline» в ядре нужен текст — сначала «Ответ».' },
  scenario: { icon: '💡', color: '#34d399', text: 'Сценарий из шагов. Перейти сюда: блок «Переход» → имя сценария.' },
  step:     { icon: '💡', color: '#059669', text: 'Шаг внутри сценария. К другому шагу — «Переход» с именем шага.' },
  middleware:{ icon: '💡', color: '#64748b', text: 'before/after — до или после каждого сообщения. «вернуть» прерывает обработку.' },
  on_photo: { icon: '💡', color: '#34d399', text: 'Когда прислали фото. Дальше — ответ, подпись, кнопки как в обычном диалоге.' },
  on_voice: { icon: '💡', color: '#818cf8', text: 'Когда прислали голосовое. Дальше — тот же набор блоков, что после «Ответ».' },
  on_document:{ icon: '💡', color: '#94a3b8', text: 'Когда прислали документ. Дальше — ответ, логика, сохранение файла и т.д.' },
  send_file:  { icon: '💡', color: '#64748b', text: 'Вызывает Telegram sendDocument: передайте file_id из переменной (не путать с текстом в «Ответ»).' },
  on_sticker:{ icon: '💡', color: '#f472b6', text: 'Когда прислали стикер.' },
  on_location:{ icon: '💡', color: '#ef4444', text: 'Когда поделились геолокацией (в .ccd: при геолокации:).' },
  on_contact:{ icon: '💡', color: '#0ea5e9', text: 'Когда отправили контакт.' },
  inline:   { icon: '⚠️', color: '#f59e0b', text: 'Inline-кнопки работают только после блока «Ответ» — без текста сообщение не отправится. Нажатия ловит блок «При нажатии» (callback).' },
  buttons:  { icon: '⚠️', color: '#f59e0b', text: 'Обычные кнопки меняют раскладку клавиатуры пользователя. Работают только после блока «Ответ».' },
  callback: { icon: '💡', color: '#60a5fa', text: 'Нажатие кнопки: для inline — тот же callback, что после «|»; для reply-клавиатуры — точный текст кнопки из блока «Кнопки».' },
  else:     { icon: '⚠️', color: '#f59e0b', text: 'Блок «Иначе» должен идти сразу после блока «Если».' },
  stop:     { icon: '🛑', color: '#ef4444', text: 'Блок «Стоп» завершает выполнение сценария. После него блоки не добавляются.' },
  goto:     { icon: '↩️', color: '#a3a3a3', text: 'Блок «Переход» передаёт управление другому сценарию. После него блоки не выполняются.' },
  ask:      { icon: '💡', color: '#60a5fa', text: 'Бот ждёт ввода от пользователя. Следующий шаг выполнится только после его ответа.' },
  condition:{ icon: '💡', color: '#60a5fa', text: 'После «Если» можно добавить «Иначе» для обработки альтернативной ветки.' },
  http:     { icon: '💡', color: '#60a5fa', text: 'Укажи «переменная →» чтобы сохранить ответ сервера и использовать его в следующих блоках.' },
  remember: { icon: '💡', color: '#60a5fa', text: 'Значение хранится только в рамках текущей сессии пользователя.' },
  save:     { icon: '💡', color: '#60a5fa', text: 'Данные сохраняются в БД и доступны между сессиями.' },
  bot:      { icon: '⚠️', color: '#f59e0b', text: 'Обязательно укажи токен от @BotFather. Без токена бот не запустится.' },
  version:  { icon: '💡', color: '#60a5fa', text: 'Версия указывается один раз в начале файла.' },
  use:      { icon: '💡', color: '#60a5fa', text: 'Вызывает ранее объявленный блок «Блок» по имени.' },
  loop:       { icon: '⚠️', color: '#f59e0b', text: 'Режимы: count (повторить N раз), while (пока условие), foreach (для каждого в коллекции), timeout (с ограничением по времени). Добавь «Прервать» или «Стоп» внутри чтобы выйти.' },
  payment:    { icon: '⚠️', color: '#f59e0b', text: 'Для Telegram-платежей нужен токен провайдера от @BotFather.' },
  classify:   { icon: '💡', color: '#60a5fa', text: 'Классифицирует текст пользователя по заданным намерениям с помощью AI.' },
  random:     { icon: '💡', color: '#60a5fa', text: 'Каждый раз выбирает случайный вариант из списка.' },
  // ── Новые типы ────────────────────────────────────────────────────────────
  check_sub:   { icon: '💡', color: '#10b981', text: 'Реальная проверка подписки через Telegram API. Результат true/false — проверяй после через «Если».' },
  member_role: { icon: '💡', color: '#059669', text: 'Возвращает роль: creator → administrator → member → restricted → left → kicked.' },
  forward_msg: { icon: '💡', color: '#34d399', text: 'Пересылает последнее входящее сообщение пользователя. Работает только внутри обработчиков сообщений.' },
  broadcast:   { icon: '⚠️', color: '#0ea5e9', text: 'Рассылка отправляет сообщения последовательно — для больших баз может занять время. Используй только из обработчика кнопки.' },
  db_delete:   { icon: '💡', color: '#ef4444', text: 'Удаляет ключ полностью, не обнуляет. Для обнуления используй «Сохранить» с пустым значением.' },
  save_global: { icon: '💡', color: '#10b981', text: 'Глобальная БД одна для всех пользователей. Читается через обычный «Получить».' },
  get_user:    { icon: '⚠️', color: '#f59e0b', text: 'Читает данные ДРУГОГО пользователя — только для admin-функций. В «user_id» укажи ID цели.' },
  all_keys:    { icon: '💡', color: '#64748b', text: 'Возвращает список всех ключей текущего пользователя. Хорошо сочетается с циклом «для каждого».' },
  call_block:  { icon: '💡', color: '#8b5cf6', text: 'Блок должен содержать «вернуть значение». Результат сохранится в указанную переменную.' },
};

function BlockNoteBox({ note, compact }) {
  return (
    <div style={{
      display: 'flex', gap: compact ? 8 : 6, alignItems: 'flex-start',
      background: note.color + (compact ? '14' : '18'),
      border: `1px solid ${note.color}${compact ? '40' : '44'}`,
      borderRadius: compact ? 10 : 6,
      padding: compact ? '10px 12px' : '6px 8px',
      marginBottom: compact ? 12 : 8,
      fontSize: compact ? 12 : 10,
      color: note.color,
      lineHeight: 1.55,
    }}>
      <span style={{ flexShrink: 0, fontSize: compact ? 16 : undefined }}>{note.icon}</span>
      <span>{note.text}</span>
    </div>
  );
}

/** Список типов блоков, которые можно поставить под данным (по CAN_STACK_BELOW). mode: tooltip — тёмный фон тултипа; modal — панель модалки */
function CompatibleBlocksHint({ type, color, mode = 'tooltip', onAdd }) {
  const allowed = CAN_STACK_BELOW[type] || [];
  const isModal = mode === 'modal';
  const grouped = {};
  allowed.forEach(ct => {
    const d = BLOCK_TYPES.find(b => b.type === ct);
    if (!d) return;
    if (!grouped[d.group]) grouped[d.group] = [];
    grouped[d.group].push(d);
  });
  const groupOrder = ['Основные', 'Логика', 'Медиа', 'Действия', 'Telegram', 'Данные', 'Сценарии', 'Настройки', 'Middleware'];

  if (allowed.length === 0) {
    return (
      <div style={{
        fontSize: isModal ? 12 : 11,
        color: isModal ? 'var(--text3)' : 'rgba(255,255,255,0.5)',
        fontStyle: 'italic',
      }}>
        Нельзя добавить блоки снизу
      </div>
    );
  }

  return (
    <div style={{ minWidth: isModal ? undefined : 200, maxWidth: isModal ? undefined : 260 }}>
      <div style={{
        fontSize: isModal ? 11 : 10,
        fontWeight: 700,
        color: isModal ? 'var(--text)' : color,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        marginBottom: isModal ? 10 : 8,
        fontFamily: 'Syne, system-ui',
        borderBottom: isModal ? '1px solid var(--border)' : `1px solid ${color}44`,
        paddingBottom: isModal ? 8 : 5,
      }}>Можно добавить снизу</div>
      {groupOrder.map(g => {
        if (!grouped[g]) return null;
        return (
          <div key={g} style={{ marginBottom: isModal ? 10 : 6 }}>
            <div style={{
              fontSize: isModal ? 10 : 9,
              color: isModal ? 'var(--text3)' : 'rgba(255,255,255,0.4)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: isModal ? 5 : 3,
              fontFamily: 'Syne, system-ui',
            }}>{g}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: isModal ? 5 : 3 }}>
              {grouped[g].map(def => {
                const hasNote = !!BLOCK_NOTES[def.type];
                return (
                  <span key={def.type}
                  onClick={isModal && onAdd ? (e) => { e.stopPropagation(); onAdd(def.type); } : undefined}
                  title={isModal && onAdd ? `Добавить блок «${def.label}»` : undefined}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    background: isModal ? `${def.color}18` : def.color + '22',
                    border: `1px solid ${hasNote ? def.color + (isModal ? '55' : 'aa') : def.color + (isModal ? '35' : '55')}`,
                    borderRadius: 6,
                    padding: isModal ? '4px 8px' : '2px 5px',
                    fontSize: isModal ? 11 : 10,
                    color: def.color,
                    fontFamily: 'system-ui',
                    cursor: (isModal && onAdd) ? 'pointer' : 'default',
                    transition: 'background 0.15s',
                  }}>
                    <span style={{ fontSize: isModal ? 12 : 9 }}>{def.icon}</span>
                    {def.label}
                    {hasNote && <span style={{ fontSize: 8, opacity: 0.7 }}>ℹ</span>}
                    {isModal && onAdd && <span style={{ fontSize: 11, opacity: 0.7, marginLeft: 1 }}>＋</span>}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BlockTooltip({ type, color }) {
  const allowed = CAN_STACK_BELOW[type] || [];
  const note = BLOCK_NOTES[type];

  if (allowed.length === 0) return (
    <div style={{ minWidth: 200, maxWidth: 260 }}>
      {note && <BlockNoteBox note={note} compact={false} />}
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontStyle: 'italic' }}>
        Нельзя добавить блоки снизу
      </div>
    </div>
  );

  return (
    <div style={{ minWidth: 200, maxWidth: 260 }}>
      {note && <BlockNoteBox note={note} compact={false} />}
      <CompatibleBlocksHint type={type} color={color} mode="tooltip" />
    </div>
  );
}

function BlockShape({ type, props, isFirst, selected, onClick, onDelete }) {
  const def = getBlockDef(type);
  if (!def) return null;

  const openBlockInfo = React.useContext(BlockInfoContext);
  const addBlockCtx = React.useContext(AddBlockContext);
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  const color   = def.color;
  const icon    = def.icon;
  const label   = def.label;
  const preview = getPreview(type, props);

  // Puzzle notch logic
  const hasTopSocket  = !isFirst;
  const hasBottomTab  = def.canStack && !['stop','goto','bot','version','global','commands'].includes(type);
  const h = isFirst ? ROOT_H : BLOCK_H;
  const path = puzzlePath(BLOCK_W, h, hasTopSocket, hasBottomTab);
  const dark = darken(color, 45);

  return (
    <div
      style={{
        position: 'relative',
        width: BLOCK_W + 4,
        height: h + (hasBottomTab ? 8 : 0),
        marginBottom: hasBottomTab ? -8 : 0,
        cursor: 'grab',
        userSelect: 'none',
      }}
      onClick={onClick}
    >
      <svg
        width={BLOCK_W + 24}
        height={h + 24}
        viewBox={`-4 -8 ${BLOCK_W + 16} ${h + 16}`}
        style={{
          position: 'absolute', top: 0, left: 0,
          overflow: 'visible', pointerEvents: 'none',
          filter: selected
            ? `drop-shadow(0 0 7px ${color}cc) drop-shadow(0 2px 10px rgba(0,0,0,.8))`
            : 'drop-shadow(0 2px 7px rgba(0,0,0,.65))',
        }}
      >
        <path d={path} fill="rgba(0,0,0,0.35)" transform="translate(0,3)" />
        <path d={path} fill={color} />
        <clipPath id={`hc-${type}-${isFirst}`}><rect x="0" y="0" width={BLOCK_W} height={h} /></clipPath>
        <path d={path} fill={dark} clipPath={`url(#hc-${type}-${isFirst})`} opacity="0.45" />
        <path d={path} fill="rgba(255,255,255,0.12)" />
        <path d={path} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.2" />
        <path d={path} fill="none" stroke="rgba(0,0,0,0.28)" strokeWidth="1" transform="translate(0,1)" />
        {selected && <path d={path} fill="none" stroke="white" strokeWidth="2" opacity="0.85" />}
      </svg>

      {/* Content */}
      <div style={{
        position: 'absolute', top: 0, left: 0,
        width: BLOCK_W, height: h,
        display: 'flex', alignItems: 'center',
        padding: '0 8px 0 10px', gap: 6, zIndex: 2,
      }}>
        <span style={{ fontSize: isFirst ? 14 : 12, flexShrink: 0, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.5))' }}>
          {icon}
        </span>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{
            fontSize: isFirst ? 11 : 10, fontWeight: 700, color: '#fff',
            fontFamily: 'Syne, system-ui', whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis',
            textShadow: '0 1px 3px rgba(0,0,0,.7)', letterSpacing: '0.02em',
          }}>
            {label}
          </div>
          {preview && (
            <div style={{
              fontSize: 9, color: 'rgba(255,255,255,0.78)',
              fontFamily: 'JetBrains Mono, monospace',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              textShadow: '0 1px 2px rgba(0,0,0,.5)', marginTop: 1,
            }}>
              {preview}
            </div>
          )}
        </div>
        {(!isMobile || selected) && (
        <button
          type="button"
          title="Справка: что делает блок и что можно поставить ниже"
          aria-label="Справка по блоку"
          onClick={e => {
            e.stopPropagation();
            if (openBlockInfo) openBlockInfo({ type, props: props || {} });
          }}
          style={{
            width: 26, height: 26, minWidth: 26, minHeight: 26, borderRadius: '50%',
            background: 'rgba(255,255,255,0.15)', color: '#fff',
            fontSize: 13, display: 'flex', alignItems: 'center',
            justifyContent: 'center', border: '1.5px solid rgba(255,255,255,0.35)',
            cursor: 'pointer', flexShrink: 0, fontWeight: 700, lineHeight: 1,
            fontFamily: 'Georgia, serif', fontStyle: 'italic', transition: 'background 0.15s',
            boxSizing: 'border-box', padding: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.35)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.18)'; }}
        >i</button>
        )}
        {selected && (
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            style={{
              width: 26, height: 26, minWidth: 26, minHeight: 26, borderRadius: '50%',
              background: 'linear-gradient(135deg, #ff4444, #cc2222)', color: '#fff',
              fontSize: 14, display: 'flex', alignItems: 'center',
              justifyContent: 'center', border: '1.5px solid rgba(255,100,100,0.4)',
              cursor: 'pointer', flexShrink: 0, fontWeight: 700, lineHeight: 1,
              boxSizing: 'border-box', padding: 0,
              boxShadow: '0 2px 6px rgba(255,50,50,0.4)',
            }}>×</button>
        )}
      </div>
    </div>
  );
}

// ─── BLOCK INFO MODAL ─────────────────────────────────────────────────────────
function BlockInfoModal({ block, onClose }) {
  const type = block?.type;
  const def = getBlockDef(type);
  const addBlock = React.useContext(AddBlockContext);
  if (!def || !type) return null;
  const color = def.color;
  const note = BLOCK_NOTES[type];
  const extendedHint = getBeginnerPanelHint(block, { omitSuggestedList: true });

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        background: 'rgba(0,0,0,0.78)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        padding: 12,
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="block-info-title"
    >
      <div
        style={{
          width: '100%', maxWidth: 520, maxHeight: 'min(86vh, 640px)',
          background: 'var(--bg2)', borderRadius: 14,
          border: `1px solid ${color}44`,
          borderTop: `3px solid ${color}`,
          display: 'flex', flexDirection: 'column',
          boxShadow: `0 24px 64px rgba(0,0,0,0.75), 0 0 0 1px ${color}18`,
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10,
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 22 }}>{def.icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="block-info-title" style={{ fontSize: 17, fontWeight: 700, color, fontFamily: 'Syne, system-ui' }}>
              {def.label}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'Syne, system-ui', textTransform: 'uppercase', letterSpacing: '0.12em', marginTop: 2 }}>
              {def.group}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: 34, height: 34, borderRadius: '50%',
              background: 'var(--bg3)', color: 'var(--text)',
              fontSize: 18, border: '1px solid var(--border2)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 18px' }}>
          {note && <BlockNoteBox note={note} compact />}
          {extendedHint && (
            <div style={{
              marginTop: note ? 12 : 0,
              padding: '10px 12px',
              borderRadius: 10,
              background: 'rgba(96, 165, 250, 0.08)',
              border: '1px solid rgba(96, 165, 250, 0.22)',
              fontSize: 11,
              lineHeight: 1.55,
              color: 'var(--text2)',
              whiteSpace: 'pre-wrap',
            }}>
              <div style={{
                fontSize: 9, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 6, fontWeight: 700,
              }}>Подсказка</div>
              {extendedHint}
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            <CompatibleBlocksHint type={type} color={color} mode="modal" onAdd={addBlock ? (t) => { addBlock(t); onClose(); } : undefined} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── BLOCK STACK ──────────────────────────────────────────────────────────
/** newBlockDrop: 'valid' | 'invalid' | null — подсветка при перетаскивании блока с палитры */
function BlockStack({ stack, selectedId, onSelectBlock, onDeleteBlock, onDragStack, isDragTarget, newBlockDrop, newBlockDropHint }) {
  return (
    <div
      style={{
        position: 'absolute', left: stack.x, top: stack.y,
        zIndex: stack.dragging ? 1000 : (isDragTarget ? 500 : 1),
        opacity: stack.dragging ? 0.45 : 1,
        borderRadius: newBlockDrop ? 10 : 0,
        outline: newBlockDrop === 'invalid'
          ? '2px solid rgba(248,113,113,0.95)'
          : newBlockDrop === 'valid'
            ? '2px solid rgba(56,189,248,0.85)'
            : 'none',
        outlineOffset: 3,
        transition: 'outline 0.12s ease',
      }}
      onMouseDown={e => {
        if (e.target.tagName === 'BUTTON') return;
        e.stopPropagation();
        onDragStack(stack.id, e);
      }}
      onTouchStart={e => {
        if (e.target.tagName === 'BUTTON') return;
        e.stopPropagation();
        const touch = e.touches[0];
        onDragStack(stack.id, { clientX: touch.clientX, clientY: touch.clientY });
      }}
    >
      {stack.blocks.map((block, i) => (
        <BlockShape
          key={block.id}
          type={block.type}
          props={block.props}
          isFirst={i === 0}
          selected={selectedId === block.id}
          onClick={e => { e.stopPropagation(); onSelectBlock(block.id, stack.id); }}
          onDelete={() => onDeleteBlock(stack.id, block.id)}
        />
      ))}

      {/* Drop zone: слияние стека */}
      {isDragTarget && (
        <div style={{
          width: BLOCK_W, height: 12,
          background: 'rgba(80,200,255,0.35)',
          border: '2px dashed rgba(80,200,255,0.75)',
          borderRadius: 4, marginTop: 2,
        }} />
      )}
      {/* Подсказка при перетаскивании нового блока с палитры */}
      {newBlockDrop === 'valid' && (
        <div style={{
          width: BLOCK_W, marginTop: 4,
          padding: '5px 6px',
          borderRadius: 6,
          background: 'rgba(56,189,248,0.12)',
          border: '1px dashed rgba(56,189,248,0.65)',
          fontSize: 9,
          color: '#7dd3fc',
          textAlign: 'center',
          fontWeight: 600,
        }}>Отпусти — прикрепить сюда</div>
      )}
      {newBlockDrop === 'invalid' && (
        <div style={{
          width: BLOCK_W, marginTop: 4,
          padding: '6px 8px',
          borderRadius: 6,
          background: 'rgba(239,68,68,0.14)',
          border: '2px dashed rgba(248,113,113,0.85)',
          fontSize: 9,
          color: '#fca5a5',
          textAlign: 'center',
          lineHeight: 1.35,
          fontWeight: 600,
        }}>{newBlockDropHint || 'Сюда нельзя'}</div>
      )}
    </div>
  );
}

// ─── SIDEBAR ─────────────────────────────────────────────────────────────
const GROUPS_ORDER = ['Настройки','Основные','Логика','Медиа','Действия','Сценарии','Middleware'];

function Sidebar({ onDragStart, onDragEnd, onTapAdd }) {
  const groups = {};
  BLOCK_TYPES.forEach(b => {
    if (!groups[b.group]) groups[b.group] = [];
    groups[b.group].push(b);
  });

  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      {GROUPS_ORDER.map(gname => {
        const blocks = groups[gname];
        if (!blocks) return null;
        return (
          <div key={gname}>
            <div className="editor-group-header">{gname}</div>
            {blocks.map(b => (
              <div
                key={b.type}
                draggable
                onDragStart={e => {
                  e.dataTransfer.setData('cicada/new-type', b.type);
                  onDragStart(b.type);
                }}
                onDragEnd={() => { onDragEnd && onDragEnd(); }}
                onClick={() => onTapAdd && onTapAdd(b.type)}
                className="editor-sidebar-block"
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 10px', cursor: 'pointer', userSelect: 'none',
                  transition: 'background .15s',
                }}
              >
                <span style={{
                  width: 22, height: 22, borderRadius: 4,
                  background: b.color + '28', color: b.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, flexShrink: 0,
                }}>{b.icon}</span>
                <div style={{ fontSize: 12, color: 'var(--text)', flex: 1 }}>{b.label}</div>
                {onTapAdd && <span style={{ fontSize: 16, color: 'var(--text3)', opacity: 0.5 }}>+</span>}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ─── PROPS PANEL ──────────────────────────────────────────────────────────
function PropsPanel({ block, onChange }) {
  if (!block) return (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--text3)', fontSize: 11, padding: 16, textAlign: 'center',
    }}>
      Нажми на блок<br />чтобы изменить его
    </div>
  );
  const def = getBlockDef(block.type);
  const fields = FIELDS[block.type] || [];
  const props = block.props || {};
  const beginnerHint = getBeginnerPanelHint(block);
  return (
    <div style={{ overflowY: 'auto', flex: 1, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 14 }}>{def?.icon}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: def?.color }}>{def?.label}</span>
      </div>
      {beginnerHint && (
        <div style={{
          marginBottom: 12,
          padding: '8px 10px',
          borderRadius: 8,
          background: 'rgba(96, 165, 250, 0.08)',
          border: '1px solid rgba(96, 165, 250, 0.22)',
          fontSize: 10,
          lineHeight: 1.55,
          color: 'var(--text2)',
          whiteSpace: 'pre-wrap',
        }}>
          <div style={{
            fontSize: 9,
            color: '#60a5fa',
            textTransform: 'uppercase',
            letterSpacing: '.08em',
            marginBottom: 5,
            fontWeight: 600,
          }}>Подсказка</div>
          {beginnerHint}
        </div>
      )}
      {fields.map(f => (
        <div key={f.key} style={{ marginBottom: 8 }}>
          <div style={{
            fontSize: 9, color: 'var(--text3)', marginBottom: 3,
            textTransform: 'uppercase', letterSpacing: '.08em',
          }}>{f.label.split('\n')[0]}</div>
          {f.tag === 'textarea' ? (
            <textarea
              rows={f.rows || 3}
              value={props[f.key] || ''}
              onChange={e => onChange(f.key, e.target.value)}
              style={{ resize: 'vertical', lineHeight: 1.5 }}
            />
          ) : (
            <input
              value={props[f.key] || ''}
              onChange={e => onChange(f.key, e.target.value)}
            />
          )}
        </div>
      ))}
      {fields.length === 0 && (
        <div style={{ color: 'var(--text3)', fontSize: 10 }}>Нет настроек</div>
      )}
    </div>
  );
}

// ─── DSL VALIDATOR ────────────────────────────────────────────────────────
// Общая логика проверки вынесена в core/validator/uiDslValidator.js,
// чтобы UI и серверная AI-генерация использовали одни и те же правила.

function buildAutoFixFromValidation(code, validationResult) {
  if (!validationResult) return { correctedCode: code, changedLineIndexes: [], fixes: [] };

  const fixes = [...(validationResult.fixes || [])];
  let text = validationResult.correctedCode || code;
  let lines = text.split('\n');
  const changed = new Set(validationResult.changedLineIndexes || []);

  const markLineChangedByContent = (targetLine) => {
    const idx = lines.findIndex((ln) => ln === targetLine);
    if (idx >= 0) changed.add(idx);
  };

  const hasEmptyTokenError = (validationResult.errors || []).some((e) =>
    e.includes('пустой токен бота'),
  );
  const dslHasEmptyBotToken = code.split(/\n/).some((raw) => {
    const ln = raw.trim();
    const m = ln.match(/^бот\s+"([^"]*)"\s*$/);
    return m !== null && (!m[1] || !String(m[1]).trim());
  });
  if (hasEmptyTokenError || dslHasEmptyBotToken) {
    for (let i = 0; i < lines.length; i += 1) {
      if (/^\s*бот\s+"[^"]*"\s*$/.test(lines[i])) {
        const before = lines[i];
        const after = 'бот "PASTE_BOT_TOKEN_HERE"';
        if (before !== after) {
          lines[i] = after;
          changed.add(i);
          fixes.push({
            line: i + 1,
            message: 'Не указан токен бота — подставлен placeholder (вставь токен от @BotFather или замени строку сам)',
            before,
            after,
          });
        }
        break;
      }
    }
  }

  const missingStartError = (validationResult.errors || []).some((e) =>
    e.includes('Нет «при старте»'),
  );
  if (missingStartError) {
    const beforeLen = lines.length;
    if (lines.length > 0 && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push('при старте:');
    lines.push('    ответ "Привет!"');
    changed.add(beforeLen + (beforeLen > 0 && lines[beforeLen - 1] !== '' ? 1 : 0));
    changed.add(lines.length - 1);
    fixes.push({
      line: beforeLen + 1,
      message: 'Добавлен базовый обработчик старта',
      before: '',
      after: 'при старте: ...',
    });
  }

  const emptyBlockRegex = /Строка\s+(\d+):\s+блок\s+"([^"]+)"\s+пустой/;
  const emptyBlockLines = [...new Set(
    (validationResult.warnings || [])
      .map((w) => Number(w.match(emptyBlockRegex)?.[1] || 0))
      .filter((n) => Number.isInteger(n) && n > 0),
  )].sort((a, b) => b - a);

  emptyBlockLines.forEach((lineNo) => {
    const idx = lineNo - 1;
    if (idx < 0 || idx >= lines.length) return;

    const header = lines[idx];
    if (!header.trim().endsWith(':')) return;

    const currentIndent = ((header.match(/^\s*/) || [''])[0] || '').replace(/\t/g, '    ').length;
    const nextLine = lines[idx + 1];
    if (typeof nextLine === 'string' && nextLine.trim()) {
      const nextIndent = ((nextLine.match(/^\s*/) || [''])[0] || '').replace(/\t/g, '    ').length;
      if (nextIndent > currentIndent) return;
    }

    const inserted = `${' '.repeat(currentIndent + 4)}ответ "..."`;
    lines.splice(idx + 1, 0, inserted);
    changed.add(idx + 1);
    fixes.push({
      line: idx + 2,
      message: 'Добавлена базовая дочерняя инструкция для непустого блока',
      before: '',
      after: inserted,
    });
  });

  const undefinedVarRegex = /Переменная "([^"]+)" используется, но нигде не определена/;
  const blockedAutoDeclare = new Set([...RUNTIME_PROPERTY_NAMES, 'name', 'email', 'phone', 'token']);
  const undefinedVars = [...new Set(
    (validationResult.warnings || [])
      .map((w) => w.match(undefinedVarRegex)?.[1] || '')
      .filter((name) => !!name)
      .filter((name) => !name.includes('.'))
      .filter((name) => !blockedAutoDeclare.has(name))
      .filter((name) => /^[а-яёa-zA-Z_][а-яёa-zA-Z_0-9]*$/.test(name)),
  )];

  if (undefinedVars.length > 0) {
    const alreadyDefined = new Set();
    lines.forEach((line) => {
      const g = line.trim().match(/^глобально\s+([а-яёa-zA-Z_][а-яёa-zA-Z_0-9]*)\s*=/);
      if (g) alreadyDefined.add(g[1]);
    });

    const toInsert = undefinedVars
      .filter((v) => !alreadyDefined.has(v))
      .map((v) => `глобально ${v} = ""`);

    if (toInsert.length > 0) {
      let insertAt = 0;
      for (let i = 0; i < lines.length; i += 1) {
        const t = lines[i].trim();
        if (!t || t.startsWith('#') || t.startsWith('версия ') || t.startsWith('бот ')) {
          insertAt = i + 1;
          continue;
        }
        break;
      }

      lines.splice(insertAt, 0, ...toInsert);
      toInsert.forEach((line, idx) => {
        changed.add(insertAt + idx);
        fixes.push({
          line: insertAt + idx + 1,
          message: 'Добавлена глобальная переменная для устранения неопределённости',
          before: '',
          after: line,
        });
      });
    }
  }

  text = lines.join('\n');
  return {
    correctedCode: text,
    changedLineIndexes: [...changed].sort((a, b) => a - b),
    fixes,
  };
}

// ─── DSL PANEL ────────────────────────────────────────────────────────────
function DSLPane({ stacks, isMobile, onApplyCorrectedCode }) {
  const dsl = generateDSL(stacks);
  const [validationResult, setValidationResult] = React.useState(null);
  /** После «Применить исправления»: показываем исправленный текст и подсветку строк */
  const [previewCorrected, setPreviewCorrected] = React.useState(null);
  const [highlightRows, setHighlightRows] = React.useState([]); // 0-based индексы строк

  React.useEffect(() => {
    setValidationResult(null);
    setPreviewCorrected(null);
    setHighlightRows([]);
  }, [dsl]);

  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    const doCopy = (text) => {
      if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text);
      }
      // HTTP fallback via textarea
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return Promise.resolve();
    };
    const textOut = previewCorrected ?? dsl;
    doCopy(textOut).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => {});
  };
  const download = () => {
    const textOut = previewCorrected ?? dsl;
    const blob = new Blob([textOut], { type: 'text/plain;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob), download: 'bot.ccd',
    });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const check = async () => {
    const result = validateDSL(dsl, stacks);
    try {
      const response = await postJsonWithCsrf('/api/dsl/lint', { code: dsl });
      const jr = await response.json().catch(() => ({}));
      const pyAvailable = jr?.available !== false;

      if (response.ok && pyAvailable) {
        if (Array.isArray(jr.diagnostics) && jr.diagnostics.length > 0) {
          const pyMsgs = jr.diagnostics.map(
            (d) => `${formatDSLDiagnostic(d)} [ядро Cicada]`,
          );
          result.errors = (result.errors || []).filter((e) =>
            typeof e !== 'string' ? true : !(e.includes('[DSL003]') || e.includes('[DSL001]')),
          );
          result.errors = [...pyMsgs, ...result.errors];
        } else if (jr.ok) {
          result.errors = (result.errors || []).filter((e) =>
            typeof e !== 'string' ? true : !(e.includes('[DSL003]') || e.includes('[DSL001]')),
          );
        }
      } else if (jr?.available === false && jr?.error) {
        result.warnings.push(`⚠️ Ядро Cicada: ${jr.error}`);
      } else if (jr?.error) {
        result.warnings.push(`⚠️ Проверка ядром Cicada: ${jr.error}`);
      }
      // Core hints are shown in the dedicated hints panel below.
      // Do not duplicate them in warnings to avoid mixing diagnostics with suggestions.
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.warnings.push(`⚠️ Не удалось вызвать ядро Cicada (${msg}). Показана только эвристика в браузере.`);
    }
    setValidationResult(result);
    setPreviewCorrected(null);
    setHighlightRows([]);
  };

  const applySuggestedFixes = () => {
    if (!validationResult) return;
    const autoFixed = buildAutoFixFromValidation(dsl, validationResult);
    if (!autoFixed.fixes.length) return;
    const applied = onApplyCorrectedCode?.(autoFixed.correctedCode);
    if (!applied) {
      // fallback: хотя бы показать пользователю исправленный текст в превью
      setPreviewCorrected(autoFixed.correctedCode);
      setHighlightRows(autoFixed.changedLineIndexes || []);
    }
  };

  const resetPreview = () => {
    setPreviewCorrected(null);
    setHighlightRows([]);
  };

  const insertSnippet = (snippet) => {
    const clean = String(snippet || '').trim();
    if (!clean) return;
    const base = previewCorrected ?? dsl;
    const nextCode = `${base.replace(/\s*$/, '')}\n${clean}\n`;
    const applied = onApplyCorrectedCode?.(nextCode);
    if (!applied) setPreviewCorrected(nextCode);
  };

  const computedFixes = React.useMemo(
    () => (validationResult ? buildAutoFixFromValidation(dsl, validationResult) : null),
    [dsl, validationResult],
  );
  const hasAutoFixForEmptyToken = (computedFixes?.fixes || []).some(
    (fx) => /токен бота/i.test(String(fx?.message || '')),
  );
  const visibleErrors = (validationResult?.errors || []).filter(
    (err) => !(hasAutoFixForEmptyToken && String(err).toLowerCase().includes('пустой токен бота')),
  );
  const hasErrors = visibleErrors.length > 0;
  const hasWarnings = (validationResult?.warnings?.length ?? 0) > 0;
  const isValid = validationResult && !hasErrors && !hasWarnings;
  const hasFixes = (computedFixes?.fixes?.length ?? 0) > 0;

  const displayCode = previewCorrected ?? dsl;
  const displayLines = displayCode.split('\n');

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      borderTop: '1px solid var(--border)',
      flex: isMobile ? 1 : '0 0 280px',
      minHeight: 0,
      minWidth: 0,
    }}>
      <div style={{
        padding: '5px 10px', display: 'flex', alignItems: 'center',
        justifyContent: 'flex-start', borderBottom: '1px solid var(--border)',
        minWidth: 0,
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, justifyContent: 'flex-start', width: '100%', minWidth: 0 }}>
          <button
            onClick={check}
            style={{
              background: validationResult
                ? (hasErrors ? '#ef4444' : hasWarnings ? '#f59e0b' : '#10b981')
                : 'var(--bg3)',
              color: validationResult ? '#fff' : 'var(--text3)',
              padding: '2px 7px', borderRadius: 4, fontSize: 9, border: 'none'
            }}
            onMouseEnter={e => { if (!validationResult) e.target.style.background = 'var(--accent)'; }}
            onMouseLeave={e => { if (!validationResult) e.target.style.background = 'var(--bg3)'; }}
          >проверить</button>
          <button
            onClick={copy}
            style={{ background: copied ? 'var(--accent)' : 'transparent', color: copied ? '#fff' : 'var(--text3)', padding: '2px 7px', border: `1px solid ${copied ? 'var(--accent)' : 'var(--border2)'}`, borderRadius: 4, fontSize: 9, transition: 'all 0.2s' }}
            onMouseEnter={e => { if (!copied) { e.currentTarget.style.color = 'var(--text)'; } }}
            onMouseLeave={e => { if (!copied) { e.currentTarget.style.color = 'var(--text3)'; } }}
          >{copied ? '✓ copied' : 'copy'}</button>
          <button
            onClick={download}
            style={{ background: 'var(--accent)', color: '#fff', padding: '2px 7px', borderRadius: 4, fontSize: 9, border: 'none' }}
            onMouseEnter={e => e.target.style.background = 'var(--accent2)'}
            onMouseLeave={e => e.target.style.background = 'var(--accent)'}
          >↓ .ccd</button>
          <button
            type="button"
            onClick={applySuggestedFixes}
            disabled={!hasFixes || !!previewCorrected}
            style={{
              background: (!hasFixes || previewCorrected) ? 'var(--bg3)' : '#0ea5e9',
              color: (!hasFixes || previewCorrected) ? 'var(--text3)' : '#fff',
              padding: '2px 7px',
              borderRadius: 4,
              fontSize: 9,
              border: 'none',
              cursor: (!hasFixes || previewCorrected) ? 'default' : 'pointer',
              opacity: (!hasFixes || previewCorrected) ? 0.7 : 1,
            }}
            title={!validationResult ? 'Сначала нажми «проверить»' : (!hasFixes ? 'Нет доступных автоисправлений' : 'Применить автоисправления')}
          >
            Исправить{hasFixes ? ` (${computedFixes?.fixes?.length || 0})` : ''}
          </button>
        </div>
      </div>

      {/* Validation Results */}
      {validationResult && (
        <div style={{
          padding: '6px 10px', borderBottom: '1px solid var(--border)',
          background: hasErrors ? 'rgba(239,68,68,0.1)' : hasWarnings ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.1)',
          maxHeight: '150px', overflowY: 'auto',
        }}>
          {isValid && !hasFixes ? (
            <div style={{ fontSize: 10, color: '#10b981', fontWeight: 600 }}>✅ Всё отлично! Ошибок нет.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {visibleErrors.map((err, i) => (
                <div key={`err-${i}`} style={{ fontSize: 9, color: '#ef4444' }}>{err}</div>
              ))}
              {validationResult.warnings.map((warn, i) => (
                <div key={`warn-${i}`} style={{ fontSize: 9, color: '#f59e0b' }}>{warn}</div>
              ))}
              {(computedFixes?.fixes || []).slice(0, 5).map((fx, i) => {
                const beforeT = String(fx.before || '').trim();
                const hideEmptyBotBefore = /^бот\s+""\s*$/i.test(beforeT);
                return (
                  <div key={`fx-${i}`} style={{ fontSize: 9, color: '#38bdf8', lineHeight: 1.45 }}>
                    💡 Строка {fx.line}: {fx.message}
                    <div style={{ opacity: 0.85, marginTop: 2, fontFamily: 'var(--mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {!hideEmptyBotBefore && (
                        <>
                          <span style={{ color: '#f87171' }}>− {fx.before.trimEnd()}</span>
                          {'\n'}
                        </>
                      )}
                      <span style={{ color: '#4ade80' }}>+ {fx.after.trimEnd()}</span>
                    </div>
                  </div>
                );
              })}
              {hasFixes && (computedFixes?.fixes?.length || 0) > 5 && (
                <div style={{ fontSize: 8, color: 'var(--text3)' }}>
                  …и ещё {(computedFixes?.fixes?.length || 0) - 5} автоисправлений
                </div>
              )}
              {previewCorrected && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  <button
                    type="button"
                    onClick={resetPreview}
                    style={{
                      background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)',
                      borderRadius: 4, fontSize: 9, padding: '4px 8px', cursor: 'pointer',
                    }}
                  >Сбросить превью</button>
                  <button
                    type="button"
                    onClick={copy}
                    style={{
                      background: '#10b981', color: '#fff', border: 'none',
                      borderRadius: 4, fontSize: 9, padding: '4px 8px', cursor: 'pointer',
                    }}
                  >Копировать исправленный код</button>
                </div>
              )}
              {previewCorrected && (
                <div style={{ fontSize: 8, color: 'var(--text3)', marginTop: 2 }}>
                  Зелёным подсвечены изменённые строки. Код генерируется с холста — после правок обновите блоки или вставьте текст вручную.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      

      <div style={{
        flex: 1, margin: 0, padding: '7px 10px',
        fontSize: 9, lineHeight: 1.65, color: 'var(--text2)',
        fontFamily: 'var(--mono)', overflowY: 'auto',
        background: previewCorrected ? 'rgba(16,185,129,0.06)' : 'var(--bg)',
        borderTop: previewCorrected ? '1px solid rgba(16,185,129,0.25)' : undefined,
      }}>
        {displayLines.map((line, i) => {
          const isHl = previewCorrected && highlightRows.includes(i);
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 8,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                background: isHl ? 'rgba(74,222,128,0.22)' : undefined,
                outline: isHl ? '1px solid rgba(74,222,128,0.45)' : undefined,
                marginLeft: isHl ? -2 : 0,
                paddingLeft: isHl ? 2 : 0,
                borderRadius: isHl ? 3 : 0,
              }}
            >
              <span style={{
                flexShrink: 0, width: 28, textAlign: 'right',
                userSelect: 'none', opacity: 0.35, color: 'var(--text3)',
              }}>{i + 1}</span>
              <span style={{ flex: 1 }}>{line || '\u00a0'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── CANVAS AUTOSAVE (guest vs logged-in аккаунт) ───────────────────────────
function canvasKeyForUser(user) {
  if (user?.id != null) return `cicada_canvas_u_${user.id}`;
  return 'cicada_canvas';
}

function loadCanvasForKey(key) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

function saveCanvasForKey(key, stacks, offset, scale) {
  try {
    localStorage.setItem(key, JSON.stringify({ stacks, offset, scale }));
  } catch {/* ignore */}
}

const PREVIEW_SESSION_STORAGE_KEY = 'cicada_preview_session_id';

function getOrCreatePreviewSessionId() {
  try {
    let s = sessionStorage.getItem(PREVIEW_SESSION_STORAGE_KEY);
    if (!s || s.length < 8) {
      s =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `pv_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
      sessionStorage.setItem(PREVIEW_SESSION_STORAGE_KEY, s);
    }
    return s;
  } catch {
    return `pv_${Date.now()}`;
  }
}

function previewOutboundToEntries(outbound) {
  const skip = new Set(['answer_callback', 'set_commands']);
  const entries = [];
  for (const o of outbound || []) {
    if (skip.has(o.type)) continue;
    if (o.type === 'send_message' || o.type === 'markdown') {
      entries.push({ role: 'bot', kind: 'text', text: o.text ?? '' });
    } else if (o.type === 'reply_keyboard') {
      entries.push({
        role: 'bot',
        kind: 'reply_keyboard',
        text: o.text ?? '',
        keyboard: Array.isArray(o.keyboard) ? o.keyboard : [],
      });
    } else if (o.type === 'inline_keyboard') {
      entries.push({
        role: 'bot',
        kind: 'inline_keyboard',
        text: o.text ?? '',
        rows: Array.isArray(o.keyboard) ? o.keyboard : [],
      });
    } else if (o.type === 'photo') {
      entries.push({
        role: 'bot',
        kind: 'text',
        text: `[фото] ${o.source ?? ''}${o.caption ? `\n${o.caption}` : ''}`,
      });
    } else if (o.type === 'api_call') {
      entries.push({ role: 'bot', kind: 'sys', text: `API ${o.method ?? '?'}` });
    } else {
      entries.push({ role: 'bot', kind: 'sys', text: String(o.type || '?') });
    }
  }
  return entries;
}

function OnboardingTour({ steps, stepIndex, onNext, onPrev, onSkip }) {
  const step = steps[stepIndex];
  const [targetRect, setTargetRect] = useState(null);

  useEffect(() => {
    if (!step?.selector) {
      setTargetRect(null);
      return;
    }
    const updateRect = () => {
      const el = document.querySelector(step.selector);
      if (!el) {
        setTargetRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setTargetRect({
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
      });
    };
    updateRect();
    const id = setInterval(updateRect, 250);
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    return () => {
      clearInterval(id);
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [step?.selector]);

  if (!step) return null;

  const isLast = stepIndex >= steps.length - 1;
  const cardTop = targetRect
    ? Math.min(window.innerHeight - 190, Math.max(16, targetRect.top + targetRect.height + 12))
    : Math.max(20, (window.innerHeight - 180) / 2);
  const cardLeft = targetRect
    ? Math.min(window.innerWidth - 340, Math.max(12, targetRect.left))
    : Math.max(12, (window.innerWidth - 320) / 2);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 20000, pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(2,6,12,0.7)' }} />

      {targetRect && (
        <div
          style={{
            position: 'absolute',
            top: targetRect.top - 6,
            left: targetRect.left - 6,
            width: targetRect.width + 12,
            height: targetRect.height + 12,
            borderRadius: 12,
            border: '2px solid #f97316',
            boxShadow: '0 0 0 9999px rgba(2,6,12,0.62), 0 0 28px rgba(249,115,22,0.55)',
            transition: 'all 0.2s ease',
          }}
        />
      )}

      <div
        style={{
          position: 'absolute',
          top: cardTop,
          left: cardLeft,
          width: 'min(320px, calc(100vw - 24px))',
          background: 'linear-gradient(160deg,#0d0920,#10082a)',
          border: '1px solid rgba(249,115,22,0.35)',
          borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 0 24px rgba(249,115,22,0.1)',
          padding: 14,
          pointerEvents: 'auto',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div style={{ fontSize: 10, color: 'rgba(249,115,22,0.8)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 6 }}>
          Шаг {stepIndex + 1} из {steps.length}
        </div>
        <div style={{ fontFamily: 'Syne,system-ui', fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 7 }}>
          {step.title}
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.55, color: 'rgba(255,255,255,0.72)', marginBottom: 12 }}>
          {step.text}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <button
            onClick={onSkip}
            style={{ background: 'transparent', color: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '7px 10px', fontSize: 12, cursor: 'pointer' }}
          >
            Пропустить
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onPrev}
              disabled={stepIndex === 0}
              style={{ background: 'rgba(255,255,255,0.05)', color: stepIndex === 0 ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '7px 10px', fontSize: 12, cursor: stepIndex === 0 ? 'not-allowed' : 'pointer' }}
            >
              Назад
            </button>
            <button
              onClick={onNext}
              style={{ background: 'linear-gradient(135deg,#f97316,#dc2626)', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(249,115,22,0.4)' }}
            >
              {isLast ? 'Готово' : 'Далее'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────
export default function App() {
  const [currentUser, setCurrentUser] = useState(() => getSession());
  const canvasStorageKey = React.useMemo(() => canvasKeyForUser(currentUser), [currentUser?.id]);

  const [stacks, setStacks] = useState([]);
  const [selectedBlockId, setSelectedBlockId] = useState(null);
  const [selectedStackId, setSelectedStackId] = useState(null);
  const [canvasOffset, setCanvasOffset] = useState({ x: 0, y: 0 });
  const [canvasScale, setCanvasScale] = useState(1);
  const [showInstructions, setShowInstructions] = useState(false);
  /** { type, props } — окно справки по кнопке «i» на блоке */
  const [blockInfo, setBlockInfo] = useState(null);
  const [canvasDrag, setCanvasDrag] = useState(null);
  const [draggingStack, setDraggingStack] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [draggingNewType, setDraggingNewType] = useState(null);
  const [ghostPos, setGhostPos] = useState(null);
  /** При перетаскивании с палитры: стек под курсором + можно ли прикрепить */
  const [newBlockSnap, setNewBlockSnap] = useState(null);
  const canvasRef = useRef(null);

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [oauth2faPending, setOauth2faPending] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [authTab, setAuthTab] = useState('login'); // 'login' | 'register'
  const [userProjects, setUserProjects] = useState([]);
  const [projectName, setProjectName] = useState('');
  const [showExamples, setShowExamples] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [showPythonConvertModal, setShowPythonConvertModal] = useState(false);
  const [pythonConvertSource, setPythonConvertSource] = useState('');
  const [pythonConvertResult, setPythonConvertResult] = useState('');
  const [pythonConvertMeta, setPythonConvertMeta] = useState(null);
  const [pythonConvertLoading, setPythonConvertLoading] = useState(false);
  const [pythonConvertError, setPythonConvertError] = useState('');
  const [landingInfoPage, setLandingInfoPage] = useState(null); // features | templates | docs | pricing | null

  // Toast notification state
  const [toast, setToast] = useState(null); // { message, type, visible }

  // ─── ADMIN / TRIAL ───────────────────────────────────────────────────────
  
  const isAdmin = currentUser?.role === 'admin';
  /** Активная подписка PRO или пробный период — те же условия, что для AI и платных функций. */
  const hasActiveProSubscription = Boolean(
    currentUser &&
      currentUser.plan === 'pro' &&
      currentUser.subscriptionExp != null &&
      Number(currentUser.subscriptionExp) > Date.now(),
  );
  const canSeeCode = isAdmin || hasActiveProSubscription;
  const canUseAiGenerator = hasActiveProSubscription;

  // Mobile state
  const [mobileTab, setMobileTab] = useState('canvas'); // 'canvas' | 'blocks' | 'props' | 'dsl'
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const [isMobileView, setIsMobileView] = useState(() => window.innerWidth < 768);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [showFilesMenu, setShowFilesMenu] = useState(false);
  const [tourActive, setTourActive] = useState(false);
  const [tourStep, setTourStep] = useState(0);

  const onboardingKey = currentUser
    ? `cicada_onboarding_v1_${currentUser.id}_${isMobileView ? 'mobile' : 'desktop'}`
    : null;

  const onboardingSteps = React.useMemo(() => {
    if (isMobileView) {
      const steps = [
        {
          selector: '[data-tour="mobile-tab-blocks"]',
          title: 'Панель блоков',
          text: 'Откройте вкладку «Блоки», чтобы добавлять элементы сценария бота.',
          onEnter: () => setMobileTab('blocks'),
        },
        {
          selector: '[data-tour="mobile-tab-canvas"]',
          title: 'Холст',
          text: 'На холсте вы соединяете блоки и собираете логику бота.',
          onEnter: () => setMobileTab('canvas'),
        },
        {
          selector: '[data-tour="mobile-tab-props"]',
          title: 'Свойства',
          text: 'Здесь настраиваются параметры выбранного блока.',
          onEnter: () => setMobileTab('props'),
        },
        {
          selector: '[data-tour="mobile-run"]',
          title: 'Запуск',
          text: 'Кнопкой запуска можно стартовать и останавливать бота.',
          onEnter: () => setMobileTab('canvas'),
        },
        {
          selector: '[data-tour="profile-button"]',
          title: 'Профиль',
          text: 'В профиле находятся проекты, подписка, настройки и поддержка.',
        },
      ];
      return steps;
    }
    return [
      {
        selector: '[data-tour="top-examples-desktop"]',
        title: 'Примеры',
        text: 'Быстрый способ загрузить готовый пример и посмотреть, как устроены сценарии.',
      },
      {
        selector: '[data-tour="save-cloud-desktop"]',
        title: 'Сохранение в облако',
        text: 'Сохраняйте текущий проект в аккаунт, чтобы открыть его позже с любого устройства.',
      },
      {
        selector: '[data-tour="run-desktop"]',
        title: 'Старт и стоп',
        text: 'Запускайте бота и останавливайте его прямо из верхней панели.',
      },
      {
        selector: '[data-tour="sidebar-desktop"]',
        title: 'Блоки',
        text: 'Слева список блоков, из которых собирается логика бота.',
      },
      {
        selector: '[data-tour="canvas-area"]',
        title: 'Рабочий холст',
        text: 'Центральная зона, где редактируется структура вашего бота.',
      },
      {
        selector: '[data-tour="props-panel-desktop"]',
        title: 'Свойства и код',
        text: 'Справа находятся свойства выбранного блока и DSL-код.',
      },
      {
        selector: '[data-tour="profile-button"]',
        title: 'Профиль',
        text: 'Здесь доступны аккаунт, проекты, подписка и поддержка.',
      },
    ];
  }, [isMobileView]);

  // Если триал-юзер оказался на вкладке dsl — сбросить
  useEffect(() => {
    if (!canSeeCode && mobileTab === 'dsl') setMobileTab('canvas');
  }, [canSeeCode, mobileTab]);

  useEffect(() => {
    const handler = () => setIsMobileView(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  useEffect(() => {
    if (!currentUser || !onboardingKey) {
      setTourActive(false);
      setTourStep(0);
      return;
    }
    if (localStorage.getItem(onboardingKey) === 'done') return;
    const id = setTimeout(() => {
      setTourStep(0);
      setTourActive(true);
    }, 450);
    return () => clearTimeout(id);
  }, [currentUser, onboardingKey]);

  useEffect(() => {
    if (!tourActive) return;
    const step = onboardingSteps[tourStep];
    if (step?.onEnter) step.onEnter();
  }, [tourActive, tourStep, onboardingSteps]);

  const finishTour = useCallback(() => {
    if (onboardingKey) localStorage.setItem(onboardingKey, 'done');
    setTourActive(false);
    setTourStep(0);
  }, [onboardingKey]);

  const skipNextCanvasSave = useRef(false);

  useEffect(() => {
    skipNextCanvasSave.current = true;
    const data = loadCanvasForKey(canvasStorageKey);
    setSelectedBlockId(null);
    setSelectedStackId(null);
    if (data?.stacks && Array.isArray(data.stacks)) {
      setStacks(data.stacks);
      setCanvasOffset(data.offset ?? { x: 0, y: 0 });
      const sc = data.scale;
      setCanvasScale(typeof sc === 'number' && !Number.isNaN(sc) ? sc : 1);
    } else {
      setStacks([]);
      setCanvasOffset({ x: 0, y: 0 });
      setCanvasScale(1);
    }
  }, [canvasStorageKey]);

  useEffect(() => {
    if (skipNextCanvasSave.current) {
      skipNextCanvasSave.current = false;
      return;
    }
    saveCanvasForKey(canvasStorageKey, stacks, canvasOffset, canvasScale);
  }, [canvasStorageKey, stacks, canvasOffset, canvasScale]);

  const loadUserProjects = async (userId) => {
    // Однократная миграция: если есть старые проекты в localStorage — загрузим их в БД
    const MIGRATE_KEY = `cicada_migrated_${userId}`;
    if (!localStorage.getItem(MIGRATE_KEY)) {
      try {
        const raw = localStorage.getItem('cicada_projects');
        if (raw) {
          const oldProjects = JSON.parse(raw).filter(p => p.userId === userId);
          for (const p of oldProjects) {
            if (p.name && p.stacks) {
              await saveProjectToCloud(userId, p.name, p.stacks).catch(() => {});
            }
          }
          if (oldProjects.length > 0) {
            localStorage.removeItem('cicada_projects');
          }
        }
      } catch { /* silent */ }
      localStorage.setItem(MIGRATE_KEY, '1');
    }
    const projects = await getUserProjects(userId);
    setUserProjects(projects);
  };

  // Toast notification helper
  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type, visible: true });
    setTimeout(() => {
      setToast(prev => prev ? { ...prev, visible: false } : null);
      setTimeout(() => setToast(null), 300); // wait for fade out animation
    }, 4000);
  }, []);

  const openAiGeneratorModal = useCallback(() => {
    if (!canUseAiGenerator) {
      showToast('AI-генерация доступна только с активной подпиской PRO.', 'error');
      return;
    }
    setShowAIModal(true);
    setAiPrompt('');
    setAiError('');
  }, [canUseAiGenerator, showToast]);

  const selectedBlock = React.useMemo(() => {
    if (!selectedBlockId) return null;
    for (const s of stacks) {
      const b = s.blocks.find(b => b.id === selectedBlockId);
      if (b) return b;
    }
    return null;
  }, [stacks, selectedBlockId]);


  const handleSelectBlock = useCallback((blockId, stackId) => {
    setSelectedBlockId(blockId);
    setSelectedStackId(stackId);
  }, []);

  const handleDeleteBlock = useCallback((stackId, blockId) => {
    setStacks(prev => {
      return prev.map(s => {
        if (s.id !== stackId) return s;
        const blocks = s.blocks.filter(b => b.id !== blockId);
        return blocks.length === 0 ? null : { ...s, blocks };
      }).filter(Boolean);
    });
    setSelectedBlockId(null);
    setSelectedStackId(null);
  }, []);

  const handlePropChange = useCallback((key, val) => {
    if (!selectedBlockId) return;
    setStacks(prev => prev.map(s => ({
      ...s,
      blocks: s.blocks.map(b =>
        b.id === selectedBlockId ? { ...b, props: { ...b.props, [key]: val } } : b
      ),
    })));
  }, [selectedBlockId]);

  const handleDragStack = useCallback((stackId, e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const stack = stacks.find(s => s.id === stackId);
    if (!stack) return;
    const offsetX = (e.clientX - rect.left - canvasOffset.x) / canvasScale - stack.x;
    const offsetY = (e.clientY - rect.top  - canvasOffset.y) / canvasScale - stack.y;
    setDraggingStack({ stackId, offsetX, offsetY });
    setStacks(prev => prev.map(s => s.id === stackId ? { ...s, dragging: true } : s));
  }, [stacks, canvasOffset, canvasScale]);

  const handleMouseMove = useCallback((e) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    if (canvasDrag) {
      setCanvasOffset({
        x: e.clientX - canvasDrag.startX + canvasDrag.origX,
        y: e.clientY - canvasDrag.startY + canvasDrag.origY,
      });
      return;
    }

    if (draggingStack) {
      const cx = (e.clientX - rect.left - canvasOffset.x) / canvasScale;
      const cy = (e.clientY - rect.top  - canvasOffset.y) / canvasScale;
      const newX = cx - draggingStack.offsetX;
      const newY = cy - draggingStack.offsetY;

      setStacks(prev => prev.map(s =>
        s.id === draggingStack.stackId ? { ...s, x: newX, y: newY } : s
      ));

      // Snap detection: look for a stack whose bottom is near our top
      const draggedStack = stacks.find(s => s.id === draggingStack.stackId);
      let target = null;
      if (draggedStack) {
        const draggedFirstType = draggedStack.blocks[0]?.type;
        for (const s of stacks) {
          if (s.id === draggingStack.stackId) continue;
          const lastBlock = s.blocks[s.blocks.length - 1];
          if (!lastBlock) continue;
          const stackH = getStackBlocksHeight(s);
          const stackBottom = s.y + stackH;
          const dx = Math.abs(newX - s.x);
          const dy = Math.abs(newY - stackBottom);
          if (dx < 70 && dy < 50 && canStackBelow(lastBlock.type, draggedFirstType)) {
            target = s.id;
            break;
          }
        }
      }
      setDropTarget(target);
    }
  }, [canvasDrag, draggingStack, canvasOffset, canvasScale, stacks]);

  const handleMouseUp = useCallback(() => {
    if (canvasDrag) { setCanvasDrag(null); return; }
    if (draggingStack) {
      if (dropTarget) {
        setStacks(prev => {
          const dragStack   = prev.find(s => s.id === draggingStack.stackId);
          const targetStack = prev.find(s => s.id === dropTarget);
          if (!dragStack || !targetStack) return prev;
          const merged = {
            ...targetStack,
            blocks: [...targetStack.blocks, ...dragStack.blocks],
            dragging: false,
          };
          return prev
            .filter(s => s.id !== draggingStack.stackId && s.id !== dropTarget)
            .concat(merged);
        });
      } else {
        setStacks(prev => prev.map(s =>
          s.id === draggingStack.stackId ? { ...s, dragging: false } : s
        ));
      }
      setDraggingStack(null);
      setDropTarget(null);
    }
  }, [canvasDrag, draggingStack, dropTarget]);

  const handleCanvasMouseDown = useCallback((e) => {
    if (e.target !== canvasRef.current && !e.target.classList.contains('canvas-bg')) return;
    setSelectedBlockId(null);
    setSelectedStackId(null);
    setCanvasDrag({ startX: e.clientX, startY: e.clientY, origX: canvasOffset.x, origY: canvasOffset.y });
  }, [canvasOffset]);

  const endPaletteDrag = useCallback(() => {
    setDraggingNewType(null);
    setGhostPos(null);
    setNewBlockSnap(null);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('cicada/new-type');
    if (!type) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const worldLX = (e.clientX - rect.left - canvasOffset.x) / canvasScale - BLOCK_W / 2;
    const worldTY = (e.clientY - rect.top - canvasOffset.y) / canvasScale - ROOT_H / 2;
    const snap = findNewBlockSnapTarget(stacks, worldLX, worldTY, type);

    const makeProps = (t) => {
      const base = { ...(DEFAULT_PROPS[t] || {}) };
      if (t === 'bot') {
        const tok = resolveBotTokenForNewBlock(stacks, currentUser);
        if (tok) base.token = tok;
      }
      return base;
    };

    if (snap && snap.valid) {
      const id = uid();
      setStacks(prev => prev.map(s => {
        if (s.id !== snap.stackId) return s;
        return {
          ...s,
          blocks: [...s.blocks, { id, type, props: makeProps(type) }],
        };
      }));
    } else {
      const id = uid();
      setStacks(prev => [...prev, {
        id: uid(), x: worldLX, y: worldTY,
        blocks: [{ id, type, props: makeProps(type) }],
      }]);
    }
    endPaletteDrag();
  }, [canvasOffset, canvasScale, stacks, endPaletteDrag, currentUser]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    if (draggingNewType) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      setGhostPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      const worldLX = (e.clientX - rect.left - canvasOffset.x) / canvasScale - BLOCK_W / 2;
      const worldTY = (e.clientY - rect.top - canvasOffset.y) / canvasScale - ROOT_H / 2;
      setNewBlockSnap(findNewBlockSnapTarget(stacks, worldLX, worldTY, draggingNewType));
    }
  }, [draggingNewType, canvasOffset, canvasScale, stacks]);

  // ── Zoom helpers ────────────────────────────────────────────────────────
  const SCALE_MIN = 0.25;
  const SCALE_MAX = 2;
  const SCALE_STEP = 0.1;

  const zoomAt = useCallback((delta, cx, cy) => {
    setCanvasScale(prev => {
      const next = Math.min(SCALE_MAX, Math.max(SCALE_MIN, parseFloat((prev + delta).toFixed(2))));
      const ratio = next / prev;
      setCanvasOffset(off => ({
        x: cx - ratio * (cx - off.x),
        y: cy - ratio * (cy - off.y),
      }));
      return next;
    });
  }, []);

  const handleWheel = useCallback((e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    zoomAt(e.deltaY < 0 ? SCALE_STEP : -SCALE_STEP, cx, cy);
  }, [zoomAt]);

  const zoomIn    = useCallback(() => { const r = canvasRef.current?.getBoundingClientRect(); zoomAt( SCALE_STEP, r ? r.width/2 : 0, r ? r.height/2 : 0); }, [zoomAt]);
  const zoomOut   = useCallback(() => { const r = canvasRef.current?.getBoundingClientRect(); zoomAt(-SCALE_STEP, r ? r.width/2 : 0, r ? r.height/2 : 0); }, [zoomAt]);
  const zoomReset = useCallback(() => { setCanvasScale(1); setCanvasOffset({ x: 0, y: 0 }); }, []);

  const loadExample = useCallback(() => {
    seq = 1;
    setStacks([
      {
        id: uid(), x: 40, y: 20,
        blocks: [
          { id:uid(), type:'version',  props:{ version:'1.0' } },
        ],
      },
      {
        id: uid(), x: 160, y: 20,
        blocks: [
          { id:uid(), type:'bot',      props:{ token: currentUser?.test_token || '' } },
        ],
      },
      {
        id: uid(), x: 40, y: 100,
        blocks: [
          { id:uid(), type:'start',    props:{} },
          { id:uid(), type:'message',  props:{ text:'👋 Привет, {пользователь.имя}!\nЯ Echo Bot — напиши мне что-нибудь' } },
          { id:uid(), type:'buttons',  props:{ rows:'Привет, Пока, Инфо' } },
        ],
      },
      {
        id: uid(), x: 320, y: 100,
        blocks: [
          { id:uid(), type:'command',  props:{ cmd:'help' } },
          { id:uid(), type:'message',  props:{ text:'📖 Просто отправьте любое сообщение' } },
          { id:uid(), type:'message',  props:{ text:'Я повторю его вам!' } },
        ],
      },
      {
        id: uid(), x: 40, y: 310,
        blocks: [
          { id:uid(), type:'callback', props:{ label:'Привет' } },
          { id:uid(), type:'message',  props:{ text:'Привет-привет! 👋' } },
        ],
      },
      {
        id: uid(), x: 40, y: 460,
        blocks: [
          { id:uid(), type:'callback', props:{ label:'Пока' } },
          { id:uid(), type:'message',  props:{ text:'До свидания! 👋' } },
          { id:uid(), type:'delay',    props:{ seconds:'1' } },
        ],
      },
      {
        id: uid(), x: 40, y: 660,
        blocks: [
          { id:uid(), type:'callback', props:{ label:'Инфо' } },
          { id:uid(), type:'message',  props:{ text:'🗂 Ваш ID: {пользователь.id}' } },
          { id:uid(), type:'message',  props:{ text:'Имя: {пользователь.имя}' } },
        ],
      },
      {
        id: uid(), x: 320, y: 460,
        blocks: [
          { id:uid(), type:'condition', props:{ cond:'текст == "да"' } },
          { id:uid(), type:'message',   props:{ text:'🔊 Вы сказали: {текст}' } },
          { id:uid(), type:'message',   props:{ text:'Длина: {длина(текст)} символов' } },
        ],
      },
    ]);
    setSelectedBlockId(null);
    setSelectedStackId(null);
  }, []);

  // Parse DSL code to stacks
  const parseDSL = useCallback((code) => {
    const lines = code.split('\n');
    const stacks = [];
    let x = 40, y = 20;

    // Вспомогательные функции
    const getIndent = (raw) => {
      const m = raw.match(/^[\t ]*/);
      return ((m?.[0] || '').replace(/\t/g, '    ')).length;
    };
    const extractString = (line) => {
      const m = line.match(/"([^"]*)"/); return m ? m[1] : '';
    };
    const extractAllStrings = (line) => {
      const m = line.match(/"([^"]*)"/g);
      return m ? m.map(s => s.replace(/"/g, '')) : [];
    };

    // ROOT-типы — всегда создают новый стек (indent=0)
    const ROOT_TYPES = new Set(['version','bot','global','commands','block','start','command','callback','scenario','middleware']);

    const newStack = (type, props = {}) => {
      const stack = { id: uid(), x, y, blocks: [{ id: uid(), type, props }] };
      stacks.push(stack);
      y += 120;
      if (y > 900) { y = 20; x += 300; }
      return stack;
    };
    const addBlock = (stack, type, props) => {
      if (stack) stack.blocks.push({ id: uid(), type, props });
    };

    // Парсим строку в { type, props } или null
    const parseLine = (line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return null;

      if (t.startsWith('версия '))      return { type: 'version',  props: { version: extractString(t) || '1.0' } };
      if (t.startsWith('бот '))         return { type: 'bot',      props: { token: extractString(t) || '' } };
      if (t.startsWith('глобально '))   { const m = t.match(/глобально\s+(\S+)\s*=\s*(.+)/); return m ? { type: 'global', props: { varname: m[1], value: m[2].trim() } } : null; }
      if (t === 'команды:')             return { type: 'commands', props: { commands: '' } };
      if (t === 'при старте:' || t === 'при старте' || t === 'старт:' || t === 'старт') return { type: 'start', props: {} };
      if (t.startsWith('блок '))        return { type: 'block',    props: { name: t.replace(/^блок\s+/, '').replace(/:$/, '').trim() } };
      if (t.startsWith('при команде ')) return { type: 'command',  props: { cmd: (extractString(t) || '').replace(/^\//, '') } };
      if (t.startsWith('команда '))     return { type: 'command',  props: { cmd: (extractString(t) || '').replace(/^\//, '') } };
      if (t.startsWith('при нажатии ')) return { type: 'callback', props: { label: extractString(t) || '' } };
      // Медиа-триггеры — корневые обработчики, правильные типы (не callback)
      if (t === 'при тексте:' || t === 'при тексте')           return { type: 'on_text',     props: {} };
      if (t === 'при фото:' || t === 'при фото')               return { type: 'on_photo',    props: {} };
      if (t === 'при голосовом:' || t === 'при голосовом')     return { type: 'on_voice',    props: {} };
      if (t === 'при документе:' || t === 'при документе')     return { type: 'on_document', props: {} };
      if (t === 'при стикере:' || t === 'при стикере')         return { type: 'on_sticker',  props: {} };
      if (t === 'при геолокации:' || t === 'при геолокации' || t === 'при локации:' || t === 'при локации') return { type: 'on_location', props: {} };
      if (t === 'при контакте:' || t === 'при контакте')       return { type: 'on_contact',  props: {} };
      if (t.startsWith('сценарий '))    return { type: 'scenario', props: { name: t.replace(/^сценарий\s+/, '').replace(/:$/, '').trim() } };
      if (t === 'до каждого:')          return { type: 'middleware', props: { type: 'before' } };
      if (t === 'после каждого:')       return { type: 'middleware', props: { type: 'after' } };
      if (t === 'иначе:' || t === 'иначе') return { type: 'else', props: {} };

      // Дочерние блоки
      if (t.startsWith('если ') || t.startsWith('если(')) { const cond = t.replace(/^если\s*/, '').replace(/:$/, ''); return { type: 'condition', props: { cond } }; }
      if (t === 'иначе:' || t === 'иначе') return { type: 'else', props: {} };
      if (t.startsWith('шаг '))         return { type: 'step',    props: { name: t.replace(/^шаг\s+/, '').replace(/:$/, '').trim() } };
      if (t.startsWith('ответ_md '))    return { type: 'message', props: { text: extractString(t), md: true } };
      if (t.startsWith('ответ '))       return { type: 'message', props: { text: extractString(t) } };
      if (t.startsWith('использовать ')) return { type: 'use',   props: { blockname: t.replace(/^использовать\s+/, '').trim() } };
      if (t.startsWith('спросить ')) {
        const q = extractString(t);
        const v = t.includes('→')
          ? (t.split('→')[1]?.trim() || 'var')
          : (t.includes('->') ? (t.split('->')[1]?.trim() || 'var') : 'var');
        return { type: 'ask', props: { question: q, varname: v } };
      }
      if (t.startsWith('запомни '))     { const m = t.replace(/^запомни\s+/, '').split('='); return { type: 'remember', props: { varname: m[0].trim(), value: m.slice(1).join('=').trim() } }; }
      if (t.startsWith('получить от ')) { const m = t.match(/получить от\s+(.+?)\s+"([^"]*)"\s*→\s*(\S+)/); return m ? { type: 'get_user', props: { user_id: m[1].trim(), key: m[2], varname: m[3] } } : null; }
      if (t.startsWith('получить '))    { const key = extractString(t); const v = t.split('→')[1]?.trim() || 'var'; return { type: 'get', props: { key, varname: v } }; }
      if (t.startsWith('сохранить_глобально ')) { const m = t.match(/сохранить_глобально\s+"([^"]*)"\s*=\s*(.+)/); return m ? { type: 'save_global', props: { key: m[1], value: m[2].trim() } } : null; }
      if (t.startsWith('сохранить '))   { const m = t.match(/сохранить\s+"([^"]*)"\s*=\s*(.+)/); return m ? { type: 'save', props: { key: m[1], value: m[2].trim() } } : null; }
      if (t.startsWith('удалить '))     { const m = t.match(/удалить\s+"([^"]*)"/); return m ? { type: 'db_delete', props: { key: m[1] } } : null; }
      if (t.startsWith('все_ключи'))    { const v = t.split('→')[1]?.trim() || 'ключи'; return { type: 'all_keys', props: { varname: v } }; }
      if (t.startsWith('вызвать '))     { const name = extractString(t); const v = t.split('→')[1]?.trim() || 'результат'; return { type: 'call_block', props: { blockname: name, varname: v } }; }
      if (t.startsWith('inline-кнопки:')) return { type: 'inline', props: { buttons: '' }, multiline: 'inline' };
      if (t.startsWith('кнопки:'))      return { type: 'buttons', props: { rows: '' }, multiline: true };
      if (t.startsWith('кнопки '))      { const btns = extractAllStrings(t); return { type: 'buttons', props: { rows: btns.join(', ') } }; }
      if (t.startsWith('кнопка '))      { const label = extractString(t); const cb = t.match(/->\s*"([^"]+)"/)?.[1] || ''; return { type: 'buttons', props: { rows: label, target: cb } }; }
      if (t.startsWith('пауза ') || t.startsWith('подождать ')) { const s = t.match(/\d+/)?.[0] || '1'; return { type: 'delay', props: { seconds: s } }; }
      if (t.startsWith('печатает '))    { const s = t.match(/\d+/)?.[0] || '1'; return { type: 'typing', props: { seconds: s } }; }
      // HTTP: "запрос GET "url" → var" (формат DSL-генератора)
      if (t.startsWith('http_заголовки ')) { const v = t.replace(/^http_заголовки\s+/, '').trim(); return { type: 'http', props: { method: 'HEADERS', varname: v } }; }
      if (t.startsWith('http_get ') || t.startsWith('http_delete ')) { const m = t.match(/http_(get|delete)\s+"([^"]+)"\s*→\s*(\S+)/); return m ? { type: 'http', props: { method: m[1].toUpperCase(), url: m[2], varname: m[3] } } : null; }
      if (t.startsWith('http_post ') || t.startsWith('http_patch ') || t.startsWith('http_put ')) {
        const mj = t.match(/http_(post|patch|put)\s+"([^"]+)"\s+json\s+(\S+)\s*→\s*(\S+)/);
        if (mj) return { type: 'http', props: { method: mj[1].toUpperCase(), url: mj[2], jsonVar: mj[3], varname: mj[4], isJson: 'true' } };
        const mb = t.match(/http_(post|patch|put)\s+"([^"]+)"\s+с\s+"([^"]*)"\s*→\s*(\S+)/);
        return mb ? { type: 'http', props: { method: mb[1].toUpperCase(), url: mb[2], body: mb[3], varname: mb[4] } } : null;
      }
      if (t.startsWith('запрос ') && !t.startsWith('запрос_бд')) {
        const m = t.match(/запрос\s+(\w+)\s+"([^"]+)"\s*→\s*(\S+)/);
        return m ? { type: 'http', props: { method: m[1], url: m[2], varname: m[3] } } : null;
      }
      if (t.startsWith('запрос_бд '))   { const m = t.match(/запрос_бд\s+"([^"]+)"\s*→\s*(\S+)/); return m ? { type: 'database', props: { query: m[1], varname: m[2] } } : null; }
      if (t.startsWith('классифицировать ')) { const m = t.match(/классифицировать\s+\[([^\]]+)\]\s*→\s*(\S+)/); return m ? { type: 'classify', props: { intents: m[1].replace(/"/g, '').split(',').map(x => x.trim()).filter(Boolean).join('\n'), varname: m[2] } } : null; }
      if (t.startsWith('лог'))          { const m = t.match(/лог\[?([^\]"]*)\]?\s+"([^"]+)"/); return { type: 'log', props: { level: (m?.[1] || 'info').trim(), message: m?.[2] || '' } }; }
      // рандом: — multiline, собирает строки вида     "вариант"
      if (t === 'рандом:' || t === 'рандом') return { type: 'random', props: { variants: '' }, multiline: 'random' };
      // переключить var: — switch-блок
      if (t.startsWith('переключить ')) { const v = t.replace(/^переключить\s+/, '').replace(/:$/, '').trim(); return { type: 'switch', props: { varname: v } }; }
      // циклы
      if (t.startsWith('для каждого ')) { const m = t.match(/для каждого\s+(\S+)\s+в\s+(.+):/); return m ? { type: 'loop', props: { mode: 'foreach', var: m[1], collection: m[2].trim() } } : null; }
      if (t.startsWith('таймаут '))     { const seconds = t.match(/[\d.]+/)?.[0] || '5'; return { type: 'loop', props: { mode: 'timeout', seconds } }; }
      if (t.match(/^повторять\s+\d+/)) { const n = t.match(/\d+/)?.[0] || '3'; return { type: 'loop', props: { mode: 'count', count: n } }; }
      if (t.startsWith('пока '))        { const cond = t.replace(/^пока\s+/, '').replace(/:$/, ''); return { type: 'loop', props: { mode: 'while', cond } }; }
      if (t.startsWith('перейти к шаг ')) return { type: 'goto', props: { target: t.replace(/^перейти к шаг\s+/, '').trim() } };
      if (t.startsWith('запустить '))   return { type: 'goto', props: { target: t.replace(/^запустить\s+/, '').trim() } };
      if (t.startsWith('перейти '))     return { type: 'goto', props: { target: t.replace(/^перейти\s+/, '').replace(/^"/, '').replace(/"$/, '').trim() } };
      if (t.startsWith('вернуть '))    return { type: 'stop', props: { reason: 'return', value: t.replace(/^вернуть\s+/, '').trim() } };
      if (t.startsWith('завершить') || t === 'вернуть' || t === 'стоп') return { type: 'stop', props: {} };
      if (t === 'повторить шаг')        return { type: 'goto', props: { target: 'повторить' } };
      if (t.startsWith('фото '))        return { type: 'photo', props: { url: extractString(t) } };
      if (t.startsWith('видео '))       return { type: 'video', props: { url: extractString(t) } };
      if (t.startsWith('аудио '))       return { type: 'audio', props: { url: extractString(t) } };
      if (t.startsWith('стикер '))      return { type: 'sticker', props: { file_id: extractString(t) } };
      if (/^отправить файл\s+/i.test(t)) {
        const rest = t.replace(/^отправить\s+файл\s+/i, '').trim();
        return { type: 'send_file', props: { file: rest } };
      }
      if (t.startsWith('документ '))    { const m = t.match(/документ\s+"([^"]+)"/); return { type: 'document', props: { url: m?.[1] || '' } }; }
      if (t.startsWith('локация '))     { const m = t.match(/локация\s+([\d.]+)\s+([\d.]+)/); return { type: 'location', props: { lat: m?.[1] || '0', lon: m?.[2] || '0' } }; }
      if (t.startsWith('контакт '))     { const m = t.match(/контакт\s+"([^"]+)"\s+"([^"]+)"/); return { type: 'contact', props: { phone: m?.[1] || '', first_name: m?.[2] || '' } }; }
      if (t.startsWith('опрос '))       { const opts = extractAllStrings(t); return { type: 'poll', props: { question: opts[0] || '', options: opts.slice(1).join('\n'), type: 'regular' }, multiline: true }; }
      if (t.startsWith('уведомить '))   { const m = t.match(/уведомить\s+(.+?):\s*"([^"]*)"/) || t.match(/уведомить\s+(\S+)\s+"([^"]*)"/); return m ? { type: 'notify', props: { target: m[1].trim(), text: m[2] } } : null; }
      if (t.startsWith('рассылка всем:')) { const m = t.match(/рассылка всем:\s*"?([^"]*)"?/); return { type: 'broadcast', props: { mode: 'all', text: m?.[1] || '' } }; }
      if (t.startsWith('рассылка группе ')) { const m = t.match(/рассылка группе\s+(\S+):\s*"?([^"]*)"?/); return m ? { type: 'broadcast', props: { mode: 'group', tag: m[1], text: m[2] } } : null; }
      if (t.startsWith('проверить подписку ')) { const m = t.match(/проверить подписку\s+(@\S+)\s*→\s*(\S+)/); return m ? { type: 'check_sub', props: { channel: m[1], varname: m[2] } } : null; }
      if (t.startsWith('роль @'))       { const m = t.match(/роль\s+(@\S+)\s+(\S+)\s*→\s*(\S+)/); return m ? { type: 'member_role', props: { channel: m[1], user_id: m[2], varname: m[3] } } : null; }
      if (t.startsWith('переслать сообщение ')) return { type: 'forward_msg', props: { target: t.replace(/^переслать сообщение\s+/, '').trim() } };
      if (t.startsWith('оплата '))      { const m = t.match(/оплата\s+(\S+)\s+(\S+)\s+(\S+)\s+"([^"]*)"/); return m ? { type: 'payment', props: { provider: m[1], amount: m[2], currency: m[3], title: m[4] } } : null; }

      return null;
    };

    // Корневые типы (indent=0) — всегда создают новый стек
    const ROOT_INDENT_TYPES = new Set([
      'version', 'bot', 'global', 'commands',
      'block', 'start', 'command', 'callback',
      'on_text', 'on_photo', 'on_voice', 'on_document',
      'on_sticker', 'on_location', 'on_contact',
      'scenario', 'middleware',
      'else',   // иначе: — fallback-обработчик, всегда корневой
    ]);

    let currentStack = null;
    let pendingButtonsBlock = null;
    let pendingButtonsIndent = -1;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const t = raw.trim();
      if (!t || t.startsWith('#')) continue;

      const indent = getIndent(raw);

      // Многострочные inline-кнопки — парсим ["текст" → "callback", ...]
      if (pendingButtonsBlock?.type === 'inline' && indent > pendingButtonsIndent) {
        if (t.startsWith('[')) {
          const inner = t.replace(/^\[/, '').replace(/\]$/, '');
          const entries = inner.match(/"[^"]*"\s*→\s*"[^"]*"/g) || [];
          const row = entries.map(e => {
            const m = e.match(/"([^"]*)"\s*→\s*"([^"]*)"/);
            return m ? `${m[1]}|${m[2]}` : '';
          }).filter(Boolean).join(', ');
          if (row) pendingButtonsBlock.props.buttons = pendingButtonsBlock.props.buttons ? `${pendingButtonsBlock.props.buttons}\n${row}` : row;
          continue;
        }
        pendingButtonsBlock = null;
        pendingButtonsIndent = -1;
      }
      // Многострочные кнопки — собираем строки с [...]
      if (pendingButtonsBlock && pendingButtonsBlock.type !== 'random' && pendingButtonsBlock.type !== 'inline' && indent > pendingButtonsIndent) {
        if (t.startsWith('[')) {
          const row = t.replace(/^\[/, '').replace(/\]$/, '').replace(/"/g, '').split(',').map(v => v.trim()).filter(Boolean).join(', ');
          if (row) pendingButtonsBlock.props.rows = pendingButtonsBlock.props.rows ? `${pendingButtonsBlock.props.rows}\n${row}` : row;
          continue;
        }
        // Не строка кнопки — выходим из режима сбора
        pendingButtonsBlock = null;
        pendingButtonsIndent = -1;
      }
      // Многострочный рандом — собираем строки вида     "вариант"
      if (pendingButtonsBlock?.type === 'random' && indent > pendingButtonsIndent) {
        const variantMatch = t.match(/^"([^"]*)"$/);
        if (variantMatch) {
          const v = variantMatch[1];
          pendingButtonsBlock.props.variants = pendingButtonsBlock.props.variants
            ? `${pendingButtonsBlock.props.variants}\n${v}` : v;
          continue;
        }
        pendingButtonsBlock = null;
        pendingButtonsIndent = -1;
      }
      // Многострочные опции опроса — собираем строки с - "..."
      if (pendingButtonsBlock?.type === 'poll' && indent > pendingButtonsIndent) {
        if (t.startsWith('-')) {
          const opt = extractString(t);
          if (opt) pendingButtonsBlock.props.options = pendingButtonsBlock.props.options ? `${pendingButtonsBlock.props.options}\n${opt}` : opt;
          continue;
        }
        // Не строка опции — выходим из режима сбора
        pendingButtonsBlock = null;
        pendingButtonsIndent = -1;
      }
      if (pendingButtonsBlock) { pendingButtonsBlock = null; pendingButtonsIndent = -1; }

      // Команды — собираем строки "/cmd" - "desc"
      if (currentStack?.blocks[0]?.type === 'commands' && indent > 0 && t.startsWith('"')) {
        const m = t.match(/"([^"]*)"\s*-\s*"([^"]*)"/);
        if (m) {
          const prev = currentStack.blocks[0].props.commands || '';
          currentStack.blocks[0].props.commands = prev ? `${prev}\n${m[1]} - ${m[2]}` : `${m[1]} - ${m[2]}`;
        }
        continue;
      }

      const parsed = parseLine(raw);
      if (!parsed) continue;

      const isRoot = indent === 0 && ROOT_INDENT_TYPES.has(parsed.type);

      if (isRoot) {
        // Новый корневой стек
        currentStack = newStack(parsed.type, parsed.props);
        currentStack._lastScopeIndent = -1;
        currentStack._lastScopeType = null;
        if (parsed.type === 'scenario') {
          currentStack._scenarioStepBase = '';
          currentStack._asksSinceScenarioStep = 0;
          currentStack._scenarioStepIndent = -1;
          currentStack._scenarioSiblingAskIndent = null;
        }
      } else {
        // Дочерний блок — добавляем в currentStack
        // condition/else/шаг на indent=1 тоже идут в тот же стек
        if (!currentStack) {
          // Осиротевший блок — создаём стек
          currentStack = newStack(parsed.type, parsed.props);
        } else {
          const isScenarioStack = currentStack.blocks[0]?.type === 'scenario';

          // Несколько «спросить» под одним «шаг …:» → отдельные шаги (как в DSL ядра с FSM)
          if (isScenarioStack && parsed.type === 'ask') {
            const base = currentStack._scenarioStepBase;
            const n = currentStack._asksSinceScenarioStep ?? 0;
            const sib = currentStack._scenarioSiblingAskIndent;
            const isSiblingAsk = sib == null || indent === sib;
            if (isSiblingAsk && sib == null) {
              currentStack._scenarioSiblingAskIndent = indent;
            }
            if (isSiblingAsk && base && n >= 1) {
              const stepIndent = currentStack._scenarioStepIndent ?? indent;
              addBlock(currentStack, 'step', { name: `${base}_${n + 1}` });
              currentStack._lastScopeType = 'step';
              currentStack._lastScopeIndent = stepIndent;
            }
          }

          // Определяем: этот блок идёт ПОСЛЕ ветки else/condition на том же уровне?
          const props = { ...parsed.props };
          if (
            currentStack._lastScopeType &&
            indent <= currentStack._lastScopeIndent &&
            parsed.type !== 'condition' && parsed.type !== 'else' && parsed.type !== 'step'
          ) {
            props._afterScope = true;
            currentStack._lastScopeType = null;
            currentStack._lastScopeIndent = -1;
          }
          // Запоминаем когда открывается scope
          if (parsed.type === 'condition' || parsed.type === 'else' || parsed.type === 'step' || parsed.type === 'loop') {
            currentStack._lastScopeType = parsed.type;
            currentStack._lastScopeIndent = indent;
            if (parsed.type === 'step' && isScenarioStack) {
              currentStack._scenarioStepBase = parsed.props.name;
              currentStack._asksSinceScenarioStep = 0;
              currentStack._scenarioStepIndent = indent;
              currentStack._scenarioSiblingAskIndent = null;
            }
          }
          addBlock(currentStack, parsed.type, props);
          if (isScenarioStack && parsed.type === 'ask') {
            const sib = currentStack._scenarioSiblingAskIndent;
            if (sib != null && indent === sib) {
              currentStack._asksSinceScenarioStep = (currentStack._asksSinceScenarioStep ?? 0) + 1;
            }
          }
        }
      }

      // Многострочные кнопки
      if (parsed.multiline) {
        const lastBlock = currentStack.blocks[currentStack.blocks.length - 1];
        pendingButtonsBlock = lastBlock;
        pendingButtonsIndent = indent;
      }
    }

    return stacks.length > 0 ? stacks : null;
  }, []);

  const applyCorrectedDSLCode = useCallback((code) => {
    const parsedStacks = parseDSL(code);
    if (!parsedStacks || parsedStacks.length === 0) {
      showToast('Не удалось применить исправления к холсту', 'error');
      return false;
    }
    setStacks(parsedStacks);
    setSelectedBlockId(null);
    setSelectedStackId(null);
    showToast('Исправления применены и сохранены в холст', 'success');
    return true;
  }, [parseDSL, showToast]);

  const runPythonConvert = useCallback(async () => {
    setPythonConvertLoading(true);
    setPythonConvertError('');
    setPythonConvertMeta(null);
    setPythonConvertResult('');
    try {
      const data = await apiFetch('/api/convert-python-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ python: pythonConvertSource }),
      });
      setPythonConvertResult(data.code || '');
      setPythonConvertMeta({
        schemaErrors: data.schemaErrors || [],
        pythonLint: data.pythonLint || null,
      });
      const hasIssues =
        (data.schemaErrors && data.schemaErrors.length > 0) ||
        (data.pythonLint && data.pythonLint.ok === false);
      showToast(
        hasIssues ? 'Готово: проверь замечания ниже' : 'Конвертация готова',
        hasIssues ? 'info' : 'success',
      );
    } catch (e) {
      setPythonConvertError(e.message || 'Ошибка');
    } finally {
      setPythonConvertLoading(false);
    }
  }, [pythonConvertSource, showToast]);

  const applyPythonConvertToCanvas = useCallback(() => {
    const code = pythonConvertResult.trim();
    if (!code) {
      showToast('Нет DSL для применения', 'error');
      return;
    }
    const parsed = parseDSL(code);
    if (!parsed || parsed.length === 0) {
      showToast('Не удалось разобрать DSL — исправь текст вручную', 'error');
      return;
    }
    const offsetX = stacks.length > 0 ? Math.max(...stacks.map((s) => s.x + 300)) : 40;
    const resolvedTok = resolveBotTokenForNewBlock(stacks, currentUser);
    const ts = Date.now();
    const newStacks = parsed.map((s, i) => ({
      ...s,
      id: `py_${ts}_${i}`,
      x: (s.x || 40) + offsetX,
      y: s.y || 40,
      blocks: (s.blocks || []).map((b, bi) => ({
        ...b,
        id: `py_b_${ts}_${i}_${bi}`,
        props:
          b.type === 'bot' && resolvedTok ? { ...b.props, token: resolvedTok } : b.props,
      })),
    }));
    setStacks((prev) => [...prev, ...newStacks]);
    setShowPythonConvertModal(false);
    showToast('Схема из Python добавлена на холст', 'success');
  }, [pythonConvertResult, stacks, currentUser, parseDSL, showToast]);

  // Embedded example bots
  const EXAMPLE_ECHO = `версия "1.0"
бот "0000000000:PASTE_YOUR_BOTFATHER_TOKEN_HERE"

команды:
    "/start" - "🚀 Запуск"
    "/help" - "❓ Помощь"

при старте:
    ответ "👋 Привет, {пользователь.имя}!"
    печатает 1с
    ответ "Я Echo Bot — просто напиши мне что-нибудь"
    ответ "И я повторю это обратно 🪞"
    кнопки "Привет" "Пока" "Инфо"

при команде "/help":
    ответ "📖 Просто отправьте любое сообщение"
    ответ "Я повторю его вам!"

при нажатии "Привет":
    рандом:
        "Привет-привет! 👋"
        "Здорово! 🤙"
        "О, снова ты! 😄"

при нажатии "Пока":
    ответ "До свидания! 👋"
    ответ "Возвращайся скорее!"
    стоп

при нажатии "Инфо":
    ответ "📊 Информация о вас:"
    ответ "Ваш ID: {пользователь.id}"
    ответ "Имя: {пользователь.имя}"
    ответ "Chat ID: {чат.id}"

иначе:
    ответ "🔊 Вы сказали: {текст}"
    ответ "(Длина: {длина(текст)} символов)"
`

  const EXAMPLE_SHOP = "версия \"1.0\"\nбот \"\"\nкоманды:\n    \"/start\" - \"🚀 Запуск\"\n    \"/catalog\" - \"📦 Каталог\"\n    \"/cart\" - \"🛒 Корзина\"\n    \"/order\" - \"📋 Заказ\"\nглобально магазин_открыт = истина\n\nпри команде \"/order\":\n    перейти \"оформление\"\n\nпри нажатии \"📦 Ещё товары\":\n    перейти \"/catalog\"\n\nпри нажатии \"❌ Отменить заказ\":\n    ответ \"❌ Оформление отменено\"\n    использовать приветствие\n\nпри нажатии \"🍎 Яблоки — 100₽\":\n    получить \"корзина\" → корзина\n    получить \"итого\" → итого\n    если не итого:\n        запомни итого = 0\n    если не корзина:\n        запомни корзина = \"• 🍎 Яблоки — 100₽\"\n    иначе:\n        запомни корзина = корзина + \"\\n• 🍎 Яблоки — 100₽\"\n    запомни итого = итого + 100\n    сохранить \"корзина\" = корзина\n    сохранить \"итого\" = итого\n    ответ \"🍎 Яблоки добавлены в корзину!\"\n    кнопки \"🛒 Корзина\" \"📦 Ещё товары\"\n\nпри нажатии \"📋 Заказ\":\n    перейти \"/order\"\n\nиначе:\n        ответ \"🤔 Не понимаю '{текст}'\"\n        ответ \"Используйте кнопки меню\"\n        кнопки \"🏠 Главная\"\n\nпри нажатии \"🍌 Бананы — 80₽\":\n    получить \"корзина\" → корзина\n    получить \"итого\" → итого\n    если не итого:\n        запомни итого = 0\n    если не корзина:\n        запомни корзина = \"• 🍌 Бананы — 80₽\"\n    иначе:\n        запомни корзина = корзина + \"\\n• 🍌 Бананы — 80₽\"\n    запомни итого = итого + 80\n    сохранить \"корзина\" = корзина\n    сохранить \"итого\" = итого\n    ответ \"🍌 Бананы добавлены в корзину!\"\n    кнопки \"🛒 Корзина\" \"📦 Ещё товары\"\n\nпри нажатии \"📋 Оформить заказ\":\n    перейти \"оформление\"\n\nпри нажатии \"🍊 Апельсины — 120₽\":\n    получить \"корзина\" → корзина\n    получить \"итого\" → итого\n    если не итого:\n        запомни итого = 0\n    если не корзина:\n        запомни корзина = \"• 🍊 Апельсины — 120₽\"\n    иначе:\n        запомни корзина = корзина + \"\\n• 🍊 Апельсины — 120₽\"\n    запомни итого = итого + 120\n    сохранить \"корзина\" = корзина\n    сохранить \"итого\" = итого\n    ответ \"🍊 Апельсины добавлены в корзину!\"\n    кнопки \"🛒 Корзина\" \"📦 Ещё товары\"\n\nпри нажатии \"🔙 Назад\":\n    использовать приветствие\n\nпри старте:\n    если магазин_открыт == истина:\n        использовать приветствие\n    иначе:\n        ответ \"🚫 Магазин закрыт на обслуживание. Скоро вернёмся!\"\n        стоп\n\nпри нажатии \"🍇 Виноград — 200₽\":\n    получить \"корзина\" → корзина\n    получить \"итого\" → итого\n    если не итого:\n        запомни итого = 0\n    если не корзина:\n        запомни корзина = \"• 🍇 Виноград — 200₽\"\n    иначе:\n        запомни корзина = корзина + \"\\n• 🍇 Виноград — 200₽\"\n    запомни итого = итого + 200\n    сохранить \"корзина\" = корзина\n    сохранить \"итого\" = итого\n    ответ \"🍇 Виноград добавлен в корзину!\"\n    кнопки \"🛒 Корзина\" \"📦 Ещё товары\"\n\nпри нажатии \"🏠 Главная\":\n    использовать приветствие\n\nблок приветствие:\n    ответ \"👋 Привет, {пользователь.имя}! Добро пожаловать в наш магазин 🛍️\"\n    ответ \"Выберите раздел:\"\n    кнопки:\n        [\"📦 Каталог\", \"🛒 Корзина\"]\n        [\"📋 Заказ\", \"❓ Помощь\"]\n\nпри нажатии \"🗑️ Очистить корзину\":\n    сохранить \"корзина\" = \"\"\n    сохранить \"итого\" = 0\n    сохранить \"адрес\" = \"\"\n    ответ \"🗑️ Корзина очищена\"\n    кнопки \"📦 Каталог\"\n\nпри нажатии \"❓ Помощь\":\n    ответ \"❓ Помощь:\"\n    ответ \"• /catalog — посмотреть товары\"\n    ответ \"• /cart — ваша корзина\"\n    ответ \"• /order — оформить заказ\"\n    кнопки \"🏠 Главная\"\n\nпри команде \"/catalog\":\n    ответ \"📦 Наши товары:\"\n    кнопки:\n        [\"🍎 Яблоки — 100₽\", \"🍌 Бананы — 80₽\"]\n        [\"🍊 Апельсины — 120₽\", \"🍇 Виноград — 200₽\"]\n        [\"🔙 Назад\"]\n\nпри нажатии \"🛒 Корзина\":\n    перейти \"/cart\"\n\nсценарий оформление:\n    шаг проверка:\n        получить \"корзина\" → корзина\n    если не корзина:\n        ответ \"🛒 Корзина пуста! Сначала выберите товар.\"\n        кнопки \"📦 Каталог\"\n        стоп\n    шаг адрес:\n        спросить \"🏠 Укажите адрес доставки:\" → введённый_адрес\n    шаг подтверждение:\n        сохранить \"адрес\" = введённый_адрес\n        получить \"корзина\" → корзина\n        получить \"итого\" → итого\n        ответ \"📋 Подтвердите заказ:\\n{корзина}\\nСумма: {итого}₽\\nАдрес: {введённый_адрес}\"\n        кнопки \"✅ Подтвердить заказ\" \"❌ Отменить заказ\"\n        стоп\n\nпри команде \"/cart\":\n    получить \"корзина\" → корзина\n    получить \"итого\" → итого\n    если не корзина:\n        ответ \"🛒 Корзина пуста\"\n        ответ \"Перейдите в каталог и выберите товар\"\n        кнопки \"📦 Каталог\" \"🏠 Главная\"\n    иначе:\n        ответ \"🛒 Ваша корзина:\\n{корзина}\\nИтого: {итого}₽\"\n        кнопки:\n            [\"📋 Оформить заказ\", \"🗑️ Очистить корзину\"]\n            [\"📦 Ещё товары\"]\n\nпри нажатии \"📦 Каталог\":\n    перейти \"/catalog\"\n\nпри нажатии \"✅ Подтвердить заказ\":\n    получить \"корзина\" → корзина\n    получить \"итого\" → итого\n    получить \"адрес\" → адр\n    ответ \"✅ Заказ принят!\\n{корзина}\\nСумма: {итого}₽\\nАдрес: {адр}\\nСкоро свяжемся с вами 📞\"\n    сохранить \"корзина\" = \"\"\n    сохранить \"итого\" = 0\n    сохранить \"адрес\" = \"\"\n    кнопки \"🏠 Главная\"\n";

const EXAMPLE_FULL = `версия "1.0"
бот "0000000000:PASTE_YOUR_BOTFATHER_TOKEN_HERE"

команды:
    "/start" - "🚀 Старт"
    "/help" - "❓ Помощь"
    "/quiz" - "🧠 Квиз"
    "/media" - "🖼 Медиа"
    "/settings" - "⚙️ Настройки"

глобально счёт = 0
глобально язык = "ru"

блок главное_меню:
    ответ "🏠 Главное меню:"
    кнопки:
        ["🧠 Квиз", "🎲 Рандом"]
        ["🖼 Медиа", "📊 Опрос"]
        ["⚙️ Настройки", "❓ Помощь"]

до каждого:
    лог[info] "Входящее: {текст} от {пользователь.имя}"

после каждого:
    лог[debug] "Ответ отправлен"

при старте:
    сохранить "счёт" = 0
    ответ "👋 Привет, {пользователь.имя}!"
    печатает 1с
    ответ "Это демо-бот со всеми функциями Cicada DSL 🚀"
    использовать главное_меню

при команде "/help":
    ответ "❓ Доступные команды:"
    ответ "/quiz — запустить квиз\n/media — показать медиа\n/settings — настройки"
    использовать главное_меню

при команде "/media":
    ответ "🖼 Примеры медиа-контента:"
    фото "https://сатана.site/foto.jpg" "Случайное фото 📷"
    пауза 1с
    ответ "🎵 Аудио-файл:"
    аудио "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
    пауза 1с
    ответ "📄 Документ:"
    документ "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf" "Пример PDF"
    использовать главное_меню

при команде "/quiz":
    перейти "квиз"

при команде "/settings":
    ответ "⚙️ Настройки:"
    inline-кнопки:
        ["🇷🇺 Русский" → "lang_ru", "🇬🇧 English" → "lang_en"]
        ["🔔 Уведомления" → "notif_toggle", "❌ Закрыть" → "close_settings"]

сценарий квиз:
    шаг начало:
        ответ "🧠 Квиз на 3 вопроса! Поехали!"
        опрос "Какой язык использует Cicada DSL?" "Python" "JavaScript" "Русский"
        кнопки "▶ Начать квиз"

    шаг вопрос1:
        спросить "Вопрос 1: Сколько будет 2 + 2?" → ответ1
        если ответ1 == "4":
            запомни счёт = счёт + 1
            ответ "✅ Верно! Счёт: {счёт}"
        иначе:
            ответ "❌ Неверно. Правильный ответ: 4"
        перейти "вопрос2"

    шаг вопрос2:
        спросить "Вопрос 2: Столица Франции?" → ответ2
        если ответ2 == "Париж":
            запомни счёт = счёт + 1
            ответ "✅ Верно! Счёт: {счёт}"
        иначе:
            ответ "❌ Неверно. Правильный ответ: Париж"
        перейти "вопрос3"

    шаг вопрос3:
        спросить "Вопрос 3: Что такое HTTP?" → ответ3
        если ответ3 == "протокол":
            запомни счёт = счёт + 1
            ответ "✅ Верно!"
        иначе:
            ответ "❌ Неверно. Правильный ответ: протокол"
        ответ "🏁 Квиз завершён! Ваш счёт: {счёт}/3"
        если счёт == 3:
            ответ "🏆 Отлично! Вы ответили на все вопросы!"
        если счёт == 2:
            ответ "👍 Хороший результат!"
        если счёт < 2:
            ответ "📚 Попробуйте ещё раз!"
        завершить сценарий

при нажатии "🧠 Квиз":
    перейти "квиз"

при нажатии "▶ Начать квиз":
    перейти "квиз"

при нажатии "🎲 Рандом":
    рандом:
        "🎲 Число: 42!"
        "🎲 Число: 88!"
        "🎲 Число: 12!"
        "🎲 Число: 33!"
        "🎲 Число: 40!"
        "🎲 Число: 2!"
        "🎲 Число: 88!"
        "🎲 Число: 7!"
        "🎲 Число: 13!"
        "🎲 Число: 99!"

при нажатии "🖼 Медиа":
    перейти "/media"

при нажатии "📊 Опрос":
    опрос "Как вам бот?" "🔥 Отлично!" "👍 Хорошо" "😐 Нормально" "👎 Плохо"

при нажатии "⚙️ Настройки":
    перейти "/settings"

при нажатии "❓ Помощь":
    перейти "/help"

при нажатии "lang_ru":
    сохранить "язык" = "ru"
    ответ "🇷🇺 Язык изменён на Русский"
    использовать главное_меню

при нажатии "lang_en":
    сохранить "язык" = "en"
    ответ "🇬🇧 Language changed to English"
    использовать главное_меню

при нажатии "notif_toggle":
    ответ "🔔 Уведомления переключены"

при нажатии "close_settings":
    использовать главное_меню

при фото:
    ответ "📷 Получили ваше фото!"
    ответ "Красивый снимок, {пользователь.имя}! 😍"
    использовать главное_меню

при документе:
    ответ "📄 Получили ваш документ!"
    ответ "Спасибо, {пользователь.имя}! Обработаем в ближайшее время."
    использовать главное_меню

иначе:
    ответ "🤔 Не понял: «{текст}»"
    использовать главное_меню
`

  const EXAMPLE_FULL_TEST = `версия "1.0"
бот "YOUR_BOT_TOKEN"

команды:
    "/start" - "🚀 Full Test"
    "/help" - "❓ Все разделы"
    "/profile" - "👤 Анкета"
    "/media" - "🖼 Медиа"
    "/api" - "🌐 API"

глобально full_test_enabled = истина
глобально счётчик = 0
глобально ADMIN_ID = 123456789

блок full_test_меню:
    ответ "🧪 Full Test — пример со всеми основными блоками Cicada Studio."
    кнопки:
        ["👤 Анкета", "🖼 Медиа"]
        ["💾 Данные", "🌐 API"]
        ["🔁 Логика", "🛡 Админ"]
        ["⚙️ Настройки", "❓ Помощь"]

до каждого:
    лог[info] "Full Test input: {текст} от {пользователь.имя}"

после каждого:
    лог[debug] "Full Test turn completed"

при старте:
    если full_test_enabled == истина:
        запомни название_бота = "Full Test"
        сохранить "последний_старт_{chat_id}" = текст
        ответ "👋 Добро пожаловать в Full Test, {пользователь.имя}!"
        печатает 1с
        ответ_md "*Full Test* показывает меню, сценарии, условия, БД, медиа, HTTP, циклы и Telegram-блоки."
        использовать full_test_меню
    иначе:
        ответ "⛔ Full Test временно выключен."
        стоп

при команде "/help":
    ответ "❓ Разделы Full Test: анкета, медиа, данные, API, логика, настройки и админ."
    inline-кнопки:
        ["Открыть анкету" → "go_profile", "Открыть API" → "go_api"]
        ["Документация" → "url:https://example.com/docs"]

при команде "/profile":
    перейти "full_test_анкета"

при команде "/media":
    использовать full_test_медиа

при команде "/api":
    использовать full_test_api

при нажатии "👤 Анкета":
    перейти "full_test_анкета"

при нажатии "go_profile":
    перейти "full_test_анкета"

сценарий full_test_анкета:
    шаг имя:
        спросить "Как вас зовут?" → имя_анкеты
    шаг город:
        спросить "Из какого вы города?" → город
    шаг возраст:
        спросить "Сколько вам лет?" → возраст
    шаг итог:
        сохранить "full_test_имя_{chat_id}" = имя_анкеты
        сохранить "full_test_город_{chat_id}" = город
        сохранить "full_test_возраст_{chat_id}" = возраст
        если возраст >= 18:
            ответ "✅ Анкета сохранена: {имя_анкеты}, {город}, 18+."
        иначе:
            ответ "✅ Анкета сохранена: {имя_анкеты}, {город}."
        кнопки "🏠 Главное меню" "💾 Данные"
        стоп

блок full_test_медиа:
    ответ "🖼 Медиа-блоки: фото, видео, аудио, документ, стикер, контакт, локация и опрос."
    ответ "Фото из Full Test"
    фото "https://picsum.photos/640/360"
    видео "https://samplelib.com/lib/preview/mp4/sample-5s.mp4" "Короткое видео"
    аудио "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
    документ "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf" "PDF-документ"
    стикер "CAACAgIAAxkBAAEFullTestSticker"
    контакт "+10000000000" "Full Test Support"
    локация 55.7558 37.6173
    опрос "Какой блок проверить дальше?" "API" "БД" "Логика" "Медиа"
    использовать full_test_меню

при нажатии "🖼 Медиа":
    использовать full_test_медиа

при фото:
    ответ "📷 Full Test получил фото: {файл_id}"
    использовать full_test_меню

при документе:
    ответ "📄 Full Test получил документ: {имя_файла} ({файл_id})"
    использовать full_test_меню

при геолокации:
    ответ "📍 Full Test получил геолокацию: {широта}, {долгота}"
    использовать full_test_меню

при нажатии "💾 Данные":
    сохранить "full_test_status_{chat_id}" = "ok"
    получить "full_test_status_{chat_id}" → статус
    все_ключи → ключи
    сохранить_глобально "full_test_last_user" = пользователь.id
    получить от пользователь.id "full_test_status_{chat_id}" → статус_из_профиля
    ответ "💾 Статус: {статус}. Ключи: {ключи}. Из профиля: {статус_из_профиля}"
    удалить "full_test_temp_{chat_id}"
    использовать full_test_меню

блок full_test_api:
    http_get "https://jsonplaceholder.typicode.com/todos/1" → api_get
    http_post "https://jsonplaceholder.typicode.com/posts" с "source=Full Test" → api_post
    http_patch "https://jsonplaceholder.typicode.com/posts/1" с "title=Full Test" → api_patch
    http_put "https://jsonplaceholder.typicode.com/posts/1" с "source=Full Test" → api_put
    http_delete "https://jsonplaceholder.typicode.com/posts/1" → api_delete
    запомни rows = "SQL demo"
    запомни намерение = "other"
    запрос_бд "select 1 as full_test" → rows
    классифицировать ["support", "sales", "other"] → намерение
    ответ "🌐 API проверены. GET: {api_get}\\nPOST: {api_post}\\nPATCH: {api_patch}\\nPUT: {api_put}\\nDELETE: {api_delete}\\nSQL: {rows}\\nIntent: {намерение}"
    использовать full_test_меню

при нажатии "🌐 API":
    использовать full_test_api

при нажатии "go_api":
    использовать full_test_api

при нажатии "🔁 Логика":
    ответ "🔁 Условия, циклы, пауза, typing, random и вызов блока."
    запомни список = ["один", "два", "три"]
    для каждого элемент в список:
        ответ "• foreach: {элемент}"
    запомни n = 2
    пока n > 0:
        ответ "while n={n}"
        запомни n = n - 1
    повторять 2 раз:
        ответ "repeat Full Test"
    таймаут 3 секунд:
        печатает 1с
        пауза 1с
    рандом:
        "🎲 random: A"
        "🎲 random: B"
        "🎲 random: C"
    вызвать "full_test_ping" → ping_result
    ответ "Вызов блока: {ping_result}"
    использовать full_test_меню

блок full_test_ping:
    ответ "pong from Full Test"
    вернуть "pong"

при нажатии "🛡 Админ":
    проверить подписку @your_channel → подписан
    роль @your_channel пользователь.id → роль_канала
    переслать сообщение ADMIN_ID
    уведомить ADMIN_ID: "Full Test: пользователь {пользователь.id} открыл админ-раздел."
    рассылка группе testers: "Full Test broadcast для группы testers"
    ответ "🛡 Telegram admin: подписка={подписан}, роль={роль_канала}."
    использовать full_test_меню

при нажатии "⚙️ Настройки":
    ответ "⚙️ Настройки Full Test:"
    inline-кнопки:
        ["🇷🇺 RU" → "ft_lang_ru", "🇬🇧 EN" → "ft_lang_en"]
        ["💳 Тест оплаты" → "ft_payment", "❌ Закрыть" → "ft_close"]

при нажатии "ft_lang_ru":
    сохранить "full_test_lang_{chat_id}" = "ru"
    ответ "🇷🇺 Язык Full Test: RU"
    использовать full_test_меню

при нажатии "ft_lang_en":
    сохранить "full_test_lang_{chat_id}" = "en"
    ответ "🇬🇧 Full Test language: EN"
    использовать full_test_меню

при нажатии "ft_payment":
    оплата test_provider 100 RUB "Full Test payment"
    ответ "💳 Тестовый платёж создан."

при нажатии "ft_close":
    использовать full_test_меню

при нажатии "❓ Помощь":
    перейти "/help"

при нажатии "🏠 Главное меню":
    использовать full_test_меню

иначе:
    ответ "🤔 Full Test не понял: {текст}"
    использовать full_test_меню
`

  const loadExampleFromFile = useCallback((exampleName) => {
    const examples = {
      echo: EXAMPLE_ECHO,
      shop: EXAMPLE_SHOP,
      full: EXAMPLE_FULL,
      fullTest: EXAMPLE_FULL_TEST,
    };

    const code = examples[exampleName];
    if (!code) {
      showToast('Пример не найден', 'error');
      return;
    }

    const parsedStacks = parseDSL(code);
    if (parsedStacks) {
      const userTestToken = (currentUser?.test_token || '').trim();
      const normalizedStacks = userTestToken
        ? parsedStacks.map((s) => ({
            ...s,
            blocks: (s.blocks || []).map((b) =>
              b.type === 'bot'
                ? { ...b, props: { ...(b.props || {}), token: userTestToken } }
                : b,
            ),
          }))
        : parsedStacks;
      seq = 1;
      setStacks(normalizedStacks);
      setSelectedBlockId(null);
      setSelectedStackId(null);
      setProjectName(exampleName === 'echo' ? 'Эхо Бот' : exampleName === 'shop' ? 'Магазин Бот' : exampleName === 'fullTest' ? 'Full Test' : 'Все Функции');
    } else {
      showToast('Не удалось разобрать пример', 'error');
    }
  }, [parseDSL, showToast, currentUser]);

  const startFirstWowFlow = useCallback(() => {
    loadExampleFromFile('echo');
    showToast('⚡ Шаблон загружен: нажми «Старт», чтобы увидеть первый результат', 'success');
    setTourStep(0);
    setTourActive(true);
  }, [loadExampleFromFile, showToast]);

  const saveProject = useCallback(() => {
    const data = JSON.stringify(stacks, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cicada-project.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [stacks]);

  const loadProject = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = JSON.parse(event.target.result);
          if (Array.isArray(data)) {
            setStacks(data);
            setSelectedBlockId(null);
            setSelectedStackId(null);
            showToast('Проект загружен!', 'success');
          }
        } catch (err) {
          showToast('Ошибка загрузки файла', 'error');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [showToast]);

  const loadCCD = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ccd';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const code = event.target.result;
          const parsedStacks = parseDSL(code);
          if (parsedStacks && parsedStacks.length > 0) {
            setStacks(parsedStacks);
            setSelectedBlockId(null);
            setSelectedStackId(null);
            const name = file.name.replace(/\.ccd$/i, '');
            setProjectName(name);
            showToast('Бот загружен: ' + file.name, 'success');
          } else {
            const diagnostics = lintDSLSchema(code).slice(0, 2);
            if (diagnostics.length) {
              showToast(`Ошибка .ccd: ${diagnostics[0].message} (строка ${diagnostics[0].line})`, 'error');
            } else {
              showToast('Не удалось разобрать .ccd файл', 'error');
            }
          }
        } catch (err) {
          showToast('Ошибка загрузки файла', 'error');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [showToast, parseDSL]);

  // Bot run/stop state
  const [isBotRunning, setIsBotRunning] = useState(false);
  const [isStartingBot, setIsStartingBot] = useState(false);
  const [startBotError, setStartBotError] = useState(null);
  const [isStoppingBot, setIsStoppingBot] = useState(false);
  const [stopBotError, setStopBotError] = useState(null);
  const [autoStopSecondsLeft, setAutoStopSecondsLeft] = useState(null);
  const autoStopIntervalRef = useRef(null);

  const [previewPanelOpen, setPreviewPanelOpen] = useState(false);
  const [previewMessages, setPreviewMessages] = useState([]);
  const [previewDraft, setPreviewDraft] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewErr, setPreviewErr] = useState(null);
  const previewScrollRef = useRef(null);

  const [botDebugOpen, setBotDebugOpen] = useState(false);
  const [botDebugLogs, setBotDebugLogs] = useState('');
  const botDebugScrollRef = useRef(null);

  // Start countdown from remaining seconds (server handles actual kill)
  const startCountdown = useCallback((secondsLeft) => {
    if (autoStopIntervalRef.current) clearInterval(autoStopIntervalRef.current);
    setAutoStopSecondsLeft(secondsLeft);
    autoStopIntervalRef.current = setInterval(() => {
      setAutoStopSecondsLeft(prev => {
        if (prev <= 1) { clearInterval(autoStopIntervalRef.current); return 0; }
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Check if bot is running on server (survives page refresh / other browsers)
  const checkBotStatus = async () => {
    try {
      const userId = localStorage.getItem('cicada_userId');
      if (!userId) return;
      const res = await fetch(`${API_URL}/bots`);
      const list = await res.json();
      const myBot = list.find(b => b.userId === userId);
      if (myBot) {
        setIsBotRunning(true);
        if (myBot.startedAt) {
          const elapsed = Math.floor((Date.now() - myBot.startedAt) / 1000);
          const remaining = Math.max(0, 300 - elapsed);
          if (remaining > 0) startCountdown(remaining);
        }
      } else {
        setIsBotRunning(false);
        if (autoStopIntervalRef.current) clearInterval(autoStopIntervalRef.current);
        setAutoStopSecondsLeft(null);
      }
    } catch (e) {
      // server unreachable — leave as false
    }
  };

  // Load session on startup
  useEffect(() => {
    // Если в URL есть токен сброса пароля — игнорируем сессию и показываем форму
    const params = new URLSearchParams(window.location.search);
    const hasResetToken = !!params.get('reset');

    if (hasResetToken) {
      clearSession();
      setCurrentUser(null);
      setShowAuthModal(true);
      checkBotStatus();
      return;
    }

    const user = getSession();
    const authError = params.get('auth_error');
    if (authError) {
      showToast(decodeURIComponent(authError), 'error');
      params.delete('auth_error');
      const nextQuery = params.toString();
      window.history.replaceState({}, '', nextQuery ? `/?${nextQuery}` : '/');
    }

    if (user) {
      setCurrentUser(user);
      setShowAuthModal(false);
      if (!getStoredJwt()) {
        fetchOauthBootstrapUser()
          .then((u) => {
            if (u) {
              saveSession(u);
              setCurrentUser(u);
              loadUserProjects(u.id);
            } else {
              clearSession();
              setCurrentUser(null);
              setShowAuthModal(true);
            }
          })
          .catch((e) => {
            clearSession();
            setCurrentUser(null);
            if (e?.oauth2fa || e?.twofaRequired) setOauth2faPending(true);
            setShowAuthModal(true);
          });
      } else {
        loadUserProjects(user.id);
      }
    } else {
      fetchOauthBootstrapUser()
        .then((u) => {
          if (u) {
            saveSession(u);
            setCurrentUser(u);
            setShowAuthModal(false);
            loadUserProjects(u.id);
          } else {
            setShowAuthModal(false);
          }
        })
        .catch((e) => {
          if (e?.oauth2fa || e?.twofaRequired) {
            setOauth2faPending(true);
            setAuthTab('login');
            setShowAuthModal(true);
            return;
          }
          setShowAuthModal(false);
        });
    }

    // Check if bot is already running on server after page refresh
    checkBotStatus();

    // Глобальный обработчик: сессия истекла → показать форму входа
    const handleExpired = () => {
      setCurrentUser(null);
      setUserProjects([]);
      setShowProfileModal(false);
      setAuthTab('login');
      setShowAuthModal(true);
      showToast('⚠️ Сессия истекла — войдите заново', 'error');
    };
    window.addEventListener('cicada:session-expired', handleExpired);
    return () => window.removeEventListener('cicada:session-expired', handleExpired);
  }, [showToast]);

  // Подтягиваем план/подписку с сервера: админ изменил профиль → без выхода из аккаунта
  useEffect(() => {
    if (!currentUser?.id || !getStoredJwt()) return undefined;
    let cancelled = false;
    const sync = () => {
      fetchSessionUserFromServer().then((u) => {
        if (cancelled || !u) return;
        setCurrentUser((prev) => {
          if (!prev || String(prev.id) !== String(u.id)) return prev;
          const merged = { ...prev, ...u };
          saveSession(merged);
          return merged;
        });
      });
    };
    sync();
    const interval = setInterval(sync, 20_000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') sync();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', sync);
    window.addEventListener('pageshow', sync);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', sync);
      window.removeEventListener('pageshow', sync);
    };
  }, [currentUser?.id]);

  useEffect(() => {
    if (!showProfileModal || !currentUser?.id || !getStoredJwt()) return undefined;
    let cancelled = false;
    fetchSessionUserFromServer().then((u) => {
      if (cancelled || !u) return;
      setCurrentUser((prev) => {
        if (!prev || String(prev.id) !== String(u.id)) return prev;
        const merged = { ...prev, ...u };
        saveSession(merged);
        return merged;
      });
    });
    return () => { cancelled = true; };
  }, [showProfileModal, currentUser?.id]);

  // Poll every 5s — syncs bot status across browsers/tabs
  useEffect(() => {
    const id = setInterval(checkBotStatus, 5000);
    return () => clearInterval(id);
  }, [startCountdown]);

  // Generate DSL from current stacks
  const generateBotDSL = useCallback(() => {
    let dsl = '';
    const hasBot = stacks.some(s => s.blocks.some(b => b.type === 'bot'));
    if (!hasBot) {
      dsl += `бот "0000000000:PASTE_YOUR_BOTFATHER_TOKEN_HERE"\n\n`;
    }
    stacks.forEach(stack => {
      dsl += stackToDSL(stack) + '\n\n';
    });
    return dsl.trim();
  }, [stacks]);

  const runPreviewStep = useCallback(
    async ({ text = '', callbackData = null }) => {
      setPreviewBusy(true);
      setPreviewErr(null);
      try {
        const code = generateBotDSL();
        const sessionId = getOrCreatePreviewSessionId();
        const token = await getCsrfTokenForRequest();
        const res = await fetch('/api/bot/preview', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': token,
          },
          body: JSON.stringify({
            sessionId,
            code,
            chatId: 990000001,
            text: text != null ? String(text) : '',
            callbackData: callbackData != null && String(callbackData).length > 0 ? String(callbackData) : null,
          }),
        });
        const raw = await res.json().catch(() => ({}));
        if (!res.ok) {
          setPreviewErr(typeof raw.error === 'string' ? raw.error : `Ошибка ${res.status}`);
          return;
        }
        if (!raw.ok) {
          setPreviewErr(raw.error || 'Ошибка превью');
          if (Array.isArray(raw.outbound) && raw.outbound.length) {
            setPreviewMessages((prev) => [...prev, ...previewOutboundToEntries(raw.outbound)]);
          }
          return;
        }
        setPreviewMessages((prev) => [...prev, ...previewOutboundToEntries(raw.outbound)]);
      } catch (e) {
        setPreviewErr(e.message || String(e));
      } finally {
        setPreviewBusy(false);
      }
    },
    [generateBotDSL],
  );

  const sendPreviewUserText = useCallback(
    async (t) => {
      const text = String(t ?? '').trim();
      if (!text || previewBusy) return;
      setPreviewMessages((prev) => [...prev, { role: 'user', kind: 'text', text }]);
      await runPreviewStep({ text });
    },
    [runPreviewStep, previewBusy],
  );

  const sendPreviewCallback = useCallback(
    async (data) => {
      const cb = String(data ?? '');
      if (!cb || previewBusy) return;
      setPreviewMessages((prev) => [...prev, { role: 'user', kind: 'text', text: `ⓘ ${cb}` }]);
      await runPreviewStep({ text: '', callbackData: cb });
    },
    [runPreviewStep, previewBusy],
  );

  const resetPreviewSession = useCallback(() => {
    try {
      sessionStorage.removeItem(PREVIEW_SESSION_STORAGE_KEY);
    } catch { /* ignore */ }
    setPreviewMessages([]);
    setPreviewErr(null);
    setPreviewDraft('');
  }, []);

  useEffect(() => {
    if (!previewPanelOpen) return;
    const el = previewScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [previewPanelOpen, previewMessages, previewBusy]);

  useEffect(() => {
    if (!botDebugOpen) return;
    const el = botDebugScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [botDebugOpen, botDebugLogs]);

  useEffect(() => {
    if (!botDebugOpen) return;
    const userId = localStorage.getItem('cicada_userId');
    if (!userId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(`${API_URL}/bot/logs?userId=${encodeURIComponent(userId)}`);
        const data = await r.json().catch(() => ({}));
        if (cancelled || data.logs == null) return;
        setBotDebugLogs(String(data.logs));
      } catch { /* ignore */ }
    };
    tick();
    const id = setInterval(tick, 1200);
    return () => { cancelled = true; clearInterval(id); };
  }, [botDebugOpen]);

  // Get or create userId
  const getUserId = useCallback(() => {
    let userId = localStorage.getItem('cicada_userId');
    if (!userId) {
      userId = Math.random().toString(36).substring(2);
      localStorage.setItem('cicada_userId', userId);
    }
    return userId;
  }, []);

  // Start bot
  const startBot = useCallback(async () => {
    setIsStartingBot(true);
    setStartBotError(null);
    try {
      const userId = getUserId();
      const code = generateBotDSL();
      const response = await postJsonWithCsrf('/api/run', { code, userId });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.error) {
        let msg = data.error || `Ошибка запуска (HTTP ${response.status})`;
        const d = data.details || {};
        if (d.logTail) {
          msg += `\n\nЛог:\n${d.logTail}`;
        } else if (d.reason || d.code != null || d.signal) {
          msg += `\n\nДетали: reason=${d.reason || 'exit'}, code=${d.code ?? 'null'}, signal=${d.signal ?? 'null'}`;
        }
        setStartBotError(msg);
        return;
      }
      setIsBotRunning(true);
      setBotDebugLogs('');
      setBotDebugOpen(true);
      showToast('✅ Бот запущен: ' + (data.name || data.bot), 'success');
      // Start client-side countdown from server's autoStopIn value
      if (data.autoStopIn) startCountdown(data.autoStopIn);
    } catch (e) {
      setStartBotError(e.message);
    } finally {
      setIsStartingBot(false);
    }
  }, [generateBotDSL, showToast, getUserId, startCountdown]);

  // Stop bot
  const stopBot = useCallback(async () => {
    setIsStoppingBot(true);
    setStopBotError(null);
    try {
      const userId = getUserId();
      const response = await postJsonWithCsrf('/api/stop', { userId });
      const data = await response.json();
      if (data.error) {
        setStopBotError(data.error);
        return;
      }
      setIsBotRunning(false);
      if (autoStopIntervalRef.current) clearInterval(autoStopIntervalRef.current);
      setAutoStopSecondsLeft(null);
      showToast('⛔ Бот остановлен', 'info');
    } catch (e) {
      setStopBotError(e.message);
    } finally {
      setIsStoppingBot(false);
    }
  }, [showToast, getUserId]);

  const authModalNode = showAuthModal ? (
    <AuthModal
      tab={authTab}
      setTab={setAuthTab}
      canClose={!!currentUser}
      onClose={() => setShowAuthModal(false)}
      onLogin={async (email, password, totp, tgData) => {
        let user;
        if (tgData) {
          user = await telegramAuth(tgData);
        } else if (oauth2faPending) {
          user = await completeOauth2fa(totp);
          setOauth2faPending(false);
        } else {
          user = await loginUser(email, password, totp);
        }
        saveSession(user);
        setCurrentUser(user);
        await loadUserProjects(user.id);
        setShowAuthModal(false);
        showToast('Вход выполнен!', 'success');
      }}
      onRegister={async (name, email, password) => {
        const result = await registerUser(name, email, password);
        if (result.needVerify) {
          return result; // AuthModal переключится на экран "проверьте почту"
        }
        if (result.user) {
          saveSession(result.user);
          setCurrentUser(result.user);
          setShowAuthModal(false);
          await loadUserProjects(result.user.id);
          fireRegistrationConfetti();
          showToast('Регистрация успешна! 3 дня PRO уже на аккаунте.', 'success');
        }
      }}
      forceTotp={oauth2faPending}
    />
  ) : null;

  if (!currentUser) {
    const openRegister = () => { setAuthTab('register'); setShowAuthModal(true); };
    const openLogin    = () => { setAuthTab('login');    setShowAuthModal(true); };
    const lp = isMobileView;
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg,#06030f 0%,#0b0720 40%,#080518 70%,#05030e 100%)', color: '#fff', fontFamily: 'system-ui,sans-serif' }}>
        <style>{`
          @keyframes landingGrid { from{background-position:0 0} to{background-position:60px 60px} }
          @keyframes landingPulse { 0%,100%{opacity:.45} 50%{opacity:.9} }
          @keyframes panelFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
          @keyframes fadeUp { from{opacity:0;transform:translateY(18px)} to{opacity:1;transform:translateY(0)} }
          @keyframes fadeUpDelay { from{opacity:0;transform:translateY(22px)} to{opacity:1;transform:translateY(0)} }
          @keyframes glowArc { 0%{stroke-dashoffset:800} 100%{stroke-dashoffset:0} }
          @keyframes starTwinkle { 0%,100%{opacity:0;transform:scale(0.5)} 50%{opacity:1;transform:scale(1)} }
          @keyframes orbFloat { 0%,100%{transform:translateY(0) translateX(0)} 33%{transform:translateY(-18px) translateX(8px)} 66%{transform:translateY(10px) translateX(-6px)} }
          @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
          @keyframes neonPulse { 0%,100%{opacity:0.7;filter:blur(18px)} 50%{opacity:1;filter:blur(22px)} }
          .lp-fadeup { animation: fadeUp .65s ease both; }
          .lp-fadeup2 { animation: fadeUp .65s .15s ease both; }
          .lp-fadeup3 { animation: fadeUp .65s .3s ease both; }
          .lp-card { border:1px solid rgba(255,255,255,0.09); border-radius:14px; background:rgba(255,255,255,0.03); transition:border-color .2s,transform .2s,background .2s; }
          .lp-card:hover { border-color:rgba(255,255,255,0.18); background:rgba(255,255,255,0.055); transform:translateY(-2px); }
          .lp-btn-ghost { background:rgba(255,255,255,0.06); color:rgba(255,255,255,0.9); border-radius:10px; border:1px solid rgba(255,255,255,0.2); font-size:14px; font-weight:600; cursor:pointer; transition:all .2s; padding:10px 20px; display:flex; align-items:center; gap:8px; }
          .lp-btn-ghost:hover { background:rgba(255,255,255,0.12); border-color:rgba(255,255,255,0.35); }
          .lp-btn-gold { background:linear-gradient(135deg,#ff9f00,#f59e0b,#ffd700); color:#111; border:none; font-weight:800; cursor:pointer; transition:all .2s; font-family:Syne,system-ui; box-shadow:0 4px 20px rgba(245,158,11,0.35); }
          .lp-btn-gold:hover { filter:brightness(1.1); box-shadow:0 8px 32px rgba(245,158,11,0.55); transform:translateY(-2px); }
          .lp-step-dot { width:44px; height:44px; border-radius:50%; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.12); display:flex; align-items:center; justify-content:center; font-family:Syne,system-ui; font-weight:800; font-size:16px; color:#fbbf24; margin-bottom:14px; }
          .lp-nav-link { background:none; border:none; color:rgba(255,255,255,0.7); font-size:14px; cursor:pointer; transition:color .2s; padding:4px 2px; }
          .lp-nav-link:hover { color:#fff; }
          .lp-nav-pill {
            display:inline-flex; align-items:center; gap:6px;
            padding:7px 16px; border-radius:999px; font-size:13px; font-weight:600;
            cursor:pointer; transition:all .22s ease; white-space:nowrap;
            font-family:Syne,system-ui; letter-spacing:0.01em;
            border:1px solid rgba(255,255,255,0.1);
            background:rgba(255,255,255,0.04);
            color:rgba(255,255,255,0.72);
            position:relative; overflow:hidden; backdrop-filter:blur(4px);
          }
          .lp-nav-pill:hover {
            background:rgba(255,215,0,0.07);
            color:#fff;
            transform:translateY(-1px);
          }
          .lp-nav-pill .pill-icon { font-size:13px; line-height:1; transition:transform .22s; }
          .lp-nav-pill:hover .pill-icon { transform:scale(1.2); }
          .lp-price-card { border:1px solid rgba(255,255,255,0.1); border-radius:16px; padding:24px; background:rgba(255,255,255,0.03); transition:border-color .2s; }
          .lp-price-card:hover { border-color:rgba(255,255,255,0.2); }
          .lp-price-card.featured { border-color:#fbbf24; background:rgba(251,191,36,0.04); }
          .lp-check { color:#3ecf8e; margin-right:6px; }
          .lp-cross { color:#f87171; margin-right:6px; }
          .lp-star { position:absolute; border-radius:50%; background:#fff; animation:starTwinkle var(--dur,3s) var(--delay,0s) ease-in-out infinite; }
          .mock-panel { animation: panelFloat 5.8s ease-in-out infinite; }
          .mock-neon-wrap { border-radius:20px; padding:2px; background:linear-gradient(135deg,rgba(99,102,241,0.8),rgba(59,130,246,0.6),rgba(139,92,246,0.8)); box-shadow:0 0 40px rgba(99,102,241,0.5),0 0 80px rgba(59,130,246,0.25),0 0 120px rgba(139,92,246,0.15); }
          .feat-card { border:1px solid rgba(255,255,255,0.08); border-radius:16px; padding:22px 18px; background:rgba(255,255,255,0.025); transition:all .25s; cursor:default; }
          .feat-card:hover { border-color:rgba(255,215,0,0.3); background:rgba(255,215,0,0.04); transform:translateY(-3px); box-shadow:0 12px 32px rgba(0,0,0,0.4); }
          .stat-card { border-radius:14px; border:1px solid rgba(255,255,255,0.12); background:rgba(10,8,25,0.7); backdrop-filter:blur(10px); padding:18px 20px; display:flex; align-items:center; gap:16px; transition:border-color .2s,transform .2s; }
          .stat-card:hover { border-color:rgba(255,255,255,0.22); transform:translateY(-2px); }
        `}</style>

        {/* ambient glows — cyberpunk */}
        <div style={{ position:'fixed', inset:0, pointerEvents:'none', zIndex:0 }}>
          {/* Orange/amber — top left */}
          <div style={{ position:'absolute', top:'-5%', left:'-8%', width:'60%', height:'65%', background:'radial-gradient(ellipse at 30% 30%,rgba(245,128,11,0.22) 0%,rgba(180,60,0,0.12) 35%,transparent 65%)' }} />
          {/* Blue — top right */}
          <div style={{ position:'absolute', top:'-5%', right:'-10%', width:'60%', height:'60%', background:'radial-gradient(ellipse at 70% 25%,rgba(59,130,246,0.22) 0%,rgba(99,40,240,0.14) 40%,transparent 65%)' }} />
          {/* Purple — center */}
          <div style={{ position:'absolute', top:'30%', left:'30%', width:'45%', height:'45%', background:'radial-gradient(ellipse,rgba(124,58,237,0.12) 0%,transparent 65%)', animation:'neonPulse 6s ease-in-out infinite' }} />
          {/* Cyan glow — bottom right */}
          <div style={{ position:'absolute', bottom:'5%', right:'10%', width:'40%', height:'40%', background:'radial-gradient(ellipse,rgba(6,182,212,0.1) 0%,transparent 65%)', animation:'orbFloat 9s ease-in-out infinite' }} />
          {/* Grid overlay */}
          <div style={{ position:'absolute', inset:0, backgroundImage:'linear-gradient(rgba(99,102,241,0.06) 1px,transparent 1px),linear-gradient(90deg,rgba(99,102,241,0.06) 1px,transparent 1px)', backgroundSize:'60px 60px', opacity:1 }} />
          {/* Diagonal scan lines */}
          <div style={{ position:'absolute', inset:0, backgroundImage:'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.08) 2px,rgba(0,0,0,0.08) 4px)', opacity:0.4 }} />
          {/* Stars */}
          {[...Array(35)].map((_,i) => (
            <div key={i} className="lp-star" style={{
              width: Math.random()*2+1+'px', height: Math.random()*2+1+'px',
              top: Math.random()*100+'%', left: Math.random()*100+'%',
              '--dur': (Math.random()*4+2)+'s', '--delay': (Math.random()*5)+'s',
              opacity: Math.random()*0.5+0.15,
            }} />
          ))}
          {/* Floating neon orbs */}
          <div style={{ position:'absolute', top:'20%', right:'15%', width:380, height:380, borderRadius:'50%', background:'radial-gradient(circle,rgba(99,40,240,0.12) 0%,transparent 65%)', animation:'orbFloat 14s ease-in-out infinite' }} />
          <div style={{ position:'absolute', top:'60%', left:'5%', width:240, height:240, borderRadius:'50%', background:'radial-gradient(circle,rgba(245,128,11,0.1) 0%,transparent 65%)', animation:'orbFloat 10s ease-in-out infinite reverse' }} />
          <div style={{ position:'absolute', bottom:'10%', right:'30%', width:300, height:300, borderRadius:'50%', background:'radial-gradient(circle,rgba(6,182,212,0.08) 0%,transparent 65%)', animation:'orbFloat 11s ease-in-out infinite 2s' }} />
        </div>

        {/* ── NAV ── */}
        <nav style={{ position:'sticky', top:0, zIndex:100, backdropFilter:'blur(18px)', background:'rgba(5,7,12,0.85)', borderBottom:'1px solid rgba(255,255,255,0.07)', padding: lp ? '0 16px' : '0 40px', height:62, display:'flex', alignItems:'center', justifyContent:'space-between', gap:16 }}>
          {/* Logo */}
          <div style={{ fontFamily:'Syne,system-ui', fontSize:22, fontWeight:800, lineHeight:1, display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
            <span style={{ color:'#ffd700', textShadow:'0 0 14px rgba(255,215,0,0.5)', fontSize:20 }}>◈</span>
            <span style={{ background:'linear-gradient(135deg,#ffd700 0%,#ffaa00 55%,#ffd700 100%)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>Cicada</span>
            <span style={{ color:'rgba(255,255,255,0.45)', fontSize:13, fontWeight:400 }}>studio</span>
          </div>
          {/* Nav links — desktop only */}
          {!lp && (
            <div style={{ display:'flex', alignItems:'center', gap:2, flex:1, justifyContent:'center' }}>
              {[
                { id:'features', label:'Возможности', icon:'✨', clr:'rgba(251,191,36,0.45)' },
                { id:'templates', label:'Шаблоны', icon:'🎨', clr:'rgba(96,165,250,0.45)' },
                { id:'pricing', label:'Тарифы', icon:'💳', clr:'rgba(52,211,153,0.45)' },
              ].map(({ id, label, icon, clr }) => (
                <button
                  key={id}
                  className="lp-nav-pill"
                  style={{ '--pill-clr': clr }}
                  onClick={() => setLandingInfoPage(id)}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = clr;
                    e.currentTarget.style.boxShadow = `0 0 14px ${clr.replace('0.45','0.18')}, 0 2px 8px rgba(0,0,0,0.25)`;
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <span className="pill-icon">{icon}</span>
                  {label}
                </button>
              ))}
            </div>
          )}
          {/* Right actions */}
          <div style={{ display:'flex', gap:8, alignItems:'center', flexShrink:0 }}>
            <button onClick={openLogin} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.82)', fontSize:13, fontWeight:600, cursor:'pointer', padding: lp ? '7px 10px' : '7px 18px', borderRadius:8, fontFamily:'system-ui,sans-serif', transition:'color .2s' }}
              onMouseEnter={e=>e.currentTarget.style.color='#fff'}
              onMouseLeave={e=>e.currentTarget.style.color='rgba(255,255,255,0.82)'}
            >Войти</button>
            <button className="lp-btn-gold" onClick={openRegister} style={{ borderRadius:9, padding: lp ? '8px 14px' : '9px 20px', fontSize:13, display:'flex', alignItems:'center', gap:6 }}>
              {lp ? '→' : 'Начать бесплатно →'}
            </button>
          </div>
        </nav>

        <div style={{ position:'relative' }}>
          {landingInfoPage && LANDING_PAGE_CONTENT[landingInfoPage] && (
            <LandingInfoModal page={landingInfoPage} onClose={() => setLandingInfoPage(null)} isMobile={lp} />
          )}

          {/* ── HERO ── */}
          <div style={{ maxWidth:1220, margin:'0 auto', padding: lp ? '24px 16px 16px' : '36px 40px 40px' }}>
            <div style={{ display:'grid', gridTemplateColumns: lp ? '1fr' : '1fr 1.05fr', gap: lp ? 24 : 40, alignItems:'flex-start', width:'100%' }}>

              {/* Left */}
              <div className="lp-fadeup">
                <div style={{ display:'inline-flex', alignItems:'center', gap:6, border:'1px solid rgba(251,191,36,0.35)', borderRadius:999, padding:'5px 12px', fontSize:11, color:'#fde68a', background:'rgba(251,191,36,0.1)', marginBottom: lp ? 10 : 16 }}>✨ Studio для Telegram-ботов</div>
                <h1 style={{ fontFamily:'Syne,system-ui', fontWeight:800, fontSize: lp ? 32 : 48, lineHeight: lp ? 1.05 : 1.0, letterSpacing:'-0.02em', marginBottom: lp ? 8 : 12 }}>
                  Запусти<br/>красивого бота<br/><span style={{ color:'#fbbf24' }}>за вечер</span>
                </h1>
                <p style={{ color:'rgba(255,255,255,0.7)', fontSize: lp ? 12 : 15, lineHeight:1.5, maxWidth:500, marginBottom: lp ? 10 : 16 }}>
                  Собирай Telegram-бота блоками, проверяй сценарий и запускай в пару кликов. Без длинной настройки и без ручного кода в начале.
                </p>
                <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', marginBottom:14 }}>
                  <button className="lp-btn-gold" onClick={openRegister} style={{ borderRadius:10, padding:'11px 22px', fontSize:14 }}>Начать бесплатно →</button>

                </div>
                <div style={{ marginTop:10, fontSize:11, color:'rgba(255,255,255,0.45)', display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ width:7, height:7, borderRadius:'50%', background:'#3ecf8e', boxShadow:'0 0 6px #3ecf8e', display:'inline-block' }} />
                  Бесплатно навсегда для одного проекта
                </div>
              </div>

              {/* Right — mockup */}
              {!lp && (
                <div style={{ position:'relative', animation:'panelFloat 5.8s ease-in-out infinite', paddingTop:28, overflow:'visible' }} className="lp-fadeup">
                  {/* Glow arc — как на скриншоте */}
                  <svg style={{ position:'absolute', top:'0%', right:'-14%', width:'135%', height:'120%', pointerEvents:'none', zIndex:0 }} viewBox="0 0 500 420" fill="none">
                    <path d="M420 400 Q490 210 380 65 Q295 -15 155 25" stroke="url(#arcGrad)" strokeWidth="1.5" strokeDasharray="820" strokeDashoffset="820" style={{ animation:'glowArc 2.8s 0.3s ease forwards' }} opacity="0.7"/>
                    <defs>
                      <linearGradient id="arcGrad" x1="0%" y1="100%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#7c6ef2" stopOpacity="0"/>
                        <stop offset="35%" stopColor="#7c6ef2" stopOpacity="0.9"/>
                        <stop offset="65%" stopColor="#ffd700" stopOpacity="0.7"/>
                        <stop offset="100%" stopColor="#ffd700" stopOpacity="0"/>
                      </linearGradient>
                    </defs>
                  </svg>
                  {/* Telegram bubble */}
                  <div style={{ position:'absolute', right:-28, top:'15%', width:52, height:52, borderRadius:'50%', background:'radial-gradient(circle at 35% 35%,#60a5fa,#2563eb)', border:'1px solid rgba(255,255,255,0.2)', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 8px 28px rgba(37,99,235,0.45)', animation:'landingPulse 3.5s ease-in-out infinite', zIndex:2 }}>
                    <svg viewBox="0 0 24 24" width="22" height="22"><path fill="#fff" d="M9.36 15.86l-.39 5.47c.56 0 .8-.24 1.09-.53l2.61-2.5 5.4 3.95c.99.55 1.69.26 1.96-.91l3.55-16.66h.01c.32-1.49-.54-2.08-1.5-1.72L1.55 10.9C.11 11.47.13 12.28 1.31 12.64l5.24 1.64L18.7 6.62c.57-.38 1.1-.17.67.21"/></svg>
                  </div>
                  <div className="mock-neon-wrap">
                  <div style={{ position:'relative', zIndex:1, borderRadius:18, background:'linear-gradient(180deg,rgba(12,14,24,0.99),rgba(6,8,16,1))', overflow:'hidden', boxShadow:'0 40px 100px rgba(0,0,0,0.8)' }}>
                    {/* titlebar */}
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', borderBottom:'1px solid rgba(255,255,255,0.07)', background:'rgba(8,10,16,0.9)' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <span style={{ width:9, height:9, borderRadius:'50%', background:'#f87171' }} />
                        <span style={{ width:9, height:9, borderRadius:'50%', background:'#fbbf24' }} />
                        <span style={{ width:9, height:9, borderRadius:'50%', background:'#34d399' }} />
                        <span style={{ marginLeft:8, fontSize:12, color:'rgba(255,255,255,0.75)', fontFamily:'Syne,system-ui', fontWeight:700 }}>Мой Бот</span>
                        <span style={{ background:'rgba(62,207,142,0.15)', border:'1px solid rgba(62,207,142,0.3)', color:'#3ecf8e', fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:10 }}>● Опубликован</span>
                      </div>
                      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                        <span style={{ fontSize:11, color:'rgba(255,255,255,0.45)' }}>🔍 Тестировать</span>
                        <button style={{ background:'linear-gradient(135deg,#fbbf24,#f59e0b)', color:'#111', borderRadius:7, padding:'5px 11px', fontSize:11, fontWeight:700, border:'none' }}>Опубликовать</button>
                      </div>
                    </div>
                    {/* body */}
                    <div style={{ display:'grid', gridTemplateColumns:'38px 1fr 150px' }}>
                      {/* sidebar */}
                      <div style={{ borderRight:'1px solid rgba(255,255,255,0.07)', padding:'10px 4px', display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
                        <div style={{ width:14, height:14, background:'#ffd700', clipPath:'polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)', marginBottom:8 }} />
                        {[['⛓','Сценарий',true],['🧩','Блоки'],['🔌','Вход'],['⚙','Настройки'],['📊','Аналитика']].map(([icon,label,active]) => (
                          <div key={label} style={{ width:36, height:36, borderRadius:8, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:active?'rgba(255,214,0,0.12)':'none', gap:2 }}>
                            <span style={{ fontSize:13 }}>{icon}</span>
                            <span style={{ fontSize:7, color:active?'#fbbf24':'rgba(255,255,255,0.4)', fontFamily:'Syne,system-ui' }}>{label}</span>
                          </div>
                        ))}
                      </div>
                      {/* canvas */}
                      <div style={{ padding:10, background:'#11121a', backgroundImage:'radial-gradient(circle,rgba(255,255,255,0.035) 1px,transparent 1px)', backgroundSize:'16px 16px' }}>
                        {[['/start','Команда','⌨'],['Приветствие','Сообщение','💬'],['Меню','Кнопки','🔘']].map(([title,sub,icon],i) => (
                          <React.Fragment key={title}>
                            <div style={{ border:'1px solid rgba(255,255,255,0.1)', borderRadius:7, padding:'6px 8px', width:110, background:'rgba(255,255,255,0.03)' }}>
                              <div style={{ display:'flex', alignItems:'center', gap:4, marginBottom:2 }}>
                                <span style={{ fontSize:10 }}>{icon}</span>
                                <span style={{ fontSize:10, fontWeight:600, color:'#e5e7eb', fontFamily:'Syne,system-ui' }}>{title}</span>
                              </div>
                              <div style={{ fontSize:8, color:'rgba(255,255,255,0.45)', paddingLeft:14 }}>{sub}</div>
                            </div>
                            {i < 2 && <div style={{ width:1, height:12, background:'rgba(255,255,255,0.18)', margin:'0 0 0 54px', position:'relative' }}><div style={{ position:'absolute', bottom:0, left:-3, borderLeft:'4px solid transparent', borderRight:'4px solid transparent', borderTop:'5px solid rgba(255,255,255,0.18)' }} /></div>}
                          </React.Fragment>
                        ))}
                        <div style={{ display:'flex', gap:6, marginTop:6, paddingLeft:6 }}>
                          {[['О нас','Сообщение','📝'],['Контакты','Контакты','📞']].map(([t,s,ic]) => (
                            <div key={t}>
                              <div style={{ width:1, height:12, background:'rgba(255,255,255,0.18)', margin:'0 auto 3px' }} />
                              <div style={{ border:'1px solid rgba(255,255,255,0.1)', borderRadius:7, padding:'5px 7px', width:80, background:'rgba(255,255,255,0.03)', opacity:.9 }}>
                                <div style={{ display:'flex', alignItems:'center', gap:3, marginBottom:2 }}><span style={{ fontSize:9 }}>{ic}</span><span style={{ fontSize:9, fontWeight:600, color:'#e5e7eb', fontFamily:'Syne,system-ui' }}>{t}</span></div>
                                <div style={{ fontSize:7, color:'rgba(255,255,255,0.45)', paddingLeft:12 }}>{s}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      {/* code */}
                      <div style={{ borderLeft:'1px solid rgba(255,255,255,0.07)', padding:'10px 8px', background:'#0c0d14', fontFamily:"'JetBrains Mono','Courier New',monospace", fontSize:9, lineHeight:1.65, overflowX:'hidden' }}>
                        <div style={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,0.45)', marginBottom:8, fontFamily:'Syne,system-ui' }}>Код сценария</div>
                        <div><span style={{ color:'#c678dd' }}>при</span> <span style={{ color:'#3ecf8e' }}>команде</span> <span style={{ color:'#61afef' }}>/start</span>:</div>
                        <div style={{ paddingLeft:8 }}><span style={{ color:'#3ecf8e' }}>  отправить</span> <span style={{ color:'#e5c07b' }}>"Привет! 👋</span></div>
                        <div style={{ paddingLeft:8 }}><span style={{ color:'#e5c07b' }}>  Я твой бот."</span></div>
                        <div style={{ paddingLeft:8 }}><span style={{ color:'#3ecf8e' }}>  показать</span> кнопки [</div>
                        <div style={{ paddingLeft:12 }}><span style={{ color:'#e5c07b' }}>"О нас"</span>, <span style={{ color:'#e5c07b' }}>"Контакты"</span> ]</div>
                        <div style={{ marginTop:6 }}><span style={{ color:'#e06c75' }}>при</span> <span style={{ color:'#3ecf8e' }}>нажатии</span> <span style={{ color:'#e5c07b' }}>"О нас"</span>:</div>
                        <div style={{ paddingLeft:8 }}><span style={{ color:'#3ecf8e' }}>  отправить</span> <span style={{ color:'#e5c07b' }}>"Мы команда</span></div>
                        <div style={{ paddingLeft:8 }}><span style={{ color:'#e5c07b' }}>  Cicada Studio."</span></div>
                        <div style={{ marginTop:6 }}><span style={{ color:'#e06c75' }}>при</span> <span style={{ color:'#3ecf8e' }}>нажатии</span> <span style={{ color:'#e5c07b' }}>"Контакты"</span>:</div>
                        <div style={{ paddingLeft:8 }}><span style={{ color:'#3ecf8e' }}>  отправить</span> <span style={{ color:'#61afef' }}>контакт</span> <span style={{ color:'#e5c07b' }}>@cicada</span></div>
                        <div style={{ marginTop:10, paddingTop:8, borderTop:'1px solid rgba(255,255,255,0.07)' }}>
                          <button style={{ width:'100%', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.5)', padding:'5px', borderRadius:6, fontSize:9, cursor:'pointer' }}>Редактировать код</button>
                        </div>
                      </div>
                    </div>
                  </div>
                  </div>{/* end mock-neon-wrap */}
                  {/* glow under */}
                  <div style={{ position:'absolute', bottom:-50, left:'50%', transform:'translateX(-50%)', width:320, height:80, background:'radial-gradient(ellipse,rgba(99,40,240,0.4) 0%,rgba(59,130,246,0.2) 40%,transparent 70%)', pointerEvents:'none' }} />
                </div>
              )}
            </div>
          </div>

          <>
          {/* ── STATS ── */}
          <div style={{ padding: lp ? '24px 16px' : '32px 40px' }}>
            <div style={{ maxWidth:1220, margin:'0 auto', display:'grid', gridTemplateColumns: lp ? '1fr 1fr' : 'repeat(4,1fr)', gap:16 }}>
              {[
                { icon:'🟣', iconBg:'rgba(139,92,246,0.25)', iconBorder:'rgba(139,92,246,0.5)', num:'2 000+', label:'ботов создано' },
                { icon:'🕐', iconBg:'rgba(34,197,94,0.2)',   iconBorder:'rgba(34,197,94,0.45)',  num:'5 мин',   label:'среднее время запуска' },
                { icon:'📊', iconBg:'rgba(249,115,22,0.2)',  iconBorder:'rgba(249,115,22,0.45)', num:'24/7',    label:'стабильная работа' },
                { icon:'❤️', iconBg:'rgba(239,68,68,0.2)',   iconBorder:'rgba(239,68,68,0.45)',  num:'98%',     label:'довольных пользователей' },
              ].map(({ icon, iconBg, iconBorder, num, label }) => (
                <div key={num} className="stat-card">
                  <div style={{ width:48, height:48, borderRadius:12, background:iconBg, border:`1px solid ${iconBorder}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, flexShrink:0 }}>{icon}</div>
                  <div>
                    <div style={{ fontFamily:'Syne,system-ui', fontWeight:800, fontSize: lp ? 24 : 30, color:'#fff', lineHeight:1 }}>{num}</div>
                    <div style={{ fontSize: lp ? 11 : 12, color:'rgba(255,255,255,0.5)', marginTop:4 }}>{label}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── FEATURES ── */}
          <div style={{ maxWidth:1220, margin:'0 auto', padding: lp ? '48px 16px' : '72px 40px' }}>
            <div style={{ marginBottom:10, fontSize:11, fontWeight:700, color:'#fbbf24', textTransform:'uppercase', letterSpacing:'0.1em' }}>✦ Всё, что нужно</div>
            <h2 style={{ fontFamily:'Syne,system-ui', fontWeight:800, fontSize: lp ? 28 : 38, marginBottom:8, lineHeight:1.15 }}>Полный набор инструментов</h2>
            <p style={{ color:'rgba(255,255,255,0.55)', fontSize: lp ? 13 : 15, marginBottom:36, maxWidth:480 }}>Всё необходимое для создания, настройки и запуска Telegram-бота любой сложности.</p>
            <div style={{ display:'grid', gridTemplateColumns: lp ? '1fr 1fr' : 'repeat(5,1fr)', gap:12 }}>
              {[
                ['🟣','Визуальный конструктор','Собирай сценарии из блоков как конструктор','#8b5cf6'],
                ['🤖','AI-помощник','Опиши идею — и получи готовый сценарий','#3ecf8e'],
                ['🚀','Запуск в 1 клик','Публикуй бота и получай ссылку за секунды','#f97316'],
                ['🧩','Готовые модули','Библиотека блоков для любых задач','#60a5fa'],
                ['📈','Аналитика','Следи за статистикой и развивай своего бота','#fbbf24'],
              ].map(([icon,title,text,color]) => (
                <div key={title} className="lp-card" style={{ padding: lp ? '16px 14px' : '22px 18px' }}>
                  <div style={{ fontSize:24, marginBottom:12 }}>{icon}</div>
                  <div style={{ fontFamily:'Syne,system-ui', fontSize:13, fontWeight:700, color, marginBottom:6 }}>{title}</div>
                  <div style={{ fontSize:12, color:'rgba(255,255,255,0.55)', lineHeight:1.5 }}>{text}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── HOW IT WORKS ── */}
          <div style={{ borderTop:'1px solid rgba(255,255,255,0.07)', borderBottom:'1px solid rgba(255,255,255,0.07)', background:'rgba(255,255,255,0.012)', padding: lp ? '48px 16px' : '72px 40px' }}>
            <div style={{ maxWidth:1220, margin:'0 auto' }}>
              <div style={{ marginBottom:10, fontSize:11, fontWeight:700, color:'#fbbf24', textTransform:'uppercase', letterSpacing:'0.1em' }}>✦ Как это работает</div>
              <h2 style={{ fontFamily:'Syne,system-ui', fontWeight:800, fontSize: lp ? 28 : 38, marginBottom:40, lineHeight:1.15 }}>Запусти бота за 4 шага</h2>
              <div style={{ display:'grid', gridTemplateColumns: lp ? '1fr 1fr' : 'repeat(4,1fr)', gap: lp ? 20 : 0, position:'relative' }}>
                {!lp && <div style={{ position:'absolute', top:22, left:'8%', right:'8%', height:1, background:'linear-gradient(to right,transparent,rgba(255,255,255,0.08),rgba(255,255,255,0.08),transparent)' }} />}
                {[['1','Добавь блоки','Перетащи нужные блоки на холст. Начни с «Бот» и «Старт».'],['2','Соедини логику','Связывай блоки сценарием — код генерируется сам.'],['3','Протестируй','Запусти тест прямо в редакторе без публикации.'],['4','Опубликуй','Один клик — и бот живёт в Telegram.']].map(([num,title,text]) => (
                  <div key={num} style={{ padding: lp ? '0' : '0 24px', position:'relative', zIndex:1 }}>
                    <div className="lp-step-dot">{num}</div>
                    <div style={{ fontFamily:'Syne,system-ui', fontWeight:700, fontSize:15, marginBottom:8 }}>{title}</div>
                    <div style={{ fontSize:13, color:'rgba(255,255,255,0.55)', lineHeight:1.6 }}>{text}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── PRICING ── */}
          <div style={{ maxWidth:1220, margin:'0 auto', padding: lp ? '48px 16px' : '72px 40px' }}>
            <div style={{ marginBottom:10, fontSize:11, fontWeight:700, color:'#fbbf24', textTransform:'uppercase', letterSpacing:'0.1em' }}>✦ Тарифы</div>
            <h2 style={{ fontFamily:'Syne,system-ui', fontWeight:800, fontSize: lp ? 28 : 38, marginBottom:8, lineHeight:1.15 }}>Прозрачные цены</h2>
            <p style={{ color:'rgba(255,255,255,0.55)', fontSize: lp ? 13 : 15, marginBottom:40 }}>Начни бесплатно и масштабируйся по мере роста.</p>
            <div style={{ display:'grid', gridTemplateColumns: lp ? '1fr' : 'repeat(3,1fr)', gap:20 }}>
              {/* Free */}
              <div className="lp-price-card">
                <div style={{ fontSize:12, fontWeight:700, color:'rgba(255,255,255,0.5)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:12 }}>Бесплатно</div>
                <div style={{ fontFamily:'Syne,system-ui', fontSize:38, fontWeight:800, marginBottom:4 }}>0₽<span style={{ fontSize:16, fontWeight:500, color:'rgba(255,255,255,0.5)' }}> /мес</span></div>
                <div style={{ fontSize:13, color:'rgba(255,255,255,0.5)', marginBottom:20 }}>Навсегда бесплатно</div>
                <div style={{ height:1, background:'rgba(255,255,255,0.08)', marginBottom:18 }} />
                {['1 проект','Визуальный конструктор','Базовые блоки','Экспорт .ccd'].map(f => <div key={f} style={{ display:'flex', alignItems:'center', fontSize:13, color:'rgba(255,255,255,0.7)', marginBottom:9 }}><span className="lp-check">✓</span>{f}</div>)}
                {['AI-помощник','Аналитика'].map(f => <div key={f} style={{ display:'flex', alignItems:'center', fontSize:13, color:'rgba(255,255,255,0.35)', marginBottom:9 }}><span className="lp-cross">✗</span>{f}</div>)}
                <button className="lp-btn-ghost" onClick={openRegister} style={{ width:'100%', marginTop:16, padding:'11px', borderRadius:9, fontSize:14 }}>Начать бесплатно</button>
              </div>
              {/* Pro */}
              <div className="lp-price-card featured" style={{ position:'relative' }}>
                <div style={{ position:'absolute', top:-13, left:'50%', transform:'translateX(-50%)', background:'linear-gradient(135deg,#ffd700,#f59e0b)', color:'#111', fontSize:11, fontWeight:800, padding:'3px 14px', borderRadius:20, fontFamily:'Syne,system-ui', whiteSpace:'nowrap' }}>⭐ Популярный</div>
                <div style={{ fontSize:12, fontWeight:700, color:'rgba(255,255,255,0.5)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:12 }}>Pro</div>
                <div style={{ fontFamily:'Syne,system-ui', fontSize:38, fontWeight:800, marginBottom:4 }}>990₽<span style={{ fontSize:16, fontWeight:500, color:'rgba(255,255,255,0.5)' }}> /мес</span></div>
                <div style={{ fontSize:13, color:'rgba(255,255,255,0.5)', marginBottom:20 }}>Биллинг ежемесячно</div>
                <div style={{ height:1, background:'rgba(255,255,255,0.08)', marginBottom:18 }} />
                {['До 10 проектов','Все блоки и модули','AI-помощник','Продвинутая аналитика','Приоритетная поддержка','Webhooks и интеграции'].map(f => <div key={f} style={{ display:'flex', alignItems:'center', fontSize:13, color:'rgba(255,255,255,0.7)', marginBottom:9 }}><span className="lp-check">✓</span>{f}</div>)}
                <button className="lp-btn-gold" onClick={openRegister} style={{ width:'100%', marginTop:16, padding:'11px', borderRadius:9, fontSize:14 }}>Выбрать Pro</button>
              </div>
              {/* Team */}
              <div className="lp-price-card">
                <div style={{ fontSize:12, fontWeight:700, color:'rgba(255,255,255,0.5)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:12 }}>Команда</div>
                <div style={{ fontFamily:'Syne,system-ui', fontSize:38, fontWeight:800, marginBottom:4 }}>2490₽<span style={{ fontSize:16, fontWeight:500, color:'rgba(255,255,255,0.5)' }}> /мес</span></div>
                <div style={{ fontSize:13, color:'rgba(255,255,255,0.5)', marginBottom:20 }}>До 5 пользователей</div>
                <div style={{ height:1, background:'rgba(255,255,255,0.08)', marginBottom:18 }} />
                {['Неограниченно проектов','Командный доступ','AI-помощник без лимитов','White-label','SLA и dedicated поддержка','API-доступ'].map(f => <div key={f} style={{ display:'flex', alignItems:'center', fontSize:13, color:'rgba(255,255,255,0.7)', marginBottom:9 }}><span className="lp-check">✓</span>{f}</div>)}
                <button className="lp-btn-ghost" style={{ width:'100%', marginTop:16, padding:'11px', borderRadius:9, fontSize:14, cursor:'pointer' }}>Связаться с нами</button>
              </div>
            </div>
          </div>

          {/* ── CTA ── */}
          <div style={{ textAlign:'center', padding: lp ? '48px 16px' : '80px 40px', position:'relative', overflow:'hidden' }}>
            <div style={{ position:'absolute', inset:0, background:'radial-gradient(ellipse at center,rgba(251,191,36,0.07) 0%,transparent 65%)', pointerEvents:'none' }} />
            <h2 style={{ fontFamily:'Syne,system-ui', fontWeight:800, fontSize: lp ? 30 : 44, marginBottom:14, position:'relative' }}>Готов запустить бота?</h2>
            <p style={{ color:'rgba(255,255,255,0.55)', fontSize: lp ? 14 : 16, marginBottom:32, position:'relative' }}>Присоединяйся к тысячам создателей и запусти своего бота за вечер.</p>
            <div style={{ display:'flex', gap:12, justifyContent:'center', flexWrap:'wrap', position:'relative' }}>
              <button className="lp-btn-gold" onClick={openRegister} style={{ borderRadius:10, padding:'14px 28px', fontSize:15 }}>Начать бесплатно →</button>
              <button className="lp-btn-ghost" onClick={openLogin} style={{ padding:'14px 24px', fontSize:15, borderRadius:10 }}>Войти в аккаунт</button>
            </div>
          </div>

          {/* ── FOOTER ── */}
          <div style={{ borderTop:'1px solid rgba(255,255,255,0.07)', padding: lp ? '24px 16px' : '32px 40px' }}>
            <div style={{ maxWidth:1220, margin:'0 auto', display:'flex', flexDirection: lp ? 'column' : 'row', alignItems: lp ? 'flex-start' : 'center', justifyContent:'space-between', gap: lp ? 16 : 0 }}>
              <div>
                <div style={{ fontFamily:'Syne,system-ui', fontSize:18, fontWeight:800, color:'#fff', marginBottom:4 }}>
                  <span style={{ color:'#ffd700' }}>◈</span> Cicada <span style={{ color:'rgba(255,255,255,0.4)', fontWeight:400, fontSize:13 }}>studio</span>
                </div>
                <div style={{ fontSize:12, color:'rgba(255,255,255,0.3)' }}>© 2026 Cicada Studio. Все права защищены.</div>
              </div>
              <div style={{ display:'flex', gap: lp ? 16 : 28, flexWrap:'wrap' }}>
                {['Поддержка','Telegram'].map(l => (
                  <button key={l} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.35)', fontSize:13, cursor:'pointer', transition:'color .2s' }} onMouseEnter={e=>e.currentTarget.style.color='rgba(255,255,255,0.7)'} onMouseLeave={e=>e.currentTarget.style.color='rgba(255,255,255,0.35)'}>{l}</button>
                ))}
              </div>
            </div>
          </div>
          </>

        </div>
        {authModalNode}
      </div>
    );
  }

  return (
    <AddBlockContext.Provider value={(type) => {
        setStacks(prev => {
          const selStack = prev.find(s => s.id === selectedStackId) || prev[prev.length - 1];
          if (!selStack) {
            return [...prev, { id: uid(), x: 40, y: 40 + prev.length * 80, blocks: [{ id: uid(), type, props: { ...(DEFAULT_PROPS[type] || {}) } }] }];
          }
          // Берём последний блок стека как родителя → выводим умные дефолты
          const parentBlock = selStack.blocks[selStack.blocks.length - 1] || null;
          const smartProps = inferPropsFromParent(parentBlock, type, selStack.blocks);
          const finalProps = { ...(DEFAULT_PROPS[type] || {}), ...smartProps };
          return prev.map(s => s.id === selStack.id
            ? { ...s, blocks: [...s.blocks, { id: uid(), type, props: finalProps }] }
            : s
          );
        });
        setBlockInfo(null);
      }}>
    <BlockInfoContext.Provider value={setBlockInfo}>
    <style>{`
      :root {
        --bg: #06030f;
        --bg2: #0d0920;
        --bg3: #1a1230;
        --text: rgba(255,255,255,0.92);
        --text2: rgba(255,255,255,0.62);
        --text3: rgba(255,255,255,0.38);
        --border: rgba(99,102,241,0.18);
        --border2: rgba(99,102,241,0.28);
        --accent: #f97316;
        --accent2: #dc2626;
        --mono: 'JetBrains Mono', ui-monospace, monospace;
      }
      @keyframes editorNeonPulse { 0%,100%{opacity:0.5} 50%{opacity:1} }
      @keyframes editorGridShift { from{background-position:0 0} to{background-position:60px 60px} }
      @keyframes editorOrbFloat { 0%,100%{transform:translateY(0) scale(1)} 50%{transform:translateY(-22px) scale(1.04)} }
      @keyframes editorScanLine { 0%{transform:translateY(-100%)} 100%{transform:translateY(100vh)} }
      @keyframes blockEntrance { from{opacity:0;transform:translateY(-6px) scale(0.96)} to{opacity:1;transform:translateY(0) scale(1)} }
      @keyframes neonBlink { 0%,90%,100%{opacity:1} 95%{opacity:0.6} }
      @keyframes editorRunPulse { 0%,100%{box-shadow:0 0 0 0 rgba(249,115,22,0)} 50%{box-shadow:0 0 0 6px rgba(249,115,22,0.25)} }
      .tb-btn {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 5px 8px; border-radius: 8px; font-size: 11px; font-weight: 500;
        cursor: pointer; transition: all 0.18s ease; white-space: nowrap;
        font-family: Syne, system-ui; letter-spacing: 0.01em; line-height: 1;
      }
      .tb-btn-ghost {
        background: rgba(99,102,241,0.06); color: rgba(255,255,255,0.55);
        border: 1px solid rgba(99,102,241,0.2);
      }
      .tb-btn-ghost:hover { background: rgba(99,102,241,0.14); color: rgba(255,255,255,0.9); border-color: rgba(99,102,241,0.5); }
      .tb-btn-danger { background: rgba(239,68,68,0.08); color: #f87171; border: 1px solid rgba(239,68,68,0.2); }
      .tb-btn-danger:hover { background: rgba(239,68,68,0.18); color: #fca5a5; border-color: rgba(239,68,68,0.5); }
      .tb-btn-green { background: rgba(62,207,142,0.08); color: #3ecf8e; border: 1px solid rgba(62,207,142,0.22); }
      .tb-btn-green:hover { background: rgba(62,207,142,0.18); border-color: #3ecf8e; }
      .tb-btn-blue { background: rgba(96,165,250,0.08); color: #60a5fa; border: 1px solid rgba(96,165,250,0.22); }
      .tb-btn-blue:hover { background: rgba(96,165,250,0.18); border-color: #60a5fa; }
      .tb-btn-purple { background: rgba(167,139,250,0.08); color: #a78bfa; border: 1px solid rgba(167,139,250,0.22); }
      .tb-btn-purple:hover { background: rgba(167,139,250,0.18); border-color: #a78bfa; }
      .tb-btn-run {
        background: linear-gradient(135deg,#f97316,#dc2626); color:#fff;
        border:none; font-weight:700; font-size:13px;
        box-shadow:0 2px 14px rgba(249,115,22,0.4);
        animation: editorRunPulse 2.5s ease-in-out infinite;
      }
      .tb-btn-run:hover { background:linear-gradient(135deg,#fb923c,#ef4444); box-shadow:0 4px 20px rgba(249,115,22,0.6); transform:translateY(-1px); }
      .tb-btn-run:disabled { background:rgba(249,115,22,0.15); color:rgba(249,115,22,0.35); box-shadow:none; cursor:not-allowed; transform:none; animation:none; }
      .tb-btn-stop {
        background:linear-gradient(135deg,#ef4444,#dc2626); color:#fff;
        border:none; font-weight:700;
        box-shadow:0 2px 14px rgba(239,68,68,0.4);
      }
      .tb-btn-stop:hover { background:linear-gradient(135deg,#f87171,#ef4444); box-shadow:0 4px 18px rgba(239,68,68,0.6); transform:translateY(-1px); }
      .tb-divider { width:1px; height:22px; background:rgba(99,102,241,0.22); flex-shrink:0; }
      .tb-btn-ai {
        background:linear-gradient(135deg,rgba(249,115,22,0.18),rgba(220,38,38,0.12));
        color:#f97316; border:1px solid rgba(249,115,22,0.4); font-weight:700;
      }
      .tb-btn-ai:hover {
        background:linear-gradient(135deg,rgba(249,115,22,0.3),rgba(220,38,38,0.2));
        border-color:rgba(249,115,22,0.7); color:#fb923c; box-shadow:0 0 16px rgba(249,115,22,0.25);
      }
      .tb-files-menu {
        position: absolute; top: calc(100% + 6px); left: 0;
        background: var(--bg2); border: 1px solid rgba(255,255,255,0.1);
        border-radius: 10px; min-width: 186px; z-index: 100;
        box-shadow: 0 8px 32px rgba(0,0,0,0.6); overflow: hidden;
      }
      .tb-files-menu-item {
        width: 100%; padding: 10px 14px; text-align: left;
        background: transparent; border: none; border-bottom: 1px solid rgba(255,255,255,0.06);
        cursor: pointer; font-size: 12px; font-family: Syne,system-ui;
        display: flex; align-items: center; gap: 8px; transition: background 0.15s;
        color: var(--text);
      }
      .tb-files-menu-item:last-child { border-bottom: none; }
      .tb-files-menu-item:hover { background: rgba(255,255,255,0.06); }
      .editor-sidebar-block:hover { background:rgba(99,102,241,0.12) !important; }
      .editor-group-header { 
        padding:8px 12px 3px; font-size:9px; letter-spacing:.14em; text-transform:uppercase; font-weight:700;
        border-top:1px solid rgba(99,102,241,0.15); color:rgba(99,102,241,0.6);
        display:flex; align-items:center; gap:6px;
      }
      .editor-group-header::after { content:''; flex:1; height:1px; background:linear-gradient(90deg,rgba(99,102,241,0.3),transparent); }
      .editor-zoom-btn {
        width:34px; height:34px; border-radius:9px;
        background:rgba(10,8,28,0.9); border:1px solid rgba(99,102,241,0.25);
        color:rgba(255,255,255,0.6); font-size:18px; font-weight:300;
        cursor:pointer; display:flex; align-items:center; justify-content:center;
        box-shadow:0 4px 14px rgba(0,0,0,0.6); line-height:1;
        transition:all 0.18s; backdrop-filter:blur(8px);
      }
      .editor-zoom-btn:hover { background:rgba(249,115,22,0.12); border-color:rgba(249,115,22,0.6); color:#f97316; box-shadow:0 0 14px rgba(249,115,22,0.25); }
      .editor-zoom-pct {
        width:42px; height:22px; border-radius:6px;
        background:rgba(10,8,28,0.9); border:1px solid rgba(99,102,241,0.2);
        color:rgba(255,255,255,0.4); font-size:9px;
        cursor:pointer; display:flex; align-items:center; justify-content:center;
        box-shadow:0 2px 8px rgba(0,0,0,0.5); font-family:var(--mono); letter-spacing:.03em;
        transition:all 0.18s;
      }
      .editor-zoom-pct:hover { color:#06b6d4; border-color:rgba(6,182,212,0.4); }
      .editor-mobile-tab { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; background:transparent; border:none; cursor:pointer; border-top:2px solid transparent; min-width:0; transition:all 0.18s; }
      .editor-mobile-tab.active { border-top-color:#f97316; }
      .editor-mobile-tab .tab-icon { font-size:16px; }
      .editor-mobile-tab .tab-label { font-size:9px; font-family:Syne,system-ui; font-weight:600; white-space:nowrap; color:var(--text3); }
      .editor-mobile-tab.active .tab-label { color:#f97316; text-shadow:0 0 8px rgba(249,115,22,0.5); }
      * { scrollbar-width:thin; scrollbar-color:rgba(99,102,241,0.3) transparent; }
      *::-webkit-scrollbar { width:4px; height:4px; }
      *::-webkit-scrollbar-track { background:transparent; }
      *::-webkit-scrollbar-thumb { background:rgba(99,102,241,0.35); border-radius:4px; }
      *::-webkit-scrollbar-thumb:hover { background:rgba(249,115,22,0.5); }
    `}</style>
    <div
      style={{ display:'flex', flexDirection:'column', height:'100vh', background:'var(--bg)' }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onTouchEnd={handleMouseUp}
    >
      {/* Top bar */}
      <div style={{
        background: 'linear-gradient(90deg, #0d0920 0%, #080618 100%)',
        borderBottom: '1px solid rgba(99,102,241,0.25)',
        boxShadow: '0 1px 0 rgba(249,115,22,0.08), 0 4px 24px rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', padding: isMobileView ? '0 12px' : '0 16px', gap: isMobileView ? 8 : 8,
        flexShrink: 0, height: isMobileView ? 52 : 60,
        overflowX: isMobileView ? 'auto' : 'visible',
        position: 'relative', zIndex: 10,
      }}>
        {/* Left neon accent line */}
        <div style={{ position:'absolute', left:0, top:0, bottom:0, width:3, background:'linear-gradient(180deg, #f97316, #6366f1)', borderRadius:'0 2px 2px 0', opacity:0.9 }} />
        <div style={{ fontFamily:'Syne, system-ui', fontWeight:800, fontSize:22, color:'var(--text)', flexShrink: 0, paddingLeft: 6 }}>
          <span style={{ color:'#f97316', textShadow: '0 0 12px rgba(249,115,22,0.7)', animation:'neonBlink 4s ease-in-out infinite' }}>◈</span>
          <span style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #a78bfa 60%, #f97316 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', marginLeft: 6 }}>Cicada</span>
          {!isMobileView && <span style={{ fontSize:13, background:'linear-gradient(135deg,#6366f1,#a78bfa)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text', marginLeft:7, fontWeight:500, opacity:0.8 }}>Studio</span>}
        </div>
        {/* Mobile Examples Button */}
        {isMobileView && (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              onClick={() => setShowExamples(!showExamples)}
              style={{ background:'transparent', color:'var(--text3)', padding:'6px 10px', border:'1px solid var(--border2)', borderRadius:6, fontSize:12, whiteSpace: 'nowrap' }}
            >Примеры ▼</button>
            {showExamples && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 299 }} onClick={() => setShowExamples(false)} />
                <div style={{
                  position: 'fixed', top: 58, left: 12,
                  background: 'var(--bg2)', border: '1px solid var(--border)',
                  borderRadius: 10, minWidth: 200, zIndex: 300,
                  boxShadow: '0 8px 32px rgba(0,0,0,0.8)', overflow: 'hidden',
                }}>
                  {[['echo','🔄 Эхо Бот'],['shop','🛍️ Магазин Бот'],['full','⚡ Все Функции'],['fullTest','🧪 Full Test']].map(([key,label],i,arr) => (
                    <button key={key}
                      onClick={() => { loadExampleFromFile(key); setShowExamples(false); }}
                      style={{ width:'100%', padding:'14px 18px', textAlign:'left', background:'transparent', color:'var(--text)', border:'none', borderBottom: i < arr.length-1 ? '1px solid var(--border)' : 'none', cursor:'pointer', fontSize:14, display: 'block' }}
                    >{label}</button>
                  ))}
                  <button
                    onClick={() => { setShowLibrary(true); setShowExamples(false); }}
                    style={{ width:'100%', padding:'14px 18px', textAlign:'left', background:'transparent', color:'#ffd700', border:'none', borderTop:'1px solid var(--border)', cursor:'pointer', fontSize:14, display:'block', fontWeight:700 }}
                  >📚 Библиотека модулей</button>
                </div>
              </>
            )}
          </div>
        )}
        {!isMobileView && <div className="tb-divider" />}
        {/* Desktop-only buttons */}
        {!isMobileView && (
          <>
            <div style={{ position: 'relative' }}>
              <button
                className="tb-btn tb-btn-ghost"
                data-tour="top-examples-desktop"
                onClick={() => setShowExamples(!showExamples)}
              >⚡ <span style={{ opacity: 0.5, fontSize: 10 }}>▼</span></button>
              {showExamples && (
                <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setShowExamples(false)} />
                <div style={{
                  position: 'absolute', top: 'calc(100% + 6px)', left: 0,
                  background: 'var(--bg2)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 10, minWidth: 190, zIndex: 100,
                  boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                  overflow: 'hidden',
                }}>
                  {[['echo','🔄 Эхо Бот'],['shop','🛍️ Магазин Бот'],['full','⚡ Все Функции'],['fullTest','🧪 Full Test']].map(([key,label],i,arr) => (
                    <button key={key}
                      onClick={() => { loadExampleFromFile(key); setShowExamples(false); }}
                      style={{ width:'100%', padding:'11px 16px', textAlign:'left', background:'transparent', color:'var(--text)', border:'none', borderBottom: i < arr.length-1 ? '1px solid rgba(255,255,255,0.07)' : 'none', cursor:'pointer', fontSize:13, transition:'background 0.15s', fontFamily:'Syne,system-ui' }}
                      onMouseEnter={e => e.target.style.background = 'rgba(255,255,255,0.06)'}
                      onMouseLeave={e => e.target.style.background = 'transparent'}
                    >{label}</button>
                  ))}
                </div>
                </>
              )}
            </div>
            <ModuleLibraryButton currentUser={currentUser} onInsert={(code) => {
              const parsed = parseDSL(code);
              if (parsed) {
                setStacks(prev => [...prev, ...parsed]);
                showToast('✅ Модуль добавлен в проект', 'success');
              }
            }} />
            <button
              className="tb-btn tb-btn-ai"
              title={canUseAiGenerator ? 'Создать бота с помощью AI' : 'Только для PRO с активной подпиской'}
              onClick={openAiGeneratorModal}
              style={!canUseAiGenerator ? { opacity: 0.45 } : undefined}
            >✨ AI</button>
            {isAdmin && (
              <button
                type="button"
                className="tb-btn tb-btn-ghost"
                title="Админ: конвертировать код Python-бота в Cicada (.ccd)"
                onClick={() => {
                  setPythonConvertError('');
                  setPythonConvertMeta(null);
                  setPythonConvertResult('');
                  setShowPythonConvertModal(true);
                }}
                style={{
                  borderColor: 'rgba(167,139,250,0.4)',
                  color: '#e9d5ff',
                  fontWeight: 600,
                  fontSize: 12,
                }}
              >🐍</button>
            )}
            <button
              className="tb-btn tb-btn-danger"
              title="Очистить холст"
              onClick={() => { setStacks([]); setSelectedBlockId(null); setSelectedStackId(null); }}
            >✕</button>
            <div className="tb-divider" />
            <div style={{ position: 'relative' }}>
            <button
              className="tb-btn tb-btn-ghost"
              title="Сохранить / загрузить"
              onClick={() => setShowFilesMenu(v => !v)}
            >📁 <span style={{ opacity: 0.5, fontSize: 10 }}>▼</span></button>
              {showFilesMenu && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setShowFilesMenu(false)} />
                  <div className="tb-files-menu">
                    <button className="tb-files-menu-item" onClick={() => { saveProject(); setShowFilesMenu(false); }}>
                      <span style={{ color: '#3ecf8e' }}>💾</span> Сохранить файл
                    </button>
                    {currentUser && (
                      <button
                        className="tb-files-menu-item"
                        data-tour="save-cloud-desktop"
                        onClick={async () => {
                          const name = projectName.trim() || 'Без названия';
                          await saveProjectToCloud(currentUser.id, name, stacks);
                          await loadUserProjects(currentUser.id);
                          showToast('☁ Проект сохранён в облако: ' + name, 'success');
                          setShowFilesMenu(false);
                        }}
                      >
                        <span style={{ color: '#3ecf8e' }}>☁</span> Сохранить в облако
                      </button>
                    )}
                    <button className="tb-files-menu-item" onClick={() => { loadProject(); setShowFilesMenu(false); }}>
                      <span style={{ color: '#60a5fa' }}>📂</span> Загрузить файл
                    </button>
                    {canSeeCode && (
                    <button className="tb-files-menu-item" onClick={() => { loadCCD(); setShowFilesMenu(false); }}>
                      <span style={{ color: '#a78bfa' }}>↑</span> Открыть .ccd
                    </button>
                    )}
                  </div>
                </>
              )}
            </div>
            <button
              className="tb-btn tb-btn-ghost"
              data-tour="bot-preview"
              title="Превью — чат-симулятор без деплоя"
              type="button"
              onClick={() => { setPreviewPanelOpen(v => !v); setPreviewErr(null); }}
              style={previewPanelOpen ? { outline: '1px solid rgba(56,189,248,0.55)', borderRadius: 8 } : undefined}
            >💬</button>
            <button
              className="tb-btn tb-btn-ghost"
              title="Отладка — логи cicada --dev"
              type="button"
              onClick={() => setBotDebugOpen(v => !v)}
              style={botDebugOpen ? { outline: '1px solid rgba(250,204,21,0.45)', borderRadius: 8 } : undefined}
            >🐛</button>
            <div className="tb-divider" />
            {!isBotRunning ? (
              <button
                className="tb-btn tb-btn-run"
                data-tour="run-desktop"
                onClick={startBot}
                disabled={!stacks.some(s => s.blocks.some(b => b.type === 'bot' && b.props?.token && b.props.token.trim() !== ''))}
                title={!stacks.some(s => s.blocks.some(b => b.type === 'bot' && b.props?.token && b.props.token.trim() !== '')) ? 'Добавь блок «Бот» с токеном' : ''}
              >▶ Старт</button>
            ) : (
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, background:'rgba(62,207,142,0.08)', border:'1px solid rgba(62,207,142,0.2)', borderRadius:8, padding:'5px 10px' }}>
                  <div style={{
                    width:7, height:7, borderRadius:'50%', background:'#3ecf8e',
                    boxShadow:'0 0 7px #3ecf8e',
                    animation:'botPulse 1.5s ease-in-out infinite',
                    flexShrink:0,
                  }} />
                  <span style={{ fontSize:11, color:'#3ecf8e', fontFamily:'var(--mono)', letterSpacing:'0.02em' }}>
                    {autoStopSecondsLeft !== null
                      ? `авто-стоп ${Math.floor(autoStopSecondsLeft/60)}:${String(autoStopSecondsLeft%60).padStart(2,'0')}`
                      : 'работает'}
                  </span>
                </div>
                <button
                  className="tb-btn tb-btn-stop"
                  data-tour="run-desktop"
                  onClick={stopBot}
                >■ Стоп</button>
              </div>
            )}
          </>
        )}

        {currentUser ? (
          <>
            <div style={{ flex:1 }} />
            {isMobileView ? (
              <button
                type="button"
                onClick={openAiGeneratorModal}
                title={canUseAiGenerator ? 'Опиши бота — ИИ соберёт схему блоков' : 'Только для PRO с активной подпиской'}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '6px 10px',
                  background: 'linear-gradient(135deg, rgba(251,191,36,0.18) 0%, rgba(251,146,60,0.12) 100%)',
                  border: '1px solid rgba(251,191,36,0.45)',
                  borderRadius: 8,
                  cursor: canUseAiGenerator ? 'pointer' : 'not-allowed',
                  transition: 'all 0.18s ease',
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#fde68a',
                  fontFamily: 'Syne, system-ui',
                  letterSpacing: '0.02em',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  boxShadow: '0 0 12px rgba(251,191,36,0.12)',
                  opacity: canUseAiGenerator ? 1 : 0.45,
                }}
              >AI</button>
            ) : (
              <button
                onClick={() => setShowProfileModal(true)}
                title="Premium"
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 14px',
                  background: 'linear-gradient(135deg, rgba(249,115,22,0.12), rgba(220,38,38,0.08))',
                  border: '1px solid rgba(249,115,22,0.35)',
                  borderRadius: 20, cursor: 'pointer',
                  transition: 'all 0.18s ease',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'linear-gradient(135deg, rgba(249,115,22,0.22), rgba(220,38,38,0.14))'; e.currentTarget.style.borderColor = '#f97316'; e.currentTarget.style.boxShadow = '0 0 16px rgba(249,115,22,0.3)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'linear-gradient(135deg, rgba(249,115,22,0.12), rgba(220,38,38,0.08))'; e.currentTarget.style.borderColor = 'rgba(249,115,22,0.35)'; e.currentTarget.style.boxShadow = 'none'; }}
              >
                <span style={{ fontSize: 11 }}>★</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#f97316', fontFamily: 'Syne, system-ui', letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
                  Premium
                </span>
              </button>
            )}
            {/* User button */}
            <button
              data-tour="profile-button"
              onClick={() => setShowProfileModal(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'var(--bg3)', padding: isMobileView ? '5px 10px' : '6px 14px', borderRadius: 20,
                border: '1px solid var(--border2)', cursor: 'pointer',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = '#f97316'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border2)'}
            >
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: 'linear-gradient(135deg, #f97316, #6366f1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700, color: '#1a1a1a', flexShrink: 0,
                overflow: 'hidden',
              }}>
                {currentUser.photo_url
                  ? <img src={currentUser.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : currentUser.name[0].toUpperCase()
                }
              </div>
              {!isMobileView && <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{currentUser.name}</span>}
            </button>
          </>
        ) : (
          <>
            <div style={{ flex:1 }} />
            <button
              onClick={() => { setAuthTab('login'); setShowAuthModal(true); }}
              style={{
                background: 'linear-gradient(135deg, #f97316, #dc2626)',
                color: '#fff', padding: isMobileView ? '7px 14px' : '8px 20px', borderRadius: 8,
                fontSize: isMobileView ? 12 : 13,
                fontWeight: 700, border: 'none', cursor: 'pointer',
                boxShadow: '0 4px 18px rgba(249,115,22,0.4)', whiteSpace: 'nowrap',
              }}
            >{isMobileView ? 'Войти' : 'Войти'}</button>
          </>
        )}
        {!isMobileView && (
          <button
            className="tb-btn tb-btn-ghost"
            onClick={() => setShowInstructions(true)}
            style={{ marginLeft: 6 }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#fbbf24'; e.currentTarget.style.color = '#fbbf24'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = ''; e.currentTarget.style.color = ''; }}
          >📖</button>
        )}
        {isMobileView && (
          <div style={{ position: 'relative', flexShrink: 0, marginLeft: 4 }}>
            <button
              onClick={() => setMobileMoreOpen(v => !v)}
              style={{
                background: mobileMoreOpen ? 'rgba(255,255,255,0.1)' : 'transparent',
                color: 'var(--text3)', padding: '7px 11px',
                border: '1px solid var(--border2)', borderRadius: 8, fontSize: 16,
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >⋯</button>
            {mobileMoreOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 399 }} onClick={() => setMobileMoreOpen(false)} />
                <div style={{
                  position: 'fixed', top: 58, right: 8,
                  background: 'var(--bg2)', border: '1px solid var(--border)',
                  borderRadius: 14, zIndex: 400, minWidth: 220,
                  boxShadow: '0 12px 40px rgba(0,0,0,0.8)',
                  overflow: 'hidden', padding: '6px 0',
                }}>
                  {/* Очистить */}
                  <button
                    onClick={() => { setStacks([]); setSelectedBlockId(null); setSelectedStackId(null); setMobileMoreOpen(false); }}
                    style={{ width:'100%', padding:'10px 16px', textAlign:'left', background:'transparent', color:'#f87171', border:'none', cursor:'pointer', fontSize:13, fontFamily:'Syne,system-ui', display:'flex', alignItems:'center', gap:8 }}
                  >✕ Очистить холст</button>
                  {/* Сохранить */}
                  <button
                    onClick={() => { saveProject(); setMobileMoreOpen(false); }}
                    style={{ width:'100%', padding:'10px 16px', textAlign:'left', background:'transparent', color:'#3ecf8e', border:'none', cursor:'pointer', fontSize:13, fontFamily:'Syne,system-ui', display:'flex', alignItems:'center', gap:8 }}
                  >💾 Сохранить файл</button>
                  {/* Облако */}
                  {currentUser && (
                    <button
                      onClick={async () => {
                        const name = projectName.trim() || 'Без названия';
                        await saveProjectToCloud(currentUser.id, name, stacks);
                        await loadUserProjects(currentUser.id);
                        showToast('☁ Проект сохранён в облако: ' + name, 'success');
                        setMobileMoreOpen(false);
                      }}
                      style={{ width:'100%', padding:'10px 16px', textAlign:'left', background:'transparent', color:'#3ecf8e', border:'none', cursor:'pointer', fontSize:13, fontFamily:'Syne,system-ui', display:'flex', alignItems:'center', gap:8 }}
                    >☁ Сохранить в облако</button>
                  )}
                  {canSeeCode && (
                  <button
                    onClick={() => { loadCCD(); setMobileMoreOpen(false); }}
                    style={{ width:'100%', padding:'10px 16px', textAlign:'left', background:'transparent', color:'#a78bfa', border:'none', cursor:'pointer', fontSize:13, fontFamily:'Syne,system-ui', display:'flex', alignItems:'center', gap:8 }}
                  >📁 Загрузить .ccd</button>
                  )}
                  <div style={{ height:1, background:'var(--border)', margin:'4px 0' }} />
                  <button
                    onClick={() => { setBotDebugOpen(v => !v); setMobileMoreOpen(false); }}
                    style={{ width:'100%', padding:'10px 16px', textAlign:'left', background:'transparent', color:'#fde047', border:'none', cursor:'pointer', fontSize:13, fontFamily:'Syne,system-ui', display:'flex', alignItems:'center', gap:8 }}
                  >🐛 Отладка (логи)</button>
                  {/* Старт/Стоп */}
                  {isBotRunning ? (
                    <button
                      onClick={() => { stopBot(); setMobileMoreOpen(false); }}
                      style={{ width:'100%', padding:'10px 16px', textAlign:'left', background:'rgba(239,68,68,0.08)', color:'#f87171', border:'none', cursor:'pointer', fontSize:13, fontFamily:'Syne,system-ui', fontWeight:700, display:'flex', alignItems:'center', gap:8 }}
                    >■ Остановить бота</button>
                  ) : (
                    <button
                      onClick={() => { startBot(); setMobileMoreOpen(false); }}
                      disabled={!stacks.some(s => s.blocks.some(b => b.type === 'bot' && b.props?.token?.trim()))}
                      style={{ width:'100%', padding:'10px 16px', textAlign:'left', background:'rgba(62,207,142,0.08)', color:'#3ecf8e', border:'none', cursor:'pointer', fontSize:13, fontFamily:'Syne,system-ui', fontWeight:700, display:'flex', alignItems:'center', gap:8, opacity: stacks.some(s => s.blocks.some(b => b.type === 'bot' && b.props?.token?.trim())) ? 1 : 0.4 }}
                    >▶ Запустить бота</button>
                  )}
                  <div style={{ height:1, background:'var(--border)', margin:'4px 0' }} />
                  {isAdmin && (
                    <button
                      type="button"
                      title="Админ: конвертировать код Python-бота в Cicada (.ccd)"
                      onClick={() => {
                        setPythonConvertError('');
                        setPythonConvertMeta(null);
                        setPythonConvertResult('');
                        setShowPythonConvertModal(true);
                        setMobileMoreOpen(false);
                      }}
                      style={{ width:'100%', padding:'10px 16px', textAlign:'left', background:'transparent', color:'#e9d5ff', border:'none', cursor:'pointer', fontSize:13, fontFamily:'Syne,system-ui', fontWeight:600, display:'flex', alignItems:'center', gap:8 }}
                    >🐍</button>
                  )}
                  {/* Инструкция */}
                  <button
                    onClick={() => { setShowInstructions(true); setMobileMoreOpen(false); }}
                    style={{ width:'100%', padding:'10px 16px', textAlign:'left', background:'transparent', color:'var(--text2)', border:'none', cursor:'pointer', fontSize:13, fontFamily:'Syne,system-ui', display:'flex', alignItems:'center', gap:8 }}
                  >📖 Инструкция</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Instructions Modal */}

      {showLibrary && (
        <ModuleLibraryModal
          currentUser={currentUser}
          onClose={() => setShowLibrary(false)}
          onInsert={(code) => {
            const parsed = parseDSL(code);
            if (parsed) {
              setStacks(prev => [...prev, ...parsed]);
              showToast('✅ Модуль добавлен в проект', 'success');
            }
            setShowLibrary(false);
          }}
        />
      )}
      {showAIModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(4px)',
        }} onClick={() => !aiLoading && setShowAIModal(false)}>
          <div style={{
            width: '90%', maxWidth: 520,
            background: 'var(--bg2)', borderRadius: 16,
            border: '1px solid rgba(251,191,36,0.25)',
            boxShadow: '0 0 60px rgba(251,191,36,0.08), 0 24px 60px rgba(0,0,0,0.7)',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
          }} onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div style={{
              padding: '18px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'linear-gradient(135deg, rgba(251,191,36,0.06) 0%, transparent 100%)',
            }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#fbbf24', fontFamily: 'Syne, system-ui', display: 'flex', alignItems: 'center', gap: 8 }}>
                  ✨ Создать бота с AI
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>
                  Опиши бота — AI сгенерирует схему блоков. Короткого запроса обычно мало: нужны состояния, кнопки и переходы.
                </div>
              </div>
              <button
                onClick={() => setShowAIModal(false)}
                disabled={aiLoading}
                style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', color: 'var(--text)', fontSize: 18, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: aiLoading ? 0.4 : 1 }}
              >×</button>
            </div>

            {/* Body */}
            <div style={{ padding: '20px' }}>
              {/* Примеры подсказки */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12, alignItems: 'center' }}>
                {[
                  { label: 'Бот приветствует и показывает меню', text: 'Бот приветствует и показывает меню' },
                  { label: 'Заказ: имя и телефон', text: 'Бот принимает заказы, спрашивает имя и телефон' },
                  { label: 'Бот калькулятор', text: 'Бот калькулятор' },
                  { label: 'Бот с оплатой подписки', text: 'Бот с оплатой подписки' },
                ].map((ex) => (
                  <button
                    key={ex.label}
                    type="button"
                    title={ex.text.length > 80 ? 'Вставить подробное техническое описание сценария' : undefined}
                    onClick={() => setAiPrompt(ex.text)}
                    disabled={aiLoading}
                    style={{
                      padding: '5px 10px', borderRadius: 20, fontSize: 11,
                      background: 'rgba(251,191,36,0.07)', color: '#fbbf24',
                      border: '1px solid rgba(251,191,36,0.2)', cursor: 'pointer',
                      fontFamily: 'system-ui', transition: 'all 0.15s',
                      opacity: aiLoading ? 0.5 : 1,
                      maxWidth: '100%',
                    }}
                  >{ex.label}</button>
                ))}
              </div>

              {/* Textarea */}
              <textarea
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
                disabled={aiLoading}
                placeholder="Укажи триггеры (/start, кнопки), тексты сообщений, варианты кнопок, что происходит при каждом нажатии, переменные, финальный экран. Либо нажми «Бот калькулятор» или другой пример ниже."
                rows={10}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 10, padding: '12px 14px',
                  color: 'var(--text)', fontSize: 13, lineHeight: 1.6,
                  fontFamily: 'system-ui', resize: 'vertical',
                  outline: 'none', transition: 'border 0.2s',
                }}
                onFocus={e => e.target.style.borderColor = 'rgba(251,191,36,0.5)'}
                onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.12)'}
              />

              {/* Error */}
              {aiError && (
                <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 8, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)', color: '#f87171', fontSize: 12 }}>
                  {aiError}
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '0 20px 20px', display: 'flex', gap: 10 }}>
              <button
                onClick={() => setShowAIModal(false)}
                disabled={aiLoading}
                style={{
                  flex: 1, padding: '11px', borderRadius: 10, fontSize: 13,
                  background: 'rgba(255,255,255,0.05)', color: 'var(--text3)',
                  border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', fontFamily: 'Syne, system-ui',
                }}
              >Отмена</button>
              <button
                disabled={aiLoading || aiPrompt.trim().length < 5}
                onClick={async () => {
                  setAiLoading(true);
                  setAiError('');
                  try {
                    const token = await getCsrfTokenForRequest();
                    const jwt = getStoredJwt();
                    const res = await fetch(`${API_URL}/ai-generate`, {
                      method: 'POST',
                      credentials: 'include',
                      headers: {
                        'Content-Type': 'application/json',
                        'x-csrf-token': token,
                        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
                      },
                      body: JSON.stringify({ prompt: aiPrompt.trim() }),
                    });
                    if (!res.ok) {
                      const text = await res.text();
                      let msg = `Ошибка сервера ${res.status}`;
                      try { const j = JSON.parse(text); msg = j.error || msg; } catch { /* не JSON */ }
                      throw new Error(msg);
                    }
                    const data = await res.json();
                    if (data.error) throw new Error(data.error);
                    if (!Array.isArray(data.stacks) || data.stacks.length === 0) throw new Error('AI вернул пустую схему');
                    // Расставляем блоки на холсте (смещаем вправо если что-то уже есть)
                    const offsetX = stacks.length > 0 ? Math.max(...stacks.map(s => s.x + 300)) : 40;
                    const resolvedTok = resolveBotTokenForNewBlock(stacks, currentUser);
                    const newStacks = data.stacks.map((s, i) => ({
                      ...s,
                      id: 'ai_' + Date.now() + '_' + i,
                      x: (s.x || 40) + offsetX,
                      y: s.y || 40,
                      blocks: (s.blocks || []).map((b, bi) => ({
                        ...b,
                        id: 'ai_b_' + Date.now() + '_' + i + '_' + bi,
                        props: b.type === 'bot' && resolvedTok
                          ? { ...b.props, token: resolvedTok }
                          : b.props,
                      })),
                    }));
                    setStacks(prev => [...prev, ...newStacks]);
                    setShowAIModal(false);
                    showToast('✨ AI сгенерировал схему бота!', 'success');
                  } catch(e) {
                    setAiError(e.message || 'Что-то пошло не так');
                  } finally {
                    setAiLoading(false);
                  }
                }}
                style={{
                  flex: 2, padding: '11px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                  background: aiLoading || aiPrompt.trim().length < 5
                    ? 'rgba(251,191,36,0.15)'
                    : 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
                  color: aiLoading || aiPrompt.trim().length < 5 ? 'rgba(251,191,36,0.4)' : '#000',
                  border: 'none', cursor: aiLoading || aiPrompt.trim().length < 5 ? 'not-allowed' : 'pointer',
                  fontFamily: 'Syne, system-ui', transition: 'all 0.2s',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {aiLoading ? (
                  <>
                    <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(251,191,36,0.3)', borderTopColor: '#fbbf24', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                    Генерирую...
                  </>
                ) : '✨ Сгенерировать'}
              </button>
            </div>
          </div>
        </div>
      )}
      {showPythonConvertModal && isAdmin && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(4px)',
        }} onClick={() => !pythonConvertLoading && setShowPythonConvertModal(false)}>
          <div style={{
            width: '92%', maxWidth: 720, maxHeight: '90vh',
            background: 'var(--bg2)', borderRadius: 16,
            border: '1px solid rgba(167,139,250,0.3)',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{
              padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'linear-gradient(135deg, rgba(167,139,250,0.08) 0%, transparent 100%)',
            }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#e9d5ff', fontFamily: 'Syne, system-ui' }}>
                  🐍 Python → Cicada
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>
                  Только для администратора: ИИ переводит python-telegram-bot / aiogram в русский DSL .ccd
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPythonConvertModal(false)}
                disabled={pythonConvertLoading}
                style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', color: 'var(--text)', fontSize: 18, border: 'none', cursor: 'pointer' }}
              >×</button>
            </div>
            <div style={{ padding: '14px 20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Исходник Python 3</div>
              <textarea
                value={pythonConvertSource}
                onChange={(e) => setPythonConvertSource(e.target.value)}
                disabled={pythonConvertLoading}
                placeholder="Вставьте сюда код бота (python-telegram-bot, aiogram, …)"
                rows={10}
                spellCheck={false}
                style={{
                  width: '100%', boxSizing: 'border-box', minHeight: 160,
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 10, padding: '12px 14px', color: 'var(--text)', fontSize: 12,
                  fontFamily: 'var(--mono, ui-monospace, monospace)', lineHeight: 1.45, resize: 'vertical',
                }}
              />
              {pythonConvertError && (
                <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)', color: '#f87171', fontSize: 12 }}>
                  {pythonConvertError}
                </div>
              )}
              {pythonConvertResult ? (
                <>
                  <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Результат .ccd</div>
                  <textarea
                    value={pythonConvertResult}
                    onChange={(e) => setPythonConvertResult(e.target.value)}
                    rows={12}
                    spellCheck={false}
                    style={{
                      width: '100%', boxSizing: 'border-box', minHeight: 200,
                      background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.22)',
                      borderRadius: 10, padding: '12px 14px', color: 'var(--text)', fontSize: 12,
                      fontFamily: 'var(--mono, ui-monospace, monospace)', lineHeight: 1.45, resize: 'vertical',
                    }}
                  />
                  {pythonConvertMeta?.schemaErrors?.length > 0 && (
                    <div style={{ fontSize: 11, color: '#fbbf24', lineHeight: 1.45 }}>
                      <strong>Схема:</strong>
                      <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
                        {pythonConvertMeta.schemaErrors.slice(0, 8).map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {pythonConvertMeta?.pythonLint && (pythonConvertMeta.pythonLint.error || !pythonConvertMeta.pythonLint.ok) && (
                    <div style={{ fontSize: 11, color: '#f87171', lineHeight: 1.45 }}>
                      <strong>Парсер Cicada:</strong> {pythonConvertMeta.pythonLint.error || 'есть замечания'}
                      {(pythonConvertMeta.pythonLint.diagnostics || []).slice(0, 5).map((d, i) => (
                        <div key={i} style={{ marginTop: 4, opacity: 0.95 }}>
                          {d.line != null ? `Стр. ${d.line}: ` : ''}{d.message || d}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : null}
            </div>
            <div style={{ padding: '0 20px 18px', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setShowPythonConvertModal(false)}
                disabled={pythonConvertLoading}
                style={{
                  flex: 1, minWidth: 100, padding: '11px', borderRadius: 10, fontSize: 13,
                  background: 'rgba(255,255,255,0.05)', color: 'var(--text3)',
                  border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', fontFamily: 'Syne, system-ui',
                }}
              >Закрыть</button>
              <button
                type="button"
                disabled={pythonConvertLoading || pythonConvertSource.trim().length < 20}
                onClick={runPythonConvert}
                style={{
                  flex: 2, minWidth: 140, padding: '11px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                  background:
                    pythonConvertLoading || pythonConvertSource.trim().length < 20
                      ? 'rgba(167,139,250,0.15)'
                      : 'linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)',
                  color: pythonConvertLoading || pythonConvertSource.trim().length < 20 ? 'rgba(255,255,255,0.35)' : '#fff',
                  border: 'none', cursor: pythonConvertLoading || pythonConvertSource.trim().length < 20 ? 'not-allowed' : 'pointer',
                  fontFamily: 'Syne, system-ui',
                }}
              >
                {pythonConvertLoading ? 'Конвертация…' : 'Конвертировать'}
              </button>
              <button
                type="button"
                disabled={!pythonConvertResult.trim()}
                onClick={applyPythonConvertToCanvas}
                style={{
                  flex: 2, minWidth: 160, padding: '11px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                  background: !pythonConvertResult.trim() ? 'rgba(16,185,129,0.12)' : 'linear-gradient(135deg, #34d399 0%, #059669 100%)',
                  color: !pythonConvertResult.trim() ? 'rgba(16,185,129,0.35)' : '#fff',
                  border: 'none', cursor: !pythonConvertResult.trim() ? 'not-allowed' : 'pointer',
                  fontFamily: 'Syne, system-ui',
                }}
              >На холст</button>
            </div>
          </div>
        </div>
      )}
      {showInstructions && (
          <InstructionsModal onClose={() => setShowInstructions(false)} />
        )}

      {/* Справка по блоку — кнопка «i» на пазле */}
      {blockInfo && (
        <BlockInfoModal block={blockInfo} onClose={() => setBlockInfo(null)} />
      )}

      {currentUser ? (
        /* Main layout */
        <>
        <div style={{ display:'grid', gridTemplateColumns: isMobileView ? '1fr' : '180px 1fr minmax(300px, 360px)', overflow:'hidden', flex: 1, position: 'relative' }}>

        {/* Sidebar — hidden on mobile unless blocks tab */}
        {(isMobileView && mobileTab !== 'blocks') ? null : (
        <div style={{
          background:'linear-gradient(180deg, #0d0920 0%, #080618 100%)',
          borderRight: isMobileView ? 'none' : '1px solid rgba(99,102,241,0.2)',
          display:'flex', flexDirection:'column', overflow:'hidden',
          boxShadow: isMobileView ? 'none' : '4px 0 24px rgba(0,0,0,0.4)',
          ...(isMobileView ? { gridColumn: '1', position: 'absolute', top: 0, left: 0, right: 0, bottom: 56, zIndex: 10 } : {}),
        }}
        data-tour={!isMobileView ? 'sidebar-desktop' : undefined}>
          <div style={{
            padding:'10px 12px 5px', fontSize:9,
            background:'linear-gradient(90deg,rgba(99,102,241,0.12),transparent)',
            borderBottom:'1px solid rgba(99,102,241,0.15)',
            color:'rgba(99,102,241,0.7)', textTransform:'uppercase', letterSpacing:'.14em', fontWeight:700,
            display:'flex', alignItems:'center', gap:6,
          }}>
            <span style={{ color:'#f97316', fontSize:12 }}>◈</span> Блоки
          </div>
          <Sidebar
            onDragStart={setDraggingNewType}
            onDragEnd={endPaletteDrag}
            onTapAdd={isMobileView ? (type) => {
            const id = uid();
            const x = 40 + Math.random() * 60;
            const y = 40 + stacks.length * 80;
            setStacks(prev => {
              const props = { ...(DEFAULT_PROPS[type] || {}) };
              if (type === 'bot') {
                const tok = resolveBotTokenForNewBlock(prev, currentUser);
                if (tok) props.token = tok;
              }
              return [...prev, {
                id: uid(), x, y,
                blocks: [{ id, type, props }],
              }];
            });
            setMobileTab('canvas');
          } : null} />
        </div>
        )}

        {/* Canvas — hidden on mobile unless canvas tab */}
        {(isMobileView && mobileTab !== 'canvas') ? null : (
        <div
          ref={canvasRef}
          data-tour="canvas-area"
          className="canvas-bg"
          style={{
            position:'relative', overflow:'hidden',
            cursor: canvasDrag ? 'grabbing' : 'default',
            background: 'linear-gradient(160deg, #06030f 0%, #0a0518 50%, #080615 100%)',
            ...(isMobileView ? { gridColumn: '1', display: mobileTab === 'canvas' ? 'block' : 'none' } : {}),
          }}
          onMouseDown={handleCanvasMouseDown}
          onTouchStart={e => {
            if (e.touches.length === 1) {
              const touch = e.touches[0];
              handleCanvasMouseDown({ ...touch, target: e.target, clientX: touch.clientX, clientY: touch.clientY });
            } else if (e.touches.length === 2) {
              e.preventDefault();
              const t1 = e.touches[0], t2 = e.touches[1];
              const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
              const rect = canvasRef.current?.getBoundingClientRect();
              if (rect) {
                canvasRef.current._pinch = {
                  dist,
                  midX: (t1.clientX + t2.clientX) / 2 - rect.left,
                  midY: (t1.clientY + t2.clientY) / 2 - rect.top,
                  scale: canvasScale,
                };
              }
            }
          }}
          onTouchMove={e => {
            if (e.touches.length === 1) {
              const touch = e.touches[0];
              handleMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
            } else if (e.touches.length === 2 && canvasRef.current?._pinch) {
              e.preventDefault();
              const t1 = e.touches[0], t2 = e.touches[1];
              const newDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
              const { dist, midX, midY, scale } = canvasRef.current._pinch;
              const newScale = Math.min(2, Math.max(0.25, parseFloat((scale * newDist / dist).toFixed(2))));
              const ratio = newScale / canvasScale;
              setCanvasOffset(off => ({
                x: midX - ratio * (midX - off.x),
                y: midY - ratio * (midY - off.y),
              }));
              setCanvasScale(newScale);
            }
          }}
          onTouchEnd={() => { if (canvasRef.current) canvasRef.current._pinch = null; }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={() => { setGhostPos(null); setNewBlockSnap(null); }}
          onWheel={handleWheel}
        >
          {/* Cyberpunk neon grid + dot overlay */}
          <div style={{ position:'absolute', inset:0, pointerEvents:'none', overflow:'hidden' }}>
            {/* Ambient glow orbs */}
            <div style={{ position:'absolute', top:'-10%', left:'15%', width:500, height:500, borderRadius:'50%', background:'radial-gradient(ellipse,rgba(99,102,241,0.08) 0%,transparent 70%)', animation:'editorOrbFloat 9s ease-in-out infinite' }} />
            <div style={{ position:'absolute', bottom:'-5%', right:'10%', width:420, height:420, borderRadius:'50%', background:'radial-gradient(ellipse,rgba(249,115,22,0.06) 0%,transparent 70%)', animation:'editorOrbFloat 12s ease-in-out infinite reverse' }} />
            <div style={{ position:'absolute', top:'40%', right:'30%', width:260, height:260, borderRadius:'50%', background:'radial-gradient(ellipse,rgba(6,182,212,0.05) 0%,transparent 70%)', animation:'editorOrbFloat 7s ease-in-out infinite 2s' }} />
            {/* Scan line */}
            <div style={{ position:'absolute', left:0, right:0, height:2, background:'linear-gradient(90deg,transparent,rgba(99,102,241,0.15),rgba(249,115,22,0.1),transparent)', animation:'editorScanLine 8s linear infinite', opacity:0.6, pointerEvents:'none' }} />
          </div>
          {/* Dot grid — scaled with canvas */}
          <svg style={{ position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none', opacity:0.35 }}>
            <defs>
              <pattern id="dots"
                x={(canvasOffset.x) % (24 * canvasScale)} y={(canvasOffset.y) % (24 * canvasScale)}
                width={24 * canvasScale} height={24 * canvasScale} patternUnits="userSpaceOnUse">
                <circle cx={canvasScale} cy={canvasScale} r={canvasScale} fill="#6366f1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#dots)" />
          </svg>

          {/* Stacks */}
          <div style={{
            position:'absolute',
            left: canvasOffset.x, top: canvasOffset.y,
            transform: `scale(${canvasScale})`,
            transformOrigin: '0 0',
          }}>
            {stacks.map(stack => {
              const snapHere = newBlockSnap && newBlockSnap.stackId === stack.id && draggingNewType;
              const nbDrop = snapHere ? (newBlockSnap.valid ? 'valid' : 'invalid') : null;
              const nbHint = snapHere && !newBlockSnap.valid
                ? snapAttachRejectHint(newBlockSnap.parentType, draggingNewType)
                : null;
              return (
                <BlockStack
                  key={stack.id}
                  stack={stack}
                  selectedId={selectedBlockId}
                  onSelectBlock={handleSelectBlock}
                  onDeleteBlock={handleDeleteBlock}
                  onDragStack={handleDragStack}
                  isDragTarget={dropTarget === stack.id}
                  newBlockDrop={nbDrop}
                  newBlockDropHint={nbHint}
                />
              );
            })}
          </div>

          {/* Ghost when dragging from sidebar */}
          {ghostPos && draggingNewType && (
            <div style={{
              position:'absolute',
              left: ghostPos.x - BLOCK_W/2,
              top:  ghostPos.y - ROOT_H/2,
              opacity: 0.55, pointerEvents:'none',
            }}>
              <BlockShape
                type={draggingNewType}
                props={DEFAULT_PROPS[draggingNewType] || {}}
                isFirst
                selected={false}
                onClick={() => {}}
                onDelete={() => {}}
              />
            </div>
          )}

          {/* Empty state */}
          {stacks.length === 0 && (
            <div style={{
              position:'absolute', inset:0,
              display:'flex', flexDirection:'column',
              alignItems:'center', justifyContent:'center',
              gap:20, pointerEvents:'none',
              userSelect: 'none',
            }}>
              {/* AI killer feature */}
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 14, pointerEvents: 'all',
                background: 'rgba(13,9,32,0.6)',
                border: '1px solid rgba(99,102,241,0.2)',
                borderRadius: 24,
                padding: '36px 44px',
                backdropFilter: 'blur(12px)',
                boxShadow: '0 24px 64px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
                maxWidth: 360,
              }}>
                <div style={{
                  fontSize: 48,
                  background: 'linear-gradient(135deg, #f97316, #a78bfa)',
                  WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                  filter: 'drop-shadow(0 0 24px rgba(249,115,22,0.45))',
                  animation: 'editorNeonPulse 3s ease-in-out infinite',
                }}>✦</div>
                <div style={{
                  fontSize: 18, fontWeight: 700, color: 'var(--text)',
                  fontFamily: 'Syne, system-ui', letterSpacing: '-0.02em',
                  textAlign: 'center',
                }}>
                  Опиши своего бота словами
                </div>
                <div style={{
                  fontSize: 13, color: 'rgba(255,255,255,0.38)',
                  textAlign: 'center', maxWidth: 280, lineHeight: 1.6,
                }}>
                  {canUseAiGenerator
                    ? 'AI сгенерирует сценарий автоматически — без кода и DSL'
                    : 'AI-генерация доступна с активной подпиской PRO (включая бесплатный период после регистрации).'}
                </div>
                <button
                  onClick={openAiGeneratorModal}
                  style={{
                    padding: '13px 32px', fontSize: 14, fontWeight: 700,
                    fontFamily: 'Syne, system-ui',
                    background: canUseAiGenerator
                      ? 'linear-gradient(135deg, #f97316, #dc2626)'
                      : 'rgba(255,255,255,0.06)',
                    color: canUseAiGenerator ? '#fff' : 'rgba(255,255,255,0.35)',
                    border: canUseAiGenerator ? 'none' : '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 14,
                    cursor: canUseAiGenerator ? 'pointer' : 'not-allowed',
                    boxShadow: canUseAiGenerator ? '0 8px 28px rgba(249,115,22,0.45)' : 'none',
                    transition: 'all 0.2s',
                    opacity: canUseAiGenerator ? 1 : 0.7,
                  }}
                  onMouseEnter={e => {
                    if (!canUseAiGenerator) return;
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 14px 40px rgba(249,115,22,0.6)';
                  }}
                  onMouseLeave={e => {
                    if (!canUseAiGenerator) return;
                    e.currentTarget.style.transform = 'none';
                    e.currentTarget.style.boxShadow = '0 8px 28px rgba(249,115,22,0.45)';
                  }}
                >
                  {canUseAiGenerator ? '✦ Создать бота через AI' : '✦ AI — только PRO'}
                </button>
                <button
                  onClick={startFirstWowFlow}
                  style={{
                    padding: '10px 24px', fontSize: 13, fontWeight: 600,
                    fontFamily: 'Syne, system-ui',
                    background: 'rgba(99,102,241,0.08)',
                    color: '#a78bfa', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 12,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.18)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,0.6)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.08)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,0.3)'; }}
                >
                  ⚡ Мгновенный старт на шаблоне
                </button>
                <button
                  onClick={() => { setTourStep(0); setTourActive(true); }}
                  style={{
                    padding: '8px 18px',
                    fontSize: 12,
                    color: 'rgba(255,255,255,0.5)',
                    background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 10,
                    cursor: 'pointer',
                    transition: 'all 0.18s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.22)'; e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; }}
                >
                  Показать онбординг
                </button>
                <div style={{
                  fontSize: 11, color: 'rgba(255,255,255,0.18)',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{ flex: 1, height: 1, background: 'rgba(99,102,241,0.2)', display: 'block', width: 60 }}/>
                  или перетащи блок на холст
                  <span style={{ flex: 1, height: 1, background: 'rgba(99,102,241,0.2)', display: 'block', width: 60 }}/>
                </div>
              </div>
            </div>
          )}

          {/* Zoom controls — cyberpunk neon style */}
          <div style={{
            position: 'absolute', bottom: isMobileView ? 72 : 20, right: 20,
            display: 'flex', flexDirection: 'column', gap: 5,
            zIndex: 50,
          }}>
            {!isMobileView && (
              <button className="editor-zoom-btn" onClick={zoomIn} title="Приблизить (+)">+</button>
            )}
            <button className="editor-zoom-pct" onClick={zoomReset} title={`Сброс масштаба (${Math.round(canvasScale * 100)}%)`}>
              {Math.round(canvasScale * 100)}%
            </button>
            {!isMobileView && (
              <button className="editor-zoom-btn" onClick={zoomOut} title="Отдалить (−)">−</button>
            )}
          </div>
        </div>
        )}

        {/* Right panel: props + DSL — hidden on mobile unless props/dsl tab */}
        {(isMobileView && mobileTab !== 'props' && mobileTab !== 'dsl') ? null : (
        <div style={{
          display:'flex', flexDirection:'column',
          borderLeft: isMobileView ? 'none' : '1px solid rgba(99,102,241,0.2)', overflow:'hidden',
          background: 'linear-gradient(180deg, #0d0920 0%, #080618 100%)',
          boxShadow: isMobileView ? 'none' : '-4px 0 24px rgba(0,0,0,0.4)',
          minWidth: 0,
          position: 'relative',
          zIndex: 2,
          ...(isMobileView ? { gridColumn: '1', position: 'absolute', top: 0, left: 0, right: 0, bottom: 56, zIndex: 10 } : {}),
        }}
        data-tour={!isMobileView ? 'props-panel-desktop' : undefined}>
          {(!isMobileView || mobileTab === 'props') && (
            <>
              <div style={{
                borderBottom:'1px solid rgba(99,102,241,0.15)', padding:'8px 12px',
                fontSize:9, background:'linear-gradient(90deg,rgba(99,102,241,0.12),transparent)',
                color:'rgba(99,102,241,0.7)', textTransform:'uppercase', letterSpacing:'.14em', fontWeight:700,
                display:'flex', alignItems:'center', gap:6,
              }}><span style={{ color:'#06b6d4', fontSize:11 }}>✏</span> Свойства</div>
              <div style={{ flex: isMobileView ? 1 : '1', minHeight:0, display:'flex', flexDirection:'column', overflow:'hidden' }}>
                <PropsPanel block={selectedBlock} onChange={handlePropChange} />
              </div>
            </>
          )}
          {canSeeCode && (!isMobileView || mobileTab === 'dsl') && (
            <DSLPane stacks={stacks} isMobile={isMobileView} onApplyCorrectedCode={applyCorrectedDSLCode} />
          )}
        </div>
        )}

      </div>

      {/* Mobile bottom navigation */}
      {isMobileView && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          display: 'flex',
          background: 'linear-gradient(180deg, #0d0920 0%, #06030f 100%)',
          borderTop: '1px solid rgba(99,102,241,0.25)',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.6)',
          height: 56,
          zIndex: 100,
        }}>
          {[
            { key: 'canvas', icon: '⊞', label: 'Холст' },
            { key: 'blocks', icon: '🧱', label: 'Блоки' },
            { key: 'props',  icon: '✏️', label: 'Свойства' },
            ...(canSeeCode ? [{ key: 'dsl', icon: '📜', label: 'Код' }] : []),
          ].map(tab => (
            <button
              key={tab.key}
              data-tour={tab.key === 'canvas' ? 'mobile-tab-canvas' : tab.key === 'blocks' ? 'mobile-tab-blocks' : tab.key === 'props' ? 'mobile-tab-props' : undefined}
              onClick={() => setMobileTab(tab.key)}
              className={`editor-mobile-tab${mobileTab === tab.key ? ' active' : ''}`}
            >
              <span className="tab-icon">{tab.icon}</span>
              <span className="tab-label">{tab.label}</span>
            </button>
          ))}
          {/* Mobile Run/Stop Button */}
          {(() => { const _hasToken = stacks.some(s => s.blocks.some(b => b.type === 'bot' && b.props?.token && b.props.token.trim() !== '')); return (
          <button
            data-tour="mobile-run"
            onClick={isBotRunning ? stopBot : (_hasToken ? startBot : undefined)}
            disabled={!isBotRunning && !_hasToken}
            title={!isBotRunning && !_hasToken ? 'Добавь блок «Бот» с токеном' : ''}
            style={{
              width: 70, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 1,
              background: isBotRunning
                ? 'linear-gradient(135deg,#ef4444,#dc2626)'
                : _hasToken ? 'linear-gradient(135deg,#f97316,#dc2626)' : 'rgba(45,55,72,0.6)',
              border: 'none', cursor: (!isBotRunning && !_hasToken) ? 'not-allowed' : 'pointer',
              borderTop: `2px solid ${isBotRunning ? '#ef4444' : _hasToken ? '#f97316' : 'transparent'}`,
              borderLeft: '1px solid rgba(99,102,241,0.2)',
              flexShrink: 0, position: 'relative', overflow: 'hidden',
              opacity: (!isBotRunning && !_hasToken) ? 0.4 : 1,
              transition: 'all 0.2s',
              boxShadow: (_hasToken || isBotRunning) ? '0 0 20px rgba(249,115,22,0.3)' : 'none',
            }}
          >
            {isBotRunning && autoStopSecondsLeft !== null && (
              <div style={{
                position:'absolute', bottom:0, left:0, height:2,
                background:'rgba(255,255,255,0.45)',
                width:`${(autoStopSecondsLeft/300)*100}%`,
                transition:'width 1s linear',
              }} />
            )}
            <span style={{ fontSize: 18 }}>{isBotRunning ? '■' : '▶'}</span>
            <span style={{ fontSize: 9, color: '#fff', fontFamily: 'Syne, system-ui', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {isBotRunning ? 'Стоп' : 'Запуск'}
            </span>
            {isBotRunning && autoStopSecondsLeft !== null && (
              <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.75)', fontFamily: 'var(--mono)' }}>
                {Math.floor(autoStopSecondsLeft/60)}:{String(autoStopSecondsLeft%60).padStart(2,'0')}
              </span>
            )}
          </button>
          ); })()}
        </div>
      )}
        </>
      ) : (
        /* Non-logged-in: just show auth modal, empty background */
        <div style={{
          background: 'linear-gradient(160deg, #06030f 0%, #0a0518 50%, #080615 100%)',
        }} />
      )}

      {/* Onboarding tour (first login, desktop + mobile) */}
      {tourActive && currentUser && onboardingSteps.length > 0 && (
        <OnboardingTour
          steps={onboardingSteps}
          stepIndex={tourStep}
          onPrev={() => setTourStep(s => Math.max(0, s - 1))}
          onNext={() => {
            if (tourStep >= onboardingSteps.length - 1) finishTour();
            else setTourStep(s => Math.min(onboardingSteps.length - 1, s + 1));
          }}
          onSkip={finishTour}
        />
      )}

      {/* Auth Modal */}
      {authModalNode}

      {/* Profile Modal */}
      {showProfileModal && currentUser && (
        <ProfileModal
          user={currentUser}
          projects={userProjects}
          onClose={() => setShowProfileModal(false)}
          onLogout={async () => {
            await clearSession();
            setCurrentUser(null);
            setUserProjects([]);
            setShowProfileModal(false);
            setAuthTab('login');
            setShowAuthModal(true);
          }}
          onUpdateUser={async (updates) => {
            try {
              const { _silent, ...serverUpdates } = updates;
              const updated = await updateUser(currentUser.id, serverUpdates, currentUser);
              setCurrentUser(updated);
              saveSession(updated);
              if (!_silent) showToast('Профиль обновлён', 'success');
              return updated;
            } catch (e) {
              showToast(e.message, 'error');
              throw e;
            }
          }}
          onLoadProject={async (projectId) => {
            const project = await loadProjectFromCloud(projectId);
            if (project) {
              setStacks(project.stacks);
              setProjectName(project.name);
              setShowProfileModal(false);
            }
          }}
          onDeleteProject={async (projectId) => {
            if (confirm('Удалить проект?')) {
              await deleteProject(projectId);
              await loadUserProjects(currentUser.id);
              showToast('Проект удалён', 'info');
            }
          }}
          onSaveToCloud={async (name) => {
            const n = name || projectName.trim() || 'Без названия';
            await saveProjectToCloud(currentUser.id, n, stacks);
            await loadUserProjects(currentUser.id);
            showToast('☁ Сохранено: ' + n, 'success');
          }}
          onOpenInstructions={() => setShowInstructions(true)}
          showToast={showToast}
          isMobile={isMobileView}
        />
      )}

      {currentUser && previewPanelOpen && (
        <div
          style={{
            position: 'fixed',
            ...(isMobileView
              ? { left: 8, right: 8, bottom: 72, top: '12vh', maxHeight: '70vh' }
              : { right: 20, bottom: 20, width: 340, height: 'min(480px, 52vh)' }),
            zIndex: 9600,
            display: 'flex',
            flexDirection: 'column',
            background: 'linear-gradient(160deg,#111318,#0c0e13)',
            border: '1px solid rgba(56,189,248,0.28)',
            borderRadius: 14,
            boxShadow: '0 24px 50px rgba(0,0,0,0.55)',
            overflow: 'hidden',
            fontFamily: 'Syne,system-ui, sans-serif',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.07)',
            background: 'rgba(56,189,248,0.06)',
          }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#e2e8f0' }}>
              Чат-превью
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => { resetPreviewSession(); showToast('Сессия превью сброшена', 'info'); }}
                style={{
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 8, padding: '4px 8px',
                  fontSize: 11, color: 'rgba(226,232,240,0.85)', background: 'transparent', cursor: 'pointer',
                }}
              >
                Новая сессия
              </button>
              <button
                type="button"
                aria-label="Закрыть"
                onClick={() => setPreviewPanelOpen(false)}
                style={{
                  border: 'none', background: 'rgba(255,255,255,0.06)',
                  color: '#94a3b8', cursor: 'pointer', borderRadius: 8,
                  width: 30, height: 30, fontSize: 16, lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>
          </div>
          <div style={{ fontSize: 10, color: 'rgba(148,163,184,0.9)', padding: '6px 12px', lineHeight: 1.45 }}>
            Сервер выполняет сценарий через mock Telegram (без вашего Bot API). На сервере нужен{' '}
            <span style={{ color: '#7dd3fc' }}>CICADA_TG_ROOT</span> в .env.
          </div>
          <div
            ref={previewScrollRef}
            style={{
              flex: 1, minHeight: 0,
              overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
            }}
          >
            {previewMessages.length === 0 && (
              <div style={{ fontSize: 11, color: 'rgba(148,163,184,0.85)', padding: '8px 0' }}>
                Например, отправьте <strong>/start</strong> или текст. Нажимайте кнопки — для превью это те же сообщения/callback.
              </div>
            )}
            {previewMessages.map((m, i) => (
              <div
                key={i}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '92%',
                  borderRadius: 12,
                  padding: '8px 11px',
                  fontSize: 12,
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.45,
                  background:
                    m.role === 'user'
                      ? 'linear-gradient(135deg,#0369a1,#0ea5e9)'
                      : m.kind === 'sys'
                      ? 'rgba(255,255,255,0.04)'
                      : 'rgba(30,41,59,0.85)',
                  color: m.role === 'user' ? '#f8fafc' : 'rgba(241,245,249,0.95)',
                  border: m.role === 'user' ? 'none' : '1px solid rgba(148,163,184,0.15)',
                }}
              >
                {m.role === 'bot' && m.kind === 'reply_keyboard' && (m.text || '').trim().length > 0 && (
                  <div style={{ marginBottom: 8 }}>{m.text}</div>
                )}
                {m.role === 'bot' && m.kind === 'inline_keyboard' && (m.text || '').trim().length > 0 && (
                  <div style={{ marginBottom: 8 }}>{m.text}</div>
                )}
                {m.role === 'bot' && m.kind === 'text' && <span>{m.text}</span>}
                {m.role === 'user' && <span>{m.text}</span>}
                {m.role === 'bot' && m.kind === 'sys' && (
                  <span style={{ opacity: 0.75, fontFamily: 'var(--mono,monospace)', fontSize: 10 }}>{m.text}</span>
                )}
                {m.role === 'bot' && m.kind === 'reply_keyboard' && Array.isArray(m.keyboard) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {m.keyboard.flat().map((lbl, j) => (
                      <button
                        key={j}
                        type="button"
                        disabled={previewBusy}
                        onClick={() => sendPreviewUserText(lbl)}
                        style={{
                          border: '1px solid rgba(56,189,248,0.35)',
                          background: 'rgba(14,165,233,0.12)',
                          color: '#e0f2fe', borderRadius: 8,
                          padding: '5px 9px', fontSize: 11, cursor: previewBusy ? 'wait' : 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                )}
                {m.role === 'bot' && m.kind === 'inline_keyboard' && Array.isArray(m.rows) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                    {m.rows.map((row, ri) => (
                      <div key={ri} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {(row || []).map((btn, bi) => {
                          const label = btn?.text ?? '';
                          const cd = btn?.callback_data != null ? btn.callback_data : label;
                          const url = btn?.url;
                          if (url) {
                            return (
                              <a
                                key={bi}
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                style={{
                                  border: '1px solid rgba(167,139,250,0.45)',
                                  background: 'rgba(139,92,246,0.12)',
                                  color: '#ede9fe', borderRadius: 8,
                                  padding: '5px 9px', fontSize: 11,
                                  textDecoration: 'none',
                                }}
                              >
                                {label}
                              </a>
                            );
                          }
                          return (
                            <button
                              key={bi}
                              type="button"
                              disabled={previewBusy || !cd}
                              onClick={() => sendPreviewCallback(cd)}
                              style={{
                                border: '1px solid rgba(167,139,250,0.35)',
                                background: 'rgba(139,92,246,0.12)',
                                color: '#ede9fe', borderRadius: 8,
                                padding: '5px 9px', fontSize: 11,
                                cursor: previewBusy ? 'wait' : 'pointer',
                                fontFamily: 'inherit',
                              }}
                            >
                              {label || cd}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {previewBusy && (
              <div style={{ fontSize: 11, color: 'rgba(148,163,184,0.8)', alignSelf: 'center' }}>
                …
              </div>
            )}
          </div>
          {previewErr && (
            <div style={{ padding: '0 12px 8px', fontSize: 11, color: '#fca5a5', whiteSpace: 'pre-wrap' }}>
              {previewErr}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, padding: 10, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
            <button
              type="button"
              disabled={previewBusy}
              onClick={() => sendPreviewUserText('/start')}
              style={{
                flexShrink: 0, padding: '0 10px', borderRadius: 8,
                border: '1px solid rgba(249,115,22,0.4)', background: 'rgba(249,115,22,0.1)',
                color: '#f97316', fontSize: 11, cursor: previewBusy ? 'wait' : 'pointer',
              }}
            >
              /start
            </button>
            <input
              value={previewDraft}
              onChange={e => setPreviewDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendPreviewUserText(previewDraft);
                  setPreviewDraft('');
                }
              }}
              placeholder="Текст как в Telegram..."
              disabled={previewBusy}
              style={{
                flex: 1, borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(15,23,42,0.7)', color: '#f1f5f9',
                padding: '8px 10px', fontSize: 13, outline: 'none',
              }}
            />
            <button
              type="button"
              disabled={previewBusy}
              onClick={() => { sendPreviewUserText(previewDraft); setPreviewDraft(''); }}
              style={{
                flexShrink: 0, padding: '0 14px', borderRadius: 10,
                border: 'none', background: 'linear-gradient(135deg,#0ea5e9,#0369a1)',
                color: '#fff', fontWeight: 700, fontSize: 12, cursor: previewBusy ? 'wait' : 'pointer',
              }}
            >
              Отпр.
            </button>
          </div>
        </div>
      )}

      {botDebugOpen && (
        <div
          style={{
            position: 'fixed',
            ...(isMobileView
              ? { left: 8, right: 8, bottom: 72, top: '14vh', maxHeight: '62vh' }
              : { left: 20, bottom: 20, width: 'min(420px, 38vw)', height: 'min(440px, 52vh)' }),
            zIndex: 9598,
            display: 'flex',
            flexDirection: 'column',
            background: 'linear-gradient(160deg,#111318,#0c0e13)',
            border: '1px solid rgba(250,204,21,0.32)',
            borderRadius: 14,
            boxShadow: '0 24px 50px rgba(0,0,0,0.55)',
            overflow: 'hidden',
            fontFamily: 'var(--mono, ui-monospace, monospace)',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.07)',
            background: 'rgba(250,204,21,0.06)',
            fontFamily: 'Syne,system-ui, sans-serif',
          }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#fef08a' }}>
              Отладка · cicada --dev
            </div>
            <button
              type="button"
              aria-label="Закрыть"
              onClick={() => setBotDebugOpen(false)}
              style={{
                border: 'none', background: 'rgba(255,255,255,0.06)',
                color: '#94a3b8', cursor: 'pointer', borderRadius: 8,
                width: 30, height: 30, fontSize: 16, lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
          <div style={{ fontSize: 10, color: 'rgba(148,163,184,0.92)', padding: '6px 12px', lineHeight: 1.45, fontFamily: 'Syne,system-ui, sans-serif' }}>
            Поток stdout/stderr процесса на сервере. Обновляется каждые ~1.2 с, пока открыто окно.
          </div>
          <pre
            ref={botDebugScrollRef}
            style={{
              flex: 1, minHeight: 0, margin: 0, padding: '10px 12px',
              overflow: 'auto', fontSize: 11, lineHeight: 1.45,
              color: 'rgba(226,232,240,0.92)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}
          >
            {botDebugLogs || (isBotRunning ? 'Ожидание логов…' : 'Нет активного процесса. Запусти бота или открой окно сразу после остановки — последние строки могут быть доступны.')}</pre>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div style={{
          position: 'fixed',
          top: isMobileView ? 'auto' : 20,
          bottom: isMobileView ? 80 : 'auto',
          left: '50%',
          transform: toast.visible ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(-20px)',
          opacity: toast.visible ? 1 : 0,
          transition: 'all 0.3s ease',
          zIndex: 9999,
          maxWidth: isMobileView ? '90%' : 400,
          width: 'auto',
        }}>
          <div style={{
            background: toast.type === 'error' ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' :
                        toast.type === 'success' ? 'linear-gradient(135deg, #3ecf8e 0%, #059669 100%)' :
                        'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
            color: '#fff',
            padding: '12px 20px',
            borderRadius: 10,
            boxShadow: '0 10px 30px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.1)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 14,
            fontWeight: 500,
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.1)',
          }}>
            <span style={{ fontSize: 18 }}>
              {toast.type === 'error' ? '⚠️' : toast.type === 'success' ? '✅' : 'ℹ️'}
            </span>
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      {/* Bot Starting Loading Modal */}
      {isStartingBot && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{
            background: 'linear-gradient(160deg, #0d0920 0%, #10082a 100%)',
            borderRadius: 20,
            border: '1px solid rgba(249,115,22,0.3)',
            padding: '40px 50px',
            textAlign: 'center',
            boxShadow: '0 40px 80px rgba(0,0,0,0.7), 0 0 40px rgba(249,115,22,0.12)',
          }}>
            <div style={{
              width: 60, height: 60,
              border: '4px solid rgba(249,115,22,0.2)',
              borderTopColor: '#f97316',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 20px',
            }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <div style={{ fontSize: 18, color: '#f97316', fontWeight: 600, marginBottom: 8 }}>
              Запуск бота...
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
              Пожалуйста, подождите 
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
              Бот автоматически остановится через 5 минут ! 
            </div>
          </div>
        </div>
      )}

      {/* Bot Start Error Modal */}
      {startBotError && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10001,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 16,
          overflowY: 'auto',
          backdropFilter: 'blur(8px)',
        }} onClick={() => setStartBotError(null)}>
          <div style={{
            background: 'linear-gradient(145deg, #16181c 0%, #1a1d24 100%)',
            borderRadius: 20,
            border: '1px solid rgba(239,68,68,0.3)',
            padding: '35px 45px',
            textAlign: 'center',
            maxWidth: 400,
            width: 'min(400px, calc(100vw - 32px))',
            maxHeight: 'calc(100dvh - 32px)',
            overflowY: 'auto',
            boxShadow: '0 40px 80px rgba(0,0,0,0.6)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>❌</div>
            <div style={{ fontSize: 18, color: '#ef4444', fontWeight: 600, marginBottom: 12 }}>
              Ошибка запуска
            </div>
            <div style={{
              fontSize: 14,
              color: 'rgba(255,255,255,0.6)',
              marginBottom: 24,
              whiteSpace: 'pre-wrap',
              textAlign: 'left',
              maxHeight: '45dvh',
              overflowY: 'auto',
            }}>
              {startBotError}
            </div>
            <button
              onClick={() => setStartBotError(null)}
              style={{
                background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                color: '#fff',
                padding: '12px 30px',
                border: 'none',
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Закрыть
            </button>
          </div>
        </div>
      )}

      {/* Bot Stopping Loading Modal */}
      {isStoppingBot && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{
            background: 'linear-gradient(145deg, #16181c 0%, #1a1d24 100%)',
            borderRadius: 20,
            border: '1px solid rgba(239,68,68,0.2)',
            padding: '40px 50px',
            textAlign: 'center',
            boxShadow: '0 40px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(239,68,68,0.1)',
          }}>
            <div style={{
              width: 60, height: 60,
              border: '4px solid rgba(239,68,68,0.2)',
              borderTopColor: '#ef4444',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 20px',
            }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <div style={{ fontSize: 18, color: '#ef4444', fontWeight: 600, marginBottom: 8 }}>
              Остановка бота...
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
              Пожалуйста, подождите
            </div>
          </div>
        </div>
      )}

      {/* Bot Stop Error Modal */}
      {stopBotError && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10001,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 16,
          overflowY: 'auto',
          backdropFilter: 'blur(8px)',
        }} onClick={() => setStopBotError(null)}>
          <div style={{
            background: 'linear-gradient(145deg, #16181c 0%, #1a1d24 100%)',
            borderRadius: 20,
            border: '1px solid rgba(239,68,68,0.3)',
            padding: '35px 45px',
            textAlign: 'center',
            maxWidth: 400,
            width: 'min(400px, calc(100vw - 32px))',
            maxHeight: 'calc(100dvh - 32px)',
            overflowY: 'auto',
            boxShadow: '0 40px 80px rgba(0,0,0,0.6)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>❌</div>
            <div style={{ fontSize: 18, color: '#ef4444', fontWeight: 600, marginBottom: 12 }}>
              Ошибка остановки
            </div>
            <div style={{
              fontSize: 14,
              color: 'rgba(255,255,255,0.6)',
              marginBottom: 24,
              whiteSpace: 'pre-wrap',
              textAlign: 'left',
              maxHeight: '45dvh',
              overflowY: 'auto',
            }}>
              {stopBotError}
            </div>
            <button
              onClick={() => setStopBotError(null)}
              style={{
                background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                color: '#fff',
                padding: '12px 30px',
                border: 'none',
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Закрыть
            </button>
          </div>
        </div>
      )}

    </div>
    </BlockInfoContext.Provider>
    </AddBlockContext.Provider>
  );
}
// ═══════════════════════════════════════════════════════════════════════════
// ─── PARTICLE CANVAS BACKGROUND ───────────────────────────────────────────
function useParticleCanvas(canvasRef) {
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf;
    let w = 0, h = 0;
    const COLORS = [
      { r:255, g:90,  b:20  },
      { r:255, g:60,  b:0   },
      { r:140, g:60,  b:255 },
      { r:100, g:40,  b:200 },
      { r:255, g:130, b:40  },
    ];
    let particles = [], hexes = [];
    function resize() {
      w = canvas.offsetWidth; h = canvas.offsetHeight;
      canvas.width = w; canvas.height = h;
      init();
    }
    function init() {
      const count = Math.min(80, Math.floor((w * h) / 12000));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
        r: Math.random() * 2 + 0.8,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        alpha: Math.random() * 0.5 + 0.2,
        pulse: Math.random() * Math.PI * 2,
        pulseSpeed: Math.random() * 0.02 + 0.005,
      }));
      hexes = Array.from({ length: 6 }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        size: Math.random() * 60 + 30,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.003,
        alpha: Math.random() * 0.06 + 0.02,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      }));
    }
    function drawHex(x, y, size, rotation, color, alpha) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rotation);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        i === 0 ? ctx.moveTo(size * Math.cos(a), size * Math.sin(a)) : ctx.lineTo(size * Math.cos(a), size * Math.sin(a));
      }
      ctx.closePath();
      ctx.strokeStyle = `rgba(${color.r},${color.g},${color.b},${alpha})`;
      ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
    }
    function frame() {
      ctx.clearRect(0, 0, w, h);
      hexes.forEach(hex => {
        hex.rotation += hex.rotSpeed;
        hex.x += Math.sin(hex.rotation * 3) * 0.1;
        hex.y += Math.cos(hex.rotation * 2) * 0.08;
        if (hex.x < -100) hex.x = w + 100;
        if (hex.x > w + 100) hex.x = -100;
        if (hex.y < -100) hex.y = h + 100;
        if (hex.y > h + 100) hex.y = -100;
        drawHex(hex.x, hex.y, hex.size, hex.rotation, hex.color, hex.alpha);
        drawHex(hex.x, hex.y, hex.size * 0.6, -hex.rotation * 1.3, hex.color, hex.alpha * 0.6);
      });
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.pulse += p.pulseSpeed;
        if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
        const pa = p.alpha * (0.75 + 0.25 * Math.sin(p.pulse));
        const pr = p.r * (0.9 + 0.2 * Math.sin(p.pulse * 1.3));
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, pr * 4);
        grad.addColorStop(0, `rgba(${p.color.r},${p.color.g},${p.color.b},${pa})`);
        grad.addColorStop(1, `rgba(${p.color.r},${p.color.g},${p.color.b},0)`);
        ctx.beginPath(); ctx.arc(p.x, p.y, pr * 4, 0, Math.PI * 2);
        ctx.fillStyle = grad; ctx.fill();
        ctx.beginPath(); ctx.arc(p.x, p.y, pr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color.r},${p.color.g},${p.color.b},${pa})`; ctx.fill();
      });
      const LINK = 140;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i], b = particles[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < LINK) {
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
            const cr = (a.color.r + b.color.r) / 2;
            const cg = (a.color.g + b.color.g) / 2;
            const cb = (a.color.b + b.color.b) / 2;
            ctx.strokeStyle = `rgba(${cr},${cg},${cb},${(1 - dist/LINK) * 0.18})`;
            ctx.lineWidth = 0.8; ctx.stroke();
          }
        }
      }
      raf = requestAnimationFrame(frame);
    }
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [canvasRef]);
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── SERVER ERROR TRANSLATION ─────────────────────────────────────────────
function translateServerError(msg) {
  if (!msg) return msg;
  const map = {
    // Auth errors
    'Invalid credentials': 'Неверный email или пароль',
    'Invalid email or password': 'Неверный email или пароль',
    'Wrong password': 'Неверный пароль',
    'Incorrect password': 'Неверный пароль',
    'User not found': 'Пользователь не найден',
    'No user found': 'Пользователь не найден',
    'Email not found': 'Email не найден',
    'Email already exists': 'Этот email уже зарегистрирован',
    'Email already in use': 'Этот email уже используется',
    'Email already registered': 'Этот email уже зарегистрирован',
    'User already exists': 'Пользователь с таким email уже существует',
    'Account not found': 'Аккаунт не найден',
    'Account already exists': 'Аккаунт уже существует',
    // Token / session errors
    'Invalid token': 'Недействительная ссылка',
    'Token expired': 'Срок действия ссылки истёк',
    'Token not found': 'Ссылка не найдена или уже использована',
    'Invalid reset token': 'Недействительная ссылка для сброса пароля',
    'Reset token expired': 'Ссылка для сброса пароля устарела',
    'Unauthorized': 'Необходима авторизация',
    // Email verification
    'Email not verified': 'Email не подтверждён — проверьте почту',
    'Please verify your email': 'Пожалуйста, подтвердите email',
    'Verification code is invalid': 'Неверный код подтверждения',
    'Verification code expired': 'Код подтверждения устарел',
    'Invalid code': 'Неверный код',
    // General errors
    'Internal server error': 'Ошибка сервера. Попробуйте позже',
    'Server error': 'Ошибка сервера. Попробуйте позже',
    'Too many requests': 'Слишком много попыток. Подождите немного',
    'Rate limit exceeded': 'Слишком много запросов. Попробуйте позже',
    'Network error': 'Ошибка сети. Проверьте подключение',
    'Request failed': 'Запрос не выполнен. Попробуйте ещё раз',
  };
  // Exact match first
  if (map[msg]) return map[msg];
  // Case-insensitive match
  const lower = msg.toLowerCase();
  for (const [key, val] of Object.entries(map)) {
    if (lower === key.toLowerCase()) return val;
  }
  // Partial match
  for (const [key, val] of Object.entries(map)) {
    if (lower.includes(key.toLowerCase())) return val;
  }
  return msg;
}

// ─── Telegram Auth helpers ───────────────────────────────────────────────────

async function telegramAuth(tgData) {
  const res = await postJsonWithCsrf('/api/auth/telegram', tgData);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  if (data.token) storeJwt(data.token);
  return data.user;
}

const TG_BOT_NAME = import.meta.env.VITE_TG_BOT_NAME || '';

/** Абсолютный URL callback для виджета (тот же хост, что и API). */
function getTelegramWidgetAuthCallbackUrl() {
  const raw = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
  if (raw.startsWith('http')) return `${raw}/auth/telegram/callback`;
  if (typeof window !== 'undefined') {
    const path = raw.startsWith('/') ? raw : `/${raw}`;
    return `${window.location.origin}${path}/auth/telegram/callback`;
  }
  return '';
}

function TelegramLoginButton({ onLogin }) {
  const widgetRef = React.useRef(null);

  React.useEffect(() => {
    if (!TG_BOT_NAME || !widgetRef.current) return;
    widgetRef.current.innerHTML = '';
    const authUrl = getTelegramWidgetAuthCallbackUrl();
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.setAttribute('data-telegram-login', TG_BOT_NAME);
    script.setAttribute('data-size', 'medium');
    script.setAttribute('data-radius', '12');
    script.setAttribute('data-request-access', 'write');
    script.async = true;

    if (authUrl) {
      // Редирект на бэкенд — обходит cross-origin iframe (старая «невидимая» кнопка ломала вход).
      script.setAttribute('data-auth-url', authUrl);
    } else {
      script.setAttribute('data-onauth', 'onTelegramAuth(user)');
      window.onTelegramAuth = async (user) => {
        try {
          await onLogin(null, null, user);
        } catch (e) {
          console.error('TG auth error:', e);
        }
      };
    }
    widgetRef.current.appendChild(script);
    return () => {
      delete window.onTelegramAuth;
    };
  }, [onLogin]);

  if (!TG_BOT_NAME) return null;

  return (
    <div
      ref={widgetRef}
      style={{
        flex: 1,
        minHeight: 48,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        background: 'rgba(33,150,243,0.07)',
        border: '1px solid rgba(33,150,243,0.25)',
        overflow: 'hidden',
        minWidth: 0,
      }}
    />
  );
}

function GoogleLoginButton() {
  return (
    <button
      type="button"
      onClick={() => { window.location.href = '/api/auth/google/start'; }}
      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: '13px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.85)', fontFamily: 'inherit', fontWeight: 500, fontSize: 14, cursor: 'pointer', transition: 'all .2s' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.transform = 'none'; }}
    >
      <svg width="18" height="18" viewBox="0 0 48 48">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
        <path fill="none" d="M0 0h48v48H0z"/>
      </svg>
      Google
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LANDING INFO MODAL
// ═══════════════════════════════════════════════════════════════════════════
function LandingInfoModal({ page, onClose, isMobile }) {
  const [docsSection, setDocsSection] = React.useState(0);

  const PAGE_META = {
    features:  { title: 'Возможности',  icon: '\u2728', grad: 'linear-gradient(135deg,#fbbf24,#f97316)', glow: 'rgba(251,191,36,0.18)',  border: 'rgba(251,191,36,0.35)' },
    templates: { title: '\u0428\u0430\u0431\u043b\u043e\u043d\u044b',    icon: '🎨', grad: 'linear-gradient(135deg,#60a5fa,#818cf8)', glow: 'rgba(96,165,250,0.18)',   border: 'rgba(96,165,250,0.35)'  },
    pricing:   { title: '\u0422\u0430\u0440\u0438\u0444\u044b',      icon: '💳', grad: 'linear-gradient(135deg,#34d399,#06b6d4)', glow: 'rgba(52,211,153,0.18)',   border: 'rgba(52,211,153,0.35)'  },
    docs:      { title: '\u0414\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0430\u0446\u0438\u044f', icon: '📖', grad: 'linear-gradient(135deg,#a78bfa,#6366f1)', glow: 'rgba(167,139,250,0.18)',  border: 'rgba(167,139,250,0.35)' },
  };
  const meta = PAGE_META[page] || PAGE_META.features;

  const Code = ({ children }) => (
    <code style={{ fontFamily: 'monospace', fontSize: 12, background: 'rgba(255,255,255,0.08)', padding: '2px 7px', borderRadius: 5, color: '#fbbf24' }}>{children}</code>
  );
  const CodeBlock = ({ children }) => (
    <pre style={{ fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6, background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '12px 14px', margin: '8px 0', overflowX: 'auto', color: '#93c5fd', whiteSpace: 'pre' }}>{children}</pre>
  );
  const SectionTitle = ({ children, color = '#fbbf24' }) => (
    <div style={{ fontFamily: 'Syne,system-ui', fontWeight: 700, fontSize: 15, color, marginBottom: 10, marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>{children}</div>
  );
  const Table = ({ rows }) => (
    <div style={{ overflowX: 'auto', marginBottom: 10 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr>{rows[0].map((h, i) => <th key={i} style={{ textAlign: 'left', padding: '7px 10px', background: 'rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)', fontFamily: 'Syne,system-ui', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
        <tbody>{rows.slice(1).map((row, ri) => (<tr key={ri} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{row.map((cell, ci) => <td key={ci} style={{ padding: '7px 10px', color: 'rgba(255,255,255,0.75)', verticalAlign: 'top' }}>{cell}</td>)}</tr>))}</tbody>
      </table>
    </div>
  );

  const DOC_SECTIONS = [
    { label: '📖 \u041e\u0431\u0437\u043e\u0440', content: (<div style={{ display:'flex', flexDirection:'column', gap:12 }}><SectionTitle>\u0427\u0442\u043e \u0442\u0430\u043a\u043e\u0435 Cicada Studio?</SectionTitle><p style={{ fontSize:13, color:'rgba(255,255,255,0.7)', lineHeight:1.65, margin:0 }}><strong style={{ color:'#fbbf24' }}>Cicada Studio</strong> \u2014 \u0432\u0438\u0437\u0443\u0430\u043b\u044c\u043d\u044b\u0439 \u043a\u043e\u043d\u0441\u0442\u0440\u0443\u043a\u0442\u043e\u0440 Telegram-\u0431\u043e\u0442\u043e\u0432 \u043d\u0430 \u043e\u0441\u043d\u043e\u0432\u0435 ReactFlow.</p><div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr':'1fr 1fr 1fr', gap:8 }}>{[['\u041b\u0435\u0432\u0430\u044f \u043f\u0430\u043d\u0435\u043b\u044c','\u041f\u0430\u043b\u0438\u0442\u0440\u0430 \u0431\u043b\u043e\u043a\u043e\u0432 \u2014 \u043f\u0435\u0440\u0435\u0442\u0430\u0449\u0438 \u043d\u0430 \u0445\u043e\u043b\u0441\u0442','#3ecf8e'],['\u0426\u0435\u043d\u0442\u0440\u0430\u043b\u044c\u043d\u0430\u044f','\u0425\u043e\u043b\u0441\u0442 \u0434\u043b\u044f \u043f\u043e\u0441\u0442\u0440\u043e\u0435\u043d\u0438\u044f \u0441\u0445\u0435\u043c\u044b','#60a5fa'],['\u041f\u0440\u0430\u0432\u0430\u044f \u043f\u0430\u043d\u0435\u043b\u044c','\u0421\u0432\u043e\u0439\u0441\u0442\u0432\u0430 \u0431\u043b\u043e\u043a\u0430 + \u043a\u043e\u0434','#a78bfa']].map(([t,d,c]) => (<div key={t} style={{ padding:'12px 14px', borderRadius:10, background:'rgba(255,255,255,0.03)', border:`1px solid ${c}30` }}><div style={{ fontSize:12, fontWeight:700, color:c, marginBottom:4, fontFamily:'Syne,system-ui' }}>{t}</div><div style={{ fontSize:11, color:'rgba(255,255,255,0.55)', lineHeight:1.5 }}>{d}</div></div>))}</div></div>) },
    { label: '🧱 \u0411\u043b\u043e\u043a\u0438', content: (<div style={{ display:'flex', flexDirection:'column', gap:14 }}>{[{ group:'\u2699 \u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438', color:'#94a3b8', rows:[['\u0411\u043b\u043e\u043a','\u041d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0435'],['📌 \u0412\u0435\u0440\u0441\u0438\u044f','\u0423\u043a\u0430\u0437\u044b\u0432\u0430\u0435\u0442 \u0432\u0435\u0440\u0441\u0438\u044e \u0431\u043e\u0442\u0430'],['🤖 \u0411\u043e\u0442','\u0422\u043e\u043a\u0435\u043d Telegram-\u0431\u043e\u0442\u0430'],['📋 \u041a\u043e\u043c\u0430\u043d\u0434\u044b \u043c\u0435\u043d\u044e','\u041a\u043e\u043c\u0430\u043d\u0434\u044b \u0432 \u043c\u0435\u043d\u044e Telegram'],['🌍 \u0413\u043b\u043e\u0431\u0430\u043b\u044c\u043d\u0430\u044f','\u0413\u043b\u043e\u0431\u0430\u043b\u044c\u043d\u044b\u0435 \u043f\u0435\u0440\u0435\u043c\u0435\u043d\u043d\u044b\u0435']] },{ group:'\u25b6 \u041e\u0441\u043d\u043e\u0432\u043d\u044b\u0435', color:'#3ecf8e', rows:[['\u0411\u043b\u043e\u043a','\u041d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0435'],['\u25b6 \u0421\u0442\u0430\u0440\u0442','\u0422\u043e\u0447\u043a\u0430 \u0432\u0445\u043e\u0434\u0430 \u043f\u0440\u0438 /start'],['\u2709 \u041e\u0442\u0432\u0435\u0442','\u041e\u0442\u043f\u0440\u0430\u0432\u043a\u0430 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u044f'],['\u229e \u041a\u043d\u043e\u043f\u043a\u0438','\u041a\u043b\u0430\u0432\u0438\u0430\u0442\u0443\u0440\u0430'],['\u2215 \u041a\u043e\u043c\u0430\u043d\u0434\u0430','\u041e\u0431\u0440\u0430\u0431\u043e\u0442\u043a\u0430 /\u043a\u043e\u043c\u0430\u043d\u0434\u044b'],['\u2299 \u041d\u0430\u0436\u0430\u0442\u0438\u0435','\u0421allback \u043e\u0442 inline-\u043a\u043d\u043e\u043f\u043e\u043a']] },{ group:'🧠 \u041b\u043e\u0433\u0438\u043a\u0430', color:'#fb923c', rows:[['\u0411\u043b\u043e\u043a','\u041d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0435'],['\u25c7 \u0423\u0441\u043b\u043e\u0432\u0438\u0435','If-else \u0432\u0435\u0442\u0432\u043b\u0435\u043d\u0438\u0435'],['? \u0421\u043f\u0440\u043e\u0441\u0438\u0442\u044c','\u0417\u0430\u043f\u0440\u043e\u0441 \u0432\u0432\u043e\u0434\u0430'],['♦ \u0417\u0430\u043f\u043e\u043c\u043d\u0438\u0442\u044c','\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u0432 \u043f\u0435\u0440\u0435\u043c\u0435\u043d\u043d\u0443\u044e']] }].map(({ group, color, rows }) => (<div key={group}><SectionTitle color={color}>{group}</SectionTitle><Table rows={rows} /></div>))}</div>) },
    { label: '🔗 \u0421\u043e\u0435\u0434\u0438\u043d\u0435\u043d\u0438\u044f', content: (<div style={{ display:'flex', flexDirection:'column', gap:14 }}><SectionTitle>\u041f\u0440\u0430\u0432\u0438\u043b\u0430 \u0441\u043e\u0435\u0434\u0438\u043d\u0435\u043d\u0438\u0439</SectionTitle>{[['\u041e\u0442 source \u043a target','\u041f\u043e\u0442\u043e\u043a \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f \u0438\u0434\u0451\u0442 \u0441\u043b\u0435\u0432\u0430 \u043d\u0430\u043f\u0440\u0430\u0432\u043e'],['Корневые блоки','Старт, Команда — начало цепочки'],['Завершающие блоки','Стоп, Переход — без исходящих']].map(([t,d]) => (<div key={t} style={{ display:'flex', gap:12, padding:'10px 12px', borderRadius:9, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)' }}><div style={{ fontSize:12, fontWeight:700, color:'#fbbf24', minWidth:130, flexShrink:0 }}>{t}</div><div style={{ fontSize:12, color:'rgba(255,255,255,0.65)', lineHeight:1.5 }}>{d}</div></div>))}</div>) },
    { label: '{ } Переменные', content: (<div style={{ display:'flex', flexDirection:'column', gap:14 }}><SectionTitle>Встроенные переменные</SectionTitle><Table rows={[['\u0421\u0438\u043d\u0442\u0430\u043a\u0441\u0438\u0441','\u0417\u043d\u0430\u0447\u0435\u043d\u0438\u0435'],['{пользователь.имя}','Имя пользователя'],['{пользователь.id}','ID пользователя Telegram'],['{чат.id}','ID текущего чата'],['{текст}','Текст последнего сообщения']]} /><CodeBlock>{`ответ "Привет, {пользователь.имя}!"`}</CodeBlock></div>) },
    { label: '\u2705 \u042d\u043a\u0441\u043f\u043e\u0440\u0442', content: (<div style={{ display:'flex', flexDirection:'column', gap:14 }}><SectionTitle>Панель DSL (справа)</SectionTitle><div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr':'1fr 1fr', gap:8 }}>{[['проверить','Валидация схемы','#3ecf8e'],['copy','Копировать код','#60a5fa'],['↓ .ccd','Скачать файл','#fbbf24'],['▶ Запустить','Запуск бота','#a78bfa']].map(([t,d,c]) => (<div key={t} style={{ padding:'11px 13px', borderRadius:9, background:'rgba(255,255,255,0.02)', border:`1px solid ${c}30` }}><div style={{ fontSize:13, fontWeight:700, color:c, fontFamily:'Syne,system-ui', marginBottom:4 }}>{t}</div><div style={{ fontSize:12, color:'rgba(255,255,255,0.55)', lineHeight:1.5 }}>{d}</div></div>))}</div><SectionTitle>Локальный запуск (CLI)</SectionTitle><CodeBlock>{`pip install cicada-tg\ncicada bot.ccd`}</CodeBlock></div>) },
  ];

  return (
    <div
      style={{ position:'fixed', inset:0, zIndex:15000, background:'rgba(3,5,9,0.82)', backdropFilter:'blur(14px)', display:'flex', alignItems:'center', justifyContent:'center', padding:isMobile?0:18 }}
      onClick={onClose}
    >
      <style>{`
        @keyframes lipSlide { from{opacity:0;transform:translateY(16px) scale(0.97)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes lipSlideUp { from{opacity:0;transform:translateY(100%)} to{opacity:1;transform:translateY(0)} }
        @keyframes shimmer { 0%{background-position:200% center} 100%{background-position:-200% center} }
        .lip-scroll::-webkit-scrollbar{width:4px} .lip-scroll::-webkit-scrollbar-track{background:transparent} .lip-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.12);border-radius:2px}
        .lip-feat-card { padding:16px 18px; border-radius:14px; background:rgba(255,255,255,0.025); border:1px solid rgba(255,255,255,0.07); transition:all .22s ease; cursor:default; }
        .lip-feat-card:hover { background:rgba(255,255,255,0.05); transform:translateY(-2px); box-shadow:0 8px 28px rgba(0,0,0,0.4); }
        .lip-tpl-card { padding:16px 18px; border-radius:14px; background:rgba(255,255,255,0.025); border:1px solid rgba(255,255,255,0.07); transition:all .22s ease; cursor:default; position:relative; overflow:hidden; }
        .lip-tpl-card:hover { background:rgba(255,255,255,0.045); transform:translateY(-2px); box-shadow:0 8px 28px rgba(0,0,0,0.4); }
        .lip-price-free { padding:22px; border-radius:18px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); transition:border-color .2s; }
        .lip-price-free:hover { border-color:rgba(255,255,255,0.22); }
        .lip-price-pro { padding:22px; border-radius:18px; position:relative; overflow:hidden; background:linear-gradient(145deg,rgba(255,215,0,0.06),rgba(249,115,22,0.04)); border:1px solid rgba(255,215,0,0.28); box-shadow:0 0 40px rgba(255,215,0,0.07); transition:all .2s; }
        .lip-price-pro:hover { border-color:rgba(255,215,0,0.5); box-shadow:0 0 60px rgba(255,215,0,0.14); }
      `}</style>

      <div
        style={{ width:isMobile?'100%':'min(900px,96vw)', height:isMobile?'100%':'min(700px,93vh)', background:'#0b0c10', borderRadius:isMobile?'22px 22px 0 0':20, border:`1px solid ${meta.border}`, display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:`0 0 80px ${meta.glow}, 0 32px 80px rgba(0,0,0,0.8)`, animation:isMobile?'lipSlideUp .3s cubic-bezier(0.34,1.1,0.64,1)':'lipSlide .26s cubic-bezier(0.34,1.2,0.64,1)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Top accent line */}
        <div style={{ height:3, background:meta.grad, flexShrink:0 }} />

        {/* Header */}
        <div style={{ padding:isMobile?'14px 16px':'18px 26px', borderBottom:`1px solid ${meta.border.replace('0.35','0.15')}`, display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0, background:'rgba(0,0,0,0.25)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ width:38, height:38, borderRadius:12, background:meta.grad, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, flexShrink:0, boxShadow:`0 4px 16px ${meta.glow}` }}>{meta.icon}</div>
            <div>
              <div style={{ fontFamily:'Syne,system-ui', fontWeight:800, fontSize:isMobile?18:22, color:'#fff', lineHeight:1.1 }}>{meta.title}</div>
              <div style={{ fontSize:11, color:'rgba(255,255,255,0.35)', marginTop:2, fontFamily:'system-ui' }}>
                {page==='features'&&'Cicada Studio — всё что вам нужно для создания бота'}
                {page==='templates'&&'Готовые схемы для быстрого старта'}
                {page==='pricing'&&'Прозрачные тарифы без скрытых условий'}
                {page==='docs'&&'Полная документация по платформе'}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ width:34, height:34, borderRadius:10, border:`1px solid ${meta.border.replace('0.35','0.2')}`, background:'rgba(255,255,255,0.04)', color:'rgba(255,255,255,0.45)', fontSize:18, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', transition:'all .15s', flexShrink:0 }} onMouseEnter={e=>{e.currentTarget.style.background='rgba(255,255,255,0.1)';e.currentTarget.style.color='#fff';}} onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,0.04)';e.currentTarget.style.color='rgba(255,255,255,0.45)';}}>×</button>
        </div>

        {/* Body */}
        <div style={{ flex:1, overflow:'hidden', display:'flex' }}>

          {/* ── FEATURES ── */}
          {page==='features' && (
            <div className="lip-scroll" style={{ flex:1, overflowY:'auto', padding:isMobile?'16px':'26px' }}>
              <p style={{ fontSize:14, color:'rgba(255,255,255,0.55)', lineHeight:1.7, marginBottom:22, marginTop:0, maxWidth:640 }}>
                Cicada Studio — полноценная платформа для создания Telegram-ботов без написания кода вручную. Всё что нужно — собрать схему блоками.
              </p>
              <div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr':'1fr 1fr', gap:12 }}>
                {[
                  { icon:'🧩', title:'Визуальный конструктор', desc:'Собирайте логику бота блоками на холсте. Конструктор сам генерирует DSL-код.', color:'#fbbf24', bg:'rgba(251,191,36,0.1)' },
                  { icon:'🤖', title:'30+ типов блоков', desc:'От простого «Ответ» до HTTP-запросов, условий, сценариев, медиа и AI-классификации.', color:'#3ecf8e', bg:'rgba(62,207,142,0.1)' },
                  { icon:'\u2728', title:'AI-генерация схем', desc:'Опишите задачу — AI предложит готовую структуру бота с нужными блоками и сценариями.', color:'#a78bfa', bg:'rgba(167,139,250,0.1)' },
                  { icon:'🛡', title:'Встроенная валидация', desc:'DSL-валидатор проверяет схему на ошибки до запуска — экономит время на отладку.', color:'#60a5fa', bg:'rgba(96,165,250,0.1)' },
                  { icon:'\u2601\ufe0f', title:'Облачные проекты', desc:'Сохраняйте проекты в облако и открывайте с любого устройства. Синхронизируется автоматически.', color:'#fbbf24', bg:'rgba(251,191,36,0.1)' },
                  { icon:'🎨', title:'Готовые шаблоны', desc:'Библиотека шаблонов для квизов, заявок, меню, интернет-магазинов и типовых задач.', color:'#f87171', bg:'rgba(248,113,113,0.1)' },
                  { icon:'📱', title:'Мобильная версия', desc:'Адаптивный интерфейс позволяет редактировать схемы с телефона или планшета.', color:'#34d399', bg:'rgba(52,211,153,0.1)' },
                  { icon:'\u26a1', title:'Быстрый старт', desc:'Первый рабочий бот за вечер. Установка не нужна — всё работает прямо в браузере.', color:'#fbbf24', bg:'rgba(251,191,36,0.1)' },
                  { icon:'🔗', title:'HTTP-интеграции', desc:'Подключайте внешние API: блок HTTP умеет GET/POST с переменными и обработкой ответа.', color:'#0ea5e9', bg:'rgba(14,165,233,0.1)' },
                  { icon:'🗄', title:'Встроенная база данных', desc:'SQL-блок для хранения данных пользователей, заказов, настроек и других сущностей.', color:'#10b981', bg:'rgba(16,185,129,0.1)' },
                ].map(({ icon, title, desc, color, bg }) => (
                  <div key={title} className="lip-feat-card"
                    onMouseEnter={e=>{e.currentTarget.style.borderColor=color+'55';e.currentTarget.style.boxShadow=`0 8px 28px rgba(0,0,0,0.4), 0 0 20px ${color}18`;}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor='rgba(255,255,255,0.07)';e.currentTarget.style.boxShadow='none';}}
                  >
                    <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:10 }}>
                      <div style={{ width:38, height:38, borderRadius:11, background:bg, border:`1px solid ${color}30`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, flexShrink:0 }}>{icon}</div>
                      <span style={{ fontFamily:'Syne,system-ui', fontWeight:700, fontSize:14, color }}>{title}</span>
                    </div>
                    <p style={{ fontSize:12.5, color:'rgba(255,255,255,0.55)', lineHeight:1.65, margin:0 }}>{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── TEMPLATES ── */}
          {page==='templates' && (
            <div className="lip-scroll" style={{ flex:1, overflowY:'auto', padding:isMobile?'16px':'26px' }}>
              <p style={{ fontSize:14, color:'rgba(255,255,255,0.55)', lineHeight:1.7, marginBottom:22, marginTop:0 }}>
                Готовые схемы ботов для быстрого старта. Выберите шаблон и адаптируйте под свою задачу прямо в конструкторе.
              </p>
              <div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr':'1fr 1fr', gap:12 }}>
                {[
                  { icon:'👋', title:'Приветственный бот', tags:['Старт','Ответ','Кнопки'], desc:'Красивое меню с кнопками навигации. Обработчики для каждой кнопки.', color:'#3ecf8e' },
                  { icon:'\u2753', title:'Квиз / Опрос', tags:['Спросить','Условие','Счётчик'], desc:'Многошаговый квиз с подсчётом баллов и итоговым результатом.', color:'#fbbf24' },
                  { icon:'📝', title:'Сбор заявок', tags:['Спросить','Сохранить','HTTP'], desc:'Форма для сбора данных с сохранением в базу или отправкой на email.', color:'#60a5fa' },
                  { icon:'🛍\ufe0f', title:'Интернет-магазин', tags:['Меню','Кнопки','Оплата'], desc:'Каталог товаров, корзина, оформление заказа и приём оплаты.', color:'#a78bfa' },
                  { icon:'📅', title:'Запись на приём', tags:['Спросить','Inline','БД'], desc:'Выбор даты через inline-кнопки. Запись хранится в базе данных.', color:'#f87171' },
                  { icon:'📣', title:'Рассылка новостей', tags:['Broadcast','Сценарий','Подписка'], desc:'Бот для подписки и управления рассылками. Массовая отправка сообщений.', color:'#fb923c' },
                  { icon:'🎮', title:'Игровой бот', tags:['Рандом','Счётчик','Условие'], desc:'Простая игра с очками, случайными событиями и таблицей лидеров.', color:'#34d399' },
                  { icon:'🤝', title:'Поддержка клиентов', tags:['Классификация','HTTP','Лог'], desc:'AI-классификация обращений, автоответы и переадресация вопросов.', color:'#0ea5e9' },
                ].map(({ icon, title, tags, desc, color }) => (
                  <div key={title} className="lip-tpl-card"
                    onMouseEnter={e=>{e.currentTarget.style.borderColor=color+'44';e.currentTarget.style.boxShadow=`0 8px 28px rgba(0,0,0,0.4), 0 0 16px ${color}18`;}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor='rgba(255,255,255,0.07)';e.currentTarget.style.boxShadow='none';}}
                  >
                    {/* Colour accent bar */}
                    <div style={{ position:'absolute', left:0, top:0, bottom:0, width:3, background:color, borderRadius:'14px 0 0 14px', opacity:0.8 }} />
                    <div style={{ paddingLeft:10 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
                        <span style={{ fontSize:26 }}>{icon}</span>
                        <span style={{ fontFamily:'Syne,system-ui', fontWeight:700, fontSize:14, color:'#fff' }}>{title}</span>
                      </div>
                      <p style={{ fontSize:12.5, color:'rgba(255,255,255,0.5)', lineHeight:1.65, margin:'0 0 10px' }}>{desc}</p>
                      <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                        {tags.map(tag => (
                          <span key={tag} style={{ fontSize:10, padding:'3px 9px', borderRadius:999, background:color+'18', color, border:`1px solid ${color}35`, fontWeight:700, fontFamily:'Syne,system-ui', letterSpacing:'0.04em' }}>{tag}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop:18, padding:'14px 18px', borderRadius:14, background:'rgba(251,191,36,0.05)', border:'1px solid rgba(251,191,36,0.18)', display:'flex', alignItems:'center', gap:14 }}>
                <span style={{ fontSize:22, flexShrink:0 }}>📚</span>
                <div>
                  <div style={{ fontSize:13, color:'rgba(255,255,255,0.75)', fontWeight:600, marginBottom:3, fontFamily:'Syne,system-ui' }}>Шаблоны доступны в конструкторе</div>
                  <div style={{ fontSize:11, color:'rgba(255,255,255,0.35)' }}>Откройте проект → нажмите «Библиотека» в левом меню → вкладка «Шаблоны»</div>
                </div>
              </div>
            </div>
          )}

          {/* ── DOCS ── */}
          {page==='docs' && (
            <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
              {!isMobile && (
                <div style={{ width:200, background:'rgba(0,0,0,0.2)', borderRight:'1px solid rgba(255,255,255,0.07)', overflowY:'auto', flexShrink:0, padding:'12px 8px' }}>
                  {DOC_SECTIONS.map((s,i) => (
                    <button key={i} onClick={()=>setDocsSection(i)} style={{ width:'100%', textAlign:'left', padding:'9px 12px', borderRadius:8, border:'none', background:docsSection===i?'rgba(167,139,250,0.12)':'none', color:docsSection===i?'#a78bfa':'rgba(255,255,255,0.5)', fontSize:12, fontFamily:'system-ui', cursor:'pointer', transition:'all .15s', marginBottom:2 }} onMouseEnter={e=>{if(docsSection!==i)e.currentTarget.style.background='rgba(255,255,255,0.05)';}} onMouseLeave={e=>{if(docsSection!==i)e.currentTarget.style.background='none';}}>{s.label}</button>
                  ))}
                </div>
              )}
              <div className="lip-scroll" style={{ flex:1, overflowY:'auto', padding:isMobile?'14px':'20px 24px' }}>
                {isMobile && (
                  <div style={{ display:'flex', gap:6, overflowX:'auto', marginBottom:14, paddingBottom:6 }}>
                    {DOC_SECTIONS.map((s,i) => (
                      <button key={i} onClick={()=>setDocsSection(i)} style={{ flexShrink:0, padding:'6px 12px', borderRadius:8, border:`1px solid ${docsSection===i?'rgba(167,139,250,0.4)':'rgba(255,255,255,0.1)'}`, background:docsSection===i?'rgba(167,139,250,0.1)':'none', color:docsSection===i?'#a78bfa':'rgba(255,255,255,0.5)', fontSize:11, cursor:'pointer', whiteSpace:'nowrap' }}>{s.label}</button>
                    ))}
                  </div>
                )}
                {DOC_SECTIONS[docsSection]?.content}
              </div>
            </div>
          )}

          {/* ── PRICING ── */}
          {page==='pricing' && (
            <div className="lip-scroll" style={{ flex:1, overflowY:'auto', padding:isMobile?'16px':'26px' }}>
              <p style={{ fontSize:14, color:'rgba(255,255,255,0.55)', lineHeight:1.7, marginBottom:24, marginTop:0 }}>
                Начните бесплатно, а при росте — переходите на Pro. Без скрытых комиссий, без ограничений по времени.
              </p>
              <div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr':'1fr 1fr', gap:16, marginBottom:24 }}>
                {/* FREE */}
                <div className="lip-price-free">
                  <div style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'4px 12px', borderRadius:999, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', marginBottom:14 }}>
                    <span style={{ fontSize:10, fontWeight:800, color:'rgba(255,255,255,0.5)', fontFamily:'Syne,system-ui', letterSpacing:'0.08em' }}>FREE</span>
                  </div>
                  <div style={{ display:'flex', alignItems:'flex-end', gap:6, marginBottom:6 }}>
                    <span style={{ fontFamily:'Syne,system-ui', fontWeight:900, fontSize:42, color:'#fff', lineHeight:1 }}>$0</span>
                    <span style={{ fontSize:14, color:'rgba(255,255,255,0.35)', paddingBottom:6 }}>/мес</span>
                  </div>
                  <div style={{ fontSize:12, color:'rgba(255,255,255,0.3)', marginBottom:20 }}>Всегда бесплатно. Навсегда.</div>
                  <div style={{ height:1, background:'rgba(255,255,255,0.07)', marginBottom:18 }} />
                  <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:20 }}>
                    {[
                      [true,'1 проект в облаке'],
                      [true,'Все базовые блоки (30+)'],
                      [false,'Скачивание .ccd файлов'],
                      [true,'DSL-валидатор'],
                      [true,'Запуск бота в браузере'],
                      [false,'AI-генерация схем'],
                      [false,'Безлимитные проекты'],
                      [false,'Приоритетная поддержка'],
                    ].map(([ok, text]) => (
                      <div key={text} style={{ display:'flex', gap:10, alignItems:'center', fontSize:13, color:ok?'rgba(255,255,255,0.75)':'rgba(255,255,255,0.25)' }}>
                        <div style={{ width:18, height:18, borderRadius:6, background:ok?'rgba(62,207,142,0.15)':'rgba(255,255,255,0.04)', border:`1px solid ${ok?'rgba(62,207,142,0.3)':'rgba(255,255,255,0.1)'}`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontSize:10 }}>{ok?'✓':'–'}</div>
                        <span>{text}</span>
                      </div>
                    ))}
                  </div>
                  <button style={{ width:'100%', padding:'11px', borderRadius:10, border:'1px solid rgba(255,255,255,0.15)', background:'rgba(255,255,255,0.05)', color:'rgba(255,255,255,0.7)', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'Syne,system-ui', transition:'all .2s' }} onMouseEnter={e=>{e.currentTarget.style.background='rgba(255,255,255,0.1)';e.currentTarget.style.color='#fff';}} onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,0.05)';e.currentTarget.style.color='rgba(255,255,255,0.7)';}}>Начать бесплатно</button>
                </div>
                {/* PRO */}
                <div className="lip-price-pro">
                  <div style={{ position:'absolute', top:0, right:0, padding:'5px 14px', borderRadius:'0 18px 0 12px', background:'linear-gradient(135deg,#ffd700,#ffaa00)', fontSize:10, fontWeight:900, color:'#111', fontFamily:'Syne,system-ui', letterSpacing:'0.08em' }}>★ ПОПУЛЯРНЫЙ</div>
                  <div style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'4px 12px', borderRadius:999, background:'rgba(255,215,0,0.12)', border:'1px solid rgba(255,215,0,0.3)', marginBottom:14 }}>
                    <span style={{ fontSize:10, fontWeight:800, color:'#ffd700', fontFamily:'Syne,system-ui', letterSpacing:'0.08em' }}>PRO</span>
                  </div>
                  <div style={{ display:'flex', alignItems:'flex-end', gap:6, marginBottom:6 }}>
                    <span style={{ fontFamily:'Syne,system-ui', fontWeight:900, fontSize:42, color:'#ffd700', lineHeight:1 }}>$8</span>
                    <span style={{ fontSize:14, color:'rgba(255,215,0,0.45)', paddingBottom:6 }}>/мес</span>
                  </div>
                  <div style={{ fontSize:12, color:'rgba(255,215,0,0.4)', marginBottom:20 }}>Всё для профессиональной работы</div>
                  <div style={{ height:1, background:'rgba(255,215,0,0.15)', marginBottom:18 }} />
                  <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:20 }}>
                    {[
                      'Безлимитные проекты',
                      'Все блоки без ограничений',
                      'AI-генерация схем',
                      'Скачивание .ccd файлов',
                      'Запуск бота в браузере',
                      'DSL-валидатор + расширенная отладка',
                      'Приоритетная поддержка 24/7',
                      'Ранний доступ к новым функциям',
                      'Визуальный Preview-чат бота',
                    ].map(text => (
                      <div key={text} style={{ display:'flex', gap:10, alignItems:'center', fontSize:13, color:'rgba(255,255,255,0.8)' }}>
                        <div style={{ width:18, height:18, borderRadius:6, background:'rgba(62,207,142,0.15)', border:'1px solid rgba(62,207,142,0.35)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontSize:10, color:'#3ecf8e' }}>✓</div>
                        <span>{text}</span>
                      </div>
                    ))}
                  </div>
                  <button style={{ width:'100%', padding:'12px', borderRadius:10, border:'none', background:'linear-gradient(135deg,#ffd700,#ffaa00)', color:'#111', fontSize:13, fontWeight:800, cursor:'pointer', fontFamily:'Syne,system-ui', boxShadow:'0 4px 20px rgba(255,215,0,0.3)', transition:'all .2s' }} onMouseEnter={e=>{e.currentTarget.style.filter='brightness(1.08)';e.currentTarget.style.boxShadow='0 6px 28px rgba(255,215,0,0.45)';e.currentTarget.style.transform='translateY(-1px)';}} onMouseLeave={e=>{e.currentTarget.style.filter='none';e.currentTarget.style.boxShadow='0 4px 20px rgba(255,215,0,0.3)';e.currentTarget.style.transform='none';}}>Выбрать Pro →</button>
                </div>
              </div>
              {/* FAQ */}
              <div>
                <div style={{ fontSize:12, fontWeight:700, color:'rgba(255,255,255,0.35)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:12, fontFamily:'Syne,system-ui' }}>Частые вопросы</div>
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {[
                    ['Можно ли отменить подписку?','Да, в любой момент. Доступ к Pro-функциям сохраняется до конца оплаченного периода.'],
                    ['Есть ли бесплатный период для Pro?','Новые пользователи получают 3 дня Pro-доступа сразу после регистрации.'],
                    ['Какие способы оплаты принимаются?','Оплата через криптовалюту: USDT, TRX, LTC. Безопасно и без посредников.'],
                    ['Что будет с проектами при переходе на Free?','Проекты сохранятся. Доступен только 1 проект для редактирования.'],
                  ].map(([q,a]) => (
                    <div key={q} style={{ padding:'13px 16px', borderRadius:12, background:'rgba(255,255,255,0.025)', border:'1px solid rgba(255,255,255,0.07)', transition:'border-color .2s' }} onMouseEnter={e=>e.currentTarget.style.borderColor='rgba(255,255,255,0.14)'} onMouseLeave={e=>e.currentTarget.style.borderColor='rgba(255,255,255,0.07)'}>
                      <div style={{ fontSize:13, fontWeight:700, color:'rgba(255,255,255,0.88)', marginBottom:6, fontFamily:'Syne,system-ui' }}>{q}</div>
                      <div style={{ fontSize:12, color:'rgba(255,255,255,0.45)', lineHeight:1.6 }}>{a}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

function TwoFASettingsCard({ user, onUpdateUser, showToast }) {
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const loadSetup = async () => {
    try { setBusy(true); const data = await fetch2FASetup(user.id); setSetup(data); }
    catch (e) { showToast('Ошибка 2FA: ' + (e.message || 'unknown'), 'error'); }
    finally { setBusy(false); }
  };

  const handleEnable = async () => {
    try { setBusy(true); const r = await enable2FA(user.id, code); await onUpdateUser({ _silent: true, ...r.user }); showToast('2FA включена', 'success'); }
    catch (e) { showToast(e.message || 'Ошибка включения 2FA', 'error'); }
    finally { setBusy(false); }
  };
  const handleDisable = async () => {
    try { setBusy(true); const r = await disable2FA(user.id, code); await onUpdateUser({ _silent: true, ...r.user }); showToast('2FA выключена', 'success'); }
    catch (e) { showToast(e.message || 'Ошибка отключения 2FA', 'error'); }
    finally { setBusy(false); }
  };

  return (<div style={{ background:'rgba(255,255,255,0.025)', border:'1px solid rgba(255,255,255,0.09)', borderRadius:14, padding:16 }}>
    <div style={{ fontSize:12, fontWeight:700, color:'#fff', marginBottom:8 }}>Двухфакторная аутентификация (Google Authenticator)</div>
    <div style={{ fontSize:11, color:'rgba(255,255,255,0.5)', lineHeight:1.6, marginBottom:10 }}>Нажмите «Получить QR», отсканируйте код в Google Authenticator и введите 6-значный код для подтверждения.</div>
    <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:10 }}>
      <button onClick={loadSetup} disabled={busy} style={{ padding:'9px 12px', borderRadius:10, border:'1px solid rgba(99,102,241,0.4)', background:'rgba(99,102,241,0.14)', color:'#a5b4fc', cursor:'pointer' }}>{busy ? '...' : 'Получить QR'}</button>
      <input value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder='000000' style={{ padding:'9px 12px', borderRadius:10, border:'1px solid rgba(255,255,255,0.15)', background:'rgba(255,255,255,0.03)', color:'#fff', width:120 }} />
      {!user.twofaEnabled ? <button onClick={handleEnable} disabled={busy || code.length<6} style={{ padding:'9px 12px', borderRadius:10, border:'none', background:'linear-gradient(135deg,#3ecf8e,#0ea5e9)', color:'#111', cursor:'pointer' }}>Включить 2FA</button> : <button onClick={handleDisable} disabled={busy || code.length<6} style={{ padding:'9px 12px', borderRadius:10, border:'1px solid rgba(248,113,113,0.3)', background:'rgba(248,113,113,0.09)', color:'#f87171', cursor:'pointer' }}>Выключить 2FA</button>}
    </div>
    {setup?.qrUrl && <img src={setup.qrUrl} alt='2FA QR' style={{ width:180, height:180, borderRadius:12, border:'1px solid rgba(255,255,255,0.12)' }} />}
  </div>);
}

function AuthModal({ tab, setTab, onClose, onLogin, onRegister, canClose = true, forceTotp = false }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [focusedField, setFocusedField] = useState(null);
  const canvasRef = React.useRef(null);
  useParticleCanvas(canvasRef);
  // screen: 'form' | 'verify-sent' | 'forgot' | 'reset' | 'reset-done'
  const [screen, setScreen] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('reset') ? 'reset' : 'form';
  });
  /** Зачем показан экран verify-sent: 'register' | 'forgot' | null */
  const [verifyReason, setVerifyReason] = useState(null);
  const [totpRequired, setTotpRequired] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [resetToken] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('reset') || '';
  });

  const validate = () => {
    const e = {};
    if (!email || !email.includes('@')) e.email = 'Введите корректный email';
    if (!password || password.length < 6) e.password = 'Минимум 6 символов';
    if (tab === 'register' && !name.trim()) e.name = 'Введите имя';
    if (tab === 'register' && password !== confirmPassword) e.confirmPassword = 'Пароли не совпадают';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setServerError('');
    if (!validate()) return;
    setLoading(true);
    try {
      if (tab === 'login') {
        await onLogin(email, password, totpCode);
      } else {
        const result = await onRegister(name, email, password);
        if (result && result.needVerify) {
          setVerifyReason('register');
          setScreen('verify-sent');
          fireRegistrationConfetti();
        }
      }
    } catch (err) {
      if (err?.twofaRequired) {
        setTotpRequired(true);
        setServerError('Введите код из Google Authenticator');
      } else {
        setServerError(translateServerError(err.message));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e) => {
    e.preventDefault();
    setServerError('');
    if (!email || !email.includes('@')) { setErrors({ email: 'Введите корректный email' }); return; }
    setLoading(true);
    try {
      await forgotPassword(email);
      setVerifyReason('forgot');
      setScreen('verify-sent');
    } catch (err) {
      if (err?.twofaRequired) {
        setTotpRequired(true);
        setServerError('Введите код из Google Authenticator');
      } else {
        setServerError(translateServerError(err.message));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e) => {
    e.preventDefault();
    setServerError('');
    if (!password || password.length < 6) { setErrors({ password: 'Минимум 6 символов' }); return; }
    if (password !== confirmPassword) { setErrors({ confirmPassword: 'Пароли не совпадают' }); return; }
    setLoading(true);
    try {
      await resetPassword(resetToken, password);
      // Clean URL
      window.history.replaceState({}, '', '/');
      setScreen('reset-done');
    } catch (err) {
      if (err?.twofaRequired) {
        setTotpRequired(true);
        setServerError('Введите код из Google Authenticator');
      } else {
        setServerError(translateServerError(err.message));
      }
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = (field) => ({
    width: '100%',
    padding: '13px 16px',
    fontSize: 14,
    background: focusedField === field ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.03)',
    color: 'var(--text)',
    border: `1.5px solid ${errors[field] ? '#f87171' : focusedField === field ? '#ffd700' : 'rgba(255,255,255,0.1)'}`,
    borderRadius: 12,
    outline: 'none',
    transition: 'all 0.2s ease',
    fontFamily: 'var(--mono)',
    letterSpacing: '0.3px',
    boxSizing: 'border-box',
  });

  const labelStyle = {
    display: 'block',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text2)',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    fontFamily: 'Syne, system-ui',
  };

  const iconStyle = { position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.35)', pointerEvents: 'none', display: 'flex', alignItems: 'center' };

  const fieldInput = (field, extra = {}) => ({
    width: '100%',
    padding: '14px 14px 14px 44px',
    fontSize: 14,
    background: focusedField === field ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)',
    color: '#fff',
    border: `1.5px solid ${errors[field] ? '#f87171' : focusedField === field ? 'rgba(255,100,30,0.6)' : 'rgba(255,255,255,0.1)'}`,
    borderRadius: 12,
    outline: 'none',
    transition: 'all 0.2s',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    boxShadow: focusedField === field ? '0 0 0 3px rgba(255,100,30,0.1), 0 0 16px rgba(255,100,30,0.07)' : 'none',
    ...extra,
  });

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
        background: 'linear-gradient(135deg, #0a0a0f 0%, #0d0f1a 40%, #0a0e1a 70%, #080b14 100%)',
        animation: 'amFadeIn 0.2s ease',
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes amFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes amSlideUp { from { opacity: 0; transform: translateY(24px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes cornerGlow { 0%,100%{opacity:0.6} 50%{opacity:1} }
        @keyframes regBannerPop { from { opacity: 0; transform: translateY(-12px) scale(0.96) } to { opacity: 1; transform: translateY(0) scale(1) } }
        @keyframes amOrb1 { 0%,100%{transform:scale(1) translate(0,0);opacity:.7} 50%{transform:scale(1.15) translate(30px,-20px);opacity:1} }
        @keyframes amOrb2 { 0%,100%{transform:scale(1) translate(0,0);opacity:.5} 50%{transform:scale(1.2) translate(-25px,15px);opacity:.85} }
        .am-input-wrap input::placeholder { color: rgba(255,255,255,0.28); }
        .am-input-wrap input { caret-color: #f97316; }
        .am-social-btn { flex:1; display:flex; align-items:center; justify-content:center; gap:9px; padding:13px 14px; border-radius:12px; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.04); color:rgba(255,255,255,0.85); font-family:inherit; font-weight:500; font-size:14px; cursor:pointer; transition:all .2s; }
        .am-social-btn:hover { background:rgba(255,255,255,0.08); border-color:rgba(255,255,255,0.2); transform:translateY(-1px); }
        .am-tg-btn { background:rgba(33,150,243,0.07) !important; border-color:rgba(33,150,243,0.25) !important; }
        .am-tg-btn:hover { background:rgba(33,150,243,0.14) !important; border-color:rgba(33,150,243,0.45) !important; }
      `}</style>

      {/* Particle canvas background */}
      <canvas ref={canvasRef} style={{ position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none' }} />
      {/* Ambient depth orbs (layered over canvas) */}
      <div style={{ position:'absolute', top:'8%', left:'12%', width:520, height:520, borderRadius:'50%', background:'radial-gradient(circle,rgba(255,90,20,0.1) 0%,transparent 70%)', filter:'blur(50px)', animation:'amOrb1 9s ease-in-out infinite', pointerEvents:'none' }} />
      <div style={{ position:'absolute', bottom:'10%', right:'8%', width:440, height:440, borderRadius:'50%', background:'radial-gradient(circle,rgba(110,50,240,0.08) 0%,transparent 70%)', filter:'blur(55px)', animation:'amOrb2 11s ease-in-out infinite', pointerEvents:'none' }} />
      {/* Grid overlay */}
      <div style={{ position:'absolute', inset:0, pointerEvents:'none', backgroundImage:'linear-gradient(rgba(255,255,255,0.012) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.012) 1px,transparent 1px)', backgroundSize:'64px 64px' }} />

      <div
        style={{
          width: 'min(440px, 100%)',
          maxHeight: '96vh',
          overflowY: 'auto',
          background: 'linear-gradient(160deg, rgba(22,22,35,0.97) 0%, rgba(16,16,26,0.99) 100%)',
          borderRadius: 22,
          border: '1px solid rgba(255,255,255,0.07)',
          boxShadow: '0 0 0 1px rgba(255,100,30,0.15), 0 32px 80px rgba(0,0,0,0.7), 0 0 60px rgba(255,80,20,0.07), inset 0 1px 0 rgba(255,255,255,0.06)',
          animation: 'amSlideUp 0.45s cubic-bezier(0.16,1,0.3,1)',
          position: 'relative',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Corner accents */}
        {[{t:0,l:0,bt:'borderTop',bl:'borderLeft',br2:'4px 0 0 0'},{t:0,r:0,bt:'borderTop',bl:'borderRight',br2:'0 4px 0 0'},{b:0,l:0,bt:'borderBottom',bl:'borderLeft',br2:'0 0 0 4px'},{b:0,r:0,bt:'borderBottom',bl:'borderRight',br2:'0 0 4px 0'}].map((c,i) => (
          <div key={i} style={{ position:'absolute', top:c.t!==undefined?-2:'auto', bottom:c.b!==undefined?-2:'auto', left:c.l!==undefined?-2:'auto', right:c.r!==undefined?-2:'auto', width:18, height:18, borderTop:c.bt==='borderTop'?'2px solid rgba(255,100,30,0.65)':'none', borderBottom:c.bt==='borderBottom'?'2px solid rgba(255,100,30,0.65)':'none', borderLeft:c.bl==='borderLeft'?'2px solid rgba(255,100,30,0.65)':'none', borderRight:c.bl==='borderRight'?'2px solid rgba(255,100,30,0.65)':'none', borderRadius:c.br2, animation:'cornerGlow 2.5s ease-in-out infinite', animationDelay:`${i*0.4}s` }} />
        ))}
        {/* Header */}
        <div style={{ padding: '32px 32px 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ position: 'relative', marginBottom: 14 }}>
            <div style={{ position:'absolute', inset:-8, borderRadius:'50%', background:'radial-gradient(circle,rgba(255,100,30,0.22) 0%,transparent 70%)', filter:'blur(8px)' }} />
            <div style={{ width:72, height:72, borderRadius:18, background:'linear-gradient(135deg,rgba(255,100,30,0.12),rgba(50,30,80,0.25))', border:'1px solid rgba(255,100,30,0.28)', display:'flex', alignItems:'center', justifyContent:'center', position:'relative', boxShadow:'0 8px 28px rgba(255,80,20,0.18)' }}>
              <img src={cicadaLogo} alt="Cicada Studio" style={{ width: 54, height: 54, objectFit: 'cover', borderRadius: 12 }} />
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'baseline', gap:7, marginBottom:6 }}>
            <span style={{ fontFamily:'Syne,system-ui', fontWeight:800, fontSize:22, letterSpacing:'-0.02em', background:'linear-gradient(135deg,#fff 40%,rgba(255,255,255,0.7))', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>CiCCaDa</span>
            <span style={{ fontSize:13, fontWeight:400, color:'rgba(255,255,255,0.38)', letterSpacing:'2px', textTransform:'uppercase' }}>Studio</span>
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.32)', letterSpacing: '0.02em' }}>
            Добро пожаловать
          </div>
        </div>

        {/* Tab switcher */}
        {screen === 'form' && (
          <div style={{ padding: '0 28px 22px' }}>
            <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 4, border: '1px solid rgba(255,255,255,0.07)', position: 'relative' }}>
              {/* Sliding indicator */}
              <div style={{ position:'absolute', top:4, bottom:4, left: tab==='login' ? 4 : 'calc(50% + 2px)', width:'calc(50% - 6px)', background:'linear-gradient(135deg,rgba(255,90,20,0.92),rgba(220,50,0,0.92))', borderRadius:9, transition:'left 0.25s cubic-bezier(0.4,0,0.2,1)', boxShadow:'0 2px 12px rgba(255,80,20,0.35)', pointerEvents:'none' }} />
              {[['login', 'Войти'], ['register', 'Регистрация']].map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => { setTab(val); setErrors({}); setServerError(''); }}
                  style={{ flex: 1, padding: '11px 16px', fontSize: 14, fontWeight: 500, fontFamily: 'inherit', background: 'transparent', color: tab === val ? '#fff' : 'rgba(255,255,255,0.4)', border: 'none', borderRadius: 9, cursor: 'pointer', transition: 'color 0.2s', position: 'relative', zIndex: 1 }}
                >{label}</button>
              ))}
            </div>

            {tab === 'login' && totpRequired && (
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'Syne,system-ui' }}>КОД 2FA</label>
                <div style={{ position: 'relative' }} className="am-input-wrap">
                  <span style={iconStyle}>🛡</span>
                  <input type="text" value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g,'').slice(0,6))} onFocus={() => setFocusedField('totp')} onBlur={() => setFocusedField(null)} style={fieldInput('totp')} placeholder="000000" autoComplete="one-time-code" />
                </div>
              </div>
            )}

            {tab === 'register' && (
              <div style={{
                marginTop: 12,
                padding: '10px 12px',
                borderRadius: 11,
                background: 'rgba(251,191,36,0.08)',
                border: '1px solid rgba(251,191,36,0.28)',
                fontSize: 12,
                color: '#fde68a',
                textAlign: 'center',
                lineHeight: 1.45,
                fontFamily: 'system-ui',
              }}>
                <strong style={{ color: '#fbbf24' }}>3 дня PRO</strong> бесплатно сразу после регистрации
              </div>
            )}
          </div>
        )}

        {/* ── verify-sent ── */}
        {screen === 'verify-sent' && (
          <div style={{ padding: '0 32px 36px', textAlign: 'center' }}>
            {verifyReason === 'register' && (
              <div
                style={{
                  marginBottom: 22,
                  padding: '16px 18px',
                  borderRadius: 16,
                  background: 'linear-gradient(135deg, rgba(251,191,36,0.22), rgba(245,158,11,0.1))',
                  border: '1px solid rgba(251,191,36,0.5)',
                  boxShadow: '0 12px 40px rgba(245,158,11,0.12), inset 0 1px 0 rgba(255,255,255,0.06)',
                  animation: 'regBannerPop 0.55s cubic-bezier(0.34,1.45,0.64,1) both',
                }}
              >
                <div style={{ fontSize: 17, fontWeight: 800, fontFamily: 'Syne, system-ui', color: '#fde68a', marginBottom: 8, letterSpacing: '-0.02em' }}>
                  🎉 3 дня PRO бесплатно!
                </div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.58)', lineHeight: 1.55 }}>
                  Тариф уже привязан к аккаунту. Подтверди email — и заходи в студию с полным PRO.
                </div>
              </div>
            )}
            <div style={{ fontSize: 48, marginBottom: 16 }}>📬</div>
            <div style={{ fontFamily: 'Syne,system-ui', fontWeight: 700, fontSize: 16, color: '#fff', marginBottom: 12 }}>Проверьте почту</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6, marginBottom: 24 }}>
              Мы отправили письмо на <span style={{ color: '#ffd700' }}>{email}</span>.{' '}
              Перейдите по ссылке в письме, чтобы{verifyReason === 'register' ? ' подтвердить email и войти.' : ' сбросить пароль.'}
            </div>
            <button
              onClick={() => { setVerifyReason(null); setScreen('form'); setTab('login'); }}
              style={{ fontSize: 13, background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', textDecoration: 'underline' }}
            >← Вернуться к входу</button>
          </div>
        )}

        {/* ── forgot ── */}
        {screen === 'forgot' && (
          <form onSubmit={handleForgot} style={{ padding: '0 28px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>Введите email вашего аккаунта — мы пришлём ссылку для сброса пароля.</div>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'Syne,system-ui' }}>EMAIL</label>
              <div style={{ position: 'relative' }} className="am-input-wrap">
                <span style={iconStyle}>✉</span>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} onFocus={() => setFocusedField('email')} onBlur={() => setFocusedField(null)} style={fieldInput('email')} placeholder="your@email.com" />
              </div>
              {errors.email && <div style={{ fontSize: 11, color: '#f87171', marginTop: 6 }}>⚠ {errors.email}</div>}
            </div>
            {serverError && <div style={{ padding: '10px 14px', background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 10, fontSize: 12, color: '#f87171', textAlign: 'center' }}>⚠ {serverError}</div>}
            <button type="submit" disabled={loading} style={{ width: '100%', padding: '15px 20px', fontSize: 14, fontWeight: 700, fontFamily: 'Syne,system-ui', background: loading ? 'rgba(249,115,22,0.4)' : 'linear-gradient(135deg,#f97316,#dc2626)', color: '#fff', border: 'none', borderRadius: 12, cursor: loading ? 'not-allowed' : 'pointer', boxShadow: '0 8px 28px rgba(249,115,22,0.4)', letterSpacing: '0.02em' }}>
              {loading ? 'Отправляем...' : '→ Отправить ссылку'}
            </button>
            <div style={{ textAlign: 'center' }}>
              <button onClick={() => { setScreen('form'); setErrors({}); setServerError(''); }} type="button" style={{ fontSize: 13, background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', textDecoration: 'underline' }}>← Вернуться к входу</button>
            </div>
          </form>
        )}

        {/* ── reset ── */}
        {screen === 'reset' && (
          <form onSubmit={handleReset} style={{ padding: '0 28px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>Введите новый пароль для вашего аккаунта.</div>
            {[['password','Новый пароль','Минимум 6 символов',password,setPassword],['confirmPassword','Повторите пароль','Повторите пароль',confirmPassword,setConfirmPassword]].map(([f,lbl,ph,val,setter]) => (
              <div key={f}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'Syne,system-ui' }}>{lbl}</label>
                <div style={{ position: 'relative' }} className="am-input-wrap">
                  <span style={iconStyle}>🔒</span>
                  <input type={showPass ? 'text' : 'password'} value={val} onChange={e => setter(e.target.value)} onFocus={() => setFocusedField(f)} onBlur={() => setFocusedField(null)} style={fieldInput(f)} placeholder={ph} />
                </div>
                {errors[f] && <div style={{ fontSize: 11, color: '#f87171', marginTop: 6 }}>⚠ {errors[f]}</div>}
              </div>
            ))}
            {serverError && <div style={{ padding: '10px 14px', background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 10, fontSize: 12, color: '#f87171', textAlign: 'center' }}>⚠ {serverError}</div>}
            <button type="submit" disabled={loading} style={{ width: '100%', padding: '15px', fontSize: 14, fontWeight: 700, fontFamily: 'Syne,system-ui', background: loading ? 'rgba(249,115,22,0.4)' : 'linear-gradient(135deg,#f97316,#dc2626)', color: '#fff', border: 'none', borderRadius: 12, cursor: loading ? 'not-allowed' : 'pointer', boxShadow: '0 8px 28px rgba(249,115,22,0.4)', letterSpacing: '0.02em' }}>
              {loading ? 'Сохраняем...' : '✓ Сохранить пароль'}
            </button>
          </form>
        )}

        {/* ── reset-done ── */}
        {screen === 'reset-done' && (
          <div style={{ padding: '0 32px 36px', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <div style={{ fontFamily: 'Syne,system-ui', fontWeight: 700, fontSize: 16, color: '#fff', marginBottom: 12 }}>Пароль изменён!</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6, marginBottom: 24 }}>Теперь вы можете войти с новым паролем.</div>
            <button onClick={() => { setScreen('form'); setTab('login'); setPassword(''); setConfirmPassword(''); }} style={{ padding: '12px 28px', background: 'linear-gradient(135deg,#f97316,#dc2626)', color: '#fff', fontWeight: 700, fontSize: 14, border: 'none', borderRadius: 12, cursor: 'pointer', boxShadow: '0 6px 20px rgba(249,115,22,0.4)' }}>→ Войти</button>
          </div>
        )}

        {/* ── Main form ── */}
        {screen === 'form' && (
          <form onSubmit={handleSubmit} style={{ padding: '0 28px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>


            {tab === 'login' && totpRequired && (
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'Syne,system-ui' }}>КОД 2FA</label>
                <div style={{ position: 'relative' }} className="am-input-wrap">
                  <span style={iconStyle}>🛡</span>
                  <input type="text" value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g,'').slice(0,6))} onFocus={() => setFocusedField('totp')} onBlur={() => setFocusedField(null)} style={fieldInput('totp')} placeholder="000000" autoComplete="one-time-code" />
                </div>
              </div>
            )}

            {tab === 'register' && (
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'Syne,system-ui' }}>ИМЯ</label>
                <div style={{ position: 'relative' }} className="am-input-wrap">
                  <span style={iconStyle}>👤</span>
                  <input type="text" value={name} onChange={e => setName(e.target.value)} onFocus={() => setFocusedField('name')} onBlur={() => setFocusedField(null)} style={fieldInput('name')} placeholder="Ваше имя" autoComplete="name" />
                </div>
                {errors.name && <div style={{ fontSize: 11, color: '#f87171', marginTop: 6 }}>⚠ {errors.name}</div>}
              </div>
            )}

            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'Syne,system-ui' }}>EMAIL</label>
              <div style={{ position: 'relative' }} className="am-input-wrap">
                <span style={iconStyle}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/></svg>
                </span>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} onFocus={() => setFocusedField('email')} onBlur={() => setFocusedField(null)} style={fieldInput('email')} placeholder="your@email.com" autoComplete="email" />
              </div>
              {errors.email && <div style={{ fontSize: 11, color: '#f87171', marginTop: 6 }}>⚠ {errors.email}</div>}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'Syne,system-ui' }}>ПАРОЛЬ</label>
              <div style={{ position: 'relative' }} className="am-input-wrap">
                <span style={iconStyle}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                </span>
                <input type={showPass ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} onFocus={() => setFocusedField('password')} onBlur={() => setFocusedField(null)} style={fieldInput('password', { paddingRight: 46 })} placeholder="Минимум 6 символов" autoComplete={tab === 'login' ? 'current-password' : 'new-password'} />
                <button type="button" onClick={() => setShowPass(v => !v)} style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: showPass ? '#ffd700' : 'rgba(255,255,255,0.3)', transition: 'color .2s', display: 'flex', alignItems: 'center' }}>
                  {showPass
                    ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  }
                </button>
              </div>
              {errors.password && <div style={{ fontSize: 11, color: '#f87171', marginTop: 6 }}>⚠ {errors.password}</div>}
            </div>


            {tab === 'login' && totpRequired && (
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'Syne,system-ui' }}>КОД 2FA</label>
                <div style={{ position: 'relative' }} className="am-input-wrap">
                  <span style={iconStyle}>🛡</span>
                  <input type="text" value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g,'').slice(0,6))} onFocus={() => setFocusedField('totp')} onBlur={() => setFocusedField(null)} style={fieldInput('totp')} placeholder="000000" autoComplete="one-time-code" />
                </div>
              </div>
            )}

            {tab === 'register' && (
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'Syne,system-ui' }}>ПОВТОРИТЕ ПАРОЛЬ</label>
                <div style={{ position: 'relative' }} className="am-input-wrap">
                  <span style={iconStyle}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  </span>
                  <input type={showPass ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} onFocus={() => setFocusedField('confirmPassword')} onBlur={() => setFocusedField(null)} style={fieldInput('confirmPassword')} placeholder="Повторите пароль" autoComplete="new-password" />
                </div>
                {errors.confirmPassword && <div style={{ fontSize: 11, color: '#f87171', marginTop: 6 }}>⚠ {errors.confirmPassword}</div>}
              </div>
            )}

            {/* Remember me + Forgot password row (login only) */}
            {tab === 'login' && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: -2 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <div style={{ width: 18, height: 18, borderRadius: 5, background: 'linear-gradient(135deg,#ffd700,#ffaa00)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="11" height="9" viewBox="0 0 11 9" fill="none"><path d="M1 4.5L4 7.5L10 1" stroke="#111" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </div>
                  <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', fontFamily: 'system-ui' }}>Запомнить меня</span>
                </label>
                <button type="button" onClick={() => { setScreen('forgot'); setErrors({}); setServerError(''); }} style={{ fontSize: 13, background: 'none', border: 'none', color: 'rgba(255,215,0,0.8)', cursor: 'pointer', padding: 0, textDecoration: 'underline', textDecorationStyle: 'dashed', textUnderlineOffset: 3 }}>Забыли пароль?</button>
              </div>
            )}

            {serverError && (
              <div style={{ padding: '10px 14px', background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 10, fontSize: 12, color: '#f87171', textAlign: 'center' }}>⚠ {serverError}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{ width: '100%', padding: '15px 20px', fontSize: 15, fontWeight: 600, fontFamily: 'inherit', background: loading ? 'rgba(249,115,22,0.35)' : 'linear-gradient(135deg,#ff5c1a 0%,#dc2626 100%)', color: '#fff', border: 'none', borderRadius: 12, cursor: loading ? 'not-allowed' : 'pointer', transition: 'all 0.2s', boxShadow: loading ? 'none' : '0 4px 24px rgba(255,80,20,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, letterSpacing: '0.02em', position: 'relative', overflow: 'hidden' }}
              onMouseEnter={e => { if (!loading) { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(255,80,20,0.55)'; } }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = loading ? 'none' : '0 4px 24px rgba(255,80,20,0.4)'; }}
            >
              {loading
                ? <><div style={{ width: 16, height: 16, border: '2.5px solid rgba(255,255,255,0.25)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />{tab === 'login' ? 'Входим...' : 'Создаём...'}</>
                : (tab === 'login' ? '→ Войти в аккаунт' : '✦ Создать аккаунт')
              }
            </button>

            {tab === 'login' && (
              <div style={{ textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,0.3)' }}>
                Нет аккаунта?{' '}
                <span onClick={() => setTab('register')} style={{ color: '#ffd700', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}>Зарегистрируйтесь</span>
              </div>
            )}

            {tab === 'login' && totpRequired && (
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'Syne,system-ui' }}>КОД 2FA</label>
                <div style={{ position: 'relative' }} className="am-input-wrap">
                  <span style={iconStyle}>🛡</span>
                  <input type="text" value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g,'').slice(0,6))} onFocus={() => setFocusedField('totp')} onBlur={() => setFocusedField(null)} style={fieldInput('totp')} placeholder="000000" autoComplete="one-time-code" />
                </div>
              </div>
            )}

            {tab === 'register' && (
              <div style={{ textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,0.3)' }}>
                Уже есть аккаунт?{' '}
                <span onClick={() => setTab('login')} style={{ color: '#ffd700', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}>Войти</span>
              </div>
            )}

            {/* OR divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 2 }}>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', fontFamily: 'system-ui', letterSpacing: '0.08em' }}>или войти через</span>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
            </div>

            {/* OAuth buttons — side by side */}
            <div style={{ display: 'flex', gap: 10 }}>
              <GoogleLoginButton />
              <TelegramLoginButton onLogin={onLogin} />
            </div>

          </form>
        )}

        {/* bottom padding */}
        {screen !== 'form' && <div style={{ height: 4 }} />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SUBSCRIPTION TAB COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_PLANS = [
  { key: '2w', label: '2 недели',  days: 14,  usd: 5  },
  { key: '1m', label: '1 месяц',   days: 30,  usd: 8  },
  { key: '3m', label: '3 месяца',  days: 90,  usd: 20 },
  { key: '6m', label: '6 месяцев', days: 180, usd: 35 },
  { key: '1y', label: '1 год',     days: 365, usd: 60 },
];

const ASSETS = [
  { id: 'USDT', label: 'USDT', icon: '₮', color: '#26a17b' },
  { id: 'TRX',  label: 'TRX',  icon: '◈', color: '#ef0027' },
  { id: 'LTC',  label: 'LTC',  icon: 'Ł', color: '#bfbbbb' },
];

function SubscriptionTab({ userId, showToast }) {
  const [status, setStatus] = React.useState(null);
  const [selectedPlan, setSelectedPlan] = React.useState('1m');
  const [selectedAsset, setSelectedAsset] = React.useState('USDT');
  const [loading, setLoading] = React.useState(false);
  const [loadingStatus, setLoadingStatus] = React.useState(true);
  const [PLANS, setPlans] = React.useState(DEFAULT_PLANS);

  React.useEffect(() => {
    fetch('/api/plans')
      .then(r => r.json())
      .then(d => {
        if (d.plans) {
          const merged = DEFAULT_PLANS.map(def => {
            const srv = Object.entries(d.plans).find(([k]) => k === def.key);
            return srv ? { ...def, usd: srv[1].usd } : def;
          });
          setPlans(merged);
        }
      })
      .catch(() => {});
  }, []);

  React.useEffect(() => {
    fetch(`/api/subscription/status?userId=${userId}`)
      .then(r => r.json())
      .then(d => { setStatus(d); setLoadingStatus(false); })
      .catch(() => setLoadingStatus(false));
  }, [userId]);

  const handleBuy = async () => {
    setLoading(true);
    try {
      const res = await postJsonWithCsrf('/api/subscription/create', {
        userId,
        plan: selectedPlan,
        asset: selectedAsset,
      });
      const data = await res.json();
      if (data.error) { showToast(data.error, 'error'); return; }
      window.open(data.invoiceUrl, '_blank');
    } catch (e) {
      showToast('Ошибка: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const plan = PLANS.find(p => p.key === selectedPlan);
  const asset = ASSETS.find(a => a.id === selectedAsset);

  const sectionLabel = (text) => (
    <div style={{
      fontSize: 11, fontWeight: 700, color: 'rgba(255,215,0,0.7)',
      textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'Syne, system-ui',
      marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <div style={{ flex: 1, height: 1, background: 'rgba(255,215,0,0.15)' }} />
      {text}
      <div style={{ flex: 1, height: 1, background: 'rgba(255,215,0,0.15)' }} />
    </div>
  );

  if (loadingStatus) return (
    <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>
      Загрузка...
    </div>
  );

  const isPro = status?.plan === 'pro';
  const expDate = status?.subscriptionExp
    ? new Date(status.subscriptionExp).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Current status card */}
      {sectionLabel('Текущий план')}
      <div style={{
        padding: '20px 20px',
        background: isPro ? 'rgba(255,215,0,0.05)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${isPro ? 'rgba(255,215,0,0.25)' : 'rgba(255,255,255,0.08)'}`,
        borderRadius: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: isPro ? 'linear-gradient(135deg,#ffd700,#ff8c00)' : 'rgba(255,255,255,0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20,
          }}>{isPro ? '★' : '◎'}</div>
          <div>
            <div style={{ fontFamily: 'Syne, system-ui', fontWeight: 700, fontSize: 15, color: isPro ? '#ffd700' : 'rgba(255,255,255,0.6)' }}>
              {isPro ? 'Pro' : 'Trial'}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
              {isPro
                ? `Активна до ${expDate} · осталось ${status.daysLeft} дн.`
                : 'Пробная версия — ограниченный доступ'}
            </div>
          </div>
        </div>
        <div style={{
          padding: '4px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700,
          background: isPro ? 'rgba(255,215,0,0.15)' : 'rgba(255,255,255,0.06)',
          color: isPro ? '#ffd700' : 'rgba(255,255,255,0.35)',
          fontFamily: 'Syne, system-ui', letterSpacing: '0.05em',
        }}>{isPro ? 'АКТИВНА' : 'ТРИАЛ'}</div>
      </div>

      {/* Plan selector */}
      {sectionLabel('Выберите период')}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {PLANS.map(p => (
          <button key={p.key} onClick={() => setSelectedPlan(p.key)} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px',
            background: selectedPlan === p.key ? 'rgba(255,215,0,0.07)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${selectedPlan === p.key ? 'rgba(255,215,0,0.4)' : 'rgba(255,255,255,0.07)'}`,
            borderRadius: 12, cursor: 'pointer', transition: 'all 0.15s',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 18, height: 18, borderRadius: '50%',
                border: `2px solid ${selectedPlan === p.key ? '#ffd700' : 'rgba(255,255,255,0.2)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {selectedPlan === p.key && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ffd700' }} />}
              </div>
              <span style={{ fontSize: 14, fontWeight: selectedPlan === p.key ? 700 : 400, color: selectedPlan === p.key ? '#fff' : 'rgba(255,255,255,0.55)', fontFamily: 'Syne, system-ui' }}>
                {p.label}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {p.key === '1y' && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: 'rgba(62,207,142,0.15)', color: '#3ecf8e', fontFamily: 'Syne, system-ui' }}>ВЫГОДНО</span>
              )}
              <span style={{ fontSize: 15, fontWeight: 700, color: selectedPlan === p.key ? '#ffd700' : 'rgba(255,255,255,0.4)', fontFamily: 'Syne, system-ui' }}>
                ${p.usd}
              </span>
            </div>
          </button>
        ))}
      </div>

      {/* Asset selector */}
      {sectionLabel('Способ оплаты')}
      <div style={{ display: 'flex', gap: 8 }}>
        {ASSETS.map(a => (
          <button key={a.id} onClick={() => setSelectedAsset(a.id)} style={{
            flex: 1, padding: '14px 8px',
            background: selectedAsset === a.id ? 'rgba(255,215,0,0.06)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${selectedAsset === a.id ? 'rgba(255,215,0,0.35)' : 'rgba(255,255,255,0.07)'}`,
            borderRadius: 12, cursor: 'pointer', transition: 'all 0.15s',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
          }}>
            <span style={{ fontSize: 20, color: a.color }}>{a.icon}</span>
            <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'Syne, system-ui', color: selectedAsset === a.id ? '#fff' : 'rgba(255,255,255,0.4)' }}>{a.label}</span>
          </button>
        ))}
      </div>

      {/* Summary + buy */}
      <div style={{
        padding: '16px 18px',
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 14,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginBottom: 3 }}>К оплате</div>
          <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'Syne, system-ui', color: '#ffd700' }}>
            ≈ ${plan.usd} <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>в {asset.label}</span>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 2 }}>
            Точная сумма рассчитается по курсу CryptoBot
          </div>
        </div>
        <button
          onClick={handleBuy}
          disabled={loading}
          style={{
            padding: '13px 24px', fontSize: 13, fontWeight: 700,
            fontFamily: 'Syne, system-ui',
            background: loading ? 'rgba(255,215,0,0.3)' : 'linear-gradient(135deg,#ffd700,#ffaa00)',
            color: '#111', border: 'none', borderRadius: 12,
            cursor: loading ? 'not-allowed' : 'pointer',
            boxShadow: loading ? 'none' : '0 6px 20px rgba(255,215,0,0.3)',
            transition: 'all 0.2s', whiteSpace: 'nowrap',
          }}
        >
          {loading ? 'Создаём...' : '→ Оплатить'}
        </button>
      </div>

      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', textAlign: 'center', lineHeight: 1.6 }}>
        Оплата через CryptoPay · После оплаты подписка активируется автоматически
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PROFILE MODAL COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

function SaveToCloudButton({ onSaveToCloud }) {
  const [name, setName] = React.useState("");
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
      <input
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Название проекта..."
        style={{
          flex: 1, padding: "9px 12px", fontSize: 13,
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,215,0,0.2)",
          borderRadius: 10, color: "#fff",
          outline: "none", fontFamily: "var(--mono)",
        }}
      />
      <button
        onClick={() => { onSaveToCloud(name.trim()); if (name.trim()) setName(""); }}
        style={{
          padding: "9px 16px", fontSize: 13, fontWeight: 700,
          background: "linear-gradient(135deg, rgba(255,215,0,0.15), rgba(255,140,0,0.15))",
          border: "1px solid rgba(255,215,0,0.3)",
          borderRadius: 10, color: "#ffd700",
          cursor: "pointer", whiteSpace: "nowrap",
          fontFamily: "Syne, system-ui",
        }}
      >☁ Сохранить</button>
    </div>
  );
}

function ProfileModal({ user, projects, onClose, onLogout, onUpdateUser, onLoadProject, onDeleteProject, onSaveToCloud, showToast, isMobile, onOpenInstructions }) {
  const uiLang = user.uiLanguage || 'ru';
  const I18N = {
    ru: {
      newProject: 'Новый проект',
      profile: 'Профиль',
      projects: 'Проекты',
      subscription: 'Подписка',
      settings: 'Настройки',
      docs: 'Документация',
      support: 'Поддержка',
      upgradePro: 'Перейти на Pro →',
      logoutConfirm: 'Выйти из аккаунта?',
      editProfile: '✎ Редактировать профиль',
    },
    en: {
      newProject: 'New project',
      profile: 'Profile',
      projects: 'Projects',
      subscription: 'Subscription',
      settings: 'Settings',
      docs: 'Documentation',
      support: 'Support',
      upgradePro: 'Upgrade to Pro →',
      logoutConfirm: 'Sign out?',
      editProfile: '✎ Edit profile',
    },
    uk: {
      newProject: 'Новий проєкт',
      profile: 'Профіль',
      projects: 'Проєкти',
      subscription: 'Підписка',
      settings: 'Налаштування',
      docs: 'Документація',
      support: 'Підтримка',
      upgradePro: 'Перейти на Pro →',
      logoutConfirm: 'Вийти з акаунту?',
      editProfile: '✎ Редагувати профіль',
    },
  };
  const t = I18N[uiLang] || I18N.ru;
  const tx = {
    ru: { supportTitle: 'Поддержка', supportHint: 'Заполните форму, затем откроется Telegram с готовым текстом для отправки в' },
    en: { supportTitle: 'Support', supportHint: 'Fill in the form, then Telegram will open with a ready-made message for' },
    uk: { supportTitle: 'Підтримка', supportHint: 'Заповніть форму, потім відкриється Telegram з готовим текстом для відправки в' },
  }[uiLang] || {};
  const [activeTab, setActiveTab] = useState('profile');
  const [newName, setNewName] = useState(user.name);
  const [newEmail, setNewEmail] = useState(user.email);
  const [newAvatar, setNewAvatar] = useState(user.photo_url || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [testToken, setTestToken] = useState(user.test_token || '');
  const [testTokenSaving, setTestTokenSaving] = useState(false);
  const [focusedField, setFocusedField] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const avatarInputRef = React.useRef(null);

  // Синхронизируем newAvatar если user.photo_url изменился снаружи
  React.useEffect(() => {
    setNewAvatar(user.photo_url || '');
  }, [user.photo_url]);

  // Синхронизируем testToken если user.test_token изменился снаружи
  React.useEffect(() => {
    setTestToken(user.test_token || '');
  }, [user.test_token]);

  // Email change flow: 'idle' | 'sending' | 'code-sent' | 'confirming'
  const [emailChangeStep, setEmailChangeStep] = useState('idle');
  const [emailChangeCode, setEmailChangeCode] = useState('');
  const [emailChangePending, setEmailChangePending] = useState('');
  const [emailChangeError, setEmailChangeError] = useState('');
  const [supportFrom, setSupportFrom] = useState(user.email || user.name || '');
  const [supportSubject, setSupportSubject] = useState('');
  const [supportMessage, setSupportMessage] = useState('');

  const handleUpdateProfile = async () => {
    const nameChanged = newName !== user.name;
    const emailChanged = newEmail !== user.email;
    const avatarChanged = newAvatar !== (user.photo_url || '');

    // Save name right away if it changed (no confirmation needed)
    if ((nameChanged || avatarChanged) && !emailChanged) {
      await onUpdateUser({ name: newName, photo_url: newAvatar || null });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
      return;
    }

    // Save both name and trigger email change flow
    if (emailChanged) {
      if (!newEmail.includes('@')) { showToast('Введите корректный email', 'error'); return; }
      setEmailChangeStep('sending');
      setEmailChangeError('');
      setEmailChangePending(newEmail);
      try {
        await requestEmailChange(user.id, user.email, newEmail);
        setEmailChangeStep('code-sent');
        if (nameChanged || avatarChanged) await onUpdateUser({ name: newName, photo_url: newAvatar || null });
      } catch (e) {
        setEmailChangeStep('idle');
        setEmailChangeError(e.message);
        showToast('Ошибка: ' + e.message, 'error');
      }
      return;
    }
  };

  const optimizeAvatar = (dataUrl) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxSide = 512;
      const ratio = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * ratio));
      const h = Math.max(1, Math.round(img.height * ratio));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });

  const handleAvatarPick = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Выберите изображение (jpg/png/webp)', 'error');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      showToast('Файл слишком большой (макс. 15MB)', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const optimized = await optimizeAvatar(String(reader.result || ''));
      setNewAvatar(optimized);
      setSaveSuccess(false);
      setAvatarSaving(true);
      try {
        await onUpdateUser({ photo_url: optimized || null, _silent: true });
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2500);
        showToast('✅ Аватар сохранён', 'success');
      } catch (e) {
        // Если сессия истекла — откатываем превью обратно на старый аватар
        if (e?.message?.includes('Сессия истекла')) {
          setNewAvatar(user.photo_url || '');
        }
        showToast(e?.message || 'Ошибка сохранения аватара', 'error');
      } finally {
        setAvatarSaving(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleConfirmEmailCode = async () => {
    if (!emailChangeCode.trim()) { setEmailChangeError('Введите код из письма'); return; }
    setEmailChangeStep('confirming');
    setEmailChangeError('');
    try {
      const updatedUser = await confirmEmailChange(user.id, emailChangeCode.trim(), emailChangePending);
      onUpdateUser({ email: emailChangePending, ...(updatedUser || {}) });
      setNewEmail(emailChangePending);
      setEmailChangeStep('idle');
      setEmailChangeCode('');
      setEmailChangePending('');
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
      showToast('✅ Email успешно изменён!', 'success');
    } catch (e) {
      setEmailChangeStep('code-sent');
      setEmailChangeError(e.message || 'Неверный код');
    }
  };

  const handleCancelEmailChange = () => {
    setEmailChangeStep('idle');
    setEmailChangeCode('');
    setEmailChangePending('');
    setEmailChangeError('');
    setNewEmail(user.email);
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword) { showToast('Заполните все поля', 'error'); return; }
    if (newPassword.length < 6) { showToast('Новый пароль минимум 6 символов', 'error'); return; }
    try {
      const hashedCurrent = await sha256hex(currentPassword);
      const hashedNew = await sha256hex(newPassword);
      await onUpdateUser({ password: hashedNew, currentPassword: hashedCurrent });
      setCurrentPassword(''); setNewPassword('');
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (e) { showToast('Ошибка: ' + e.message, 'error'); }
  };

  const handleSupportSubmit = () => {
    if (!supportFrom.trim() || !supportSubject.trim() || !supportMessage.trim()) {
      showToast('Заполните поля: кто, тема и суть вопроса', 'error');
      return;
    }
    const payload =
`📩 Новое обращение в поддержку

👤 От: ${supportFrom.trim()}
📝 Тема: ${supportSubject.trim()}
💬 Суть:
${supportMessage.trim()}`;
    const tgUrl = `https://t.me/satanasat?text=${encodeURIComponent(payload)}`;
    window.open(tgUrl, '_blank', 'noopener,noreferrer');
    showToast('Открыт Telegram для отправки сообщения', 'success');
  };

  const formatDate = (dateString) => new Date(dateString).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  const avatarLetter = user.name[0].toUpperCase();
  const avatarColors = ['#ffd700,#ff8c00', '#3ecf8e,#0ea5e9', '#a78bfa,#ec4899', '#f87171,#fb923c'];
  const avatarColor = avatarColors[user.name.charCodeAt(0) % avatarColors.length];

  const inputBase = (field) => ({
    width: '100%', padding: '12px 16px', fontSize: 13,
    background: focusedField === field ? 'rgba(99,102,241,0.08)' : 'rgba(10,8,28,0.7)',
    color: 'var(--text)',
    border: `1.5px solid ${focusedField === field ? 'rgba(99,102,241,0.8)' : 'rgba(99,102,241,0.25)'}`,
    borderRadius: 12, outline: 'none', transition: 'all 0.2s ease',
    fontFamily: 'var(--mono)', boxSizing: 'border-box',
    boxShadow: focusedField === field ? '0 0 12px rgba(99,102,241,0.2)' : 'none',
  });

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'radial-gradient(ellipse at 40% 30%, rgba(99,40,240,0.18) 0%, rgba(0,0,0,0) 60%), radial-gradient(ellipse at 70% 80%, rgba(249,115,22,0.1) 0%, rgba(0,0,0,0) 55%), rgba(2,1,12,0.85)',
        display: 'flex',
        alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(18px)',
      }}
      onClick={onClose}
    >
      <style>{`
        @keyframes pmSlideIn { from { opacity:0; transform:translateY(14px) scale(0.97) } to { opacity:1; transform:translateY(0) scale(1) } }
        @keyframes pmSlideUp { from { opacity:0; transform:translateY(100%) } to { opacity:1; transform:translateY(0) } }
        @keyframes projectFade { from { opacity: 0; transform: translateX(-8px) } to { opacity: 1; transform: translateX(0) } }
        @keyframes spin2 { to { transform: rotate(360deg) } }
        @keyframes pmCornerGlow { 0%,100%{opacity:0.6} 50%{opacity:1} }
        @keyframes pmAvatarPulse { 0%,100%{box-shadow:0 0 0 2px rgba(249,115,22,0.4),0 0 16px rgba(249,115,22,0.2)} 50%{box-shadow:0 0 0 3px rgba(249,115,22,0.7),0 0 28px rgba(249,115,22,0.4)} }
        .pm-nav-btn { display:flex; align-items:center; gap:10px; padding:9px 12px; border-radius:9px; cursor:pointer; border:none; background:none; color:rgba(255,255,255,0.5); font-size:13px; font-family:system-ui,sans-serif; width:100%; text-align:left; transition:all .18s; position:relative; }
        .pm-nav-btn:hover { background:rgba(255,255,255,0.05); color:rgba(255,255,255,0.9); }
        .pm-nav-btn.pmactive { background:linear-gradient(135deg,rgba(249,115,22,0.18),rgba(220,38,38,0.12)); color:#f97316; border-left:2px solid #f97316; padding-left:10px; }
        .pm-nav-btn.pmactive:hover { background:linear-gradient(135deg,rgba(249,115,22,0.24),rgba(220,38,38,0.18)); }
        .pm-action-card:hover { border-color:rgba(249,115,22,0.3) !important; background:rgba(249,115,22,0.05) !important; transform:translateY(-1px); box-shadow:0 4px 16px rgba(249,115,22,0.1) !important; }
        .pm-info-row:hover { border-color:rgba(99,102,241,0.4) !important; }
        .pm-sec-row:hover { background:rgba(255,255,255,0.05) !important; border-color:rgba(255,255,255,0.15) !important; }
        .pm-tab-mobile { flex:0 0 auto; padding:7px 14px; border-radius:8px; font-size:12px; font-weight:700; cursor:pointer; font-family:Syne,system-ui; display:flex; align-items:center; gap:6px; transition:all .18s; }
        .pm-tab-mobile-active { background:linear-gradient(135deg,#f97316,#dc2626); color:#fff; border:1px solid transparent; box-shadow:0 3px 12px rgba(249,115,22,0.4); }
        .pm-tab-mobile-inactive { background:rgba(255,255,255,0.02); color:rgba(255,255,255,0.45); border:1px solid rgba(255,255,255,0.08); }
        .pm-tab-mobile-inactive:hover { background:rgba(255,255,255,0.06); color:rgba(255,255,255,0.8); }
      `}</style>

      <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleAvatarPick(e.target.files?.[0])} />

      <div
        style={{
          width: isMobile ? '100%' : 'min(1040px, 96vw)',
          height: isMobile ? '100%' : 'min(660px, 92vh)',
          background: 'linear-gradient(160deg,#0d0920 0%,#080618 50%,#060412 100%)',
          borderRadius: isMobile ? '20px 20px 0 0' : 18,
          border: '1px solid rgba(249,115,22,0.28)',
          display: 'flex',
          overflow: 'hidden',
          boxShadow: '0 0 0 1px rgba(99,40,240,0.18), 0 40px 100px rgba(0,0,0,0.9), 0 0 60px rgba(249,115,22,0.08), 0 0 100px rgba(99,40,240,0.1)',
          animation: isMobile ? 'pmSlideUp 0.3s cubic-bezier(0.34,1.1,0.64,1)' : 'pmSlideIn 0.28s cubic-bezier(0.34,1.2,0.64,1)',
          position: 'relative',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Neon corner accents */}
        {!isMobile && [
          { top:0, left:0, bT:'2px solid #f97316', bL:'2px solid #f97316', br:'16px 0 0 0' },
          { top:0, right:0, bT:'2px solid #f97316', bR:'2px solid #f97316', br:'0 16px 0 0' },
          { bottom:0, left:0, bB:'2px solid #f97316', bL:'2px solid #f97316', br:'0 0 0 16px' },
          { bottom:0, right:0, bB:'2px solid #f97316', bR:'2px solid #f97316', br:'0 0 16px 0' },
        ].map((c, i) => (
          <div key={i} style={{ position:'absolute', top:c.top, right:c.right, bottom:c.bottom, left:c.left, width:20, height:20, borderTop:c.bT, borderRight:c.bR, borderBottom:c.bB, borderLeft:c.bL, borderRadius:c.br, animation:'pmCornerGlow 2.5s ease-in-out infinite', animationDelay:`${i*0.35}s`, pointerEvents:'none', zIndex:10 }} />
        ))}
        {/* ── LEFT SIDEBAR ── */}
        {!isMobile && (
          <div style={{ width: 224, background: 'linear-gradient(180deg,rgba(13,9,32,0.98),rgba(8,6,18,1))', borderRight: '1px solid rgba(249,115,22,0.2)', display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'relative' }}>
            {/* subtle grid bg */}
            <div style={{ position:'absolute', inset:0, backgroundImage:'linear-gradient(rgba(99,102,241,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(99,102,241,0.04) 1px,transparent 1px)', backgroundSize:'24px 24px', pointerEvents:'none' }} />

            {/* Logo */}
            <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid rgba(249,115,22,0.15)', display: 'flex', alignItems: 'center', gap: 7, position: 'relative' }}>
              <span style={{ color: '#f97316', fontSize: 18, textShadow: '0 0 12px rgba(249,115,22,0.8), 0 0 24px rgba(249,115,22,0.4)' }}>◈</span>
              <span style={{ fontFamily: 'Syne,system-ui', fontWeight: 800, fontSize: 17, background: 'linear-gradient(90deg,#06b6d4,#818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Cicada</span>
              <span style={{ fontFamily: 'Syne,system-ui', fontSize: 13, color: 'rgba(255,255,255,0.3)', fontWeight: 400 }}>Studio</span>
            </div>

            {/* New project button */}
            <div style={{ padding: '12px 12px 8px', position: 'relative' }}>
              <button
                onClick={onClose}
                style={{ width: '100%', padding: '9px 14px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#f97316,#dc2626)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne,system-ui', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, boxShadow: '0 4px 18px rgba(249,115,22,0.4)' }}
              >
                <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> {t.newProject}
              </button>
            </div>

            {/* Primary nav */}
            <nav style={{ padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 2, position: 'relative' }}>
              {[
                { key: 'profile', icon: '👤', label: t.profile },
                { key: 'projects', icon: '📁', label: t.projects, badge: projects.length || null },
                { key: 'subscription', icon: '💳', label: t.subscription },
                { key: 'settings', icon: '⚙️', label: t.settings },
              ].map(({ key, icon, label, badge }) => (
                <button key={key} className={`pm-nav-btn${activeTab === key ? ' pmactive' : ''}`} onClick={() => setActiveTab(key)}>
                  <span style={{ fontSize: 15 }}>{icon}</span>
                  <span style={{ flex: 1 }}>{label}</span>
                  {badge > 0 && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: 'rgba(249,115,22,0.18)', color: '#f97316', border: '1px solid rgba(249,115,22,0.3)' }}>{badge}</span>}
                </button>
              ))}
            </nav>

            <div style={{ height: 1, background: 'linear-gradient(90deg,transparent,rgba(249,115,22,0.25),transparent)', margin: '6px 16px' }} />

            {/* Secondary nav */}
            <nav style={{ padding: '0 8px', display: 'flex', flexDirection: 'column', gap: 2, flex: 1, overflowY: 'auto', position: 'relative' }}>
              {[
                { key: 'docs', icon: '📖', label: t.docs, action: onOpenInstructions },
                { key: 'support', icon: '🛟', label: t.support, action: () => setActiveTab('support') },
              ].map(({ key, icon, label, action }) => (
                <button key={key} className={`pm-nav-btn${activeTab === key ? ' pmactive' : ''}`} onClick={action} style={{ opacity: 0.85 }}>
                  <span style={{ fontSize: 15 }}>{icon}</span>
                  <span>{label}</span>
                </button>
              ))}
            </nav>

            {/* Pro promo card */}
            {user.plan !== 'pro' && (
              <div style={{ margin: '8px 10px', padding: '14px 12px', borderRadius: 12, background: 'linear-gradient(145deg,rgba(99,40,240,0.2),rgba(59,130,246,0.1))', border: '1px solid rgba(99,102,241,0.35)', position: 'relative' }}>
                <div style={{ fontSize: 20, marginBottom: 5 }}>⚡</div>
                <div style={{ fontFamily: 'Syne,system-ui', fontWeight: 700, fontSize: 12, color: '#c4b5fd', lineHeight: 1.35 }}>Разблокируй все<br />возможности</div>
                <button
                  onClick={() => setActiveTab('subscription')}
                  style={{ marginTop: 9, width: '100%', padding: '7px 10px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,rgba(99,40,240,0.5),rgba(59,130,246,0.4))', color: '#c4b5fd', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne,system-ui', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', boxShadow: '0 3px 12px rgba(99,40,240,0.3)' }}
                >{t.upgradePro}</button>
              </div>
            )}

            {/* Bottom user info */}
            <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(249,115,22,0.18)', display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, overflow: 'hidden', background: `linear-gradient(135deg,${avatarColor})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: 'rgba(0,0,0,0.7)', fontFamily: 'Syne,system-ui', flexShrink: 0, boxShadow: '0 0 0 1.5px rgba(249,115,22,0.5)' }}>
                {newAvatar ? <img src={newAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : avatarLetter}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', fontFamily: 'Syne,system-ui', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--mono)' }}>{user.email}</div>
              </div>
              <button
                onClick={() => { if (confirm(t.logoutConfirm)) { onLogout(); onClose(); } }}
                title="Выйти"
                style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.2)', color: 'rgba(248,113,113,0.6)', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(248,113,113,0.18)'; e.currentTarget.style.borderColor = '#f87171'; e.currentTarget.style.color = '#f87171'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(248,113,113,0.06)'; e.currentTarget.style.borderColor = 'rgba(248,113,113,0.2)'; e.currentTarget.style.color = 'rgba(248,113,113,0.6)'; }}
              >↩</button>
            </div>
          </div>
        )}

        {/* ── MAIN CONTENT ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Top header */}
          <div style={{ padding: isMobile ? '14px 16px' : '16px 22px', borderBottom: '1px solid rgba(249,115,22,0.18)', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0, background: 'linear-gradient(90deg,rgba(13,9,32,0.95),rgba(8,6,18,0.95))', position: 'relative', backdropFilter: 'blur(8px)' }}>
            {/* Neon line accent bottom */}
            <div style={{ position:'absolute', bottom:0, left:0, right:0, height:1, background:'linear-gradient(90deg,transparent,rgba(249,115,22,0.5),rgba(99,40,240,0.4),transparent)', pointerEvents:'none' }} />
            <div style={{ position: 'relative', width: isMobile ? 46 : 56, height: isMobile ? 46 : 56, flexShrink: 0 }}>
              <div style={{ width: '100%', height: '100%', borderRadius: 16, overflow: 'hidden', background: `linear-gradient(135deg,${avatarColor})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: isMobile ? 20 : 24, fontWeight: 800, color: 'rgba(0,0,0,0.7)', fontFamily: 'Syne,system-ui', animation: 'pmAvatarPulse 3s ease-in-out infinite' }}>
                {newAvatar ? <img src={newAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : avatarLetter}
              </div>
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'Syne,system-ui', fontWeight: 800, fontSize: isMobile ? 18 : 22, color: '#fff', lineHeight: 1.1, textShadow: '0 0 20px rgba(255,255,255,0.15)' }}>{user.name}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4, fontFamily: 'var(--mono)', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: isMobile ? 160 : 280 }}>{user.email}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 9px', borderRadius: 20, background: 'rgba(6,182,212,0.12)', border: '1px solid rgba(6,182,212,0.35)', fontSize: 9, fontWeight: 700, color: '#06b6d4', letterSpacing: '0.08em', flexShrink: 0, boxShadow: '0 0 8px rgba(6,182,212,0.2)' }}>● ONLINE</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
              {!isMobile && (
                <button
                  onClick={() => setActiveTab('settings')}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 14px', borderRadius: 9, border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.08)', color: 'rgba(255,255,255,0.65)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'Syne,system-ui', transition: 'all .15s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.18)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,0.6)'; e.currentTarget.style.color = '#fff'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.08)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,0.3)'; e.currentTarget.style.color = 'rgba(255,255,255,0.65)'; }}
                >{t.editProfile}</button>
              )}
              <button
                onClick={onClose}
                style={{ width: 34, height: 34, borderRadius: 9, border: '1px solid rgba(249,115,22,0.25)', background: 'rgba(249,115,22,0.06)', color: 'rgba(255,255,255,0.5)', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(249,115,22,0.15)'; e.currentTarget.style.borderColor = '#f97316'; e.currentTarget.style.color = '#f97316'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(249,115,22,0.06)'; e.currentTarget.style.borderColor = 'rgba(249,115,22,0.25)'; e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; }}
              >×</button>
            </div>
          </div>

          {/* Mobile tab bar */}
          {isMobile && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', padding: '8px 10px', gap: 6, borderBottom: '1px solid rgba(249,115,22,0.18)', background: 'linear-gradient(90deg,rgba(13,9,32,0.98),rgba(8,6,18,0.98))', flexShrink: 0 }}>
              {[
                { key: 'profile', icon: '👤', label: t.profile },
                { key: 'projects', icon: '📁', label: t.projects },
                { key: 'subscription', icon: '💳', label: t.subscription },
                { key: 'settings', icon: '⚙️', label: t.settings },
              ].map(({ key, icon, label }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`pm-tab-mobile ${activeTab === key ? 'pm-tab-mobile-active' : 'pm-tab-mobile-inactive'}`}
                >
                  <span>{icon}</span><span>{label}</span>
                </button>
              ))}
            </div>
          )}

          {/* Tab content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '14px 12px' : '18px 22px' }}>

            {/* ── PROFILE TAB ── */}
            {activeTab === 'profile' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Stats row */}
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: 10 }}>
                  {[
                    { label: 'ПРОЕКТОВ', value: projects.length, color: '#f97316', isNum: true },
                    { label: 'ДНЕЙ С НАМИ', value: user.createdAt ? Math.floor((Date.now() - new Date(user.createdAt)) / 86400000) : '—', color: '#06b6d4', isNum: true },
                    { label: 'ТАРИФ', value: user.plan === 'pro' ? 'PRO' : 'FREE', isPlan: true },
                    { label: 'ПОДДЕРЖКА', value: '24/7', color: '#818cf8', isNum: true },
                  ].map(({ label, value, color, isNum, isPlan }) => (
                    <div key={label} style={{ padding: '13px 14px', borderRadius: 12, background: 'rgba(10,8,28,0.6)', border: '1px solid rgba(99,102,241,0.2)', boxShadow: '0 2px 12px rgba(0,0,0,0.3)' }}>
                      {isPlan ? (
                        <div style={{ marginBottom: 7 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: user.plan === 'pro' ? 'rgba(62,207,142,0.15)' : 'rgba(255,255,255,0.08)', color: user.plan === 'pro' ? '#3ecf8e' : 'rgba(255,255,255,0.65)', border: `1px solid ${user.plan === 'pro' ? 'rgba(62,207,142,0.3)' : 'rgba(255,255,255,0.15)'}` }}>{value}</span>
                        </div>
                      ) : (
                        <div style={{ fontFamily: 'Syne,system-ui', fontWeight: 800, fontSize: 24, color, lineHeight: 1, marginBottom: 7 }}>{value}</div>
                      )}
                      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, fontFamily: 'Syne,system-ui' }}>{label}</div>
                    </div>
                  ))}
                </div>

                {/* Two-column layout */}
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16, alignItems: 'start' }}>
                  {/* Left column */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {/* Quick actions */}
                    <section>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: 'Syne,system-ui', marginBottom: 10 }}>Быстрые действия</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        {[
                          { icon: '⊕', label: 'Новый проект', sub: 'Создать бота с нуля', color: '#f97316', glow: 'rgba(249,115,22,0.2)', action: onClose },
                          { icon: '📖', label: 'Документация', sub: 'Открыть инструкцию', color: '#60a5fa', glow: 'rgba(96,165,250,0.15)', action: onOpenInstructions },
                          { icon: '🛟', label: 'Поддержка', sub: 'Написать в поддержку', color: '#34d399', glow: 'rgba(52,211,153,0.15)', action: () => setActiveTab('support') },
                        ].map(({ icon, label, sub, color, glow, action }) => (
                          <button
                            key={label}
                            className="pm-action-card"
                            onClick={action}
                            style={{ textAlign: 'left', cursor: 'pointer', borderRadius: 12, padding: '12px 10px', background: 'rgba(10,8,28,0.5)', border: `1px solid ${glow.replace('0.2', '0.25').replace('0.15', '0.2')}`, transition: 'all .2s' }}
                          >
                            <div style={{ fontSize: 22, color, marginBottom: 8, textShadow: `0 0 12px ${glow}` }}>{icon}</div>
                            <div style={{ fontSize: 12, fontWeight: 700, color, fontFamily: 'Syne,system-ui', marginBottom: 4, lineHeight: 1.2 }}>{label}</div>
                            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.42)', lineHeight: 1.4 }}>{sub}</div>
                          </button>
                        ))}
                      </div>
                    </section>

                    {/* Personal info */}
                    <section>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: 'Syne,system-ui', marginBottom: 10 }}>Личная информация</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {[
                          { icon: '👤', label: 'Имя', value: user.name, editable: true },
                          { icon: '✉️', label: 'Email', value: user.email, editable: true },
                          { icon: '📅', label: 'Дата регистрации', value: user.createdAt ? formatDate(user.createdAt) : '—', editable: false },
                          { icon: '🕐', label: 'Последний вход', value: 'Сегодня', editable: false },
                          { icon: '🌐', label: 'Язык', value: ({ ru:'Русский', en:'English', uk:'Українська' }[user.uiLanguage || 'ru'] || 'Русский'), editable: true },
                        ].map(({ icon, label, value, editable }) => (
                          <div
                            key={label}
                            className="pm-info-row"
                            style={{ display: 'flex', alignItems: 'center', padding: '10px 13px', borderRadius: 9, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', cursor: editable ? 'pointer' : 'default', transition: 'border-color .2s' }}
                            onClick={editable ? () => setActiveTab('settings') : undefined}
                          >
                            <span style={{ fontSize: 14, width: 22, flexShrink: 0 }}>{icon}</span>
                            <span style={{ flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.5)', marginLeft: 9, fontFamily: 'system-ui' }}>{label}</span>
                            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.82)', fontFamily: 'var(--mono)', maxWidth: '50%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
                            {editable && <span style={{ marginLeft: 7, fontSize: 11, color: 'rgba(255,255,255,0.28)', flexShrink: 0 }}>✎</span>}
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>

                  {/* Right column */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {/* Avatar */}
                    <section>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: 'Syne,system-ui', marginBottom: 10 }}>Аватар</div>
                      <div style={{ padding: '16px', borderRadius: 12, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)' }}>
                        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 14 }}>
                          <div style={{ width: 72, height: 72, borderRadius: 18, overflow: 'hidden', background: `linear-gradient(135deg,${avatarColor})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, fontWeight: 800, color: 'rgba(0,0,0,0.7)', fontFamily: 'Syne,system-ui', flexShrink: 0 }}>
                            {newAvatar ? <img src={newAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : avatarLetter}
                          </div>
                          <div style={{ paddingTop: 4 }}>
                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 3 }}>JPG/PNG/WebP</div>
                            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>@ Максимум 15MB</div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => avatarInputRef.current?.click()}
                          disabled={avatarSaving}
                          style={{ width: '100%', padding: '9px 14px', borderRadius: 8, border: '1px solid rgba(99,102,241,0.35)', background: 'rgba(99,102,241,0.1)', color: '#818cf8', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne,system-ui', marginBottom: newAvatar ? 8 : 0, transition: 'all .15s', opacity: avatarSaving ? 0.6 : 1 }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.2)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,0.6)'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.1)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,0.35)'; }}
                        >{avatarSaving ? '⏳ Сохраняем…' : '📷 Загрузить фото'}</button>
                        {newAvatar && (
                          <button
                            type="button"
                            disabled={avatarSaving}
                            onClick={async () => {
                              setNewAvatar('');
                              setAvatarSaving(true);
                              try {
                                await onUpdateUser({ photo_url: null, _silent: true });
                                showToast('✅ Аватар удалён', 'success');
                              } catch (e) {
                                showToast('Ошибка: ' + (e?.message || 'unknown'), 'error');
                              } finally { setAvatarSaving(false); }
                            }}
                            style={{ width: '100%', padding: '9px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.5)', fontSize: 12, cursor: 'pointer', fontFamily: 'Syne,system-ui', transition: 'all .15s', opacity: avatarSaving ? 0.6 : 1 }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                          >Удалить</button>
                        )}
                      </div>
                    </section>

                    {/* Security */}
                    <section>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: 'Syne,system-ui', marginBottom: 10 }}>Безопасность</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {[
                          { icon: '🔒', title: 'Изменить пароль', sub: 'Последнее изменение 2 мес. назад' },
                          { icon: '🛡', title: 'Двухфакторная аутентификация', sub: user.twofaEnabled ? null : 'Выключена', subGreen: user.twofaEnabled ? 'Включена' : null },
                        ].map(({ icon, title, sub, subGreen }) => (
                          <div
                            key={title}
                            className="pm-sec-row"
                            onClick={() => setActiveTab('settings')}
                            style={{ display: 'flex', alignItems: 'center', padding: '12px 13px', borderRadius: 9, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', cursor: 'pointer', transition: 'all .15s' }}
                          >
                            <span style={{ fontSize: 16, marginRight: 11, flexShrink: 0 }}>{icon}</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.85)', fontFamily: 'system-ui' }}>{title}</div>
                              {sub && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.38)', marginTop: 2 }}>{sub}</div>}
                              {subGreen && <div style={{ fontSize: 10, color: '#3ecf8e', marginTop: 2 }}>{subGreen}</div>}
                            </div>
                            <span style={{ color: 'rgba(255,255,255,0.28)', fontSize: 17, flexShrink: 0 }}>›</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                </div>
              </div>
            )}

            {/* ── PROJECTS TAB ── */}
            {activeTab === 'projects' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {onSaveToCloud && <SaveToCloudButton onSaveToCloud={onSaveToCloud} />}
                {projects.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '48px 20px', background: 'rgba(255,255,255,0.025)', border: '1px dashed rgba(255,255,255,0.13)', borderRadius: 20 }}>
                    <div style={{ fontSize: 48, marginBottom: 14, opacity: 0.3 }}>⊞</div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.4)', fontFamily: 'Syne, system-ui' }}>Нет проектов</div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', marginTop: 8, lineHeight: 1.6 }}>Сохраните проект через кнопку «Сохранить проект» на панели</div>
                  </div>
                ) : (
                  projects.map((project, i) => (
                    <div
                      key={project.id}
                      style={{ padding: '12px 14px', background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 14, transition: 'all 0.2s ease', animation: `projectFade 0.3s ease ${i * 0.06}s both` }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.borderColor = 'rgba(255,215,0,0.2)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.025)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)'; }}
                    >
                      <div style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, background: 'linear-gradient(135deg,rgba(255,215,0,0.15),rgba(255,140,0,0.15))', border: '1px solid rgba(255,215,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>📋</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', fontFamily: 'Syne, system-ui', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{project.name}</div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 3, fontFamily: 'var(--mono)' }}>Изменён {formatDate(project.updatedAt)}</div>
                      </div>
                      {confirmDelete === project.id ? (
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          <button onClick={() => { onDeleteProject(project.id); setConfirmDelete(null); }} style={{ padding: '7px 12px', fontSize: 11, fontWeight: 700, background: '#f87171', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Удалить</button>
                          <button onClick={() => setConfirmDelete(null)} style={{ padding: '7px 12px', fontSize: 11, background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, cursor: 'pointer' }}>Отмена</button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          <button onClick={() => onLoadProject(project.id)} style={{ padding: '9px 14px', fontSize: 11, fontWeight: 700, fontFamily: 'Syne, system-ui', background: 'linear-gradient(135deg,#3ecf8e,#0ea5e9)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', boxShadow: '0 4px 12px rgba(62,207,142,0.3)', transition: 'all 0.2s' }} onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; }} onMouseLeave={e => { e.currentTarget.style.transform = 'none'; }}>↓ Открыть</button>
                          <button onClick={() => setConfirmDelete(project.id)} style={{ width: 36, height: 36, borderRadius: 11, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.15)', color: '#f87171', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }} onMouseEnter={e => { e.currentTarget.style.background = 'rgba(248,113,113,0.2)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'rgba(248,113,113,0.08)'; }}>✕</button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* ── SUBSCRIPTION TAB ── */}
            {activeTab === 'subscription' && (
              <SubscriptionTab userId={user.id} showToast={showToast} />
            )}

            {/* ── SETTINGS TAB ── */}
            {activeTab === 'settings' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Bot Test Token */}
                <div style={{ background: 'rgba(62,207,142,0.04)', border: '1px solid rgba(62,207,142,0.18)', borderRadius: 14, padding: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(62,207,142,0.8)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'Syne, system-ui', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 1, background: 'rgba(62,207,142,0.15)' }} />
                    🤖 Токен бота для теста
                    <div style={{ flex: 1, height: 1, background: 'rgba(62,207,142,0.15)' }} />
                  </div>
                  <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)', margin: '0 0 12px', lineHeight: 1.5 }}>Токен будет автоматически подставляться в новые блоки «Бот» и в схемы, сгенерированные AI.</p>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="text" value={testToken} onChange={e => setTestToken(e.target.value)} onFocus={() => setFocusedField('ttoken')} onBlur={() => setFocusedField(null)} style={{ ...inputBase('ttoken'), flex: 1, fontFamily: 'var(--mono,monospace)', fontSize: 12, letterSpacing: '0.02em' }} placeholder="1234567890:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
                    {testToken && testToken !== (user.test_token || '') && (
                      <button onClick={async () => { setTestTokenSaving(true); try { await onUpdateUser({ test_token: testToken.trim() || null, _silent: true }); showToast('✅ Токен сохранён', 'success'); } catch(e) { showToast('Ошибка: ' + e.message, 'error'); } finally { setTestTokenSaving(false); } }} disabled={testTokenSaving} style={{ padding: '9px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, fontFamily: 'Syne, system-ui', background: 'linear-gradient(135deg,#3ecf8e,#0ea5e9)', color: '#0a0a0a', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, opacity: testTokenSaving ? 0.6 : 1 }}>{testTokenSaving ? '...' : '💾 Сохранить'}</button>
                    )}
                    {testToken && testToken === (user.test_token || '') && (
                      <button onClick={async () => { setTestTokenSaving(true); try { await onUpdateUser({ test_token: null, _silent: true }); setTestToken(''); showToast('Токен удалён', 'success'); } catch(e) { showToast('Ошибка: ' + e.message, 'error'); } finally { setTestTokenSaving(false); } }} disabled={testTokenSaving} style={{ padding: '9px 12px', borderRadius: 10, fontSize: 12, background: 'rgba(248,113,113,0.08)', color: '#f87171', border: '1px solid rgba(248,113,113,0.2)', cursor: 'pointer', flexShrink: 0, opacity: testTokenSaving ? 0.6 : 1 }}>✕ Убрать</button>
                    )}
                  </div>
                  {user.test_token && <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(62,207,142,0.6)', fontFamily: 'var(--mono)' }}>✓ Сохранён: {user.test_token.slice(0, 10)}...{user.test_token.slice(-6)}</div>}
                </div>

                {/* Profile data */}
                <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, padding: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,215,0,0.7)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'Syne, system-ui', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 1, background: 'rgba(255,215,0,0.15)' }} />
                    Данные профиля
                    <div style={{ flex: 1, height: 1, background: 'rgba(255,215,0,0.15)' }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, fontFamily: 'Syne, system-ui' }}>Имя</label>
                      <input type="text" value={newName} onChange={e => setNewName(e.target.value)} onFocus={() => setFocusedField('sname')} onBlur={() => setFocusedField(null)} style={inputBase('sname')} placeholder="Ваше имя" />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, fontFamily: 'Syne, system-ui' }}>Email</label>
                      {emailChangeStep === 'idle' || emailChangeStep === 'sending' ? (
                        <input type="email" value={newEmail} onChange={e => { setNewEmail(e.target.value); setEmailChangeError(''); }} onFocus={() => setFocusedField('semail')} onBlur={() => setFocusedField(null)} disabled={emailChangeStep === 'sending'} style={{ ...inputBase('semail'), opacity: emailChangeStep === 'sending' ? 0.6 : 1 }} placeholder="email@example.com" />
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(62,207,142,0.07)', border: '1px solid rgba(62,207,142,0.2)', fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.6 }}>
                            <span style={{ color: '#3ecf8e', fontWeight: 600 }}>📧 Код отправлен</span> на <span style={{ color: 'var(--text)', fontFamily: 'var(--mono)' }}>{user.email}</span><br />
                            Введите его для подтверждения смены на <span style={{ color: '#ffd700', fontFamily: 'var(--mono)' }}>{emailChangePending}</span>
                          </div>
                          <input type="text" value={emailChangeCode} onChange={e => { setEmailChangeCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setEmailChangeError(''); }} onFocus={() => setFocusedField('ecode')} onBlur={() => setFocusedField(null)} style={{ ...inputBase('ecode'), textAlign: 'center', fontSize: 22, letterSpacing: '0.35em', fontWeight: 700, border: `1.5px solid ${emailChangeError ? '#f87171' : focusedField === 'ecode' ? '#3ecf8e' : 'rgba(255,255,255,0.12)'}` }} placeholder="000000" maxLength={6} autoFocus />
                          {emailChangeError && <div style={{ fontSize: 11, color: '#f87171', textAlign: 'center' }}>⚠ {emailChangeError}</div>}
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={handleConfirmEmailCode} disabled={emailChangeStep === 'confirming' || emailChangeCode.length < 4} style={{ flex: 1, padding: '11px 0', fontSize: 13, fontWeight: 700, fontFamily: 'Syne, system-ui', background: emailChangeCode.length >= 4 ? 'linear-gradient(135deg,#3ecf8e,#0ea5e9)' : 'rgba(255,255,255,0.06)', color: emailChangeCode.length >= 4 ? '#111' : 'rgba(255,255,255,0.3)', border: 'none', borderRadius: 12, cursor: emailChangeCode.length >= 4 ? 'pointer' : 'not-allowed' }}>{emailChangeStep === 'confirming' ? '⏳ Проверяем...' : '✓ Подтвердить'}</button>
                            <button onClick={handleCancelEmailChange} style={{ padding: '11px 16px', fontSize: 12, fontWeight: 600, fontFamily: 'Syne, system-ui', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, cursor: 'pointer' }}>Отмена</button>
                          </div>
                        </div>
                      )}
                      {emailChangeError && emailChangeStep === 'idle' && <div style={{ fontSize: 11, color: '#f87171', marginTop: 6 }}>⚠ {emailChangeError}</div>}
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, fontFamily: 'Syne, system-ui' }}>Язык интерфейса</label>
                      <select value={user.uiLanguage || 'ru'} onChange={async (e) => {
                        const uiLanguage = e.target.value;
                        try {
                          await onUpdateUser({ ui_language: uiLanguage, _silent: true });
                          showToast('Язык интерфейса обновлён', 'success');
                        } catch (err) {
                          showToast('Ошибка: ' + (err?.message || 'unknown'), 'error');
                        }
                      }} style={{ ...inputBase('slang'), appearance:'none', cursor:'pointer' }}>
                        <option value="ru">Русский</option>
                        <option value="en">English</option>
                        <option value="uk">Українська</option>
                      </select>
                    </div>

                    {(emailChangeStep === 'idle' || emailChangeStep === 'sending') && (
                      <button onClick={handleUpdateProfile} disabled={emailChangeStep === 'sending'} style={{ padding: '12px 20px', fontSize: 13, fontWeight: 700, fontFamily: 'Syne, system-ui', background: saveSuccess ? 'linear-gradient(135deg,#3ecf8e,#0ea5e9)' : emailChangeStep === 'sending' ? 'rgba(255,255,255,0.08)' : 'linear-gradient(135deg,#ffd700,#ffaa00)', color: emailChangeStep === 'sending' ? 'rgba(255,255,255,0.4)' : '#111', border: 'none', borderRadius: 12, cursor: emailChangeStep === 'sending' ? 'not-allowed' : 'pointer', transition: 'all 0.3s ease' }}>
                        {saveSuccess ? '✓ Сохранено!' : emailChangeStep === 'sending' ? '⏳ Отправляем код...' : '✦ Сохранить изменения'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Password */}
                <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, padding: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(96,165,250,0.7)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'Syne, system-ui', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 1, background: 'rgba(96,165,250,0.15)' }} />
                    Безопасность
                    <div style={{ flex: 1, height: 1, background: 'rgba(96,165,250,0.15)' }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, fontFamily: 'Syne, system-ui' }}>Текущий пароль</label>
                      <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} onFocus={() => setFocusedField('curPass')} onBlur={() => setFocusedField(null)} style={inputBase('curPass')} placeholder="••••••••" autoComplete="current-password" />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, fontFamily: 'Syne, system-ui' }}>Новый пароль</label>
                      <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} onFocus={() => setFocusedField('newPass')} onBlur={() => setFocusedField(null)} style={inputBase('newPass')} placeholder="Минимум 6 символов" autoComplete="new-password" />
                    </div>
                    <button onClick={handleChangePassword} style={{ padding: '12px 20px', fontSize: 13, fontWeight: 700, fontFamily: 'Syne, system-ui', background: 'rgba(96,165,250,0.12)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.3)', borderRadius: 12, cursor: 'pointer', transition: 'all 0.2s' }} onMouseEnter={e => { e.currentTarget.style.background = 'rgba(96,165,250,0.2)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'rgba(96,165,250,0.12)'; }}>🔐 Изменить пароль</button>
                  </div>
                </div>


                {/* 2FA */}
                <TwoFASettingsCard user={user} onUpdateUser={onUpdateUser} showToast={showToast} />

                {/* Danger zone */}
                <div style={{ background: 'rgba(248,113,113,0.02)', border: '1px solid rgba(248,113,113,0.16)', borderRadius: 14, padding: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(248,113,113,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'Syne, system-ui', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 1, background: 'rgba(248,113,113,0.15)' }} />
                    Опасная зона
                    <div style={{ flex: 1, height: 1, background: 'rgba(248,113,113,0.15)' }} />
                  </div>
                  <button onClick={() => { if (confirm('Выйти из аккаунта?')) { onLogout(); onClose(); } }} style={{ width: '100%', padding: '9px 16px', fontSize: 12, fontWeight: 700, fontFamily: 'Syne, system-ui', background: 'rgba(248,113,113,0.06)', color: '#f87171', border: '1px solid rgba(248,113,113,0.18)', borderRadius: 10, cursor: 'pointer', transition: 'all 0.2s' }} onMouseEnter={e => { e.currentTarget.style.background = 'rgba(248,113,113,0.15)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'rgba(248,113,113,0.06)'; }}>↩ Выйти из аккаунта</button>
                </div>
              </div>
            )}

            {/* ── SUPPORT TAB ── */}
            {activeTab === 'support' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760 }}>
                <div style={{ background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 14, padding: 16 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#e5e7eb', fontFamily: 'Syne, system-ui', marginBottom: 6 }}>{tx.supportTitle}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6 }}>
                    {tx.supportHint} <strong>@satanasat</strong>.
                  </div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, fontFamily: 'Syne, system-ui' }}>От кого</label>
                    <input
                      type="text"
                      value={supportFrom}
                      onChange={e => setSupportFrom(e.target.value)}
                      onFocus={() => setFocusedField('supportFrom')}
                      onBlur={() => setFocusedField(null)}
                      style={inputBase('supportFrom')}
                      placeholder="Ваш email или @username"
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, fontFamily: 'Syne, system-ui' }}>Тема</label>
                    <input
                      type="text"
                      value={supportSubject}
                      onChange={e => setSupportSubject(e.target.value)}
                      onFocus={() => setFocusedField('supportSubject')}
                      onBlur={() => setFocusedField(null)}
                      style={inputBase('supportSubject')}
                      placeholder="Кратко о проблеме"
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, fontFamily: 'Syne, system-ui' }}>Суть вопроса</label>
                    <textarea
                      value={supportMessage}
                      onChange={e => setSupportMessage(e.target.value)}
                      onFocus={() => setFocusedField('supportMessage')}
                      onBlur={() => setFocusedField(null)}
                      style={{ ...inputBase('supportMessage'), minHeight: 140, resize: 'vertical' }}
                      placeholder="Опишите проблему или вопрос"
                    />
                  </div>
                  <button
                    onClick={handleSupportSubmit}
                    style={{ alignSelf: 'flex-start', padding: '12px 16px', fontSize: 13, fontWeight: 700, fontFamily: 'Syne, system-ui', background: 'linear-gradient(135deg,#3ecf8e,#0ea5e9)', color: '#111', border: 'none', borderRadius: 12, cursor: 'pointer' }}
                  >
                    Отправить в Telegram @satanasat
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// INSTRUCTIONS CONTENT COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
// ─── INSTRUCTIONS MODAL ──────────────────────────────────────────────────────
  const INSTR_SECTIONS = [
    {
      id: 'intro', emoji: '🚀', color: '#ffd700', glow: 'rgba(255,215,0,0.2)',
      label: 'Начало', title: 'Как пользоваться Cicada Studio',
      subtitle: 'Собирай Telegram-бота как из пазлов 🧩',
      content: () => (
        <>
          <p style={pStyle}>Cicada Studio — визуальный конструктор Telegram-ботов. Вместо кода ты работаешь с блоками: перетаскиваешь их на холст, соединяешь и запускаешь бота в один клик.</p>
          <ICard icon="💡">Начни с блоков <ICode>Версия</ICode> → <ICode>Бот</ICode> → <ICode>Старт</ICode> — это минимальный рабочий бот.</ICard>
        </>
      ),
    },
    {
      id: 'blocks', emoji: '🧩', color: '#a78bfa', glow: 'rgba(167,139,250,0.2)',
      label: 'Блоки', title: '1. Добавь блоки',
      subtitle: 'Перетащи блоки из левой панели на холст.',
      content: () => (
        <>
          <IList color="#a78bfa" title="👉 Начни с:" items={[
            { icon: '📌', text: 'Версия' },
            { icon: '🤖', text: 'Бот — обязательно укажи токен' },
            { icon: '▶', text: 'Старт' },
          ]} />
          <p style={pStyle}>Каждый блок — отдельная инструкция. Блоки бывают настроечные (версия, бот) и событийные (старт, команда, при нажатии).</p>
          <ICard icon="🔍">Используй поиск в библиотеке блоков, чтобы быстро найти нужный.</ICard>
        </>
      ),
    },
    {
      id: 'connect', emoji: '🔗', color: '#34d399', glow: 'rgba(52,211,153,0.2)',
      label: 'Соединение', title: '2. Соединяй блоки',
      subtitle: 'Соединяй их сверху вниз — как конструктор.',
      content: () => (
        <>
          <p style={pStyle}>Порядок блоков в стеке определяет логику бота. Верхний блок — триггер, нижние — реакции.</p>
          <IExample steps={[
            { icon: '▶', color: '#3ecf8e', text: 'Старт' },
            { icon: '✉', color: '#5b7cf6', text: 'Ответ → Привет!' },
            { icon: '⊞', color: '#a78bfa', text: 'Кнопки → [Меню] [Помощь]' },
          ]} />
          <ICard icon="⚡">Блоки внутри одного стека выполняются последовательно, сверху вниз.</ICard>
        </>
      ),
    },
    {
      id: 'settings', emoji: '✏️', color: '#60a5fa', glow: 'rgba(96,165,250,0.2)',
      label: 'Настройки', title: '3. Настрой блок',
      subtitle: 'Нажми на блок и задай параметры.',
      content: () => (
        <>
          <IList color="#60a5fa" title="Что можно задать:" items={[
            { icon: '📝', text: 'Текст сообщения' },
            { icon: '⌨', text: 'Команду (например /help)' },
            { icon: '📦', text: 'Переменные {{имя}}' },
          ]} />
          <ICard icon="💡">Используй переменную <ICode>{'{{имя}}'}</ICode> в тексте для подстановки данных.</ICard>
        </>
      ),
    },
    {
      id: 'logic', emoji: '⚡', color: '#fb923c', glow: 'rgba(251,146,60,0.2)',
      label: 'Логика', title: '4. Добавь логику',
      subtitle: 'Ветвление, циклы и переменные.',
      content: () => (
        <>
          <IList color="#fb923c" title="Блоки логики:" items={[
            { icon: '🔀', text: 'Если — проверка условия' },
            { icon: '❓', text: 'Спросить — ввод от пользователя' },
            { icon: '💾', text: 'Сохранить — запись в память' },
            { icon: '⏱', text: 'Задержка — пауза в секундах' },
          ]} />
          <ICard icon="🎯">Значения переменных сохраняются между шагами одного сценария.</ICard>
        </>
      ),
    },
    {
      id: 'run', emoji: '▶', color: '#3ecf8e', glow: 'rgba(62,207,142,0.2)',
      label: 'Запуск', title: '5. Запусти бота',
      subtitle: 'Проверь, сгенерируй и скачай .ccd файл.',
      content: () => (
        <>
          <IList color="#3ecf8e" title="Шаги:" items={[
            { icon: '1️⃣', text: 'Проверь ошибки (кнопка ✔ Проверить)' },
            { icon: '2️⃣', text: 'Нажми «Генерировать»' },
            { icon: '3️⃣', text: 'Скачай .ccd кнопкой ↓' },
            { icon: '4️⃣', text: 'Запусти: cicada bot.ccd' },
          ]} />
          <ICodeBlock lines={[
            { c: '#94a3b8', t: '# Установка' },
            { c: '#e2e8f0', t: 'pip install cicada-tg' },
            { c: '#94a3b8', t: '# Запуск' },
            { c: '#3ecf8e', t: 'cicada bot.ccd' },
          ]} />
        </>
      ),
    },
    {
      id: 'install', emoji: '🖥️', color: '#38bdf8', glow: 'rgba(56,189,248,0.2)',
      label: 'Установка', title: '6. Установка на ПК',
      subtitle: 'Python 3.10+ и pip — всё что нужно.',
      content: () => (
        <>
          <IList color="#38bdf8" title="Требования:" items={[
            { icon: '🐍', text: 'Python 3.10+ (python.org)' },
            { icon: '📦', text: 'pip (входит в Python)' },
            { icon: '🤖', text: 'Telegram Bot Token от @BotFather' },
          ]} />
          <p style={{ ...pStyle, color: '#38bdf8', fontSize: 12, marginBottom: 6 }}>🪟 Windows (cmd / PowerShell):</p>
          <ICodeBlock lines={[{ c: '#e2e8f0', t: 'pip install cicada-tg' }]} />
          <p style={{ ...pStyle, color: '#38bdf8', fontSize: 12, marginBottom: 6 }}>🐧 Linux / macOS:</p>
          <ICodeBlock lines={[{ c: '#e2e8f0', t: 'pip install cicada-tg --break-system-packages' }]} />
          <ICard icon="⚠️">На Windows при установке Python поставь галочку «Add Python to PATH».</ICard>
        </>
      ),
    },
    {
      id: 'tips', emoji: '⭐', color: '#f472b6', glow: 'rgba(244,114,182,0.2)',
      label: 'Важно', title: '7. Важные правила',
      subtitle: 'Без этого бот не запустится.',
      content: () => (
        <>
          <IList color="#ef4444" title="⚠️ Обязательно:" items={[
            { icon: '🔗', text: 'Блоки должны быть соединены в стек' },
            { icon: '▶', text: 'Должен быть блок Старт' },
            { icon: '🤖', text: 'В блоке Бот нужен токен' },
          ]} />
          <p style={{ ...pStyle, textAlign: 'center', color: '#ffd700', fontSize: 16, marginTop: 20 }}>🎉 Готово! Собирай своего бота!</p>
        </>
      ),
    },
  ];

  const pStyle = { fontSize: 13.5, lineHeight: 1.7, color: 'rgba(232,234,240,0.75)', margin: '0 0 12px 0' };

  function ICode({ children }) {
    return (
      <code style={{ background: 'rgba(255,255,255,0.09)', padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace', fontSize: 12, color: '#3ecf8e' }}>{children}</code>
    );
  }

  function ICard({ icon, children }) {
    return (
      <div style={{ display: 'flex', gap: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '10px 14px', marginTop: 12 }}>
        <span style={{ fontSize: 15, flexShrink: 0 }}>{icon}</span>
        <p style={{ fontSize: 12.5, color: 'rgba(232,234,240,0.6)', margin: 0, lineHeight: 1.6 }}>{children}</p>
      </div>
    );
  }

  function IList({ color, title, items }) {
    return (
      <div style={{ marginBottom: 14 }}>
        {title && <p style={{ fontSize: 12, fontWeight: 700, color, margin: '0 0 8px 0', letterSpacing: '0.03em' }}>{title}</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>{item.icon}</span>
              <span style={{ fontSize: 13.5, color: 'rgba(232,234,240,0.85)' }}>{item.text}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function IExample({ steps }) {
    return (
      <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
        <p style={{ fontSize: 10, color: 'rgba(232,234,240,0.35)', margin: '0 0 10px 0', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Пример:</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {steps.map((step, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 26, height: 26, borderRadius: 5, background: step.color + '20', border: `1px solid ${step.color}50`, color: step.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>{step.icon}</span>
              <span style={{ fontSize: 13, color: 'rgba(232,234,240,0.8)', fontFamily: 'monospace' }}>{step.text}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function ICodeBlock({ lines }) {
    return (
      <div style={{ background: '#0d0f16', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '12px 14px', marginBottom: 12, fontFamily: 'monospace', fontSize: 12.5, lineHeight: 2 }}>
        {lines.map((l, i) => <div key={i} style={{ color: l.c }}>{l.t}</div>)}
      </div>
    );
  }

  function InstructionsModal({ onClose }) {
    const [active, setActive] = React.useState(0);
    const [animKey, setAnimKey] = React.useState(0);
    const [dir, setDir] = React.useState(1);
    const contentRef = React.useRef(null);
    const s = INSTR_SECTIONS[active];

    React.useEffect(() => {
      const handler = (e) => { if (e.key === 'Escape') onClose(); };
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }, [onClose]);

    React.useEffect(() => {
      if (contentRef.current) contentRef.current.scrollTop = 0;
    }, [active]);

    const goTo = (idx) => {
      if (idx === active) return;
      setDir(idx > active ? 1 : -1);
      setAnimKey(k => k + 1);
      setActive(idx);
    };

    const Content = s.content;

    return (
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 12000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(8px)' }}
        onClick={onClose}
      >
        <style>{`
          @keyframes instrSlideR { from { opacity:0; transform:translateX(16px); } to { opacity:1; transform:translateX(0); } }
          @keyframes instrSlideL { from { opacity:0; transform:translateX(-16px); } to { opacity:1; transform:translateX(0); } }
          @keyframes instrFadeIn { from { opacity:0; transform:scale(0.97) translateY(10px); } to { opacity:1; transform:scale(1) translateY(0); } }
          .instr-nav-btn:hover { background: rgba(255,255,255,0.04) !important; }
          .instr-close:hover { background: rgba(239,68,68,0.12) !important; border-color: #ef4444 !important; color: #ef4444 !important; }
          .instr-scroll::-webkit-scrollbar { width: 5px; }
          .instr-scroll::-webkit-scrollbar-track { background: transparent; }
          .instr-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
          .instr-footer-btn:hover { opacity: 0.85; }
        `}</style>

        <div
          style={{ width: '100%', maxWidth: 820, maxHeight: '88vh', display: 'flex', flexDirection: 'column', background: '#12131a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, overflow: 'hidden', boxShadow: '0 40px 100px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.03)', animation: 'instrFadeIn 0.25s cubic-bezier(0.34,1.3,0.64,1) forwards' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Top accent line */}
          <div style={{ height: 2, background: `linear-gradient(to right, transparent, ${s.color}, transparent)`, transition: 'background 0.35s', flexShrink: 0 }} />

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.15)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 9, height: 9, borderRadius: 3, background: '#f97316', boxShadow: '0 0 8px rgba(249,115,22,0.7)', flexShrink: 0 }} />
              <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(232,234,240,0.9)', fontFamily: 'system-ui' }}>
                Инструкция{' '}
                <span style={{ color: s.color, transition: 'color 0.3s' }}>Cicada Studio</span>
              </span>
            </div>
            <button
              className="instr-close"
              onClick={onClose}
              style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(232,234,240,0.4)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, transition: 'all 0.15s', fontFamily: 'system-ui' }}
            >✕</button>
          </div>

          {/* Body */}
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
            {/* Sidebar */}
            <div style={{ width: 170, flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column', padding: '6px 0', overflowY: 'auto' }}>
              {INSTR_SECTIONS.map((sec, i) => {
                const isAct = active === i;
                return (
                  <button
                    key={sec.id}
                    className="instr-nav-btn"
                    onClick={() => goTo(i)}
                    style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', background: isAct ? 'rgba(255,255,255,0.05)' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', transition: 'background 0.15s', width: '100%' }}
                  >
                    {isAct && <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: sec.color, boxShadow: `0 0 8px ${sec.color}`, borderRadius: '0 2px 2px 0' }} />}
                    <span style={{ fontSize: 16 }}>{sec.emoji}</span>
                    <span style={{ fontSize: 12, fontWeight: isAct ? 700 : 500, color: isAct ? 'rgba(232,234,240,0.95)' : 'rgba(232,234,240,0.38)', lineHeight: 1.3, transition: 'color 0.15s', fontFamily: 'system-ui' }}>{sec.label}</span>
                  </button>
                );
              })}
              {/* Progress dots */}
              <div style={{ marginTop: 'auto', padding: '12px 0', display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
                {INSTR_SECTIONS.map((sec, i) => (
                  <div key={i} onClick={() => goTo(i)} style={{ width: i === active ? 14 : 5, height: 5, borderRadius: 3, background: i === active ? s.color : 'rgba(255,255,255,0.1)', cursor: 'pointer', transition: 'all 0.25s', boxShadow: i === active ? `0 0 7px ${s.color}` : 'none' }} />
                ))}
              </div>
            </div>

            {/* Content area */}
            <div ref={contentRef} className="instr-scroll" style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
              <div key={animKey} style={{ animation: `${dir > 0 ? 'instrSlideR' : 'instrSlideL'} 0.2s ease forwards` }}>
                {/* Section header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 18 }}>
                  <div style={{ width: 50, height: 50, borderRadius: 12, flexShrink: 0, background: s.glow, border: `1.5px solid ${s.color}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: `0 0 18px ${s.glow}` }}>{s.emoji}</div>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: s.color, textShadow: `0 0 12px ${s.glow}`, transition: 'color 0.3s', fontFamily: 'system-ui' }}>{s.title}</h2>
                    <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'rgba(232,234,240,0.45)', lineHeight: 1.5, fontFamily: 'system-ui' }}>{s.subtitle}</p>
                  </div>
                </div>
                <div style={{ height: 1, background: `linear-gradient(to right, ${s.color}50, transparent)`, marginBottom: 18 }} />
                <Content />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{ flexShrink: 0, padding: '10px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button
              className="instr-footer-btn"
              onClick={() => goTo(Math.max(0, active - 1))}
              disabled={active === 0}
              style={{ padding: '6px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: active === 0 ? 'not-allowed' : 'pointer', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: active === 0 ? 'rgba(232,234,240,0.2)' : 'rgba(232,234,240,0.65)', transition: 'all 0.15s', fontFamily: 'system-ui' }}
            >← Назад</button>
            <span style={{ fontSize: 11, color: 'rgba(232,234,240,0.3)', fontFamily: 'monospace' }}>{active + 1} / {INSTR_SECTIONS.length}</span>
            <button
              className="instr-footer-btn"
              onClick={() => { if (active === INSTR_SECTIONS.length - 1) onClose(); else goTo(active + 1); }}
              style={{ padding: '6px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: active === INSTR_SECTIONS.length - 1 ? s.color + '20' : 'rgba(255,255,255,0.05)', border: `1px solid ${active === INSTR_SECTIONS.length - 1 ? s.color + '60' : 'rgba(255,255,255,0.1)'}`, color: active === INSTR_SECTIONS.length - 1 ? s.color : 'rgba(232,234,240,0.7)', transition: 'all 0.15s', fontFamily: 'system-ui' }}
            >{active === INSTR_SECTIONS.length - 1 ? '✓ Понятно!' : 'Далее →'}</button>
          </div>
        </div>
      </div>
    );
  }
  
  useEffect(() => {
    if (forceTotp) setTotpRequired(true);
  }, [forceTotp]);
