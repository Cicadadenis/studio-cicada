import { getCsrfTokenForRequest, resetCsrfPrefetch } from './csrf.js';

export const API_URL = import.meta.env.VITE_API_URL ?? '/api';

const MOBILE_VIEW_BREAKPOINT = 768;
const MOBILE_TOUCH_LANDSCAPE_MAX_WIDTH = 1024;
const JWT_KEY = 'cicada_jwt';

export function isMobileBuilderViewport() {
  if (typeof window === 'undefined') return false;
  const hasTouch = typeof navigator !== 'undefined'
    ? navigator.maxTouchPoints > 0
    : false;
  const hasCoarsePointer = typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)').matches
    : false;
  return window.innerWidth < MOBILE_VIEW_BREAKPOINT
    || ((hasTouch || hasCoarsePointer) && window.innerWidth < MOBILE_TOUCH_LANDSCAPE_MAX_WIDTH);
}

export function resolveApiAssetUrl(url) {
  if (!url || typeof url !== 'string') return '';
  if (/^(?:data:|blob:|https?:\/\/)/i.test(url)) return url;
  if (!url.startsWith('/api/')) return url;
  try {
    const apiBase = new URL(API_URL, window.location.origin);
    return new URL(url, apiBase.origin).toString();
  } catch {
    return url;
  }
}

export function getStoredJwt() {
  return null;
}

export function storeJwt(token) {
  localStorage.removeItem(JWT_KEY);
}

export function clearJwt() {
  resetCsrfPrefetch();
  localStorage.removeItem(JWT_KEY);
}

export async function apiFetch(url, options = {}, retryCsrf = true) {
  const method = (options.method || 'GET').toUpperCase();
  const csrfHeaders = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
    ? { 'x-csrf-token': await getCsrfTokenForRequest(url) }
    : {};
  const mergedHeaders = { ...csrfHeaders, ...(options.headers || {}) };
  let res;
  try {
    res = await fetch(url, { credentials: 'include', ...options, headers: mergedHeaders });
  } catch {
    throw new Error('⚠️ Сервер не запущен или недоступен');
  }

  if (res.status === 401) {
    clearJwt();
    localStorage.removeItem('cicada_session');
    window.dispatchEvent(new CustomEvent('cicada:session-expired'));
    throw new Error('⚠️ Сессия истекла — войдите заново');
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
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

export async function postJsonWithCsrf(url, body, retryCsrf = true) {
  const token = await getCsrfTokenForRequest(url);
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': token,
    },
    body: JSON.stringify(body ?? {}),
  });
  if (retryCsrf && res.status === 403) {
    const data = await res.clone().json().catch(() => ({}));
    if (typeof data?.error === 'string' && data.error.includes('CSRF')) {
      resetCsrfPrefetch();
      return postJsonWithCsrf(url, body, false);
    }
  }
  return res;
}

export async function fetchOauthBootstrapUser() {
  const params = new URLSearchParams();
  if (typeof window !== 'undefined') {
    const code = new URLSearchParams(window.location.search).get('oauth_login');
    if (code) params.set('code', code);
  }
  const qs = params.toString();
  const r = await fetch(`${API_URL}/auth/oauth-bootstrap${qs ? `?${qs}` : ''}`, { credentials: 'include' });
  const data = await r.json().catch(() => ({}));
  if (data?.twofaRequired && data?.user) {
    const e = new Error('Требуется код 2FA');
    e.twofaRequired = true;
    e.user = data.user;
    throw e;
  }
  if (data?.ok && data.user) {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (url.searchParams.has('oauth_login')) {
        url.searchParams.delete('oauth_login');
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      }
    }
    return data.user;
  }
  return null;
}

export async function completeOauth2FA(totp = '') {
  const res = await postJsonWithCsrf('/api/auth/oauth-2fa/complete', { totp });
  const data = await res.json().catch(() => ({}));
  if (data?.twofaRequired) {
    const e = new Error(data.error || 'Неверный код 2FA');
    e.twofaRequired = true;
    throw e;
  }
  if (data?.error) throw new Error(data.error);
  return data.user;
}

export async function registerUser(name, email, password) {
  return await apiFetch(`${API_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });
}

export async function loginUser(email, password, totp = '') {
  const res = await postJsonWithCsrf(`${API_URL}/login`, { email, password, totp });
  const data = await res.json().catch(() => ({}));
  if (data?.twofaRequired) {
    const e = new Error(data.error || 'Требуется код 2FA');
    e.twofaRequired = true;
    throw e;
  }
  if (data?.error) throw new Error(data.error);
  return data.user;
}

export async function forgotPassword(email) {
  return await apiFetch(`${API_URL}/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(token, password) {
  return await apiFetch(`${API_URL}/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password }),
  });
}

export async function requestEmailChange(userId, currentEmail, newEmail) {
  return await apiFetch(`${API_URL}/request-email-change`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, currentEmail, newEmail }),
  });
}

export async function confirmEmailChange(userId, code, newEmail) {
  return await apiFetch(`${API_URL}/confirm-email-change`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, code, newEmail }),
  });
}

export async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function updateUser(userId, updates, currentUser = null) {
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
    normalized.photo_url = Object.prototype.hasOwnProperty.call(rawUser, 'photo_url')
      ? (rawUser.photo_url ?? null)
      : (updates.photo_url ?? null);
  }

  if (Object.prototype.hasOwnProperty.call(updates || {}, 'ui_language')) {
    normalized.uiLanguage = String(updates.ui_language || 'ru').toLowerCase();
  } else if (!normalized.uiLanguage && rawUser?.ui_language) {
    normalized.uiLanguage = String(rawUser.ui_language).toLowerCase();
  }

  return normalized;
}

export async function uploadAvatar(userId, dataUrl, currentUser = null) {
  const data = await apiFetch(`${API_URL}/avatar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, dataUrl }),
  });
  const rawUser = data?.user || {};
  const normalized = {
    ...(currentUser || {}),
    ...rawUser,
  };
  if (Object.prototype.hasOwnProperty.call(rawUser, 'photo_url')) {
    normalized.photo_url = rawUser.photo_url ?? null;
  }
  return normalized;
}

export function saveSession(user) {
  if (user) {
    localStorage.setItem('cicada_session', JSON.stringify(user));
  } else {
    localStorage.removeItem('cicada_session');
  }
}

export function getSession() {
  try {
    const data = localStorage.getItem('cicada_session');
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  resetCsrfPrefetch();
  localStorage.removeItem('cicada_session');
  clearJwt();
}

export async function fetchSessionUserFromServer() {
  try {
    const data = await apiFetch(`${API_URL}/me`);
    return data?.user ?? null;
  } catch {
    return null;
  }
}
