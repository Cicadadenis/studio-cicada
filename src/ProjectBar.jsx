import React, { useMemo, useRef, useState } from 'react';

export default function ProjectBar({
  project, setProject, onNewProject, onExample, onImportCCD, onSavePalette, onResetPalette,
  onSaveProject, onLoadProject, savedProjectNames = [],
}) {
  const [editName, setEditName] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState('');
  const fileInputRef = useRef(null);
  const hasSlots = useMemo(() => savedProjectNames.length > 0, [savedProjectNames]);

  const triggerImport = () => fileInputRef.current?.click();
  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (file && onImportCCD) onImportCCD(file);
    e.target.value = '';
  };

  return (
    <div style={{
      display:'flex', alignItems:'center', gap:12, padding:'0 16px',
      background:'var(--bg2)', borderBottom:'1px solid var(--border)',
      height:44,
    }}>
      {/* Logo */}
      <div style={{ fontFamily:'var(--sans)', fontWeight:700, fontSize:15, color:'var(--text)', letterSpacing:-.3 }}>
        <span style={{ color:'#5b7cf6' }}>◈</span> cicada studio
      </div>

      <div style={{ width:1, height:20, background:'var(--border)', margin:'0 4px' }} />

      {/* Project name */}
      {editName
        ? <input autoFocus value={project.name} style={{ width:160, height:28, fontSize:12 }}
            onChange={e => setProject(p=>({...p, name:e.target.value}))}
            onBlur={() => setEditName(false)}
            onKeyDown={e => e.key==='Enter' && setEditName(false)} />
        : <span onClick={()=>setEditName(true)} style={{ fontSize:12, color:'var(--text)', cursor:'text', padding:'2px 6px', borderRadius:4, border:'1px solid transparent' }}
            onMouseEnter={e=>e.target.style.borderColor='var(--border2)'}
            onMouseLeave={e=>e.target.style.borderColor='transparent'}>
            {project.name}
          </span>
      }

      {/* Token */}
      <input
        type="password"
        placeholder="telegram token"
        value={project.token}
        onChange={e => setProject(p=>({...p, token:e.target.value}))}
        style={{ width:200, height:28, fontSize:11 }}
      />

      <div style={{ flex:1 }} />

      <button onClick={onExample} style={{ background:'transparent', color:'var(--text3)', padding:'4px 10px', border:'1px solid var(--border2)', borderRadius:6, cursor:'pointer', fontSize:12 }}
        onMouseEnter={e=>e.target.style.color='var(--text)'}
        onMouseLeave={e=>e.target.style.color='var(--text3)'}>пример</button>
      <button onClick={onNewProject} style={{ background:'transparent', color:'var(--text3)', padding:'4px 10px', border:'1px solid var(--border2)', borderRadius:6, cursor:'pointer', fontSize:12 }}
        onMouseEnter={e=>e.target.style.color='var(--text)'}
        onMouseLeave={e=>e.target.style.color='var(--text3)'}>новый проект</button>
      <button onClick={triggerImport} style={{ background:'transparent', color:'var(--text3)', padding:'4px 10px', border:'1px solid var(--border2)', borderRadius:6, cursor:'pointer', fontSize:12 }}
        onMouseEnter={e=>e.target.style.color='var(--text)'}
        onMouseLeave={e=>e.target.style.color='var(--text3)'}>импорт .ccd</button>
      <button onClick={onSavePalette} style={{ background:'transparent', color:'var(--text3)', padding:'4px 10px', border:'1px solid var(--border2)', borderRadius:6, cursor:'pointer', fontSize:12 }}
        onMouseEnter={e=>e.target.style.color='var(--text)'}
        onMouseLeave={e=>e.target.style.color='var(--text3)'}>сохранить блоки</button>
      <button onClick={onSaveProject} style={{ background:'transparent', color:'var(--text3)', padding:'4px 10px', border:'1px solid var(--border2)', borderRadius:6, cursor:'pointer', fontSize:12 }}
        onMouseEnter={e=>e.target.style.color='var(--text)'}
        onMouseLeave={e=>e.target.style.color='var(--text3)'}>сохранить проект</button>
      <select
        value={selectedSlot}
        onChange={(e) => setSelectedSlot(e.target.value)}
        style={{ width: 170, height: 28, fontSize: 11 }}
      >
        <option value="">слоты проекта</option>
        {savedProjectNames.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <button
        disabled={!hasSlots || !selectedSlot}
        onClick={() => onLoadProject?.(selectedSlot)}
        style={{
          background:'transparent',
          color: (!hasSlots || !selectedSlot) ? 'var(--text3)' : 'var(--text3)',
          padding:'4px 10px',
          border:'1px solid var(--border2)',
          borderRadius:6,
          cursor: (!hasSlots || !selectedSlot) ? 'not-allowed' : 'pointer',
          fontSize:12,
          opacity: (!hasSlots || !selectedSlot) ? 0.55 : 1,
        }}
      >загрузить проект</button>
      <button onClick={onResetPalette} style={{ background:'transparent', color:'var(--text3)', padding:'4px 10px', border:'1px solid var(--border2)', borderRadius:6, cursor:'pointer', fontSize:12 }}
        onMouseEnter={e=>e.target.style.color='var(--text)'}
        onMouseLeave={e=>e.target.style.color='var(--text3)'}>сброс блоков</button>
      <input ref={fileInputRef} type="file" accept=".ccd,.txt" onChange={handleFile} style={{ display:'none' }} />
    </div>
  );
}
