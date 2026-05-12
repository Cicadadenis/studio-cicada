import React from 'react';
import confetti from 'canvas-confetti';
import { postJsonWithCsrf } from './apiClient.js';

export function fireRegistrationConfetti() {
  const opts = { origin: { y: 0.72 }, zIndex: 10050 };
  const colors = ['#ffd700', '#f59e0b', '#fbbf24', '#22c55e', '#38bdf8', '#a78bfa', '#fb7185'];
  confetti({ ...opts, particleCount: 130, spread: 88, startVelocity: 42, colors });
  setTimeout(() => { confetti({ ...opts, particleCount: 85, angle: 58, spread: 52, colors }); }, 160);
  setTimeout(() => { confetti({ ...opts, particleCount: 85, angle: 122, spread: 52, colors }); }, 320);
  setTimeout(() => { confetti({ ...opts, particleCount: 70, spread: 100, scalar: 0.85, ticks: 220, colors }); }, 500);
}

export function useParticleCanvas(canvasRef) {
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf;
    let w = 0;
    let h = 0;
    const COLORS = [
      { r: 255, g: 90, b: 20 },
      { r: 255, g: 60, b: 0 },
      { r: 140, g: 60, b: 255 },
      { r: 100, g: 40, b: 200 },
      { r: 255, g: 130, b: 40 },
    ];
    let particles = [];
    let hexes = [];
    function resize() {
      w = canvas.offsetWidth;
      h = canvas.offsetHeight;
      canvas.width = w;
      canvas.height = h;
      init();
    }
    function init() {
      const count = Math.min(80, Math.floor((w * h) / 12000));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: Math.random() * 2 + 0.8,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        alpha: Math.random() * 0.5 + 0.2,
        pulse: Math.random() * Math.PI * 2,
        pulseSpeed: Math.random() * 0.02 + 0.005,
      }));
      hexes = Array.from({ length: 6 }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        size: Math.random() * 60 + 30,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.003,
        alpha: Math.random() * 0.06 + 0.02,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      }));
    }
    function drawHex(x, y, size, rotation, color, alpha) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.beginPath();
      for (let i = 0; i < 6; i += 1) {
        const a = (Math.PI / 3) * i;
        if (i === 0) ctx.moveTo(size * Math.cos(a), size * Math.sin(a));
        else ctx.lineTo(size * Math.cos(a), size * Math.sin(a));
      }
      ctx.closePath();
      ctx.strokeStyle = `rgba(${color.r},${color.g},${color.b},${alpha})`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
    function frame() {
      ctx.clearRect(0, 0, w, h);
      hexes.forEach((hex) => {
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
      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.pulse += p.pulseSpeed;
        if (p.x < 0) p.x = w;
        if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h;
        if (p.y > h) p.y = 0;
        const pa = p.alpha * (0.75 + 0.25 * Math.sin(p.pulse));
        const pr = p.r * (0.9 + 0.2 * Math.sin(p.pulse * 1.3));
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, pr * 4);
        grad.addColorStop(0, `rgba(${p.color.r},${p.color.g},${p.color.b},${pa})`);
        grad.addColorStop(1, `rgba(${p.color.r},${p.color.g},${p.color.b},0)`);
        ctx.beginPath();
        ctx.arc(p.x, p.y, pr * 4, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x, p.y, pr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color.r},${p.color.g},${p.color.b},${pa})`;
        ctx.fill();
      });
      const LINK = 140;
      for (let i = 0; i < particles.length; i += 1) {
        for (let j = i + 1; j < particles.length; j += 1) {
          const a = particles[i];
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < LINK) {
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            const cr = (a.color.r + b.color.r) / 2;
            const cg = (a.color.g + b.color.g) / 2;
            const cb = (a.color.b + b.color.b) / 2;
            ctx.strokeStyle = `rgba(${cr},${cg},${cb},${(1 - dist / LINK) * 0.18})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }
      raf = requestAnimationFrame(frame);
    }
    let ro = null;
    let useWindowResizeFallback = false;
    const onResize = () => resize();

    try {
      if (typeof ResizeObserver === 'function') {
        ro = new ResizeObserver(resize);
        ro.observe(canvas);
      } else {
        useWindowResizeFallback = true;
      }
    } catch {
      useWindowResizeFallback = true;
    }

    if (useWindowResizeFallback) {
      window.addEventListener('resize', onResize);
    }

    resize();
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      if (useWindowResizeFallback) window.removeEventListener('resize', onResize);
    };
  }, [canvasRef]);
}

export function translateServerError(msg) {
  if (!msg) return msg;
  const map = {
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
    'The operation either timed out or was not allowed': 'Операция отменена или истекло время ожидания. Попробуйте ещё раз',
    'privacy-considerations-client': 'Операция отменена или истекло время ожидания. Попробуйте ещё раз',
    NotAllowedError: 'Операция отменена или истекло время ожидания. Попробуйте ещё раз',
    'Invalid token': 'Недействительная ссылка',
    'Token expired': 'Срок действия ссылки истёк',
    'Token not found': 'Ссылка не найдена или уже использована',
    'Invalid reset token': 'Недействительная ссылка для сброса пароля',
    'Reset token expired': 'Ссылка для сброса пароля устарела',
    Unauthorized: 'Необходима авторизация',
    'Email not verified': 'Email не подтверждён — проверьте почту',
    'Please verify your email': 'Пожалуйста, подтвердите email',
    'Verification code is invalid': 'Неверный код подтверждения',
    'Verification code expired': 'Код подтверждения устарел',
    'Invalid code': 'Неверный код',
    'Internal server error': 'Ошибка сервера. Попробуйте позже',
    'Server error': 'Ошибка сервера. Попробуйте позже',
    'Too many requests': 'Слишком много попыток. Подождите немного',
    'Rate limit exceeded': 'Слишком много запросов. Попробуйте позже',
    'Network error': 'Ошибка сети. Проверьте подключение',
    'Request failed': 'Запрос не выполнен. Попробуйте ещё раз',
  };
  if (map[msg]) return map[msg];
  const lower = msg.toLowerCase();
  for (const [key, val] of Object.entries(map)) {
    if (lower === key.toLowerCase()) return val;
  }
  for (const [key, val] of Object.entries(map)) {
    if (lower.includes(key.toLowerCase())) return val;
  }
  return msg;
}

export async function telegramAuth(tgData) {
  const res = await postJsonWithCsrf('/api/auth/telegram', tgData);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.user;
}

function webauthnB64urlToBuffer(value) {
  let s = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function webauthnBufferToB64url(buffer) {
  const bytes = new Uint8Array(buffer || new ArrayBuffer(0));
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function prepareWebauthnOptions(options) {
  const publicKey = { ...(options || {}) };
  if (publicKey.challenge) publicKey.challenge = webauthnB64urlToBuffer(publicKey.challenge);
  ['allowCredentials', 'excludeCredentials'].forEach((key) => {
    if (Array.isArray(publicKey[key])) {
      publicKey[key] = publicKey[key].map((c) => ({ ...c, id: webauthnB64urlToBuffer(c.id) }));
    }
  });
  if (publicKey.user?.id) publicKey.user = { ...publicKey.user, id: webauthnB64urlToBuffer(publicKey.user.id) };
  return publicKey;
}

function serializeWebauthnCredential(credential, challenge) {
  const out = { id: credential.id, rawId: webauthnBufferToB64url(credential.rawId), type: credential.type, challenge, response: {} };
  ['clientDataJSON', 'attestationObject', 'authenticatorData', 'signature', 'userHandle'].forEach((key) => {
    if (credential.response?.[key]) out.response[key] = webauthnBufferToB64url(credential.response[key]);
  });
  return out;
}

export async function loginWithPasskey(email = '') {
  if (!window.PublicKeyCredential) throw new Error('Этот браузер не поддерживает passkey');
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const optionsRes = await postJsonWithCsrf('/api/passkey/login-options', normalizedEmail ? { email: normalizedEmail } : {});
  const options = await optionsRes.json().catch(() => ({}));
  if (!optionsRes.ok) throw new Error(options.error || 'Passkey не найден');
  const credential = await navigator.credentials.get({ publicKey: prepareWebauthnOptions(options.publicKey) });
  const verifyRes = await postJsonWithCsrf('/api/passkey/login', serializeWebauthnCredential(credential, options.challenge));
  const data = await verifyRes.json().catch(() => ({}));
  if (!verifyRes.ok || data.error) throw new Error(data.error || 'Не удалось войти по passkey');
  return data.user;
}

export async function registerProfilePasskey() {
  if (!window.PublicKeyCredential) throw new Error('Этот браузер не поддерживает passkey');
  const optionsRes = await postJsonWithCsrf('/api/passkey/register-options', {});
  const options = await optionsRes.json().catch(() => ({}));
  if (!optionsRes.ok) throw new Error(options.error || 'Не удалось подготовить passkey');
  const credential = await navigator.credentials.create({ publicKey: prepareWebauthnOptions(options.publicKey) });
  const verifyRes = await postJsonWithCsrf('/api/passkey/register', serializeWebauthnCredential(credential, options.challenge));
  const data = await verifyRes.json().catch(() => ({}));
  if (!verifyRes.ok || data.error) throw new Error(data.error || 'Не удалось сохранить passkey');
  return data.passkeys || [];
}
