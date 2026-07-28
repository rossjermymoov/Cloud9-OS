import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, Minus, LineChart } from 'lucide-react';
import { volumeAnalytics } from '../../api/volume';
import CustomerExcludeFilter, { useExcludedCustomers } from '../../components/CustomerExcludeFilter';

const HEADER = '#0B1220', TITLE = '#0F172A', MUTED = '#64748B', ACCENT = '#0056FB';
const GREEN = '#16A34A', RED = '#DC2626', AMBER = '#D97706';
const SHADOW = '0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.10)';

// A customer's own volume: more than its recent baseline is good (green),
// less is a warning (red), roughly flat is steady (amber). Ross's RAG.
function trendInfo(cur, avg) {
  if (avg == null || avg <= 0) return { pct: null, colour: MUTED, Icon: Minus, label: cur > 0 ? 'New' : '—' };
  const pct = ((cur - avg) / avg) * 100;
  if (pct >= 5)  return { pct, colour: GREEN, Icon: TrendingUp,   label: `+${pct.toFixed(0)}%` };
  if (pct <= -5) return { pct, colour: RED,   Icon: TrendingDown, label: `${pct.toFixed(0)}%` };
  return { pct, colour: AMBER, Icon: Minus, label: `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%` };
}

const yoyPct = (cur, yoy) => (yoy && yoy > 0 ? ((cur - yoy) / yoy) * 100 : null);

function Toggle({ options, value, onChange }) {
  return (
    <div style={{ display: 'inline-flex', background: '#F1F5F9', borderRadius: 9, padding: 3 }}>
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)} style={{
          border: 'none', cursor: 'pointer', borderRadius: 7, padding: '6px 13px', fontSize: 12.5, fontWeight: 600,
          background: value === o.value ? '#fff' : 'transparent', color: value === o.value ? TITLE : MUTED,
          boxShadow: value === o.value ? SHADOW : 'none' }}>{o.label}</button>
      ))}
    </div>
  );
}

export default function StatisticsPage() {
  const [mode, setMode] = useState('weekly');       // weekly | monthly
  const [metric, setMetric] = useState('parcels');  // parcels | items
  const [sort, setSort] = useState('trend');        // trend | current | yoy | name
  const { excluded, toggle, clear } = useExcludedCustomers();

  const { data, isLoading } = useQuery({
    queryKey: ['volume-analytics', mode, excluded],
    queryFn: () => volumeAnalytics({ mode, exclude: excluded }),
  });

  const periodLabel = mode === 'weekly' ? 'week' : 'month';
  const avgLabel = mode === 'weekly' ? '13-week avg' : '12-month avg';

  const rows = useMemo(() => {
    const raw = (data?.rows || []).map(r => {
      const cur = metric === 'parcels' ? r.cur_parcels : r.cur_items;
      const avg = metric === 'parcels' ? r.avg_parcels : r.avg_items;
      const yoy = metric === 'parcels' ? r.yoy_parcels : r.yoy_items;
      return { id: r.id, name: r.business_name, cur, avg, yoy, ti: trendInfo(cur, avg), yp: yoyPct(cur, yoy) };
    }).filter(r => r.cur > 0 || r.avg > 0 || r.yoy > 0);   // hide dormant customers
    const s = [...raw];
    if (sort === 'trend')   s.sort((a, b) => (b.ti.pct ?? -1e9) - (a.ti.pct ?? -1e9));
    if (sort === 'current') s.sort((a, b) => b.cur - a.cur);
    if (sort === 'yoy')     s.sort((a, b) => (b.yp ?? -1e9) - (a.yp ?? -1e9));
    if (sort === 'name')    s.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return s;
  }, [data, metric, sort]);

  const up = rows.filter(r => r.ti.pct != null && r.ti.pct >= 5).length;
  const down = rows.filter(r => r.ti.pct != null && r.ti.pct <= -5).length;
  const totalCur = rows.reduce((a, r) => a + r.cur, 0);

  const th = { textAlign: 'right', padding: '10px 14px', fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' };
  const td = { padding: '12px 14px', fontSize: 13.5, textAlign: 'right', color: TITLE, borderTop: '1px solid #F1F5F9', whiteSpace: 'nowrap' };

  return (
    <div style={{ width: '100%', maxWidth: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: HEADER, margin: '0 0 4px', letterSpacing: -0.6, display: 'flex', alignItems: 'center', gap: 9 }}>
            <LineChart size={22} /> Statistics
          </h1>
          <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>
            Per-customer volume trends — last {periodLabel} vs {avgLabel}, with year-on-year
            {data?.period_start ? <span style={{ color: '#94A3B8' }}> · last {periodLabel} starting {data.period_start}</span> : ''}
          </p>
        </div>
        <CustomerExcludeFilter excluded={excluded} toggle={toggle} clear={clear} />
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <Toggle options={[{ value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }]} value={mode} onChange={setMode} />
        <Toggle options={[{ value: 'parcels', label: 'Parcels' }, { value: 'items', label: 'Items' }]} value={metric} onChange={setMetric} />
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Chip colour={GREEN} label={`${up} trending up`} />
          <Chip colour={RED} label={`${down} trending down`} />
          <Chip colour={MUTED} label={`${rows.length} customers`} />
        </div>
      </div>

      <div style={{ background: '#fff', borderRadius: 14, boxShadow: SHADOW, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC' }}>
                <th style={{ ...th, textAlign: 'left' }} onClick={() => setSort('name')}>Customer</th>
                <th style={th} onClick={() => setSort('current')}>Last {periodLabel}</th>
                <th style={th}>{avgLabel}</th>
                <th style={th} onClick={() => setSort('trend')}>Trend</th>
                <th style={th}>Same {periodLabel} last yr</th>
                <th style={th} onClick={() => setSort('yoy')}>YoY</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} style={{ padding: '40px 14px', textAlign: 'center', color: MUTED, fontSize: 13 }}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: '40px 14px', textAlign: 'center', color: MUTED, fontSize: 13 }}>No volume data yet for this period.</td></tr>
              ) : rows.map(r => {
                const { Icon } = r.ti;
                return (
                  <tr key={r.id}>
                    <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{r.name || '—'}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{r.cur.toLocaleString()}</td>
                    <td style={{ ...td, color: MUTED }}>{Number(r.avg).toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                    <td style={td}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: r.ti.colour, fontWeight: 700 }}>
                        <Icon size={15} /> {r.ti.label}
                      </span>
                    </td>
                    <td style={{ ...td, color: r.yoy ? TITLE : '#CBD5E1' }}>{r.yoy ? r.yoy.toLocaleString() : '—'}</td>
                    <td style={td}>
                      {r.yp == null ? <span style={{ color: '#CBD5E1' }}>—</span> : (
                        <span style={{ color: r.yp >= 5 ? GREEN : r.yp <= -5 ? RED : AMBER, fontWeight: 700 }}>
                          {r.yp >= 0 ? '+' : ''}{r.yp.toFixed(0)}%
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p style={{ fontSize: 11.5, color: '#94A3B8', margin: '12px 2px 0' }}>
        Trend compares last {periodLabel} against the {avgLabel} (a rolling baseline).
        Green = above baseline, red = below, amber = roughly steady (within 5%). YoY compares the same {periodLabel} one year earlier — shows “—” until a year of history exists.
      </p>
    </div>
  );
}

function Chip({ colour, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 999, padding: '5px 11px', fontSize: 12, fontWeight: 600, color: TITLE }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: colour }} /> {label}
    </span>
  );
}
