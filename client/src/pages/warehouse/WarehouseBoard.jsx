import { useState, useEffect, useCallback } from 'react';

// Public, no-auth TV board. Plain fetch (no token) to the public endpoint.
const REFRESH_MS = 20000;

const C = {
  bg: '#0A0E1A', panel: '#121829', panel2: '#0F1422', line: 'rgba(255,255,255,0.08)',
  text: '#F8FAFC', mute: '#94A3B8',
  blue: '#3B82F6', purple: '#A855F7', cyan: '#22D3EE', amber: '#F59E0B', green: '#22C55E', red: '#EF4444', pink: '#EC4899',
};

function useBoard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [updated, setUpdated] = useState(null);
  const key = new URLSearchParams(window.location.search).get('key') || '';
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/warehouse/board${key ? `?key=${encodeURIComponent(key)}` : ''}`, { headers: { Accept: 'application/json' } });
      if (r.status === 403) { setForbidden(true); return; }
      if (!r.ok) throw new Error('bad');
      setData(await r.json()); setErr(false); setForbidden(false); setUpdated(new Date());
    } catch { setErr(true); }
  }, [key]);
  useEffect(() => { load(); const t = setInterval(load, REFRESH_MS); return () => clearInterval(t); }, [load]);
  return { data, err, forbidden, updated };
}

const fmt = (n) => (n ?? 0).toLocaleString();

// Track viewport width so the board reflows for tablet / phone.
function useViewport() {
  const [w, setW] = useState(typeof window !== 'undefined' ? window.innerWidth : 1280);
  useEffect(() => {
    const f = () => setW(window.innerWidth);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return w;
}

function Tile({ label, value, color, sub, vFont = 76 }) {
  return (
    <div style={{ background: C.panel, borderRadius: 18, padding: vFont < 56 ? '18px 20px' : '26px 28px', border: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <div style={{ fontSize: vFont < 56 ? 13 : 16, fontWeight: 700, color: C.mute, textTransform: 'uppercase', letterSpacing: 1.2 }}>{label}</div>
      <div style={{ fontSize: vFont, fontWeight: 900, color, lineHeight: 1, letterSpacing: -2, marginTop: 10 }}>{value}</div>
      {sub && <div style={{ fontSize: vFont < 56 ? 13 : 15, color: C.mute, marginTop: 7 }}>{sub}</div>}
    </div>
  );
}

function CourierBars({ couriers, span = 2 }) {
  const rows = couriers || [];
  const max = Math.max(...rows.map(r => r.parcels), 1);
  const pretty = (c) => ({ royal_mail: 'Royal Mail', dpd: 'DPD', dhl: 'DHL', evri: 'Evri', ups: 'UPS', fedex: 'FedEx' }[String(c).toLowerCase()] || c);
  return (
    <div style={{ background: C.panel, borderRadius: 18, padding: 22, border: `1px solid ${C.line}`, gridColumn: `span ${span}` }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: C.mute, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 18 }}>Couriers today</div>
      {rows.length === 0 && <div style={{ color: C.mute, fontSize: 18, padding: '20px 0' }}>No parcels booked yet today.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {rows.map((r, i) => (
          <div key={r.courier} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 160, fontSize: 19, fontWeight: 700, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pretty(r.courier)}</div>
            <div style={{ flex: 1, height: 26, background: C.panel2, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ width: `${(r.parcels / max) * 100}%`, height: '100%', borderRadius: 8, background: [C.blue, C.cyan, C.purple, C.pink, C.amber, C.green][i % 6] }} />
            </div>
            <div style={{ width: 70, textAlign: 'right', fontSize: 22, fontWeight: 800, color: C.text }}>{fmt(r.parcels)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniList({ title, rows, keyName }) {
  return (
    <div style={{ flex: 1, minWidth: 150 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.mute, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {(rows || []).slice(0, 7).map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: C.panel2, borderRadius: 9 }}>
            <div style={{ flex: 1, fontSize: 17, fontWeight: 600, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r[keyName] || '—'}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.text }}>{r.n}</div>
          </div>
        ))}
        {(!rows || rows.length === 0) && <div style={{ color: C.mute, fontSize: 15, padding: '6px 0' }}>—</div>}
      </div>
    </div>
  );
}

function SlaPanel({ sla, colSpan = 2, rowSpan = 2, statCols = 4 }) {
  const s = sla || { green: 0, amber: 0, red: 0, breached: 0, outstanding: 0, by_status: [], impacted_customers: [] };
  const cells = [
    { k: 'On track', v: s.green, c: C.green },
    { k: '< 2 hrs', v: s.amber, c: C.amber },
    { k: '< 1 hr', v: s.red, c: C.red },
    { k: 'Breached', v: s.breached, c: '#B91C1C' },
  ];
  return (
    <div style={{ background: C.panel, borderRadius: 18, padding: 22, border: `1px solid ${C.line}`, gridColumn: `span ${colSpan}`, gridRow: `span ${rowSpan}`, display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: C.mute, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 16 }}>Should ship today · cutoff watch</div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${statCols},1fr)`, gap: 10, marginBottom: 18 }}>
        {cells.map(c => (
          <div key={c.k} style={{ background: C.panel2, borderRadius: 14, padding: '16px 10px', textAlign: 'center', border: `1px solid ${c.v ? c.c : C.line}` }}>
            <div style={{ fontSize: 52, fontWeight: 900, color: c.v ? c.c : C.mute, lineHeight: 1 }}>{c.v}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.mute, marginTop: 6, textTransform: 'uppercase', letterSpacing: 0.6 }}>{c.k}</div>
          </div>
        ))}
      </div>
      {(s.outstanding > 0)
        ? <div style={{ flex: 1, display: 'flex', gap: 22, flexWrap: 'wrap' }}>
            <MiniList title="By status" rows={s.by_status} keyName="label" />
            <MiniList title="Impacted customers" rows={s.impacted_customers} keyName="customer" />
          </div>
        : <div style={{ color: C.green, fontSize: 22, fontWeight: 700, padding: '14px 0' }}>✓ Everything on track</div>}
    </div>
  );
}

export default function WarehouseBoard() {
  const { data, err, forbidden, updated } = useBoard();
  const w = useViewport();
  const d = data || {};

  // Responsive sizing: 4-col TV → 2-col tablet → 1-col phone.
  const cols = w < 640 ? 1 : w < 1024 ? 2 : 4;
  const phone = w < 640;
  const vFont = w < 640 ? 46 : w < 1024 ? 58 : 76;
  const span2 = Math.min(2, cols);                 // wide blocks span 2, or 1 on phone
  const slaRowSpan = cols === 4 ? 2 : 1;
  const statCols = cols === 1 ? 2 : 4;             // SLA stat cells: 2×2 on phone

  // "Still outstanding" tile reflects the worst breach state of today's remaining orders.
  const sla = d.sla || {};
  const outColor = (sla.breached || sla.red) ? C.red : sla.amber ? C.amber : C.cyan;

  if (forbidden) return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.mute, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, padding: 24, textAlign: 'center', fontFamily: 'system-ui' }}>
      This board needs a valid access key in the URL.
    </div>
  );

  return (
    // Own full-viewport scroll container — the global `body { overflow:hidden }`
    // (for the app shell) would otherwise stop this public page scrolling on a phone.
    <div style={{ position: 'fixed', inset: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: C.bg, color: C.text, padding: phone ? '16px 14px' : '28px 34px', fontFamily: 'system-ui, -apple-system, sans-serif', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: phone ? 16 : 24, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: phone ? 36 : 44, height: phone ? 36 : 44, borderRadius: 12, background: 'linear-gradient(135deg,#00BCD4,#7B2FBE)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: phone ? 15 : 18 }}>C9</div>
          <div style={{ fontSize: phone ? 22 : 30, fontWeight: 900, letterSpacing: -0.5 }}>Warehouse — Live</div>
        </div>
        <div style={{ fontSize: phone ? 12 : 15, color: err ? C.red : C.mute, fontWeight: 600 }}>
          {err ? '⚠ Reconnecting…' : updated ? `Updated ${updated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · every 20s` : 'Loading…'}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gridAutoRows: 'minmax(120px, auto)', gap: phone ? 12 : 16 }}>
        {/* Today's commitment + the work still racing the cutoff */}
        <Tile label="To dispatch today" value={fmt(d.due_today)} color={C.blue} sub="should ship today" vFont={vFont} />
        <Tile label="Still outstanding" value={fmt(d.outstanding)} color={outColor} sub={`${fmt(d.dispatched)} already dispatched`} vFont={vFont} />
        {/* Live workflow stages */}
        <Tile label="In picking" value={fmt(d.in_picking)} color={C.cyan} sub="being picked" vFont={vFont} />
        <Tile label="In packing" value={fmt(d.in_packing)} color={d.packing_stuck ? C.amber : C.purple} sub={d.packing_stuck ? '⚠ still packing after 3pm' : 'scanned, being packed'} vFont={vFont} />

        <SlaPanel sla={d.sla} colSpan={span2} rowSpan={slaRowSpan} statCols={statCols} />
        <Tile label="Dispatch ready" value={fmt(d.dispatch_ready)} color={C.green} sub="ready for courier" vFont={vFont} />
        <Tile label="Dispatched" value={fmt(d.dispatched)} color={C.green} sub="of today's orders" vFont={vFont} />
        <Tile label="Parcels sent" value={fmt(d.parcels_sent)} color={C.blue} sub="today" vFont={vFont} />
        <Tile label="Items sent" value={fmt(d.items_sent)} color={C.pink} sub="today" vFont={vFont} />

        <CourierBars couriers={d.couriers} span={span2} />
      </div>
    </div>
  );
}
