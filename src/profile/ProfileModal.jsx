import React, { useState } from 'react';
import { getConstructorStrings } from '../builderI18n.js';
import { BuilderUiContext } from '../builderContext.js';
import { apiFetch, postJsonWithCsrf, saveSession, requestEmailChange, confirmEmailChange, sha256hex, resolveApiAssetUrl } from '../apiClient.js';
import { registerProfilePasskey, translateServerError } from '../authHelpers.js';
import { fetchPublicPlans, formatUsdPrice } from '../pricingPlans.js';

// ═══════════════════════════════════════════════════════════════════════════
// SUBSCRIPTION TAB COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_PLANS = [
  { key: '2w', label: '2 недели',  days: 14,  usd: 1  },
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
  const [checkingPayment, setCheckingPayment] = React.useState(false);
  const [loadingStatus, setLoadingStatus] = React.useState(true);
  const [PLANS, setPlans] = React.useState(DEFAULT_PLANS);

  React.useEffect(() => {
    fetchPublicPlans()
      .then((plans) => {
        const merged = DEFAULT_PLANS.map((def) => {
          const srv = plans?.[def.key];
          return srv
            ? {
              ...def,
              label: srv.label || def.label,
              days: Number.isFinite(Number(srv.days)) ? Number(srv.days) : def.days,
              usd: Number.isFinite(Number(srv.usd)) ? Number(srv.usd) : def.usd,
            }
            : def;
        });
        setPlans(merged);
      })
      .catch(() => {});
  }, []);

  const statusFromUser = React.useCallback((user) => {
    const subscriptionExp = user?.subscriptionExp ?? null;
    const active = user?.plan === 'pro' && subscriptionExp != null && Number(subscriptionExp) > Date.now();
    return {
      plan: active ? 'pro' : 'trial',
      subscriptionExp,
      daysLeft: active ? Math.ceil((Number(subscriptionExp) - Date.now()) / 86400000) : 0,
    };
  }, []);

  const refreshStatus = React.useCallback(async () => {
    const data = await apiFetch(`/api/subscription/status?userId=${userId}`);
    setStatus(data);
    return data;
  }, [userId]);

  React.useEffect(() => {
    refreshStatus()
      .then(() => setLoadingStatus(false))
      .catch(() => setLoadingStatus(false));
  }, [refreshStatus]);

  const syncPaidInvoices = React.useCallback(async ({ silent = false } = {}) => {
    try {
      const res = await postJsonWithCsrf('/api/subscription/sync', { userId });
      const data = await res.json();
      if (data.error) {
        if (!silent) showToast(data.error, 'error');
        return false;
      }
      if (data.user) {
        saveSession(data.user);
        setStatus(statusFromUser(data.user));
        window.dispatchEvent(new Event('pageshow'));
      } else {
        await refreshStatus();
      }
      const active = data.user?.plan === 'pro' && Number(data.user?.subscriptionExp || 0) > Date.now();
      if ((data.activated || active) && !silent) showToast('Оплата найдена, Premium активирован', 'success');
      return Boolean(data.activated || active);
    } catch (e) {
      if (!silent) showToast('Не удалось проверить оплату: ' + e.message, 'error');
      return false;
    }
  }, [refreshStatus, showToast, statusFromUser, userId]);

  const startPaymentPolling = React.useCallback(() => {
    setCheckingPayment(true);
    let attempts = 0;
    const tick = async () => {
      attempts += 1;
      const activated = await syncPaidInvoices({ silent: true });
      if (activated) {
        showToast('Оплата найдена, Premium активирован', 'success');
        setCheckingPayment(false);
        return;
      }
      if (attempts < 12) {
        window.setTimeout(tick, 5000);
      } else {
        setCheckingPayment(false);
        showToast('Если оплата уже прошла, нажмите «Проверить оплату».', 'info');
      }
    };
    window.setTimeout(tick, 4000);
  }, [showToast, syncPaidInvoices]);

  React.useEffect(() => {
    const onFocus = () => {
      syncPaidInvoices({ silent: true });
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [syncPaidInvoices]);

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
      showToast('Счёт открыт. После оплаты вернитесь на эту вкладку.', 'info');
      startPaymentPolling();
    } catch (e) {
      showToast('Ошибка: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleManualPaymentCheck = async () => {
    setCheckingPayment(true);
    try {
      const found = await syncPaidInvoices({ silent: false });
      if (!found) showToast('Оплаченных счетов пока не найдено', 'info');
    } finally {
      setCheckingPayment(false);
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
                {formatUsdPrice(p.usd)}
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
            ≈ {formatUsdPrice(plan.usd)} <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>в {asset.label}</span>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 2 }}>
            Точная сумма рассчитается по курсу CryptoBot
          </div>
        </div>
        <button
          onClick={handleBuy}
          disabled={loading || checkingPayment}
          style={{
            padding: '13px 24px', fontSize: 13, fontWeight: 700,
            fontFamily: 'Syne, system-ui',
            background: loading || checkingPayment ? 'rgba(255,215,0,0.3)' : 'linear-gradient(135deg,#ffd700,#ffaa00)',
            color: '#111', border: 'none', borderRadius: 12,
            cursor: loading || checkingPayment ? 'not-allowed' : 'pointer',
            boxShadow: loading || checkingPayment ? 'none' : '0 6px 20px rgba(255,215,0,0.3)',
            transition: 'all 0.2s', whiteSpace: 'nowrap',
          }}
        >
          {loading ? 'Создаём...' : checkingPayment ? 'Проверяем...' : '→ Оплатить'}
        </button>
      </div>

      <button
        type="button"
        onClick={handleManualPaymentCheck}
        disabled={checkingPayment}
        style={{
          width: '100%', padding: '11px 16px', borderRadius: 12,
          border: '1px solid rgba(255,215,0,0.18)',
          background: checkingPayment ? 'rgba(255,215,0,0.08)' : 'rgba(255,255,255,0.03)',
          color: checkingPayment ? 'rgba(255,215,0,0.7)' : '#ffd700',
          fontSize: 12, fontWeight: 700, fontFamily: 'Syne, system-ui',
          cursor: checkingPayment ? 'not-allowed' : 'pointer',
        }}
      >
        {checkingPayment ? 'Проверяем оплату...' : 'Проверить оплату'}
      </button>

      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', textAlign: 'center', lineHeight: 1.6 }}>
        Оплата через CryptoPay · После оплаты подписка активируется автоматически или через проверку оплаты
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

export default function ProfileModal({ user, projects, initialTab = 'profile', onClose, onLogout, onUpdateUser, onUploadAvatar, onLoadProject, onDeleteProject, onSaveToCloud, showToast, isMobile, onOpenInstructions }) {
  const builderUiContext = React.useContext(BuilderUiContext);
  const builderUiForToast = builderUiContext?.t;
  const uiLang = (builderUiContext?.lang || user.uiLanguage || 'ru').toLowerCase();
  const I18N = {
    ru: {
      newProject: 'Новый проект',
      profile: 'Профиль',
      projects: 'Проекты',
      subscription: 'Подписка',
      purchases: 'Покупки',
      settings: 'Настройки',
      docs: 'Документация',
      support: 'Обращения',
      quickActions: 'Быстрые действия',
      newProjectSub: 'Создать бота с нуля',
      docsSub: 'Открыть инструкцию',
      supportSub: 'Написать в поддержку',
      personalInfo: 'Личная информация',
      projectsCount: 'ПРОЕКТОВ',
      daysWithUs: 'ДНЕЙ С НАМИ',
      planLabel: 'ТАРИФ',
      supportLabel: 'ПОДДЕРЖКА',
      registrationDate: 'Дата регистрации',
      lastLogin: 'Последний вход',
      today: 'Сегодня',
      noProjects: 'Нет проектов',
      saveProjectHint: 'Сохраните проект через кнопку «Сохранить проект» на панели',
      botTestToken: '🤖 Токен бота для теста',
      botTestTokenHint: 'Токен будет автоматически подставляться в новые блоки «Бот» и в схемы, сгенерированные AI.',
      tokenSaved: '✅ Токен сохранён',
      tokenRemoved: 'Токен удалён',
      removeToken: '✕ Убрать',
      dangerZone: 'Опасная зона',
      logoutAccount: '↩ Выйти из аккаунта',
      upgradePro: 'Перейти на Pro →',
      logoutConfirm: 'Выйти из аккаунта?',
      editProfile: '✎ Редактировать профиль',
      avatar: 'Аватар',
      uploadPhoto: '📷 Загрузить фото',
      saving: '⏳ Сохраняем…',
      remove: 'Удалить',
      maxFile: '@ Максимум 15MB',
      language: 'Язык',
      interfaceLanguage: 'Язык интерфейса',
      profileData: 'Данные профиля',
      name: 'Имя',
      yourName: 'Ваше имя',
      codeSent: '📧 Код отправлен',
      sentTo: 'на',
      checking: '⏳ Проверяем...',
      enterCodeFor: 'Введите его для подтверждения смены на',
      confirm: 'Подтвердить',
      cancel: 'Отмена',
      saved: '✓ Сохранено!',
      sendingCode: '⏳ Отправляем код...',
      saveChanges: '✦ Сохранить изменения',
      security: 'Безопасность',
      changePassword: 'Изменить пароль',
      passwordChangedAgo: 'Последнее изменение 2 мес. назад',
      twoFactor: 'Двухфакторная аутентификация',
      enabled: 'Включена',
      disabled: 'Выключена',
    },
    en: {
      newProject: 'New project',
      profile: 'Profile',
      projects: 'Projects',
      subscription: 'Subscription',
      purchases: 'Purchases',
      settings: 'Settings',
      docs: 'Documentation',
      support: 'Requests',
      quickActions: 'Quick actions',
      newProjectSub: 'Create a bot from scratch',
      docsSub: 'Open the guide',
      supportSub: 'Contact support',
      personalInfo: 'Personal information',
      projectsCount: 'PROJECTS',
      daysWithUs: 'DAYS WITH US',
      planLabel: 'PLAN',
      supportLabel: 'SUPPORT',
      registrationDate: 'Registration date',
      lastLogin: 'Last login',
      today: 'Today',
      noProjects: 'No projects',
      saveProjectHint: 'Save a project with the “Save project” button in the toolbar',
      botTestToken: '🤖 Test bot token',
      botTestTokenHint: 'The token will be inserted automatically into new “Bot” blocks and AI-generated flows.',
      tokenSaved: '✅ Token saved',
      tokenRemoved: 'Token removed',
      removeToken: '✕ Remove',
      dangerZone: 'Danger zone',
      logoutAccount: '↩ Sign out',
      upgradePro: 'Upgrade to Pro →',
      logoutConfirm: 'Sign out?',
      editProfile: '✎ Edit profile',
      avatar: 'Avatar',
      uploadPhoto: '📷 Upload photo',
      saving: '⏳ Saving…',
      remove: 'Remove',
      maxFile: '@ Maximum 15MB',
      language: 'Language',
      interfaceLanguage: 'Interface language',
      profileData: 'Profile data',
      name: 'Name',
      yourName: 'Your name',
      codeSent: '📧 Code sent',
      sentTo: 'to',
      checking: '⏳ Checking...',
      enterCodeFor: 'Enter it to confirm changing to',
      confirm: 'Confirm',
      cancel: 'Cancel',
      saved: '✓ Saved!',
      sendingCode: '⏳ Sending code...',
      saveChanges: '✦ Save changes',
      security: 'Security',
      changePassword: 'Change password',
      passwordChangedAgo: 'Last changed 2 months ago',
      twoFactor: 'Two-factor authentication',
      enabled: 'Enabled',
      disabled: 'Disabled',
    },
    uk: {
      newProject: 'Новий проєкт',
      profile: 'Профіль',
      projects: 'Проєкти',
      subscription: 'Підписка',
      purchases: 'Покупки',
      settings: 'Налаштування',
      docs: 'Документація',
      support: 'Звернення',
      quickActions: 'Швидкі дії',
      newProjectSub: 'Створити бота з нуля',
      docsSub: 'Відкрити інструкцію',
      supportSub: 'Написати в підтримку',
      personalInfo: 'Особиста інформація',
      projectsCount: 'ПРОЄКТІВ',
      daysWithUs: 'ДНІВ З НАМИ',
      planLabel: 'ТАРИФ',
      supportLabel: 'ПІДТРИМКА',
      registrationDate: 'Дата реєстрації',
      lastLogin: 'Останній вхід',
      today: 'Сьогодні',
      noProjects: 'Немає проєктів',
      saveProjectHint: 'Збережіть проєкт кнопкою «Зберегти проєкт» на панелі',
      botTestToken: '🤖 Токен бота для тесту',
      botTestTokenHint: 'Токен автоматично підставлятиметься в нові блоки «Бот» і схеми, згенеровані AI.',
      tokenSaved: '✅ Токен збережено',
      tokenRemoved: 'Токен видалено',
      removeToken: '✕ Прибрати',
      dangerZone: 'Небезпечна зона',
      logoutAccount: '↩ Вийти з акаунту',
      upgradePro: 'Перейти на Pro →',
      logoutConfirm: 'Вийти з акаунту?',
      editProfile: '✎ Редагувати профіль',
      avatar: 'Аватар',
      uploadPhoto: '📷 Завантажити фото',
      saving: '⏳ Зберігаємо…',
      remove: 'Видалити',
      maxFile: '@ Максимум 15MB',
      language: 'Мова',
      interfaceLanguage: 'Мова інтерфейсу',
      profileData: 'Дані профілю',
      name: 'Ім’я',
      yourName: 'Ваше ім’я',
      codeSent: '📧 Код надіслано',
      sentTo: 'на',
      checking: '⏳ Перевіряємо...',
      enterCodeFor: 'Введіть його, щоб підтвердити зміну на',
      confirm: 'Підтвердити',
      cancel: 'Скасувати',
      saved: '✓ Збережено!',
      sendingCode: '⏳ Надсилаємо код...',
      saveChanges: '✦ Зберегти зміни',
      security: 'Безпека',
      changePassword: 'Змінити пароль',
      passwordChangedAgo: 'Остання зміна 2 міс. тому',
      twoFactor: 'Двофакторна автентифікація',
      enabled: 'Увімкнена',
      disabled: 'Вимкнена',
    },
  };
  const t = I18N[uiLang] || I18N.ru;
  const [activeTab, setActiveTab] = useState(initialTab || 'profile');
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

  React.useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  // Синхронизируем newAvatar если user.photo_url изменился снаружи
  React.useEffect(() => {
    setNewAvatar(user.photo_url || '');
  }, [user.photo_url]);

  // Синхронизируем testToken если user.test_token изменился снаружи
  React.useEffect(() => {
    setTestToken(user.test_token || '');
  }, [user.test_token]);


  React.useEffect(() => {
    let cancelled = false;
    apiFetch('/api/passkeys')
      .then((data) => { if (!cancelled) setPasskeyCount(Array.isArray(data.passkeys) ? data.passkeys.length : 0); })
      .catch(() => { if (!cancelled) setPasskeyCount(null); });
    return () => { cancelled = true; };
  }, [user.id]);

  const loadPurchases = React.useCallback(async () => {
    setPurchasesLoading(true);
    try {
      const data = await apiFetch('/api/subscription/purchases');
      setPurchases(Array.isArray(data.purchases) ? data.purchases : []);
    } catch (e) {
      showToast('Не удалось загрузить покупки: ' + (e.message || 'ошибка'), 'error');
    } finally {
      setPurchasesLoading(false);
    }
  }, [showToast]);

  const loadSupportRequests = React.useCallback(async () => {
    setSupportRequestsLoading(true);
    try {
      const data = await apiFetch('/api/support/requests');
      setSupportRequests(Array.isArray(data.requests) ? data.requests : []);
      postJsonWithCsrf('/api/support/requests/seen', {})
        .then(() => {
          window.dispatchEvent(new CustomEvent('cicada:support-unread-updated', { detail: { count: 0 } }));
        })
        .catch(() => {});
    } catch (e) {
      showToast('Не удалось загрузить обращения: ' + (e.message || 'ошибка'), 'error');
    } finally {
      setSupportRequestsLoading(false);
    }
  }, [showToast]);

  React.useEffect(() => {
    if (activeTab === 'purchases') loadPurchases();
    if (activeTab === 'support') loadSupportRequests();
  }, [activeTab, loadPurchases, loadSupportRequests]);

  // Email change flow: 'idle' | 'sending' | 'code-sent' | 'confirming'
  const [emailChangeStep, setEmailChangeStep] = useState('idle');
  const [emailChangeCode, setEmailChangeCode] = useState('');
  const [emailChangePending, setEmailChangePending] = useState('');
  const [emailChangeError, setEmailChangeError] = useState('');
  const [supportFrom, setSupportFrom] = useState(user.email || user.name || '');
  const [supportSubject, setSupportSubject] = useState('');
  const [supportMessage, setSupportMessage] = useState('');
  const [supportAttachments, setSupportAttachments] = useState([]);
  const [supportDrafts, setSupportDrafts] = useState({});
  const [supportDraftAttachments, setSupportDraftAttachments] = useState({});
  const [supportSending, setSupportSending] = useState(false);
  const [purchases, setPurchases] = useState([]);
  const [purchasesLoading, setPurchasesLoading] = useState(false);
  const [supportRequests, setSupportRequests] = useState([]);
  const [supportRequestsLoading, setSupportRequestsLoading] = useState(false);
  const [passkeySaving, setPasskeySaving] = useState(false);
  const [passkeyCount, setPasskeyCount] = useState(null);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [actionNotice, setActionNotice] = useState(null);

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

  const handleAvatarPick = async (file, inputEl = null) => {
    if (inputEl) inputEl.value = '';
    if (avatarInputRef.current) avatarInputRef.current.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Выберите изображение (jpg/png/webp)', 'error');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      showToast('Файл слишком большой (макс. 15MB)', 'error');
      return;
    }
    setSaveSuccess(false);
    setAvatarSaving(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const optimized = await optimizeAvatar(String(reader.result || ''));
        setNewAvatar(optimized);
        const updated = await onUploadAvatar(optimized);
        setNewAvatar(updated?.photo_url || optimized || '');
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
    reader.onerror = () => {
      setAvatarSaving(false);
      showToast('Не удалось прочитать файл аватара', 'error');
    };
    reader.readAsDataURL(file);
  };

  const optimizeSupportScreenshot = (dataUrl) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxSide = 1600;
      const ratio = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * ratio));
      const h = Math.max(1, Math.round(img.height * ratio));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0b1020';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.78));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });

  const readSupportScreenshot = async (file) => {
    if (!file) return null;
    if (!file.type.startsWith('image/')) throw new Error('Выберите изображение (jpg/png/webp)');
    if (file.size > 15 * 1024 * 1024) throw new Error('Файл слишком большой (макс. 15MB)');
    const raw = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Не удалось прочитать скриншот'));
      reader.readAsDataURL(file);
    });
    const dataUrl = await optimizeSupportScreenshot(raw);
    const size = Math.round((dataUrl.length * 3) / 4);
    if (size > 2 * 1024 * 1024) throw new Error('После сжатия скриншот всё ещё больше 2MB');
    return {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: file.name || 'screenshot.jpg',
      type: 'image/jpeg',
      size,
      dataUrl,
    };
  };

  const handleSupportAttachmentPick = async (file, requestId = null, inputEl = null) => {
    if (inputEl) inputEl.value = '';
    if (!file) return;
    try {
      const attachment = await readSupportScreenshot(file);
      if (!attachment) return;
      const append = (prev) => {
        if (prev.length >= 3) {
          showToast('Можно прикрепить до 3 скриншотов', 'error');
          return prev;
        }
        return [...prev, attachment].slice(0, 3);
      };
      if (requestId) {
        setSupportDraftAttachments((prev) => ({ ...prev, [requestId]: append(prev[requestId] || []) }));
      } else {
        setSupportAttachments((prev) => append(prev));
      }
    } catch (e) {
      showToast(e.message || 'Не удалось прикрепить скриншот', 'error');
    }
  };

  const removeSupportAttachment = (attachmentId, requestId = null) => {
    if (requestId) {
      setSupportDraftAttachments((prev) => ({
        ...prev,
        [requestId]: (prev[requestId] || []).filter((item) => item.id !== attachmentId),
      }));
      return;
    }
    setSupportAttachments((prev) => prev.filter((item) => item.id !== attachmentId));
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

  const handleSupportSubmit = async () => {
    if (!supportFrom.trim() || !supportSubject.trim() || (!supportMessage.trim() && supportAttachments.length === 0)) {
      showToast('Заполните поля: кто, тема и сообщение или скриншот', 'error');
      return;
    }
    setSupportSending(true);
    try {
      const res = await postJsonWithCsrf('/api/support/requests', {
        from: supportFrom.trim(),
        email: user.email || supportFrom.trim(),
        subject: supportSubject.trim(),
        message: supportMessage.trim(),
        attachments: supportAttachments,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || 'Не удалось отправить обращение');
      if (data.request) setSupportRequests((prev) => [data.request, ...prev]);
      setSupportSubject('');
      setSupportMessage('');
      setSupportAttachments([]);
      setActionNotice({ title: 'Готово', message: 'Обращение успешно отправлено в поддержку. Мы ответим вам в ближайшее время.' });
    } catch (e) {
      showToast('Ошибка: ' + (e.message || 'не удалось отправить обращение'), 'error');
    } finally {
      setSupportSending(false);
    }
  };

  const handleSupportReply = async (requestId) => {
    const message = String(supportDrafts[requestId] || '').trim();
    const attachments = supportDraftAttachments[requestId] || [];
    if (!message && attachments.length === 0) {
      showToast('Введите сообщение или прикрепите скриншот', 'error');
      return;
    }
    setSupportSending(true);
    try {
      const res = await postJsonWithCsrf(`/api/support/requests/${encodeURIComponent(requestId)}/messages`, {
        message,
        attachments,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || 'Не удалось отправить сообщение');
      if (data.request) {
        setSupportRequests((prev) => prev.map((item) => (item.id === requestId ? data.request : item)));
      }
      setSupportDrafts((prev) => ({ ...prev, [requestId]: '' }));
      setSupportDraftAttachments((prev) => ({ ...prev, [requestId]: [] }));
      showToast('Сообщение отправлено в поддержку', 'success');
    } catch (e) {
      showToast('Ошибка: ' + (e.message || 'не удалось отправить сообщение'), 'error');
    } finally {
      setSupportSending(false);
    }
  };

  const handleRegisterPasskey = async () => {
    setPasskeySaving(true);
    try {
      const passkeys = await registerProfilePasskey();
      setPasskeyCount(passkeys.length);
      setActionNotice({ title: 'Успешно', message: 'Отпечаток/Passkey успешно добавлен и готов для входа.' });
    } catch (e) {
      showToast('Ошибка passkey: ' + translateServerError(e.message || 'не удалось добавить passkey'), 'error');
    } finally {
      setPasskeySaving(false);
    }
  };

  const formatDate = (dateString) => new Date(dateString).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  const formatDateTime = (dateString) => dateString
    ? new Date(dateString).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : '—';
  const supportStatusLabel = (status) => ({
    open: 'Открыто',
    answered: 'Ответили',
    closed: 'Закрыто',
  }[status] || status || 'Открыто');
  const supportMessagesForItem = (item) => {
    if (Array.isArray(item.messages) && item.messages.length) return item.messages;
    const messages = [];
    if (item.message) messages.push({ id: `${item.id}-user`, author: 'user', text: item.message, attachments: item.attachments || [], createdAt: item.createdAt });
    if (item.replyText) messages.push({ id: `${item.id}-admin`, author: 'admin', text: item.replyText, attachments: [], createdAt: item.repliedAt });
    return messages;
  };
  const renderSupportAttachments = (attachments = [], requestId = null, removable = false) => {
    if (!attachments.length) return null;
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        {attachments.map((att) => (
          <div key={att.id || att.dataUrl} style={{ position: 'relative', width: 118, borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', overflow: 'hidden', background: 'rgba(255,255,255,0.04)' }}>
            <a href={att.dataUrl} target="_blank" rel="noreferrer" title={att.name || 'Скриншот'}>
              <img src={att.dataUrl} alt={att.name || 'Скриншот'} style={{ display: 'block', width: '100%', height: 78, objectFit: 'cover' }} />
            </a>
            <div style={{ padding: '5px 7px', fontSize: 10, color: 'rgba(255,255,255,0.55)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{att.name || 'screenshot'}</div>
            {removable && (
              <button
                type="button"
                onClick={() => removeSupportAttachment(att.id, requestId)}
                style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(0,0,0,0.62)', color: '#fff', cursor: 'pointer', fontSize: 11 }}
                aria-label="Убрать скриншот"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    );
  };
  const purchaseStatusLabel = (status) => ({
    paid: 'Оплачено',
    created: 'Создан',
    active: 'Активен',
    expired: 'Истёк',
  }[status] || status || '—');

  const avatarLetter = (user.name || user.email || '?')[0].toUpperCase();
  const avatarColors = ['#ffd700,#ff8c00', '#3ecf8e,#0ea5e9', '#a78bfa,#ec4899', '#f87171,#fb923c'];
  const avatarColor = avatarColors[(user.name || user.email || '?').charCodeAt(0) % avatarColors.length];
  const avatarSrc = resolveApiAssetUrl(newAvatar);
  const avatarImgStyle = {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
    background: 'rgba(0,0,0,0.14)',
  };
  const showProfileSidebar = !isMobile;

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
        background: 'radial-gradient(ellipse at 42% 18%, rgba(106,56,255,0.28) 0%, rgba(0,0,0,0) 58%), radial-gradient(ellipse at 80% 90%, rgba(249,115,22,0.14) 0%, rgba(0,0,0,0) 55%), rgba(2,1,12,0.88)',
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
        @keyframes pmAvatarPulse { 0%,100%{box-shadow:0 0 0 2px rgba(25,216,255,0.55),0 0 18px rgba(25,216,255,0.35),0 0 34px rgba(139,92,246,0.28)} 50%{box-shadow:0 0 0 3px rgba(25,216,255,0.78),0 0 28px rgba(25,216,255,0.5),0 0 44px rgba(139,92,246,0.38)} }
        @keyframes pmStarFloat { from{background-position:0 0,0 0} to{background-position:52px 42px,-38px 58px} }
        .pm-modal-shell::before {
          content:''; position:absolute; inset:0; pointer-events:none; z-index:0;
          background:
            radial-gradient(circle, rgba(255,255,255,.16) 0 1px, transparent 1.4px),
            radial-gradient(circle, rgba(25,216,255,.13) 0 1px, transparent 1.5px),
            radial-gradient(circle at 50% 18%, rgba(111,70,255,.24), transparent 42%);
          background-size: 22px 22px, 58px 58px, auto;
          animation: pmStarFloat 18s linear infinite;
          opacity:.52;
        }
        .pm-modal-shell::after {
          content:''; position:absolute; inset:0; pointer-events:none; z-index:0;
          background: radial-gradient(circle at 50% 48%, transparent 0 50%, rgba(3,1,12,.42) 100%);
        }
        .pm-modal-shell > * { position:relative; z-index:1; }
        .pm-content-scroll { scrollbar-width: thin; scrollbar-color: rgba(139,92,246,.65) transparent; }
        .pm-content-scroll::-webkit-scrollbar { width: 6px; }
        .pm-content-scroll::-webkit-scrollbar-track { background: transparent; }
        .pm-content-scroll::-webkit-scrollbar-thumb { background: linear-gradient(#6f46ff,#ff7a35); border-radius: 999px; }
        .pm-sidebar-scroll { scrollbar-width: thin; scrollbar-color: rgba(139,92,246,.48) transparent; }
        .pm-sidebar-scroll::-webkit-scrollbar { width: 4px; }
        .pm-sidebar-scroll::-webkit-scrollbar-track { background: transparent; }
        .pm-sidebar-scroll::-webkit-scrollbar-thumb { background: rgba(139,92,246,.55); border-radius: 999px; }
        .pm-stat-card {
          position:relative; overflow:hidden;
          background: linear-gradient(145deg, rgba(25,216,255,.12), rgba(111,70,255,.16) 54%, rgba(6,2,32,.78)) !important;
          border: 1px solid rgba(121,88,255,.5) !important;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.12), 0 0 18px rgba(25,216,255,.16), 0 0 24px rgba(139,92,246,.16) !important;
        }
        .pm-stat-card::after {
          content:''; position:absolute; inset:auto -20% -55% -20%; height:70%;
          background: radial-gradient(ellipse, rgba(25,216,255,.42), transparent 64%);
          pointer-events:none;
        }
        .pm-panel-card {
          background: linear-gradient(145deg, rgba(255,255,255,.045), rgba(111,70,255,.055)) !important;
          border: 1px solid rgba(178,128,255,.22) !important;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 14px 36px rgba(4,1,20,.26);
        }
        .pm-action-card {
          min-height: 86px;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.1), 0 0 18px rgba(111,70,255,.1);
        }
        .pm-nav-btn { display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:12px; cursor:pointer; border:1px solid transparent; background:rgba(255,255,255,0.018); color:rgba(255,255,255,0.58); font-size:13px; font-family:system-ui,sans-serif; width:100%; text-align:left; transition:all .18s; position:relative; }
        .pm-nav-btn::before { content:''; position:absolute; inset:8px auto 8px 0; width:2px; border-radius:999px; background:transparent; transition:all .18s; }
        .pm-nav-btn:hover { background:linear-gradient(90deg,rgba(25,216,255,0.08),rgba(139,92,246,0.09)); border-color:rgba(178,128,255,0.24); color:rgba(255,255,255,0.92); box-shadow:inset 0 1px 0 rgba(255,255,255,.06); }
        .pm-nav-btn.pmactive { background:linear-gradient(135deg,rgba(25,216,255,0.18),rgba(139,92,246,0.22) 56%,rgba(255,122,53,0.12)); color:#fff; border-color:rgba(25,216,255,0.42); box-shadow:0 0 18px rgba(25,216,255,0.16), inset 0 1px 0 rgba(255,255,255,.11); }
        .pm-nav-btn.pmactive::before { background:linear-gradient(#19d8ff,#8b5cf6,#ff7a35); box-shadow:0 0 12px rgba(25,216,255,.7); }
        .pm-nav-btn.pmactive:hover { background:linear-gradient(135deg,rgba(25,216,255,0.24),rgba(139,92,246,0.28) 56%,rgba(255,122,53,0.16)); }
        .pm-action-card:hover { transform:translateY(-1px); filter:saturate(1.15) brightness(1.08); box-shadow:0 6px 18px rgba(111,70,255,0.22) !important; }
        .pm-info-row:hover { border-color:rgba(99,102,241,0.4) !important; }
        .pm-sec-row:hover { background:rgba(255,255,255,0.05) !important; border-color:rgba(255,255,255,0.15) !important; }
        .pm-tab-mobile { flex:0 0 auto; padding:7px 14px; border-radius:8px; font-size:12px; font-weight:700; cursor:pointer; font-family:Syne,system-ui; display:flex; align-items:center; gap:6px; transition:all .18s; }
        .pm-tab-mobile-active { background:linear-gradient(135deg,#f97316,#dc2626); color:#fff; border:1px solid transparent; box-shadow:0 3px 12px rgba(249,115,22,0.4); }
        .pm-tab-mobile-inactive { background:rgba(255,255,255,0.02); color:rgba(255,255,255,0.45); border:1px solid rgba(255,255,255,0.08); }
        .pm-tab-mobile-inactive:hover { background:rgba(255,255,255,0.06); color:rgba(255,255,255,0.8); }
      `}</style>

      <div
        className="pm-modal-shell"
        style={{
          width: isMobile ? '100%' : showProfileSidebar ? 'min(928px, 96vw)' : 'min(688px, 96vw)',
          height: isMobile ? '100%' : 'min(572px, 92vh)',
          background: 'linear-gradient(160deg,rgba(13,7,42,.98) 0%,rgba(12,4,43,.98) 48%,rgba(5,1,20,.99) 100%)',
          borderRadius: isMobile ? '20px 20px 0 0' : 20,
          border: '1px solid rgba(178,128,255,0.34)',
          display: 'flex',
          overflow: 'hidden',
          boxShadow: '0 0 0 1px rgba(25,216,255,0.14), 0 40px 110px rgba(0,0,0,0.92), 0 0 70px rgba(111,70,255,0.2), inset 0 1px 0 rgba(255,255,255,.08)',
          animation: isMobile ? 'pmSlideUp 0.3s cubic-bezier(0.34,1.1,0.64,1)' : 'pmSlideIn 0.28s cubic-bezier(0.34,1.2,0.64,1)',
          position: 'relative',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Neon corner accents */}
        {!isMobile && [
          { top:0, left:0, bT:'2px solid #19d8ff', bL:'2px solid #19d8ff', br:'18px 0 0 0' },
          { top:0, right:0, bT:'2px solid #8b5cf6', bR:'2px solid #8b5cf6', br:'0 18px 0 0' },
          { bottom:0, left:0, bB:'2px solid #8b5cf6', bL:'2px solid #8b5cf6', br:'0 0 0 18px' },
          { bottom:0, right:0, bB:'2px solid #ff7a35', bR:'2px solid #ff7a35', br:'0 0 18px 0' },
        ].map((c, i) => (
          <div key={i} style={{ position:'absolute', top:c.top, right:c.right, bottom:c.bottom, left:c.left, width:20, height:20, borderTop:c.bT, borderRight:c.bR, borderBottom:c.bB, borderLeft:c.bL, borderRadius:c.br, animation:'pmCornerGlow 2.5s ease-in-out infinite', animationDelay:`${i*0.35}s`, pointerEvents:'none', zIndex:10 }} />
        ))}
        {/* ── LEFT SIDEBAR ── */}
        {showProfileSidebar && !isMobile && (
          <div style={{ width: 236, height: '100%', minHeight: 0, overflow: 'hidden', background: 'linear-gradient(180deg,rgba(13,7,42,0.94),rgba(7,4,28,0.98) 48%,rgba(4,2,16,1))', borderRight: '1px solid rgba(178,128,255,0.28)', display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'relative', boxShadow: '12px 0 34px rgba(4,1,20,.32), inset -1px 0 0 rgba(25,216,255,.08)' }}>
            {/* subtle grid bg */}
            <div style={{ position:'absolute', inset:0, backgroundImage:'radial-gradient(circle at 50% 0%,rgba(25,216,255,.18),transparent 38%),linear-gradient(rgba(139,92,246,0.055) 1px,transparent 1px),linear-gradient(90deg,rgba(139,92,246,0.055) 1px,transparent 1px)', backgroundSize:'auto,24px 24px,24px 24px', pointerEvents:'none' }} />

            {/* Logo */}
            <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid rgba(178,128,255,0.2)', display: 'flex', alignItems: 'center', gap: 7, position: 'relative' }}>
              <span style={{ color: '#19d8ff', fontSize: 18, textShadow: '0 0 12px rgba(25,216,255,0.9), 0 0 24px rgba(139,92,246,0.45)' }}>◈</span>
              <span style={{ fontFamily: 'Syne,system-ui', fontWeight: 800, fontSize: 17, background: 'linear-gradient(90deg,#06b6d4,#818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Cicada</span>
              <span style={{ fontFamily: 'Syne,system-ui', fontSize: 13, color: 'rgba(255,255,255,0.3)', fontWeight: 400 }}>Studio</span>
            </div>

            {/* New project button */}
            <div style={{ padding: '12px 12px 8px', position: 'relative' }}>
              <button
                onClick={onClose}
                style={{ width: '100%', padding: '10px 14px', borderRadius: 12, border: '1px solid rgba(25,216,255,0.55)', background: 'linear-gradient(135deg,rgba(25,216,255,.9),rgba(139,92,246,.82) 58%,rgba(255,122,53,.72))', color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne,system-ui', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, boxShadow: '0 0 22px rgba(25,216,255,0.24), 0 8px 22px rgba(111,70,255,0.22)' }}
              >
                <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> {t.newProject}
              </button>
            </div>

            <div className="pm-sidebar-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', position: 'relative', paddingBottom: 6 }}>
            {/* Primary nav */}
            <nav style={{ padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 2, position: 'relative' }}>
              {[
                { key: 'profile', icon: '👤', label: t.profile },
                { key: 'projects', icon: '📁', label: t.projects, badge: projects.length || null },
                { key: 'subscription', icon: '💳', label: t.subscription },
                { key: 'purchases', icon: '🧾', label: t.purchases, badge: purchases.length || null },
                { key: 'settings', icon: '⚙️', label: t.settings },
              ].map(({ key, icon, label, badge }) => (
                <button key={key} className={`pm-nav-btn${activeTab === key ? ' pmactive' : ''}`} onClick={() => setActiveTab(key)}>
                  <span style={{ fontSize: 15 }}>{icon}</span>
                  <span style={{ flex: 1 }}>{label}</span>
                  {badge > 0 && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 999, background: 'rgba(25,216,255,0.14)', color: '#67e8f9', border: '1px solid rgba(25,216,255,0.34)', boxShadow: '0 0 10px rgba(25,216,255,.16)' }}>{badge}</span>}
                </button>
              ))}
            </nav>

            <div style={{ height: 1, background: 'linear-gradient(90deg,transparent,rgba(25,216,255,0.35),rgba(139,92,246,0.32),transparent)', margin: '8px 16px' }} />

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
              <div style={{ margin: '8px 10px', padding: '14px 12px', borderRadius: 14, background: 'linear-gradient(145deg,rgba(25,216,255,0.12),rgba(139,92,246,0.18) 55%,rgba(255,122,53,0.1))', border: '1px solid rgba(178,128,255,0.3)', position: 'relative', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08), 0 0 18px rgba(111,70,255,.14)' }}>
                <div style={{ fontSize: 20, marginBottom: 5, color: '#67e8f9', textShadow: '0 0 14px rgba(25,216,255,.55)' }}>⚡</div>
                <div style={{ fontFamily: 'Syne,system-ui', fontWeight: 800, fontSize: 12, color: '#e9d5ff', lineHeight: 1.35 }}>Разблокируй все<br />возможности</div>
                <button
                  onClick={() => setActiveTab('subscription')}
                  style={{ marginTop: 9, width: '100%', padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(25,216,255,0.3)', background: 'linear-gradient(135deg,rgba(25,216,255,0.18),rgba(139,92,246,0.32))', color: '#cffafe', fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: 'Syne,system-ui', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', boxShadow: '0 3px 12px rgba(25,216,255,0.16)' }}
                >{t.upgradePro}</button>
              </div>
            )}
            </div>

            {/* Bottom user info */}
            <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(178,128,255,0.2)', display: 'flex', alignItems: 'center', gap: 8, position: 'relative', background: 'rgba(255,255,255,0.018)', flexShrink: 0, minHeight: 55, boxSizing: 'border-box' }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, overflow: 'hidden', background: `linear-gradient(135deg,${avatarColor})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, lineHeight: 1, color: 'rgba(0,0,0,0.7)', fontFamily: 'Syne,system-ui', flexShrink: 0, boxShadow: '0 0 0 1.5px rgba(25,216,255,0.55), 0 0 14px rgba(25,216,255,.2)' }}>
                {newAvatar ? <img src={avatarSrc} alt="" style={avatarImgStyle} /> : avatarLetter}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', fontFamily: 'Syne,system-ui', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--mono)' }}>{user.email}</div>
              </div>
              <button
                onClick={() => setLogoutConfirmOpen(true)}
                title={t.logoutAccount.replace(/^↩\s*/, '')}
                style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.2)', color: 'rgba(248,113,113,0.6)', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(248,113,113,0.18)'; e.currentTarget.style.borderColor = '#f87171'; e.currentTarget.style.color = '#f87171'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(248,113,113,0.06)'; e.currentTarget.style.borderColor = 'rgba(248,113,113,0.2)'; e.currentTarget.style.color = 'rgba(248,113,113,0.6)'; }}
              >↩</button>
            </div>
          </div>
        )}

        {/* ── MAIN CONTENT ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

          {/* Top header */}
          <div style={{ padding: isMobile ? '14px 16px' : '18px 20px 17px', borderBottom: '1px solid rgba(178,128,255,0.25)', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0, background: 'linear-gradient(90deg,rgba(13,7,42,0.72),rgba(22,9,72,0.48),rgba(8,4,30,0.76))', position: 'relative', backdropFilter: 'blur(14px)' }}>
            {/* Neon line accent bottom */}
            <div style={{ position:'absolute', bottom:0, left:0, right:0, height:1, background:'linear-gradient(90deg,transparent,rgba(25,216,255,0.45),rgba(139,92,246,0.5),rgba(255,122,53,0.38),transparent)', pointerEvents:'none' }} />
            <div style={{ position: 'relative', width: isMobile ? 50 : 58, height: isMobile ? 50 : 58, flexShrink: 0 }}>
              <div style={{ width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden', background: `linear-gradient(135deg,${avatarColor})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: isMobile ? 20 : 24, fontWeight: 800, lineHeight: 1, color: 'rgba(0,0,0,0.7)', fontFamily: 'Syne,system-ui', animation: 'pmAvatarPulse 3s ease-in-out infinite', border: '2px solid rgba(255,255,255,.12)' }}>
                {newAvatar ? <img src={avatarSrc} alt="" style={avatarImgStyle} /> : avatarLetter}
              </div>
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'Syne,system-ui', fontWeight: 800, fontSize: isMobile ? 20 : 24, color: '#fff', lineHeight: 1.1, textShadow: '0 0 20px rgba(255,255,255,0.18)' }}>{user.name}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4, fontFamily: 'var(--mono)', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: isMobile ? 160 : 280 }}>{user.email}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 9px', borderRadius: 20, background: 'rgba(6,182,212,0.12)', border: '1px solid rgba(6,182,212,0.35)', fontSize: 9, fontWeight: 700, color: '#06b6d4', letterSpacing: '0.08em', flexShrink: 0, boxShadow: '0 0 8px rgba(6,182,212,0.2)' }}>● ONLINE</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
              {!isMobile && (
                <button
                  onClick={() => setActiveTab('settings')}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 10, border: '1px solid rgba(178,128,255,0.45)', background: 'rgba(255,255,255,0.035)', color: 'rgba(255,255,255,0.86)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne,system-ui', transition: 'all .15s', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08)' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(139,92,246,0.18)'; e.currentTarget.style.borderColor = 'rgba(178,128,255,0.7)'; e.currentTarget.style.color = '#fff'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.035)'; e.currentTarget.style.borderColor = 'rgba(178,128,255,0.45)'; e.currentTarget.style.color = 'rgba(255,255,255,0.86)'; }}
                >{t.editProfile}</button>
              )}
              <button
                onClick={onClose}
                style={{ width: 34, height: 34, borderRadius: 9, border: '1px solid rgba(178,128,255,0.3)', background: 'rgba(255,255,255,0.035)', color: 'rgba(255,255,255,0.5)', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(249,115,22,0.15)'; e.currentTarget.style.borderColor = '#f97316'; e.currentTarget.style.color = '#f97316'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.035)'; e.currentTarget.style.borderColor = 'rgba(178,128,255,0.3)'; e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; }}
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
                { key: 'purchases', icon: '🧾', label: t.purchases },
                { key: 'support', icon: '🛟', label: t.support },
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
          <div className="pm-content-scroll" style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '14px 12px' : '14px 22px 18px' }}>

            {/* ── PROFILE TAB ── */}
            {activeTab === 'profile' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Stats row */}
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3,1fr)', gap: 14 }}>
                  {[
                    { label: t.projectsCount, value: projects.length, color: '#d8b4fe', action: () => setActiveTab('projects') },
                    { label: t.planLabel, value: user.plan === 'pro' ? 'PRO' : 'FREE', color: user.plan === 'pro' ? '#3ecf8e' : '#e5e7eb', isPlan: true, action: () => setActiveTab('subscription') },
                    { label: t.supportLabel, value: '24/7', color: '#d8b4fe', action: () => setActiveTab('support') },
                  ].map(({ label, value, color, isPlan, action }) => (
                    <div key={label} className="pm-stat-card" onClick={action} style={{ padding: '13px 14px', borderRadius: 9, cursor: 'pointer' }}>
                      {isPlan ? (
                        <div style={{ marginBottom: 7 }}>
                          <span style={{ fontSize: 13, fontWeight: 900, padding: '3px 12px', borderRadius: 999, background: user.plan === 'pro' ? 'rgba(62,207,142,0.18)' : 'rgba(255,255,255,0.08)', color, border: `1px solid ${user.plan === 'pro' ? 'rgba(62,207,142,0.42)' : 'rgba(255,255,255,0.16)'}`, boxShadow: user.plan === 'pro' ? '0 0 14px rgba(62,207,142,.28)' : 'none' }}>{value}</span>
                        </div>
                      ) : (
                        <div style={{ fontFamily: 'Syne,system-ui', fontWeight: 900, fontSize: 28, color, lineHeight: 1, marginBottom: 7, textShadow: '0 0 18px rgba(216,180,254,.35)' }}>{value}</div>
                      )}
                      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.62)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800, fontFamily: 'Syne,system-ui' }}>{label}</div>
                    </div>
                  ))}
                </div>

                {/* Two-column layout */}
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.07fr .93fr', gap: 16, alignItems: 'start' }}>
                  {/* Left column */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {/* Quick actions */}
                    <section>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: 'Syne,system-ui', marginBottom: 10 }}>{t.quickActions}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        {[
                          { icon: '✦', label: t.newProject, sub: t.newProjectSub, color: '#fff', glow: 'rgba(249,115,22,0.38)', bg: 'linear-gradient(135deg, rgba(255,122,53,.9), rgba(220,38,38,.44))', border: 'rgba(255,122,53,.78)', action: onClose },
                          { icon: '▰', label: t.docs, sub: t.docsSub, color: '#dbeafe', glow: 'rgba(96,165,250,0.26)', bg: 'linear-gradient(135deg, rgba(25,216,255,.18), rgba(111,70,255,.32))', border: 'rgba(96,165,250,.42)', action: onOpenInstructions },
                          { icon: '◉', label: t.support, sub: t.supportSub, color: '#f0abfc', glow: 'rgba(217,70,239,0.26)', bg: 'linear-gradient(135deg, rgba(217,70,239,.2), rgba(111,70,255,.28))', border: 'rgba(217,70,239,.38)', action: () => setActiveTab('support') },
                        ].map(({ icon, label, sub, color, glow, bg, border, action }) => (
                          <button
                            key={label}
                            className="pm-action-card"
                            onClick={action}
                            style={{ textAlign: 'left', cursor: 'pointer', borderRadius: 9, padding: '13px 12px', background: bg, border: `1px solid ${border}`, transition: 'all .2s' }}
                          >
                            <div style={{ fontSize: 22, color, marginBottom: 8, textShadow: `0 0 14px ${glow}` }}>{icon}</div>
                            <div style={{ fontSize: 13, fontWeight: 800, color, fontFamily: 'Syne,system-ui', marginBottom: 5, lineHeight: 1.2, textShadow: `0 0 10px ${glow}` }}>{label}</div>
                            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', lineHeight: 1.4 }}>{sub}</div>
                          </button>
                        ))}
                      </div>
                    </section>

                    {/* Personal info */}
                    <section>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: 'Syne,system-ui', marginBottom: 10 }}>{t.personalInfo}</div>
                      <div className="pm-panel-card" style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: 0, borderRadius: 10, overflow: 'hidden' }}>
                        {[
                          { icon: '👤', label: t.name, value: user.name, editable: true },
                          { icon: '✉️', label: 'Email', value: user.email, editable: true },
                          { icon: '📅', label: t.registrationDate, value: user.createdAt ? formatDate(user.createdAt) : '—', editable: false },
                          { icon: '🕐', label: t.lastLogin, value: t.today, editable: false },
                          { icon: '🌐', label: t.language, value: ({ ru:'Русский', en:'English', uk:'Українська' }[user.uiLanguage || 'ru'] || 'Русский'), editable: true },
                        ].map(({ icon, label, value, editable }) => (
                          <div
                            key={label}
                            className="pm-info-row"
                            style={{ display: 'flex', alignItems: 'center', padding: '10px 13px', borderRadius: 0, background: 'rgba(255,255,255,0.01)', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.065)', cursor: editable ? 'pointer' : 'default', transition: 'border-color .2s' }}
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
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: 'Syne,system-ui', marginBottom: 10 }}>{t.avatar}</div>
                      <div className="pm-panel-card" style={{ padding: '14px', borderRadius: 10 }}>
                        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 14 }}>
                          <div style={{ width: 88, height: 88, borderRadius: '50%', overflow: 'hidden', background: `linear-gradient(135deg,${avatarColor})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, fontWeight: 800, lineHeight: 1, color: 'rgba(0,0,0,0.7)', fontFamily: 'Syne,system-ui', flexShrink: 0, border: '3px solid rgba(25,216,255,.75)', boxShadow: '0 0 24px rgba(25,216,255,.38), 0 0 34px rgba(139,92,246,.3)' }}>
                            {newAvatar ? <img src={avatarSrc} alt="" style={avatarImgStyle} /> : avatarLetter}
                          </div>
                          <div style={{ paddingTop: 18 }}>
                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.74)', marginBottom: 4 }}>JPG/PNG/WebP</div>
                            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.42)' }}>{t.maxFile}</div>
                          </div>
                        </div>
                        <label
                          style={{ width: '100%', padding: '9px 14px', borderRadius: 8, border: '1px solid rgba(25,216,255,0.58)', background: 'linear-gradient(135deg, rgba(25,216,255,.22), rgba(111,70,255,.4))', color: '#fff', fontSize: 12, fontWeight: 800, cursor: avatarSaving ? 'not-allowed' : 'pointer', fontFamily: 'Syne,system-ui', marginBottom: newAvatar ? 8 : 0, transition: 'all .15s', opacity: avatarSaving ? 0.6 : 1, boxShadow: '0 0 18px rgba(25,216,255,.18)', display: 'block', textAlign: 'center', position: 'relative', overflow: 'hidden', boxSizing: 'border-box' }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'linear-gradient(135deg, rgba(25,216,255,.32), rgba(111,70,255,.52))'; e.currentTarget.style.borderColor = 'rgba(25,216,255,0.84)'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'linear-gradient(135deg, rgba(25,216,255,.22), rgba(111,70,255,.4))'; e.currentTarget.style.borderColor = 'rgba(25,216,255,0.58)'; }}
                        >
                          {avatarSaving ? t.saving : t.uploadPhoto}
                          <input
                            ref={avatarInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            disabled={avatarSaving}
                            onChange={(e) => handleAvatarPick(e.target.files?.[0], e.currentTarget)}
                            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: avatarSaving ? 'not-allowed' : 'pointer' }}
                          />
                        </label>
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
                            style={{ width: '100%', padding: '9px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.035)', color: 'rgba(255,255,255,0.64)', fontSize: 12, cursor: 'pointer', fontFamily: 'Syne,system-ui', transition: 'all .15s', opacity: avatarSaving ? 0.6 : 1 }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                          >{t.remove}</button>
                        )}
                      </div>
                    </section>

                    {/* Security */}
                    <section>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: 'Syne,system-ui', marginBottom: 10 }}>{t.security}</div>
                      <div className="pm-panel-card" style={{ display: 'flex', flexDirection: 'column', gap: 0, borderRadius: 10, overflow: 'hidden' }}>
                        {[
                          { icon: '🔒', title: t.changePassword, sub: t.passwordChangedAgo },
                          { icon: '🫆', title: 'Passkey / отпечаток', sub: passkeyCount == null ? 'Быстрый вход без пароля' : `Активно: ${passkeyCount}`, subGreen: passkeyCount > 0 ? 'Включено' : null },
                        ].map(({ icon, title, sub, subGreen }) => (
                          <div
                            key={title}
                            className="pm-sec-row"
                            onClick={() => setActiveTab('settings')}
                            style={{ display: 'flex', alignItems: 'center', padding: '13px 14px', borderRadius: 0, background: 'rgba(255,255,255,0.01)', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.065)', cursor: 'pointer', transition: 'all .15s' }}
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
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.4)', fontFamily: 'Syne, system-ui' }}>{t.noProjects}</div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', marginTop: 8, lineHeight: 1.6 }}>{t.saveProjectHint}</div>
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
                          <button onClick={() => { onDeleteProject(project.id); setConfirmDelete(null); }} style={{ padding: '7px 12px', fontSize: 11, fontWeight: 700, background: '#f87171', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>{t.remove}</button>
                          <button onClick={() => setConfirmDelete(null)} style={{ padding: '7px 12px', fontSize: 11, background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, cursor: 'pointer' }}>{t.cancel}</button>
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

            {/* ── PURCHASES TAB ── */}
            {activeTab === 'purchases' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 860 }}>
                <div style={{ background: 'rgba(255,215,0,0.045)', border: '1px solid rgba(255,215,0,0.18)', borderRadius: 14, padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: '#fef3c7', fontFamily: 'Syne, system-ui', marginBottom: 6 }}>Покупки и чеки</div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6 }}>
                      Здесь хранятся оплаченные счета CryptoPay по подпискам.
                    </div>
                  </div>
                  <button onClick={loadPurchases} disabled={purchasesLoading} style={{ padding: '9px 13px', borderRadius: 10, border: '1px solid rgba(255,215,0,0.25)', background: 'rgba(255,255,255,0.035)', color: '#ffd700', fontSize: 12, fontWeight: 700, fontFamily: 'Syne, system-ui', cursor: purchasesLoading ? 'not-allowed' : 'pointer', flexShrink: 0 }}>
                    {purchasesLoading ? 'Обновляем...' : 'Обновить'}
                  </button>
                </div>

                {purchasesLoading && purchases.length === 0 ? (
                  <div style={{ padding: 28, textAlign: 'center', color: 'rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.025)', border: '1px dashed rgba(255,255,255,0.12)', borderRadius: 16 }}>Загружаем покупки...</div>
                ) : purchases.length === 0 ? (
                  <div style={{ padding: 36, textAlign: 'center', color: 'rgba(255,255,255,0.38)', background: 'rgba(255,255,255,0.025)', border: '1px dashed rgba(255,255,255,0.12)', borderRadius: 16 }}>
                    <div style={{ fontSize: 34, marginBottom: 10 }}>🧾</div>
                    Чеков пока нет. После оплаты подписки они появятся здесь.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {purchases.map((item) => {
                      const paidAt = item.paidAt || item.processedAt || item.createdAt;
                      return (
                        <div key={item.invoiceId} style={{ padding: 16, borderRadius: 14, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.09)', display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.3fr 0.9fr 0.8fr', gap: 12, alignItems: 'center' }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 14, fontWeight: 800, color: '#fff', fontFamily: 'Syne, system-ui' }}>{item.planLabel || 'Подписка'}</span>
                              <span style={{ padding: '2px 8px', borderRadius: 999, background: 'rgba(62,207,142,0.12)', border: '1px solid rgba(62,207,142,0.26)', color: '#86efac', fontSize: 10, fontWeight: 800, letterSpacing: '0.06em' }}>{purchaseStatusLabel(item.status)}</span>
                            </div>
                            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.34)', marginTop: 6, fontFamily: 'var(--mono)' }}>Чек #{item.invoiceId}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Сумма</div>
                            <div style={{ fontSize: 14, color: '#ffd700', fontWeight: 800, fontFamily: 'Syne, system-ui' }}>{item.amount || '—'} {item.asset || ''}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Дата</div>
                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', fontFamily: 'var(--mono)' }}>{formatDateTime(paidAt)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── SETTINGS TAB ── */}
            {activeTab === 'settings' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Bot Test Token */}
                <div style={{ background: 'rgba(62,207,142,0.04)', border: '1px solid rgba(62,207,142,0.18)', borderRadius: 14, padding: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(62,207,142,0.8)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'Syne, system-ui', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 1, background: 'rgba(62,207,142,0.15)' }} />
                    {t.botTestToken}
                    <div style={{ flex: 1, height: 1, background: 'rgba(62,207,142,0.15)' }} />
                  </div>
                  <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)', margin: '0 0 12px', lineHeight: 1.5 }}>{t.botTestTokenHint}</p>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="text" value={testToken} onChange={e => setTestToken(e.target.value)} onFocus={() => setFocusedField('ttoken')} onBlur={() => setFocusedField(null)} style={{ ...inputBase('ttoken'), flex: 1, fontFamily: 'var(--mono,monospace)', fontSize: 12, letterSpacing: '0.02em' }} placeholder="1234567890:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
                    {testToken && testToken !== (user.test_token || '') && (
                      <button onClick={async () => { setTestTokenSaving(true); try { await onUpdateUser({ test_token: testToken.trim() || null, _silent: true }); showToast(t.tokenSaved, 'success'); } catch(e) { showToast('Ошибка: ' + e.message, 'error'); } finally { setTestTokenSaving(false); } }} disabled={testTokenSaving} style={{ padding: '9px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, fontFamily: 'Syne, system-ui', background: 'linear-gradient(135deg,#3ecf8e,#0ea5e9)', color: '#0a0a0a', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, opacity: testTokenSaving ? 0.6 : 1 }}>{testTokenSaving ? '...' : '💾 ' + t.confirm}</button>
                    )}
                    {testToken && testToken === (user.test_token || '') && (
                      <button onClick={async () => { setTestTokenSaving(true); try { await onUpdateUser({ test_token: null, _silent: true }); setTestToken(''); showToast(t.tokenRemoved, 'success'); } catch(e) { showToast('Ошибка: ' + e.message, 'error'); } finally { setTestTokenSaving(false); } }} disabled={testTokenSaving} style={{ padding: '9px 12px', borderRadius: 10, fontSize: 12, background: 'rgba(248,113,113,0.08)', color: '#f87171', border: '1px solid rgba(248,113,113,0.2)', cursor: 'pointer', flexShrink: 0, opacity: testTokenSaving ? 0.6 : 1 }}>{t.removeToken}</button>
                    )}
                  </div>
                  {user.test_token && <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(62,207,142,0.6)', fontFamily: 'var(--mono)' }}>✓ Сохранён: {user.test_token.slice(0, 10)}...{user.test_token.slice(-6)}</div>}
                </div>

                {/* Profile data */}
                <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, padding: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,215,0,0.7)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'Syne, system-ui', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 1, background: 'rgba(255,215,0,0.15)' }} />
                    {t.profileData}
                    <div style={{ flex: 1, height: 1, background: 'rgba(255,215,0,0.15)' }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, fontFamily: 'Syne, system-ui' }}>{t.name}</label>
                      <input type="text" value={newName} onChange={e => setNewName(e.target.value)} onFocus={() => setFocusedField('sname')} onBlur={() => setFocusedField(null)} style={inputBase('sname')} placeholder={t.yourName} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, fontFamily: 'Syne, system-ui' }}>Email</label>
                      {emailChangeStep === 'idle' || emailChangeStep === 'sending' ? (
                        <input type="email" value={newEmail} onChange={e => { setNewEmail(e.target.value); setEmailChangeError(''); }} onFocus={() => setFocusedField('semail')} onBlur={() => setFocusedField(null)} disabled={emailChangeStep === 'sending'} style={{ ...inputBase('semail'), opacity: emailChangeStep === 'sending' ? 0.6 : 1 }} placeholder="email@example.com" />
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(62,207,142,0.07)', border: '1px solid rgba(62,207,142,0.2)', fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.6 }}>
                            <span style={{ color: '#3ecf8e', fontWeight: 600 }}>{t.codeSent}</span> {t.sentTo} <span style={{ color: 'var(--text)', fontFamily: 'var(--mono)' }}>{user.email}</span><br />
                            {t.enterCodeFor} <span style={{ color: '#ffd700', fontFamily: 'var(--mono)' }}>{emailChangePending}</span>
                          </div>
                          <input type="text" value={emailChangeCode} onChange={e => { setEmailChangeCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setEmailChangeError(''); }} onFocus={() => setFocusedField('ecode')} onBlur={() => setFocusedField(null)} style={{ ...inputBase('ecode'), textAlign: 'center', fontSize: 22, letterSpacing: '0.35em', fontWeight: 700, border: `1.5px solid ${emailChangeError ? '#f87171' : focusedField === 'ecode' ? '#3ecf8e' : 'rgba(255,255,255,0.12)'}` }} placeholder="000000" maxLength={6} autoFocus />
                          {emailChangeError && <div style={{ fontSize: 11, color: '#f87171', textAlign: 'center' }}>⚠ {emailChangeError}</div>}
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={handleConfirmEmailCode} disabled={emailChangeStep === 'confirming' || emailChangeCode.length < 4} style={{ flex: 1, padding: '11px 0', fontSize: 13, fontWeight: 700, fontFamily: 'Syne, system-ui', background: emailChangeCode.length >= 4 ? 'linear-gradient(135deg,#3ecf8e,#0ea5e9)' : 'rgba(255,255,255,0.06)', color: emailChangeCode.length >= 4 ? '#111' : 'rgba(255,255,255,0.3)', border: 'none', borderRadius: 12, cursor: emailChangeCode.length >= 4 ? 'pointer' : 'not-allowed' }}>{emailChangeStep === 'confirming' ? t.checking : `✓ ${t.confirm}`}</button>
                            <button onClick={handleCancelEmailChange} style={{ padding: '11px 16px', fontSize: 12, fontWeight: 600, fontFamily: 'Syne, system-ui', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, cursor: 'pointer' }}>{t.cancel}</button>
                          </div>
                        </div>
                      )}
                      {emailChangeError && emailChangeStep === 'idle' && <div style={{ fontSize: 11, color: '#f87171', marginTop: 6 }}>⚠ {emailChangeError}</div>}
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, fontFamily: 'Syne, system-ui' }}>{t.interfaceLanguage}</label>
                      <select value={user.uiLanguage || 'ru'} onChange={async (e) => {
                        const uiLanguage = e.target.value;
                        try {
                          await onUpdateUser({ ui_language: uiLanguage, _silent: true });
                          showToast(builderUiForToast?.langUpdatedToast || getConstructorStrings(uiLang).langUpdatedToast, 'success');
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
                        {saveSuccess ? t.saved : emailChangeStep === 'sending' ? t.sendingCode : t.saveChanges}
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
                    <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.24)' }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#ddd6fe', fontFamily: 'Syne, system-ui', marginBottom: 6 }}>🫆 Авторизация по passkey</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.55, marginBottom: 10 }}>
                        Добавьте отпечаток, Face ID или PIN устройства для быстрого входа без пароля. {passkeyCount == null ? '' : `Активно: ${passkeyCount}`}
                      </div>
                      <button onClick={handleRegisterPasskey} disabled={passkeySaving} style={{ padding: '10px 14px', fontSize: 12, fontWeight: 800, fontFamily: 'Syne, system-ui', background: 'linear-gradient(135deg,#7c3aed,#2563eb)', color: '#fff', border: 'none', borderRadius: 10, cursor: passkeySaving ? 'not-allowed' : 'pointer', opacity: passkeySaving ? 0.65 : 1 }}>
                        {passkeySaving ? '⏳ Ожидаем устройство...' : 'Добавить passkey'}
                      </button>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, fontFamily: 'Syne, system-ui' }}>Текущий пароль</label>
                      <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} onFocus={() => setFocusedField('curPass')} onBlur={() => setFocusedField(null)} style={inputBase('curPass')} placeholder="••••••••" autoComplete="current-password" />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, fontFamily: 'Syne, system-ui' }}>{uiLang === 'en' ? 'New password' : uiLang === 'uk' ? 'Новий пароль' : 'Новый пароль'}</label>
                      <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} onFocus={() => setFocusedField('newPass')} onBlur={() => setFocusedField(null)} style={inputBase('newPass')} placeholder={uiLang === 'en' ? 'Minimum 6 characters' : uiLang === 'uk' ? 'Мінімум 6 символів' : 'Минимум 6 символов'} autoComplete="new-password" />
                    </div>
                    <button onClick={handleChangePassword} style={{ padding: '12px 20px', fontSize: 13, fontWeight: 700, fontFamily: 'Syne, system-ui', background: 'rgba(96,165,250,0.12)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.3)', borderRadius: 12, cursor: 'pointer', transition: 'all 0.2s' }} onMouseEnter={e => { e.currentTarget.style.background = 'rgba(96,165,250,0.2)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'rgba(96,165,250,0.12)'; }}>🔐 {t.changePassword}</button>
                  </div>
                </div>
                {/* Danger zone */}
                <div style={{ background: 'rgba(248,113,113,0.02)', border: '1px solid rgba(248,113,113,0.16)', borderRadius: 14, padding: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(248,113,113,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'Syne, system-ui', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 1, background: 'rgba(248,113,113,0.15)' }} />
                    {t.dangerZone}
                    <div style={{ flex: 1, height: 1, background: 'rgba(248,113,113,0.15)' }} />
                  </div>
                  <button onClick={() => setLogoutConfirmOpen(true)} style={{ width: '100%', padding: '9px 16px', fontSize: 12, fontWeight: 700, fontFamily: 'Syne, system-ui', background: 'rgba(248,113,113,0.06)', color: '#f87171', border: '1px solid rgba(248,113,113,0.18)', borderRadius: 10, cursor: 'pointer', transition: 'all 0.2s' }} onMouseEnter={e => { e.currentTarget.style.background = 'rgba(248,113,113,0.15)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'rgba(248,113,113,0.06)'; }}>{t.logoutAccount}</button>
                </div>
              </div>
            )}

            {/* ── SUPPORT TAB ── */}
            {activeTab === 'support' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 860 }}>
                <div style={{ background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 14, padding: 16 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#e5e7eb', fontFamily: 'Syne, system-ui', marginBottom: 6 }}>Обращения в поддержку</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6 }}>
                    Ниже история ваших обращений и ответы поддержки. В существующем тикете можно продолжить беседу и прикрепить скриншот.
                  </div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', fontFamily: 'Syne, system-ui' }}>История чата</div>
                    <button onClick={loadSupportRequests} disabled={supportRequestsLoading} style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(16,185,129,0.22)', background: 'rgba(16,185,129,0.05)', color: '#86efac', fontSize: 12, fontWeight: 700, fontFamily: 'Syne, system-ui', cursor: supportRequestsLoading ? 'not-allowed' : 'pointer' }}>
                      {supportRequestsLoading ? 'Обновляем...' : 'Обновить'}
                    </button>
                  </div>

                  {supportRequestsLoading && supportRequests.length === 0 ? (
                    <div style={{ padding: 24, textAlign: 'center', color: 'rgba(255,255,255,0.35)', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 14 }}>Загружаем обращения...</div>
                  ) : supportRequests.length === 0 ? (
                    <div style={{ padding: 30, textAlign: 'center', color: 'rgba(255,255,255,0.38)', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 14 }}>
                      <div style={{ fontSize: 34, marginBottom: 10 }}>🛟</div>
                      Вы ещё не писали в поддержку.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: 420, overflowY: 'auto', paddingRight: 4 }}>
                      {supportRequests.map((item) => {
                        const draftAttachments = supportDraftAttachments[item.id] || [];
                        const itemMessages = supportMessagesForItem(item);
                        const lastMessage = itemMessages[itemMessages.length - 1];
                        return (
                          <div key={item.id} style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 12, fontWeight: 800, color: '#e5e7eb', fontFamily: 'Syne, system-ui' }}>{item.subject}</span>
                              <span style={{ padding: '2px 8px', borderRadius: 999, background: item.status === 'answered' ? 'rgba(62,207,142,0.12)' : 'rgba(255,255,255,0.06)', border: `1px solid ${item.status === 'answered' ? 'rgba(62,207,142,0.26)' : 'rgba(255,255,255,0.11)'}`, color: item.status === 'answered' ? '#86efac' : 'rgba(255,255,255,0.55)', fontSize: 10, fontWeight: 800 }}>{supportStatusLabel(item.status)}</span>
                              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)', fontFamily: 'var(--mono)' }}>{formatDateTime(item.createdAt)}</span>
                            </div>
                            {itemMessages.map((msg) => {
                              const isAdminMessage = msg.author === 'admin';
                              return (
                                <div key={msg.id || `${msg.author}-${msg.createdAt}`} style={{ alignSelf: isAdminMessage ? 'flex-start' : 'flex-end', maxWidth: '86%', padding: '11px 13px', borderRadius: isAdminMessage ? '14px 14px 14px 4px' : '14px 14px 4px 14px', background: isAdminMessage ? 'linear-gradient(135deg,rgba(62,207,142,0.16),rgba(14,165,233,0.10))' : 'linear-gradient(135deg,rgba(14,165,233,0.18),rgba(99,102,241,0.16))', border: `1px solid ${isAdminMessage ? 'rgba(62,207,142,0.22)' : 'rgba(14,165,233,0.24)'}`, color: 'rgba(255,255,255,0.86)', fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                                  <div style={{ fontSize: 10, color: isAdminMessage ? '#86efac' : '#93c5fd', fontWeight: 800, marginBottom: 6, fontFamily: 'Syne, system-ui' }}>{isAdminMessage ? 'Поддержка' : 'Вы'} · {formatDateTime(msg.createdAt)}</div>
                                  {msg.text}
                                  {renderSupportAttachments(msg.attachments || [])}
                                </div>
                              );
                            })}
                            {item.status !== 'closed' && lastMessage?.author !== 'admin' && (
                              <div style={{ alignSelf: 'flex-start', fontSize: 11, color: 'rgba(255,255,255,0.32)', paddingLeft: 4 }}>Ожидает ответа поддержки</div>
                            )}
                            <div style={{ padding: 10, borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.025)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                              <textarea
                                value={supportDrafts[item.id] || ''}
                                onChange={e => setSupportDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                style={{ ...inputBase(`supportReply-${item.id}`), minHeight: 74, resize: 'vertical' }}
                                placeholder="Продолжить беседу..."
                              />
                              {renderSupportAttachments(draftAttachments, item.id, true)}
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                <label style={{ padding: '9px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.72)', fontSize: 12, fontWeight: 700, fontFamily: 'Syne, system-ui', cursor: 'pointer' }}>
                                  📎 Скриншот
                                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => handleSupportAttachmentPick(e.target.files?.[0], item.id, e.currentTarget)} style={{ display: 'none' }} />
                                </label>
                                <button type="button" onClick={() => handleSupportReply(item.id)} disabled={supportSending} style={{ padding: '9px 12px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#3ecf8e,#0ea5e9)', color: '#111', fontSize: 12, fontWeight: 800, fontFamily: 'Syne, system-ui', cursor: supportSending ? 'not-allowed' : 'pointer', opacity: supportSending ? 0.65 : 1 }}>Отправить</button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', fontFamily: 'Syne, system-ui' }}>Новое обращение</div>
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
                  {renderSupportAttachments(supportAttachments, null, true)}
                  <label style={{ alignSelf: 'flex-start', padding: '9px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.72)', fontSize: 12, fontWeight: 700, fontFamily: 'Syne, system-ui', cursor: 'pointer' }}>
                    📎 Прикрепить скриншот
                    <input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => handleSupportAttachmentPick(e.target.files?.[0], null, e.currentTarget)} style={{ display: 'none' }} />
                  </label>
                  <button
                    onClick={handleSupportSubmit}
                    disabled={supportSending}
                    style={{ alignSelf: 'flex-start', padding: '12px 16px', fontSize: 13, fontWeight: 700, fontFamily: 'Syne, system-ui', background: 'linear-gradient(135deg,#3ecf8e,#0ea5e9)', color: '#111', border: 'none', borderRadius: 12, cursor: supportSending ? 'not-allowed' : 'pointer', opacity: supportSending ? 0.65 : 1 }}
                  >
                    {supportSending ? '⏳ Отправляем...' : 'Отправить в поддержку'}
                  </button>
                </div>
              </div>
            )}
            {actionNotice && (
              <div style={{ position: 'fixed', inset: 0, zIndex: 10650, background: 'rgba(2,1,12,0.65)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                <div style={{ width: 'min(460px,92vw)', borderRadius: 16, border: '1px solid rgba(62,207,142,0.35)', background: 'linear-gradient(160deg, rgba(16,32,28,0.95), rgba(8,20,38,0.95))', boxShadow: '0 30px 100px rgba(0,0,0,0.6)' }}>
                  <div style={{ padding: '18px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)', fontFamily: 'Syne,system-ui', fontWeight: 700, color: '#3ecf8e' }}>✅ {actionNotice.title}</div>
                  <div style={{ padding: 20, color: 'rgba(255,255,255,0.85)', fontSize: 14, lineHeight: 1.5 }}>{actionNotice.message}</div>
                  <div style={{ padding: '0 20px 20px', display: 'flex', justifyContent: 'flex-end' }}>
                    <button onClick={() => setActionNotice(null)} style={{ padding: '10px 16px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#3ecf8e,#0ea5e9)', color: '#111', fontWeight: 700, cursor: 'pointer' }}>OK</button>
                  </div>
                </div>
              </div>
            )}
            {logoutConfirmOpen && (
              <div style={{ position: 'fixed', inset: 0, zIndex: 10640, background: 'rgba(2,1,12,0.65)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                <div style={{ width: 'min(460px,92vw)', borderRadius: 16, border: '1px solid rgba(248,113,113,0.35)', background: 'linear-gradient(160deg, rgba(32,12,18,0.95), rgba(18,10,28,0.95))', boxShadow: '0 30px 100px rgba(0,0,0,0.6)' }}>
                  <div style={{ padding: '18px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)', fontFamily: 'Syne,system-ui', fontWeight: 700, color: '#fda4af' }}>↩ {t.logoutConfirm}</div>
                  <div style={{ padding: 20, color: 'rgba(255,255,255,0.85)', fontSize: 14 }}>Подтвердите выход из аккаунта.</div>
                  <div style={{ padding: '0 20px 20px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                    <button onClick={() => setLogoutConfirmOpen(false)} style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.9)', cursor: 'pointer' }}>{t.cancel}</button>
                    <button onClick={() => { setLogoutConfirmOpen(false); onLogout(); onClose(); }} style={{ padding: '10px 14px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#fb7185,#ef4444)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>{t.logoutAccount}</button>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
