import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Truck, Boxes, Send, Hand, PackageOpen, RefreshCw, Database,
  TrendingUp, TrendingDown, Minus,
} from 'lucide-react';
import api from '../api/client';
import { listNotifications } from '../api/notifications';
import { volumeSummary, volumeWeekly, volumeLeaderboard } from '../api/volume';

// ── palette + status config ──────────────────────────────────
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
const HEADER = '#0B1220', TITLE = '#0F172A', MUTED = '#64748B', ACCENT = '#0056FB', LAST = '#CBD5E1';
const CARD_SHADOW = '0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.10)';
const TONE = {
  green: { bg: '#ECFDF3', fg: '#15803D' },
  amber: { bg: '#FFF7ED', fg: '#B45309' },
  red:   { bg: '#FEF2F2', fg: '#B91C1C' },
  grey:  { bg: '#F1F5F9', fg: '#64748B' },
};
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const STYLE = `
  @keyframes c9pulse { 0%{box-shadow:0 0 0 0 rgba(0,200,83,0.45)} 70%{box-shadow:0 0 0 7px rgba(0,200,83,0)} 100%{box-shadow:0 0 0 0 rgba(0,200,83,0)} }
  @keyframes c9spin  { to { transform: rotate(360deg) } }
  .c9-rows { display:flex; flex-direction:column; gap:16px; }
  .c9-r1 { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; }
  .c9-r2 { display:grid; grid-template-columns:3fr 2fr; gap:16px; }
  .c9-r3 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  @media (max-width:1024px){ .c9-r1{grid-template-columns:repeat(2,1fr)} .c9-r2,.c9-r3{grid-template-columns:1fr} }
  @media (max-width:560px){ .c9-r1{grid-template-columns:1fr} }
  .c9-row:hover { background:#F8FAFC; }
  .c9-btn:hover { background:#0044cc; }
`;

function Card({ children, style }) {
  return <div style={{ background: '#fff', border: '1px solid rgba(16,24,40,0.06)', borderRadius: 12,
    boxShadow: CARD_SHADOW, padding: 18, ...style }}>{children}</div>;
}
function Pill({ text, tone = 'grey' }) {
  const t = TONE[tone] || TONE.grey;
  return <span style={{ fontSize: 11, fontWeight: 600, color: t.fg, background: t.bg,
    borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>{text}</span>;
}
function ListeningPill() {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11.5, fontWeight: 600, color: '#15803D' }}>
    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#00C853', animation: 'c9pulse 1.6s infinite' }} />
    Listening for webhooks…
  </span>;
}

function pctPill(today, prev, periodLabel) {
  if (prev > 0) {
    const r = Math.round(((today - prev) / prev) * 1000) / 10;
    return { text: `${r >= 0 ? '+' : ''}${r}% vs ${periodLabel}`, tone: r >= 0 ? 'green' : 'amber' };
  }
  if (today > 0) return { text: `New vs ${periodLabel}`, tone: 'green' };
  return { text: `— vs ${periodLabel}`, tone: 'grey' };
}

function StatCard({ Icon, label, value, color, pill }) {
  return (
    <Card style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 116 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, background: `${color}1a`, color,
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={17} strokeWidth={1.9} />
        </div>
        <span style={{ fontSize: 12.5, color: MUTED, fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ fontSize: 30, fontWeight: 800, color: HEADER, lineHeight: 1, letterSpacing: -0.8 }}>{value}</div>
      <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'flex-end' }}>
        {pill && <Pill text={pill.text} tone={pill.tone} />}
      </div>
    </Card>
  );
}

// Dual-line week-over-week chart (SVG lines stretched, dots overlaid in %).
function WeekChart({ weekly }) {
  const tw = weekly?.this_week || [];
  const lw = weekly?.last_week || [];
  const all = [...tw, ...lw].map(d => d?.parcels || 0);
  const max = Math.max(1, ...all);
  const xy = (i, v) => ({ x: (i / 6) * 100, y: 100 - (v / max) * 100 });
  const line = (arr) => arr.map((d, i) => (d?.parcels == null ? null : xy(i, d.parcels)))
    .filter(Boolean).map(p => `${p.x},${p.y}`).join(' ');

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 11.5, color: MUTED }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 3, background: ACCENT, borderRadius: 2 }} /> This week</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 0, borderTop: `2px dashed ${LAST}` }} /> Last week</span>
      </div>
      <div style={{ position: 'relative', height: 180 }}>
        <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
          {[25, 50, 75].map(y => <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="#EEF2F6" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
          <polyline points={line(lw)} fill="none" stroke={LAST} strokeWidth="2" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          <polyline points={line(tw)} fill="none" stroke={ACCENT} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
        {tw.map((d, i) => d?.parcels == null ? null : (() => { const p = xy(i, d.parcels); return (
          <div key={i} title={`${d.label}: ${d.parcels}`} style={{ position: 'absolute', left: `${p.x}%`, top: `${p.y}%`,
            width: 7, height: 7, borderRadius: '50%', background: ACCENT, border: '2px solid #fff',
            transform: 'translate(-50%,-50%)', boxShadow: '0 0 0 1px rgba(0,86,251,0.3)' }} />); })())}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', marginTop: 8 }}>
        {tw.map((d, i) => <span key={i} style={{ fontSize: 10, color: '#94A3B8', textAlign: 'center' }}>{d.label}</span>)}
      </div>
    </div>
  );
}

function Leaderboard({ rows, navigate }) {
  if (!rows || rows.length === 0)
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '24px 0', color: '#94A3B8' }}>
      <ListeningPill /><span style={{ fontSize: 12 }}>No customer volume yet.</span></div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map((c, i) => {
        const mom = c.mom_pct;
        const tone = mom == null ? 'grey' : mom >= 0 ? 'green' : 'amber';
        const Tri = mom == null ? Minus : mom >= 0 ? TrendingUp : TrendingDown;
        const label = mom == null ? 'New' : `${mom >= 0 ? '+' : ''}${mom}%`;
        return (
          <div key={c.id} className="c9-row" onClick={() => navigate(`/customers/${c.id}`)}
            style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 6px', cursor: 'pointer',
              borderTop: i ? '1px solid rgba(16,24,40,0.05)' : 'none', borderRadius: 6 }}>
            <span style={{ width: 18, fontSize: 12, fontWeight: 700, color: '#94A3B8' }}>{i + 1}</span>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: TITLE, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.business_name}</span>
            <span style={{ fontSize: 12, color: MUTED, minWidth: 64, textAlign: 'right' }}>{c.orders_today} orders</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, minWidth: 64, justifyContent: 'flex-end',
              fontSize: 12, fontWeight: 700, color: TONE[tone].fg }}>
              <Tri size={13} /> {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);

  const { data: stats }  = useQuery({ queryKey: ['tracking-stats'], queryFn: () => api.get('/tracking/stats').then(r => r.data) });
  const { data: notifs } = useQuery({ queryKey: ['dashboard-notifs'], queryFn: () => listNotifications({ limit: 7 }) });
  const { data: vol }    = useQuery({ queryKey: ['volume-summary'], queryFn: volumeSummary });
  const { data: weekly } = useQuery({ queryKey: ['volume-weekly'], queryFn: volumeWeekly });
  const { data: board }  = useQuery({ queryKey: ['volume-leaderboard'], queryFn: () => volumeLeaderboard(5) });

  const byStatus = stats?.by_status || {};
  const statusRows = Object.entries(byStatus).sort((a, b) => b[1] - a[1]);
  const pending = byStatus.booked || 0;
  const todayWd = WD[new Date().getDay()];
  const hasWeek = weekly && [...(weekly.this_week || []), ...(weekly.last_week || [])].some(d => (d?.parcels || 0) > 0);

  async function runHelmSync() {
    setSyncing(true); setSyncMsg(null);
    try {
      await api.post('/helm/sync/customers');
      await api.post('/helm/sync/volume?days=60');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['volume-summary'] }),
        qc.invalidateQueries({ queryKey: ['volume-weekly'] }),
        qc.invalidateQueries({ queryKey: ['volume-leaderboard'] }),
        qc.invalidateQueries({ queryKey: ['customers'] }),
      ]);
    } catch (e) {
      setSyncMsg(e?.response?.data?.error || 'Sync failed — check your Helm settings.');
    } finally { setSyncing(false); }
  }

  return (
    <div style={{ width: '100%', maxWidth: 1600 }}>
      <style>{STYLE}</style>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: HEADER, margin: '0 0 4px', letterSpacing: -0.6 }}>Air Traffic Control</h1>
      <p style={{ fontSize: 13, color: MUTED, margin: '0 0 22px' }}>Live operational view across all 3PL activity.</p>

      <div className="c9-rows">
        {/* ROW 1 — stats */}
        <div className="c9-r1">
          <StatCard Icon={Send}  label="Parcels sent today" value={vol?.parcels_today ?? '—'} color={ACCENT}
            pill={pctPill(vol?.parcels_today || 0, vol?.parcels_last_week || 0, `last ${todayWd}`)} />
          <StatCard Icon={Boxes} label="Items sent today" value={vol?.items_today ?? '—'} color="#7B2FBE"
            pill={pctPill(vol?.items_today || 0, vol?.items_last_week || 0, `last ${todayWd}`)} />
          <StatCard Icon={Hand}  label="Picks today" value={vol?.picks_today ?? '—'} color="#00BCD4"
            pill={{ text: `vs ${vol?.picks_yesterday_to_hour ?? 0} yest. @ this hour`,
              tone: (vol?.picks_today || 0) >= (vol?.picks_yesterday_to_hour || 0) ? 'green' : 'amber' }} />
          <StatCard Icon={PackageOpen} label="Pending dispatch" value={pending} color="#F59E0B"
            pill={{ text: 'packed · awaiting carrier', tone: 'grey' }} />
        </div>

        {/* ROW 2 — analytics 60 / 40 */}
        <div className="c9-r2">
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
              <span style={{ fontSize: 14.5, fontWeight: 700, color: TITLE }}>Dispatch volume &amp; trends</span>
              {hasWeek && <span style={{ fontSize: 12, color: MUTED }}>{vol?.parcels_7d ?? 0} parcels · {vol?.items_7d ?? 0} items (7d)</span>}
            </div>
            {hasWeek ? <WeekChart weekly={weekly} /> : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                textAlign: 'center', padding: '30px 16px', minHeight: 180 }}>
                <div style={{ width: 52, height: 52, borderRadius: 14, background: `${ACCENT}14`, color: ACCENT,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                  <Database size={24} strokeWidth={1.8} />
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: TITLE, marginBottom: 4 }}>Connect your data</div>
                <div style={{ fontSize: 12.5, color: MUTED, maxWidth: 300, marginBottom: 16 }}>
                  Pull customers and dispatch volume from Helm to populate the trend chart and leaderboard.
                </div>
                <button className="c9-btn" onClick={runHelmSync} disabled={syncing} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8, background: ACCENT, color: '#fff', border: 'none',
                  borderRadius: 9, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: syncing ? 'default' : 'pointer', opacity: syncing ? 0.7 : 1 }}>
                  <RefreshCw size={15} style={{ animation: syncing ? 'c9spin 0.9s linear infinite' : 'none' }} />
                  {syncing ? 'Syncing…' : 'Run Helm Sync'}
                </button>
                {syncMsg && <div style={{ fontSize: 11.5, color: '#B91C1C', marginTop: 12, maxWidth: 320 }}>{syncMsg}</div>}
              </div>
            )}
          </Card>

          <Card>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: TITLE, marginBottom: 6 }}>Top customers by growth</div>
            <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 8 }}>Orders today · month-over-month</div>
            <Leaderboard rows={board} navigate={navigate} />
          </Card>
        </div>

        {/* ROW 3 — live view 50 / 50 */}
        <div className="c9-r3">
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <span style={{ fontSize: 14.5, fontWeight: 700, color: TITLE }}>Live status board</span>
              {statusRows.length === 0 && <ListeningPill />}
            </div>
            {statusRows.length === 0
              ? <div style={{ fontSize: 12.5, color: '#94A3B8', padding: '18px 0' }}>No parcels in the network yet — tracking events will appear here the moment they arrive.</div>
              : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {statusRows.map(([status, count]) => (
                    <div key={status} className="c9-row" onClick={() => navigate(`/tracking?status=${status}`)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', borderRadius: 6, padding: '3px 4px' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: RAG[STATUS_RAG[status] || 'grey'], flexShrink: 0 }} />
                      <span style={{ fontSize: 13, color: '#334155', flex: 1 }}>{STATUS_LABEL[status] || status}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: TITLE }}>{count}</span>
                    </div>
                  ))}
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
    </div>
  );
}
