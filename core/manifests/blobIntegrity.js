/**
 * Слой целостности блобов: contentDigest (sha256:…), CAS URI, верификация.
 * Дальше: storage с cache://sha256/<hex> — URI совпадает с идентичностью содержимого.
 */

import { stableStringify } from './hashes.js';

export const CONTENT_DIGEST_PREFIX = 'sha256:';

/** @param {string} blobKey */
export function graphBlobDigestKey(blobKey) {
  return `${blobKey}Digest`;
}

const DIGEST_RE = /^sha256:([a-f0-9]{64})$/i;
const HEX64_RE = /^[a-f0-9]{64}$/i;

/**
 * Нормализует digest к виду sha256:&lt;lower-hex64&gt;.
 * @param {string} raw — sha256:… или 64 hex
 */
export function normalizeContentDigest(raw) {
  const s = String(raw || '').trim();
  if (!s) throw new Error('contentDigest: пустая строка');
  const m = s.match(DIGEST_RE);
  if (m) return `${CONTENT_DIGEST_PREFIX}${m[1].toLowerCase()}`;
  if (HEX64_RE.test(s)) return `${CONTENT_DIGEST_PREFIX}${s.toLowerCase()}`;
  throw new Error(`contentDigest: ожидался ${CONTENT_DIGEST_PREFIX}<64 hex> или 64 hex, получено: ${s.slice(0, 32)}…`);
}

/**
 * @param {string} digest
 * @returns {string | null} 64 hex без префикса
 */
export function contentDigestHex(digest) {
  try {
    const n = normalizeContentDigest(digest);
    return n.slice(CONTENT_DIGEST_PREFIX.length);
  } catch {
    return null;
  }
}

/** CAS URI: содержимое адресуется самим дайджестом. */
export function casUriFromContentDigest(digest) {
  const hex = contentDigestHex(digest);
  if (!hex) throw new Error('casUri: неверный digest');
  return `cache://sha256/${hex}`;
}

/**
 * Если URI указывает на CAS sha256, возвращает нормализованный digest.
 * @param {string} uri
 * @returns {string | null}
 */
export function contentDigestFromCasUri(uri) {
  if (typeof uri !== 'string') return null;
  const m = uri.trim().match(/^cache:\/\/sha256\/([a-f0-9]{64})$/i);
  if (!m) return null;
  try {
    return normalizeContentDigest(m[1]);
  } catch {
    return null;
  }
}

async function sha256HexOfBuffer(buf) {
  const crypto_ = globalThis.crypto;
  if (!crypto_?.subtle) {
    throw new Error('Web Crypto (crypto.subtle) недоступен: нельзя посчитать sha256');
  }
  const hash = await crypto_.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** @param {string} text */
export async function contentDigestUtf8(text) {
  const enc = new TextEncoder();
  const hex = await sha256HexOfBuffer(enc.encode(text));
  return `${CONTENT_DIGEST_PREFIX}${hex}`;
}

/** Детерминированный JSON → sha256 (как при выкладке в blob store). */
export async function contentDigestCanonicalJson(value) {
  return contentDigestUtf8(stableStringify(value));
}

/**
 * Сравнение дайджестов (после нормализации).
 * @param {string} a
 * @param {string} b
 */
export function contentDigestsEqual(a, b) {
  try {
    return normalizeContentDigest(a) === normalizeContentDigest(b);
  } catch {
    return false;
  }
}

/**
 * Проверяет, что canonical JSON payload даёт ожидаемый digest.
 * @param {unknown} payload
 * @param {string} expectedDigest
 */
export async function verifyContentDigestCanonicalJson(payload, expectedDigest) {
  const got = await contentDigestCanonicalJson(payload);
  return contentDigestsEqual(got, expectedDigest);
}
