// ═══════════════════════════════════════════════════════════════════════════
// EMAIL — отправка через Resend
// ═══════════════════════════════════════════════════════════════════════════
import { Resend } from 'resend';
import { RESEND_API_KEY, EMAIL_FROM, APP_URL } from './config.js';

let _resend = null;
function getResend() {
  if (!RESEND_API_KEY) throw new Error('Email не настроен: укажи RESEND_API_KEY в .env');
  if (!_resend) _resend = new Resend(RESEND_API_KEY);
  return _resend;
}

// ─── Shared layout wrapper ───────────────────────────────────────────────────
function baseLayout({ accentColor = '#ffd700', accentColor2 = '#ff8c00', icon, title, bodyHtml, footerText }) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#080a0f;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;">

  <!-- Outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#080a0f;min-height:100vh;">
    <tr><td align="center" style="padding:48px 16px 56px;">

      <!-- Card -->
      <table width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;">

        <!-- ── Top accent bar ── -->
        <tr>
          <td style="height:2px;background:linear-gradient(90deg,transparent 0%,${accentColor} 35%,${accentColor2} 65%,transparent 100%);border-radius:2px 2px 0 0;"></td>
        </tr>

        <!-- ── Card body ── -->
        <tr>
          <td style="background:linear-gradient(160deg,#111318 0%,#13161e 60%,#10131a 100%);border-left:1px solid rgba(255,255,255,0.07);border-right:1px solid rgba(255,255,255,0.07);border-bottom:1px solid rgba(255,255,255,0.05);border-radius:0 0 20px 20px;overflow:hidden;">

            <!-- Header band -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding:44px 44px 32px;text-align:center;background:linear-gradient(180deg,rgba(255,255,255,0.03) 0%,transparent 100%);border-bottom:1px solid rgba(255,255,255,0.05);">

                  <!-- Logo icon -->
                  <div style="display:inline-block;margin-bottom:20px;">
                    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
                      <tr>
                        <td style="width:64px;height:64px;background:linear-gradient(135deg,${accentColor} 0%,${accentColor2} 100%);border-radius:18px;text-align:center;vertical-align:middle;font-size:28px;box-shadow:0 8px 32px rgba(255,200,0,0.3),0 2px 8px rgba(0,0,0,0.5);">
                          ${icon}
                        </td>
                      </tr>
                    </table>
                  </div>

                  <!-- Brand name -->
                  <div style="margin-bottom:6px;">
                    <span style="font-size:13px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:${accentColor};opacity:0.9;">CICADA</span>
                    <span style="font-size:13px;font-weight:400;letter-spacing:0.22em;text-transform:uppercase;color:rgba(255,255,255,0.25);margin-left:6px;">STUDIO</span>
                  </div>

                  <!-- Decorative dots -->
                  <div style="margin-top:16px;">
                    <span style="display:inline-block;width:4px;height:4px;border-radius:50%;background:${accentColor};opacity:0.6;margin:0 3px;"></span>
                    <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${accentColor};opacity:0.9;margin:0 3px;"></span>
                    <span style="display:inline-block;width:4px;height:4px;border-radius:50%;background:${accentColor};opacity:0.6;margin:0 3px;"></span>
                  </div>
                </td>
              </tr>
            </table>

            <!-- Body content -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding:36px 44px 44px;">
                  ${bodyHtml}
                </td>
              </tr>
            </table>

            <!-- Footer -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding:20px 44px 28px;border-top:1px solid rgba(255,255,255,0.05);text-align:center;">
                  <p style="margin:0 0 6px;font-size:11px;color:rgba(255,255,255,0.18);line-height:1.6;">${footerText}</p>
                  <p style="margin:0;font-size:10px;color:rgba(255,255,255,0.1);letter-spacing:0.08em;">© 2025 CICADA STUDIO · Automated message, do not reply</p>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- ── Bottom glow line ── -->
        <tr>
          <td style="height:1px;background:linear-gradient(90deg,transparent,rgba(255,200,0,0.08),transparent);"></td>
        </tr>

      </table>
    </td></tr>
  </table>

</body>
</html>`;
}

// ─── Reusable HTML snippets ───────────────────────────────────────────────────

function greeting(name) {
  return `<p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:rgba(255,255,255,0.3);">Привет,</p>
  <p style="margin:0 0 24px;font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;">${name} <span style="opacity:0.3;">👋</span></p>`;
}

function divider(color = '#ffd700') {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0;">
    <tr>
      <td style="height:1px;background:linear-gradient(90deg,transparent,${color}30,transparent);"></td>
    </tr>
  </table>`;
}

function ctaButton(href, label, color1 = '#ffd700', color2 = '#ffaa00') {
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 8px;">
    <tr>
      <td style="background:linear-gradient(135deg,${color1} 0%,${color2} 100%);border-radius:14px;box-shadow:0 8px 28px rgba(255,200,0,0.35),0 2px 6px rgba(0,0,0,0.4);">
        <a href="${href}" style="display:block;padding:15px 40px;color:#0c0e12;font-size:14px;font-weight:800;text-decoration:none;letter-spacing:0.06em;white-space:nowrap;">${label}</a>
      </td>
    </tr>
  </table>`;
}

function fallbackLink(href) {
  return `<p style="margin:8px 0 0;font-size:11px;color:rgba(255,255,255,0.2);text-align:center;">
    Если кнопка не работает: <a href="${href}" style="color:#ffd700;text-decoration:none;word-break:break-all;">${href}</a>
  </p>`;
}

function infoBox(text, color = '#ffd700') {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;">
    <tr>
      <td style="padding:14px 18px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-left:3px solid ${color};border-radius:0 10px 10px 0;">
        <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.45);line-height:1.7;">${text}</p>
      </td>
    </tr>
  </table>`;
}

// ─── Шаблон: подтверждение email ────────────────────────────────────────────
export async function sendVerificationEmail(to, name, token) {
  const link = `${APP_URL}/api/verify-email?token=${token}`;

  const body = `
    ${greeting(name)}

    <p style="margin:0 0 28px;font-size:15px;color:rgba(255,255,255,0.55);line-height:1.75;">
      Вы зарегистрировались в&nbsp;<strong style="color:#fff;">Cicada Studio</strong>.<br>
      Подтвердите email, чтобы получить полный доступ к&nbsp;платформе.
    </p>

    <!-- CTA -->
    <div style="text-align:center;margin-bottom:24px;">
      ${ctaButton(link, '✓ Подтвердить email')}
    </div>

    ${divider()}

    <!-- Info rows -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="font-size:12px;color:rgba(255,255,255,0.3);">⏱ Срок действия</td>
              <td align="right" style="font-size:12px;color:rgba(255,255,255,0.6);font-weight:600;">24 часа</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:10px 0;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="font-size:12px;color:rgba(255,255,255,0.3);">📧 Адрес</td>
              <td align="right" style="font-size:12px;color:rgba(255,255,255,0.6);font-weight:600;">${to}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    ${fallbackLink(link)}
  `;

  await getResend().emails.send({
    from: EMAIL_FROM,
    to,
    subject: '◈ Подтвердите email — Cicada Studio',
    html: baseLayout({
      icon: '◈',
      title: 'Подтверждение email',
      bodyHtml: body,
      footerText: 'Если вы не регистрировались в Cicada Studio — просто проигнорируйте это письмо.',
    }),
  });
}

// ─── Шаблон: смена email ────────────────────────────────────────────────────
export async function sendEmailChangeCode(to, name, code, newEmail) {
  const digits = String(code).split('');

  const body = `
    ${greeting(name)}

    <p style="margin:0 0 28px;font-size:15px;color:rgba(255,255,255,0.55);line-height:1.75;">
      Вы запросили смену email на&nbsp;<strong style="color:#ffd700;">${newEmail}</strong>.<br>
      Введите код ниже для подтверждения операции.
    </p>

    <!-- OTP code block -->
    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 28px;">
      <tr>
        <td style="padding:22px 36px;background:linear-gradient(135deg,rgba(255,215,0,0.07),rgba(255,140,0,0.05));border:1.5px solid rgba(255,215,0,0.25);border-radius:16px;text-align:center;box-shadow:0 0 40px rgba(255,200,0,0.08);">
          <div style="font-size:11px;letter-spacing:0.2em;color:rgba(255,215,0,0.5);text-transform:uppercase;margin-bottom:14px;font-weight:600;">Код подтверждения</div>
          <div style="font-size:38px;font-weight:900;color:#ffd700;letter-spacing:0.3em;font-family:'Courier New',Courier,monospace;text-shadow:0 0 20px rgba(255,215,0,0.4);">
            ${digits.join('<span style="opacity:0.2;margin:0 1px;">·</span>')}
          </div>
        </td>
      </tr>
    </table>

    ${divider()}

    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="font-size:12px;color:rgba(255,255,255,0.3);">⏱ Срок действия</td>
              <td align="right" style="font-size:12px;color:rgba(255,255,255,0.6);font-weight:600;">15 минут</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="font-size:12px;color:rgba(255,255,255,0.3);">📨 Текущий email</td>
              <td align="right" style="font-size:12px;color:rgba(255,255,255,0.6);font-weight:600;">${to}</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:10px 0;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="font-size:12px;color:rgba(255,255,255,0.3);">✉ Новый email</td>
              <td align="right" style="font-size:12px;color:#ffd700;font-weight:600;">${newEmail}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  await getResend().emails.send({
    from: EMAIL_FROM,
    to,
    subject: '📧 Подтверждение смены email — Cicada Studio',
    html: baseLayout({
      accentColor: '#ffd700',
      accentColor2: '#ff8c00',
      icon: '📧',
      title: 'Смена email',
      bodyHtml: body,
      footerText: 'Это письмо отправлено на текущий адрес для вашей безопасности.<br>Если вы не запрашивали смену — проигнорируйте его.',
    }),
  });
}

// ─── Шаблон: сброс пароля ───────────────────────────────────────────────────
export async function sendPasswordResetEmail(to, name, token) {
  const link = `${APP_URL}?reset=${token}`;

  const body = `
    ${greeting(name)}

    <p style="margin:0 0 28px;font-size:15px;color:rgba(255,255,255,0.55);line-height:1.75;">
      Мы получили запрос на&nbsp;<strong style="color:#fff;">сброс пароля</strong> для вашего аккаунта.<br>
      Нажмите кнопку ниже, чтобы задать новый пароль.
    </p>

    <!-- Warning badge -->
    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 28px;">
      <tr>
        <td style="padding:10px 20px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:8px;">
          <p style="margin:0;font-size:12px;color:rgba(239,100,100,0.8);text-align:center;">⚠ Если вы не запрашивали сброс — немедленно смените пароль</p>
        </td>
      </tr>
    </table>

    <!-- CTA -->
    <div style="text-align:center;margin-bottom:24px;">
      ${ctaButton(link, '→ Задать новый пароль')}
    </div>

    ${divider()}

    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="font-size:12px;color:rgba(255,255,255,0.3);">⏱ Срок действия</td>
              <td align="right" style="font-size:12px;color:rgba(255,255,255,0.6);font-weight:600;">1 час</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:10px 0;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="font-size:12px;color:rgba(255,255,255,0.3);">📧 Аккаунт</td>
              <td align="right" style="font-size:12px;color:rgba(255,255,255,0.6);font-weight:600;">${to}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    ${fallbackLink(link)}
  `;

  await getResend().emails.send({
    from: EMAIL_FROM,
    to,
    subject: '🔑 Сброс пароля — Cicada Studio',
    html: baseLayout({
      accentColor: '#ffd700',
      accentColor2: '#ff8c00',
      icon: '🔑',
      title: 'Сброс пароля',
      bodyHtml: body,
      footerText: 'Если вы не запрашивали сброс пароля — просто проигнорируйте это письмо.',
    }),
  });
}


function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Шаблон: ответ поддержки ────────────────────────────────────────────────
export async function sendSupportReplyEmail(to, name, subject, replyText) {
  const body = `
    ${greeting(name)}

    <p style="margin:0 0 22px;font-size:15px;color:rgba(255,255,255,0.58);line-height:1.75;">
      Команда <strong style="color:#3ecf8e;">Cicada Studio Support</strong> ответила на ваше обращение.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">
      <tr>
        <td style="padding:14px 16px;background:rgba(62,207,142,0.07);border:1px solid rgba(62,207,142,0.2);border-radius:12px;">
          <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(62,207,142,0.75);font-weight:700;margin-bottom:8px;">Тема обращения</div>
          <div style="font-size:15px;color:#fff;font-weight:700;line-height:1.5;">${escapeHtml(subject)}</div>
        </td>
      </tr>
    </table>

    <div style="padding:18px 18px;background:rgba(255,255,255,0.035);border:1px solid rgba(255,255,255,0.08);border-radius:14px;margin-bottom:24px;">
      <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.28);font-weight:700;margin-bottom:12px;">Ответ support</div>
      <div style="font-size:15px;color:rgba(255,255,255,0.74);line-height:1.75;white-space:pre-wrap;">${escapeHtml(replyText)}</div>
    </div>

    ${divider()}

    <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.38);line-height:1.7;text-align:center;">
      Если вопрос остался — создайте новое обращение в профиле Cicada Studio.
    </p>
  `;

  await getResend().emails.send({
    from: process.env.SUPPORT_EMAIL_FROM || `Cicada Studio Support <support@cicada-studio.online>`,
    to,
    subject: `Ответ поддержки Cicada Studio: ${subject}`,
    html: baseLayout({
      accentColor: '#3ecf8e',
      accentColor2: '#0ea5e9',
      icon: '🛟',
      title: 'Ответ поддержки',
      bodyHtml: body,
      footerText: 'Письмо отправлено службой поддержки Cicada Studio.<br>Отвечать на него не нужно — создайте новое обращение в профиле.',
    }),
  });
}
