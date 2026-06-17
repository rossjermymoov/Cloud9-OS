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

function Tile({ label, value, color, sub }) {
  return (
    <div style={{ background: C.panel, borderRadius: 18, padding: '26px 28px', border: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: C.mute, textTransform: 'uppercase', letterSpacing: 1.2 }}>{label}</div>
      <div style={{ fontSize: 76, fontWeight: 900, color, lineHeight: 1, letterSpacing: -2, marginTop: 12 }}>{value}</div>
      {sub && <div style={{ fontSize: 15, color: C.mute, marginTop: 8 }}>{sub}</div>}
    </div>
  );
}

function CourierBars({ couriers }) {
  const rows = couriers || [];
  const max = Math.max(...rows.map(r => r.parcels), 1);
  const pretty = (c) => ({ royal_mail: 'Royal Mail', dpd: 'DPD', dhl: 'DHL', evri: 'Evri', ups: 'UPS', fedex: 'FedEx' }[String(c).toLowerCase()] || c);
  return (
    <div style={{ background: C.panel, borderRadius: 18, padding: 26, border: `1px solid ${C.line}`, gridColumn: 'span 2' }}>
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

function SlaPanel({ sla }) {
  const s = sla || { green: 0, amber: 0, red: 0, breached: 0, urgent: [] };
  const cells = [
    { k: 'On track', v: s.green, c: C.green },
    { k: '< 2 hrs', v: s.amber, c: C.amber },
    { k: '< 1 hr', v: s.red, c: C.red },
    { k: 'Breached', v: s.breached, c: '#B91C1C' },
  ];
  const fmtLeft = (m) => m <= 0 ? 'OVERDUE' : m < 60 ? `${m}m left` : `${Math.floor(m / 60)}h ${m % 60}m left`;
  return (
    <div style={{ background: C.panel, borderRadius: 18, padding: 26, border: `1px solid ${C.line}`, gridColumn: 'span 2', gridRow: 'span 2', display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: C.mute, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 18 }}>Cutoff watch · due today</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
        {cells.map(c => (
          <div key={c.k} style={{ background: C.panel2, borderRadius: 14, padding: '16px 10px', textAlign: 'center', border: `1px solid ${c.v ? c.c : C.line}` }}>
            <div style={{ fontSize: 52, fontWeight: 900, color: c.v ? c.c : C.mute, lineHeight: 1 }}>{c.v}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.mute, marginTop: 6, textTransform: 'uppercase', letterSpacing: 0.6 }}>{c.k}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.mute, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Most urgent</div>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(s.urgent || []).slice(0, 8).map((u, i) => {
          const col = u.status === 'breached' ? '#B91C1C' : u.status === 'red' ? C.red : C.amber;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: C.panel2, borderRadius: 10, borderLeft: `5px solid ${col}` }}>
              <div style={{ flex: 1, fontSize: 20, fontWeight: 700, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.customer || 'Unattributed'}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: col }}>{fmtLeft(u.mins_left)}</div>
            </div>
          );
        })}
        {(!s.urgent || s.urgent.length === 0) && <div style={{ color: C.green, fontSize: 22, fontWeight: 700, padding: '14px 0' }}>✓ Everything on track</div>}
      </div>
    </div>
  );
}

export default function WarehouseBoard() {
  const { data, err, forbidden, updated } = useBoard();
  const d = data || {};

  if (forbidden) return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.mute, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontFamily: 'system-ui' }}>
      This board needs a valid access key in the URL.
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, padding: '28px 34px', fontFamily: 'system-ui, -apple-system, sans-serif', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,#00BCD4,#7B2FBE)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 18 }}>C9</div>
          <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: -0.5 }}>Warehouse — Live</div>
        </div>
        <div style={{ fontSize: 15, color: err ? C.red : C.mute, fontWeight: 600 }}>
          {err ? '⚠ Reconnecting…' : updated ? `Updated ${updated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · refreshes every 20s` : 'Loading…'}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gridAutoRows: 'minmax(150px, auto)', gap: 16 }}>
        {/* Flow stages */}
        <Tile label="Dispatch ready" value={fmt(d.dispatch_ready)} color={C.green} sub="ready for courier" />
        <Tile label="In picking" value={fmt(d.in_picking)} color={C.cyan} sub="being picked" />
        <Tile label="In packing" value={fmt(d.in_packing)} color={d.packing_stuck ? C.amber : C.purple} sub={d.packing_stuck ? '⚠ still packing after 3pm' : 'scanned, being packed'} />
        <Tile label="Orders done" value={fmt(d.orders_done)} color={C.blue} sub="dispatched today" />

        <SlaPanel sla={d.sla} />
        <Tile label="Parcels sent" value={fmt(d.parcels_sent)} color={C.blue} sub="today" />
        <Tile label="Items sent" value={fmt(d.items_sent)} color={C.pink} sub="today" />

        <CourierBars couriers={d.couriers} />
      </div>
    </div>
  );
}
