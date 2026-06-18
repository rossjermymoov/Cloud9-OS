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

// ── Squarified treemap (Bruls, Huizing & van Wijk) ──────────────────────────
// Greedily packs rows along the shorter side, keeping every rectangle as close
// to square as possible. Output rectangles tile the box exactly — no overlaps,
// no ragged seams — so adjacent blocks always share a clean edge.
function squarify(items, X, Y, W, H) {
  const out = [];
  const total = items.reduce((s, it) => s + it.value, 0);
  if (total <= 0 || !items.length) return out;
  const nodes = items.map(it => ({ it, area: (it.value / total) * W * H }));

  const worst = (row, side) => {
    const sum = row.reduce((a, r) => a + r.area, 0);
    const max = Math.max(...row.map(r => r.area));
    const min = Math.min(...row.map(r => r.area));
    const s2 = sum * sum, side2 = side * side;
    return Math.max((side2 * max) / s2, s2 / (side2 * min));
  };

  let rect = { x: X, y: Y, w: W, h: H };
  const place = (row) => {
    const sum = row.reduce((a, r) => a + r.area, 0);
    if (rect.w >= rect.h) {                    // lay a vertical column on the left
      const colW = sum / rect.h;
      let yy = rect.y;
      for (const r of row) { const hh = r.area / colW; out.push({ ...r.it, x: rect.x, y: yy, w: colW, h: hh }); yy += hh; }
      rect.x += colW; rect.w -= colW;
    } else {                                   // lay a horizontal row on the top
      const rowH = sum / rect.w;
      let xx = rect.x;
      for (const r of row) { const ww = r.area / rowH; out.push({ ...r.it, x: xx, y: rect.y, w: ww, h: rowH }); xx += ww; }
      rect.y += rowH; rect.h -= rowH;
    }
  };

  let row = [];
  for (let i = 0; i < nodes.length;) {
    const side = Math.min(rect.w, rect.h);
    const next = [...row, nodes[i]];
    if (!row.length || worst(next, side) <= worst(row, side)) { row = next; i++; }
    else { place(row); row = []; }
  }
  if (row.length) place(row);
  return out;
}

function StorageMap({ rows, total, navigate }) {
  const [hover, setHover] = useState(null);   // { node, x, y }
  const W = 1000, H = 460;
  const data = (rows || []).filter(r => r.m3 > 0).map((r, i) => ({ ...r, value: r.m3, color: PALETTE[i % PALETTE.length] }));
  if (!data.length) return <div style={{ color: '#94A3B8', fontSize: 13, padding: '60px 0', textAlign: 'center' }}>No storage volume computed yet.</div>;
  const grand = total || data.reduce((a, d) => a + d.value, 0);
  const boxes = squarify(data, 0, 0, W, H);
  const pctOf = (v) => grand ? (v / grand) * 100 : 0;
  const pc = (v) => `${(v ?? 0).toLocaleString(undefined, { maximumFractionDigits: v < 10 ? 1 : 0 })}%`;

  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: `${W} / ${H}`, borderRadius: 10, overflow: 'hidden' }}>
      {boxes.map((b, i) => {
        const left = (b.x / W) * 100, top = (b.y / H) * 100, w = (b.w / W) * 100, h = (b.h / H) * 100;
        const showFull = b.w > 96 && b.h > 46;     // name + stats
        const showName = b.w > 52 && b.h > 26;     // name only
        const pct = pctOf(b.value);
        return (
          <div key={i}
            onClick={() => b.id && navigate(`/customers/${b.id}`)}
            onMouseEnter={(e) => setHover({ node: b, x: e.clientX, y: e.clientY })}
            onMouseMove={(e) => setHover({ node: b, x: e.clientX, y: e.clientY })}
            onMouseLeave={() => setHover(null)}
            style={{
              position: 'absolute', left: `${left}%`, top: `${top}%`, width: `${w}%`, height: `${h}%`,
              background: b.color, border: '1.5px solid #fff', boxSizing: 'border-box',
              padding: showName ? '8px 10px' : 0, cursor: b.id ? 'pointer' : 'default',
              display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', overflow: 'hidden',
            }}>
            {showName && (
              <div style={{ fontSize: showFull ? 14 : 11.5, fontWeight: 800, color: '#fff', lineHeight: 1.2,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                {b.name}
              </div>
            )}
            {showFull && (
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(255,255,255,0.88)', marginTop: 3,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                {m3(b.m3)} · {pc(pct)}
              </div>
            )}
          </div>
        );
      })}

      {hover && (
        <div style={{
          position: 'fixed', left: Math.min(hover.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 240),
          top: hover.y + 16, zIndex: 1000, pointerEvents: 'none',
          background: '#0B1220', color: '#fff', borderRadius: 10, padding: '10px 13px', minWidth: 170, maxWidth: 240,
          boxShadow: '0 8px 24px rgba(2,6,23,0.35)', border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6, whiteSpace: 'normal', lineHeight: 1.25 }}>{hover.node.name}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 12, marginBottom: 3 }}>
            <span style={{ color: 'rgba(255,255,255,0.6)' }}>Volume</span>
            <strong>{(hover.node.m3 ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} m³</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 12 }}>
            <span style={{ color: 'rgba(255,255,255,0.6)' }}>Share of total</span>
            <strong>{pc(pctOf(hover.node.m3))}</strong>
          </div>
        </div>
      )}
    </div>
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
            <StorageMap rows={s?.top_customers} total={s?.total_m3} navigate={navigate} />
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
