import React from 'react';

export default function InfoPanelSuggestions({ selectedType, suggestions = [], onApplySuggestion }) {
  if (selectedType !== 'menu' && selectedType !== 'buttons' && selectedType !== 'inline') return null;
  return (
    <div style={{ marginTop: 10, padding: 10, border: '1px solid var(--border2)', borderRadius: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>⚡ События</div>
      {suggestions.length === 0 ? (
        <div style={{ fontSize: 12, opacity: 0.7 }}>Нет предложений</div>
      ) : suggestions.map((s) => (
        <button key={s.id} type="button" onClick={() => onApplySuggestion?.(s)} style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 6 }}>
          {s.title}
        </button>
      ))}
    </div>
  );
}
