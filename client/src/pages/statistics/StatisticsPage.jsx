import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, Minus, LineChart, Database } from 'lucide-react';
import { volumeAnalytics } from '../../api/volume';
import api from '../../api/client';
import CustomerExcludeFilter, { useExcludedCustomers } from '../../components/CustomerExcludeFilter';

const PERIOD_CFG = {
  weekly:  { noun: 'week',    avg: '13-wk avg' },
  monthly: { noun: 'month',   avg: '12-mo avg' },
  quarter: { noun: 'quarter', avg: '4-qtr avg' },
  year:    { noun: 'year',    avg: '3-yr avg' },
};

const HEADER = '#0B1220', TITLE = '#0F172A', MUTED = '#64748B';
const GREEN = '#16A34A', RED = '#DC2626', AMBER = '#D97706';
const SHADOW = '0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.10)';
const ITEMS_TINT = '#FAFBFF';   // faint background so the Items group reads as a block

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

function TrendCell({ ti, tint }) {
  const { Icon } = ti;
  return (
    <td style={{ padding: '12px 14px', fontSize: 13.5, textAlign: 'right', borderTop: '1px solid #F1F5F9', whiteSpace: 'nowrap', background: tint }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: ti.colour, fontWeight: 700 }}>
        <Icon size={15} /> {ti.label}
      </span>
    </td>
  );
}

export default function StatisticsPage() {
  const [mode, setMode] = useState('weekly');   // weekly | monthly | quarter | year
  const [sort, setSort] = useState('p_trend');  // p_trend | i_trend | p_cur | i_cur | name
  const [bf, setBf] = useState(null);           // backfill status message
  const { excluded, toggle, clear } = useExcludedCustomers();

  const { data, isLoading } = useQuery({
    queryKey: ['volume-analytics', mode, excluded],
    queryFn: () => volumeAnalytics({ mode, exclude: excluded }),
  });

  const periodLabel = PERIOD_CFG[mode].noun;
  const avgLabel = PERIOD_CFG[mode].avg;

  async function runBackfill() {
    if (!window.confirm('Pull the full shipment history from Voila? This runs in the background and can take several minutes. The Statistics data will fill in as it completes.')) return;
    setBf('Starting…');
    try {
      await api.post('/voila/backfill', null, { params: { full: 1 } });
      setBf('Backfilling the full history in the background — this can take several minutes. Refresh later to see the extra weeks, months, quarters and years.');
    } catch (e) {
      setBf(e?.response?.data?.error || 'Could not start the backfill — check the Voila connection.');
    }
  }

  const rows = useMemo(() => {
    const raw = (data?.rows || []).map(r => ({
      id: r.id, name: r.business_name,
      pCur: r.cur_parcels, pAvg: r.avg_parcels, pYoy: r.yoy_parcels,
      iCur: r.cur_items,   iAvg: r.avg_items,   iYoy: r.yoy_items,
      pTi: trendInfo(r.cur_parcels, r.avg_parcels), iTi: trendInfo(r.cur_items, r.avg_items),
      pYp: yoyPct(r.cur_parcels, r.yoy_parcels),    iYp: yoyPct(r.cur_items, r.yoy_items),
    })).filter(r => r.pCur > 0 || r.pAvg > 0 || r.iCur > 0 || r.iAvg > 0);
    const s = [...raw];
    if (sort === 'p_trend') s.sort((a, b) => (b.pTi.pct ?? -1e9) - (a.pTi.pct ?? -1e9));
    if (sort === 'i_trend') s.sort((a, b) => (b.iTi.pct ?? -1e9) - (a.iTi.pct ?? -1e9));
    if (sort === 'p_cur')   s.sort((a, b) => b.pCur - a.pCur);
    if (sort === 'i_cur')   s.sort((a, b) => b.iCur - a.iCur);
    if (sort === 'name')    s.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return s;
  }, [data, sort]);

  const pUp = rows.filter(r => r.pTi.pct != null && r.pTi.pct >= 5).length;
  const pDown = rows.filter(r => r.pTi.pct != null && r.pTi.pct <= -5).length;

  const th = { textAlign: 'right', padding: '9px 14px', fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' };
  const num = { padding: '12px 14px', fontSize: 13.5, textAlign: 'right', color: TITLE, borderTop: '1px solid #F1F5F9', whiteSpace: 'nowrap' };
  const numMuted = { ...num, color: MUTED };

  return (
    <div style={{ width: '100%', maxWidth: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: HEADER, margin: '0 0 4px', letterSpacing: -0.6, display: 'flex', alignItems: 'center', gap: 9 }}>
            <LineChart size={22} /> Statistics
          </h1>
          <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>
            Per-customer parcels and items — last {periodLabel} vs {avgLabel}, with year-on-year
            {data?.period_start ? <span style={{ color: '#94A3B8' }}> · last {periodLabel} starting {data.period_start}</span> : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={runBackfill} title="Pull the full shipment history so weekly/monthly/quarterly/yearly views go further back" style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, border: '1px solid #E2E8F0', background: '#fff', cursor: 'pointer',
            borderRadius: 9, padding: '8px 13px', fontSize: 12.5, fontWeight: 600, color: TITLE }}>
            <Database size={14} /> Backfill history
          </button>
          <CustomerExcludeFilter excluded={excluded} toggle={toggle} clear={clear} />
        </div>
      </div>

      {bf && (
        <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', color: '#9A3412', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, fontWeight: 500, marginBottom: 16 }}>{bf}</div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <Toggle options={[{ value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'quarter', label: 'Quarterly' }, { value: 'year', label: 'Yearly' }]} value={mode} onChange={setMode} />
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Chip colour={GREEN} label={`${pUp} up`} />
          <Chip colour={RED} label={`${pDown} down`} />
          <Chip colour={MUTED} label={`${rows.length} customers`} />
        </div>
      </div>

      <div style={{ background: '#fff', borderRadius: 14, boxShadow: SHADOW, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th rowSpan={2} style={{ ...th, textAlign: 'left', verticalAlign: 'bottom' }} onClick={() => setSort('name')}>Customer</th>
                <th colSpan={4} style={{ ...th, textAlign: 'center', color: TITLE, borderBottom: '1px solid #EEF2F7', paddingBottom: 4 }}>Parcels</th>
                <th colSpan={4} style={{ ...th, textAlign: 'center', color: TITLE, borderBottom: '1px solid #EEF2F7', paddingBottom: 4, background: ITEMS_TINT }}>Items</th>
              </tr>
              <tr style={{ background: '#F8FAFC' }}>
                <th style={th} onClick={() => setSort('p_cur')}>Last {periodLabel}</th>
                <th style={th}>{avgLabel}</th>
                <th style={th} onClick={() => setSort('p_trend')}>Trend</th>
                <th style={th}>YoY</th>
                <th style={{ ...th, background: ITEMS_TINT }} onClick={() => setSort('i_cur')}>Last {periodLabel}</th>
                <th style={{ ...th, background: ITEMS_TINT }}>{avgLabel}</th>
                <th style={{ ...th, background: ITEMS_TINT }} onClick={() => setSort('i_trend')}>Trend</th>
                <th style={{ ...th, background: ITEMS_TINT }}>YoY</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} style={{ padding: '40px 14px', textAlign: 'center', color: MUTED, fontSize: 13 }}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: '40px 14px', textAlign: 'center', color: MUTED, fontSize: 13 }}>No volume data yet for this period.</td></tr>
              ) : rows.map(r => (
                <tr key={r.id}>
                  <td style={{ ...num, textAlign: 'left', fontWeight: 600 }}>{r.name || '—'}</td>
                  <td style={{ ...num, fontWeight: 700 }}>{r.pCur.toLocaleString()}</td>
                  <td style={numMuted}>{Number(r.pAvg).toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                  <TrendCell ti={r.pTi} />
                  <td style={num}><YoY p={r.pYp} /></td>
                  <td style={{ ...num, fontWeight: 700, background: ITEMS_TINT }}>{r.iCur.toLocaleString()}</td>
                  <td style={{ ...numMuted, background: ITEMS_TINT }}>{Number(r.iAvg).toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                  <TrendCell ti={r.iTi} tint={ITEMS_TINT} />
                  <td style={{ ...num, background: ITEMS_TINT }}><YoY p={r.iYp} /></td>
                </tr>
              ))}
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

function YoY({ p }) {
  if (p == null) return <span style={{ color: '#CBD5E1' }}>—</span>;
  return <span style={{ color: p >= 5 ? GREEN : p <= -5 ? RED : AMBER, fontWeight: 700 }}>{p >= 0 ? '+' : ''}{p.toFixed(0)}%</span>;
}

function Chip({ colour, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 999, padding: '5px 11px', fontSize: 12, fontWeight: 600, color: TITLE }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: colour }} /> {label}
    </span>
  );
}
