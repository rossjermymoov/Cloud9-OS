import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ScanBarcode, RefreshCw, Gauge, Boxes, Timer, ListChecks, Trophy, Medal } from 'lucide-react';
import {
  pickingSummary, pickingDaily, pickingLeaderboard, pickingFreshness, triggerPickSync,
} from '../../api/picking';

const HEADER = '#0B1220', TITLE = '#0F172A', MUTED = '#64748B', ACCENT = '#0056FB';
const GREEN = '#10B981', GREEN_HOVER = '#34D399';
const SHADOW = '0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.10)';

const PERIODS = [
  { v: 'day', l: 'Today' }, { v: 'yesterday', l: 'Yesterday' }, { v: 'week', l: 'Week' },
  { v: 'month', l: 'Month' }, { v: 'quarter', l: 'Quarter' }, { v: 'custom', l: 'Custom' },
];
const isoOf = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

function Seg({ value, onChange, options }) {
  return (
    <div style={{ display: 'inline-flex', background: '#F1F5F9', borderRadius: 9, padding: 3 }}>
      {options.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)}
          style={{
            border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
            padding: '6px 12px', borderRadius: 7,
            background: value === o.v ? '#fff' : 'transparent',
            color: value === o.v ? TITLE : MUTED,
            boxShadow: value === o.v ? '0 1px 2px rgba(16,24,40,0.10)' : 'none',
          }}>{o.l}</button>
      ))}
    </div>
  );
}

function Card({ children, style }) {
  return <div style={{ background: '#fff', borderRadius: 14, boxShadow: SHADOW, padding: 18, ...style }}>{children}</div>;
}

function fmtDuration(secs) {
  if (secs == null) return '—';
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60), s = secs % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function Kpi({ Icon, label, value, sub, headline }) {
  return (
    <Card style={headline ? { background: 'linear-gradient(135deg,#0B1220,#1E293B)', color: '#fff' } : {}}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Icon size={16} strokeWidth={1.9} color={headline ? GREEN_HOVER : ACCENT} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: headline ? 'rgba(255,255,255,0.7)' : MUTED }}>{label}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.8, color: headline ? '#fff' : HEADER }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: headline ? 'rgba(255,255,255,0.55)' : '#94A3B8', marginTop: 2 }}>{sub}</div>}
    </Card>
  );
}

function DailyChart({ days }) {
  const [hover, setHover] = useState(null);
  if (!days?.length) return <div style={{ fontSize: 12.5, color: '#94A3B8', padding: '40px 0', textAlign: 'center' }}>No picks in this period.</div>;
  const max = Math.max(...days.map(d => d.picks), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 180, paddingTop: 10 }}>
      {days.map((d, i) => {
        const h = Math.round((d.picks / max) * 150) + 2;
        const isHover = hover === i;
        const label = new Date(d.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
        return (
          <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 0 }}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <div style={{ fontSize: 11, fontWeight: 700, color: isHover ? GREEN : TITLE, height: 14 }}>{isHover ? `${d.picks} · ${d.items} items` : d.picks}</div>
            <div style={{ width: '100%', maxWidth: 46, height: h, borderRadius: 7, background: isHover ? GREEN_HOVER : GREEN, transition: 'all .12s' }} />
            <div style={{ fontSize: 10.5, color: '#94A3B8', whiteSpace: 'nowrap' }}>{label}</div>
          </div>
        );
      })}
    </div>
  );
}

function Leaderboard({ rows }) {
  if (!rows?.length) return <div style={{ fontSize: 12.5, color: '#94A3B8', padding: '30px 0', textAlign: 'center' }}>No completed picks attributed to a picker yet.</div>;
  const RANK = ['#F59E0B', '#94A3B8', '#B45309'];
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ color: '#94A3B8', textAlign: 'left', fontSize: 11.5 }}>
          <th style={{ padding: '8px 6px' }}>#</th>
          <th style={{ padding: '8px 6px' }}>Picker</th>
          <th style={{ padding: '8px 6px', textAlign: 'right', color: GREEN }}>Items / hr</th>
          <th style={{ padding: '8px 6px', textAlign: 'right' }}>Items</th>
          <th style={{ padding: '8px 6px', textAlign: 'right' }}>Picks</th>
          <th style={{ padding: '8px 6px', textAlign: 'right' }}>Avg / pick</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.picker_id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
            <td style={{ padding: '10px 6px' }}>
              {i < 3 ? <Medal size={16} color={RANK[i]} /> : <span style={{ color: '#94A3B8' }}>{i + 1}</span>}
            </td>
            <td style={{ padding: '10px 6px', fontWeight: 600, color: TITLE }}>{r.picker_name}</td>
            <td style={{ padding: '10px 6px', textAlign: 'right', fontWeight: 800, color: GREEN }}>{r.items_per_hour ?? '—'}</td>
            <td style={{ padding: '10px 6px', textAlign: 'right', color: '#334155' }}>{r.items.toLocaleString()}</td>
            <td style={{ padding: '10px 6px', textAlign: 'right', color: '#334155' }}>{r.picks}</td>
            <td style={{ padding: '10px 6px', textAlign: 'right', color: MUTED }}>{fmtDuration(r.avg_secs_per_pick)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function PickingPage() {
  const [period, setPeriod] = useState('week');
  const [syncing, setSyncing] = useState(false);
  const qc = useQueryClient();
  const todayStr = isoOf(new Date());
  const minStr = isoOf(new Date(Date.now() - 90 * 86400000));
  const [customDate, setCustomDate] = useState(todayStr);
  const dateParam = period === 'custom' ? customDate : null;

  const summary = useQuery({ queryKey: ['picking', 'summary', period, dateParam], queryFn: () => pickingSummary(period, dateParam) });
  const daily   = useQuery({ queryKey: ['picking', 'daily', period, dateParam], queryFn: () => pickingDaily(period, dateParam) });
  const board   = useQuery({ queryKey: ['picking', 'leaderboard', period, dateParam], queryFn: () => pickingLeaderboard(period, dateParam) });
  const fresh   = useQuery({ queryKey: ['picking', 'freshness'], queryFn: pickingFreshness });

  const s = summary.data;
  const hasData = (s?.picks || 0) > 0 || (board.data?.rows?.length || 0) > 0;

  async function runSync() {
    setSyncing(true);
    try {
      await triggerPickSync(90);
      // Give the background job a moment, then refresh.
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['picking'] });
        setSyncing(false);
      }, 6000);
    } catch { setSyncing(false); }
  }

  const lastSync = fresh.data?.ran_at ? new Date(fresh.data.ran_at).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : null;

  return (
    <div style={{ padding: '24px 30px', maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: HEADER, margin: '0 0 4px', letterSpacing: -0.6, display: 'flex', alignItems: 'center', gap: 9 }}>
            <ScanBarcode size={22} /> Picking
          </h1>
          <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>
            Warehouse pick throughput and picker performance.
            {lastSync && <span style={{ color: '#94A3B8' }}> · Auto-syncs hourly · Last synced {lastSync}</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Seg value={period} onChange={setPeriod} options={PERIODS} />
          {period === 'custom' && (
            <input type="date" value={customDate} min={minStr} max={todayStr}
              onChange={e => setCustomDate(e.target.value || todayStr)}
              style={{ border: '1px solid #E2E8F0', borderRadius: 9, padding: '7px 10px', fontSize: 12.5, fontWeight: 600, color: TITLE, fontFamily: 'inherit' }} />
          )}
          <button onClick={runSync} disabled={syncing}
            style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1px solid #E2E8F0', background: '#fff', cursor: syncing ? 'default' : 'pointer', borderRadius: 9, padding: '8px 13px', fontSize: 12.5, fontWeight: 600, color: TITLE, opacity: syncing ? 0.6 : 1 }}>
            <RefreshCw size={14} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} /> {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      </div>

      {!hasData && !summary.isLoading ? (
        <Card style={{ textAlign: 'center', padding: '54px 24px' }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: '#ECFDF5', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <ScanBarcode size={26} color={GREEN} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: TITLE, marginBottom: 6 }}>No picking data yet</div>
          <div style={{ fontSize: 13.5, color: MUTED, maxWidth: 440, margin: '0 auto 18px' }}>
            Pull completed picks from Helm to see how many picks were done, items per pick, time per pick and your best pickers.
          </div>
          <button onClick={runSync} disabled={syncing}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: 'none', background: GREEN, color: '#fff', cursor: syncing ? 'default' : 'pointer', borderRadius: 10, padding: '11px 20px', fontSize: 13.5, fontWeight: 700, opacity: syncing ? 0.6 : 1 }}>
            <RefreshCw size={15} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} /> {syncing ? 'Pulling picks…' : 'Pull picking data'}
          </button>
        </Card>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14, marginBottom: 16 }}>
            <Kpi headline Icon={Gauge} label="Items per hour" value={s?.items_per_hour ?? '—'} sub="Throughput across all pickers" />
            <Kpi Icon={ListChecks} label="Picks completed" value={s?.picks ?? '—'} sub={s?.orders ? `${s.orders} orders` : null} />
            <Kpi Icon={Boxes} label="Items picked" value={(s?.items ?? 0).toLocaleString()} sub={s?.avg_items_per_pick != null ? `${s.avg_items_per_pick} per pick` : null} />
            <Kpi Icon={Timer} label="Avg time per pick" value={fmtDuration(s?.avg_secs_per_pick)} sub="Active handling time" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Card>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: TITLE, marginBottom: 6 }}>Picks per day</div>
              <DailyChart days={daily.data?.days} />
            </Card>
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Trophy size={16} color="#F59E0B" />
                <span style={{ fontSize: 14.5, fontWeight: 700, color: TITLE }}>Picker leaderboard</span>
                <span style={{ fontSize: 11.5, color: '#94A3B8' }}>· by items / hour</span>
              </div>
              <Leaderboard rows={board.data?.rows} />
            </Card>
          </div>
        </>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
