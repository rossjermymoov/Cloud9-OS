import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LayoutGrid, RefreshCw } from 'lucide-react';
import { statusBoard } from '../../api/volume';

const HEADER = '#0B1220', TITLE = '#0F172A', MUTED = '#64748B', ACCENT = '#0056FB';
const SHADOW = '0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.10)';
const PALETTE = ['#3B82F6', '#A855F7', '#22D3EE', '#EC4899', '#F59E0B', '#10B981', '#6366F1', '#EF4444', '#14B8A6', '#F97316', '#8B5CF6', '#0EA5E9', '#D946EF', '#84CC16'];

// Use Helm's status colour if it's a usable hex, else a stable palette colour.
const cardColour = (s, i) => (s.colour && /^#?[0-9a-fA-F]{6}$/.test(s.colour.replace('#', '')) ? (s.colour.startsWith('#') ? s.colour : `#${s.colour}`) : PALETTE[i % PALETTE.length]);

const PERIODS = [{ v: 1, l: 'Today' }, { v: 7, l: '7 days' }, { v: 14, l: '14 days' }, { v: 30, l: '30 days' }];

export default function StatusBoardPage() {
  const [days, setDays] = useState(14);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['status-board', days],
    queryFn: () => statusBoard(days),
    refetchInterval: 30000,
  });
  const statuses = data?.statuses || [];

  return (
    <div style={{ width: '100%', maxWidth: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: HEADER, margin: '0 0 4px', letterSpacing: -0.6, display: 'flex', alignItems: 'center', gap: 9 }}>
            <LayoutGrid size={22} /> Status Board
          </h1>
          <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>
            Live order count for every status Helm shows on the dashboard
            {data ? <span style={{ color: '#94A3B8' }}> · {data.total.toLocaleString()} orders across {statuses.length} statuses · last {days === 1 ? 'day' : `${days} days`}</span> : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'inline-flex', background: '#F1F5F9', borderRadius: 9, padding: 3 }}>
            {PERIODS.map(p => (
              <button key={p.v} onClick={() => setDays(p.v)} style={{
                border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 7,
                background: days === p.v ? '#fff' : 'transparent', color: days === p.v ? TITLE : MUTED,
                boxShadow: days === p.v ? '0 1px 2px rgba(16,24,40,0.10)' : 'none',
              }}>{p.l}</button>
            ))}
          </div>
          <button onClick={() => refetch()} style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1px solid #E2E8F0', background: '#fff', cursor: 'pointer', borderRadius: 9, padding: '8px 13px', fontSize: 12.5, fontWeight: 600, color: TITLE }}>
            <RefreshCw size={14} style={{ animation: isFetching ? 'spin 1s linear infinite' : 'none' }} /> Refresh
          </button>
        </div>
      </div>

      {isLoading ? (
        <div style={{ color: MUTED, fontSize: 13, padding: '40px 0' }}>Loading…</div>
      ) : statuses.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: 14, boxShadow: SHADOW, padding: '54px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: TITLE, marginBottom: 6 }}>No dashboard statuses yet</div>
          <div style={{ fontSize: 13.5, color: MUTED, maxWidth: 480, margin: '0 auto' }}>
            Status definitions are captured as orders sync from Helm (every few minutes). Once an order in a dashboard-visible status comes through, its card appears here automatically.
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 14 }}>
          {statuses.map((s, i) => {
            const col = cardColour(s, i);
            return (
              <div key={s.status_id} style={{ background: '#fff', borderRadius: 14, boxShadow: SHADOW, padding: 18, borderLeft: `4px solid ${col}`, display: 'flex', flexDirection: 'column', gap: 6, minHeight: 92 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: col, flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: MUTED, lineHeight: 1.25 }}>{s.name || `Status ${s.status_id}`}</span>
                </div>
                <div style={{ fontSize: 30, fontWeight: 900, color: HEADER, letterSpacing: -1, lineHeight: 1 }}>{s.count.toLocaleString()}</div>
              </div>
            );
          })}
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
