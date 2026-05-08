import React, { useMemo, useState, useEffect, useRef } from 'react';
import { getInstructionWizardStrings } from './instructionsWizardI18n.js';

const pStyle = { fontSize: 13.5, lineHeight: 1.7, color: 'rgba(232,234,240,0.75)', margin: '0 0 12px 0' };

function ICode({ children }) {
  return (
    <code style={{ background: 'rgba(255,255,255,0.09)', padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace', fontSize: 12, color: '#3ecf8e' }}>{children}</code>
  );
}

function ICard({ icon, children }) {
  return (
    <div style={{ display: 'flex', gap: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '10px 14px', marginTop: 12 }}>
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
            <span style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>{item.icon}</span>
            <span style={{ fontSize: 13.5, color: 'rgba(232,234,240,0.85)' }}>{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function IExample({ steps, exampleLabel }) {
  return (
    <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
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
    <div style={{ background: '#0d0f16', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '12px 14px', marginBottom: 12, fontFamily: 'monospace', fontSize: 12.5, lineHeight: 2 }}>
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
      style={{ position: 'fixed', inset: 0, zIndex: 12000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <style>{`
          @keyframes instrSlideR { from { opacity:0; transform:translateX(16px); } to { opacity:1; transform:translateX(0); } }
          @keyframes instrSlideL { from { opacity:0; transform:translateX(-16px); } to { opacity:1; transform:translateX(0); } }
          @keyframes instrFadeIn { from { opacity:0; transform:scale(0.97) translateY(10px); } to { opacity:1; transform:scale(1) translateY(0); } }
          .instr-nav-btn:hover { background: rgba(255,255,255,0.04) !important; }
          .instr-close:hover { background: rgba(239,68,68,0.12) !important; border-color: #ef4444 !important; color: #ef4444 !important; }
          .instr-scroll::-webkit-scrollbar { width: 5px; }
          .instr-scroll::-webkit-scrollbar-track { background: transparent; }
          .instr-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
          .instr-footer-btn:hover { opacity: 0.85; }
        `}</style>

      <div
        style={{ width: '100%', maxWidth: 820, maxHeight: '88vh', display: 'flex', flexDirection: 'column', background: '#12131a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, overflow: 'hidden', boxShadow: '0 40px 100px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.03)', animation: 'instrFadeIn 0.25s cubic-bezier(0.34,1.3,0.64,1) forwards' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ height: 2, background: `linear-gradient(to right, transparent, ${s.color}, transparent)`, transition: 'background 0.35s', flexShrink: 0 }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.15)', flexShrink: 0 }}>
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

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
          <div style={{ width: 170, flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column', padding: '6px 0', overflowY: 'auto' }}>
            {INSTR_SECTIONS.map((sec, idx) => {
              const isAct = active === idx;
              return (
                <button
                  key={sec.id}
                  type="button"
                  className="instr-nav-btn"
                  onClick={() => goTo(idx)}
                  style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', background: isAct ? 'rgba(255,255,255,0.05)' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', transition: 'background 0.15s', width: '100%' }}
                >
                  {isAct && <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: sec.color, boxShadow: `0 0 8px ${sec.color}`, borderRadius: '0 2px 2px 0' }} />}
                  <span style={{ fontSize: 16 }}>{sec.emoji}</span>
                  <span style={{ fontSize: 12, fontWeight: isAct ? 700 : 500, color: isAct ? 'rgba(232,234,240,0.95)' : 'rgba(232,234,240,0.38)', lineHeight: 1.3, transition: 'color 0.15s', fontFamily: 'system-ui' }}>{sec.label}</span>
                </button>
              );
            })}
            <div style={{ marginTop: 'auto', padding: '12px 0', display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
              {INSTR_SECTIONS.map((sec, idx) => (
                <div key={sec.id} role="presentation" onClick={() => goTo(idx)} style={{ width: idx === active ? 14 : 5, height: 5, borderRadius: 3, background: idx === active ? s.color : 'rgba(255,255,255,0.1)', cursor: 'pointer', transition: 'all 0.25s', boxShadow: idx === active ? `0 0 7px ${s.color}` : 'none' }} />
              ))}
            </div>
          </div>

          <div ref={contentRef} className="instr-scroll" style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
            <div key={animKey} style={{ animation: `${dir > 0 ? 'instrSlideR' : 'instrSlideL'} 0.2s ease forwards` }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 18 }}>
                <div style={{ width: 50, height: 50, borderRadius: 12, flexShrink: 0, background: s.glow, border: `1.5px solid ${s.color}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: `0 0 18px ${s.glow}` }}>{s.emoji}</div>
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

        <div style={{ flexShrink: 0, padding: '10px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
            className="instr-footer-btn"
            onClick={() => { if (active === INSTR_SECTIONS.length - 1) onClose(); else goTo(active + 1); }}
            style={{ padding: '6px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: active === INSTR_SECTIONS.length - 1 ? s.color + '20' : 'rgba(255,255,255,0.05)', border: `1px solid ${active === INSTR_SECTIONS.length - 1 ? s.color + '60' : 'rgba(255,255,255,0.1)'}`, color: active === INSTR_SECTIONS.length - 1 ? s.color : 'rgba(232,234,240,0.7)', transition: 'all 0.15s', fontFamily: 'system-ui' }}
          >{active === INSTR_SECTIONS.length - 1 ? W.done : W.next}</button>
        </div>
      </div>
    </div>
  );
}
