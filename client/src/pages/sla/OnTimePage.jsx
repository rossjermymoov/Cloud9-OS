import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, RefreshCw, AlertTriangle, CheckCircle2, Hourglass, Settings2, Save } from 'lucide-react';
import { slaSummary, slaBreaches, slaCutoffs, setCutoff, slaFreshness, triggerSlaSync } from '../../api/sla';

const HEADER = '#0B1220', TITLE = '#0F172A', MUTED = '#64748B', ACCENT = '#0056FB';
const GREEN = '#10B981', RED = '#E11D48', AMBER = '#F59E0B';
const SHADOW = '0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.10)';

const PERIODS = [
  { v: 'day', l: 'Today' }, { v: 'yesterday', l: 'Yesterday' }, { v: 'week', l: 'Week' },
  { v: 'month', l: 'Month' }, { v: 'quarter', l: 'Quarter' },
];
const STATUS = {
  on_time:        { l: 'On time',  c: GREEN },
  breach_late:    { l: 'Shipped late', c: RED },
  breach_overdue: { l: 'Overdue — not shipped', c: RED },
  pending:        { l: 'Pending', c: AMBER },
};

function Seg({ value, onChange, options }) {
  return (
    <div style={{ display: 'inline-flex', background: '#F1F5F9', borderRadius: 9, padding: 3 }}>
      {options.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)} style={{
          border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 7,
          background: value === o.v ? '#fff' : 'transparent', color: value === o.v ? TITLE : MUTED,
          boxShadow: value === o.v ? '0 1px 2px rgba(16,24,40,0.10)' : 'none',
        }}>{o.l}</button>
      ))}
    </div>
  );
}
function Card({ children, style }) {
  return <div style={{ background: '#fff', borderRadius: 14, boxShadow: SHADOW, padding: 18, ...style }}>{children}</div>;
}
function Kpi({ Icon, label, value, color, sub }) {
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Icon size={16} strokeWidth={1.9} color={color || ACCENT} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: MUTED }}>{label}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.8, color: color || HEADER }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>{sub}</div>}
    </Card>
  );
}
const fmtDT = (d) => d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const fmtD  = (d) => d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '—';

function CutoffEditor({ onClose }) {
  const qc = useQueryClient();
  const { data: rows } = useQuery({ queryKey: ['sla-cutoffs'], queryFn: slaCutoffs });
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(null);

  async function save(id) {
    const val = edits[id];
    if (!val) return;
    setSaving(id);
    try { await setCutoff(id, val); await qc.invalidateQueries({ queryKey: ['sla-cutoffs'] }); qc.invalidateQueries({ queryKey: ['sla'] }); }
    finally { setSaving(null); }
  }
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 100 }}>
      <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 0, right: 0, height: '100%', width: 440, maxWidth: '92vw', background: '#fff', boxShadow: '-8px 0 24px rgba(0,0,0,0.12)', padding: 24, overflowY: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: TITLE, marginBottom: 4 }}>Customer cutoff times</div>
        <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 16 }}>Orders received before the cutoff on a working day must ship that day. Default 14:00.</div>
        {(rows || []).map(c => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
            <div style={{ flex: 1, fontSize: 13, color: TITLE }}>{c.business_name}</div>
            <input type="time" defaultValue={(c.cutoff_time || '14:00:00').slice(0, 5)}
              onChange={e => setEdits(p => ({ ...p, [c.id]: e.target.value }))}
              style={{ border: '1px solid #E2E8F0', borderRadius: 8, padding: '5px 8px', fontSize: 13, fontFamily: 'inherit' }} />
            <button onClick={() => save(c.id)} disabled={!edits[c.id] || saving === c.id}
              style={{ border: 'none', background: edits[c.id] ? ACCENT : '#E2E8F0', color: edits[c.id] ? '#fff' : '#94A3B8', borderRadius: 8, padding: '6px 9px', cursor: edits[c.id] ? 'pointer' : 'default', display: 'flex', alignItems: 'center' }}>
              <Save size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function OnTimePage() {
  const [period, setPeriod] = useState('week');
  const [view, setView] = useState('breaches');
  const [showCutoffs, setShowCutoffs] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const qc = useQueryClient();

  const summary = useQuery({ queryKey: ['sla', 'summary', period], queryFn: () => slaSummary(period) });
  const data    = useQuery({ queryKey: ['sla', 'breaches', period, view], queryFn: () => slaBreaches(period, { view }) });
  const fresh   = useQuery({ queryKey: ['sla', 'freshness'], queryFn: slaFreshness });
  const s = summary.data;

  async function runSync() {
    setSyncing(true);
    try { await triggerSlaSync(14); setTimeout(() => { qc.invalidateQueries({ queryKey: ['sla'] }); setSyncing(false); }, 7000); }
    catch { setSyncing(false); }
  }
  const lastSync = fresh.data?.ran_at ? new Date(fresh.data.ran_at).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : null;

  return (
    <div style={{ width: '100%', maxWidth: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: HEADER, margin: '0 0 4px', letterSpacing: -0.6, display: 'flex', alignItems: 'center', gap: 9 }}>
            <Clock size={22} /> On-Time Dispatch
          </h1>
          <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>
            Cutoff breaches by customer and order, accounting for weekends &amp; UK bank holidays.
            {lastSync && <span style={{ color: '#94A3B8' }}> · Orders synced {lastSync}</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Seg value={period} onChange={setPeriod} options={PERIODS} />
          <button onClick={() => setShowCutoffs(true)} style={iconBtn}><Settings2 size={14} /> Cutoffs</button>
          <button onClick={runSync} disabled={syncing} style={{ ...iconBtn, opacity: syncing ? 0.6 : 1 }}>
            <RefreshCw size={14} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} /> {syncing ? 'Syncing…' : 'Sync'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14, marginBottom: 16 }}>
        <Kpi Icon={CheckCircle2} label="On-time rate" value={s?.on_time_pct != null ? `${s.on_time_pct}%` : '—'} color={GREEN} sub={s ? `${s.on_time} of ${s.on_time + s.breaches} resolved` : null} />
        <Kpi Icon={AlertTriangle} label="Breaches" value={s?.breaches ?? '—'} color={RED} sub={s ? `${s.breach_overdue} overdue · ${s.breach_late} late` : null} />
        <Kpi Icon={Hourglass} label="Pending (at risk)" value={s?.pending ?? '—'} color={AMBER} sub="Not shipped, still in SLA" />
        <Kpi Icon={Clock} label="Orders assessed" value={s?.assessed ?? '—'} sub="Received in period" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16 }}>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 14.5, fontWeight: 700, color: TITLE }}>Orders</span>
            <Seg value={view} onChange={setView} options={[{ v: 'breaches', l: 'Breaches' }, { v: 'pending', l: 'Pending' }, { v: 'all', l: 'All' }]} />
          </div>
          <div style={{ maxHeight: 460, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr style={{ color: '#94A3B8', textAlign: 'left', fontSize: 11.5, position: 'sticky', top: 0, background: '#fff' }}>
                <th style={{ padding: '8px 6px' }}>Customer</th><th style={{ padding: '8px 6px' }}>Order</th>
                <th style={{ padding: '8px 6px' }}>Received</th><th style={{ padding: '8px 6px' }}>Due by</th>
                <th style={{ padding: '8px 6px' }}>Status</th><th style={{ padding: '8px 6px', textAlign: 'right' }}>Packed parcels</th>
              </tr></thead>
              <tbody>
                {(data.data?.rows || []).map(r => {
                  const st = STATUS[r.sla_status] || { l: r.sla_status, c: MUTED };
                  return (
                    <tr key={r.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                      <td style={{ padding: '9px 6px', color: TITLE, fontWeight: 600 }}>{r.business_name}</td>
                      <td style={{ padding: '9px 6px', color: MUTED }}>{r.order_ref}</td>
                      <td style={{ padding: '9px 6px', color: MUTED, whiteSpace: 'nowrap' }}>{fmtDT(r.received_at)}</td>
                      <td style={{ padding: '9px 6px', color: '#334155', whiteSpace: 'nowrap' }}>{fmtD(r.due)}</td>
                      <td style={{ padding: '9px 6px' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 600, color: st.c }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: st.c }} />{st.l}{r.sla_status === 'breach_late' && r.dispatched_at ? ` (${fmtD(r.dispatched_at.slice(0,10))})` : ''}</span></td>
                      <td style={{ padding: '9px 6px', textAlign: 'right' }}>
                        {(!r.parcels && r.sla_status === 'breach_overdue')
                          ? <span title="No parcels yet — hasn't been through a packing station" style={{ fontSize: 11, fontWeight: 700, color: '#64748B', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap' }}>Pending pack</span>
                          : <span style={{ color: '#334155' }}>{r.parcels}</span>}
                      </td>
                    </tr>
                  );
                })}
                {(!data.data?.rows?.length) && <tr><td colSpan={6} style={{ padding: 22, textAlign: 'center', color: '#94A3B8' }}>
                  {view === 'breaches' ? '🟢 No breaches in this period.' : 'Nothing to show.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: TITLE, marginBottom: 10 }}>By customer</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr style={{ color: '#94A3B8', textAlign: 'left', fontSize: 11.5 }}>
              <th style={{ padding: '7px 6px' }}>Customer</th>
              <th style={{ padding: '7px 6px', textAlign: 'right' }}>On-time</th>
              <th style={{ padding: '7px 6px', textAlign: 'right', color: RED }}>Breaches</th>
            </tr></thead>
            <tbody>
              {(data.data?.customers || []).map(c => (
                <tr key={c.customer_id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                  <td style={{ padding: '8px 6px', color: TITLE, fontWeight: 600 }}>{c.business_name}</td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', color: c.on_time_pct == null ? '#CBD5E1' : (c.on_time_pct >= 98 ? GREEN : c.on_time_pct >= 90 ? AMBER : RED), fontWeight: 700 }}>{c.on_time_pct == null ? '—' : `${c.on_time_pct}%`}</td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', color: c.breaches ? RED : '#94A3B8', fontWeight: 600 }}>{c.breaches}</td>
                </tr>
              ))}
              {(!data.data?.customers?.length) && <tr><td colSpan={3} style={{ padding: 18, textAlign: 'center', color: '#94A3B8' }}>No data yet.</td></tr>}
            </tbody>
          </table>
        </Card>
      </div>

      {showCutoffs && <CutoffEditor onClose={() => setShowCutoffs(false)} />}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const iconBtn = { display: 'flex', alignItems: 'center', gap: 7, border: '1px solid #E2E8F0', background: '#fff', cursor: 'pointer', borderRadius: 9, padding: '8px 13px', fontSize: 12.5, fontWeight: 600, color: TITLE };
