import React from 'react';
import { Handle, Position } from 'reactflow';

// Port type system for puzzle-piece connections
// flow: основной поток команд (start → message → buttons...)
// condition_branch: ветки условий (condition 'да' → actions)
// settings: настройки бота (version, bot, commands, global)
// scenario_flow: сценарии (scenario → step → step)
// lone: не соединяются вообще

const PORT_TYPES = {
  // Settings - no connections
  version:   { input: null, output: null },
  bot:       { input: null, output: null },
  commands:  { input: null, output: null },
  global:    { input: null, output: null },

  // Main flow blocks
  start:     { input: 'flow', output: 'flow' },
  message:   { input: 'flow', output: 'flow' },
  buttons:   { input: 'flow', output: 'flow' },
  command:   { input: null, output: 'flow' },
  callback:  { input: null, output: 'flow' },
  block:     { input: null, output: 'flow' },
  use:       { input: 'flow', output: 'flow' },
  middleware:{ input: null, output: 'flow' },

  // Logic - flow with condition branches
  condition: { input: 'flow', output: 'flow', branches: ['condition_branch'] },
  switch:    { input: 'flow', output: 'flow', branches: ['condition_branch'] },
  ask:       { input: 'flow', output: 'flow' },
  remember:  { input: 'flow', output: 'flow' },
  get:       { input: 'flow', output: 'flow' },
  save:      { input: 'flow', output: 'flow' },
  random:    { input: 'flow', output: 'flow' },
  loop:      { input: 'flow', output: 'flow', branches: ['condition_branch'] },

  // Actions - flow
  photo:     { input: 'flow', output: 'flow' },
  video:     { input: 'flow', output: 'flow' },
  audio:     { input: 'flow', output: 'flow' },
  document:  { input: 'flow', output: 'flow' },
  sticker:   { input: 'flow', output: 'flow' },
  delay:     { input: 'flow', output: 'flow' },
  typing:    { input: 'flow', output: 'flow' },
  http:      { input: 'flow', output: 'flow' },
  database:  { input: 'flow', output: 'flow' },
  classify:  { input: 'flow', output: 'flow' },
  log:       { input: 'flow', output: 'flow' },
  role:      { input: 'flow', output: 'flow' },
  payment:   { input: 'flow', output: 'flow' },
  analytics: { input: 'flow', output: 'flow' },
  notify:    { input: 'flow', output: 'flow' },
  menu:      { input: 'flow', output: 'flow' },
  inline:    { input: 'flow', output: 'flow' },

  // Flow control
  goto:      { input: 'flow', output: null },
  stop:      { input: 'flow', output: null },

  // Scenario system
  scenario:  { input: null, output: 'scenario_flow' },
  step:      { input: 'scenario_flow', output: 'scenario_flow' },
};

function getPortType(type) {
  return PORT_TYPES[type] || { input: 'flow', output: 'flow' };
}

const COLORS = {
  version:   '#6b7280',
  bot:       '#3ecf8e',
  commands:  '#fbbf24',
  global:    '#10b981',
  block:     '#8b5cf6',
  use:       '#a78bfa',
  middleware:'#64748b',
  start:     '#3ecf8e',
  message:   '#5b7cf6',
  buttons:   '#a78bfa',
  command:   '#fbbf24',
  condition: '#fb923c',
  ask:       '#f87171',
  remember:  '#94a3b8',
  get:       '#0ea5e9',
  save:      '#059669',
  scenario:  '#34d399',
  callback:  '#60a5fa',
  loop:      '#f59e0b',
  menu:      '#8b5cf6',
  notify:    '#06b6d4',
  database:  '#10b981',
  classify:  '#ec4899',
  log:       '#6b7280',
  role:      '#dc2626',
  payment:   '#16a34a',
  analytics: '#0284c7',
  random:    '#c084fc',
  switch:    '#f59e0b',
  photo:     '#34d399',
  video:     '#2dd4bf',
  audio:     '#818cf8',
  document:  '#94a3b8',
  sticker:   '#f472b6',
  delay:     '#64748b',
  typing:    '#475569',
  http:      '#0ea5e9',
  goto:      '#a3a3a3',
  stop:      '#ef4444',
  step:      '#059669',
  inline:    '#7c3aed',
};

const ICONS = {
  version:'📌', bot:'🤖', commands:'📋', global:'🌍', block:'🧱', use:'⚡', middleware:'⚙',
  start:'▶', message:'✉', buttons:'⊞', command:'/', condition:'◇',
  ask:'?', remember:'♦', get:'📥', save:'💾', scenario:'↺', callback:'⊙',
  loop:'↻', menu:'≡', notify:'🔔', database:'🗄', classify:'🧠',
  log:'📋', role:'🔐', payment:'💳', analytics:'📊',
  random:'⚄', switch:'⇄', photo:'🖼', video:'▷', audio:'♪',
  document:'📄', sticker:'◉', delay:'⏱', typing:'…', http:'↗',
  goto:'→', stop:'■', step:'»', inline:'▦',
};

// shape: 'hat' | 'cap' | 'middle' | 'end' | 'lone'
const SHAPES = {
  start:     'hat',
  command:   'cap',
  callback:  'cap',
  scenario:  'cap',
  block:     'cap',
  middleware:'cap',
  stop:      'end',
  goto:      'end',
  version:   'lone',
  bot:       'lone',
  commands:  'lone',
  global:    'lone',
};
function getShape(t) { return SHAPES[t] || 'middle'; }

// Build SVG path for puzzle block
// w/h = block width/height
// Tab params: TW=tab protrusion, TH=tab height, TY=tab Y start
function buildPath(w, h, shape) {
  const R  = 5;   // corner radius
  const TW = 11;  // tab protrusion
  const TH = 9;   // tab height
  const TY = 12;  // tab Y from top
  const TX = 22;  // tab X from left (for top socket on cap/hat)

  // Helper: cubic bump going outward (right) at Y position
  const rightTab = (y) =>
    `L ${w} ${y} C ${w+TW} ${y} ${w+TW} ${y+TH} ${w} ${y+TH}`;

  // Helper: cubic socket going inward (left side)
  const leftSocket = (y) =>
    `L 0 ${y+TH} C ${-TW} ${y+TH} ${-TW} ${y} 0 ${y}`;

  // Helper: top socket (indented bump on top edge) for cap blocks
  const topSocket = () =>
    `L ${TX} 0 C ${TX} ${-TH} ${TX+TW} ${-TH} ${TX+TW} 0`;

  let d = '';

  if (shape === 'hat') {
    // Arch top, tab on right
    d = [
      `M ${R} 0`,
      `Q ${w*0.5} ${-18} ${w-R} 0`,
      `Q ${w} 0 ${w} ${R}`,
      rightTab(TY),
      `L ${w} ${h-R} Q ${w} ${h} ${w-R} ${h}`,
      `L ${R} ${h} Q 0 ${h} 0 ${h-R}`,
      `L 0 ${R} Q 0 0 ${R} 0`,
      'Z',
    ].join(' ');

  } else if (shape === 'cap') {
    // Flat top with socket notch on top edge, tab on right
    d = [
      `M ${R} 0`,
      topSocket(),
      `L ${w-R} 0 Q ${w} 0 ${w} ${R}`,
      rightTab(TY + 8),
      `L ${w} ${h-R} Q ${w} ${h} ${w-R} ${h}`,
      `L ${R} ${h} Q 0 ${h} 0 ${h-R}`,
      `L 0 ${R} Q 0 0 ${R} 0`,
      'Z',
    ].join(' ');

  } else if (shape === 'end') {
    // Socket on left, rounded bottom, no right tab
    d = [
      `M ${R} 0`,
      `L ${w-R} 0 Q ${w} 0 ${w} ${R}`,
      `L ${w} ${h-R} Q ${w} ${h} ${w-R} ${h}`,
      `L ${R} ${h} Q 0 ${h} 0 ${h-R}`,
      leftSocket(TY),
      `L 0 ${R} Q 0 0 ${R} 0`,
      'Z',
    ].join(' ');

  } else if (shape === 'lone') {
    // Simple rounded rect
    d = [
      `M ${R} 0 L ${w-R} 0 Q ${w} 0 ${w} ${R}`,
      `L ${w} ${h-R} Q ${w} ${h} ${w-R} ${h}`,
      `L ${R} ${h} Q 0 ${h} 0 ${h-R}`,
      `L 0 ${R} Q 0 0 ${R} 0 Z`,
    ].join(' ');

  } else {
    // middle: socket left, tab right
    d = [
      `M ${R} 0 L ${w-R} 0 Q ${w} 0 ${w} ${R}`,
      rightTab(TY),
      `L ${w} ${h-R} Q ${w} ${h} ${w-R} ${h}`,
      `L ${R} ${h} Q 0 ${h} 0 ${h-R}`,
      leftSocket(TY),
      `L 0 ${R} Q 0 0 ${R} 0 Z`,
    ].join(' ');
  }

  return d;
}

function darken(hex, amount = 30) {
  const num = parseInt(hex.replace('#',''), 16);
  const r = Math.max(0, (num >> 16) - amount);
  const g = Math.max(0, ((num >> 8) & 0xff) - amount);
  const b = Math.max(0, (num & 0xff) - amount);
  return `rgb(${r},${g},${b})`;
}

function preview(data) {
  const p = data.props || {};
  switch(data.type) {
    case 'version':   return p.version || '1.0';
    case 'bot':       return p.token?.slice(0,22) || 'TOKEN';
    case 'commands':  return (p.commands||'').split('\n')[0]?.slice(0,26) || '';
    case 'global':    return `${p.varname||''} = ${p.value||''}`;
    case 'block':     return p.name || '';
    case 'use':       return p.blockname || '';
    case 'middleware':return p.type === 'before' ? 'до каждого' : 'после каждого';
    case 'message':   return p.text?.slice(0,26) || '';
    case 'buttons':   return (p.rows||'').split('\n')[0]?.slice(0,26) || '';
    case 'command':   return '/' + (p.cmd||'');
    case 'condition': return p.cond?.slice(0,26) || '';
    case 'ask':       return p.question?.slice(0,22) || '';
    case 'remember':  return `${p.varname||''} = ${p.value||''}`;
    case 'get':       return `"${p.key||''}" → ${p.varname||''}`;
    case 'save':      return `"${p.key||''}" = ${p.value||''}`;
    case 'scenario':  return p.name || '';
    case 'callback':  return p.label || '';
    case 'loop':      return p.mode === 'while' ? `пока ${p.cond||''}` : `×${p.count||'3'}`;
    case 'menu':      return p.title || '';
    case 'notify':    return p.text?.slice(0,22) || '';
    case 'database':  return p.query?.slice(0,22) || '';
    case 'classify':  return `→ ${p.varname||'намерение'}`;
    case 'log':       return `[${p.level||'info'}] ${p.message?.slice(0,16)||''}`;
    case 'role':      return p.varname || '';
    case 'payment':   return `${p.provider||'stripe'} ${p.amount||''} ${p.currency||'USD'}`;
    case 'analytics': return p.event || '';
    default:          return '';
  }
}

export default function CicadaNode({ data, selected }) {
  const color = COLORS[data.type] || '#5b7cf6';
  const icon  = ICONS[data.type]  || '◆';
  const prev  = preview(data);
  const shape = getShape(data.type);
  const portType = getPortType(data.type);

  const W = 152;
  const HEADER_H = 28;
  const BODY_H   = prev ? 16 : 0;
  const H = HEADER_H + BODY_H + 6;

  const path   = buildPath(W, H, shape);
  const dark   = darken(color, 35);
  const snapHint = data.snapHint || null;

  // handle visibility based on port types
  const hasInput = portType.input !== null;
  const hasOutput = portType.output !== null;

  const hStyle = {
    background: 'transparent',
    border: 'none',
    width: 12,
    height: 12,
    opacity: 0,
  };

  return (
    <div style={{ position: 'relative', width: W, height: H, margin: '0 14px' }}>
      {/* SVG puzzle shape */}
      <svg
        width={W + 30}
        height={H + 30}
        viewBox={`-14 -12 ${W+28} ${H+28}`}
        style={{
          position: 'absolute',
          top: 0, left: 0,
          overflow: 'visible',
          pointerEvents: 'none',
          filter: selected
            ? `drop-shadow(0 0 5px ${color}bb) drop-shadow(0 3px 10px rgba(0,0,0,.6))`
            : 'drop-shadow(0 3px 8px rgba(0,0,0,.55))',
        }}
      >
        {/* Shadow layer */}
        <path d={path} fill="rgba(0,0,0,0.4)" transform="translate(0,3)" />
        {/* Base color */}
        <path d={path} fill={color} />
        {/* Header stripe (darker) */}
        <clipPath id={`hc-${data.type}-${selected}`}>
          <rect x={0} y={0} width={W} height={HEADER_H} />
        </clipPath>
        <path d={path} fill={dark} clipPath={`url(#hc-${data.type}-${selected})`} />
        {/* Top highlight */}
        <path d={path} fill="rgba(255,255,255,0.13)" clipPath={`url(#hc-${data.type}-${selected})`} />
        {/* Body highlight */}
        <clipPath id={`bc-${data.type}-${selected}`}>
          <rect x={0} y={HEADER_H} width={W} height={BODY_H + 6} />
        </clipPath>
        <path d={path} fill="rgba(255,255,255,0.06)" clipPath={`url(#bc-${data.type}-${selected})`} />
        {/* Bevel border */}
        <path d={path} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.2" />
        {/* Bottom shadow line */}
        <path d={path} fill="none" stroke="rgba(0,0,0,0.3)" strokeWidth="1" transform="translate(0,1.5)" />
        {/* Selection ring */}
        {selected && <path d={path} fill="none" stroke="white" strokeWidth="2" opacity="0.7" />}
        {/* Snap compatibility ring */}
        {snapHint === 'ok' && <path d={path} fill="none" stroke="#3ecf8e" strokeWidth="2.2" opacity="0.95" />}
        {snapHint === 'bad' && <path d={path} fill="none" stroke="#f87171" strokeWidth="2.2" opacity="0.95" />}
      </svg>

      {/* Typed ReactFlow handles - id represents the port type for validation */}
      {hasInput && (
        <Handle
          type="target"
          position={Position.Left}
          id={portType.input}
          style={{ ...hStyle, top: 21, left: -2 }}
        />
      )}
      {hasOutput && (
        <Handle
          type="source"
          position={Position.Right}
          id={portType.output}
          style={{ ...hStyle, top: 21, right: -2 }}
        />
      )}

      {/* Content layer */}
      <div style={{ position: 'relative', zIndex: 2 }}>
        {/* Icon + Label header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          height: HEADER_H, padding: '0 9px',
        }}>
          <span style={{ fontSize: 12, lineHeight: 1, flexShrink: 0, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.5))' }}>
            {icon}
          </span>
          <span style={{
            fontSize: 10, fontWeight: 700,
            color: '#fff',
            fontFamily: 'var(--sans, system-ui)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            textShadow: '0 1px 3px rgba(0,0,0,.6)',
            letterSpacing: '0.01em',
          }}>
            {data.label}
          </span>
        </div>

        {/* Preview text */}
        {prev && (
          <div style={{
            padding: '0 9px 4px',
            fontSize: 8.5,
            color: 'rgba(255,255,255,0.82)',
            fontFamily: 'var(--mono, monospace)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            textShadow: '0 1px 2px rgba(0,0,0,.5)',
          }}>
            {prev}
          </div>
        )}
      </div>
    </div>
  );
}
