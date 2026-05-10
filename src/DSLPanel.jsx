import React, { useMemo, useState } from 'react';
import {
  generateDSLFromFlow,
  validateFlow,
  SCHEMA_VERSIONS_FOR_UI,
  buildProjectManifestDraft,
  buildProjectGraphDocumentFromFlow,
} from './dslCodegen.js';

export {
  generateDSLFromFlow,
  validateFlow,
  nodeDSL,
  emitBlock,
  generateDSLFromStacks,
  stackToDSL,
  SCHEMA_VERSIONS_FOR_UI,
  inferRequiredFeaturesFromFlow,
  inferRequiredFeaturesFromStacks,
  buildProjectManifestDraft,
  buildProjectManifestDraftFromStacks,
  buildProjectGraphDocumentFromFlow,
  buildProjectGraphDocumentFromStacks,
} from './dslCodegen.js';

export default function DSLPanel({ flow, token, schemaVersions }) {
  const sv = schemaVersions || SCHEMA_VERSIONS_FOR_UI;
  const [checkResult, setCheckResult] = useState(null);
  const [checking, setChecking] = useState(false);
  const dsl = useMemo(() => generateDSLFromFlow(flow, token), [flow, token]);
  const manifestDraft = useMemo(() => buildProjectManifestDraft(flow, sv), [flow, sv]);
  const graphDocDraft = useMemo(
    () => buildProjectGraphDocumentFromFlow(flow, { schemaVersions: sv }),
    [flow, sv],
  );

  const copy = () => navigator.clipboard?.writeText(dsl);
  const copyManifest = () =>
    navigator.clipboard?.writeText(JSON.stringify(manifestDraft, null, 2));
  const copyGraphDoc = () =>
    navigator.clipboard?.writeText(JSON.stringify(graphDocDraft, null, 2));
  const download = () => {
    const blob = new Blob([dsl], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bot.ccd';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCheck = () => {
    setChecking(true);
    setTimeout(() => {
      const result = validateFlow(flow);
      setCheckResult(result);
      setChecking(false);
    }, 80);
  };

  const allGood = checkResult && checkResult.errors.length === 0 && checkResult.warnings.length === 0;
  const hasErrors = checkResult && checkResult.errors.length > 0;

  const checkBtnColor = checkResult
    ? (allGood ? '#3ecf8e' : hasErrors ? '#f87171' : '#fbbf24')
    : '#fbbf24';
  const checkBtnBorder = checkResult
    ? (allGood ? '#3ecf8e55' : hasErrors ? '#f8717155' : '#fbbf2455')
    : '#fbbf2455';

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:0, flex:1 }}>
      <div style={{ padding:'6px 10px', display:'flex', alignItems:'center', justifyContent:'flex-end', borderBottom:'1px solid var(--border)', gap:4, flexWrap:'wrap' }}>
        <div style={{ display:'flex', gap:5 }}>
          <button
            onClick={handleCheck}
            disabled={checking}
            style={{
              background: 'transparent',
              color: checkBtnColor,
              padding: '2px 8px',
              border: `1px solid ${checkBtnBorder}`,
              borderRadius: 4,
              fontSize: 10,
              cursor: checking ? 'default' : 'pointer',
              transition: 'color 0.2s, border-color 0.2s',
              opacity: checking ? 0.6 : 1,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = checkBtnColor + '18'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            {checking ? '…' : checkResult ? (allGood ? '✓ ок' : hasErrors ? '✕ ошибки' : '⚠ проверен') : '✓ проверить'}
          </button>
          <button
            onClick={copy}
            style={{ background:'transparent', color:'var(--text3)', padding:'2px 8px', border:'1px solid var(--border2)', borderRadius:4, fontSize:10, cursor:'pointer' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text3)'; }}
          >copy</button>
          <button
            onClick={download}
            style={{ background:'var(--accent)', color:'#fff', padding:'2px 8px', border:'none', borderRadius:4, fontSize:10, cursor:'pointer' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent2)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent)'; }}
          >↓ .ccd</button>
        </div>
      </div>

      <div
        style={{
          padding: '5px 10px',
          borderBottom: '1px solid var(--border)',
          fontSize: 9,
          lineHeight: 1.6,
          color: 'var(--text3)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
        }}
        title={`Манифест: format v${manifestDraft.projectFormatVersion} · фичи: ${manifestDraft.requiredFeatures.join(', ') || '—'}\nПолный документ: ${graphDocDraft.documentType} schema ${graphDocDraft.schemaVersion}\nКонтракт UI: IR·${sv.irSchemaVersion} AST·${sv.astSchemaVersion} graph·${sv.buildGraphFormatVersion}`}
      >
        <span>
          manifest·v{manifestDraft.projectFormatVersion} · graph·v{graphDocDraft.schemaVersion}
        </span>
        <span style={{ opacity: 0.85 }}>
          фичи·{manifestDraft.requiredFeatures.length}
        </span>
        <button
          type="button"
          onClick={copyGraphDoc}
          style={{
            background: 'transparent',
            color: 'var(--text3)',
            padding: '1px 6px',
            border: '1px solid var(--border2)',
            borderRadius: 4,
            fontSize: 9,
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text3)';
          }}
        >
          graph document
        </button>
        <button
          type="button"
          onClick={copyManifest}
          style={{
            background: 'transparent',
            color: 'var(--text3)',
            padding: '1px 6px',
            border: '1px solid var(--border2)',
            borderRadius: 4,
            fontSize: 9,
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text3)';
          }}
        >
          project manifest
        </button>
      </div>

      {checkResult && (
        <div style={{ padding:'7px 10px', borderBottom:'1px solid var(--border)', fontSize:10, lineHeight:1.7, position:'relative' }}>
          <span
            onClick={() => setCheckResult(null)}
            title="Закрыть"
            style={{ position:'absolute', top:5, right:8, cursor:'pointer', color:'var(--text3)', fontSize:12, lineHeight:1 }}
          >×</span>
          {allGood && <div style={{ color:'#3ecf8e' }}>✓ Ошибок не найдено!</div>}
          {checkResult.errors.map((e,i) => (
            <div key={i} style={{ color:'#f87171' }}>✕ {e}</div>
          ))}
          {checkResult.warnings.map((w,i) => (
            <div key={i} style={{ color:'#fbbf24' }}>⚠ {w}</div>
          ))}
        </div>
      )}

      <pre style={{
        flex:1, margin:0, padding:'8px 12px',
        fontSize:10, lineHeight:1.7,
        color:'var(--text2)', fontFamily:'var(--mono)',
        overflowY:'auto', whiteSpace:'pre-wrap', wordBreak:'break-word',
        background:'var(--bg)',
      }}>{dsl}</pre>
    </div>
  );
}
