import React, { useState } from 'react';
import { forgotPassword, resetPassword } from '../apiClient.js';
import { fireRegistrationConfetti, translateServerError, useParticleCanvas } from '../authHelpers.js';
import cicadaLogo from '../cicada-logo_1778117072446.jpeg';

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
  const [hovered, setHovered] = React.useState(false);

  React.useEffect(() => {
    if (!TG_BOT_NAME || !widgetRef.current) return;
    const widgetHost = widgetRef.current;
    widgetHost.innerHTML = '';

    const stretchTelegramIframe = () => {
      const iframe = widgetHost.querySelector('iframe');
      if (!iframe) return;
      Object.assign(iframe.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        minWidth: '100%',
        minHeight: '100%',
        border: '0',
        opacity: '0.001',
        zIndex: '2',
        cursor: 'pointer',
      });
      iframe.setAttribute('title', 'Telegram');
      iframe.setAttribute('aria-label', 'Telegram');
    };

    const authUrl = getTelegramWidgetAuthCallbackUrl();
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.setAttribute('data-telegram-login', TG_BOT_NAME);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '12');
    script.setAttribute('data-request-access', 'write');
    script.async = true;

    if (authUrl) {
      // Редирект на бэкенд — обходит cross-origin iframe.
      script.setAttribute('data-auth-url', authUrl);
    } else {
      script.setAttribute('data-onauth', 'onTelegramAuth(user)');
      window.onTelegramAuth = async (user) => {
        try {
          await onLogin(null, null, '', user);
        } catch (e) {
          console.error('TG auth error:', e);
        }
      };
    }

    const observer = new MutationObserver(stretchTelegramIframe);
    observer.observe(widgetHost, { childList: true, subtree: true });
    widgetHost.appendChild(script);
    stretchTelegramIframe();

    return () => {
      observer.disconnect();
      delete window.onTelegramAuth;
    };
  }, [onLogin]);

  if (!TG_BOT_NAME) return null;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Telegram"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: 1,
        position: 'relative',
        minHeight: 48,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 9,
        padding: '13px 14px',
        borderRadius: 12,
        border: hovered ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(255,255,255,0.1)',
        background: hovered ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)',
        color: 'rgba(255,255,255,0.85)',
        fontFamily: 'inherit',
        fontWeight: 500,
        fontSize: 14,
        cursor: 'pointer',
        transition: 'all .2s',
        transform: hovered ? 'translateY(-1px)' : 'none',
        overflow: 'hidden',
      }}
    >
      <div ref={widgetRef} style={{ position: 'absolute', inset: 0, zIndex: 2 }} />
      <svg width="18" height="18" viewBox="0 0 240 240" aria-hidden="true" style={{ position: 'relative', zIndex: 1, flex: '0 0 auto' }}>
        <circle cx="120" cy="120" r="120" fill="#2AABEE" />
        <path fill="#fff" d="M178.9 72.1c2.1-8.8-3.2-12.3-9.5-9.8L52.1 107.5c-8 3.1-7.9 7.6-1.4 9.6l30.1 9.4 69.7-44c3.3-2 6.3-.9 3.8 1.3l-56.5 51 0 0-2.2 32.1c3.2 0 4.7-1.5 6.5-3.2l15.7-15.3 32.7 24.2c6 3.3 10.4 1.6 11.9-5.6l21.5-101.2Z" />
      </svg>
      <span style={{ position: 'relative', zIndex: 1 }}>Telegram</span>
    </div>
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

export default function AuthModal({ tab, setTab, onClose, onLogin, onRegister, canClose = true, oauth2faPending = false }) {
  const uiLang = React.useMemo(() => {
    const lang = (typeof navigator !== 'undefined' ? navigator.language : 'ru').toLowerCase();
    if (lang.startsWith('en')) return 'en';
    if (lang.startsWith('uk')) return 'uk';
    return 'ru';
  }, []);
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
    if (!(oauth2faPending && tab === 'login')) {
      if (!email || !email.includes('@')) e.email = 'Введите корректный email';
      if (!password || password.length < 6) e.password = 'Минимум 6 символов';
    }
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
        if (oauth2faPending) setTotpRequired(true);
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


  const handlePasskeyLogin = async () => {
    setServerError('');
    setErrors({});
    setLoading(true);
    try {
      await onLogin(email, null, '', null, true);
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
      className="auth-modal-overlay"
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
        @keyframes passkeyFingerprintPulse { 0%,100%{transform:scale(1);filter:drop-shadow(0 0 2px rgba(255,255,255,.25))} 50%{transform:scale(1.15);filter:drop-shadow(0 0 10px rgba(62,207,142,.85))} }
        @keyframes passkeyRingScan { 0%{transform:scale(.65);opacity:.75} 100%{transform:scale(1.7);opacity:0} }
        .passkey-mobile-login { display:none; }
        .am-social-btn:hover { background:rgba(255,255,255,0.08); border-color:rgba(255,255,255,0.2); transform:translateY(-1px); }
        .am-tg-btn { background:rgba(33,150,243,0.07) !important; border-color:rgba(33,150,243,0.25) !important; }
        .am-tg-btn:hover { background:rgba(33,150,243,0.14) !important; border-color:rgba(33,150,243,0.45) !important; }
        @media (max-width: 640px) {
          .auth-modal-overlay {
            align-items:stretch !important;
            justify-content:center !important;
            padding:0 !important;
            overflow-y:auto !important;
            background:
              radial-gradient(circle at 22% 18%, rgba(249,115,22,0.24), transparent 28%),
              radial-gradient(circle at 78% 12%, rgba(124,58,237,0.34), transparent 32%),
              radial-gradient(circle at 48% 72%, rgba(249,115,22,0.2), transparent 36%),
              linear-gradient(160deg,#09041a 0%,#16072d 44%,#09051a 100%) !important;
          }
          .auth-modal-overlay::before {
            content:'';
            position:absolute;
            inset:0;
            pointer-events:none;
            background:
              linear-gradient(115deg, transparent 0 28%, rgba(249,115,22,0.08) 28.2%, transparent 28.7%),
              linear-gradient(24deg, transparent 0 62%, rgba(99,102,241,0.1) 62.2%, transparent 62.8%),
              radial-gradient(circle, rgba(255,255,255,0.16) 0 1px, transparent 1.8px);
            background-size:100% 100%,100% 100%,84px 84px;
            opacity:.7;
          }
          .auth-modal-card {
            width:100% !important;
            max-width:480px !important;
            min-height:100dvh !important;
            max-height:none !important;
            margin:0 auto !important;
            border:none !important;
            border-radius:0 !important;
            background:linear-gradient(180deg,rgba(14,7,34,0.24),rgba(7,4,22,0.1)) !important;
            box-shadow:none !important;
            overflow-y:auto !important;
            backdrop-filter:none !important;
          }
          .auth-modal-head {
            padding:42px 26px 20px !important;
          }
          .auth-modal-card img {
            border-radius:18px !important;
          }
          .auth-modal-card form,
          .auth-tab-section,
          .auth-screen-section {
            padding-left:24px !important;
            padding-right:24px !important;
          }
          .auth-tab-switcher {
            border-radius:14px !important;
            padding:4px !important;
            border:1px solid rgba(99,102,241,0.55) !important;
            background:linear-gradient(135deg,rgba(249,115,22,0.16),rgba(99,102,241,0.2)) !important;
            box-shadow:0 0 26px rgba(99,102,241,0.28), inset 0 0 18px rgba(255,255,255,0.04) !important;
          }
          .am-input-wrap input {
            min-height:58px !important;
            border-radius:14px !important;
            background:rgba(28,14,56,0.5) !important;
            border-color:rgba(255,255,255,0.24) !important;
            box-shadow:
              0 0 0 1px rgba(99,102,241,0.12),
              inset 0 0 20px rgba(99,102,241,0.1),
              0 0 24px rgba(249,115,22,0.08) !important;
            font-size:16px !important;
          }
          .am-input-wrap input:focus {
            border-color:rgba(249,115,22,0.78) !important;
            box-shadow:
              0 0 0 1px rgba(249,115,22,0.26),
              0 0 24px rgba(249,115,22,0.22),
              0 0 30px rgba(99,102,241,0.18),
              inset 0 0 22px rgba(99,102,241,0.12) !important;
          }
          .auth-primary-btn {
            min-height:58px !important;
            border-radius:14px !important;
            font-size:16px !important;
            font-weight:800 !important;
            background:linear-gradient(135deg,#ff5c1a 0%,#ef1f39 62%,#9d1cff 100%) !important;
            box-shadow:
              0 0 0 1px rgba(255,255,255,0.12),
              0 10px 34px rgba(239,31,57,0.34),
              0 0 26px rgba(157,28,255,0.26) !important;
          }
          .passkey-mobile-login {
            display:flex !important;
            min-height:56px !important;
            border-radius:14px !important;
            background:linear-gradient(135deg,rgba(34,211,238,0.18),rgba(124,58,237,0.52)) !important;
            border:1px solid rgba(34,211,238,0.42) !important;
            box-shadow:
              0 0 26px rgba(34,211,238,0.22),
              0 0 30px rgba(124,58,237,0.24),
              inset 0 0 18px rgba(255,255,255,0.08) !important;
            letter-spacing:.04em !important;
          }
          .auth-link-row {
            font-size:14px !important;
          }
          .auth-divider {
            margin-top:4px !important;
          }
          .auth-social-row {
            gap:12px !important;
          }
          .auth-social-row > * {
            min-height:52px !important;
            border-radius:14px !important;
            border-color:rgba(99,102,241,0.42) !important;
            background:rgba(28,14,56,0.42) !important;
            box-shadow:0 0 18px rgba(99,102,241,0.18), inset 0 0 18px rgba(255,255,255,0.04) !important;
          }
        }
      `}</style>

      {totpRequired && (<div style={{ position:'absolute', top: 16, left:'50%', transform:'translateX(-50%)', zIndex: 20, padding:'10px 14px', borderRadius:12, border:'1px solid rgba(251,191,36,0.45)', background:'rgba(251,191,36,0.12)', color:'#fde68a', fontSize:12, fontWeight:700, fontFamily:'Syne,system-ui' }}>🔐 Включена 2FA — подтвердите вход кодом из Authenticator</div>)}
      {/* Particle canvas background */}
      <canvas ref={canvasRef} style={{ position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none' }} />
      {/* Ambient depth orbs (layered over canvas) */}
      <div style={{ position:'absolute', top:'8%', left:'12%', width:520, height:520, borderRadius:'50%', background:'radial-gradient(circle,rgba(255,90,20,0.1) 0%,transparent 70%)', filter:'blur(50px)', animation:'amOrb1 9s ease-in-out infinite', pointerEvents:'none' }} />
      <div style={{ position:'absolute', bottom:'10%', right:'8%', width:440, height:440, borderRadius:'50%', background:'radial-gradient(circle,rgba(110,50,240,0.08) 0%,transparent 70%)', filter:'blur(55px)', animation:'amOrb2 11s ease-in-out infinite', pointerEvents:'none' }} />
      {/* Grid overlay */}
      <div style={{ position:'absolute', inset:0, pointerEvents:'none', backgroundImage:'linear-gradient(rgba(255,255,255,0.012) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.012) 1px,transparent 1px)', backgroundSize:'64px 64px' }} />

      <div
        className="auth-modal-card"
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
        <div className="auth-modal-head" style={{ padding: '32px 32px 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
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
          <div className="auth-tab-section" style={{ padding: '0 28px 22px' }}>
            <div className="auth-tab-switcher" style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 4, border: '1px solid rgba(255,255,255,0.07)', position: 'relative' }}>
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
          <div className="auth-screen-section" style={{ padding: '0 32px 36px', textAlign: 'center' }}>
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
          <div className="auth-screen-section" style={{ padding: '0 32px 36px', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <div style={{ fontFamily: 'Syne,system-ui', fontWeight: 700, fontSize: 16, color: '#fff', marginBottom: 12 }}>Пароль изменён!</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6, marginBottom: 24 }}>Теперь вы можете войти с новым паролем.</div>
            <button onClick={() => { setScreen('form'); setTab('login'); setPassword(''); setConfirmPassword(''); }} style={{ padding: '12px 28px', background: 'linear-gradient(135deg,#f97316,#dc2626)', color: '#fff', fontWeight: 700, fontSize: 14, border: 'none', borderRadius: 12, cursor: 'pointer', boxShadow: '0 6px 20px rgba(249,115,22,0.4)' }}>→ Войти</button>
          </div>
        )}

        {/* ── Main form ── */}
        {screen === 'form' && (
          <form className="auth-form" onSubmit={handleSubmit} style={{ padding: '0 28px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>


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
                <input type={showPass ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} onFocus={() => setFocusedField('password')} onBlur={() => setFocusedField(null)} style={fieldInput('password', { paddingRight: 46 })} placeholder={uiLang === 'en' ? 'Minimum 6 characters' : uiLang === 'uk' ? 'Мінімум 6 символів' : 'Минимум 6 символов'} autoComplete={tab === 'login' ? 'current-password' : 'new-password'} />
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
              className="auth-primary-btn"
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
              <button
                type="button"
                className="passkey-mobile-login auth-passkey-btn"
                onClick={handlePasskeyLogin}
                disabled={loading}
                style={{ width: '100%', padding: '14px 18px', fontSize: 15, fontWeight: 800, fontFamily: 'Syne,system-ui', background: 'linear-gradient(135deg,#7c3aed,#2563eb)', color: '#fff', border: 'none', borderRadius: 12, cursor: loading ? 'not-allowed' : 'pointer', boxShadow: '0 8px 24px rgba(37,99,235,0.32)', alignItems: 'center', justifyContent: 'center', gap: 10, letterSpacing: '0.12em', position: 'relative', overflow: 'hidden', opacity: loading ? 0.65 : 1 }}
              >
                <span style={{ position: 'absolute', width: 42, height: 42, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.25)', animation: 'passkeyRingScan 1.5s ease-out infinite' }} />
                <span style={{ fontSize: 21, lineHeight: 1, animation: 'passkeyFingerprintPulse 1.4s ease-in-out infinite', zIndex: 1 }}>⌾</span>
                <span style={{ zIndex: 1 }}>Войти по отпечатку</span>
              </button>
            )}

            {tab === 'login' && (
              <div className="auth-link-row" style={{ textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,0.3)' }}>
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
              <div className="auth-link-row" style={{ textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,0.3)' }}>
                Уже есть аккаунт?{' '}
                <span onClick={() => setTab('login')} style={{ color: '#ffd700', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}>Войти</span>
              </div>
            )}

            {/* OR divider */}
            <div className="auth-divider" style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 2 }}>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', fontFamily: 'system-ui', letterSpacing: '0.08em' }}>или войти через</span>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
            </div>

            {/* OAuth buttons — side by side */}
            <div className="auth-social-row" style={{ display: 'flex', gap: 10 }}>
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
