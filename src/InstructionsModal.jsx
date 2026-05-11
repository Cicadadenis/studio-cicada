import React, { useMemo, useState, useEffect, useRef } from 'react';
import { getInstructionWizardStrings } from './instructionsWizardI18n.js';

const pStyle = { fontSize: 13.5, lineHeight: 1.7, color: 'rgba(232,234,240,0.75)', margin: '0 0 12px 0' };

function ICode({ children }) {
  return (
    <code className="instr-inline-code" style={{ background: 'rgba(255,255,255,0.09)', padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace', fontSize: 12, color: '#3ecf8e' }}>{children}</code>
  );
}

function ICard({ icon, children }) {
  return (
    <div className="instr-card" style={{ display: 'flex', gap: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '10px 14px', marginTop: 12 }}>
      <span style={{ fontSize: 15, flexShrink: 0 }}>{icon}</span>
      <p style={{ fontSize: 12.5, color: 'rgba(232,234,240,0.6)', margin: 0, lineHeight: 1.6 }}>{children}</p>
    </div>
  );
}

function IList({ color, title, items }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {title && <p style={{ fontSize: 12, fontWeight: 700, color, margin: '0 0 8px 0', letterSpacing: '0.03em' }}>{title}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="instr-list-icon" style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>{item.icon}</span>
            <span style={{ fontSize: 13.5, color: 'rgba(232,234,240,0.85)' }}>{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function IExample({ steps, exampleLabel }) {
  return (
    <div className="instr-example" style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
      <p style={{ fontSize: 10, color: 'rgba(232,234,240,0.35)', margin: '0 0 10px 0', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{exampleLabel}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {steps.map((step, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 26, height: 26, borderRadius: 5, background: step.color + '20', border: `1px solid ${step.color}50`, color: step.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>{step.icon}</span>
            <span style={{ fontSize: 13, color: 'rgba(232,234,240,0.8)', fontFamily: 'monospace' }}>{step.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ICodeBlock({ lines }) {
  return (
    <div className="instr-codeblock" style={{ background: '#0d0f16', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '12px 14px', marginBottom: 12, fontFamily: 'monospace', fontSize: 12.5, lineHeight: 2 }}>
      {lines.map((l, i) => <div key={i} style={{ color: l.c }}>{l.t}</div>)}
    </div>
  );
}

function renderSegments(segments) {
  return segments.map((seg, i) => {
    if (seg[0] === 'text') return <React.Fragment key={i}>{seg[1]}</React.Fragment>;
    if (seg[0] === 'code') return <ICode key={i}>{seg[1]}</ICode>;
    return null;
  });
}

function renderBody(body, exampleLabel) {
  return body.map((part, i) => {
    const key = i;
    if (part[0] === 'p') return <p key={key} style={pStyle}>{part[1]}</p>;
    if (part[0] === 'pStyled') return <p key={key} style={{ ...pStyle, ...part[1] }}>{part[2]}</p>;
    if (part[0] === 'card') return <ICard key={key} icon={part[1]}>{renderSegments(part[2])}</ICard>;
    if (part[0] === 'list') return <IList key={key} color={part[1]} title={part[2]} items={part[3]} />;
    if (part[0] === 'example') return <IExample key={key} steps={part[1]} exampleLabel={exampleLabel} />;
    if (part[0] === 'codeblock') return <ICodeBlock key={key} lines={part[1]} />;
    return null;
  });
}

function buildSections(W) {
  return W.sections.map((sec) => ({
    id: sec.id,
    emoji: sec.emoji,
    color: sec.color,
    glow: sec.glow,
    label: sec.label,
    title: sec.title,
    subtitle: sec.subtitle,
    content: () => <>{renderBody(sec.body, W.exampleLabel)}</>,
  }));
}

export default function InstructionsModal({ lang, onClose }) {
  const W = useMemo(() => getInstructionWizardStrings(lang), [lang]);
  const INSTR_SECTIONS = useMemo(() => buildSections(W), [W]);
  const [active, setActive] = useState(0);
  const [animKey, setAnimKey] = useState(0);
  const [dir, setDir] = useState(1);
  const contentRef = useRef(null);
  const s = INSTR_SECTIONS[active];

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [active]);

  const goTo = (idx) => {
    if (idx === active) return;
    setDir(idx > active ? 1 : -1);
    setAnimKey((k) => k + 1);
    setActive(idx);
  };

  const Content = s.content;

  return (
    <div
      className="instr-modal-overlay"
      style={{ position: 'fixed', inset: 0, zIndex: 12000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <style>{`
          @keyframes instrSlideR { from { opacity:0; transform:translateX(16px); } to { opacity:1; transform:translateX(0); } }
          @keyframes instrSlideL { from { opacity:0; transform:translateX(-16px); } to { opacity:1; transform:translateX(0); } }
          @keyframes instrFadeIn { from { opacity:0; transform:scale(0.97) translateY(10px); } to { opacity:1; transform:scale(1) translateY(0); } }
          .instr-modal-overlay {
            background:
              radial-gradient(circle at 16% 10%, rgba(37, 99, 235, 0.32), transparent 34%),
              radial-gradient(circle at 84% 16%, rgba(168, 85, 247, 0.36), transparent 36%),
              radial-gradient(circle at 50% 86%, rgba(14, 165, 233, 0.2), transparent 38%),
              rgba(5, 4, 18, 0.84) !important;
            backdrop-filter: blur(16px) saturate(130%) !important;
          }
          .instr-modal-shell {
            position: relative;
            isolation: isolate;
            max-width: 860px !important;
            background:
              linear-gradient(145deg, rgba(18, 14, 54, 0.92), rgba(13, 10, 37, 0.88) 48%, rgba(8, 8, 26, 0.95)),
              rgba(10, 8, 30, 0.92) !important;
            border: 1px solid rgba(123, 92, 255, 0.58) !important;
            border-radius: 24px !important;
            box-shadow:
              0 34px 120px rgba(0, 0, 0, 0.78),
              0 0 82px rgba(80, 70, 255, 0.27),
              inset 0 0 0 1px rgba(255, 255, 255, 0.05) !important;
          }
          .instr-modal-shell::before {
            content: "";
            position: absolute;
            inset: 0;
            z-index: 0;
            pointer-events: none;
            background:
              radial-gradient(circle at 22% 4%, rgba(45, 212, 191, 0.26), transparent 20%),
              radial-gradient(circle at 92% 0%, rgba(168, 85, 247, 0.34), transparent 24%),
              linear-gradient(90deg, rgba(34, 211, 238, 0.08), transparent 25%, rgba(168, 85, 247, 0.12));
          }
          .instr-modal-shell > * {
            position: relative;
            z-index: 1;
          }
          .instr-modal-header {
            background: linear-gradient(180deg, rgba(35, 22, 86, 0.72), rgba(17, 12, 48, 0.36)) !important;
            border-bottom: 1px solid rgba(121, 98, 255, 0.28) !important;
            padding: 16px 20px !important;
          }
          .instr-close {
            width: 34px !important;
            height: 34px !important;
            border-radius: 12px !important;
            background: rgba(255, 255, 255, 0.06) !important;
            border: 1px solid rgba(255, 255, 255, 0.16) !important;
            color: rgba(255, 255, 255, 0.72) !important;
            box-shadow: inset 0 0 18px rgba(139, 92, 246, 0.12) !important;
          }
          .instr-close:hover { background: rgba(248,113,113,0.13) !important; border-color: rgba(248,113,113,0.78) !important; color: #fecaca !important; }
          .instr-modal-body {
            background:
              radial-gradient(circle at 78% 18%, rgba(168, 85, 247, 0.14), transparent 34%),
              radial-gradient(circle at 34% 12%, rgba(14, 165, 233, 0.12), transparent 32%) !important;
          }
          .instr-nav {
            width: 190px !important;
            background: linear-gradient(180deg, rgba(18, 12, 54, 0.5), rgba(9, 8, 30, 0.32)) !important;
            border-right: 1px solid rgba(111, 92, 255, 0.24) !important;
            padding: 10px 0 !important;
          }
          .instr-nav-btn {
            margin: 2px 0;
            color: rgba(235, 230, 255, 0.64);
            border-left: 2px solid transparent !important;
          }
          .instr-nav-btn:hover { background: rgba(99, 102, 241, 0.1) !important; }
          .instr-nav-btn-active {
            background: linear-gradient(90deg, rgba(59, 130, 246, 0.2), rgba(168, 85, 247, 0.08)) !important;
            border-left-color: currentColor !important;
            box-shadow: inset 10px 0 22px rgba(34, 211, 238, 0.08) !important;
          }
          .instr-content {
            background: rgba(8, 7, 28, 0.18) !important;
          }
          .instr-content-icon,
          .instr-list-icon {
            box-shadow: 0 0 22px currentColor, inset 0 0 18px rgba(255,255,255,0.08) !important;
          }
          .instr-card,
          .instr-example,
          .instr-codeblock {
            position: relative;
            overflow: hidden;
            background: linear-gradient(135deg, rgba(23, 17, 68, 0.74), rgba(25, 10, 58, 0.58)) !important;
            border: 1px solid rgba(90, 118, 255, 0.32) !important;
            border-radius: 14px !important;
            box-shadow: inset 0 0 22px rgba(59, 130, 246, 0.08), 0 10px 24px rgba(0, 0, 0, 0.18) !important;
          }
          .instr-card::before,
          .instr-example::before,
          .instr-codeblock::before {
            content: "";
            position: absolute;
            inset: 0 auto auto 0;
            width: 54%;
            height: 1px;
            background: linear-gradient(90deg, rgba(34, 211, 238, 0.9), transparent);
            opacity: 0.75;
          }
          .instr-inline-code {
            background: rgba(34, 211, 238, 0.12) !important;
            border: 1px solid rgba(34, 211, 238, 0.25);
            color: #67e8f9 !important;
          }
          .instr-scroll::-webkit-scrollbar { width: 5px; }
          .instr-scroll::-webkit-scrollbar-track { background: transparent; }
          .instr-scroll::-webkit-scrollbar-thumb { background: rgba(123,92,255,0.38); border-radius: 3px; }
          .instr-footer {
            background: linear-gradient(180deg, rgba(11, 8, 33, 0.34), rgba(5, 4, 18, 0.66)) !important;
            border-top: 1px solid rgba(121, 98, 255, 0.3) !important;
          }
          .instr-footer-btn {
            border-radius: 10px !important;
            background: rgba(72, 48, 170, 0.28) !important;
            border: 1px solid rgba(99, 102, 241, 0.36) !important;
            box-shadow: inset 0 0 18px rgba(99, 102, 241, 0.1) !important;
          }
          .instr-footer-btn-primary {
            box-shadow: 0 0 24px rgba(34, 211, 238, 0.2), inset 0 0 18px rgba(255,255,255,0.06) !important;
          }
          .instr-footer-btn:hover { opacity: 0.92; transform: translateY(-1px); }
          @media (max-width: 640px) {
            .instr-modal-overlay { padding: 8px !important; align-items: stretch !important; }
            .instr-modal-shell { height: calc(100dvh - 16px) !important; max-height: calc(100dvh - 16px) !important; border-radius: 18px !important; }
            .instr-modal-header { padding: 12px 14px !important; }
            .instr-modal-body { flex-direction: column !important; overflow: hidden !important; }
            .instr-nav { width: 100% !important; max-height: none !important; border-right: 0 !important; border-bottom: 1px solid rgba(111,92,255,0.24) !important; display: grid !important; grid-template-columns: repeat(4, minmax(0, 1fr)) !important; gap: 6px !important; padding: 10px !important; overflow: visible !important; }
            .instr-nav-btn { min-height: 54px !important; flex-direction: column !important; justify-content: center !important; gap: 4px !important; padding: 8px 4px !important; border-radius: 10px !important; text-align: center !important; }
            .instr-nav-btn > span:first-of-type { font-size: 18px !important; line-height: 1 !important; }
            .instr-nav-btn > span:last-of-type { font-size: 10.5px !important; line-height: 1.15 !important; max-width: 100%; overflow-wrap: anywhere; }
            .instr-nav-active-bar { left: 8px !important; right: 8px !important; top: auto !important; bottom: 0 !important; width: auto !important; height: 2px !important; border-radius: 2px 2px 0 0 !important; }
            .instr-progress-dots { display: none !important; }
            .instr-content { width: 100% !important; flex: 1 1 auto !important; padding: 18px 16px 20px !important; }
            .instr-content-heading { gap: 12px !important; margin-bottom: 14px !important; }
            .instr-content-icon { width: 44px !important; height: 44px !important; border-radius: 11px !important; }
            .instr-footer { padding: 10px 14px !important; }
          }
        `}</style>

      <div
        className="instr-modal-shell"
        style={{ width: '100%', maxWidth: 820, maxHeight: '88vh', display: 'flex', flexDirection: 'column', background: '#12131a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, overflow: 'hidden', boxShadow: '0 40px 100px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.03)', animation: 'instrFadeIn 0.25s cubic-bezier(0.34,1.3,0.64,1) forwards' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ height: 2, background: `linear-gradient(to right, transparent, ${s.color}, transparent)`, transition: 'background 0.35s', flexShrink: 0 }} />

        <div className="instr-modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.15)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 9, height: 9, borderRadius: 3, background: '#f97316', boxShadow: '0 0 8px rgba(249,115,22,0.7)', flexShrink: 0 }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(232,234,240,0.9)', fontFamily: 'system-ui' }}>
              {W.headerPrefix}{' '}
              <span style={{ color: s.color, transition: 'color 0.3s' }}>Cicada Studio</span>
            </span>
          </div>
          <button
            type="button"
            className="instr-close"
            onClick={onClose}
            style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(232,234,240,0.4)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, transition: 'all 0.15s', fontFamily: 'system-ui' }}
          >✕</button>
        </div>

        <div className="instr-modal-body" style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
          <div className="instr-nav" style={{ width: 170, flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column', padding: '6px 0', overflowY: 'auto' }}>
            {INSTR_SECTIONS.map((sec, idx) => {
              const isAct = active === idx;
              return (
                <button
                  key={sec.id}
                  type="button"
                  className={`instr-nav-btn ${isAct ? 'instr-nav-btn-active' : ''}`}
                  onClick={() => goTo(idx)}
                  style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', background: isAct ? 'rgba(255,255,255,0.05)' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', transition: 'background 0.15s', width: '100%' }}
                >
                  {isAct && <div className="instr-nav-active-bar" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: sec.color, boxShadow: `0 0 8px ${sec.color}`, borderRadius: '0 2px 2px 0' }} />}
                  <span style={{ fontSize: 16 }}>{sec.emoji}</span>
                  <span style={{ fontSize: 12, fontWeight: isAct ? 700 : 500, color: isAct ? 'rgba(232,234,240,0.95)' : 'rgba(232,234,240,0.38)', lineHeight: 1.3, transition: 'color 0.15s', fontFamily: 'system-ui' }}>{sec.label}</span>
                </button>
              );
            })}
            <div className="instr-progress-dots" style={{ marginTop: 'auto', padding: '12px 0', display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
              {INSTR_SECTIONS.map((sec, idx) => (
                <div key={sec.id} role="presentation" onClick={() => goTo(idx)} style={{ width: idx === active ? 14 : 5, height: 5, borderRadius: 3, background: idx === active ? s.color : 'rgba(255,255,255,0.1)', cursor: 'pointer', transition: 'all 0.25s', boxShadow: idx === active ? `0 0 7px ${s.color}` : 'none' }} />
              ))}
            </div>
          </div>

          <div ref={contentRef} className="instr-scroll instr-content" style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
            <div key={animKey} style={{ animation: `${dir > 0 ? 'instrSlideR' : 'instrSlideL'} 0.2s ease forwards` }}>
              <div className="instr-content-heading" style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 18 }}>
                <div className="instr-content-icon" style={{ width: 50, height: 50, borderRadius: 12, flexShrink: 0, background: s.glow, border: `1.5px solid ${s.color}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: `0 0 18px ${s.glow}` }}>{s.emoji}</div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: s.color, textShadow: `0 0 12px ${s.glow}`, transition: 'color 0.3s', fontFamily: 'system-ui' }}>{s.title}</h2>
                  <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'rgba(232,234,240,0.45)', lineHeight: 1.5, fontFamily: 'system-ui' }}>{s.subtitle}</p>
                </div>
              </div>
              <div style={{ height: 1, background: `linear-gradient(to right, ${s.color}50, transparent)`, marginBottom: 18 }} />
              <Content />
            </div>
          </div>
        </div>

        <div className="instr-footer" style={{ flexShrink: 0, padding: '10px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button
            type="button"
            className="instr-footer-btn"
            onClick={() => goTo(Math.max(0, active - 1))}
            disabled={active === 0}
            style={{ padding: '6px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: active === 0 ? 'not-allowed' : 'pointer', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: active === 0 ? 'rgba(232,234,240,0.2)' : 'rgba(232,234,240,0.65)', transition: 'all 0.15s', fontFamily: 'system-ui' }}
          >{W.back}</button>
          <span style={{ fontSize: 11, color: 'rgba(232,234,240,0.3)', fontFamily: 'monospace' }}>{active + 1} / {INSTR_SECTIONS.length}</span>
          <button
            type="button"
            className="instr-footer-btn instr-footer-btn-primary"
            onClick={() => { if (active === INSTR_SECTIONS.length - 1) onClose(); else goTo(active + 1); }}
            style={{ padding: '6px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: active === INSTR_SECTIONS.length - 1 ? s.color + '20' : 'rgba(255,255,255,0.05)', border: `1px solid ${active === INSTR_SECTIONS.length - 1 ? s.color + '60' : 'rgba(255,255,255,0.1)'}`, color: active === INSTR_SECTIONS.length - 1 ? s.color : 'rgba(232,234,240,0.7)', transition: 'all 0.15s', fontFamily: 'system-ui' }}
          >{active === INSTR_SECTIONS.length - 1 ? W.done : W.next}</button>
        </div>
      </div>
    </div>
  );
}
