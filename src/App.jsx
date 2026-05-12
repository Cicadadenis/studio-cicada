import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import cicadaLogo from './cicada-logo_1778117072446.jpeg';
import { ModuleLibraryModal } from './ModuleLibrary';
import InstructionsModal from './InstructionsModal.jsx';
import LandingInfoModal from './landing/LandingInfoModal.jsx';
import AuthModal from './auth/AuthModal.jsx';
import ProfileModal from './profile/ProfileModal.jsx';
import {
  BLOCK_TYPES,
  BLOCK_FOOTER_ACTION_TYPES,
  BLOCK_W,
  BLOCK_H,
  ROOT_H,
  MOBILE_TOP_BAR_H,
  MOBILE_BOTTOM_NAV_H,
  DEFAULT_PROPS,
  normalizeStudioBlockNode,
  normalizeStudioStacks,
  createStudioBlockNode,
  UI_ATTACHMENT_LEGACY_BLOCK_TYPES,
  legacyBlockToUiAttachment,
  addUiAttachment,
  canStackBelow,
  getStackBlocksHeight,
  getBlockTopInStack,
  findNewBlockSnapTarget,
  snapAttachRejectHint,
  hasBlockOfType,
  normalizeCommandName,
  hasCommandNamed,
  getNextAvailableCommandName,
  getUniqueBlockConflictMessage,
  resolveBotTokenForNewBlock,
  inferPropsFromParent,
  normalizeAiPartialResponse,
  uid,
  resetUidSequence,
  AiDiagnosticSection,
  BlockInfoModal,
  BlockShape,
  BlockStack,
  Sidebar,
  PropsPanel,
} from './builder/BuilderComponents.jsx';
import DSLPane, { fixDslSchema } from './builder/DSLPane.jsx';
import { lintDSLSchema } from '../core/validator/schema.js';
import { canRenderUi, stackToDSL } from '../core/stacksToDsl.js';
import { getCsrfTokenForRequest } from './csrf.js';
import {
  localizeBlockTypes,
  getConstructorStrings,
} from './builderI18n.js';
import {
  API_URL,
  apiFetch,
  postJsonWithCsrf,
  saveSession,
  getSession,
  clearSession,
  fetchSessionUserFromServer,
  fetchOauthBootstrapUser,
  completeOauth2FA,
  registerUser,
  loginUser,
  updateUser,
  uploadAvatar,
  isMobileBuilderViewport,
} from './apiClient.js';
import { BlockInfoContext, AddBlockContext, BuilderUiContext } from './builderContext.js';
import {
  fireRegistrationConfetti,
  telegramAuth,
  loginWithPasskey,
} from './authHelpers.js';
import { FALLBACK_PRO_MONTHLY_USD, fetchPublicPlans, formatUsdPrice, getMonthlyProPriceUsd } from './pricingPlans.js';

// ═══════════════════════════════════════════════════════════════════════════
// PROJECTS STORAGE — PostgreSQL via API
// ═══════════════════════════════════════════════════════════════════════════

async function saveProjectToCloud(_userId, projectName, stacks) {
  const data = await apiFetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: projectName, stacks: normalizeStudioStacks(stacks) }),
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


// Re-export from users.js for compatibility

// ─── BLOCK INFO CONTEXT ──────────────────────────────────────────────────────

const LANDING_PAGE_CONTENT = {
  features:  { type: 'features',  title: 'Возможности' },
  templates: { type: 'templates', title: 'Шаблоны' },
  docs:      { type: 'docs',      title: 'Документация' },
  pricing:   { type: 'pricing',   title: 'Тарифы' },
};

// ─── BLOCK DEFINITIONS ───────────────────────────────────────────────────────

function PremiumLockedPanel({ title = 'Функция доступна в Pro', text = 'Оформи Premium, чтобы открыть этот раздел.', onUpgrade, isMobile = false }) {
  return (
    <div style={{
      flex: isMobile ? '1 1 auto' : '0 0 50%',
      minHeight: isMobile ? 0 : 180,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: isMobile ? 18 : 20,
      borderTop: '1px solid rgba(178,128,255,0.22)',
      background: 'linear-gradient(180deg, rgba(255,255,255,0.018), rgba(111,70,255,0.06))',
    }}>
      <button
        type="button"
        onClick={onUpgrade}
        style={{
          width: '100%',
          maxWidth: 260,
          padding: '18px 16px',
          borderRadius: 18,
          border: '1px solid rgba(251,191,36,0.34)',
          background: 'linear-gradient(145deg, rgba(251,191,36,0.09), rgba(111,70,255,0.12))',
          color: 'rgba(255,255,255,0.78)',
          cursor: 'pointer',
          textAlign: 'center',
          fontFamily: 'Syne, system-ui',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 14px 34px rgba(4,1,20,0.24)',
          filter: 'saturate(0.72)',
        }}
      >
        <div style={{ fontSize: 30, marginBottom: 8 }}>🔒</div>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#fde68a', marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 11, lineHeight: 1.45, color: 'rgba(255,255,255,0.48)' }}>{text}</div>
      </button>
    </div>
  );
}

function AdminRoute({ currentUser, onLoginClick }) {
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!currentUser) return undefined;
    if (currentUser.role !== 'admin') {
      setError('Доступ только для администратора');
      return undefined;
    }

    let cancelled = false;
    async function loadAdminUi() {
      try {
        await apiFetch('/api/admin/enter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const res = await fetch('/api/admin/ui', {
          credentials: 'include',
        });
        if (!res.ok) throw new Error(res.status === 403 ? 'Нет прав администратора' : 'Не удалось загрузить админку');
        const raw = await res.text();
        if (!cancelled) setHtml(raw);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Не удалось открыть админку');
      }
    }
    loadAdminUi();
    return () => { cancelled = true; };
  }, [currentUser]);

  useEffect(() => {
    const handleAdminMessage = (event) => {
      if (event?.data?.type === 'cicada-admin:navigate-builder') {
        window.location.assign('/');
      }
    };
    window.addEventListener('message', handleAdminMessage);
    return () => window.removeEventListener('message', handleAdminMessage);
  }, []);

  if (!currentUser) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#08070f', color: '#fff', fontFamily: 'system-ui,sans-serif', padding: 20 }}>
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ margin: '0 0 10px', fontFamily: 'Syne,system-ui' }}>Админка защищена</h1>
          <p style={{ color: 'rgba(255,255,255,0.65)', lineHeight: 1.5 }}>Войдите в аккаунт администратора, чтобы открыть панель.</p>
          <button type="button" onClick={onLoginClick} style={{ marginTop: 12, padding: '11px 18px', borderRadius: 12, border: 0, background: '#f59e0b', color: '#111', fontWeight: 800, cursor: 'pointer' }}>Войти</button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#08070f', color: '#fff', fontFamily: 'system-ui,sans-serif', padding: 20 }}>
        <div style={{ maxWidth: 460, textAlign: 'center' }}>
          <h1 style={{ margin: '0 0 10px', fontFamily: 'Syne,system-ui' }}>Доступ закрыт</h1>
          <p style={{ color: 'rgba(255,255,255,0.65)', lineHeight: 1.5 }}>{error}</p>
          <button type="button" onClick={() => { window.location.href = '/'; }} style={{ marginTop: 12, padding: '11px 18px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Вернуться в конструктор</button>
        </div>
      </div>
    );
  }

  if (!html) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#08070f', color: 'rgba(255,255,255,0.76)', fontFamily: 'system-ui,sans-serif' }}>
        Загрузка админки...
      </div>
    );
  }

  return (
    <iframe
      title="Cicada Admin"
      srcDoc={html}
      sandbox="allow-scripts allow-forms allow-downloads allow-modals allow-same-origin allow-top-navigation-by-user-activation"
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 0, background: '#0e0f11' }}
    />
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
    localStorage.setItem(key, JSON.stringify({ stacks: normalizeStudioStacks(stacks), offset, scale }));
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

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || '');
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = () => reject(r.error || new Error('read failed'));
    r.readAsDataURL(file);
  });
}

const TELEGRAM_HTML_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'code', 'pre', 'a']);
const HTML_ENTITY_MAP = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeHtmlEntities(text) {
  return String(text ?? '').replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, ent) => {
    if (ent[0] === '#') {
      const n = ent[1]?.toLowerCase() === 'x'
        ? Number.parseInt(ent.slice(2), 16)
        : Number.parseInt(ent.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return HTML_ENTITY_MAP[ent] ?? m;
  });
}

function safePreviewHref(href) {
  const s = String(href || '').trim();
  return /^(https?:|tg:|mailto:)/i.test(s) ? s : '';
}

function parseTelegramHtmlText(text) {
  const root = { tag: null, children: [] };
  const stack = [root];
  const re = /<\/?([a-zA-Z][\w-]*)(?:\s+[^>]*)?>/g;
  let last = 0;
  let m;

  const pushText = (value) => {
    if (value) stack[stack.length - 1].children.push(decodeHtmlEntities(value));
  };

  while ((m = re.exec(String(text ?? '')))) {
    pushText(String(text ?? '').slice(last, m.index));
    const raw = m[0];
    const tag = String(m[1] || '').toLowerCase();
    last = re.lastIndex;
    if (!TELEGRAM_HTML_TAGS.has(tag)) {
      pushText(raw);
      continue;
    }
    if (raw.startsWith('</')) {
      const idx = stack.findLastIndex((node) => node.tag === tag);
      if (idx > 0) stack.length = idx;
      continue;
    }
    const hrefMatch = tag === 'a' ? raw.match(/\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i) : null;
    const node = {
      tag,
      attrs: hrefMatch ? { href: decodeHtmlEntities(hrefMatch[1] || hrefMatch[2] || hrefMatch[3] || '') } : {},
      children: [],
    };
    stack[stack.length - 1].children.push(node);
    if (!raw.endsWith('/>')) stack.push(node);
  }
  pushText(String(text ?? '').slice(last));
  return root.children;
}

function findUnescapedMarker(text, marker, start) {
  let i = start;
  while (i < text.length) {
    const at = text.indexOf(marker, i);
    if (at < 0) return -1;
    let slashes = 0;
    for (let j = at - 1; j >= 0 && text[j] === '\\'; j -= 1) slashes += 1;
    if (slashes % 2 === 0) return at;
    i = at + marker.length;
  }
  return -1;
}

function parseTelegramMarkdownV2Text(input) {
  const text = String(input ?? '');
  const nodes = [];
  let plain = '';
  let i = 0;

  const flush = () => {
    if (plain) {
      nodes.push(plain);
      plain = '';
    }
  };

  while (i < text.length) {
    if (text[i] === '\\' && i + 1 < text.length) {
      plain += text[i + 1];
      i += 2;
      continue;
    }

    if (text.startsWith('```', i)) {
      const end = findUnescapedMarker(text, '```', i + 3);
      if (end > i) {
        flush();
        nodes.push({ tag: 'pre', children: [text.slice(i + 3, end)] });
        i = end + 3;
        continue;
      }
    }

    if (text[i] === '`') {
      const end = findUnescapedMarker(text, '`', i + 1);
      if (end > i) {
        flush();
        nodes.push({ tag: 'code', children: [text.slice(i + 1, end)] });
        i = end + 1;
        continue;
      }
    }

    const marker = text.startsWith('__', i) ? '__' : text.startsWith('||', i) ? '||' : text[i];
    const tag = marker === '__' ? 'u'
      : marker === '||' ? 'spoiler'
      : marker === '*' ? 'strong'
      : marker === '_' ? 'em'
      : marker === '~' ? 's'
      : null;
    if (tag) {
      const end = findUnescapedMarker(text, marker, i + marker.length);
      if (end > i) {
        flush();
        nodes.push({ tag, children: parseTelegramMarkdownV2Text(text.slice(i + marker.length, end)) });
        i = end + marker.length;
        continue;
      }
    }

    if (text[i] === '[') {
      const labelEnd = findUnescapedMarker(text, ']', i + 1);
      if (labelEnd > i && text[labelEnd + 1] === '(') {
        const urlEnd = findUnescapedMarker(text, ')', labelEnd + 2);
        if (urlEnd > labelEnd) {
          flush();
          nodes.push({
            tag: 'a',
            attrs: { href: text.slice(labelEnd + 2, urlEnd).replace(/\\(.)/g, '$1') },
            children: parseTelegramMarkdownV2Text(text.slice(i + 1, labelEnd)),
          });
          i = urlEnd + 1;
          continue;
        }
      }
    }

    plain += text[i];
    i += 1;
  }

  flush();
  return nodes;
}

function renderPreviewRichNode(node, key) {
  if (typeof node === 'string') return <React.Fragment key={key}>{node}</React.Fragment>;
  const children = (node.children || []).map((child, i) => renderPreviewRichNode(child, `${key}.${i}`));
  switch (node.tag) {
    case 'b':
    case 'strong':
      return <strong key={key}>{children}</strong>;
    case 'i':
    case 'em':
      return <em key={key}>{children}</em>;
    case 'u':
    case 'ins':
      return <span key={key} style={{ textDecoration: 'underline', textUnderlineOffset: 2 }}>{children}</span>;
    case 's':
    case 'strike':
    case 'del':
      return <span key={key} style={{ textDecoration: 'line-through' }}>{children}</span>;
    case 'code':
      return <code key={key} style={{ background: 'rgba(15,23,42,0.75)', borderRadius: 4, padding: '1px 4px' }}>{children}</code>;
    case 'pre':
      return <code key={key} style={{ display: 'block', background: 'rgba(15,23,42,0.75)', borderRadius: 6, padding: '6px 7px', margin: '3px 0', whiteSpace: 'pre-wrap' }}>{children}</code>;
    case 'a': {
      const href = safePreviewHref(node.attrs?.href);
      if (!href) return <span key={key}>{children}</span>;
      return <a key={key} href={href} target="_blank" rel="noreferrer" style={{ color: '#93c5fd' }}>{children}</a>;
    }
    case 'spoiler':
      return <span key={key} style={{ background: 'rgba(148,163,184,0.35)', borderRadius: 3, padding: '0 2px' }}>{children}</span>;
    default:
      return <React.Fragment key={key}>{children}</React.Fragment>;
  }
}

function PreviewRichText({ text, format }) {
  const fmt = String(format || '').toLowerCase();
  const nodes = fmt === 'html'
    ? parseTelegramHtmlText(text)
    : (fmt === 'markdown_v2' || fmt === 'markdownv2')
      ? parseTelegramMarkdownV2Text(text)
      : [String(text ?? '')];
  return <>{nodes.map((node, i) => renderPreviewRichNode(node, `pvrt.${i}`))}</>;
}

function previewFormatFromOutbound(o) {
  const parseMode = String(o?.parse_mode || o?.parseMode || o?.params?.parse_mode || '').toLowerCase();
  if (o?.type === 'html' || parseMode === 'html') return 'html';
  if (o?.type === 'markdown_v2' || parseMode === 'markdownv2' || parseMode === 'markdown_v2') return 'markdown_v2';
  return '';
}

function previewOutboundToEntries(outbound) {
  const skip = new Set(['answer_callback', 'set_commands']);
  const entries = [];
  for (const o of outbound || []) {
    if (skip.has(o.type)) continue;
    const format = previewFormatFromOutbound(o);
    if (o.type === 'send_message' || o.type === 'markdown' || o.type === 'html' || o.type === 'markdown_v2') {
      entries.push({ role: 'bot', kind: 'text', text: o.text ?? '', format });
    } else if (o.type === 'reply_keyboard') {
      entries.push({
        role: 'bot',
        kind: 'reply_keyboard',
        text: o.text ?? '',
        format,
        keyboard: Array.isArray(o.keyboard) ? o.keyboard : [],
      });
    } else if (o.type === 'inline_keyboard') {
      entries.push({
        role: 'bot',
        kind: 'inline_keyboard',
        text: o.text ?? '',
        format,
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

function OnboardingTour({ steps, stepIndex, onNext, onPrev, onSkip, labels }) {
  const step = steps[stepIndex];
  const [targetRect, setTargetRect] = useState(null);
  const L = labels || {};
  const stepOf = typeof L.tourStepOf === 'function'
    ? L.tourStepOf(stepIndex + 1, steps.length)
    : `Шаг ${stepIndex + 1} из ${steps.length}`;
  const skipLabel = L.tourSkip || 'Пропустить';
  const backLabel = L.tourBack || 'Назад';
  const nextLabel = L.tourNext || 'Далее';
  const doneLabel = L.tourDone || 'Готово';

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
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 768;
  const tourGap = 12;
  const cardWidth = Math.min(340, Math.max(260, viewportWidth - tourGap * 2));
  const cardMaxHeight = Math.min(360, Math.max(220, viewportHeight - tourGap * 2));
  const clampTour = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));
  const prefersSideCard = targetRect && (
    targetRect.height > viewportHeight * 0.35 ||
    targetRect.width > viewportWidth * 0.45
  );
  const rightCardLeft = targetRect ? targetRect.left + targetRect.width + tourGap : 0;
  const leftCardLeft = targetRect ? targetRect.left - cardWidth - tourGap : 0;
  const canPlaceRight = targetRect && rightCardLeft + cardWidth <= viewportWidth - tourGap;
  const canPlaceLeft = targetRect && leftCardLeft >= tourGap;
  let cardTop = targetRect
    ? clampTour(targetRect.top + targetRect.height + tourGap, tourGap, viewportHeight - cardMaxHeight - tourGap)
    : clampTour((viewportHeight - cardMaxHeight) / 2, tourGap, viewportHeight - cardMaxHeight - tourGap);
  let cardLeft = targetRect
    ? clampTour(targetRect.left, tourGap, viewportWidth - cardWidth - tourGap)
    : clampTour((viewportWidth - cardWidth) / 2, tourGap, viewportWidth - cardWidth - tourGap);

  if (targetRect && prefersSideCard && (canPlaceRight || canPlaceLeft)) {
    cardLeft = canPlaceRight ? rightCardLeft : leftCardLeft;
    cardTop = clampTour(targetRect.top + 8, tourGap, viewportHeight - cardMaxHeight - tourGap);
  }

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
          width: cardWidth,
          maxHeight: `calc(100vh - ${tourGap * 2}px)`,
          background: 'linear-gradient(160deg,#0d0920,#10082a)',
          border: '1px solid rgba(249,115,22,0.35)',
          borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 0 24px rgba(249,115,22,0.1)',
          pointerEvents: 'auto',
          backdropFilter: 'blur(12px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '14px 14px 10px', overflowY: 'auto', minHeight: 0 }}>
          <div style={{ fontSize: 10, color: 'rgba(249,115,22,0.8)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 6 }}>
            {stepOf}
          </div>
          <div style={{ fontFamily: 'Syne,system-ui', fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 7 }}>
            {step.title}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.55, color: 'rgba(255,255,255,0.72)' }}>
            {step.text}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', padding: '10px 14px 14px', borderTop: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
          <button
            onClick={onSkip}
            style={{ background: 'transparent', color: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '7px 10px', fontSize: 12, cursor: 'pointer' }}
          >
            {skipLabel}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onPrev}
              disabled={stepIndex === 0}
              style={{ background: 'rgba(255,255,255,0.05)', color: stepIndex === 0 ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '7px 10px', fontSize: 12, cursor: stepIndex === 0 ? 'not-allowed' : 'pointer' }}
            >
              {backLabel}
            </button>
            <button
              onClick={onNext}
              style={{ background: 'linear-gradient(135deg,#f97316,#dc2626)', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(249,115,22,0.4)' }}
            >
              {isLast ? doneLabel : nextLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Этапы для оверлея во время AI-генерации схемы бота */
const AI_GEN_LOADING_STEPS = [
  'Анализирую',
  'Исправляю структуру',
  'Оптимизирую сценарий для стабильного выполнения...',
  'Проверяю сценарии',
  'Готово',
];
const AI_PROMPT_MAX_CHARS = 50;

// ─── MAIN APP ─────────────────────────────────────────────────────────────
export default function App() {
  const [currentUser, setCurrentUser] = useState(() => getSession());
  const uiLang = (currentUser?.uiLanguage || 'ru').toLowerCase();
  const builderBlockTypes = React.useMemo(() => localizeBlockTypes(BLOCK_TYPES, uiLang), [uiLang]);
  const builderUi = React.useMemo(() => getConstructorStrings(uiLang), [uiLang]);
  const canvasStorageKey = React.useMemo(() => canvasKeyForUser(currentUser), [currentUser?.id]);

  const [stacks, setStacks] = useState([]);
  const [selectedBlockId, setSelectedBlockId] = useState(null);
  const [selectedStackId, setSelectedStackId] = useState(null);
  const [mobileAttentionBlockId, setMobileAttentionBlockId] = useState(null);
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
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileInitialTab, setProfileInitialTab] = useState('profile');
  const [authTab, setAuthTab] = useState('login'); // 'login' | 'register'
  const [oauth2faPending, setOauth2faPending] = useState(false);
  const [userProjects, setUserProjects] = useState([]);
  const [projectName, setProjectName] = useState('');
  const [showExamples, setShowExamples] = useState(false);
  /** Якорь кнопки «Примеры» — меню рендерим в portal, иначе перекрывается холстом / stacking context шапки */
  const examplesToggleRef = useRef(null);
  const [examplesMenuRect, setExamplesMenuRect] = useState(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiLoadingStep, setAiLoadingStep] = useState(0);
  const [aiError, setAiError] = useState('');
  const [aiPartialResult, setAiPartialResult] = useState(null);
  const [aiDiagnosticsOpen, setAiDiagnosticsOpen] = useState(false);
  const [showPythonConvertModal, setShowPythonConvertModal] = useState(false);
  const [pythonConvertSource, setPythonConvertSource] = useState('');
  const [pythonConvertResult, setPythonConvertResult] = useState('');
  const [pythonConvertMeta, setPythonConvertMeta] = useState(null);
  const [pythonConvertLoading, setPythonConvertLoading] = useState(false);
  const [pythonConvertError, setPythonConvertError] = useState('');
  const [landingInfoPage, setLandingInfoPage] = useState(null); // features | templates | docs | pricing | null
  const [proMonthlyUsd, setProMonthlyUsd] = useState(FALLBACK_PRO_MONTHLY_USD);

  // Toast notification state
  const [toast, setToast] = useState(null); // { message, type, visible }
  const [adminOpenSupportCount, setAdminOpenSupportCount] = useState(0);
  const [userSupportUnreadCount, setUserSupportUnreadCount] = useState(0);
  const supportUnreadInitializedRef = useRef(false);

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
  const aiPromptText = aiPrompt.trim();
  const aiPromptTooShort = aiPromptText.length < 5;
  const aiPromptTooLong = aiPromptText.length > AI_PROMPT_MAX_CHARS;
  const canSubmitAiPrompt = !aiLoading && !aiPromptTooShort && !aiPromptTooLong && !aiPartialResult?.skeletonFallback;
  const proMonthlyPrice = formatUsdPrice(proMonthlyUsd);

  useEffect(() => {
    let cancelled = false;
    fetchPublicPlans()
      .then((plans) => {
        if (!cancelled) setProMonthlyUsd(getMonthlyProPriceUsd(plans));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const openProfileModal = useCallback(() => {
    setProfileInitialTab('profile');
    setShowProfileModal(true);
  }, []);

  const openSupportModal = useCallback(() => {
    if (!currentUser) {
      setAuthTab('login');
      setShowAuthModal(true);
      return;
    }
    setProfileInitialTab('support');
    setShowProfileModal(true);
  }, [currentUser]);

  const openPremiumPurchase = useCallback(() => {
    if (!currentUser) {
      setAuthTab('register');
      setShowAuthModal(true);
      return;
    }
    setProfileInitialTab('subscription');
    setShowProfileModal(true);
  }, [currentUser]);

  const openAdminMenu = useCallback(async (section = '') => {
    const target = section ? `/admin#${section}` : '/admin';
    try {
      await apiFetch('/api/admin/enter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    } catch (e) {
      window.alert(e.message || 'Нет доступа к админке');
      return;
    }
    const opened = window.open(target, '_blank');
    if (opened) opened.opener = null;
    if (!opened) window.location.href = target;
  }, []);

  // Mobile state
  const [mobileTab, setMobileTab] = useState('canvas'); // 'canvas' | 'blocks' | 'props' | 'dsl'
  const isMobile = isMobileBuilderViewport();
  const [isMobileView, setIsMobileView] = useState(() => isMobileBuilderViewport());
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [showFilesMenu, setShowFilesMenu] = useState(false);
  const [tourActive, setTourActive] = useState(false);
  const [tourStep, setTourStep] = useState(0);

  useLayoutEffect(() => {
    if (!showExamples) {
      setExamplesMenuRect(null);
      return;
    }
    const el = examplesToggleRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setExamplesMenuRect({
      top: r.bottom + 6,
      left: Math.max(8, r.left),
      minWidth: Math.max(isMobileView ? 200 : 190, r.width),
    });
  }, [showExamples, isMobileView]);

  const onboardingKey = currentUser
    ? `cicada_onboarding_v2_${currentUser.id}_${isMobileView ? 'mobile' : 'desktop'}`
    : null;

  const onboardingSteps = React.useMemo(() => {
    const ui = builderUi;
    if (isMobileView) {
      const m = [
        {
          selector: '[data-tour="mobile-examples"]',
          title: ui.tourMobileExamplesTitle,
          text: ui.tourMobileExamplesBody,
        },
        {
          selector: '[data-tour="mobile-ai"]',
          title: ui.tourMobileAiTitle,
          text: ui.tourMobileAiBody,
        },
        {
          selector: '[data-tour="mobile-more"]',
          title: ui.tourMobileMoreTitle,
          text: ui.tourMobileMoreBody,
        },
        {
          selector: '[data-tour="mobile-tab-blocks"]',
          title: ui.tourMobileBlocksTitle,
          text: ui.tourMobileBlocksBody,
          onEnter: () => setMobileTab('blocks'),
        },
        {
          selector: '[data-tour="mobile-tab-canvas"]',
          title: ui.tourMobileCanvasTitle,
          text: ui.tourMobileCanvasBody,
          onEnter: () => setMobileTab('canvas'),
        },
        {
          selector: '[data-tour="mobile-tab-props"]',
          title: ui.tourMobilePropsTitle,
          text: ui.tourMobilePropsBody,
          onEnter: () => setMobileTab('props'),
        },
        {
          selector: '[data-tour="mobile-tab-dsl"]',
          title: ui.tourMobileDslTitle,
          text: ui.tourMobileDslBody,
          onEnter: () => { if (canSeeCode) setMobileTab('dsl'); },
        },
        {
          selector: '[data-tour="mobile-run"]',
          title: ui.tourRunTitle,
          text: ui.tourRunBody,
          onEnter: () => setMobileTab('canvas'),
        },
        {
          selector: '[data-tour="profile-button"]',
          title: ui.tourProfileTitle,
          text: ui.tourProfileBody,
        },
      ];
      return m;
    }

    const steps = [
      {
        selector: '[data-tour="top-examples-desktop"]',
        title: ui.tourExamplesTitle,
        text: ui.tourExamplesBody,
      },
      {
        selector: '[data-tour="top-ai-desktop"]',
        title: ui.tourAiTitle,
        text: ui.tourAiBody,
      },
      {
        selector: '[data-tour="top-clear-desktop"]',
        title: ui.tourClearTitle,
        text: ui.tourClearBody,
      },
      {
        selector: '[data-tour="top-files-desktop"]',
        title: ui.tourFilesTitle,
        text: ui.tourFilesBody,
      },
      {
        selector: '[data-tour="bot-preview"]',
        title: ui.tourPreviewTitle,
        text: ui.tourPreviewBody,
      },
      {
        selector: '[data-tour="top-debug-desktop"]',
        title: ui.tourDebugTitle,
        text: ui.tourDebugBody,
      },
      {
        selector: '[data-tour="run-desktop"]',
        title: ui.tourRunTitle,
        text: ui.tourRunBody,
      },
      {
        selector: '[data-tour="top-premium-desktop"]',
        title: ui.tourPremiumTitle,
        text: ui.tourPremiumBody,
      },
      {
        selector: '[data-tour="profile-button"]',
        title: ui.tourProfileTitle,
        text: ui.tourProfileBody,
      },
      {
        selector: '[data-tour="top-help-desktop"]',
        title: ui.tourHelpTitle,
        text: ui.tourHelpBody,
      },
      {
        selector: '[data-tour="sidebar-desktop"]',
        title: ui.tourSidebarTitle,
        text: ui.tourSidebarBody,
      },
      {
        selector: '[data-tour="canvas-area"]',
        title: ui.tourCanvasTitle,
        text: ui.tourCanvasBody,
      },
      {
        selector: '[data-tour="props-panel-desktop"]',
        title: ui.tourPropsTitle,
        text: ui.tourPropsBody,
      },
    ];
    return steps;
  }, [isMobileView, isAdmin, canSeeCode, builderUi]);

  // Если триал-юзер оказался на вкладке dsl — сбросить
  useEffect(() => {
    if (!canSeeCode && mobileTab === 'dsl') setMobileTab('canvas');
  }, [canSeeCode, mobileTab]);

  useEffect(() => {
    const handler = () => setIsMobileView(isMobileBuilderViewport());
    window.addEventListener('resize', handler);
    window.addEventListener('orientationchange', handler);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('orientationchange', handler);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
    const setAppHeight = () => {
      const height = window.visualViewport?.height || window.innerHeight;
      document.documentElement.style.setProperty('--app-height', `${height}px`);
    };
    setAppHeight();
    window.addEventListener('resize', setAppHeight);
    window.addEventListener('orientationchange', setAppHeight);
    window.visualViewport?.addEventListener('resize', setAppHeight);
    return () => {
      window.removeEventListener('resize', setAppHeight);
      window.removeEventListener('orientationchange', setAppHeight);
      window.visualViewport?.removeEventListener('resize', setAppHeight);
    };
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
      setStacks(normalizeStudioStacks(data.stacks));
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
      openPremiumPurchase();
      return;
    }
    setShowAIModal(true);
    setAiPrompt('');
    setAiError('');
    setAiPartialResult(null);
    setAiDiagnosticsOpen(false);
  }, [canUseAiGenerator, openPremiumPurchase]);

  useEffect(() => {
    if (!aiLoading) {
      setAiLoadingStep(0);
      return undefined;
    }
    setAiLoadingStep(0);
    const id = setInterval(() => {
      setAiLoadingStep((n) => (n + 1) % AI_GEN_LOADING_STEPS.length);
    }, 2100);
    return () => clearInterval(id);
  }, [aiLoading]);

  const applyAiGeneratedStacks = useCallback((generatedStacks, options = {}) => {
    if (!Array.isArray(generatedStacks) || generatedStacks.length === 0) {
      throw new Error('AI вернул пустую схему');
    }
    const timestamp = Date.now();
    const offsetX = stacks.length > 0 ? Math.max(...stacks.map((s) => s.x + 300)) : 40;
    const resolvedTok = resolveBotTokenForNewBlock(stacks, currentUser);
    const newStacks = generatedStacks.map((s, i) => ({
      ...s,
      id: `ai_${timestamp}_${i}`,
      x: (s.x || 40) + offsetX,
      y: s.y || 40,
      blocks: (s.blocks || []).map((b, bi) => ({
        ...normalizeStudioBlockNode(b),
        id: `ai_b_${timestamp}_${i}_${bi}`,
        props: b.type === 'bot' && resolvedTok
          ? { ...b.props, token: resolvedTok }
          : b.props,
      })),
    }));
    setStacks((prev) => [...prev, ...newStacks]);
    setAiPartialResult(null);
    setAiDiagnosticsOpen(false);
    setShowAIModal(false);
    showToast(
      options.skeletonFallback
        ? 'Запущена базовая версия сценария (без сложной логики).'
        : options.recoveryMode
        ? 'Сценарий оптимизирован для стабильного выполнения.'
        : options.partial
        ? 'Частичный сценарий добавлен на холст. Проверьте диагностику перед запуском.'
        : `✨ AI сгенерировал схему бота!${options.aiConfidenceLabel ? ` AI confidence: ${options.aiConfidenceLabel}` : ''}`,
      options.partial || options.skeletonFallback || options.recoveryMode ? 'info' : 'success',
    );
  }, [currentUser, showToast, stacks]);

  const runAiGeneration = useCallback(async () => {
    if (aiPromptTooShort) {
      setAiError('Опиши бота минимум 5 символами');
      return;
    }
    if (aiPromptTooLong) {
      setAiError(`Запрос должен быть не длиннее ${AI_PROMPT_MAX_CHARS} символов`);
      return;
    }
    setAiLoading(true);
    setAiError('');
    setAiPartialResult(null);
    setAiDiagnosticsOpen(false);
    try {
      const token = await getCsrfTokenForRequest(`${API_URL}/ai-generate`);
      const res = await fetch(`${API_URL}/ai-generate`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': token,
        },
        body: JSON.stringify({ prompt: aiPromptText }),
      });
      if (!res.ok) {
        const text = await res.text();
        let msg = `Ошибка сервера ${res.status}`;
        try { const j = JSON.parse(text); msg = j.error || msg; } catch { /* не JSON */ }
        throw new Error(msg);
      }
      const data = await res.json();
      if (data.status === 'partial_success' || data.status === 'fallback_skeleton' || data.partial) {
        const partial = normalizeAiPartialResponse(data);
        setAiPartialResult(partial);
        if (!partial.hasContext) {
          setAiError('Partial IR вернулся без диагностического контекста. Сценарий не применён.');
        }
        return;
      }
      if (data.status === 'failed') {
        const partial = normalizeAiPartialResponse(data);
        if (partial.hasContext) {
          setAiPartialResult(partial);
          return;
        }
        throw new Error(data.error || `AI generation failed: ${data.reason || 'NO_DIAGNOSTIC_CONTEXT'}`);
      }
      if (data.error) throw new Error(data.error);
      applyAiGeneratedStacks(data.stacks, { aiConfidenceLabel: data.aiConfidenceLabel });
    } catch (e) {
      setAiError(e.message || 'Что-то пошло не так');
    } finally {
      setAiLoading(false);
    }
  }, [aiPromptText, aiPromptTooLong, aiPromptTooShort, applyAiGeneratedStacks]);

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
    setMobileAttentionBlockId(prev => prev === blockId ? null : prev);
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

  useEffect(() => {
    const isEditableTarget = (target) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return (
        target.isContentEditable ||
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT'
      );
    };

    const onKeyDown = (e) => {
      if (e.key !== 'Delete' || e.altKey || e.ctrlKey || e.metaKey) return;
      if (!selectedBlockId || !selectedStackId) return;
      if (isEditableTarget(e.target)) return;

      e.preventDefault();
      handleDeleteBlock(selectedStackId, selectedBlockId);
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handleDeleteBlock, selectedBlockId, selectedStackId]);

  const handlePropChange = useCallback((key, val) => {
    if (!selectedBlockId) return;
    setStacks(prev => prev.map(s => ({
      ...s,
      blocks: s.blocks.map(b =>
        b.id === selectedBlockId ? { ...b, props: { ...b.props, [key]: val } } : b
      ),
    })));
  }, [selectedBlockId]);

  const handleAddFooterAction = useCallback((blockId, kind) => {
    if (!blockId || !BLOCK_FOOTER_ACTION_TYPES[kind]) return;
    setStacks(prev => prev.map(s => ({
      ...s,
      blocks: s.blocks.map(b => (b.id === blockId ? addUiAttachment(b, kind) : b)),
    })));
    setSelectedBlockId(blockId);
  }, []);

  const handleAttachmentChange = useCallback((group, attachmentId, updates) => {
    if (!selectedBlockId || !group || !attachmentId) return;
    setStacks(prev => prev.map(s => ({
      ...s,
      blocks: s.blocks.map((b) => {
        if (b.id !== selectedBlockId) return b;
        if (!canRenderUi(b.type)) return normalizeStudioBlockNode(b);
        const next = normalizeStudioBlockNode(b);
        const list = next.uiAttachments[group] || [];
        return {
          ...next,
          uiAttachments: {
            ...next.uiAttachments,
            [group]: list.map((item) => (item.id === attachmentId ? { ...item, ...updates } : item)),
          },
        };
      }),
    })));
  }, [selectedBlockId]);

  const handleAttachmentDelete = useCallback((group, attachmentId) => {
    if (!selectedBlockId || !group || !attachmentId) return;
    setStacks(prev => prev.map(s => ({
      ...s,
      blocks: s.blocks.map((b) => {
        if (b.id !== selectedBlockId) return b;
        if (!canRenderUi(b.type)) return normalizeStudioBlockNode(b);
        const next = normalizeStudioBlockNode(b);
        return {
          ...next,
          uiAttachments: {
            ...next.uiAttachments,
            [group]: (next.uiAttachments[group] || []).filter((item) => item.id !== attachmentId),
          },
        };
      }),
    })));
  }, [selectedBlockId]);

  const handleDragStack = useCallback((stackId, e) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      endPaletteDrag();
      return;
    }
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
    const target = e.target;
    const isElement = target instanceof Element;
    const isCanvasBg = isElement && target.classList?.contains('canvas-bg');
    if (target !== canvasRef.current && !isCanvasBg) return;
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
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      endPaletteDrag();
      return;
    }
    const worldLX = (e.clientX - rect.left - canvasOffset.x) / canvasScale - BLOCK_W / 2;
    const worldTY = (e.clientY - rect.top - canvasOffset.y) / canvasScale - ROOT_H / 2;
    const snap = findNewBlockSnapTarget(stacks, worldLX, worldTY, type);

    const makeProps = (t) => {
      const base = { ...(DEFAULT_PROPS[t] || {}) };
      if (t === 'bot') {
        const tok = resolveBotTokenForNewBlock(stacks, currentUser);
        if (tok) base.token = tok;
      }
      if (t === 'command') {
        const cmd = normalizeCommandName(base.cmd);
        if ((cmd === 'start' && hasBlockOfType(stacks, 'start')) || hasCommandNamed(stacks, cmd)) {
          base.cmd = getNextAvailableCommandName(stacks);
        }
      }
      return base;
    };

    if (UI_ATTACHMENT_LEGACY_BLOCK_TYPES.has(type) && snap?.stackId && snap.valid) {
      const legacy = legacyBlockToUiAttachment(type, makeProps(type));
      if (legacy) {
        setStacks(prev => prev.map((s) => {
          if (s.id !== snap.stackId) return s;
          const last = s.blocks[s.blocks.length - 1];
          if (!last || !canStackBelow(last.type, type)) return s;
          return {
            ...s,
            blocks: s.blocks.map((b) => (
              b.id === last.id ? addUiAttachment(b, legacy.kind, legacy.attachment) : b
            )),
          };
        }));
        setSelectedStackId(snap.stackId);
        setSelectedBlockId(stacks.find((s) => s.id === snap.stackId)?.blocks?.at(-1)?.id || null);
      }
      endPaletteDrag();
      return;
    }
    if (UI_ATTACHMENT_LEGACY_BLOCK_TYPES.has(type)) {
      endPaletteDrag();
      return;
    }

    const newProps = makeProps(type);
    const conflict = getUniqueBlockConflictMessage(stacks, type, newProps);
    if (conflict) {
      showToast(conflict, 'info');
      endPaletteDrag();
      return;
    }

    if (snap && snap.valid) {
      const id = uid();
      setStacks(prev => prev.map(s => {
        if (s.id !== snap.stackId) return s;
        return {
          ...s,
          blocks: [...s.blocks, createStudioBlockNode(type, newProps, id)],
        };
      }));
    } else {
      const id = uid();
      setStacks(prev => [...prev, {
        id: uid(), x: worldLX, y: worldTY,
        blocks: [createStudioBlockNode(type, newProps, id)],
      }]);
    }
    endPaletteDrag();
  }, [canvasOffset, canvasScale, stacks, endPaletteDrag, currentUser, showToast]);

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

  const getVisibleCanvasMetrics = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const width = rect?.width || window.innerWidth || BLOCK_W;
    const fullHeight = rect?.height || Math.max(ROOT_H, (window.innerHeight || 0) - MOBILE_TOP_BAR_H);
    const visibleHeight = Math.max(ROOT_H, fullHeight - (isMobileView ? MOBILE_BOTTOM_NAV_H : 0));

    return { width, visibleHeight };
  }, [isMobileView]);

  const getCanvasCenterStackPosition = useCallback(() => {
    const { width, visibleHeight } = getVisibleCanvasMetrics();

    return {
      x: (width / 2 - canvasOffset.x) / canvasScale - BLOCK_W / 2,
      y: (visibleHeight / 2 - canvasOffset.y) / canvasScale - ROOT_H / 2,
    };
  }, [canvasOffset, canvasScale, getVisibleCanvasMetrics]);

  const focusMobileAddedBlock = useCallback((blockId, worldX, worldY, blockHeight = ROOT_H) => {
    if (!isMobileView || !blockId) return;
    const { width, visibleHeight } = getVisibleCanvasMetrics();
    setCanvasOffset({
      x: width / 2 - (worldX + BLOCK_W / 2) * canvasScale,
      y: visibleHeight / 2 - (worldY + blockHeight / 2) * canvasScale,
    });
    setSelectedBlockId(null);
    setSelectedStackId(null);
    setMobileAttentionBlockId(blockId);
    setMobileTab('canvas');
  }, [canvasScale, getVisibleCanvasMetrics, isMobileView]);

  const makePropsForNewBlock = useCallback((type, baseStacks = stacks) => {
    const props = { ...(DEFAULT_PROPS[type] || {}) };
    if (type === 'bot') {
      const tok = resolveBotTokenForNewBlock(baseStacks, currentUser);
      if (tok) props.token = tok;
    }
    if (type === 'command') {
      const cmd = normalizeCommandName(props.cmd);
      if ((cmd === 'start' && hasBlockOfType(baseStacks, 'start')) || hasCommandNamed(baseStacks, cmd)) {
        props.cmd = getNextAvailableCommandName(baseStacks);
      }
    }
    return props;
  }, [currentUser, stacks]);

  const addBlockFromPaletteTap = useCallback((type) => {
    if (UI_ATTACHMENT_LEGACY_BLOCK_TYPES.has(type)) {
      if (selectedBlockId) {
        const selectedBlock = stacks
          .flatMap((s) => s.blocks || [])
          .find((b) => b.id === selectedBlockId);
        const legacy = canStackBelow(selectedBlock?.type, type)
          ? legacyBlockToUiAttachment(type, makePropsForNewBlock(type))
          : null;
        if (legacy) handleAddFooterAction(selectedBlockId, legacy.kind);
      }
      return;
    }
    const id = uid();
    const { x, y } = getCanvasCenterStackPosition();
    const props = makePropsForNewBlock(type, stacks);
    const conflict = getUniqueBlockConflictMessage(stacks, type, props);
    if (conflict) {
      showToast(conflict, 'info');
      return;
    }
    setStacks(prev => [...prev, {
      id: uid(), x, y,
      blocks: [createStudioBlockNode(type, props, id)],
    }]);
    focusMobileAddedBlock(id, x, y, ROOT_H);
  }, [focusMobileAddedBlock, getCanvasCenterStackPosition, handleAddFooterAction, makePropsForNewBlock, selectedBlockId, showToast, stacks]);

  const addBlockFromContext = useCallback((type) => {
    const id = uid();
    const selStack = stacks.find(s => s.id === selectedStackId) || stacks[stacks.length - 1];

    if (!selStack) {
      const { x, y } = getCanvasCenterStackPosition();
      const props = makePropsForNewBlock(type, stacks);
      const conflict = getUniqueBlockConflictMessage(stacks, type, props);
      if (conflict) {
        showToast(conflict, 'info');
        setBlockInfo(null);
        return;
      }
      setStacks(prev => [...prev, {
        id: uid(), x, y,
        blocks: [createStudioBlockNode(type, props, id)],
      }]);
      focusMobileAddedBlock(id, x, y, ROOT_H);
      setBlockInfo(null);
      return;
    }

    const parentBlock = selStack.blocks[selStack.blocks.length - 1] || null;
    const smartProps = inferPropsFromParent(parentBlock, type, selStack.blocks);
    const finalProps = { ...makePropsForNewBlock(type), ...smartProps };
    const conflict = getUniqueBlockConflictMessage(stacks, type, finalProps);
    if (conflict) {
      showToast(conflict, 'info');
      setBlockInfo(null);
      return;
    }
    const blockIndex = selStack.blocks.length;
    const blockY = selStack.y + getBlockTopInStack(selStack, blockIndex);

    setStacks(prev => prev.map(s => s.id === selStack.id
      ? { ...s, blocks: [...s.blocks, createStudioBlockNode(type, finalProps, id)] }
      : s
    ));
    focusMobileAddedBlock(id, selStack.x, blockY, blockIndex === 0 ? ROOT_H : BLOCK_H);
    setBlockInfo(null);
  }, [
    focusMobileAddedBlock,
    getCanvasCenterStackPosition,
    makePropsForNewBlock,
    selectedStackId,
    showToast,
    stacks,
  ]);

  const loadExample = useCallback(() => {
    resetUidSequence(1);
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
          { id:uid(), type:'message',  props:{ text:'👋 Привет, {пользователь.имя}!\nЯ Echo Bot — напиши мне что-нибудь' }, uiAttachments:{
            buttons: [
              { id:uid(), text:'Привет', action:'' },
              { id:uid(), text:'Пока', action:'' },
              { id:uid(), text:'Инфо', action:'' },
            ],
          } },
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
      if (t === 'при нажатии:' || t === 'при нажатии') return { type: 'callback', props: { label: '' } };
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
      if (t.startsWith('ответ_markdown_v2 ')) return { type: 'message', props: { text: extractString(t), markup: 'markdown_v2' } };
      if (t.startsWith('ответ_html '))  return { type: 'message', props: { text: extractString(t), markup: 'html' } };
      if (t.startsWith('ответ_md2 '))   return { type: 'message', props: { text: extractString(t), markup: 'md2' } };
      if (t.startsWith('ответ_md '))    return { type: 'message', props: { text: extractString(t), markup: 'md', md: true } };
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
      if (/^inline(?:-кнопки)?\s+из\s+бд\s+/i.test(t)) {
        const key = extractString(t);
        const labelField = t.match(/\sтекст\s+"([^"]*)"/)?.[1] || '';
        const idField = t.match(/\sid\s+"([^"]*)"/)?.[1] || '';
        const callbackPrefix = t.match(/\scallback\s+"([^"]*)"/)?.[1] || 'item:';
        const backText = t.match(/\sназад\s+"([^"]*)"/)?.[1] || '⬅️ Назад';
        const backCallback = t.match(/\sназад\s+"[^"]*"\s*(?:→|->)\s*"([^"]*)"/)?.[1] || 'назад';
        const columns = t.match(/(?:\sколонки\s+|\scolumns=)(\d+)/)?.[1] || '1';
        return { type: 'inline_db', props: { key, labelField, idField, callbackPrefix, backText, backCallback, columns } };
      }
      // HTTP: "запрос GET "url" → var" (формат DSL-генератора)
      if (t.startsWith('http_заголовки ')) { const v = t.replace(/^http_заголовки\s+/, '').trim(); return { type: 'http', props: { method: 'HEADERS', varname: v } }; }
      if (t.startsWith('fetch ')) { const m = t.match(/fetch\s+"([^"]+)"\s*(?:→|->)\s*(\S+)/); return m ? { type: 'http', props: { method: 'GET', url: m[1], varname: m[2] } } : null; }
      if (t.startsWith('http_get ') || t.startsWith('http_delete ')) { const m = t.match(/http_(get|delete)\s+"([^"]+)"\s*(?:→|->)\s*(\S+)/); return m ? { type: 'http', props: { method: m[1].toUpperCase(), url: m[2], varname: m[3] } } : null; }
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
      if (/^переслать\s+(?:текст|фото|документ|голосовое|аудио|стикер)\b/.test(t)) {
        const modeMap = { текст: 'text', фото: 'photo', документ: 'document', голосовое: 'voice', аудио: 'audio', стикер: 'sticker' };
        const rawMode = t.match(/^переслать\s+(\S+)/)?.[1] || 'photo';
        const caption = extractString(t);
        return { type: 'forward_msg', props: { mode: modeMap[rawMode] || rawMode, target: '', caption } };
      }
      if (/^переслать(?:\s+сообщение)?\s+/.test(t)) return { type: 'forward_msg', props: { mode: 'message', target: t.replace(/^переслать(?:\s+сообщение)?\s+/, '').trim() } };
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

      let parsed = parseLine(raw);
      if (!parsed) continue;
      if (parsed.type === 'global' && indent > 0) parsed = { ...parsed, type: 'set_global' };

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

  const mergeLibraryStacks = useCallback((prevStacks, incomingStacks) => {
    if (!Array.isArray(incomingStacks) || incomingStacks.length === 0) return prevStacks;
    const result = [...prevStacks];

    const rootKey = (stack) => {
      const root = stack?.blocks?.[0];
      if (!root) return '';
      const p = root.props || {};
      if (root.type === 'global') return `global:${p.varname || ''}`;
      if (root.type === 'command') return `command:${p.cmd || ''}`;
      if (root.type === 'callback') return `callback:${p.label || ''}`;
      if (root.type === 'block' || root.type === 'scenario') return `${root.type}:${p.name || ''}`;
      return `${root.type}`;
    };
    const blockKey = (b) => `${b?.type || ''}:${JSON.stringify(b?.props || {})}`;

    const rootIndex = new Map(result.map((s, i) => [rootKey(s), i]));
    for (const stack of incomingStacks) {
      const k = rootKey(stack);
      const i = rootIndex.get(k);
      if (i == null || !k) {
        result.push(stack);
        rootIndex.set(k, result.length - 1);
        continue;
      }
      const target = result[i];
      const seen = new Set((target.blocks || []).map(blockKey));
      for (const b of (stack.blocks || [])) {
        const bk = blockKey(b);
        if (!seen.has(bk)) {
          target.blocks.push({ ...b, id: uid() });
          seen.add(bk);
        }
      }
    }

    // Удаляем повторы глобальных переменных по varname (синхронизация библиотек без дублей).
    const seenGlobals = new Set();
    return result.filter((stack) => {
      const root = stack?.blocks?.[0];
      if (root?.type !== 'global') return true;
      const name = root?.props?.varname || '';
      if (!name) return true;
      if (seenGlobals.has(name)) return false;
      seenGlobals.add(name);
      return true;
    });
  }, []);

  const applyCorrectedDSLCode = useCallback((code) => {
    const parsedStacks = parseDSL(code);
    if (!parsedStacks || parsedStacks.length === 0) {
      showToast('Не удалось применить исправления к холсту', 'error');
      return false;
    }
    setStacks(normalizeStudioStacks(parsedStacks));
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

  const EXAMPLE_WEATHER = `бот "YOUR_BOT_TOKEN"

при старте:
    ответ "☀️ Привет! Я покажу погоду в твоём городе.\\nВыбери город:"
    кнопки:
        ["Запорожье", "Киев"]
        ["Львов", "Информация о боте"]
    стоп

при нажатии "Запорожье":
    fetch "https://wttr.in/Zaporizhzhia?format=3&lang=ru" → raw
    ответ "🌍 Запорожье, Украина\\n🌡 {raw}"
    кнопки "🔄 Обновить" "🏠 Главное меню"
    стоп

при нажатии "Киев":
    fetch "https://wttr.in/Kiev?format=3&lang=ru" → raw
    ответ "🌍 Киев, Украина\\n🌡 {raw}"
    кнопки "🔄 Обновить" "🏠 Главное меню"
    стоп

при нажатии "Львов":
    fetch "https://wttr.in/Lviv?format=3&lang=ru" → raw
    ответ "🌍 Львов, Украина\\n🌡 {raw}"
    кнопки "🔄 Обновить" "🏠 Главное меню"
    стоп

при нажатии "Информация о боте":
    ответ "🤖 Этот бот показывает актуальную погоду онлайн для выбранного города.\\nДанные предоставляет wttr.in"
    кнопки:
        ["Запорожье", "Киев"]
        ["Львов", "🏠 Главное меню"]
    стоп

при нажатии "🔄 Обновить":
    ответ "Для обновления погоды выбери город снова:"
    кнопки:
        ["Запорожье", "Киев"]
        ["Львов", "🏠 Главное меню"]
    стоп

при нажатии "🏠 Главное меню":
    ответ "☀️ Главное меню. Выбери город или информацию о боте:"
    кнопки:
        ["Запорожье", "Киев"]
        ["Львов", "🏠 Главное меню"]
    стоп
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
    переслать ADMIN_ID
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

  const buildModularProjectStacks = useCallback((token = '') => {
    const stack = (x, y, blocks) => ({
      id: uid(),
      x,
      y,
      blocks: blocks.map(([type, props]) => ({ id: uid(), type, props })),
    });

    return [
      stack(40, 20, [['version', { version: '1.0' }]]),
      stack(250, 20, [['bot', { token }]]),
      stack(460, 20, [['global', { varname: 'товары', value: '[]' }]]),
      stack(670, 20, [['global', { varname: 'пользователи', value: '[]' }]]),
      stack(880, 20, [['global', { varname: 'админы', value: '[123456789]' }]]),
      stack(1090, 20, [['global', { varname: 'настройки', value: '["валюта:RUB", "доставка:самовывоз"]' }]]),

      stack(40, 170, [
        ['start', {}],
        ['goto', { target: 'проверка_админа' }],
      ]),
      stack(250, 170, [
        ['command', { cmd: 'menu' }],
        ['goto', { target: 'главное_меню' }],
      ]),
      stack(460, 170, [
        ['command', { cmd: 'catalog' }],
        ['goto', { target: 'каталог_товаров' }],
      ]),

      stack(40, 330, [
        ['scenario', { name: 'проверка_админа' }],
        ['step', { name: 'проверка' }],
        ['condition', { cond: 'пользователь.id в админы' }],
        ['goto', { target: 'главное_меню' }],
        ['else', {}],
        ['message', { text: '❌ У вас нет прав администратора' }],
        ['stop', {}],
      ]),

      stack(360, 330, [
        ['scenario', { name: 'главное_меню' }],
        ['step', { name: 'старт' }],
        ['message', {
          text: 'Выберите действие:',
          buttons: '➕ Добавить товар → добавить_товар\n📦 Каталог товаров → каталог_товаров\n🔧 Настройки → настройки',
        }],
        ['stop', {}],
      ]),

      stack(700, 330, [
        ['scenario', { name: 'добавить_товар' }],
        ['step', { name: 'название' }],
        ['ask', { question: '📦 Название товара:', varname: 'название' }],
        ['step', { name: 'цена' }],
        ['ask', { question: '💰 Цена:', varname: 'цена' }],
        ['step', { name: 'описание' }],
        ['ask', { question: '📝 Описание:', varname: 'описание' }],
        ['step', { name: 'сохранение' }],
        ['set_global', {
          varname: 'товары',
          value: 'добавить(товары, "📦 " + название + "\\n💰 " + цена + "₽\\n📝 " + описание)',
        }],
        ['message', {
          text: '✅ Товар добавлен',
          buttons: '➕ Добавить ещё → добавить_товар\n🏠 Главное меню → главное_меню',
        }],
        ['stop', {}],
      ]),

      stack(1040, 330, [
        ['scenario', { name: 'каталог_товаров' }],
        ['step', { name: 'показать_каталог' }],
        ['condition', { cond: 'не товары' }],
        ['message', { text: '📭 Каталог пуст' }],
        ['message', { text: 'Добавьте первый товар.', buttons: '➕ Добавить товар → добавить_товар\n🏠 Главное меню → главное_меню' }],
        ['stop', {}],
        ['loop', { mode: 'foreach', var: 'товар', collection: 'товары', _afterScope: true }],
        ['message', { text: '{товар}' }],
        ['message', {
          text: 'Действия с каталогом:',
          buttons: '🏠 Главное меню → главное_меню\n➕ Добавить товар → добавить_товар',
          _afterScope: true,
        }],
        ['stop', {}],
      ]),

      stack(1380, 330, [
        ['scenario', { name: 'настройки' }],
        ['step', { name: 'старт' }],
        ['message', {
          text: '🔧 Настройки проекта:\n{настройки}',
          buttons: '🏠 Главное меню → главное_меню\n📦 Каталог товаров → каталог_товаров',
        }],
        ['stop', {}],
      ]),
    ];
  }, []);

  const loadExampleFromFile = useCallback((exampleName) => {
    const examples = {
      echo: EXAMPLE_ECHO,
      weather: EXAMPLE_WEATHER,
      shop: EXAMPLE_SHOP,
      full: EXAMPLE_FULL,
      fullTest: EXAMPLE_FULL_TEST,
    };

    const raw = examples[exampleName];
    if (!raw) {
      showToast('Пример не найден', 'error');
      return;
    }

    let parsedStacks = parseDSL(raw);
    if (!parsedStacks) {
      const normalized = fixDslSchema(raw);
      parsedStacks = parseDSL(normalized);
    }
    if (!parsedStacks) {
      showToast('Не удалось разобрать пример', 'error');
      return;
    }

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
    resetUidSequence(1);
    setStacks(normalizeStudioStacks(normalizedStacks));
    setSelectedBlockId(null);
    setSelectedStackId(null);
    setProjectName(exampleName === 'echo' ? 'Эхо Бот' : exampleName === 'weather' ? 'Бот погода' : exampleName === 'shop' ? 'Магазин Бот' : exampleName === 'fullTest' ? 'Full Test' : 'Все Функции');
  }, [parseDSL, showToast, currentUser]);

  const startFirstWowFlow = useCallback(() => {
    loadExampleFromFile('echo');
    showToast('⚡ Шаблон загружен: нажми «Старт», чтобы увидеть первый результат', 'success');
    setTourStep(0);
    setTourActive(true);
  }, [loadExampleFromFile, showToast]);

  const saveProject = useCallback(() => {
    const data = JSON.stringify(normalizeStudioStacks(stacks), null, 2);
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
            setStacks(normalizeStudioStacks(data));
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
            setStacks(normalizeStudioStacks(parsedStacks));
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
  const previewPanelRef = useRef(null);
  const previewFileInputRef = useRef(null);
  /** null — позиция по умолчанию (правый нижний угол); иначе фиксированные left/top в px */
  const [previewPanelPos, setPreviewPanelPos] = useState(null);
  const previewDragRef = useRef(null);

  const [botDebugOpen, setBotDebugOpen] = useState(false);
  const [botDebugLogs, setBotDebugLogs] = useState('');
  const botDebugScrollRef = useRef(null);
  const botDebugPanelRef = useRef(null);
  const [botDebugPanelPos, setBotDebugPanelPos] = useState(null);
  const botDebugDragRef = useRef(null);
  const prevBotRunningRef = useRef(isBotRunning);
  useEffect(() => {
    if (prevBotRunningRef.current && !isBotRunning) setBotDebugOpen(false);
    prevBotRunningRef.current = isBotRunning;
  }, [isBotRunning]);

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

  const getRuntimeUserId = useCallback(() => (
    currentUser?.id ? String(currentUser.id) : ''
  ), [currentUser?.id]);

  // Check if bot is running on server (survives page refresh / other browsers)
  const checkBotStatus = useCallback(async () => {
    try {
      const userId = getRuntimeUserId();
      if (!userId) return;
      const res = await fetch(`${API_URL}/bots`, { credentials: 'include' });
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
  }, [getRuntimeUserId, startCountdown]);

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
      fetchOauthBootstrapUser()
        .then((u) => {
          if (u) {
            saveSession(u);
            setCurrentUser(u);
            loadUserProjects(u.id);
            return;
          }
          loadUserProjects(user.id);
        })
        .catch((err) => {
          if (err?.twofaRequired) {
            setOauth2faPending(true);
            setAuthTab('login');
            setShowAuthModal(true);
            return;
          }
          loadUserProjects(user.id);
        });
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
        .catch((err) => {
          if (err?.twofaRequired) {
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
    if (!currentUser?.id) return undefined;
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

  /** Открыли профиль — сразу тянем план/подписку (после выдачи из админки не ждём минутный poll). */
  useEffect(() => {
    if (!showProfileModal || !currentUser?.id) return undefined;
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

  useEffect(() => {
    if (!isAdmin || !currentUser?.id) {
      setAdminOpenSupportCount(0);
      return undefined;
    }
    let cancelled = false;
    const loadSupportCount = () => {
      apiFetch('/api/admin/support-count')
        .then((data) => {
          if (!cancelled) setAdminOpenSupportCount(Number(data?.open || 0));
        })
        .catch(() => {
          if (!cancelled) setAdminOpenSupportCount(0);
        });
    };
    loadSupportCount();
    const interval = setInterval(loadSupportCount, 30_000);
    window.addEventListener('focus', loadSupportCount);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', loadSupportCount);
    };
  }, [isAdmin, currentUser?.id]);

  useEffect(() => {
    if (!currentUser?.id) {
      setUserSupportUnreadCount(0);
      return undefined;
    }
    let cancelled = false;
    const loadUnreadCount = () => {
      apiFetch('/api/support/unread-count')
        .then((data) => {
          if (cancelled) return;
          const nextUnread = Number(data?.unread || 0);
          setUserSupportUnreadCount((prevUnread) => {
            if (supportUnreadInitializedRef.current && nextUnread > prevUnread) {
              showToast('🔔 Поддержка ответила в вашем обращении', 'success');
            }
            supportUnreadInitializedRef.current = true;
            return nextUnread;
          });
        })
        .catch(() => {
          if (!cancelled) setUserSupportUnreadCount(0);
        });
    };
    const handleUnreadEvent = (event) => {
      const nextCount = Number(event?.detail?.count);
      if (Number.isFinite(nextCount)) {
        supportUnreadInitializedRef.current = true;
        setUserSupportUnreadCount(nextCount);
      } else {
        loadUnreadCount();
      }
    };
    loadUnreadCount();
    const interval = setInterval(loadUnreadCount, 30_000);
    window.addEventListener('focus', loadUnreadCount);
    window.addEventListener('cicada:support-unread-updated', handleUnreadEvent);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', loadUnreadCount);
      window.removeEventListener('cicada:support-unread-updated', handleUnreadEvent);
    };
  }, [currentUser?.id, showToast]);

  // Poll every 5s — syncs bot status across browsers/tabs
  useEffect(() => {
    const id = setInterval(checkBotStatus, 5000);
    return () => clearInterval(id);
  }, [checkBotStatus]);

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
    async ({ text = '', callbackData = null, caption = '', document = null, photo = null }) => {
      setPreviewBusy(true);
      setPreviewErr(null);
      try {
        const code = generateBotDSL();
        const sessionId = getOrCreatePreviewSessionId();
        const token = await getCsrfTokenForRequest('/api/bot/preview');
        const body = {
          sessionId,
          code,
          chatId: 990000001,
          text: text != null ? String(text) : '',
          callbackData: callbackData != null && String(callbackData).length > 0 ? String(callbackData) : null,
        };
        if (caption != null && String(caption).trim()) {
          body.caption = String(caption).trim();
        }
        if (document && typeof document === 'object') {
          body.document = document;
        }
        if (photo && typeof photo === 'object') {
          body.photo = photo;
        }
        const res = await fetch('/api/bot/preview', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': token,
          },
          body: JSON.stringify(body),
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

  const sendPreviewUserFile = useCallback(
    async (file) => {
      if (!file || previewBusy) return;
      const caption = String(previewDraft ?? '').trim();
      const name = file.name || 'file';
      const mime = file.type || 'application/octet-stream';
      const isImg = /^image\//i.test(mime);
      let data;
      try {
        data = await fileToBase64(file);
      } catch (e) {
        setPreviewErr(e.message || String(e));
        return;
      }
      setPreviewMessages((prev) => [
        ...prev,
        {
          role: 'user',
          kind: isImg ? 'photo' : 'document',
          fileName: name,
          mimeType: mime,
          caption,
        },
      ]);
      if (isImg) {
        await runPreviewStep({
          text: '',
          caption,
          photo: { mimeType: mime, data },
        });
      } else {
        await runPreviewStep({
          text: '',
          caption,
          document: { fileName: name, mimeType: mime, data },
        });
      }
      setPreviewDraft('');
    },
    [runPreviewStep, previewBusy, previewDraft],
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

  const startPreviewPanelDrag = useCallback((e) => {
    if (e.button !== 0) return;
    const el = e.target;
    if (el.closest && (el.closest('button') || el.closest('input') || el.closest('a'))) return;
    const panel = previewPanelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    setPreviewPanelPos({ left: rect.left, top: rect.top });
    previewDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originLeft: rect.left,
      originTop: rect.top,
      width: rect.width,
      height: rect.height,
    };
    const move = (ev) => {
      const d = previewDragRef.current;
      if (!d) return;
      let left = d.originLeft + (ev.clientX - d.startX);
      let top = d.originTop + (ev.clientY - d.startY);
      const margin = 8;
      left = Math.max(margin, Math.min(left, window.innerWidth - d.width - margin));
      top = Math.max(margin, Math.min(top, window.innerHeight - d.height - margin));
      setPreviewPanelPos({ left, top });
    };
    const up = () => {
      previewDragRef.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    e.preventDefault();
  }, []);

  const startBotDebugPanelDrag = useCallback((e) => {
    if (e.button !== 0) return;
    const el = e.target;
    if (el.closest && (el.closest('button') || el.closest('input') || el.closest('a'))) return;
    const panel = botDebugPanelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    setBotDebugPanelPos({ left: rect.left, top: rect.top });
    botDebugDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originLeft: rect.left,
      originTop: rect.top,
      width: rect.width,
      height: rect.height,
    };
    const move = (ev) => {
      const d = botDebugDragRef.current;
      if (!d) return;
      let left = d.originLeft + (ev.clientX - d.startX);
      let top = d.originTop + (ev.clientY - d.startY);
      const margin = 8;
      left = Math.max(margin, Math.min(left, window.innerWidth - d.width - margin));
      top = Math.max(margin, Math.min(top, window.innerHeight - d.height - margin));
      setBotDebugPanelPos({ left, top });
    };
    const up = () => {
      botDebugDragRef.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    e.preventDefault();
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
    const userId = getRuntimeUserId();
    if (!userId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(`${API_URL}/bot/logs?userId=${encodeURIComponent(userId)}`, {
          credentials: 'include',
        });
        const data = await r.json().catch(() => ({}));
        if (cancelled || data.logs == null) return;
        setBotDebugLogs(String(data.logs));
      } catch { /* ignore */ }
    };
    tick();
    const id = setInterval(tick, 1200);
    return () => { cancelled = true; clearInterval(id); };
  }, [botDebugOpen, getRuntimeUserId]);

  // Start bot
  const startBot = useCallback(async () => {
    setIsStartingBot(true);
    setStartBotError(null);
    try {
      const userId = getRuntimeUserId();
      if (!userId) {
        setAuthTab('login');
        setShowAuthModal(true);
        setStartBotError('Войдите в аккаунт, чтобы запустить бота');
        return;
      }
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
  }, [generateBotDSL, showToast, getRuntimeUserId, startCountdown]);

  // Stop bot
  const stopBot = useCallback(async () => {
    setBotDebugOpen(false);
    setIsStoppingBot(true);
    setStopBotError(null);
    try {
      const userId = getRuntimeUserId();
      if (!userId) {
        setAuthTab('login');
        setShowAuthModal(true);
        setStopBotError('Войдите в аккаунт, чтобы остановить бота');
        return;
      }
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
  }, [showToast, getRuntimeUserId]);

  const authModalNode = showAuthModal ? (
    <AuthModal
      tab={authTab}
      setTab={setAuthTab}
      canClose={!!currentUser}
      onClose={() => setShowAuthModal(false)}
      onLogin={async (email, password, totp, tgData, passkeyMode = false) => {
        let user;
        if (oauth2faPending) {
          user = await completeOauth2FA(totp);
        } else if (tgData) {
          user = await telegramAuth(tgData);
        } else if (passkeyMode) {
          user = await loginWithPasskey(email);
        } else {
          user = await loginUser(email, password, totp);
        }
        saveSession(user);
        setCurrentUser(user);
        setOauth2faPending(false);
        await loadUserProjects(user.id);
        setShowAuthModal(false);
        showToast('Вход выполнен!', 'success');
      }}
      oauth2faPending={oauth2faPending}
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
    />
  ) : null;

  const isAdminRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/admin');
  if (isAdminRoute) {
    return (
      <>
        <AdminRoute
          currentUser={currentUser}
          onLoginClick={() => { setAuthTab('login'); setShowAuthModal(true); }}
        />
        {authModalNode}
      </>
    );
  }

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
            border:1px solid rgba(99,102,241,0.32);
            background:linear-gradient(135deg,rgba(29,20,82,0.62),rgba(16,12,45,0.5));
            color:rgba(235,230,255,0.76);
            position:relative; overflow:hidden; backdrop-filter:blur(10px) saturate(130%);
            box-shadow:inset 0 0 18px rgba(99,102,241,0.1),0 6px 18px rgba(0,0,0,0.16);
          }
          .lp-nav-pill::before {
            content:''; position:absolute; inset:0 auto auto 0; width:58%; height:1px;
            background:linear-gradient(90deg,var(--pill-clr),transparent); opacity:.75;
          }
          .lp-nav-pill:hover {
            background:linear-gradient(135deg,rgba(59,130,246,0.2),rgba(168,85,247,0.14));
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
                <div style={{ fontFamily:'Syne,system-ui', fontSize:38, fontWeight:800, marginBottom:4 }}>{proMonthlyPrice}<span style={{ fontSize:16, fontWeight:500, color:'rgba(255,255,255,0.5)' }}> /мес</span></div>
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
    <BuilderUiContext.Provider value={{ lang: uiLang, blockTypes: builderBlockTypes, t: builderUi }}>
    <AddBlockContext.Provider value={addBlockFromContext}>
    <BlockInfoContext.Provider value={setBlockInfo}>
    <style>{`
      :root {
        --bg: #040018;
        --bg2: #090127;
        --bg3: #170848;
        --glass: rgba(21, 9, 68, 0.64);
        --glass-strong: rgba(33, 14, 96, 0.78);
        --panel: rgba(8, 3, 34, 0.78);
        --text: rgba(255,255,255,0.92);
        --text2: rgba(255,255,255,0.62);
        --text3: rgba(255,255,255,0.38);
        --border: rgba(121, 88, 255, 0.28);
        --border2: rgba(178, 128, 255, 0.42);
        --accent: #ff7a35;
        --accent2: #6f46ff;
        --cyan: #19d8ff;
        --violet: #8b5cf6;
        --hot: #ff3fd7;
        --mono: 'JetBrains Mono', ui-monospace, monospace;
      }
      @keyframes editorNeonPulse { 0%,100%{opacity:0.5} 50%{opacity:1} }
      @keyframes editorGridShift { from{background-position:0 0} to{background-position:60px 60px} }
      @keyframes editorOrbFloat { 0%,100%{transform:translateY(0) scale(1)} 50%{transform:translateY(-22px) scale(1.04)} }
      @keyframes editorScanLine { 0%{transform:translateY(-100%)} 100%{transform:translateY(100vh)} }
      @keyframes editorStarDrift { from{background-position:0 0, 0 0} to{background-position:72px 54px, -44px 68px} }
      @keyframes blockEntrance { from{opacity:0;transform:translateY(-6px) scale(0.96)} to{opacity:1;transform:translateY(0) scale(1)} }
      @keyframes editorNewBlockBlink { 0%,100%{opacity:1;filter:drop-shadow(0 0 7px var(--new-block-glow,#f97316));transform:scale(1)} 50%{opacity:.42;filter:drop-shadow(0 0 18px var(--new-block-glow,#f97316));transform:scale(1.035)} }
      @keyframes neonBlink { 0%,90%,100%{opacity:1} 95%{opacity:0.6} }
      @keyframes editorRunPulse { 0%,100%{box-shadow:0 0 0 0 rgba(249,115,22,0)} 50%{box-shadow:0 0 0 6px rgba(249,115,22,0.25)} }
      .editor-shell::before,
      .editor-shell::after {
        content:''; position:absolute; pointer-events:none; z-index:0; filter:blur(4px);
      }
      .editor-shell::before {
        inset:-16% -10% auto -8%; height:54%;
        background:
          radial-gradient(circle at 18% 9%, rgba(25,216,255,.24), transparent 28%),
          radial-gradient(circle at 56% 4%, rgba(139,92,246,.42), transparent 36%),
          radial-gradient(circle at 86% 24%, rgba(255,63,215,.22), transparent 32%);
      }
      .editor-shell::after {
        inset:0;
        background:
          radial-gradient(circle, rgba(255,255,255,.12) 0 1px, transparent 1.4px),
          radial-gradient(circle, rgba(25,216,255,.12) 0 1px, transparent 1.5px),
          radial-gradient(circle at 50% 34%, rgba(111,70,255,.18), transparent 44%);
        background-size: 46px 46px, 88px 88px, auto;
        mask-image: linear-gradient(to bottom, rgba(0,0,0,.88), rgba(0,0,0,.4));
        animation: editorStarDrift 18s linear infinite;
      }
      .editor-topbar {
        background:
          linear-gradient(90deg, rgba(9,3,37,.92), rgba(42,13,116,.76) 48%, rgba(8,3,32,.94)),
          radial-gradient(circle at 38% -20%, rgba(25,216,255,.24), transparent 38%) !important;
        border-bottom: 1px solid rgba(255,122,53,.28) !important;
        box-shadow: 0 12px 42px rgba(8,2,30,.62), 0 0 32px rgba(111,70,255,.2), inset 0 1px 0 rgba(255,255,255,.1) !important;
        backdrop-filter: blur(24px) saturate(1.45);
        -webkit-backdrop-filter: blur(24px) saturate(1.45);
      }
      .editor-brand-logo {
        width: 29px; height: 29px; border-radius: 9px; object-fit: cover;
        box-shadow: 0 0 18px rgba(25,216,255,.38), 0 0 30px rgba(139,92,246,.28);
        filter: saturate(1.25) contrast(1.05);
      }
      @media (max-width: 360px) {
        .editor-brand-word { display: none; }
      }
      .editor-brand-mark {
        color:#21d6ff !important;
        text-shadow: 0 0 18px rgba(33,214,255,.72), 0 0 36px rgba(139,92,246,.55) !important;
      }
      .editor-subbar {
        position: relative; z-index: 80;
        min-height: 66px; padding: 11px 12px;
        display:flex; align-items:center; gap:12px;
        background:
          linear-gradient(90deg, rgba(9,4,34,.84), rgba(39,13,110,.62) 45%, rgba(9,4,34,.86)),
          radial-gradient(circle at 70% 10%, rgba(255,63,215,.12), transparent 38%);
        border-bottom: 1px solid rgba(121,88,255,.24);
        box-shadow: 0 12px 34px rgba(7,3,24,.42), inset 0 1px 0 rgba(255,255,255,.06);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
      }
      .editor-subbar-left,
      .editor-subbar-center,
      .editor-subbar-right {
        display:flex; align-items:center; gap:9px; min-width:0;
      }
      .editor-subbar-left { width: 126px; flex-shrink:0; }
      .editor-subbar-center { flex:1; }
      .editor-subbar-right { justify-content:flex-end; }
      .editor-chip {
        display:inline-flex; align-items:center; gap:7px;
        height:38px; padding:0 15px; border-radius:19px;
        background: linear-gradient(135deg, rgba(255,255,255,.07), rgba(111,70,255,.07));
        border: 1px solid rgba(178,128,255,.28);
        color: rgba(255,255,255,.82);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.09), 0 8px 22px rgba(5,2,20,.28);
        font-family: Syne, system-ui; font-size:12px; font-weight:700;
        white-space:nowrap;
      }
      .editor-chip.active {
        color:#fff;
        background: linear-gradient(135deg, rgba(255,122,53,.22), rgba(111,70,255,.18));
        border-color: rgba(255,122,53,.64);
        box-shadow: 0 0 18px rgba(255,122,53,.22), inset 0 1px 0 rgba(255,255,255,.12);
      }
      .editor-chip.small { width:38px; justify-content:center; padding:0; font-size:14px; border-radius:13px; }
      .editor-chip.hot {
        color:#fff; border-color: rgba(255,122,53,.42);
        background: linear-gradient(135deg, rgba(255,122,53,.95), rgba(255,79,216,.72));
        box-shadow: 0 0 22px rgba(255,122,53,.34);
      }
      .editor-chip.premium {
        color:#ffd29a;
        border-color: rgba(255,122,53,.48);
        background: linear-gradient(135deg, rgba(255,122,53,.16), rgba(255,63,215,.08));
      }
      .editor-main-grid {
        border-top: 1px solid rgba(255,255,255,.025);
        background: radial-gradient(circle at 48% 20%, rgba(116,61,255,.34), transparent 35%);
      }
      .editor-sidebar-shell,
      .editor-right-panel {
        background:
          linear-gradient(180deg, rgba(11,4,43,.86), rgba(6,2,25,.95)),
          radial-gradient(circle at 50% 0%, rgba(111,70,255,.18), transparent 42%) !important;
        backdrop-filter: blur(20px) saturate(1.2);
        -webkit-backdrop-filter: blur(20px) saturate(1.2);
      }
      .editor-sidebar-shell {
        border-right: 1px solid rgba(121,88,255,.32) !important;
        box-shadow: 10px 0 34px rgba(5,2,20,.46), inset -1px 0 0 rgba(255,255,255,.025) !important;
      }
      .editor-right-panel {
        border-left: 1px solid rgba(121,88,255,.32) !important;
        box-shadow: -10px 0 34px rgba(5,2,20,.46), inset 1px 0 0 rgba(255,255,255,.025) !important;
      }
      .editor-panel-title {
        background: linear-gradient(90deg, rgba(25,216,255,.12), rgba(139,92,246,.12), transparent) !important;
        border-bottom: 1px solid rgba(121,88,255,.26) !important;
        color: rgba(205,217,255,.74) !important;
      }
      .canvas-bg {
        background:
          radial-gradient(circle at 56% 14%, rgba(153,89,255,.42), transparent 34%),
          radial-gradient(circle at 31% 78%, rgba(25,216,255,.12), transparent 38%),
          radial-gradient(circle at 84% 72%, rgba(255,63,215,.14), transparent 34%),
          linear-gradient(160deg, #060019 0%, #14053d 48%, #050116 100%) !important;
      }
      .canvas-bg::before {
        content:''; position:absolute; inset:0; pointer-events:none; z-index:0;
        background:
          linear-gradient(rgba(162,132,255,.09) 1px, transparent 1px),
          linear-gradient(90deg, rgba(162,132,255,.09) 1px, transparent 1px),
          radial-gradient(circle, rgba(255,255,255,.18) 0 1px, transparent 1.5px);
        background-size: 48px 48px, 48px 48px, 24px 24px;
        opacity:.62;
      }
      .canvas-bg::after {
        content:''; position:absolute; inset:0; pointer-events:none; z-index:0;
        background:
          radial-gradient(circle at center, transparent 0 45%, rgba(3,1,12,.28) 74%, rgba(3,1,12,.65) 100%),
          repeating-linear-gradient(0deg, rgba(255,255,255,.025) 0 1px, transparent 1px 4px);
      }
      .editor-empty-card {
        background: linear-gradient(180deg, rgba(21,9,68,.68), rgba(7,2,28,.74)) !important;
        border: 1px solid rgba(178,128,255,.25) !important;
        box-shadow: 0 28px 80px rgba(5,1,22,.66), 0 0 42px rgba(111,70,255,.16), inset 0 1px 0 rgba(255,255,255,.08) !important;
      }
      input, textarea, select {
        background: rgba(255,255,255,.045) !important;
        border-color: rgba(167,139,250,.25) !important;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.04);
      }
      input:focus, textarea:focus, select:focus {
        border-color: rgba(33,214,255,.62) !important;
        box-shadow: 0 0 0 3px rgba(33,214,255,.08), inset 0 1px 0 rgba(255,255,255,.05);
      }
      select option {
        background: #12072f;
        color: #f8fafc;
      }
      select option:checked {
        background: #2563eb;
        color: #fff;
      }
      .tb-btn {
        display: inline-flex; align-items: center; gap: 4px;
        min-width: 38px; height: 34px; justify-content: center;
        padding: 0 12px; border-radius: 12px; font-size: 11px; font-weight: 700;
        cursor: pointer; transition: all 0.18s ease; white-space: nowrap;
        font-family: Syne, system-ui; letter-spacing: 0.01em; line-height: 1;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
      }
      .tb-btn-ghost {
        background: linear-gradient(135deg, rgba(255,255,255,0.07), rgba(111,70,255,0.08));
        color: rgba(255,255,255,0.74);
        border: 1px solid rgba(178,128,255,0.3);
      }
      .tb-btn-ghost:hover { background: rgba(127,92,255,0.18); color: rgba(255,255,255,0.94); border-color: rgba(167,139,250,0.55); box-shadow:0 0 18px rgba(127,92,255,.18); }
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
        border:1px solid rgba(255,205,132,.2); font-weight:800; font-size:13px;
        min-width: 82px; border-radius: 18px;
        box-shadow:0 2px 18px rgba(249,115,22,0.48), inset 0 1px 0 rgba(255,255,255,.24);
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
        background:linear-gradient(135deg,rgba(25,216,255,0.14),rgba(139,92,246,0.16));
        color:#8beaff; border:1px solid rgba(25,216,255,0.38); font-weight:700;
      }
      .tb-btn-ai:hover {
        background:linear-gradient(135deg,rgba(33,214,255,0.22),rgba(139,92,246,0.24));
        border-color:rgba(33,214,255,0.72); color:#fff; box-shadow:0 0 18px rgba(33,214,255,0.22);
      }
      .tb-btn.locked-premium {
        opacity:.64;
        filter:saturate(.58);
        cursor:pointer;
        border-color:rgba(251,191,36,.28);
      }
      .tb-btn.locked-premium:hover {
        opacity:.92;
        filter:saturate(.85);
        color:#fde68a;
        border-color:rgba(251,191,36,.55);
        box-shadow:0 0 18px rgba(251,191,36,.16);
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
      .tb-files-menu-item.locked-premium { color: rgba(253,230,138,0.72); filter:saturate(.6); }
      .tb-files-menu-item.locked-premium:hover { color:#fde68a; background:rgba(251,191,36,0.07); }
      .editor-sidebar-block { border-left: 2px solid transparent; }
      .editor-sidebar-block:hover {
        background:linear-gradient(90deg, rgba(127,92,255,0.18), rgba(33,214,255,0.04)) !important;
        border-left-color: rgba(139,92,246,.95);
        transform: translateX(2px);
      }
      .editor-group-header { 
        padding:11px 12px 5px; font-size:9px; letter-spacing:.14em; text-transform:uppercase; font-weight:800;
        border-top:1px solid rgba(127,92,255,0.16); color:rgba(167,139,250,0.68);
        display:flex; align-items:center; gap:6px;
      }
      .editor-group-header::after { content:''; flex:1; height:1px; background:linear-gradient(90deg,rgba(33,214,255,0.32),transparent); }
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
      .editor-mobile-tab.locked-premium { opacity:.58; filter:saturate(.55); }
      .editor-mobile-tab.locked-premium:hover { opacity:.86; filter:saturate(.82); }
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
      className="editor-shell"
      style={{ display:'flex', flexDirection:'column', height:'var(--app-height, 100vh)', background:'var(--bg)', position:'relative', overflow:'hidden' }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onTouchEnd={handleMouseUp}
    >
      {/* Top bar */}
      <div className="editor-topbar" style={{
        background: 'linear-gradient(90deg, #0d0920 0%, #080618 100%)',
        borderBottom: '1px solid rgba(99,102,241,0.25)',
        boxShadow: '0 1px 0 rgba(249,115,22,0.08), 0 4px 24px rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', padding: isMobileView ? '0 8px' : '0 18px', gap: isMobileView ? 6 : 10,
        flexShrink: 0, height: isMobileView ? 52 : 64,
        overflowX: 'hidden',
        position: 'relative', zIndex: 90,
      }}>
        {/* Left neon accent line */}
        <div style={{ position:'absolute', left:0, top:0, bottom:0, width:3, background:'linear-gradient(180deg, #f97316, #6366f1)', borderRadius:'0 2px 2px 0', opacity:0.9 }} />
        <div style={{ fontFamily:'Syne, system-ui', fontWeight:800, fontSize:isMobileView ? 18 : 22, color:'var(--text)', flexShrink: isMobileView ? 1 : 0, minWidth: 0, paddingLeft: 2, display:'flex', alignItems:'center', gap:isMobileView ? 6 : 8 }}>
          <img src={cicadaLogo} alt="" className="editor-brand-logo" />
          <div style={{ display:'flex', alignItems:'baseline', lineHeight:1 }}>
            <span className="editor-brand-word" style={{ background: 'linear-gradient(135deg, #19d8ff 0%, #a78bfa 56%, #ff7a35 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Cicada</span>
            {!isMobileView && <span style={{ fontSize:13, background:'linear-gradient(135deg,#8b5cf6,#d8b4fe)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text', marginLeft:7, fontWeight:500, opacity:0.84 }}>Studio</span>}
          </div>
        </div>
        {/* Mobile Examples Button */}
        {isMobileView && (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              ref={examplesToggleRef}
              type="button"
              data-tour="mobile-examples"
              title={builderUi.examplesOpen}
              onClick={() => setShowExamples(!showExamples)}
              style={{ width: 36, height: 34, display:'flex', alignItems:'center', justifyContent:'center', gap:2, background:'transparent', color:'var(--text3)', padding:0, border:'1px solid var(--border2)', borderRadius:10, fontSize:15, whiteSpace: 'nowrap', flexShrink: 0 }}
            >⚡<span style={{ opacity: 0.55, fontSize: 9, lineHeight: 1 }}>▼</span></button>
          </div>
        )}
        {!isMobileView && <div className="tb-divider" />}
        {/* Desktop-only buttons */}
        {!isMobileView && (
          <>
            <div style={{ position: 'relative' }}>
              <button
                ref={examplesToggleRef}
                type="button"
                className="tb-btn tb-btn-ghost"
                data-tour="top-examples-desktop"
                onClick={() => setShowExamples(!showExamples)}
              >⚡ <span style={{ opacity: 0.5, fontSize: 10 }}>▼</span></button>
            </div>
            <button
              className={`tb-btn tb-btn-ai${canUseAiGenerator ? '' : ' locked-premium'}`}
              data-tour="top-ai-desktop"
              title={canUseAiGenerator ? builderUi.aiTitle : builderUi.aiTitleDisabled}
              onClick={openAiGeneratorModal}
            >{canUseAiGenerator ? '✨ AI' : '🔒 AI'}</button>
            <button
              className="tb-btn tb-btn-danger"
              data-tour="top-clear-desktop"
              title={builderUi.clearCanvas}
              onClick={() => { setStacks([]); setSelectedBlockId(null); setSelectedStackId(null); }}
            >✕</button>
            <div className="tb-divider" />
            <div style={{ position: 'relative' }}>
            <button
              className="tb-btn tb-btn-ghost"
              data-tour="top-files-desktop"
              title={builderUi.filesMenuTitle}
              onClick={() => setShowFilesMenu(v => !v)}
            >📁 <span style={{ opacity: 0.5, fontSize: 10 }}>▼</span></button>
              {showFilesMenu && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setShowFilesMenu(false)} />
                  <div className="tb-files-menu">
                    <button className="tb-files-menu-item" onClick={() => { saveProject(); setShowFilesMenu(false); }}>
                      <span style={{ color: '#3ecf8e' }}>💾</span> {builderUi.saveFile}
                    </button>
                    {currentUser && (
                      <button
                        className="tb-files-menu-item"
                        onClick={async () => {
                          const name = projectName.trim() || 'Без названия';
                          await saveProjectToCloud(currentUser.id, name, stacks);
                          await loadUserProjects(currentUser.id);
                          showToast('☁ Проект сохранён в облако: ' + name, 'success');
                          setShowFilesMenu(false);
                        }}
                      >
                        <span style={{ color: '#3ecf8e' }}>☁</span> {builderUi.saveCloud}
                      </button>
                    )}
                    <button className="tb-files-menu-item" onClick={() => { loadProject(); setShowFilesMenu(false); }}>
                      <span style={{ color: '#60a5fa' }}>📂</span> {builderUi.loadFile}
                    </button>
                    <button
                      className={`tb-files-menu-item${canSeeCode ? '' : ' locked-premium'}`}
                      onClick={() => {
                        setShowFilesMenu(false);
                        if (!canSeeCode) {
                          openPremiumPurchase();
                          return;
                        }
                        loadCCD();
                      }}
                      title={canSeeCode ? builderUi.openCcd : 'Доступно в Pro'}
                    >
                      <span style={{ color: canSeeCode ? '#a78bfa' : '#fbbf24' }}>{canSeeCode ? '↑' : '🔒'}</span> {builderUi.openCcd}
                    </button>
                  </div>
                </>
              )}
            </div>
            <button
              className="tb-btn tb-btn-ghost"
              data-tour="bot-preview"
              title={builderUi.previewTitle}
              type="button"
              onClick={() => { setPreviewPanelOpen(v => !v); setPreviewErr(null); }}
              style={previewPanelOpen ? { outline: '1px solid rgba(56,189,248,0.55)', borderRadius: 8 } : undefined}
            >💬</button>
            <button
              className="tb-btn tb-btn-ghost"
              data-tour="top-debug-desktop"
              title={builderUi.debugTitle}
              type="button"
              onClick={() => setBotDebugOpen(v => !v)}
              style={botDebugOpen ? { outline: '1px solid rgba(250,204,21,0.45)', borderRadius: 8 } : undefined}
            >🧾</button>
            <div className="tb-divider" />
            {!isBotRunning ? (
              <button
                className="tb-btn tb-btn-run"
                data-tour="run-desktop"
                onClick={startBot}
                disabled={!stacks.some(s => s.blocks.some(b => b.type === 'bot' && b.props?.token && b.props.token.trim() !== ''))}
                title={!stacks.some(s => s.blocks.some(b => b.type === 'bot' && b.props?.token && b.props.token.trim() !== '')) ? builderUi.addBotTokenTitle : ''}
              >{builderUi.start}</button>
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
                      ? builderUi.autoStop(Math.floor(autoStopSecondsLeft/60), String(autoStopSecondsLeft%60).padStart(2,'0'))
                      : builderUi.running}
                  </span>
                </div>
                <button
                  className="tb-btn tb-btn-stop"
                  data-tour="run-desktop"
                  onClick={stopBot}
                >{builderUi.stop}</button>
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
                data-tour="mobile-ai"
                title={canUseAiGenerator ? builderUi.aiTitle : builderUi.aiTitleDisabled}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 38,
                  height: 34,
                  padding: 0,
                  background: 'linear-gradient(135deg, rgba(251,191,36,0.18) 0%, rgba(251,146,60,0.12) 100%)',
                  border: '1px solid rgba(251,191,36,0.45)',
                  borderRadius: 8,
                  cursor: 'pointer',
                  transition: 'all 0.18s ease',
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#fde68a',
                  fontFamily: 'Syne, system-ui',
                  letterSpacing: '0.02em',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  boxShadow: '0 0 12px rgba(251,191,36,0.12)',
                  opacity: canUseAiGenerator ? 1 : 0.65,
                  filter: canUseAiGenerator ? undefined : 'saturate(0.6)',
                }}
              >{canUseAiGenerator ? 'AI' : '🔒'}</button>
            ) : (
              <button
                onClick={openPremiumPurchase}
                data-tour="top-premium-desktop"
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
            {isAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => openAdminMenu()}
                  title="Открыть админ-панель"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    padding: isMobileView ? '7px 9px' : '7px 14px',
                    background: 'linear-gradient(135deg,rgba(251,191,36,0.16),rgba(124,58,237,0.12))',
                    border: '1px solid rgba(251,191,36,0.42)',
                    borderRadius: 20,
                    color: '#fde68a',
                    fontSize: isMobileView ? 11 : 12,
                    fontWeight: 800,
                    fontFamily: 'Syne, system-ui',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    boxShadow: '0 0 16px rgba(251,191,36,0.14)',
                  }}
                >
                  <span>⚙</span>
                  {!isMobileView && <span>Админ меню</span>}
                  {isMobileView && <span>Admin</span>}
                </button>
                {adminOpenSupportCount > 0 && (
                  <button
                    type="button"
                    onClick={() => openAdminMenu('support')}
                    title={`Новые обращения: ${adminOpenSupportCount}`}
                    style={{
                      position: 'relative',
                      width: isMobileView ? 34 : 38,
                      height: isMobileView ? 34 : 36,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '50%',
                      border: '1px solid rgba(248,113,113,0.45)',
                      background: 'rgba(248,113,113,0.1)',
                      color: '#fecaca',
                      cursor: 'pointer',
                      flexShrink: 0,
                      boxShadow: '0 0 18px rgba(248,113,113,0.2)',
                    }}
                  >
                    🔔
                    <span style={{
                      position: 'absolute',
                      top: -4,
                      right: -4,
                      minWidth: 17,
                      height: 17,
                      padding: '0 5px',
                      borderRadius: 999,
                      background: '#ef4444',
                      color: '#fff',
                      fontSize: 10,
                      fontWeight: 900,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '1px solid rgba(255,255,255,0.55)',
                    }}>{adminOpenSupportCount > 99 ? '99+' : adminOpenSupportCount}</span>
                  </button>
                )}
              </>
            )}
            {userSupportUnreadCount > 0 && (
              <button
                type="button"
                onClick={openSupportModal}
                title={`Ответы поддержки: ${userSupportUnreadCount}`}
                style={{
                  position: 'relative',
                  width: isMobileView ? 34 : 38,
                  height: isMobileView ? 34 : 36,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '50%',
                  border: '1px solid rgba(62,207,142,0.5)',
                  background: 'rgba(62,207,142,0.1)',
                  color: '#bbf7d0',
                  cursor: 'pointer',
                  flexShrink: 0,
                  boxShadow: '0 0 18px rgba(62,207,142,0.22)',
                }}
              >
                🔔
                <span style={{
                  position: 'absolute',
                  top: -4,
                  right: -4,
                  minWidth: 17,
                  height: 17,
                  padding: '0 5px',
                  borderRadius: 999,
                  background: '#10b981',
                  color: '#04130d',
                  fontSize: 10,
                  fontWeight: 900,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid rgba(255,255,255,0.55)',
                }}>{userSupportUnreadCount > 99 ? '99+' : userSupportUnreadCount}</span>
              </button>
            )}
            {/* User button */}
            <button
              data-tour="profile-button"
              onClick={openProfileModal}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'var(--bg3)', padding: isMobileView ? 3 : '6px 14px', borderRadius: 20,
                border: '1px solid var(--border2)', cursor: 'pointer',
                flexShrink: 0,
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
            data-tour="top-help-desktop"
            onClick={() => setShowInstructions(true)}
            style={{ marginLeft: 6 }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#fbbf24'; e.currentTarget.style.color = '#fbbf24'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = ''; e.currentTarget.style.color = ''; }}
          >📖</button>
        )}
        {isMobileView && (
          <div style={{ position: 'relative', flexShrink: 0, marginLeft: 4 }}>
            <button
              type="button"
              data-tour="mobile-more"
              onClick={() => setMobileMoreOpen(v => !v)}
              style={{
                background: mobileMoreOpen ? 'rgba(255,255,255,0.1)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text3)', width: 36, height: 34, padding: 0,
                border: '1px solid var(--border2)', borderRadius: 8, fontSize: 16,
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >⋯</button>
          </div>
        )}
      </div>

      {currentUser && !isMobileView && (
        <div className="editor-subbar">
          <div className="editor-subbar-left">
            <div className="editor-chip active">
              <span style={{ color: '#ffb86b' }}>▣</span>
              {builderUi.mobileTabBlocks}
            </div>
          </div>
          <div className="editor-subbar-center">
            <button
              type="button"
              className="editor-chip"
              onClick={() => setShowLibrary(true)}
              title={builderUi.moduleLibrary}
            >
              <span style={{ color: '#8b5cf6' }}>▰</span>
              {builderUi.moduleLibrary}
            </button>
          </div>
          <div className="editor-subbar-right">
            <div className="editor-chip" title="Текущее время">
              ◷ {new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
            </div>
            <button
              type="button"
              className="editor-chip small"
              onClick={() => setShowInstructions(true)}
              title="Помощь"
            >
              ⌕
            </button>
          </div>
        </div>
      )}

      {/* Instructions Modal */}

      {showLibrary && (
        <ModuleLibraryModal
          t={builderUi}
          lang={uiLang}
          currentUser={currentUser}
          onUpgrade={() => { setShowLibrary(false); openPremiumPurchase(); }}
          onClose={() => setShowLibrary(false)}
          onInsert={(code) => {
            const parsed = parseDSL(code);
            if (parsed) {
              setStacks(prev => mergeLibraryStacks(prev, parsed));
              showToast(builderUi.libInsertSuccess, 'success');
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
                    onClick={() => setAiPrompt(ex.text.slice(0, AI_PROMPT_MAX_CHARS))}
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
                onChange={(e) => {
                  setAiPrompt(e.target.value.slice(0, AI_PROMPT_MAX_CHARS));
                  if (aiPartialResult?.skeletonFallback) {
                    setAiPartialResult(null);
                    setAiDiagnosticsOpen(false);
                  }
                }}
                disabled={aiLoading}
                maxLength={AI_PROMPT_MAX_CHARS}
                placeholder="Опиши идею бота до 50 символов"
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
              <div style={{ marginTop: 6, textAlign: 'right', fontSize: 11, color: aiPromptTooLong ? '#f87171' : 'var(--text3)' }}>
                {aiPrompt.length}/{AI_PROMPT_MAX_CHARS}
              </div>

              {/* Error */}
              {aiError && (
                <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 8, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)', color: '#f87171', fontSize: 12 }}>
                  {aiError}
                </div>
              )}

              {aiPartialResult && (
                <div
                  style={{
                    marginTop: 12,
                    padding: 12,
                    borderRadius: 12,
                    background: 'rgba(15,23,42,0.58)',
                    border: '1px solid rgba(251,191,36,0.22)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  {aiPartialResult.executionMode === 'FALLBACK_SKELETON' && (
                    <div
                      role="alert"
                      style={{
                        padding: '10px 12px',
                        borderRadius: 10,
                        background: 'rgba(245,158,11,0.14)',
                        border: '1px solid rgba(245,158,11,0.32)',
                        color: '#fbbf24',
                        fontSize: 12,
                        fontWeight: 800,
                        lineHeight: 1.45,
                      }}
                    >
                      Запущен аварийный режим (без AI логики)
                    </div>
                  )}
                  {aiPartialResult.recoveryMode && (
                    <div
                      role="status"
                      style={{
                        padding: '10px 12px',
                        borderRadius: 10,
                        background: 'rgba(59,130,246,0.12)',
                        border: '1px solid rgba(59,130,246,0.28)',
                        color: '#93c5fd',
                        fontSize: 12,
                        fontWeight: 800,
                        lineHeight: 1.45,
                      }}
                    >
                      Оптимизирую сценарий для стабильного выполнения...
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 13, color: '#fbbf24', fontWeight: 800 }}>
                        {aiPartialResult.skeletonFallback
                          ? 'Аварийный сценарий готов'
                          : aiPartialResult.recoveryMode
                            ? 'Сценарий оптимизирован для стабильного выполнения'
                            : 'Сценарий сгенерирован частично'}
                      </div>
                      <div style={{ marginTop: 3, fontSize: 11, color: 'var(--text3)', lineHeight: 1.45 }}>
                        {aiPartialResult.skeletonFallback
                          ? 'Это fallback-only execution layer: сценарий можно запустить, но он не считается успешной AI-генерацией.'
                          : aiPartialResult.recoveryMode
                            ? 'AI_RECOVERY упростил IR после неудачной primary-попытки, чтобы снизить риск аварийного fallback.'
                          : 'Degraded compiler output: рабочие части можно применить только если `safeToRun` true.'}
                      </div>
                    </div>
                    <span
                      style={{
                        flex: '0 0 auto',
                        padding: '4px 8px',
                        borderRadius: 999,
                        fontFamily: 'var(--mono, ui-monospace, monospace)',
                        fontSize: 10,
                        color: aiPartialResult.safeToRun ? '#86efac' : '#fca5a5',
                        background: aiPartialResult.safeToRun ? 'rgba(34,197,94,0.12)' : 'rgba(248,113,113,0.12)',
                        border: aiPartialResult.safeToRun ? '1px solid rgba(34,197,94,0.22)' : '1px solid rgba(248,113,113,0.22)',
                      }}
                    >
                      safeToRun: {aiPartialResult.safeToRun ? 'true' : 'false'}
                    </span>
                  </div>

                  {(aiPartialResult.executionMode || aiPartialResult.rootCause) && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      <span style={{
                        padding: '3px 7px',
                        borderRadius: 999,
                        background: aiPartialResult.aiConfidenceLabel === 'HIGH'
                          ? 'rgba(34,197,94,0.1)'
                          : aiPartialResult.aiConfidenceLabel === 'MEDIUM'
                            ? 'rgba(245,158,11,0.1)'
                            : 'rgba(248,113,113,0.1)',
                        color: aiPartialResult.aiConfidenceLabel === 'HIGH'
                          ? '#86efac'
                          : aiPartialResult.aiConfidenceLabel === 'MEDIUM'
                            ? '#fbbf24'
                            : '#fca5a5',
                        border: '1px solid rgba(255,255,255,0.14)',
                        fontFamily: 'var(--mono, ui-monospace, monospace)',
                        fontSize: 10,
                      }}>
                        AI confidence: {aiPartialResult.aiConfidenceLabel}
                      </span>
                      {aiPartialResult.executionMode && (
                        <span style={{ padding: '3px 7px', borderRadius: 999, background: 'rgba(245,158,11,0.1)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.18)', fontFamily: 'var(--mono, ui-monospace, monospace)', fontSize: 10 }}>
                          executionMode: {aiPartialResult.executionMode}
                        </span>
                      )}
                      {aiPartialResult.rootCause && (
                        <span style={{ padding: '3px 7px', borderRadius: 999, background: 'rgba(248,113,113,0.1)', color: '#fca5a5', border: '1px solid rgba(248,113,113,0.18)', fontFamily: 'var(--mono, ui-monospace, monospace)', fontSize: 10 }}>
                          rootCause: {aiPartialResult.rootCause}
                        </span>
                      )}
                    </div>
                  )}

                  {aiPartialResult.reasonCodes.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {aiPartialResult.reasonCodes.map((code) => (
                        <span
                          key={code}
                          style={{
                            padding: '3px 7px',
                            borderRadius: 999,
                            background: 'rgba(59,130,246,0.1)',
                            color: '#93c5fd',
                            border: '1px solid rgba(59,130,246,0.18)',
                            fontFamily: 'var(--mono, ui-monospace, monospace)',
                            fontSize: 10,
                          }}
                        >
                          {code}
                        </span>
                      ))}
                    </div>
                  )}

                  <AiDiagnosticSection
                    title="What works"
                    items={aiPartialResult.sections.whatWorks}
                    emptyText="Запущена базовая версия сценария (без сложной логики)."
                  />
                  <AiDiagnosticSection
                    title="What was fixed"
                    items={aiPartialResult.sections.whatWasFixed}
                    emptyText="Автоисправления не применялись."
                  />
                  <AiDiagnosticSection
                    title="What failed"
                    items={aiPartialResult.sections.whatFailed}
                    emptyText="Оставшихся диагностик нет."
                  />

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      disabled={!aiPartialResult.canRunPartial || aiLoading}
                      onClick={() => applyAiGeneratedStacks(aiPartialResult.raw.stacks, {
                        partial: true,
                        skeletonFallback: aiPartialResult.skeletonFallback,
                        recoveryMode: aiPartialResult.recoveryMode,
                      })}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 9,
                        border: '1px solid rgba(34,197,94,0.25)',
                        background: aiPartialResult.canRunPartial ? 'rgba(34,197,94,0.16)' : 'rgba(34,197,94,0.06)',
                        color: aiPartialResult.canRunPartial ? '#86efac' : 'rgba(134,239,172,0.35)',
                        cursor: aiPartialResult.canRunPartial && !aiLoading ? 'pointer' : 'not-allowed',
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {aiPartialResult.skeletonFallback
                        ? 'run emergency scenario'
                        : aiPartialResult.recoveryMode
                          ? 'run optimized scenario'
                          : 'run partial scenario'}
                    </button>
                    {!aiPartialResult.skeletonFallback && (
                      <button
                        type="button"
                        disabled={aiLoading || aiPromptTooShort || aiPromptTooLong}
                        onClick={runAiGeneration}
                        style={{
                          padding: '8px 10px',
                          borderRadius: 9,
                          border: '1px solid rgba(251,191,36,0.25)',
                          background: 'rgba(251,191,36,0.1)',
                          color: '#fbbf24',
                          cursor: aiLoading || aiPromptTooShort || aiPromptTooLong ? 'not-allowed' : 'pointer',
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        regenerate
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setAiDiagnosticsOpen((open) => !open)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 9,
                        border: '1px solid rgba(148,163,184,0.22)',
                        background: 'rgba(148,163,184,0.08)',
                        color: '#cbd5e1',
                        cursor: 'pointer',
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      view diagnostics
                    </button>
                  </div>

                  {aiDiagnosticsOpen && (
                    <pre
                      style={{
                        margin: 0,
                        maxHeight: 180,
                        overflow: 'auto',
                        padding: 10,
                        borderRadius: 8,
                        background: 'rgba(0,0,0,0.24)',
                        color: '#cbd5e1',
                        fontSize: 10,
                        lineHeight: 1.45,
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {JSON.stringify({
                        status: aiPartialResult.status,
                        reason: aiPartialResult.reason,
                        reasonCodes: aiPartialResult.reasonCodes,
                        executionMode: aiPartialResult.executionMode,
                        rootCause: aiPartialResult.rootCause,
                        aiConfidenceLabel: aiPartialResult.aiConfidenceLabel,
                        executionDecisionScore: aiPartialResult.executionDecisionScore,
                        isDegraded: aiPartialResult.isDegraded,
                        isAIGenerated: aiPartialResult.isAIGenerated,
                        diagnostics: aiPartialResult.raw.diagnostics || [],
                        repairActions: aiPartialResult.raw.repairActions || [],
                        userActions: aiPartialResult.userActions,
                      }, null, 2)}
                    </pre>
                  )}
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
                disabled={!canSubmitAiPrompt}
                onClick={runAiGeneration}
                style={{
                  flex: 2, padding: '11px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                  background: !canSubmitAiPrompt
                    ? 'rgba(251,191,36,0.15)'
                    : 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
                  color: !canSubmitAiPrompt ? 'rgba(251,191,36,0.4)' : '#000',
                  border: 'none', cursor: !canSubmitAiPrompt ? 'not-allowed' : 'pointer',
                  fontFamily: 'Syne, system-ui', transition: 'all 0.2s',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {aiLoading ? (
                  <>
                    <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(251,191,36,0.3)', borderTopColor: '#fbbf24', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                    {AI_GEN_LOADING_STEPS[aiLoadingStep]}
                  </>
                ) : aiPartialResult?.skeletonFallback ? 'Измените описание для новой попытки' : '✨ Сгенерировать'}
              </button>
            </div>
          </div>
        </div>
      )}
      {showAIModal && aiLoading && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10040,
            background: 'rgba(8,10,18,0.88)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
          aria-busy="true"
          aria-live="polite"
        >
          <style>{`
            @keyframes aiGenPulse {
              0%, 100% { opacity: 0.35; transform: scale(0.92); }
              50% { opacity: 0.9; transform: scale(1.05); }
            }
            @keyframes aiGenSpin {
              to { transform: rotate(360deg); }
            }
            @keyframes aiGenShimmer {
              0% { background-position: -200% center; }
              100% { background-position: 200% center; }
            }
            @keyframes aiGenDot {
              0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
              40% { opacity: 1; transform: translateY(-3px); }
            }
          `}</style>
          <div
            style={{
              width: 'min(440px, 100%)',
              padding: '40px 36px',
              borderRadius: 22,
              background: 'linear-gradient(165deg, rgba(28,30,38,0.97) 0%, rgba(12,14,20,0.99) 100%)',
              border: '1px solid rgba(251,191,36,0.38)',
              boxShadow:
                '0 0 0 1px rgba(251,191,36,0.1), 0 28px 90px rgba(0,0,0,0.72), 0 0 140px rgba(251,191,36,0.07)',
              textAlign: 'center',
              fontFamily: 'Syne, system-ui, sans-serif',
            }}
          >
            <div style={{ position: 'relative', width: 92, height: 92, margin: '0 auto 26px' }}>
              <div
                style={{
                  position: 'absolute',
                  inset: -10,
                  borderRadius: '50%',
                  background: 'radial-gradient(circle, rgba(251,191,36,0.28) 0%, transparent 68%)',
                  animation: 'aiGenPulse 2.2s ease-in-out infinite',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '50%',
                  border: '3px solid rgba(251,191,36,0.18)',
                  borderTopColor: '#fbbf24',
                  borderRightColor: 'rgba(251,191,36,0.45)',
                  animation: 'aiGenSpin 1s linear infinite',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  inset: 16,
                  borderRadius: 18,
                  background: 'linear-gradient(145deg, rgba(251,191,36,0.2), rgba(245,158,11,0.06))',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 38,
                  lineHeight: 1,
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
                }}
              >
                ✨
              </div>
            </div>
            <div
              style={{
                fontSize: 23,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                background: 'linear-gradient(90deg, #fef3c7, #fbbf24, #d97706, #fbbf24, #fef3c7)',
                backgroundSize: '200% auto',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
                animation: 'aiGenShimmer 2.8s linear infinite',
                marginBottom: 14,
              }}
            >
              Создаём вашего бота
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: 'rgba(226,232,240,0.92)',
                lineHeight: 1.55,
                minHeight: 46,
                transition: 'opacity 0.35s ease',
              }}
            >
              {AI_GEN_LOADING_STEPS[aiLoadingStep]}
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                gap: 6,
                marginTop: 18,
              }}
            >
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: '#fbbf24',
                    animation: `aiGenDot 1.2s ease-in-out ${i * 0.18}s infinite`,
                  }}
                />
              ))}
            </div>
            <div style={{ marginTop: 22, fontSize: 11, color: 'rgba(148,163,184,0.88)', lineHeight: 1.45 }}>
              Подождите — AI собирает и проверяет сценарий. Обычно это от нескольких секунд до минуты.
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
          <InstructionsModal lang={uiLang} onClose={() => setShowInstructions(false)} />
        )}

      {/* Справка по блоку — кнопка «i» на пазле */}
      {blockInfo && (
        <BlockInfoModal block={blockInfo} onClose={() => setBlockInfo(null)} />
      )}

      {showExamples && typeof document !== 'undefined' && createPortal(
        <>
          <div
            role="presentation"
            style={{ position: 'fixed', inset: 0, zIndex: 10050 }}
            onClick={() => setShowExamples(false)}
          />
          <div
            role="menu"
            style={{
              position: 'fixed',
              top: examplesMenuRect?.top ?? 68,
              left: examplesMenuRect?.left ?? 12,
              minWidth: examplesMenuRect?.minWidth ?? 200,
              zIndex: 10051,
              background: 'var(--bg2)',
              border: `1px solid ${isMobileView ? 'var(--border)' : 'rgba(255,255,255,0.1)'}`,
              borderRadius: 10,
              boxShadow: '0 8px 32px rgba(0,0,0,0.75)',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {[['echo', builderUi.examplesEcho], ['weather', builderUi.examplesWeather], ['shop', builderUi.examplesShop], ['full', builderUi.examplesFull], ['fullTest', builderUi.examplesFullTest]].map(([key, label], i, arr) => (
              <button
                key={key}
                type="button"
                onClick={() => { loadExampleFromFile(key); setShowExamples(false); }}
                style={{
                  width: '100%',
                  padding: isMobileView ? '14px 18px' : '11px 16px',
                  textAlign: 'left',
                  background: 'transparent',
                  color: 'var(--text)',
                  border: 'none',
                  borderBottom: i < arr.length - 1 ? (isMobileView ? '1px solid var(--border)' : '1px solid rgba(255,255,255,0.07)') : 'none',
                  cursor: 'pointer',
                  fontSize: isMobileView ? 14 : 13,
                  fontFamily: isMobileView ? 'inherit' : 'Syne,system-ui',
                  display: 'block',
                }}
              >{label}</button>
            ))}
            {isMobileView && (
              <button
                type="button"
                onClick={() => { setShowLibrary(true); setShowExamples(false); }}
                style={{
                  width: '100%',
                  padding: '14px 18px',
                  textAlign: 'left',
                  background: 'transparent',
                  color: '#ffd700',
                  border: 'none',
                  borderTop: '1px solid var(--border)',
                  cursor: 'pointer',
                  fontSize: 14,
                  display: 'block',
                  fontWeight: 700,
                }}
              >{builderUi.moduleLibrary}</button>
            )}
          </div>
        </>,
        document.body,
      )}

      {mobileMoreOpen && isMobileView && typeof document !== 'undefined' && createPortal(
        <>
          <div
            role="presentation"
            style={{ position: 'fixed', inset: 0, zIndex: 10052 }}
            onClick={() => setMobileMoreOpen(false)}
          />
          <div
            role="menu"
            style={{
              position: 'fixed',
              top: 58,
              right: 8,
              background: 'var(--bg2)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              zIndex: 10053,
              minWidth: 220,
              boxShadow: '0 12px 40px rgba(0,0,0,0.8)',
              overflow: 'hidden',
              padding: '6px 0',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {isAdmin && adminOpenSupportCount > 0 && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { openAdminMenu('support'); setMobileMoreOpen(false); }}
                  style={{ width:'100%', padding:'10px 16px', textAlign:'left', background:'rgba(248,113,113,0.08)', color:'#fecaca', border:'none', cursor:'pointer', fontSize:13, fontFamily:'Syne,system-ui', display:'flex', alignItems:'center', gap:8, fontWeight:800 }}
                >🔔 Обращения: {adminOpenSupportCount}</button>
                <div style={{ height:1, background:'var(--border)', margin:'4px 0' }} />
              </>
            )}
            {userSupportUnreadCount > 0 && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { openSupportModal(); setMobileMoreOpen(false); }}
                  style={{ width:'100%', padding:'10px 16px', textAlign:'left', background:'rgba(62,207,142,0.08)', color:'#bbf7d0', border:'none', cursor:'pointer', fontSize:13, fontFamily:'Syne,system-ui', display:'flex', alignItems:'center', gap:8, fontWeight:800 }}
                >🔔 Ответы поддержки: {userSupportUnreadCount}</button>
                <div style={{ height:1, background:'var(--border)', margin:'4px 0' }} />
              </>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => { setStacks([]); setSelectedBlockId(null); setSelectedStackId(null); setMobileMoreOpen(false); }}
              style={{ width:'100%', padding:'10px 16px', textAlign:'left', background:'transparent', color:'#f87171', border:'none', cursor:'pointer', fontSize:13, fontFamily:'Syne,system-ui', display:'flex', alignItems:'center', gap:8 }}
            >✕ {builderUi.clearCanvas}</button>
            <button
              type="button"
              role="menuitem"
              onClick={() => { saveProject(); setMobileMoreOpen(false); }}
              style={{ width:'100%', padding:'10px 16px', textAlign:'left', background:'transparent', color:'#3ecf8e', border:'none', cursor:'pointer', fontSize:13, fontFamily:'Syne,system-ui', display:'flex', alignItems:'center', gap:8 }}
            >💾 {builderUi.saveFile}</button>
            {currentUser && (
              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  const name = projectName.trim() || 'Без названия';
                  await saveProjectToCloud(currentUser.id, name, stacks);
                  await loadUserProjects(currentUser.id);
                  showToast('☁ Проект сохранён в облако: ' + name, 'success');
                  setMobileMoreOpen(false);
                }}
                style={{ width:'100%', padding:'10px 16px', textAlign:'left', background:'transparent', color:'#3ecf8e', border:'none', cursor:'pointer', fontSize:13, fontFamily:'Syne,system-ui', display:'flex', alignItems:'center', gap:8 }}
              >☁ {builderUi.saveCloud}</button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMobileMoreOpen(false);
                if (!canSeeCode) {
                  openPremiumPurchase();
                  return;
                }
                loadCCD();
              }}
              style={{
                width:'100%', padding:'10px 16px', textAlign:'left', background:'transparent',
                color: canSeeCode ? '#a78bfa' : 'rgba(253,230,138,0.72)',
                border:'none', cursor:'pointer', fontSize:13, fontFamily:'Syne,system-ui',
                display:'flex', alignItems:'center', gap:8,
                opacity: canSeeCode ? 1 : 0.72,
                filter: canSeeCode ? undefined : 'saturate(0.6)',
              }}
            >{canSeeCode ? '' : '🔒 '}{builderUi.mobileLoadCcd}</button>
            <div style={{ height:1, background:'var(--border)', margin:'4px 0' }} />
            <button
              type="button"
              role="menuitem"
              onClick={() => { setBotDebugOpen(v => !v); setMobileMoreOpen(false); }}
              style={{ width:'100%', padding:'10px 16px', textAlign:'left', background:'transparent', color:'#fde047', border:'none', cursor:'pointer', fontSize:13, fontFamily:'Syne,system-ui', display:'flex', alignItems:'center', gap:8 }}
            >{builderUi.mobileMenuDebug}</button>
            {isBotRunning ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => { stopBot(); setMobileMoreOpen(false); }}
                style={{ width:'100%', padding:'10px 16px', textAlign:'left', background:'rgba(239,68,68,0.08)', color:'#f87171', border:'none', cursor:'pointer', fontSize:13, fontFamily:'Syne,system-ui', fontWeight:700, display:'flex', alignItems:'center', gap:8 }}
              >{builderUi.mobileStopBot}</button>
            ) : (
              <button
                type="button"
                role="menuitem"
                onClick={() => { startBot(); setMobileMoreOpen(false); }}
                disabled={!stacks.some(s => s.blocks.some(b => b.type === 'bot' && b.props?.token?.trim()))}
                style={{ width:'100%', padding:'10px 16px', textAlign:'left', background:'rgba(62,207,142,0.08)', color:'#3ecf8e', border:'none', cursor:'pointer', fontSize:13, fontFamily:'Syne,system-ui', fontWeight:700, display:'flex', alignItems:'center', gap:8, opacity: stacks.some(s => s.blocks.some(b => b.type === 'bot' && b.props?.token?.trim())) ? 1 : 0.4 }}
              >{builderUi.mobileStartBot}</button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => { setShowInstructions(true); setMobileMoreOpen(false); }}
              style={{ width:'100%', padding:'10px 16px', textAlign:'left', background:'transparent', color:'var(--text2)', border:'none', cursor:'pointer', fontSize:13, fontFamily:'Syne,system-ui', display:'flex', alignItems:'center', gap:8 }}
            >{builderUi.mobileInstructions}</button>
          </div>
        </>,
        document.body,
      )}

      {currentUser ? (
        /* Main layout */
        <>
        <div className="editor-main-grid" style={{ display:'grid', gridTemplateColumns: isMobileView ? '1fr' : '150px minmax(0, 1fr) 258px', overflow:'hidden', flex: 1, minHeight: 0, height: '100%', position: 'relative', zIndex: 1 }}>

        {/* Sidebar — hidden on mobile unless blocks tab */}
        {(isMobileView && mobileTab !== 'blocks') ? null : (
        <div className="editor-sidebar-shell" style={{
          background:'linear-gradient(180deg, #0d0920 0%, #080618 100%)',
          borderRight: isMobileView ? 'none' : '1px solid rgba(99,102,241,0.2)',
          display:'flex', flexDirection:'column', overflow:'hidden',
          boxShadow: isMobileView ? 'none' : '4px 0 24px rgba(0,0,0,0.4)',
          ...(isMobileView ? { gridColumn: '1', position: 'absolute', top: 0, left: 0, right: 0, bottom: 56, zIndex: 6 } : {}),
        }}
        data-tour={!isMobileView ? 'sidebar-desktop' : undefined}>
          <div className="editor-panel-title" style={{
            padding:'10px 12px 5px', fontSize:9,
            background:'linear-gradient(90deg,rgba(99,102,241,0.12),transparent)',
            borderBottom:'1px solid rgba(99,102,241,0.15)',
            color:'rgba(99,102,241,0.7)', textTransform:'uppercase', letterSpacing:'.14em', fontWeight:700,
            display:'flex', alignItems:'center', gap:6,
          }}>
            <span style={{ color:'#f97316', fontSize:12 }}>◈</span> {builderUi.mobileTabBlocks}
          </div>
          <Sidebar
            onDragStart={setDraggingNewType}
            onDragEnd={endPaletteDrag}
            onTapAdd={isMobileView ? addBlockFromPaletteTap : null} />
        </div>
        )}

        {/* Canvas — hidden on mobile unless canvas tab (or DSL bottom sheet overlays it) */}
        {(isMobileView && mobileTab !== 'canvas' && mobileTab !== 'dsl') ? null : (
        <div
          ref={canvasRef}
          data-tour="canvas-area"
          className="canvas-bg"
          style={{
            position:'relative', overflow:'hidden',
            cursor: canvasDrag ? 'grabbing' : 'default',
            touchAction: 'none',
            background: 'linear-gradient(160deg, #06030f 0%, #0a0518 50%, #080615 100%)',
            ...(isMobileView ? { gridColumn: '1', display: (mobileTab === 'canvas' || mobileTab === 'dsl') ? 'block' : 'none' } : {}),
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
              e.preventDefault();
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
                ? snapAttachRejectHint(newBlockSnap.parentType, draggingNewType, builderUi)
                : null;
              return (
                <BlockStack
                  key={stack.id}
                  stack={stack}
                  selectedId={selectedBlockId}
                  attentionBlockId={mobileAttentionBlockId}
                  onSelectBlock={handleSelectBlock}
                  onDeleteBlock={handleDeleteBlock}
                  onDragStack={handleDragStack}
                  onAddFooterAction={handleAddFooterAction}
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
              <div className="editor-empty-card" style={{
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
                  {builderUi.emptyCanvasTitle}
                </div>
                <div style={{
                  fontSize: 13, color: 'rgba(255,255,255,0.38)',
                  textAlign: 'center', maxWidth: 280, lineHeight: 1.6,
                }}>
                  {canUseAiGenerator
                    ? builderUi.emptyCanvasSubPro
                    : builderUi.emptyCanvasSubFree}
                </div>
                <button
                  onClick={openAiGeneratorModal}
                  style={{
                    padding: '13px 32px', fontSize: 14, fontWeight: 700,
                    fontFamily: 'Syne, system-ui',
                    background: canUseAiGenerator
                      ? 'linear-gradient(135deg, #f97316, #dc2626)'
                      : 'rgba(255,255,255,0.06)',
                    color: canUseAiGenerator ? '#fff' : 'rgba(253,230,138,0.72)',
                    border: canUseAiGenerator ? 'none' : '1px solid rgba(251,191,36,0.18)',
                    borderRadius: 14,
                    cursor: 'pointer',
                    boxShadow: canUseAiGenerator ? '0 8px 28px rgba(249,115,22,0.45)' : 'none',
                    transition: 'all 0.2s',
                    opacity: canUseAiGenerator ? 1 : 0.7,
                    filter: canUseAiGenerator ? undefined : 'saturate(0.65)',
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
                  {canUseAiGenerator ? builderUi.emptyCanvasAi : `🔒 ${builderUi.emptyCanvasAiLocked}`}
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
                  {builderUi.emptyCanvasTemplate}
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
                  {builderUi.emptyCanvasTour}
                </button>
                <div style={{
                  fontSize: 11, color: 'rgba(255,255,255,0.18)',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{ flex: 1, height: 1, background: 'rgba(99,102,241,0.2)', display: 'block', width: 60 }}/>
                  {builderUi.emptyCanvasDrag}
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
              <button className="editor-zoom-btn" onClick={zoomIn} title={builderUi.zoomIn}>+</button>
            )}
            <button className="editor-zoom-pct" onClick={zoomReset} title={`${builderUi.zoomReset} (${Math.round(canvasScale * 100)}%)`}>
              {Math.round(canvasScale * 100)}%
            </button>
            {!isMobileView && (
              <button className="editor-zoom-btn" onClick={zoomOut} title={builderUi.zoomOut}>−</button>
            )}
          </div>
        </div>
        )}

        {/* Right panel: props + DSL — hidden on mobile unless props/dsl tab */}
        {(isMobileView && mobileTab !== 'props' && mobileTab !== 'dsl') ? null : (
        <div className="editor-right-panel" style={{
          display:'flex', flexDirection:'column',
          borderLeft: isMobileView ? 'none' : '1px solid rgba(99,102,241,0.2)', overflow:'hidden',
          background: 'linear-gradient(180deg, #0d0920 0%, #080618 100%)',
          boxShadow: isMobileView
            ? (mobileTab === 'dsl' ? '0 -10px 34px rgba(0,0,0,0.58)' : 'none')
            : '-4px 0 24px rgba(0,0,0,0.4)',
          minWidth: 0,
          minHeight: 0,
          height: isMobileView ? undefined : '100%',
          position: 'relative',
          zIndex: 2,
          ...(isMobileView ? {
            gridColumn: '1',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 56,
            zIndex: mobileTab === 'dsl' ? 80 : 6,
            borderTop: mobileTab === 'dsl' ? '1px solid rgba(99,102,241,0.3)' : undefined,
            borderRadius: 0,
            transition: 'top 0.22s ease, border-radius 0.22s ease',
          } : {}),
        }}
        data-tour={!isMobileView ? 'props-panel-desktop' : undefined}>
          {(!isMobileView || mobileTab === 'props') && (
            <>
              <div className="editor-panel-title" style={{
                borderBottom:'1px solid rgba(99,102,241,0.15)', padding:'8px 12px',
                fontSize:9, background:'linear-gradient(90deg,rgba(99,102,241,0.12),transparent)',
                color:'rgba(99,102,241,0.7)', textTransform:'uppercase', letterSpacing:'.14em', fontWeight:700,
                display:'flex', alignItems:'center', gap:6,
              }}><span style={{ color:'#06b6d4', fontSize:11 }}>✏</span> {builderUi.propsHeader}</div>
              <div style={{ flex: isMobileView ? 1 : '1', minHeight:0, display:'flex', flexDirection:'column', overflow:'hidden' }}>
                <PropsPanel
                  block={selectedBlock}
                  onChange={handlePropChange}
                  onAttachmentChange={handleAttachmentChange}
                  onAttachmentDelete={handleAttachmentDelete}
                  stacks={stacks}
                />
              </div>
            </>
          )}
          {canSeeCode && (!isMobileView || mobileTab === 'dsl') && (
            <DSLPane
              stacks={stacks}
              isMobile={isMobileView}
              onClose={undefined}
              onApplyCorrectedCode={applyCorrectedDSLCode}
            />
          )}
          {!canSeeCode && (!isMobileView || mobileTab === 'dsl') && (
            <PremiumLockedPanel
              title="Код сценария доступен в Pro"
              text="Нажми, чтобы открыть меню покупки Premium."
              isMobile={isMobileView}
              onUpgrade={openPremiumPurchase}
            />
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
            { key: 'canvas', icon: '⊞', label: builderUi.mobileTabCanvas },
            { key: 'blocks', icon: '🧱', label: builderUi.mobileTabBlocks },
            { key: 'props',  icon: '✏️', label: builderUi.mobileTabProps },
            { key: 'dsl', icon: canSeeCode ? '📜' : '🔒', label: builderUi.mobileTabDsl, locked: !canSeeCode },
          ].map(tab => (
            <button
              key={tab.key}
              data-tour={tab.key === 'canvas' ? 'mobile-tab-canvas' : tab.key === 'blocks' ? 'mobile-tab-blocks' : tab.key === 'props' ? 'mobile-tab-props' : tab.key === 'dsl' ? 'mobile-tab-dsl' : undefined}
              onClick={() => {
                if (tab.locked) {
                  openPremiumPurchase();
                  return;
                }
                if (tab.key === 'dsl') {
                  setMobileTab(prev => prev === 'dsl' ? 'canvas' : 'dsl');
                  return;
                }
                setMobileTab(tab.key);
              }}
              className={`editor-mobile-tab${mobileTab === tab.key ? ' active' : ''}${tab.locked ? ' locked-premium' : ''}`}
              title={tab.locked ? 'Доступно в Pro' : undefined}
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
            title={!isBotRunning && !_hasToken ? builderUi.addBotTokenTitle : ''}
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
              {isBotRunning ? builderUi.mobileStop : builderUi.mobileRun}
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
          labels={builderUi}
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
          initialTab={profileInitialTab}
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
          onUploadAvatar={async (dataUrl) => {
            const merged = await uploadAvatar(currentUser.id, dataUrl, currentUser);
            setCurrentUser(merged);
            saveSession(merged);
            return merged;
          }}
          onLoadProject={async (projectId) => {
            const project = await loadProjectFromCloud(projectId);
            if (project) {
              setStacks(normalizeStudioStacks(project.stacks));
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
          ref={previewPanelRef}
          style={{
            position: 'fixed',
            ...(previewPanelPos
              ? {
                  left: previewPanelPos.left,
                  top: previewPanelPos.top,
                  right: 'auto',
                  bottom: 'auto',
                  ...(isMobileView
                    ? { width: 'calc(100vw - 16px)', maxWidth: 420, height: 'min(480px, 52vh)' }
                    : { width: 340, height: 'min(480px, 52vh)' }),
                }
              : isMobileView
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
          <div
            role="presentation"
            onMouseDown={startPreviewPanelDrag}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.07)',
              background: 'rgba(56,189,248,0.06)',
              cursor: 'grab',
              userSelect: 'none',
            }}
          >
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
            Сервер выполняет сценарий через mock Telegram (без вашего Bot API) на установленном ядре{' '}
            <span style={{ color: '#7dd3fc' }}>cicada-tg</span>.
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
            Например, отправьте <strong>/start</strong>, текст или файл (как в Telegram). Нажимайте кнопки — для превью это те же сообщения/callback.
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
                  <div style={{ marginBottom: 8 }}><PreviewRichText text={m.text} format={m.format} /></div>
                )}
                {m.role === 'bot' && m.kind === 'inline_keyboard' && (m.text || '').trim().length > 0 && (
                  <div style={{ marginBottom: 8 }}><PreviewRichText text={m.text} format={m.format} /></div>
                )}
                {m.role === 'bot' && m.kind === 'text' && <span><PreviewRichText text={m.text} format={m.format} /></span>}
                {m.role === 'user' && m.kind === 'text' && <span>{m.text}</span>}
                {m.role === 'user' && (m.kind === 'document' || m.kind === 'photo') && (
                  <span>
                    {m.kind === 'photo' ? '🖼 ' : '📎 '}{m.fileName || 'файл'}
                    {m.caption ? `\n${m.caption}` : ''}
                  </span>
                )}
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
          <div style={{ display: 'flex', gap: 6, padding: 10, borderTop: '1px solid rgba(255,255,255,0.07)', alignItems: 'center' }}>
            <input
              ref={previewFileInputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) sendPreviewUserFile(f);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={previewBusy}
              title="Прикрепить файл"
              aria-label="Прикрепить файл"
              onClick={() => previewFileInputRef.current?.click()}
              style={{
                flexShrink: 0,
                width: 38,
                height: 38,
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.14)',
                background: 'rgba(15,23,42,0.75)',
                color: '#94a3b8',
                fontSize: 18,
                lineHeight: 1,
                cursor: previewBusy ? 'wait' : 'pointer',
              }}
            >
              📎
            </button>
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
          ref={botDebugPanelRef}
          style={{
            position: 'fixed',
            ...(botDebugPanelPos
              ? {
                  left: botDebugPanelPos.left,
                  top: botDebugPanelPos.top,
                  right: 'auto',
                  bottom: 'auto',
                  ...(isMobileView
                    ? { width: 'calc(100vw - 16px)', maxWidth: 480, height: 'min(440px, 52vh)' }
                    : { width: 'min(420px, 38vw)', height: 'min(440px, 52vh)' }),
                }
              : isMobileView
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
          <div
            role="presentation"
            onMouseDown={startBotDebugPanelDrag}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.07)',
              background: 'rgba(250,204,21,0.06)',
              fontFamily: 'Syne,system-ui, sans-serif',
              cursor: 'grab',
              userSelect: 'none',
            }}
          >
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
    </BuilderUiContext.Provider>
  );
}
