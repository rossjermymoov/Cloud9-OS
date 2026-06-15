import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Truck, Bell, AlertTriangle, Boxes, Send, Hand, RefreshCw, Database,
} from 'lucide-react';
import api from '../api/client';
import { listNotifications } from '../api/notifications';
import { volumeSummary, volumeDaily, volumeByCustomer } from '../api/volume';

// ── RAG + status config ──────────────────────────────────────
const STATUS_RAG = {
  delivered: 'green', collected: 'green', in_transit: 'green', at_depot: 'green',
  out_for_delivery: 'green', booked: 'amber', on_hold: 'amber',
  awaiting_collection: 'amber', customs_hold: 'amber',
  failed_delivery: 'red', exception: 'red', returned: 'red', damaged: 'red',
};
const RAG = { green: '#00C853', amber: '#F59E0B', red: '#E11D48', grey: '#94A3B8' };
const STATUS_LABEL = {
  booked: 'Booked', collected: 'Collected', at_depot: 'At Hub', in_transit: 'In Transit',
  out_for_delivery: 'Out for Delivery', failed_delivery: 'Failed Attempt', delivered: 'Delivered',
  on_hold: 'On Hold', exception: 'Address Issue', returned: 'Returned', tracking_expired: 'Tracking Expired',
  cancelled: 'Cancelled', awaiting_collection: 'Awaiting Collection', damaged: 'Damaged',
  customs_hold: 'Customs Hold', unknown: 'Unknown',
};

const HEADER   = '#0B1220';   // high-contrast slate for headings
const TITLE     = '#0F172A';
const MUTED     = '#64748B';
const ACCENT    = '#0056FB';
const CARD_SHADOW = '0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.10)';

const STYLE = `
  @keyframes c9pulse { 0%{box-shadow:0 0 0 0 rgba(0,200,83,0.45)} 70%{box-shadow:0 0 0 7px rgba(0,200,83,0)} 100%{box-shadow:0 0 0 0 rgba(0,200,83,0)} }
  @keyframes c9spin  { to { transform: rotate(360deg) } }
  .c9-grid-4 { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-bottom:18px; }
  @media (max-width:900px){ .c9-grid-4 { grid-template-columns:repeat(2,1fr); } }
  @media (max-width:560px){ .c9-grid-4 { grid-template-columns:1fr; } }
  .c9-grid-2a { display:grid; grid-template-columns:1.4fr 1fr; gap:16px; margin-bottom:16px; }
  .c9-grid-2b { display:grid; grid-template-columns:1.2fr 1fr; gap:16px; }
  @media (max-width:780px){ .c9-grid-2a, .c9-grid-2b { grid-template-columns:1fr; } }
  .c9-row:hover { background:#F8FAFC; }
  .c9-btn:hover { background:#0044cc; }
`;

function Card({ children, style }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid rgba(16,24,40,0.06)', borderRadius: 12,
      boxShadow: CARD_SHADOW, padding: 18, ...style,
    }}>{children}</div>
  );
}

function ListeningPill() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11.5, fontWeight: 600, color: '#15803D' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#00C853', animation: 'c9pulse 1.6s infinite' }} />
      Listening for webhooks…
    </span>
  );
}

function StatTile({ Icon, label, value, color }) {
  return (
    <Card style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ width: 42, height: 42, borderRadius: 11, flexShrink: 0, background: `${color}1a`, color,
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={20} strokeWidth={1.9} />
      </div>
      <div>
        <div style={{ fontSize: 26, fontWeight: 700, color: HEADER, lineHeight: 1, letterSpacing: -0.5 }}>{value}</div>
        <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>{label}</div>
      </div>
    </Card>
  );
}

// Combined parcels|items split card.
function SplitTile({ parcels, items }) {
  const Half = ({ Icon, label, value, color }) => (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, background: `${color}1a`, color,
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={18} strokeWidth={1.9} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 24, fontWeight: 700, color: HEADER, lineHeight: 1, letterSpacing: -0.5 }}>{value}</div>
        <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3, whiteSpace: 'nowrap' }}>{label}</div>
      </div>
    </div>
  );
  return (
    <Card style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Half Icon={Send}  label="Parcels today" value={parcels ?? '—'} color={ACCENT} />
      <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(16,24,40,0.08)', margin: '2px 6px' }} />
      <Half Icon={Boxes} label="Items today"   value={items ?? '—'}   color="#7B2FBE" />
    </Card>
  );
}

// Exceptions tile — neutral when 0, alarming when > 0.
function ExceptionsTile({ count }) {
  const active = count > 0;
  const bg     = active ? '#FEF2F2' : '#F8FAFC';
  const fg     = active ? '#B91C1C' : '#0F172A';
  const iconBg = active ? '#FCDCDC' : '#EEF2F6';
  const iconFg = active ? '#DC2626' : '#94A3B8';
  return (
    <Card style={{ display: 'flex', alignItems: 'center', gap: 14, background: bg,
      border: `1px solid ${active ? 'rgba(220,38,38,0.18)' : 'rgba(16,24,40,0.06)'}` }}>
      <div style={{ width: 42, height: 42, borderRadius: 11, flexShrink: 0, background: iconBg, color: iconFg,
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <AlertTriangle size={20} strokeWidth={1.9} />
      </div>
      <div>
        <div style={{ fontSize: 26, fontWeight: 800, color: fg, lineHeight: 1, letterSpacing: -0.5 }}>{count}</div>
        <div style={{ fontSize: 12, color: active ? '#B91C1C' : MUTED, marginTop: 4, fontWeight: active ? 600 : 400 }}>
          Exceptions
        </div>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);

  const { data: stats } = useQuery({ queryKey: ['tracking-stats'], queryFn: () => api.get('/tracking/stats').then(r => r.data) });
  const { data: notifs } = useQuery({ queryKey: ['dashboard-notifs'], queryFn: () => listNotifications({ limit: 8 }) });
  const { data: vol }        = useQuery({ queryKey: ['volume-summary'], queryFn: volumeSummary });
  const { data: daily }      = useQuery({ queryKey: ['volume-daily'], queryFn: () => volumeDaily(14) });
  const { data: byCustomer } = useQuery({ queryKey: ['volume-by-customer'], queryFn: () => volumeByCustomer(1) });

  const byStatus = stats?.by_status || {};
  const statusRows = Object.entries(byStatus).sort((a, b) => b[1] - a[1]);
  const maxParcels = Math.max(1, ...(daily || []).map(d => d.parcels));
  const exceptions = statusRows.filter(([s]) => STATUS_RAG[s] === 'red').reduce((a, [, c]) => a + c, 0);

  async function runHelmSync() {
    setSyncing(true); setSyncMsg(null);
    try {
      await api.post('/helm/sync/customers');
      await api.post('/helm/sync/volume?days=30');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['volume-summary'] }),
        qc.invalidateQueries({ queryKey: ['volume-daily'] }),
        qc.invalidateQueries({ queryKey: ['volume-by-customer'] }),
        qc.invalidateQueries({ queryKey: ['customers'] }),
      ]);
    } catch (e) {
      setSyncMsg(e?.response?.data?.error || 'Sync failed — check your Helm settings.');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div style={{ maxWidth: 1120 }}>
      <style>{STYLE}</style>

      <h1 style={{ fontSize: 24, fontWeight: 800, color: HEADER, margin: '0 0 4px', letterSpacing: -0.6 }}>Air Traffic Control</h1>
      <p style={{ fontSize: 13, color: MUTED, margin: '0 0 22px' }}>Live operational view across all 3PL activity.</p>

      {/* Metric row — 4 responsive columns */}
      <div className="c9-grid-4">
        <SplitTile parcels={vol?.parcels_today} items={vol?.items_today} />
        <StatTile Icon={Hand}  label="Picks today"    value={vol?.picks_today ?? '—'}    color="#00BCD4" />
        <StatTile Icon={Truck} label="Active parcels" value={stats?.total_active ?? '—'} color="#5C6BC0" />
        <ExceptionsTile count={exceptions} />
      </div>

      {/* Dispatch volume */}
      <div className="c9-grid-2a">
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
            <span style={{ fontSize: 14.5, fontWeight: 700, color: TITLE }}>Dispatch volume · last 14 days</span>
            {daily && daily.length > 0 &&
              <span style={{ fontSize: 12, color: MUTED }}>{vol?.parcels_7d ?? 0} parcels · {vol?.items_7d ?? 0} items (7d)</span>}
          </div>

          {(!daily || daily.length === 0) ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              textAlign: 'center', padding: '26px 16px', minHeight: 140 }}>
              <div style={{ width: 52, height: 52, borderRadius: 14, background: `${ACCENT}14`, color: ACCENT,
                display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                <Database size={24} strokeWidth={1.8} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: TITLE, marginBottom: 4 }}>Connect your data</div>
              <div style={{ fontSize: 12.5, color: MUTED, maxWidth: 280, marginBottom: 16 }}>
                Pull customers and dispatch volume from Helm to populate your air-traffic view.
              </div>
              <button className="c9-btn" onClick={runHelmSync} disabled={syncing} style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, background: ACCENT, color: '#fff',
                border: 'none', borderRadius: 9, padding: '9px 16px', fontSize: 13, fontWeight: 600,
                cursor: syncing ? 'default' : 'pointer', opacity: syncing ? 0.7 : 1,
              }}>
                <RefreshCw size={15} style={{ animation: syncing ? 'c9spin 0.9s linear infinite' : 'none' }} />
                {syncing ? 'Syncing…' : 'Run Helm Sync'}
              </button>
              {syncMsg && <div style={{ fontSize: 11.5, color: '#B91C1C', marginTop: 12, maxWidth: 300 }}>{syncMsg}</div>}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120 }}>
              {daily.map(d => (
                <div key={d.date} title={`${d.date}: ${d.parcels} parcels, ${d.items} items`}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: '100%', background: ACCENT, borderRadius: '4px 4px 0 0',
                    height: `${Math.round((d.parcels / maxParcels) * 96)}px`, minHeight: 2 }} />
                  <span style={{ fontSize: 9, color: '#94A3B8' }}>{d.date.slice(8, 10)}/{d.date.slice(5, 7)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: TITLE, marginBottom: 14 }}>By customer · today</div>
          {(!byCustomer || byCustomer.length === 0)
            ? <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '28px 0', color: '#94A3B8' }}>
                <ListeningPill />
                <span style={{ fontSize: 12 }}>No dispatches recorded today.</span>
              </div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {byCustomer.slice(0, 8).map(c => (
                  <div key={c.id} className="c9-row" onClick={() => navigate(`/customers/${c.id}`)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', borderRadius: 6, padding: '2px 4px' }}>
                    <span style={{ fontSize: 13, color: '#334155', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.business_name}</span>
                    <span style={{ fontSize: 12, color: MUTED }}>{c.items} items</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: ACCENT, minWidth: 54, textAlign: 'right' }}>{c.parcels} parcels</span>
                  </div>
                ))}
              </div>}
        </Card>
      </div>

      {/* Live status + activity */}
      <div className="c9-grid-2b">
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 14.5, fontWeight: 700, color: TITLE }}>Live status board</span>
            {statusRows.length === 0 && <ListeningPill />}
          </div>
          {statusRows.length === 0
            ? <div style={{ fontSize: 12.5, color: '#94A3B8', padding: '18px 0' }}>No parcels in the network yet — tracking events will appear here the moment they arrive.</div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {statusRows.map(([status, count]) => {
                  const rag = RAG[STATUS_RAG[status] || 'grey'];
                  return (
                    <div key={status} className="c9-row" onClick={() => navigate(`/tracking?status=${status}`)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', borderRadius: 6, padding: '3px 4px' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: rag, flexShrink: 0 }} />
                      <span style={{ fontSize: 13, color: '#334155', flex: 1 }}>{STATUS_LABEL[status] || status}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: TITLE }}>{count}</span>
                    </div>
                  );
                })}
              </div>}
        </Card>

        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 14.5, fontWeight: 700, color: TITLE }}>Recent activity</span>
            {(notifs?.notifications?.length)
              ? <span onClick={() => navigate('/notifications')} style={{ fontSize: 12, color: ACCENT, cursor: 'pointer', fontWeight: 600 }}>View all</span>
              : <ListeningPill />}
          </div>
          {(!notifs?.notifications?.length)
            ? <div style={{ fontSize: 12.5, color: '#94A3B8', padding: '18px 0' }}>No activity yet — purchase orders, dispatches and alerts will stream in here.</div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                {notifs.notifications.map(n => (
                  <div key={n.id} className="c9-row" onClick={() => n.link_url && navigate(n.link_url)}
                    style={{ display: 'flex', gap: 10, cursor: n.link_url ? 'pointer' : 'default', borderRadius: 6, padding: '2px 4px' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', marginTop: 5, flexShrink: 0, background: RAG[n.severity] || RAG.grey }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: TITLE, fontWeight: 500 }}>{n.title}</div>
                      {n.body && <div style={{ fontSize: 12, color: MUTED }}>{n.body}</div>}
                    </div>
                  </div>
                ))}
              </div>}
        </Card>
      </div>
    </div>
  );
}
