/**
 * TOTP (RFC 6238, SHA-1, 30s, 6 digits) — совместимо с Google Authenticator и аналогами.
 * Секрет в .env: Base32 (A–Z, 2–7), без пробелов, не короче 16 символов после нормализации.
 */
import crypto from 'crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function normalizeAdminTotpSecret(raw) {
  const s = String(raw || '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
  if (s.length < 16) return null;
  try {
    base32ToBuffer(s);
    return s;
  } catch {
    return null;
  }
}

function base32ToBuffer(encoded) {
  let bits = 0;
  let value = 0;
  const output = [];
  for (const char of encoded) {
    const idx = BASE32.indexOf(char);
    if (idx === -1) throw new Error('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function totpCodeAt(keyB32, unixMs, stepSec, digits) {
  const key = base32ToBuffer(keyB32);
  const counter = Math.floor(unixMs / 1000 / stepSec);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter), 0);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const mod = 10 ** digits;
  return String(bin % mod).padStart(digits, '0');
}

/**
 * @param {string} keyB32 — нормализованный Base32-секрет
 * @param {string} token — ввод пользователя
 * @param {number} window — допуск по интервалам 30s в каждую сторону (1 = ±30s)
 */
export function verifyTotp(keyB32, token, window = 1) {
  const clean = String(token || '').replace(/\s/g, '').replace(/\D/g, '');
  if (clean.length !== 6) return false;
  const now = Date.now();
  const stepMs = 30_000;
  for (let w = -window; w <= window; w += 1) {
    const expected = totpCodeAt(keyB32, now + w * stepMs, 30, 6);
    if (expected.length === clean.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) {
      return true;
    }
  }
  return false;
}
