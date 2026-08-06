import { useState, useRef, useEffect, useMemo } from 'react';

/**
 * A single-select dropdown with a search box at the top — drop-in replacement for
 * a long <select>. `options` is [{ value, label }]. Pass `allLabel` to include a
 * "clear" row that maps to '' (e.g. "All customers"). `dark` switches palette.
 */
export default function SearchableSelect({ value, onChange, options = [], placeholder = 'Select…', allLabel = null, dark = false, minWidth = 190 }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQ(''); } };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const selected = options.find(o => String(o.value) === String(value));
  const isEmpty = value === '' || value == null;
  const label = isEmpty ? (allLabel || placeholder) : (selected?.label || placeholder);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter(o => String(o.label || '').toLowerCase().includes(s)) : options;
  }, [options, q]);

  const c = dark
    ? { btnBg: '#1E293B', border: '#334155', text: '#E2E8F0', muted: '#94A3B8', panel: '#0F172A', hover: '#1E293B', sel: '#1D4ED8' }
    : { btnBg: '#fff', border: '#E2E8F0', text: '#0F172A', muted: '#64748B', panel: '#fff', hover: '#F1F5F9', sel: '#EEF4FF' };

  const pick = (v) => { onChange(v); setOpen(false); setQ(''); };

  return (
    <div ref={ref} style={{ position: 'relative', minWidth }}>
      <button type="button" onClick={() => setOpen(o => !o)} style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        border: `1px solid ${c.border}`, background: c.btnBg, color: (isEmpty && !allLabel) ? c.muted : c.text,
        cursor: 'pointer', borderRadius: 9, padding: '8px 12px', fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ color: c.muted, fontSize: 10 }}>▾</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '110%', left: 0, zIndex: 60, width: 'max(100%, 240px)', background: c.panel, border: `1px solid ${c.border}`, borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', overflow: 'hidden' }}>
          <div style={{ padding: 8, borderBottom: `1px solid ${c.border}` }}>
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" style={{
              width: '100%', boxSizing: 'border-box', border: `1px solid ${c.border}`, background: c.btnBg, color: c.text,
              borderRadius: 7, padding: '7px 10px', fontSize: 12.5, fontFamily: 'inherit', outline: 'none' }} />
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto', padding: 4 }}>
            {allLabel && <Opt onClick={() => pick('')} active={isEmpty} c={c}>{allLabel}</Opt>}
            {filtered.map(o => <Opt key={o.value} onClick={() => pick(o.value)} active={String(o.value) === String(value)} c={c}>{o.label}</Opt>)}
            {filtered.length === 0 && <div style={{ padding: '10px', fontSize: 12.5, color: c.muted }}>No matches.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function Opt({ children, onClick, active, c }) {
  return (
    <div onClick={onClick}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = c.hover; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
      style={{ padding: '8px 10px', fontSize: 12.5, fontWeight: 600, color: c.text, borderRadius: 6, cursor: 'pointer', background: active ? c.sel : 'transparent', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      {children}
    </div>
  );
}
