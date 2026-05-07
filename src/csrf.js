let csrfCache = null;
let inflight = null;

export function resetCsrfPrefetch() {
  csrfCache = null;
}

/** Токен для заголовка x-csrf-token (cookie выставляет GET /api/csrf-token). */
export async function getCsrfTokenForRequest() {
  if (csrfCache) return csrfCache;
  if (!inflight) {
    inflight = fetch('/api/csrf-token', { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error('CSRF: не удалось получить токен');
        return r.json();
      })
      .then((d) => {
        if (!d?.csrfToken) throw new Error('CSRF: неверный ответ сервера');
        csrfCache = d.csrfToken;
        return csrfCache;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}
