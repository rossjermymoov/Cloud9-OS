import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LayoutGrid, RefreshCw } from 'lucide-react';
import { statusBoard } from '../../api/volume';

const HEADER = '#0B1220', TITLE = '#0F172A', MUTED = '#64748B', ACCENT = '#0056FB';
const SHADOW = '0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.10)';
const PALETTE = ['#3B82F6', '#A855F7', '#22D3EE', '#EC4899', '#F59E0B', '#10B981', '#6366F1', '#EF4444', '#14B8A6', '#F97316', '#8B5CF6', '#0EA5E9', '#D946EF', '#84CC16'];

// Use Helm's status colour if it's a usable hex, else a stable palette colour.
const cardColour = (s, i) => (s.colour && /^#?[0-9a-fA-F]{6}$/.test(s.colour.replace('#', '')) ? (s.colour.startsWith('#') ? s.colour : `#${s.colour}`) : PALETTE[i % PALETTE.length]);

export default function StatusBoardPage() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['status-board'],
    queryFn: () => statusBoard(),
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
            Live order count for every status
            {data ? <span style={{ color: '#94A3B8' }}> · {data.total.toLocaleString()} orders across {statuses.length} statuses · right now</span> : ''}
          </p>
        </div>
        <button onClick={() => refetch()} style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1px solid #E2E8F0', background: '#fff', cursor: 'pointer', borderRadius: 9, padding: '8px 13px', fontSize: 12.5, fontWeight: 600, color: TITLE }}>
          <RefreshCw size={14} style={{ animation: isFetching ? 'spin 1s linear infinite' : 'none' }} /> Refresh
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 18 }}>
          {statuses.map((s, i) => {
            const col = cardColour(s, i);
            return (
              <div key={s.status_id} style={{ background: '#fff', borderRadius: 18, boxShadow: SHADOW, padding: '26px 28px', borderLeft: `6px solid ${col}`, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 190, justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 12, height: 12, borderRadius: '50%', background: col, flexShrink: 0 }} />
                  <span style={{ fontSize: 16, fontWeight: 700, color: MUTED, lineHeight: 1.25 }}>{s.name || `Status ${s.status_id}`}</span>
                </div>
                <div style={{ fontSize: 64, fontWeight: 900, color: HEADER, letterSpacing: -2, lineHeight: 1 }}>{s.count.toLocaleString()}</div>
              </div>
            );
          })}
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
