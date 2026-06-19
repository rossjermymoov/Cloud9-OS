import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Truck, Boxes, Send, Hand, PackageOpen, RefreshCw, Database,
  TrendingUp, TrendingDown, Minus, Trophy, Info, Maximize2, X, Filter,
} from 'lucide-react';
import api from '../api/client';
import { listNotifications } from '../api/notifications';
import { volumeTrend, volumeLeaderboard } from '../api/volume';
import { listCustomers } from '../api/customers';

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
    <Card style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '13px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: `${color}1a`, color,
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={16} strokeWidth={1.9} />
        </div>
        <span style={{ fontSize: 12, color: MUTED, fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: HEADER, lineHeight: 1, letterSpacing: -0.6 }}>{value}</div>
      <div style={{ marginTop: 2, display: 'flex', justifyContent: 'flex-end' }}>
        {pill && <Pill text={pill.text} tone={pill.tone} />}
      </div>
    </Card>
  );
}

// Render raw courier codes/names as human-readable labels.
function prettyCourier(name) {
  const n = (name || '').toLowerCase().replace(/[^a-z]/g, '');
  if (n.includes('royalmail')) return 'Royal Mail';
  if (n.includes('dpd')) return 'DPD';
  if (n.includes('dhl')) return 'DHL';
  if (n.includes('yodel')) return 'Yodel';
  if (n.includes('evri') || n.includes('hermes')) return 'Evri';
  if (n.includes('parcelforce')) return 'Parcelforce';
  if (n.includes('ups')) return 'UPS';
  if (n.includes('fedex')) return 'FedEx';
  if (n.includes('amazon')) return 'Amazon';
  return name || '—';
}

// Flexible trend chart — dual line (current vs previous) or monthly bars.
const PREV_LABEL = { day: 'Yesterday', yesterday: 'Prev day', week: 'Last week', month: 'Last month', quarter: 'Prev quarter', custom: 'Prev day' };
const CUR_LABEL  = { day: 'Today', yesterday: 'Yesterday', week: 'This week', month: 'This month', quarter: 'This quarter', custom: 'Selected day' };
const PERIOD_NOUN = { day: 'today', yesterday: 'yesterday', week: 'this week', month: 'this month', quarter: 'this quarter' };
const VS_NOUN     = { day: 'yesterday', yesterday: 'prev day', week: 'last week', month: 'last month', quarter: 'last quarter' };
function TrendChart({ trend, metric }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  if (!trend) return null;
  const n = trend.labels.length;
  if (trend.mode === 'bars') {
    const vals = trend.series.map(s => s[metric] || 0);
    const max = Math.max(1, ...vals);
    const GREEN = '#10B981', GREEN_H = '#34D399', BLUE = ACCENT, BLUE_H = '#4C84FB';
    const hasMonday = trend.series.some(s => s.dow === 1);
    const barColor = (s, i) => {
      const monday = s.dow === 1;
      const h = hoverIdx === i;
      return monday ? (h ? GREEN_H : GREEN) : (h ? BLUE_H : BLUE);
    };
    return (
      <div>
        {hasMonday && (
          <div style={{ display: 'flex', gap: 14, marginBottom: 10, fontSize: 11, color: MUTED }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: GREEN }} /> Monday</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: BLUE }} /> Other days</span>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 150 }}>
          {trend.series.map((s, i) => (
            <div key={i} onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)}
              title={`${trend.labels[i]}: ${s[metric]}`}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: 'default' }}>
              <span style={{ fontSize: 10, color: '#334155', fontWeight: 600 }}>{s[metric]}</span>
              <div style={{ width: '70%', background: barColor(s, i), borderRadius: '4px 4px 0 0', height: `${Math.round((s[metric] / max) * 120)}px`, minHeight: 2, transition: 'background 0.15s ease' }} />
              <span style={{ fontSize: 10, fontWeight: s.dow === 1 ? 700 : 400, color: s.dow === 1 ? GREEN : '#94A3B8' }}>{trend.labels[i]}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  // compare mode (week / month)
  const cur = trend.current, prev = trend.previous;
  const all = [...cur, ...prev].map(d => (d ? d[metric] : 0));
  const max = Math.max(1, ...all);
  const xy = (i, v) => ({ x: n > 1 ? (i / (n - 1)) * 100 : 50, y: 100 - (v / max) * 100 });
  const line = (arr) => arr.map((d, i) => (d == null ? null : xy(i, d[metric]))).filter(Boolean).map(p => `${p.x},${p.y}`).join(' ');
  return (
    <div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 11.5, color: MUTED }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 3, background: ACCENT, borderRadius: 2 }} /> {CUR_LABEL[trend.period]}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 0, borderTop: `2px dashed ${LAST}` }} /> {PREV_LABEL[trend.period]}</span>
      </div>
      <div style={{ position: 'relative', height: 180 }}>
        <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
          {[25, 50, 75].map(y => <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="#EEF2F6" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
          <polyline points={line(prev)} fill="none" stroke={LAST} strokeWidth="2" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          <polyline points={line(cur)} fill="none" stroke={ACCENT} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
        {cur.map((d, i) => d == null ? null : (() => { const p = xy(i, d[metric]); return (
          <div key={i} title={`${trend.labels[i]}: ${d[metric]}`} style={{ position: 'absolute', left: `${p.x}%`, top: `${p.y}%`,
            width: 6, height: 6, borderRadius: '50%', background: ACCENT, border: '2px solid #fff',
            transform: 'translate(-50%,-50%)' }} />); })())}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${n},1fr)`, marginTop: 8 }}>
        {trend.labels.map((l, i) => <span key={i} style={{ fontSize: 9, color: '#94A3B8', textAlign: 'center' }}>{n > 16 && i % 3 !== 0 ? '' : l}</span>)}
      </div>
    </div>
  );
}

function Seg({ options, value, onChange }) {
  return (
    <div style={{ display: 'inline-flex', background: '#F1F5F9', borderRadius: 8, padding: 3 }}>
      {options.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)} style={{
          fontSize: 12, fontWeight: 600, padding: '5px 11px', borderRadius: 6, border: 'none', cursor: 'pointer',
          background: value === o.v ? '#fff' : 'transparent', color: value === o.v ? ACCENT : MUTED, boxShadow: value === o.v ? CARD_SHADOW : 'none',
        }}>{o.l}</button>
      ))}
    </div>
  );
}

// Pending dispatch — compact; hovering anywhere on the card reveals the per-carrier breakdown.
function PendingCard({ total, byCourier }) {
  const [hover, setHover] = useState(false);
  const list = byCourier || [];
  return (
    <Card style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '13px 16px', position: 'relative', cursor: 'default' }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: '#F59E0B1a', color: '#F59E0B', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <PackageOpen size={16} strokeWidth={1.9} />
        </div>
        <span style={{ fontSize: 12, color: MUTED, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          Pending collection
          <Info size={13} color="#94A3B8" style={{ cursor: 'help' }} />
        </span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: HEADER, lineHeight: 1, letterSpacing: -0.6 }}>{(total || 0).toLocaleString()}</div>

      {hover && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 60,
          background: '#0B1220', color: '#fff', borderRadius: 9, padding: '11px 13px', minWidth: 190,
          boxShadow: '0 8px 24px rgba(0,0,0,0.22)' }}>
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.6)', marginBottom: 8, lineHeight: 1.4 }}>
            Awaiting carrier collection scan
          </div>
          {list.length > 0
            ? list.slice(0, 8).map((c, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 18, fontSize: 12.5, padding: '3px 0' }}>
                  <span style={{ color: 'rgba(255,255,255,0.88)' }}>{prettyCourier(c.courier_name || c.courier_code)}</span>
                  <span style={{ fontWeight: 700 }}>{c.count}</span>
                </div>
              ))
            : <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>No parcels currently awaiting collection.</div>}
        </div>
      )}
    </Card>
  );
}

function AllCustomersModal({ period, metric, dateParam, periodLabel, onClose, navigate }) {
  const unit = metric === 'items' ? 'items' : 'parcels';
  const { data } = useQuery({
    queryKey: ['volume-all', period, metric, dateParam],
    queryFn: () => volumeLeaderboard({ period, metric, sort: 'volume', limit: 500, date: dateParam }),
  });
  const rows = (data?.rows || []).filter(r => r.current > 0).sort((a, b) => b.current - a.current);
  const total = rows.reduce((a, r) => a + r.current, 0);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 100 }}>
      <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 0, right: 0, height: '100%', width: 520, maxWidth: '94vw', background: '#fff', boxShadow: '-8px 0 24px rgba(0,0,0,0.12)', padding: 24, overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: TITLE }}>All customers shipping {periodLabel}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED }}><X size={18} /></button>
        </div>
        <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 14 }}>{rows.length} customers · {total.toLocaleString()} {unit} total</div>
        {rows.map((c, i) => (
          <div key={c.id} className="c9-row" onClick={() => navigate(`/customers/${c.id}`)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 6px', cursor: 'pointer', borderTop: i ? '1px solid rgba(16,24,40,0.05)' : 'none', borderRadius: 6 }}>
            <span style={{ width: 22, fontSize: 12, fontWeight: 700, color: '#94A3B8' }}>{i + 1}</span>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: TITLE, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.business_name}</span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: HEADER }}>{c.current.toLocaleString()} <span style={{ fontWeight: 500, color: MUTED, fontSize: 11 }}>{unit}</span></span>
          </div>
        ))}
        {rows.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>No customers shipped in this period.</div>}
      </div>
    </div>
  );
}

function Leaderboard({ data, metric, sort, setSort, navigate, period, dateParam, periodLabel }) {
  const rows = data?.rows || [];
  const unit = metric === 'items' ? 'items' : 'parcels';
  const [showAll, setShowAll] = useState(false);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14.5, fontWeight: 700, color: TITLE }}>Top customers</span>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <div style={{ display: 'inline-flex', background: '#F1F5F9', borderRadius: 8, padding: 3 }}>
            {[['volume', 'Top volume', Trophy], ['growth', 'Fastest growth', TrendingUp]].map(([v, l, Ic]) => (
              <button key={v} onClick={() => setSort(v)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, padding: '5px 9px',
                borderRadius: 6, border: 'none', cursor: 'pointer', background: sort === v ? '#fff' : 'transparent',
                color: sort === v ? ACCENT : MUTED, boxShadow: sort === v ? CARD_SHADOW : 'none' }}>
                <Ic size={13} /> {l}
              </button>
            ))}
          </div>
          <button onClick={() => setShowAll(true)} title="See all customers shipping in this period" style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, padding: '5px 9px',
            borderRadius: 7, border: '1px solid #E2E8F0', background: '#fff', cursor: 'pointer', color: TITLE }}>
            <Maximize2 size={12} /> View all
          </button>
        </div>
      </div>
      {showAll && <AllCustomersModal period={period} metric={metric} dateParam={dateParam} periodLabel={periodLabel} onClose={() => setShowAll(false)} navigate={navigate} />}
      {rows.length === 0
        ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '20px 0', color: '#94A3B8' }}>
            <ListeningPill /><span style={{ fontSize: 12 }}>No customer volume yet.</span></div>
        : <div>
            {rows.map((c, i) => {
              const g = c.growth_pct;
              const tone = g == null ? 'grey' : g >= 0 ? 'green' : 'amber';
              const Tri = g == null ? Minus : g >= 0 ? TrendingUp : TrendingDown;
              const label = g == null ? 'New' : `${g >= 0 ? '+' : ''}${g}%`;
              return (
                <div key={c.id} className="c9-row" onClick={() => navigate(`/customers/${c.id}`)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 6px', cursor: 'pointer',
                    borderTop: i ? '1px solid rgba(16,24,40,0.05)' : 'none', borderRadius: 6 }}>
                  <span style={{ width: 18, fontSize: 12, fontWeight: 700, color: '#94A3B8' }}>{i + 1}</span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: TITLE, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.business_name}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: HEADER, minWidth: 90, textAlign: 'right' }}>
                    {c.current.toLocaleString()} <span style={{ fontWeight: 500, color: MUTED, fontSize: 11 }}>{unit}</span>
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, minWidth: 56, justifyContent: 'flex-end', fontSize: 12, fontWeight: 700, color: TONE[tone].fg }}>
                    <Tri size={13} /> {label}
                  </span>
                </div>
              );
            })}
          </div>}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);
  const [period, setPeriod] = useState('day');
  const [metric, setMetric] = useState('parcels');
  const [boardSort, setBoardSort] = useState('volume');
  const isoOf = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const todayStr = isoOf(new Date());
  const minStr = isoOf(new Date(Date.now() - 90 * 86400000));
  const [customDate, setCustomDate] = useState(todayStr);
  const dateParam = period === 'custom' ? customDate : null;
  const [excluded, setExcluded] = useState(() => {
    try { return JSON.parse(localStorage.getItem('c9_dash_excluded') || '[]'); } catch { return []; }
  });
  const [showExclude, setShowExclude] = useState(false);
  const toggleExcluded = (id) => setExcluded(prev => {
    const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
    localStorage.setItem('c9_dash_excluded', JSON.stringify(next));
    return next;
  });

  const { data: stats }  = useQuery({ queryKey: ['tracking-stats'], queryFn: () => api.get('/tracking/stats').then(r => r.data) });
  const { data: notifs } = useQuery({ queryKey: ['dashboard-notifs'], queryFn: () => listNotifications({ limit: 7 }) });
  const { data: customers } = useQuery({ queryKey: ['customers-list'], queryFn: () => listCustomers({ limit: 500, sort: 'business_name', order: 'asc' }) });
  const { data: trend }  = useQuery({ queryKey: ['volume-trend', period, dateParam, excluded], queryFn: () => volumeTrend(period, dateParam, excluded) });
  const { data: board }  = useQuery({ queryKey: ['volume-leaderboard', period, metric, boardSort, dateParam, excluded], queryFn: () => volumeLeaderboard({ period, metric, sort: boardSort, date: dateParam, exclude: excluded }) });
  const custList = Array.isArray(customers) ? customers : (customers?.data || customers?.rows || customers?.customers || []);

  const byStatus = stats?.by_status || {};
  const statusRows = Object.entries(byStatus).sort((a, b) => b[1] - a[1]);
  const pending = byStatus.booked || 0;
  const todayWd = WD[new Date().getDay()];
  const hasTrend = trend && (trend.mode === 'bars'
    ? trend.series.some(s => s.parcels > 0 || s.items > 0)
    : [...(trend.current || []), ...(trend.previous || [])].some(d => d && (d.parcels > 0 || d.items > 0)));
  const cur = trend?.totals?.current  || { parcels: 0, items: 0, picks: 0 };
  const prv = trend?.totals?.previous || { parcels: 0, items: 0, picks: 0 };
  const prettyCustom = new Date(`${customDate}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const periodNoun = period === 'custom' ? `on ${prettyCustom}` : (PERIOD_NOUN[period] || `this ${period}`);
  const vsNoun     = period === 'custom' ? 'prev day' : (VS_NOUN[period] || `last ${period}`);
  const tc = cur[metric] ?? 0;
  const tp = prv[metric] ?? 0;
  const trendPct = tp > 0 ? Math.round(((tc - tp) / tp) * 1000) / 10 : (tc > 0 ? null : 0);

  async function runHelmSync() {
    setSyncing(true); setSyncMsg(null);
    try {
      await api.post('/helm/sync/customers');
      await api.post('/helm/sync/volume?days=60');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['volume-summary'] }),
        qc.invalidateQueries({ queryKey: ['volume-trend'] }),
        qc.invalidateQueries({ queryKey: ['volume-leaderboard'] }),
        qc.invalidateQueries({ queryKey: ['customers'] }),
      ]);
    } catch (e) {
      setSyncMsg(e?.response?.data?.error || 'Sync failed — check your Helm settings.');
    } finally { setSyncing(false); }
  }

  return (
    <div style={{ width: '100%' }}>
      <style>{STYLE}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 22 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: HEADER, margin: '0 0 4px', letterSpacing: -0.6 }}>Cloud9 Command Centre</h1>
          <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>Live operational view across all 3PL activity.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Seg value={metric} onChange={setMetric} options={[{ v: 'parcels', l: 'Parcels' }, { v: 'items', l: 'Items' }]} />
          <Seg value={period} onChange={setPeriod} options={[{ v: 'day', l: 'Day' }, { v: 'yesterday', l: 'Yesterday' }, { v: 'week', l: 'Week' }, { v: 'month', l: 'Month' }, { v: 'quarter', l: 'Quarter' }, { v: 'custom', l: 'Custom' }]} />
          {period === 'custom' && (
            <input type="date" value={customDate} min={minStr} max={todayStr}
              onChange={e => setCustomDate(e.target.value || todayStr)}
              style={{ border: '1px solid #E2E8F0', borderRadius: 9, padding: '7px 10px', fontSize: 12.5, fontWeight: 600, color: TITLE, fontFamily: 'inherit' }} />
          )}
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShowExclude(s => !s)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid #E2E8F0',
              background: excluded.length ? '#EEF4FF' : '#fff', cursor: 'pointer', borderRadius: 9,
              padding: '7px 11px', fontSize: 12.5, fontWeight: 600, color: excluded.length ? ACCENT : TITLE }}>
              <Filter size={13} /> {excluded.length ? `Excluding ${excluded.length}` : 'Exclude customers'}
            </button>
            {showExclude && (
              <>
                <div onClick={() => setShowExclude(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                <div style={{ position: 'absolute', top: '112%', right: 0, width: 290, maxHeight: 380, overflowY: 'auto', background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, boxShadow: CARD_SHADOW, zIndex: 50, padding: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px 8px' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: TITLE }}>Exclude from stats</span>
                    {excluded.length > 0 && <span onClick={() => { setExcluded([]); localStorage.setItem('c9_dash_excluded', '[]'); }} style={{ fontSize: 11.5, color: ACCENT, cursor: 'pointer', fontWeight: 600 }}>Clear all</span>}
                  </div>
                  {custList.map(c => (
                    <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 8px', fontSize: 12.5, cursor: 'pointer', borderRadius: 6 }}>
                      <input type="checkbox" checked={excluded.includes(c.id)} onChange={() => toggleExcluded(c.id)} />
                      <span style={{ color: TITLE }}>{c.business_name}</span>
                    </label>
                  ))}
                  {custList.length === 0 && <div style={{ padding: 8, fontSize: 12, color: MUTED }}>No customers loaded.</div>}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="c9-rows">
        {/* ROW 1 — stats */}
        <div className="c9-r1">
          <StatCard Icon={Send}  label={`Parcels ${periodNoun}`} value={cur.parcels.toLocaleString()} color={ACCENT}
            pill={pctPill(cur.parcels, prv.parcels, vsNoun)} />
          <StatCard Icon={Boxes} label={`Items ${periodNoun}`} value={cur.items.toLocaleString()} color="#7B2FBE"
            pill={pctPill(cur.items, prv.items, vsNoun)} />
          <StatCard Icon={Hand}  label={`Waves ${periodNoun}`} value={cur.picks.toLocaleString()} color="#00BCD4"
            pill={pctPill(cur.picks, prv.picks, vsNoun)} />
          <PendingCard total={pending} byCourier={stats?.pending_by_courier} />
        </div>

        {/* ROW 2 — analytics 60 / 40 */}
        <div className="c9-r2">
          <Card>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: TITLE, marginBottom: 10 }}>Dispatch volume &amp; trends</div>
            {hasTrend && (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 26, fontWeight: 800, color: HEADER, letterSpacing: -0.6 }}>{tc.toLocaleString()}</span>
                <span style={{ fontSize: 12, color: MUTED }}>{metric} {CUR_LABEL[period].toLowerCase()}</span>
                <Pill tone={trendPct == null ? 'green' : trendPct >= 0 ? 'green' : 'amber'}
                  text={trendPct == null ? `New vs ${PREV_LABEL[period].toLowerCase()}` : `${trendPct >= 0 ? '+' : ''}${trendPct}% vs ${PREV_LABEL[period].toLowerCase()} (${tp.toLocaleString()})`} />
              </div>
            )}
            {hasTrend ? <TrendChart trend={trend} metric={metric} /> : (
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
            <Leaderboard data={board} metric={metric} sort={boardSort} setSort={setBoardSort} navigate={navigate} period={period} dateParam={dateParam} periodLabel={periodNoun} />
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
