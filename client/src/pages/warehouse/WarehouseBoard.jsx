import { useState, useEffect, useCallback } from 'react';

// Public, no-auth TV board. Rotating full-screen slides — nothing scrolls on a TV.
const REFRESH_MS = 20000;     // data refresh
// Per-slide dwell time, aligned to SLIDES below. The two important views linger.
const SLIDE_MS = { kpis: 30000, cutoff: 30000, couriers: 10000, customers: 10000, pickers: 10000 };

const C = {
  bg: '#0A0E1A', panel: '#121829', panel2: '#0F1422', line: 'rgba(255,255,255,0.08)',
  text: '#F8FAFC', mute: '#94A3B8',
  blue: '#3B82F6', purple: '#A855F7', cyan: '#22D3EE', amber: '#F59E0B', green: '#22C55E', red: '#EF4444', pink: '#EC4899',
};
const fmt = (n) => (n ?? 0).toLocaleString();
const prettyCourier = (c) => ({ royal_mail: 'Royal Mail', dpd: 'DPD', dhl: 'DHL', evri: 'Evri', ups: 'UPS', fedex: 'FedEx' }[String(c).toLowerCase()] || c);

function useViewport() {
  const [w, setW] = useState(typeof window !== 'undefined' ? window.innerWidth : 1280);
  useEffect(() => { const f = () => setW(window.innerWidth); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  return w;
}

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

// ── Reusable bits ────────────────────────────────────────────────────────────
function Tile({ label, value, color, sub, vFont }) {
  return (
    <div style={{ background: C.panel, borderRadius: 18, padding: '4% 5%', border: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 0 }}>
      <div style={{ fontSize: vFont * 0.22, fontWeight: 700, color: C.mute, textTransform: 'uppercase', letterSpacing: 1.2 }}>{label}</div>
      <div style={{ fontSize: vFont, fontWeight: 900, color, lineHeight: 1.02, letterSpacing: -2, margin: '6px 0' }}>{value}</div>
      {sub && <div style={{ fontSize: vFont * 0.2, color: C.mute }}>{sub}</div>}
    </div>
  );
}
function SlideTitle({ children, accent = C.cyan }) {
  return <div style={{ fontSize: 'clamp(20px, 2.4vw, 34px)', fontWeight: 900, marginBottom: '2vh', display: 'flex', alignItems: 'center', gap: 12 }}>
    <span style={{ width: 12, height: 36, borderRadius: 4, background: accent }} /> {children}</div>;
}
function RankRow({ i, name, value, valueColor, sub }) {
  const medal = ['#F59E0B', '#CBD5E1', '#B45309'][i];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '2vw', padding: '1.4vh 2vw', background: C.panel, borderRadius: 16, border: `1px solid ${C.line}` }}>
      <div style={{ width: '3vw', minWidth: 40, fontSize: 'clamp(22px,2.6vw,40px)', fontWeight: 900, color: medal || C.mute, textAlign: 'center' }}>{i + 1}</div>
      <div style={{ flex: 1, fontSize: 'clamp(20px,2.4vw,38px)', fontWeight: 700, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
      {sub && <div style={{ fontSize: 'clamp(14px,1.4vw,22px)', color: C.mute }}>{sub}</div>}
      <div style={{ fontSize: 'clamp(24px,2.8vw,44px)', fontWeight: 900, color: valueColor || C.text, minWidth: '6vw', textAlign: 'right' }}>{value}</div>
    </div>
  );
}
const fillCol = { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '1.4vh', overflow: 'hidden' };

// ── Slides ───────────────────────────────────────────────────────────────────
function KpiSlide({ d, cols, vFont }) {
  const sla = d.sla || {};
  const outColor = (sla.breached || sla.red) ? C.red : sla.amber ? C.amber : C.cyan;
  const tiles = [
    { label: 'To dispatch today', value: fmt(d.due_today), color: C.blue, sub: 'should ship today' },
    { label: 'Still outstanding', value: fmt(d.outstanding), color: outColor, sub: `${fmt(d.dispatched)} dispatched` },
    { label: 'In picking', value: fmt(d.in_picking), color: C.cyan, sub: 'being picked' },
    { label: 'In packing', value: fmt(d.in_packing), color: d.packing_stuck ? C.amber : C.purple, sub: d.packing_stuck ? '⚠ after 3pm' : 'being packed' },
    { label: 'Dispatch ready', value: fmt(d.dispatch_ready), color: C.green, sub: 'ready for courier' },
    { label: 'Dispatched', value: fmt(d.dispatched), color: C.green, sub: "of today's" },
    { label: 'Parcels sent', value: fmt(d.parcels_sent), color: C.blue, sub: 'today' },
    { label: 'Items sent', value: fmt(d.items_sent), color: C.pink, sub: 'today' },
  ];
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gridAutoRows: '1fr', gap: '1.6vh 1.2vw' }}>
      {tiles.map((t, i) => <Tile key={i} {...t} vFont={vFont} />)}
    </div>
  );
}

function CutoffSlide({ d }) {
  const s = d.sla || { green: 0, amber: 0, red: 0, breached: 0, outstanding: 0, by_status: [], impacted_customers: [] };
  const cells = [
    { k: 'On track', v: s.green, c: C.green }, { k: '< 2 hrs', v: s.amber, c: C.amber },
    { k: '< 1 hr', v: s.red, c: C.red }, { k: 'Breached', v: s.breached, c: '#B91C1C' },
  ];
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <SlideTitle accent={C.amber}>Should ship today · cutoff watch</SlideTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '1.2vw', marginBottom: '2vh' }}>
        {cells.map(c => (
          <div key={c.k} style={{ background: C.panel, borderRadius: 16, padding: '2.4vh 1vw', textAlign: 'center', border: `1px solid ${c.v ? c.c : C.line}` }}>
            <div style={{ fontSize: 'clamp(40px,6vw,96px)', fontWeight: 900, color: c.v ? c.c : C.mute, lineHeight: 1 }}>{c.v}</div>
            <div style={{ fontSize: 'clamp(13px,1.3vw,20px)', fontWeight: 700, color: C.mute, marginTop: 8, textTransform: 'uppercase', letterSpacing: 0.6 }}>{c.k}</div>
          </div>
        ))}
      </div>
      {s.outstanding > 0 ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: '2vw' }}>
          {[['By status', s.by_status, 'label'], ['Impacted customers', s.impacted_customers, 'customer']].map(([title, rows, kn]) => (
            <div key={title} style={{ flex: 1, minHeight: 0 }}>
              <div style={{ fontSize: 'clamp(14px,1.4vw,20px)', fontWeight: 700, color: C.mute, textTransform: 'uppercase', letterSpacing: 1, marginBottom: '1.4vh' }}>{title}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1vh' }}>
                {(rows || []).slice(0, 6).map((r, i) => (
                  <div key={i} style={{ display: 'flex', gap: 12, padding: '1.3vh 1.4vw', background: C.panel, borderRadius: 12 }}>
                    <div style={{ flex: 1, fontSize: 'clamp(18px,2vw,30px)', fontWeight: 600, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r[kn] || '—'}</div>
                    <div style={{ fontSize: 'clamp(18px,2vw,30px)', fontWeight: 900 }}>{r.n}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.green, fontSize: 'clamp(28px,4vw,60px)', fontWeight: 800 }}>✓ Everything on track</div>}
    </div>
  );
}

function CouriersSlide({ d }) {
  const rows = (d.couriers || []).slice(0, 5);
  const max = Math.max(...rows.map(r => r.parcels), 1);
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <SlideTitle accent={C.blue}>Top couriers today</SlideTitle>
      <div style={{ ...fillCol, justifyContent: 'center' }}>
        {rows.map((r, i) => (
          <div key={r.courier} style={{ display: 'flex', alignItems: 'center', gap: '1.6vw' }}>
            <div style={{ width: '16vw', minWidth: 160, fontSize: 'clamp(20px,2.2vw,34px)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{prettyCourier(r.courier)}</div>
            <div style={{ flex: 1, height: '5vh', minHeight: 30, background: C.panel2, borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ width: `${(r.parcels / max) * 100}%`, height: '100%', borderRadius: 10, background: [C.blue, C.cyan, C.purple, C.pink, C.amber][i % 5] }} />
            </div>
            <div style={{ width: '7vw', textAlign: 'right', fontSize: 'clamp(26px,3vw,48px)', fontWeight: 900 }}>{fmt(r.parcels)}</div>
          </div>
        ))}
        {rows.length === 0 && <div style={{ color: C.mute, fontSize: 28 }}>No parcels booked yet today.</div>}
      </div>
    </div>
  );
}

function LeaderboardSlide({ title, accent, rows, render }) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <SlideTitle accent={accent}>{title}</SlideTitle>
      <div style={{ ...fillCol, justifyContent: 'flex-start' }}>
        {(rows || []).slice(0, 5).map((r, i) => render(r, i))}
        {(!rows || rows.length === 0) && <div style={{ color: C.mute, fontSize: 28 }}>No data yet today.</div>}
      </div>
    </div>
  );
}

const SLIDES = ['kpis', 'cutoff', 'couriers', 'customers', 'pickers'];

export default function WarehouseBoard() {
  const { data, err, forbidden, updated } = useBoard();
  const w = useViewport();
  const [slide, setSlide] = useState(0);
  const d = data || {};

  // Advance after the current slide's own dwell time (re-scheduled on each change).
  useEffect(() => {
    const t = setTimeout(() => setSlide(s => (s + 1) % SLIDES.length), SLIDE_MS[SLIDES[slide]] || 14000);
    return () => clearTimeout(t);
  }, [slide]);

  const phone = w < 640;
  const cols = w < 640 ? 2 : 4;
  const vFont = w < 640 ? 'clamp(30px,11vw,52px)' : 'clamp(40px,5vw,92px)';

  if (forbidden) return (
    <div style={{ position: 'fixed', inset: 0, background: C.bg, color: C.mute, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, padding: 24, textAlign: 'center', fontFamily: 'system-ui' }}>
      This board needs a valid access key in the URL.
    </div>
  );

  const which = SLIDES[slide];
  let body;
  if (which === 'kpis') body = <KpiSlide d={d} cols={cols} vFont={typeof vFont === 'string' ? (phone ? 44 : 76) : vFont} />;
  else if (which === 'cutoff') body = <CutoffSlide d={d} />;
  else if (which === 'couriers') body = <CouriersSlide d={d} />;
  else if (which === 'customers') body = <LeaderboardSlide title="Top customers today" accent={C.green} rows={d.top_customers}
    render={(r, i) => <RankRow key={i} i={i} name={r.name} value={fmt(r.parcels)} valueColor={C.green} sub={`${fmt(r.items)} items`} />} />;
  else body = <LeaderboardSlide title="Top pickers today" accent={C.purple} rows={d.top_pickers}
    render={(r, i) => <RankRow key={i} i={i} name={r.name || '—'} value={r.items_per_hour != null ? `${r.items_per_hour}/hr` : fmt(r.items)} valueColor={C.purple} sub={`${fmt(r.items)} items`} />} />;

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: C.bg, color: C.text, padding: phone ? '14px 14px' : '2.5vh 2.5vw', fontFamily: 'system-ui, -apple-system, sans-serif', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: '2vh' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: phone ? 34 : 44, height: phone ? 34 : 44, borderRadius: 12, background: 'linear-gradient(135deg,#00BCD4,#7B2FBE)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: phone ? 14 : 18 }}>C9</div>
          <div style={{ fontSize: phone ? 20 : 'clamp(22px,2.2vw,32px)', fontWeight: 900, letterSpacing: -0.5 }}>Warehouse — Live</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', gap: 7 }}>
            {SLIDES.map((_, i) => <span key={i} style={{ width: i === slide ? 22 : 8, height: 8, borderRadius: 4, background: i === slide ? C.cyan : 'rgba(255,255,255,0.18)', transition: 'all .3s' }} />)}
          </div>
          <div style={{ fontSize: phone ? 11 : 14, color: err ? C.red : C.mute, fontWeight: 600 }}>
            {err ? '⚠ Reconnecting…' : updated ? updated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '…'}
          </div>
        </div>
      </div>
      {body}
    </div>
  );
}
