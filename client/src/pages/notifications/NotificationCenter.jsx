import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { CheckCheck } from 'lucide-react';
import { listNotifications, markRead, markAllRead } from '../../api/notifications';

const RAG = { green: '#00C853', amber: '#F59E0B', red: '#E91E8C', grey: '#94A3B8' };
const TYPE_LABEL = {
  purchase_order_created: 'Purchase order', stock_received: 'Stock received',
  shipment_created: 'Shipment', tracking_exception: 'Tracking issue',
  volume_drop: 'Volume drop', system: 'System',
};
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'red', label: 'Red' },
  { key: 'amber', label: 'Amber' },
];

export default function NotificationCenter() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filter, setFilter] = useState('all');

  const params = {};
  if (filter === 'unread') params.unread = 'true';
  if (filter === 'red')    params.severity = 'red';
  if (filter === 'amber')  params.severity = 'amber';

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', filter],
    queryFn: () => listNotifications({ ...params, limit: 100 }),
  });

  const rows = data?.notifications || [];

  async function open(n) {
    if (!n.read_at) { await markRead(n.id); qc.invalidateQueries({ queryKey: ['notifications'] }); }
    if (n.link_url) navigate(n.link_url);
  }
  async function readAll() {
    await markAllRead();
    qc.invalidateQueries({ queryKey: ['notifications'] });
  }

  return (
    <div style={{ maxWidth: 820 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', margin: 0 }}>Notification Center</h1>
        <button onClick={readAll} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748B',
          background: '#fff', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 8, padding: '7px 12px', cursor: 'pointer',
        }}>
          <CheckCheck size={14} /> Mark all read
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)} style={{
            fontSize: 12, padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
            border: '1px solid', borderColor: filter === f.key ? '#0F172A' : 'rgba(0,0,0,0.12)',
            background: filter === f.key ? '#0F172A' : '#fff', color: filter === f.key ? '#fff' : '#334155',
          }}>{f.label}</button>
        ))}
      </div>

      <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 14, overflow: 'hidden' }}>
        {isLoading && <div style={{ padding: 18, color: '#94A3B8', fontSize: 13 }}>Loading…</div>}
        {!isLoading && rows.length === 0 && (
          <div style={{ padding: 24, color: '#94A3B8', fontSize: 13, textAlign: 'center' }}>
            No notifications. They appear here when customers raise POs, book stock in, or tracking flags an issue.
          </div>
        )}
        {rows.map((n, i) => (
          <div key={n.id} onClick={() => open(n)} style={{
            display: 'flex', gap: 12, padding: '14px 16px', cursor: 'pointer',
            borderTop: i ? '1px solid rgba(0,0,0,0.05)' : 'none',
            background: n.read_at ? '#fff' : 'rgba(0,188,212,0.04)',
          }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', marginTop: 5, flexShrink: 0, background: RAG[n.severity] || RAG.grey }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>{n.title}</span>
                <span style={{ fontSize: 11, color: '#94A3B8' }}>{TYPE_LABEL[n.type] || n.type}</span>
              </div>
              {n.body && <div style={{ fontSize: 13, color: '#64748B', marginTop: 2 }}>{n.body}</div>}
              <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 3 }}>{new Date(n.created_at).toLocaleString('en-GB')}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
