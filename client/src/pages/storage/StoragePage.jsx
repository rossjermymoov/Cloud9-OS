import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Warehouse, RefreshCw, Boxes, MapPin, Package, Search } from 'lucide-react';
import { storageSummary, storageByCustomer, storageByLocation, storageFreshness, triggerStorageSync, storageCustomerDebug } from '../../api/storage';

const HEADER = '#0B1220', TITLE = '#0F172A', MUTED = '#64748B', ACCENT = '#0056FB';
const SHADOW = '0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.10)';
const PALETTE = ['#3B82F6', '#A855F7', '#22D3EE', '#EC4899', '#F59E0B', '#10B981', '#6366F1', '#EF4444', '#14B8A6', '#F97316', '#8B5CF6', '#0EA5E9'];
const m3 = (v) => `${(v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} m³`;

function Card({ children, style }) {
  return <div style={{ background: '#fff', borderRadius: 14, boxShadow: SHADOW, padding: 18, ...style }}>{children}</div>;
}
function Kpi({ Icon, label, value, sub }) {
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Icon size={16} strokeWidth={1.9} color={ACCENT} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: MUTED }}>{label}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.8, color: HEADER }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>{sub}</div>}
    </Card>
  );
}

// Simple recursive slice-and-dice treemap — area ∝ value, alternating split direction.
function treemap(items, x, y, w, h, horizontal = true) {
  const total = items.reduce((a, i) => a + i.value, 0);
  if (!total || items.length === 0) return [];
  if (items.length === 1) return [{ ...items[0], x, y, w, h }];
  let acc = 0, idx = 0;
  for (; idx < items.length - 1; idx++) { acc += items[idx].value; if (acc >= total / 2) { idx++; break; } }
  const a = items.slice(0, idx), b = items.slice(idx);
  const frac = a.reduce((s, i) => s + i.value, 0) / total;
  if (horizontal) {
    const wa = w * frac;
    return [...treemap(a, x, y, wa, h, !horizontal), ...treemap(b, x + wa, y, w - wa, h, !horizontal)];
  }
  const ha = h * frac;
  return [...treemap(a, x, y, w, ha, !horizontal), ...treemap(b, x, y + ha, w, h - ha, !horizontal)];
}

function StorageMap({ rows, navigate }) {
  const W = 1000, H = 460;
  const data = (rows || []).filter(r => r.m3 > 0).map((r, i) => ({ ...r, value: r.m3, color: PALETTE[i % PALETTE.length] }));
  if (!data.length) return <div style={{ color: '#94A3B8', fontSize: 13, padding: '60px 0', textAlign: 'center' }}>No storage volume computed yet.</div>;
  const boxes = treemap(data, 0, 0, W, H);
  const total = data.reduce((a, d) => a + d.value, 0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 10 }}>
      {boxes.map((b, i) => {
        const pad = 2, bw = Math.max(0, b.w - pad), bh = Math.max(0, b.h - pad);
        const big = bw > 90 && bh > 44;
        const med = bw > 54 && bh > 26;
        const pct = total ? Math.round((b.value / total) * 100) : 0;
        return (
          <g key={i} style={{ cursor: 'pointer' }} onClick={() => b.id && navigate(`/customers/${b.id}`)}>
            <rect x={b.x + pad / 2} y={b.y + pad / 2} width={bw} height={bh} rx={6} fill={b.color} opacity={0.92} />
            {big && <>
              <text x={b.x + 10} y={b.y + 24} fontSize={15} fontWeight={800} fill="#fff">{b.name}</text>
              <text x={b.x + 10} y={b.y + 44} fontSize={13} fontWeight={600} fill="rgba(255,255,255,0.85)">{m3(b.m3)} · {pct}%</text>
            </>}
            {med && !big && <text x={b.x + 7} y={b.y + 18} fontSize={11} fontWeight={700} fill="#fff">{b.name?.slice(0, 14)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

// Live inspector — pulls a customer's inventory from Helm and shows what builds
// their m³ total (raw dims, stock, per-unit + total volume per SKU).
function CustomerInspector() {
  const [q, setQ] = useState('Ccell');
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true); setErr(null); setData(null);
    try {
      const d = await storageCustomerDebug(q.trim() || 'Ccell');
      if (d.error) setErr(d.error); else setData(d);
    } catch (e) { setErr(e?.response?.data?.error || e.message); }
    finally { setLoading(false); }
  }

  const t = data?.totals;
  return (
    <Card style={{ marginTop: 16 }}>
      <div style={{ fontSize: 14.5, fontWeight: 700, color: TITLE, marginBottom: 4 }}>Inspect a customer (live from Helm)</div>
      <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 12 }}>See exactly which SKUs build a customer's total — raw dimensions, stock and volume.</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()}
          placeholder="Customer name e.g. Ccell"
          style={{ flex: '0 0 260px', border: '1px solid #E2E8F0', borderRadius: 9, padding: '8px 11px', fontSize: 13, fontFamily: 'inherit', color: TITLE }} />
        <button onClick={run} disabled={loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', background: ACCENT, color: '#fff', cursor: loading ? 'default' : 'pointer', borderRadius: 9, padding: '8px 15px', fontSize: 13, fontWeight: 700, opacity: loading ? 0.6 : 1 }}>
          <Search size={14} /> {loading ? 'Pulling…' : 'Inspect'}
        </button>
      </div>

      {err && <div style={{ fontSize: 12.5, color: '#EF4444', padding: '6px 0' }}>{err}</div>}

      {data && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, fontSize: 12.5, marginBottom: 6, padding: '10px 12px', background: '#F8FAFC', borderRadius: 9 }}>
            <span><strong style={{ color: TITLE }}>{data.customer}</strong></span>
            <span style={{ color: MUTED }}>Total: <strong style={{ color: ACCENT }}>{m3(t.total_m3)}</strong></span>
            <span style={{ color: MUTED }}>SKUs: <strong style={{ color: TITLE }}>{t.sku_count}</strong></span>
            <span style={{ color: MUTED }}>Counted: <strong style={{ color: '#10B981' }}>{t.counted}</strong></span>
            <span style={{ color: MUTED }}>Components/Groups excluded: <strong style={{ color: t.components_groups_excluded ? '#F59E0B' : MUTED }}>{t.components_groups_excluded}</strong></span>
            <span style={{ color: MUTED }}>Zero dims: <strong style={{ color: t.zero_dims ? '#F59E0B' : MUTED }}>{t.zero_dims}</strong></span>
            <span style={{ color: MUTED }}>Dropped (huge): <strong style={{ color: t.oversize_dropped ? '#EF4444' : MUTED }}>{t.oversize_dropped}</strong></span>
            <span style={{ color: '#94A3B8' }}>Unit: {data.dimensions?.effective_unit} (÷{data.dimensions?.divisor.toLocaleString()})</span>
          </div>
          {data.by_type && (
            <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 12 }}>
              By type: {Object.entries(data.by_type).map(([k, v]) => `${k} ${v}`).join(' · ')}
            </div>
          )}
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ color: '#94A3B8', textAlign: 'left', fontSize: 11, position: 'sticky', top: 0, background: '#fff' }}>
                <th style={{ padding: '6px 6px' }}>SKU</th><th style={{ padding: '6px 6px' }}>Name</th>
                <th style={{ padding: '6px 6px' }}>Type</th>
                <th style={{ padding: '6px 6px', textAlign: 'right' }}>L×W×H (cm)</th>
                <th style={{ padding: '6px 6px', textAlign: 'right' }}>Units</th>
                <th style={{ padding: '6px 6px', textAlign: 'right' }}>m³ / unit</th>
                <th style={{ padding: '6px 6px', textAlign: 'right' }}>Total m³</th>
              </tr></thead>
              <tbody>
                {data.top_skus.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', background: r.flag ? '#FEF2F2' : 'transparent' }}>
                    <td style={{ padding: '7px 6px', fontWeight: 600, color: TITLE }}>{r.sku || '—'}</td>
                    <td style={{ padding: '7px 6px', color: MUTED, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name || '—'}{r.flag && <span style={{ color: '#EF4444', fontWeight: 700 }}> · {r.flag}</span>}</td>
                    <td style={{ padding: '7px 6px', color: (r.type === 'Group' || r.type === 'Component') ? '#F59E0B' : MUTED }}>{r.type}</td>
                    <td style={{ padding: '7px 6px', textAlign: 'right', color: '#334155' }}>{r.L}×{r.W}×{r.H}</td>
                    <td style={{ padding: '7px 6px', textAlign: 'right', color: '#334155' }}>{(r.units ?? 0).toLocaleString()}</td>
                    <td style={{ padding: '7px 6px', textAlign: 'right', color: r.unit_m3 == null ? '#CBD5E1' : MUTED }}>{r.unit_m3 == null ? '—' : r.unit_m3}</td>
                    <td style={{ padding: '7px 6px', textAlign: 'right', fontWeight: 700, color: ACCENT }}>{(r.volume_m3 ?? 0).toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

export default function StoragePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [syncing, setSyncing] = useState(false);
  const summary = useQuery({ queryKey: ['storage', 'summary'], queryFn: storageSummary });
  const byCust  = useQuery({ queryKey: ['storage', 'by-customer'], queryFn: storageByCustomer });
  const byLoc   = useQuery({ queryKey: ['storage', 'by-location'], queryFn: storageByLocation });
  const fresh   = useQuery({ queryKey: ['storage', 'freshness'], queryFn: storageFreshness });
  const s = summary.data;

  async function runSync() {
    setSyncing(true);
    try { await triggerStorageSync(); setTimeout(() => { qc.invalidateQueries({ queryKey: ['storage'] }); setSyncing(false); }, 8000); }
    catch { setSyncing(false); }
  }
  const lastSync = fresh.data?.ran_at ? new Date(fresh.data.ran_at).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : null;
  const hasData = (s?.total_m3 || 0) > 0;

  return (
    <div style={{ padding: '24px 30px', maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: HEADER, margin: '0 0 4px', letterSpacing: -0.6, display: 'flex', alignItems: 'center', gap: 9 }}>
            <Warehouse size={22} /> Storage
          </h1>
          <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>
            Cubic metres each customer occupies, from Helm package dimensions.
            {lastSync && <span style={{ color: '#94A3B8' }}> · Recomputed nightly · Last {lastSync}</span>}
          </p>
        </div>
        <button onClick={runSync} disabled={syncing}
          style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1px solid #E2E8F0', background: '#fff', cursor: syncing ? 'default' : 'pointer', borderRadius: 9, padding: '8px 13px', fontSize: 12.5, fontWeight: 600, color: TITLE, opacity: syncing ? 0.6 : 1 }}>
          <RefreshCw size={14} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} /> {syncing ? 'Computing…' : 'Recompute'}
        </button>
      </div>

      {!hasData && !summary.isLoading ? (
        <Card style={{ textAlign: 'center', padding: '54px 24px' }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: '#EEF4FF', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}><Warehouse size={26} color={ACCENT} /></div>
          <div style={{ fontSize: 16, fontWeight: 700, color: TITLE, marginBottom: 6 }}>No storage data yet</div>
          <div style={{ fontSize: 13.5, color: MUTED, maxWidth: 440, margin: '0 auto 18px' }}>Compute each customer's storage footprint from Helm inventory and package dimensions.</div>
          <button onClick={runSync} disabled={syncing} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: 'none', background: ACCENT, color: '#fff', cursor: syncing ? 'default' : 'pointer', borderRadius: 10, padding: '11px 20px', fontSize: 13.5, fontWeight: 700, opacity: syncing ? 0.6 : 1 }}>
            <RefreshCw size={15} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} /> {syncing ? 'Computing…' : 'Compute storage'}
          </button>
        </Card>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14, marginBottom: 16 }}>
            <Kpi Icon={Warehouse} label="Total stored" value={m3(s?.total_m3)} sub="across all customers" />
            <Kpi Icon={MapPin} label="Locations used" value={(s?.locations ?? 0).toLocaleString()} sub="bins / shelves" />
            <Kpi Icon={Boxes} label="SKUs stored" value={(s?.skus ?? 0).toLocaleString()} />
            <Kpi Icon={Package} label="Without dimensions" value={(s?.lines_without_dims ?? 0).toLocaleString()} sub="not counted in m³" />
          </div>

          <Card style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: TITLE, marginBottom: 4 }}>Storage map — who's using the most</div>
            <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 12 }}>Each block is a customer, sized by cubic metres. Click to open their record.</div>
            <StorageMap rows={s?.top_customers} navigate={navigate} />
          </Card>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Card>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: TITLE, marginBottom: 10 }}>By customer</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead><tr style={{ color: '#94A3B8', textAlign: 'left', fontSize: 11.5 }}>
                  <th style={{ padding: '7px 6px' }}>Customer</th><th style={{ padding: '7px 6px', textAlign: 'right' }}>m³</th>
                  <th style={{ padding: '7px 6px', textAlign: 'right' }}>SKUs</th><th style={{ padding: '7px 6px', textAlign: 'right' }}>Locations</th>
                </tr></thead>
                <tbody>
                  {(byCust.data || []).filter(c => c.m3 > 0).slice(0, 18).map(c => (
                    <tr key={c.id || 'cloud9'} className="c9-row" onClick={() => c.id && navigate(`/customers/${c.id}`)} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: c.id ? 'pointer' : 'default' }}>
                      <td style={{ padding: '8px 6px', fontWeight: 600, color: TITLE }}>{c.name}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 700, color: ACCENT }}>{(c.m3 ?? 0).toFixed(1)}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right', color: '#334155' }}>{c.skus}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right', color: MUTED }}>{c.locations}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: TITLE, marginBottom: 10 }}>Busiest locations</div>
              <div style={{ maxHeight: 380, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead><tr style={{ color: '#94A3B8', textAlign: 'left', fontSize: 11.5, position: 'sticky', top: 0, background: '#fff' }}>
                    <th style={{ padding: '7px 6px' }}>Location</th><th style={{ padding: '7px 6px' }}>Top customer</th><th style={{ padding: '7px 6px', textAlign: 'right' }}>m³</th>
                  </tr></thead>
                  <tbody>
                    {(byLoc.data || []).slice(0, 60).map(l => (
                      <tr key={l.location_id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                        <td style={{ padding: '8px 6px', fontWeight: 600, color: TITLE }}>{l.location_name || l.location_id}</td>
                        <td style={{ padding: '8px 6px', color: MUTED }}>{l.top_customer || '—'}{l.customers > 1 ? ` +${l.customers - 1}` : ''}</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 700, color: '#334155' }}>{(l.m3 ?? 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <CustomerInspector />
        </>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
