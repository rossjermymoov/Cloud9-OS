import { useState } from 'react';
import { Filter } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { listCustomers } from '../api/customers';

const TITLE = '#0F172A', MUTED = '#64748B', ACCENT = '#0056FB';
const SHADOW = '0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.10)';
const KEY = 'c9_excluded_customers';   // shared across Dashboard, Storage, etc.

// One shared exclusion list, persisted per browser. Exclude a whale once and it
// drops out of the stats on every page that uses the filter.
export function useExcludedCustomers() {
  const [excluded, setExcluded] = useState(() => {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
  });
  const save = (next) => { localStorage.setItem(KEY, JSON.stringify(next)); setExcluded(next); };
  return {
    excluded,
    toggle: (id) => save(excluded.includes(id) ? excluded.filter(x => x !== id) : [...excluded, id]),
    clear:  () => save([]),
  };
}

export default function CustomerExcludeFilter({ excluded, toggle, clear }) {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ['customers-list-excl'], queryFn: () => listCustomers({ limit: 500, sort: 'business_name', order: 'asc' }) });
  const list = Array.isArray(data) ? data : (data?.data || data?.rows || data?.customers || []);

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid #E2E8F0',
        background: excluded.length ? '#EEF4FF' : '#fff', cursor: 'pointer', borderRadius: 9,
        padding: '7px 11px', fontSize: 12.5, fontWeight: 600, color: excluded.length ? ACCENT : TITLE }}>
        <Filter size={13} /> {excluded.length ? `Excluding ${excluded.length}` : 'Exclude customers'}
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div style={{ position: 'absolute', top: '112%', right: 0, width: 290, maxHeight: 380, overflowY: 'auto', background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, boxShadow: SHADOW, zIndex: 50, padding: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px 8px' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: TITLE }}>Exclude from stats</span>
              {excluded.length > 0 && <span onClick={clear} style={{ fontSize: 11.5, color: ACCENT, cursor: 'pointer', fontWeight: 600 }}>Clear all</span>}
            </div>
            {list.map(c => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 8px', fontSize: 12.5, cursor: 'pointer', borderRadius: 6 }}>
                <input type="checkbox" checked={excluded.includes(c.id)} onChange={() => toggle(c.id)} />
                <span style={{ color: TITLE }}>{c.business_name}</span>
              </label>
            ))}
            {list.length === 0 && <div style={{ padding: 8, fontSize: 12, color: MUTED }}>No customers loaded.</div>}
          </div>
        </>
      )}
    </div>
  );
}
