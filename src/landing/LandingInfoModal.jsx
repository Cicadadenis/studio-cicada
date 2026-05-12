import React from 'react';
import { FALLBACK_PRO_MONTHLY_USD, fetchPublicPlans, formatUsdPrice, getMonthlyProPriceUsd } from '../pricingPlans.js';

// ═══════════════════════════════════════════════════════════════════════════
// LANDING INFO MODAL
// ═══════════════════════════════════════════════════════════════════════════
export default function LandingInfoModal({ page, onClose, isMobile }) {
  const [docsSection, setDocsSection] = React.useState(0);
  const [proMonthlyUsd, setProMonthlyUsd] = React.useState(null);

  React.useEffect(() => {
    if (page !== 'pricing') return undefined;
    let cancelled = false;
    fetchPublicPlans()
      .then((plans) => {
        if (!cancelled) setProMonthlyUsd(getMonthlyProPriceUsd(plans));
      })
      .catch(() => {
        if (!cancelled) setProMonthlyUsd(FALLBACK_PRO_MONTHLY_USD);
      });
    return () => { cancelled = true; };
  }, [page]);

  const PAGE_META = {
    features:  { title: 'Возможности',  icon: '\u2728', grad: 'linear-gradient(135deg,#fbbf24,#f97316)', glow: 'rgba(251,191,36,0.18)',  border: 'rgba(251,191,36,0.35)' },
    templates: { title: '\u0428\u0430\u0431\u043b\u043e\u043d\u044b',    icon: '🎨', grad: 'linear-gradient(135deg,#60a5fa,#818cf8)', glow: 'rgba(96,165,250,0.18)',   border: 'rgba(96,165,250,0.35)'  },
    pricing:   { title: '\u0422\u0430\u0440\u0438\u0444\u044b',      icon: '💳', grad: 'linear-gradient(135deg,#34d399,#06b6d4)', glow: 'rgba(52,211,153,0.18)',   border: 'rgba(52,211,153,0.35)'  },
    docs:      { title: '\u0414\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0430\u0446\u0438\u044f', icon: '📖', grad: 'linear-gradient(135deg,#a78bfa,#6366f1)', glow: 'rgba(167,139,250,0.18)',  border: 'rgba(167,139,250,0.35)' },
  };
  const meta = PAGE_META[page] || PAGE_META.features;

  const Code = ({ children }) => (
    <code style={{ fontFamily: 'monospace', fontSize: 12, background: 'rgba(255,255,255,0.08)', padding: '2px 7px', borderRadius: 5, color: '#fbbf24' }}>{children}</code>
  );
  const CodeBlock = ({ children }) => (
    <pre style={{ fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6, background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '12px 14px', margin: '8px 0', overflowX: 'auto', color: '#93c5fd', whiteSpace: 'pre' }}>{children}</pre>
  );
  const SectionTitle = ({ children, color = '#fbbf24' }) => (
    <div style={{ fontFamily: 'Syne,system-ui', fontWeight: 700, fontSize: 15, color, marginBottom: 10, marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>{children}</div>
  );
  const Table = ({ rows }) => (
    <div style={{ overflowX: 'auto', marginBottom: 10 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr>{rows[0].map((h, i) => <th key={i} style={{ textAlign: 'left', padding: '7px 10px', background: 'rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)', fontFamily: 'Syne,system-ui', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
        <tbody>{rows.slice(1).map((row, ri) => (<tr key={ri} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{row.map((cell, ci) => <td key={ci} style={{ padding: '7px 10px', color: 'rgba(255,255,255,0.75)', verticalAlign: 'top' }}>{cell}</td>)}</tr>))}</tbody>
      </table>
    </div>
  );
  const proMonthlyPrice = proMonthlyUsd == null ? '...' : formatUsdPrice(proMonthlyUsd);

  const DOC_SECTIONS = [
    { label: '📖 \u041e\u0431\u0437\u043e\u0440', content: (<div style={{ display:'flex', flexDirection:'column', gap:12 }}><SectionTitle>\u0427\u0442\u043e \u0442\u0430\u043a\u043e\u0435 Cicada Studio?</SectionTitle><p style={{ fontSize:13, color:'rgba(255,255,255,0.7)', lineHeight:1.65, margin:0 }}><strong style={{ color:'#fbbf24' }}>Cicada Studio</strong> \u2014 \u0432\u0438\u0437\u0443\u0430\u043b\u044c\u043d\u044b\u0439 \u043a\u043e\u043d\u0441\u0442\u0440\u0443\u043a\u0442\u043e\u0440 Telegram-\u0431\u043e\u0442\u043e\u0432 \u043d\u0430 \u043e\u0441\u043d\u043e\u0432\u0435 ReactFlow.</p><div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr':'1fr 1fr 1fr', gap:8 }}>{[['\u041b\u0435\u0432\u0430\u044f \u043f\u0430\u043d\u0435\u043b\u044c','\u041f\u0430\u043b\u0438\u0442\u0440\u0430 \u0431\u043b\u043e\u043a\u043e\u0432 \u2014 \u043f\u0435\u0440\u0435\u0442\u0430\u0449\u0438 \u043d\u0430 \u0445\u043e\u043b\u0441\u0442','#3ecf8e'],['\u0426\u0435\u043d\u0442\u0440\u0430\u043b\u044c\u043d\u0430\u044f','\u0425\u043e\u043b\u0441\u0442 \u0434\u043b\u044f \u043f\u043e\u0441\u0442\u0440\u043e\u0435\u043d\u0438\u044f \u0441\u0445\u0435\u043c\u044b','#60a5fa'],['\u041f\u0440\u0430\u0432\u0430\u044f \u043f\u0430\u043d\u0435\u043b\u044c','\u0421\u0432\u043e\u0439\u0441\u0442\u0432\u0430 \u0431\u043b\u043e\u043a\u0430 + \u043a\u043e\u0434','#a78bfa']].map(([t,d,c]) => (<div key={t} style={{ padding:'12px 14px', borderRadius:10, background:'rgba(255,255,255,0.03)', border:`1px solid ${c}30` }}><div style={{ fontSize:12, fontWeight:700, color:c, marginBottom:4, fontFamily:'Syne,system-ui' }}>{t}</div><div style={{ fontSize:11, color:'rgba(255,255,255,0.55)', lineHeight:1.5 }}>{d}</div></div>))}</div></div>) },
    { label: '🧱 \u0411\u043b\u043e\u043a\u0438', content: (<div style={{ display:'flex', flexDirection:'column', gap:14 }}>{[{ group:'\u2699 \u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438', color:'#94a3b8', rows:[['\u0411\u043b\u043e\u043a','\u041d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0435'],['📌 \u0412\u0435\u0440\u0441\u0438\u044f','\u0423\u043a\u0430\u0437\u044b\u0432\u0430\u0435\u0442 \u0432\u0435\u0440\u0441\u0438\u044e \u0431\u043e\u0442\u0430'],['🤖 \u0411\u043e\u0442','\u0422\u043e\u043a\u0435\u043d Telegram-\u0431\u043e\u0442\u0430'],['📋 \u041a\u043e\u043c\u0430\u043d\u0434\u044b \u043c\u0435\u043d\u044e','\u041a\u043e\u043c\u0430\u043d\u0434\u044b \u0432 \u043c\u0435\u043d\u044e Telegram'],['🌍 \u0413\u043b\u043e\u0431\u0430\u043b\u044c\u043d\u0430\u044f','\u0413\u043b\u043e\u0431\u0430\u043b\u044c\u043d\u044b\u0435 \u043f\u0435\u0440\u0435\u043c\u0435\u043d\u043d\u044b\u0435']] },{ group:'\u25b6 \u041e\u0441\u043d\u043e\u0432\u043d\u044b\u0435', color:'#3ecf8e', rows:[['\u0411\u043b\u043e\u043a','\u041d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0435'],['\u25b6 \u0421\u0442\u0430\u0440\u0442','\u0422\u043e\u0447\u043a\u0430 \u0432\u0445\u043e\u0434\u0430 \u043f\u0440\u0438 /start'],['\u2709 \u041e\u0442\u0432\u0435\u0442','\u041e\u0442\u043f\u0440\u0430\u0432\u043a\u0430 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u044f'],['\u229e \u041a\u043d\u043e\u043f\u043a\u0438','\u041a\u043b\u0430\u0432\u0438\u0430\u0442\u0443\u0440\u0430'],['\u2215 \u041a\u043e\u043c\u0430\u043d\u0434\u0430','\u041e\u0431\u0440\u0430\u0431\u043e\u0442\u043a\u0430 /\u043a\u043e\u043c\u0430\u043d\u0434\u044b'],['\u2299 \u041d\u0430\u0436\u0430\u0442\u0438\u0435','\u0421allback \u043e\u0442 inline-\u043a\u043d\u043e\u043f\u043e\u043a']] },{ group:'🧠 \u041b\u043e\u0433\u0438\u043a\u0430', color:'#fb923c', rows:[['\u0411\u043b\u043e\u043a','\u041d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0435'],['\u25c7 \u0423\u0441\u043b\u043e\u0432\u0438\u0435','If-else \u0432\u0435\u0442\u0432\u043b\u0435\u043d\u0438\u0435'],['? \u0421\u043f\u0440\u043e\u0441\u0438\u0442\u044c','\u0417\u0430\u043f\u0440\u043e\u0441 \u0432\u0432\u043e\u0434\u0430'],['♦ \u0417\u0430\u043f\u043e\u043c\u043d\u0438\u0442\u044c','\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u0432 \u043f\u0435\u0440\u0435\u043c\u0435\u043d\u043d\u0443\u044e']] }].map(({ group, color, rows }) => (<div key={group}><SectionTitle color={color}>{group}</SectionTitle><Table rows={rows} /></div>))}</div>) },
    { label: '🔗 \u0421\u043e\u0435\u0434\u0438\u043d\u0435\u043d\u0438\u044f', content: (<div style={{ display:'flex', flexDirection:'column', gap:14 }}><SectionTitle>\u041f\u0440\u0430\u0432\u0438\u043b\u0430 \u0441\u043e\u0435\u0434\u0438\u043d\u0435\u043d\u0438\u0439</SectionTitle>{[['\u041e\u0442 source \u043a target','\u041f\u043e\u0442\u043e\u043a \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f \u0438\u0434\u0451\u0442 \u0441\u043b\u0435\u0432\u0430 \u043d\u0430\u043f\u0440\u0430\u0432\u043e'],['Корневые блоки','Старт, Команда — начало цепочки'],['Завершающие блоки','Стоп, Переход — без исходящих']].map(([t,d]) => (<div key={t} style={{ display:'flex', gap:12, padding:'10px 12px', borderRadius:9, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)' }}><div style={{ fontSize:12, fontWeight:700, color:'#fbbf24', minWidth:130, flexShrink:0 }}>{t}</div><div style={{ fontSize:12, color:'rgba(255,255,255,0.65)', lineHeight:1.5 }}>{d}</div></div>))}</div>) },
    { label: '{ } Переменные', content: (<div style={{ display:'flex', flexDirection:'column', gap:14 }}><SectionTitle>Встроенные переменные</SectionTitle><Table rows={[['\u0421\u0438\u043d\u0442\u0430\u043a\u0441\u0438\u0441','\u0417\u043d\u0430\u0447\u0435\u043d\u0438\u0435'],['{пользователь.имя}','Имя пользователя'],['{пользователь.id}','ID пользователя Telegram'],['{чат.id}','ID текущего чата'],['{текст}','Текст последнего сообщения']]} /><CodeBlock>{`ответ "Привет, {пользователь.имя}!"`}</CodeBlock></div>) },
    { label: '\u2705 \u042d\u043a\u0441\u043f\u043e\u0440\u0442', content: (<div style={{ display:'flex', flexDirection:'column', gap:14 }}><SectionTitle>Панель DSL (справа)</SectionTitle><div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr':'1fr 1fr', gap:8 }}>{[['проверить','Валидация схемы','#3ecf8e'],['copy','Копировать код','#60a5fa'],['↓ .ccd','Скачать файл','#fbbf24'],['▶ Запустить','Запуск бота','#a78bfa']].map(([t,d,c]) => (<div key={t} style={{ padding:'11px 13px', borderRadius:9, background:'rgba(255,255,255,0.02)', border:`1px solid ${c}30` }}><div style={{ fontSize:13, fontWeight:700, color:c, fontFamily:'Syne,system-ui', marginBottom:4 }}>{t}</div><div style={{ fontSize:12, color:'rgba(255,255,255,0.55)', lineHeight:1.5 }}>{d}</div></div>))}</div><SectionTitle>Локальный запуск (CLI)</SectionTitle><CodeBlock>{`pip install cicada-tg\ncicada bot.ccd`}</CodeBlock></div>) },
  ];

  return (
    <div
      className="lip-modal-overlay"
      style={{ position:'fixed', inset:0, zIndex:15000, background:'rgba(3,5,9,0.82)', backdropFilter:'blur(14px)', display:'flex', alignItems:'center', justifyContent:'center', padding:isMobile?0:18 }}
      onClick={onClose}
    >
      <style>{`
        @keyframes lipSlide { from{opacity:0;transform:translateY(16px) scale(0.97)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes lipSlideUp { from{opacity:0;transform:translateY(100%)} to{opacity:1;transform:translateY(0)} }
        @keyframes shimmer { 0%{background-position:200% center} 100%{background-position:-200% center} }
        .lip-modal-overlay {
          background:
            radial-gradient(circle at 16% 10%, rgba(37,99,235,0.32), transparent 34%),
            radial-gradient(circle at 84% 16%, rgba(168,85,247,0.36), transparent 36%),
            radial-gradient(circle at 50% 86%, rgba(14,165,233,0.2), transparent 38%),
            rgba(5,4,18,0.84) !important;
          backdrop-filter:blur(16px) saturate(130%) !important;
        }
        .lip-modal-shell {
          position:relative;
          isolation:isolate;
          background:
            linear-gradient(145deg, rgba(18,14,54,0.92), rgba(13,10,37,0.88) 48%, rgba(8,8,26,0.95)),
            rgba(10,8,30,0.92) !important;
          border:1px solid rgba(123,92,255,0.58) !important;
          border-radius:24px !important;
          box-shadow:
            0 34px 120px rgba(0,0,0,0.78),
            0 0 82px rgba(80,70,255,0.27),
            inset 0 0 0 1px rgba(255,255,255,0.05) !important;
        }
        .lip-modal-shell::before {
          content:"";
          position:absolute;
          inset:0;
          z-index:0;
          pointer-events:none;
          background:
            radial-gradient(circle at 22% 4%, rgba(45,212,191,0.26), transparent 20%),
            radial-gradient(circle at 92% 0%, rgba(168,85,247,0.34), transparent 24%),
            linear-gradient(90deg, rgba(34,211,238,0.08), transparent 25%, rgba(168,85,247,0.12));
        }
        .lip-modal-shell > * { position:relative; z-index:1; }
        .lip-top-line {
          height:2px !important;
          background:linear-gradient(90deg,transparent,rgba(34,211,238,0.86),rgba(168,85,247,0.92),rgba(251,191,36,0.72),transparent) !important;
        }
        .lip-modal-header {
          background:linear-gradient(180deg, rgba(35,22,86,0.72), rgba(17,12,48,0.36)) !important;
          border-bottom:1px solid rgba(121,98,255,0.28) !important;
        }
        .lip-close {
          width:34px !important;
          height:34px !important;
          border-radius:12px !important;
          background:rgba(255,255,255,0.06) !important;
          border:1px solid rgba(255,255,255,0.16) !important;
          color:rgba(255,255,255,0.72) !important;
          box-shadow:inset 0 0 18px rgba(139,92,246,0.12) !important;
        }
        .lip-close:hover {
          background:rgba(248,113,113,0.13) !important;
          border-color:rgba(248,113,113,0.78) !important;
          color:#fecaca !important;
        }
        .lip-modal-body {
          background:
            radial-gradient(circle at 78% 18%, rgba(168,85,247,0.14), transparent 34%),
            radial-gradient(circle at 34% 12%, rgba(14,165,233,0.12), transparent 32%) !important;
        }
        .lip-scroll::-webkit-scrollbar{width:5px}
        .lip-scroll::-webkit-scrollbar-track{background:transparent}
        .lip-scroll::-webkit-scrollbar-thumb{background:rgba(123,92,255,0.38);border-radius:3px}
        .lip-feat-card,
        .lip-tpl-card,
        .lip-price-free,
        .lip-price-pro,
        .lip-note-card,
        .lip-faq-card {
          position:relative;
          overflow:hidden;
          background:linear-gradient(135deg, rgba(23,17,68,0.74), rgba(25,10,58,0.58)) !important;
          border:1px solid rgba(90,118,255,0.32) !important;
          box-shadow:inset 0 0 22px rgba(59,130,246,0.08), 0 10px 24px rgba(0,0,0,0.18) !important;
        }
        .lip-feat-card,
        .lip-tpl-card { padding:16px 18px; border-radius:14px; transition:all .22s ease; cursor:default; }
        .lip-price-free,
        .lip-price-pro { padding:22px; border-radius:18px; transition:all .2s; }
        .lip-feat-card::before,
        .lip-tpl-card::before,
        .lip-price-free::before,
        .lip-price-pro::before,
        .lip-note-card::before,
        .lip-faq-card::before {
          content:"";
          position:absolute;
          inset:0 auto auto 0;
          width:54%;
          height:1px;
          background:linear-gradient(90deg, rgba(34,211,238,0.9), transparent);
          opacity:.75;
        }
        .lip-feat-card:hover,
        .lip-tpl-card:hover,
        .lip-price-free:hover,
        .lip-price-pro:hover,
        .lip-faq-card:hover {
          transform:translateY(-2px);
          border-color:rgba(34,211,238,0.55) !important;
          box-shadow:inset 0 0 26px rgba(59,130,246,0.12), 0 0 28px rgba(59,130,246,0.16) !important;
        }
        .lip-price-pro {
          background:linear-gradient(135deg, rgba(251,191,36,0.16), rgba(168,85,247,0.22)) !important;
          border-color:rgba(251,191,36,0.72) !important;
          box-shadow:inset 0 0 28px rgba(251,191,36,0.1), 0 0 32px rgba(168,85,247,0.22) !important;
        }
        @media (max-width: 640px) {
          .lip-modal-shell { border-radius:22px 22px 0 0 !important; }
        }
      `}</style>

      <div
        className="lip-modal-shell"
        style={{ width:isMobile?'100%':'min(900px,96vw)', height:isMobile?'100%':'min(700px,93vh)', background:'#0b0c10', borderRadius:isMobile?'22px 22px 0 0':20, border:`1px solid ${meta.border}`, display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:`0 0 80px ${meta.glow}, 0 32px 80px rgba(0,0,0,0.8)`, animation:isMobile?'lipSlideUp .3s cubic-bezier(0.34,1.1,0.64,1)':'lipSlide .26s cubic-bezier(0.34,1.2,0.64,1)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Top accent line */}
        <div className="lip-top-line" style={{ height:3, background:meta.grad, flexShrink:0 }} />

        {/* Header */}
        <div className="lip-modal-header" style={{ padding:isMobile?'14px 16px':'18px 26px', borderBottom:`1px solid ${meta.border.replace('0.35','0.15')}`, display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0, background:'rgba(0,0,0,0.25)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ width:38, height:38, borderRadius:12, background:meta.grad, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, flexShrink:0, boxShadow:`0 4px 16px ${meta.glow}` }}>{meta.icon}</div>
            <div>
              <div style={{ fontFamily:'Syne,system-ui', fontWeight:800, fontSize:isMobile?18:22, color:'#fff', lineHeight:1.1 }}>{meta.title}</div>
              <div style={{ fontSize:11, color:'rgba(255,255,255,0.35)', marginTop:2, fontFamily:'system-ui' }}>
                {page==='features'&&'Актуальные возможности ядра Cicada DSL'}
                {page==='templates'&&'Готовые схемы на новом ядре'}
                {page==='pricing'&&'Прозрачные тарифы без скрытых условий'}
                {page==='docs'&&'Полная документация по платформе'}
              </div>
            </div>
          </div>
          <button className="lip-close" onClick={onClose} style={{ width:34, height:34, borderRadius:10, border:`1px solid ${meta.border.replace('0.35','0.2')}`, background:'rgba(255,255,255,0.04)', color:'rgba(255,255,255,0.45)', fontSize:18, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', transition:'all .15s', flexShrink:0 }} onMouseEnter={e=>{e.currentTarget.style.background='rgba(255,255,255,0.1)';e.currentTarget.style.color='#fff';}} onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,0.04)';e.currentTarget.style.color='rgba(255,255,255,0.45)';}}>×</button>
        </div>

        {/* Body */}
        <div className="lip-modal-body" style={{ flex:1, overflow:'hidden', display:'flex' }}>

          {/* ── FEATURES ── */}
          {page==='features' && (
            <div className="lip-scroll" style={{ flex:1, overflowY:'auto', padding:isMobile?'16px':'26px' }}>
              <p style={{ fontSize:14, color:'rgba(255,255,255,0.55)', lineHeight:1.7, marginBottom:22, marginTop:0, maxWidth:640 }}>
                Cicada Studio работает поверх нового ядра Cicada DSL: сценарии, БД, HTTP/JSON, медиа, модули и форматированный текст собираются блоками и превращаются в читаемый .ccd-код.
              </p>
              <div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr':'1fr 1fr', gap:12 }}>
                {[
                  { icon:'🧩', title:'Визуальный DSL-конструктор', desc:'Собирайте схему блоками на холсте, а Studio генерирует .ccd-код с командами, обработчиками, блоками и сценариями.', color:'#fbbf24', bg:'rgba(251,191,36,0.1)' },
                  { icon:'💬', title:'Форматированный текст', desc:'Обычные ответы, legacy Markdown, HTML и MarkdownV2: используйте ответ_md, ответ_html и ответ_md2 для красивых сообщений Telegram.', color:'#3ecf8e', bg:'rgba(62,207,142,0.1)' },
                  { icon:'🧠', title:'Сценарии и состояние', desc:'Многошаговые сценарии, спросить → переменная, вернуть, повтор шага, переходы, пользовательские и глобальные переменные.', color:'#a78bfa', bg:'rgba(167,139,250,0.1)' },
                  { icon:'🔘', title:'Динамические inline-кнопки', desc:'Inline-клавиатуры можно строить из списков и из БД: columns, callback-префиксы, поля text/id и кнопка назад.', color:'#60a5fa', bg:'rgba(96,165,250,0.1)' },
                  { icon:'🗄', title:'БД ключ-значение', desc:'Сохраняйте и загружайте строки, числа, списки и объекты для пользователя или глобально: сохранить, получить, сохранить_глобально.', color:'#10b981', bg:'rgba(16,185,129,0.1)' },
                  { icon:'🔗', title:'HTTP и JSON', desc:'GET/POST/PATCH/PUT/DELETE, fetch_json, http_заголовки, разобрать_json и в_json для интеграций с внешними API.', color:'#0ea5e9', bg:'rgba(14,165,233,0.1)' },
                  { icon:'🖼', title:'Медиа и файлы', desc:'Фото, документы, аудио, видео, голосовые, стикеры, локации, контакты, загрузка файлов и пересылка полученного file_id.', color:'#f87171', bg:'rgba(248,113,113,0.1)' },
                  { icon:'📦', title:'Модули и переиспользование', desc:'Подключайте импорт "cicada.catalog" или локальные .ccd-файлы, выносите общую логику в блоки и используйте их повторно.', color:'#fbbf24', bg:'rgba(251,191,36,0.1)' },
                  { icon:'🔁', title:'Циклы и коллекции', desc:'Работайте со списками и объектами: для каждого, пока, повторять, индексы, поля объекта, добавить, ключи, значения.', color:'#34d399', bg:'rgba(52,211,153,0.1)' },
                  { icon:'📣', title:'Уведомления и рассылки', desc:'Отправляйте сообщения конкретному пользователю, делайте рассылку всем или группе и проверяйте подписку на канал.', color:'#fb923c', bg:'rgba(251,146,60,0.1)' },
                ].map(({ icon, title, desc, color, bg }) => (
                  <div key={title} className="lip-feat-card"
                    onMouseEnter={e=>{e.currentTarget.style.borderColor=color+'55';e.currentTarget.style.boxShadow=`0 8px 28px rgba(0,0,0,0.4), 0 0 20px ${color}18`;}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor='rgba(255,255,255,0.07)';e.currentTarget.style.boxShadow='none';}}
                  >
                    <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:10 }}>
                      <div style={{ width:38, height:38, borderRadius:11, background:bg, border:`1px solid ${color}30`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, flexShrink:0 }}>{icon}</div>
                      <span style={{ fontFamily:'Syne,system-ui', fontWeight:700, fontSize:14, color }}>{title}</span>
                    </div>
                    <p style={{ fontSize:12.5, color:'rgba(255,255,255,0.55)', lineHeight:1.65, margin:0 }}>{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── TEMPLATES ── */}
          {page==='templates' && (
            <div className="lip-scroll" style={{ flex:1, overflowY:'auto', padding:isMobile?'16px':'26px' }}>
              <p style={{ fontSize:14, color:'rgba(255,255,255,0.55)', lineHeight:1.7, marginBottom:22, marginTop:0 }}>
                Готовые схемы используют актуальное ядро: динамические inline-кнопки, сценарии, БД, HTTP/JSON, модули, медиа и форматирование сообщений.
              </p>
              <div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr':'1fr 1fr', gap:12 }}>
                {[
                  { icon:'👋', title:'Приветственный бот', tags:['Старт','HTML','Inline'], desc:'Главное меню с красивым HTML/MarkdownV2-текстом, inline-кнопками и отдельными обработчиками нажатий.', color:'#3ecf8e' },
                  { icon:'📦', title:'Каталог из БД', tags:['БД','Inline из БД','Назад'], desc:'Категории и товары хранятся в БД, клавиатуры строятся динамически через inline из бд с columns и callback-префиксом.', color:'#60a5fa' },
                  { icon:'🧩', title:'Модульный каталог', tags:['Импорт','Блоки','Сценарии'], desc:'Готовый модуль cicada.catalog: подключите импортом, переиспользуйте блоки меню и сценарии создания категорий и товаров.', color:'#a78bfa' },
                  { icon:'🛍\ufe0f', title:'Магазин с карточками', tags:['Объекты','Для каждого','Глобальная БД'], desc:'Товары как объекты с id, name, price и description, карточка товара ищется циклом и открывается по callback.', color:'#fbbf24' },
                  { icon:'📝', title:'Сбор заявок', tags:['Спросить','Сохранить','Уведомить'], desc:'Многошаговая форма собирает контакты, сохраняет результат в БД и отправляет уведомление администратору.', color:'#f87171' },
                  { icon:'🌦', title:'API/JSON бот', tags:['fetch_json','HTTP','JSON'], desc:'Шаблон для внешних API: запрос, разбор JSON-ответа, вывод нужных полей и обработка ошибок в сценарии.', color:'#0ea5e9' },
                  { icon:'🖼', title:'Медиа-приёмник', tags:['Фото','Документ','file_id'], desc:'Принимает фото, документы, голосовые и стикеры, сохраняет file_id и умеет отправить файл обратно пользователю.', color:'#34d399' },
                  { icon:'📣', title:'Рассылка и подписка', tags:['Рассылка','Сегменты','Подписка'], desc:'Проверка подписки на канал, сегментация пользователей и массовые сообщения всем или выбранной группе.', color:'#fb923c' },
                ].map(({ icon, title, tags, desc, color }) => (
                  <div key={title} className="lip-tpl-card"
                    onMouseEnter={e=>{e.currentTarget.style.borderColor=color+'44';e.currentTarget.style.boxShadow=`0 8px 28px rgba(0,0,0,0.4), 0 0 16px ${color}18`;}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor='rgba(255,255,255,0.07)';e.currentTarget.style.boxShadow='none';}}
                  >
                    {/* Colour accent bar */}
                    <div style={{ position:'absolute', left:0, top:0, bottom:0, width:3, background:color, borderRadius:'14px 0 0 14px', opacity:0.8 }} />
                    <div style={{ paddingLeft:10 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
                        <span style={{ fontSize:26 }}>{icon}</span>
                        <span style={{ fontFamily:'Syne,system-ui', fontWeight:700, fontSize:14, color:'#fff' }}>{title}</span>
                      </div>
                      <p style={{ fontSize:12.5, color:'rgba(255,255,255,0.5)', lineHeight:1.65, margin:'0 0 10px' }}>{desc}</p>
                      <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                        {tags.map(tag => (
                          <span key={tag} style={{ fontSize:10, padding:'3px 9px', borderRadius:999, background:color+'18', color, border:`1px solid ${color}35`, fontWeight:700, fontFamily:'Syne,system-ui', letterSpacing:'0.04em' }}>{tag}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="lip-note-card" style={{ marginTop:18, padding:'14px 18px', borderRadius:14, background:'rgba(251,191,36,0.05)', border:'1px solid rgba(251,191,36,0.18)', display:'flex', alignItems:'center', gap:14 }}>
                <span style={{ fontSize:22, flexShrink:0 }}>📚</span>
                <div>
                  <div style={{ fontSize:13, color:'rgba(255,255,255,0.75)', fontWeight:600, marginBottom:3, fontFamily:'Syne,system-ui' }}>Шаблоны соответствуют новому DSL</div>
                  <div style={{ fontSize:11, color:'rgba(255,255,255,0.35)' }}>Откройте проект → нажмите «Библиотека» или «⚡ Примеры» → выберите готовую схему и адаптируйте под своего бота</div>
                </div>
              </div>
            </div>
          )}

          {/* ── DOCS ── */}
          {page==='docs' && (
            <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
              {!isMobile && (
                <div style={{ width:200, background:'rgba(0,0,0,0.2)', borderRight:'1px solid rgba(255,255,255,0.07)', overflowY:'auto', flexShrink:0, padding:'12px 8px' }}>
                  {DOC_SECTIONS.map((s,i) => (
                    <button key={i} onClick={()=>setDocsSection(i)} style={{ width:'100%', textAlign:'left', padding:'9px 12px', borderRadius:8, border:'none', background:docsSection===i?'rgba(167,139,250,0.12)':'none', color:docsSection===i?'#a78bfa':'rgba(255,255,255,0.5)', fontSize:12, fontFamily:'system-ui', cursor:'pointer', transition:'all .15s', marginBottom:2 }} onMouseEnter={e=>{if(docsSection!==i)e.currentTarget.style.background='rgba(255,255,255,0.05)';}} onMouseLeave={e=>{if(docsSection!==i)e.currentTarget.style.background='none';}}>{s.label}</button>
                  ))}
                </div>
              )}
              <div className="lip-scroll" style={{ flex:1, overflowY:'auto', padding:isMobile?'14px':'20px 24px' }}>
                {isMobile && (
                  <div style={{ display:'flex', gap:6, overflowX:'auto', marginBottom:14, paddingBottom:6 }}>
                    {DOC_SECTIONS.map((s,i) => (
                      <button key={i} onClick={()=>setDocsSection(i)} style={{ flexShrink:0, padding:'6px 12px', borderRadius:8, border:`1px solid ${docsSection===i?'rgba(167,139,250,0.4)':'rgba(255,255,255,0.1)'}`, background:docsSection===i?'rgba(167,139,250,0.1)':'none', color:docsSection===i?'#a78bfa':'rgba(255,255,255,0.5)', fontSize:11, cursor:'pointer', whiteSpace:'nowrap' }}>{s.label}</button>
                    ))}
                  </div>
                )}
                {DOC_SECTIONS[docsSection]?.content}
              </div>
            </div>
          )}

          {/* ── PRICING ── */}
          {page==='pricing' && (
            <div className="lip-scroll" style={{ flex:1, overflowY:'auto', padding:isMobile?'16px':'26px' }}>
              <p style={{ fontSize:14, color:'rgba(255,255,255,0.55)', lineHeight:1.7, marginBottom:24, marginTop:0 }}>
                Начните бесплатно, а при росте — переходите на Pro. Без скрытых комиссий, без ограничений по времени.
              </p>
              <div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr':'1fr 1fr', gap:16, marginBottom:24 }}>
                {/* FREE */}
                <div className="lip-price-free">
                  <div style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'4px 12px', borderRadius:999, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', marginBottom:14 }}>
                    <span style={{ fontSize:10, fontWeight:800, color:'rgba(255,255,255,0.5)', fontFamily:'Syne,system-ui', letterSpacing:'0.08em' }}>FREE</span>
                  </div>
                  <div style={{ display:'flex', alignItems:'flex-end', gap:6, marginBottom:6 }}>
                    <span style={{ fontFamily:'Syne,system-ui', fontWeight:900, fontSize:42, color:'#fff', lineHeight:1 }}>$0</span>
                    <span style={{ fontSize:14, color:'rgba(255,255,255,0.35)', paddingBottom:6 }}>/мес</span>
                  </div>
                  <div style={{ fontSize:12, color:'rgba(255,255,255,0.3)', marginBottom:20 }}>Всегда бесплатно. Навсегда.</div>
                  <div style={{ height:1, background:'rgba(255,255,255,0.07)', marginBottom:18 }} />
                  <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:20 }}>
                    {[
                      [true,'1 проект в облаке'],
                      [true,'Все базовые блоки (30+)'],
                      [false,'Скачивание .ccd файлов'],
                      [true,'DSL-валидатор'],
                      [true,'Запуск бота в браузере'],
                      [false,'AI-генерация схем'],
                      [false,'Безлимитные проекты'],
                      [false,'Приоритетная поддержка'],
                    ].map(([ok, text]) => (
                      <div key={text} style={{ display:'flex', gap:10, alignItems:'center', fontSize:13, color:ok?'rgba(255,255,255,0.75)':'rgba(255,255,255,0.25)' }}>
                        <div style={{ width:18, height:18, borderRadius:6, background:ok?'rgba(62,207,142,0.15)':'rgba(255,255,255,0.04)', border:`1px solid ${ok?'rgba(62,207,142,0.3)':'rgba(255,255,255,0.1)'}`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontSize:10 }}>{ok?'✓':'–'}</div>
                        <span>{text}</span>
                      </div>
                    ))}
                  </div>
                  <button style={{ width:'100%', padding:'11px', borderRadius:10, border:'1px solid rgba(255,255,255,0.15)', background:'rgba(255,255,255,0.05)', color:'rgba(255,255,255,0.7)', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'Syne,system-ui', transition:'all .2s' }} onMouseEnter={e=>{e.currentTarget.style.background='rgba(255,255,255,0.1)';e.currentTarget.style.color='#fff';}} onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,0.05)';e.currentTarget.style.color='rgba(255,255,255,0.7)';}}>Начать бесплатно</button>
                </div>
                {/* PRO */}
                <div className="lip-price-pro">
                  <div style={{ position:'absolute', top:0, right:0, padding:'5px 14px', borderRadius:'0 18px 0 12px', background:'linear-gradient(135deg,#ffd700,#ffaa00)', fontSize:10, fontWeight:900, color:'#111', fontFamily:'Syne,system-ui', letterSpacing:'0.08em' }}>★ ПОПУЛЯРНЫЙ</div>
                  <div style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'4px 12px', borderRadius:999, background:'rgba(255,215,0,0.12)', border:'1px solid rgba(255,215,0,0.3)', marginBottom:14 }}>
                    <span style={{ fontSize:10, fontWeight:800, color:'#ffd700', fontFamily:'Syne,system-ui', letterSpacing:'0.08em' }}>PRO</span>
                  </div>
                  <div style={{ display:'flex', alignItems:'flex-end', gap:6, marginBottom:6 }}>
                    <span style={{ fontFamily:'Syne,system-ui', fontWeight:900, fontSize:42, color:'#ffd700', lineHeight:1 }}>{proMonthlyPrice}</span>
                    <span style={{ fontSize:14, color:'rgba(255,215,0,0.45)', paddingBottom:6 }}>/мес</span>
                  </div>
                  <div style={{ fontSize:12, color:'rgba(255,215,0,0.4)', marginBottom:20 }}>Всё для профессиональной работы</div>
                  <div style={{ height:1, background:'rgba(255,215,0,0.15)', marginBottom:18 }} />
                  <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:20 }}>
                    {[
                      'Безлимитные проекты',
                      'Все блоки без ограничений',
                      'AI-генерация схем',
                      'Скачивание .ccd файлов',
                      'Запуск бота в браузере',
                      'DSL-валидатор + расширенная отладка',
                      'Приоритетная поддержка 24/7',
                      'Ранний доступ к новым функциям',
                      'Визуальный Preview-чат бота',
                    ].map(text => (
                      <div key={text} style={{ display:'flex', gap:10, alignItems:'center', fontSize:13, color:'rgba(255,255,255,0.8)' }}>
                        <div style={{ width:18, height:18, borderRadius:6, background:'rgba(62,207,142,0.15)', border:'1px solid rgba(62,207,142,0.35)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontSize:10, color:'#3ecf8e' }}>✓</div>
                        <span>{text}</span>
                      </div>
                    ))}
                  </div>
                  <button style={{ width:'100%', padding:'12px', borderRadius:10, border:'none', background:'linear-gradient(135deg,#ffd700,#ffaa00)', color:'#111', fontSize:13, fontWeight:800, cursor:'pointer', fontFamily:'Syne,system-ui', boxShadow:'0 4px 20px rgba(255,215,0,0.3)', transition:'all .2s' }} onMouseEnter={e=>{e.currentTarget.style.filter='brightness(1.08)';e.currentTarget.style.boxShadow='0 6px 28px rgba(255,215,0,0.45)';e.currentTarget.style.transform='translateY(-1px)';}} onMouseLeave={e=>{e.currentTarget.style.filter='none';e.currentTarget.style.boxShadow='0 4px 20px rgba(255,215,0,0.3)';e.currentTarget.style.transform='none';}}>Выбрать Pro →</button>
                </div>
              </div>
              {/* FAQ */}
              <div>
                <div style={{ fontSize:12, fontWeight:700, color:'rgba(255,255,255,0.35)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:12, fontFamily:'Syne,system-ui' }}>Частые вопросы</div>
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {[
                    ['Можно ли отменить подписку?','Да, в любой момент. Доступ к Pro-функциям сохраняется до конца оплаченного периода.'],
                    ['Есть ли бесплатный период для Pro?','Новые пользователи получают 3 дня Pro-доступа сразу после регистрации.'],
                    ['Какие способы оплаты принимаются?','Оплата через криптовалюту: USDT, TRX, LTC. Безопасно и без посредников.'],
                    ['Что будет с проектами при переходе на Free?','Проекты сохранятся. Доступен только 1 проект для редактирования.'],
                  ].map(([q,a]) => (
                    <div key={q} className="lip-faq-card" style={{ padding:'13px 16px', borderRadius:12, background:'rgba(255,255,255,0.025)', border:'1px solid rgba(255,255,255,0.07)', transition:'border-color .2s' }} onMouseEnter={e=>e.currentTarget.style.borderColor='rgba(255,255,255,0.14)'} onMouseLeave={e=>e.currentTarget.style.borderColor='rgba(255,255,255,0.07)'}>
                      <div style={{ fontSize:13, fontWeight:700, color:'rgba(255,255,255,0.88)', marginBottom:6, fontFamily:'Syne,system-ui' }}>{q}</div>
                      <div style={{ fontSize:12, color:'rgba(255,255,255,0.45)', lineHeight:1.6 }}>{a}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
