let csrfCache = null;
let inflight = null;

export function resetCsrfPrefetch() {
  csrfCache = null;
  inflight = null;
}

function csrfEndpoint(apiBaseOrRequestUrl = import.meta.env.VITE_API_URL || '/api') {
  const raw = String(apiBaseOrRequestUrl || import.meta.env.VITE_API_URL || '/api').trim();
  const absolute = /^https?:\/\//i.test(raw);
  const fallbackOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const url = new URL(raw.startsWith('/') || absolute ? raw : `/${raw}`, fallbackOrigin);
  const path = url.pathname.replace(/\/+$/, '') || '/api';
  const apiIndex = path.indexOf('/api/');

  if (path.endsWith('/api')) {
    url.pathname = `${path}/csrf-token`;
  } else if (apiIndex >= 0) {
    url.pathname = `${path.slice(0, apiIndex + 4)}/csrf-token`;
  } else {
    url.pathname = `${path}/csrf-token`;
  }
  url.search = '';

  return absolute ? url.toString() : url.pathname;
}

/** Токен для заголовка x-csrf-token (cookie выставляет GET {API_URL}/csrf-token). */
export async function getCsrfTokenForRequest(apiBaseOrRequestUrl) {
  const endpoint = csrfEndpoint(apiBaseOrRequestUrl);
  if (csrfCache?.endpoint === endpoint) return csrfCache.token;
  if (!inflight || inflight.endpoint !== endpoint) {
    const promise = fetch(endpoint, { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error('CSRF: не удалось получить токен');
        return r.json();
      })
      .then((d) => {
        if (!d?.csrfToken) throw new Error('CSRF: неверный ответ сервера');
        csrfCache = { endpoint, token: d.csrfToken };
        return csrfCache.token;
      })
      .finally(() => {
        inflight = null;
      });
    inflight = { endpoint, promise };
  }
  return inflight.promise;
}
