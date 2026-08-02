import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LayoutGrid, RefreshCw } from 'lucide-react';
import { statusBoard } from '../../api/volume';
import api from '../../api/client';

const HEADER = '#0B1220', TITLE = '#0F172A', MUTED = '#64748B', ACCENT = '#0056FB';
const SHADOW = '0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.10)';
const PALETTE = ['#3B82F6', '#A855F7', '#22D3EE', '#EC4899', '#F59E0B', '#10B981', '#6366F1', '#EF4444', '#14B8A6', '#F97316', '#8B5CF6', '#0EA5E9', '#D946EF', '#84CC16'];

// Use Helm's status colour if it's a usable hex, else a stable palette colour.
const cardColour = (s, i) => (s.colour && /^#?[0-9a-fA-F]{6}$/.test(s.colour.replace('#', '')) ? (s.colour.startsWith('#') ? s.colour : `#${s.colour}`) : PALETTE[i % PALETTE.length]);

export default function StatusBoardPage() {
  const [syncing, setSyncing] = useState(false);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['status-board'],
    queryFn: () => statusBoard(),
    refetchInterval: 15 * 60 * 1000,   // refresh every 15 minutes
  });
  const statuses = data?.statuses || [];

  // Pull live statuses from Helm (fixes drift), then re-read the counts a couple
  // of times as the background sync writes them.
  async function refresh() {
    setSyncing(true);
    try { await api.post('/helm/sync/statuses'); } catch { /* still poll below */ }
    // The pull runs in the background; poll the counts a few times as it writes.
    [8000, 16000, 25000, 35000].forEach(ms => setTimeout(() => refetch(), ms));
    setTimeout(() => setSyncing(false), 36000);
  }

  return (
    <div style={{ width: '100%', maxWidth: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: HEADER, margin: '0 0 4px', letterSpacing: -0.6, display: 'flex', alignItems: 'center', gap: 9 }}>
            <LayoutGrid size={22} /> Status Board
          </h1>
          <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>
            Live order count for every status
            {data ? <span style={{ color: '#94A3B8' }}> · {data.total.toLocaleString()} orders across {statuses.length} statuses · right now</span> : ''}
          </p>
        </div>
        <button onClick={refresh} disabled={syncing} title="Pull the latest order statuses from Helm" style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1px solid #E2E8F0', background: '#fff', cursor: syncing ? 'default' : 'pointer', borderRadius: 9, padding: '8px 13px', fontSize: 12.5, fontWeight: 600, color: TITLE, opacity: syncing ? 0.7 : 1 }}>
          <RefreshCw size={14} style={{ animation: (isFetching || syncing) ? 'spin 1s linear infinite' : 'none' }} /> {syncing ? 'Refreshing from Helm…' : 'Refresh'}
        </button>
      </div>

      {isLoading ? (
        <div style={{ color: MUTED, fontSize: 13, padding: '40px 0' }}>Loading…</div>
      ) : statuses.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: 14, boxShadow: SHADOW, padding: '54px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: TITLE, marginBottom: 6 }}>No orders synced yet</div>
          <div style={{ fontSize: 13.5, color: MUTED, maxWidth: 480, margin: '0 auto' }}>
            Cards appear here as orders sync from Helm (every few minutes) — one per status that currently has orders.
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(235px, 1fr))', gap: 16 }}>
          {statuses.map((s, i) => {
            const col = cardColour(s, i);
            return (
              <div key={s.status_id} style={{ background: '#fff', borderRadius: 14, boxShadow: SHADOW, padding: '22px 24px', borderLeft: `5px solid ${col}`, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 128, justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span style={{ width: 11, height: 11, borderRadius: '50%', background: col, flexShrink: 0 }} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: MUTED, lineHeight: 1.25 }}>{s.name || `Status ${s.status_id}`}</span>
                </div>
                <div style={{ fontSize: 46, fontWeight: 800, color: HEADER, letterSpacing: -1.5, lineHeight: 1 }}>{s.count.toLocaleString()}</div>
              </div>
            );
          })}
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
