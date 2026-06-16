import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { X, PackagePlus, List, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { listPurchaseOrders, poStats, getPurchaseOrder } from '../../api/purchaseOrders';

const ACCENT = '#0056FB', MUTED = '#64748B', TITLE = '#0F172A', HEADER = '#0B1220', TEAL = '#0EA5B7';
const SHADOW = '0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.10)';

// Helm status_id → label + colour
const HELM_STATUS = {
  11: { c: '#94A3B8', l: 'Draft' },
  12: { c: '#E11D48', l: 'On Hold' },
  13: { c: TEAL,      l: 'Submitted' },
  14: { c: '#F59E0B', l: 'Partially received' },
  15: { c: '#00C853', l: 'Received' },
  16: { c: '#E11D48', l: 'Cancelled' },
  25: { c: '#94A3B8', l: 'Archived' },
};
const ENUM_TO_HELM = { open: 13, partially_received: 14, received: 15, cancelled: 16 };
const effOf = (po) => po.eff_status || po.helm_status_id || ENUM_TO_HELM[po.status] || 11;
const isOverdue = (po) => {
  if (po.overdue != null) return po.overdue;
  return !!(po.expected_date && new Date(po.expected_date) < new Date() && [13, 14].includes(effOf(po)));
};

const VIEWS = [
  { key: 'inbound',    label: 'Inbound / Submitted' },
  { key: 'exceptions', label: 'Exceptions / Issues' },
  { key: 'historical', label: 'Historical Archive' },
];

const fmt = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const todayKey = fmt(new Date());

function StatusPill({ po }) {
  const s = isOverdue(po) ? { c: '#E11D48', l: 'Overdue' } : (HELM_STATUS[effOf(po)] || { c: MUTED, l: po.status || '—' });
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: s.c }}>
    <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.c }} /> {s.l}</span>;
}

function PoDrawer({ id, onClose }) {
  const { data, isLoading } = useQuery({ queryKey: ['po', id], queryFn: () => getPurchaseOrder(id), enabled: !!id });
  const totalExpected = (data?.lines || []).reduce((a, l) => a + (l.qty_ordered || 0), 0);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 100 }}>
      <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 0, right: 0, height: '100%', width: 480, maxWidth: '92vw', background: '#fff', boxShadow: '-8px 0 24px rgba(0,0,0,0.12)', padding: 24, overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: TITLE }}>{data?.po_number || 'Purchase order'}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED }}><X size={18} /></button>
        </div>
        {isLoading && <div style={{ color: '#94A3B8', fontSize: 13 }}>Loading…</div>}
        {data && (
          <>
            <div style={{ display: 'flex', gap: 20, marginBottom: 16, flexWrap: 'wrap' }}>
              <div><div style={{ fontSize: 11, color: '#94A3B8' }}>Customer</div><div style={{ fontSize: 13, color: TITLE }}>{data.customer_name || '—'}</div></div>
              <div><div style={{ fontSize: 11, color: '#94A3B8' }}>Status</div><StatusPill po={data} /></div>
              <div><div style={{ fontSize: 11, color: '#94A3B8' }}>Expected</div><div style={{ fontSize: 13, color: TITLE }}>{data.expected_date ? new Date(data.expected_date).toLocaleDateString('en-GB') : '—'}</div></div>
              <div><div style={{ fontSize: 11, color: '#94A3B8' }}>Total expected</div><div style={{ fontSize: 13, fontWeight: 700, color: ACCENT }}>{totalExpected} units</div></div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: TITLE, marginBottom: 8 }}>Expecting into the warehouse ({data.lines?.length || 0} SKUs)</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr style={{ color: '#94A3B8', textAlign: 'left' }}>
                <th style={{ padding: '6px 4px' }}>SKU</th><th style={{ padding: '6px 4px' }}>Description</th>
                <th style={{ padding: '6px 4px', textAlign: 'right' }}>Expected</th><th style={{ padding: '6px 4px', textAlign: 'right' }}>Received</th>
              </tr></thead>
              <tbody>
                {(data.lines || []).map(l => {
                  const done = l.qty_received >= l.qty_ordered && l.qty_ordered > 0;
                  return (
                    <tr key={l.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                      <td style={{ padding: '8px 4px', color: '#334155', fontWeight: 600 }}>{l.sku || '—'}</td>
                      <td style={{ padding: '8px 4px', color: MUTED }}>{l.description || '—'}</td>
                      <td style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 700, color: ACCENT }}>{l.qty_ordered}</td>
                      <td style={{ padding: '8px 4px', textAlign: 'right', color: done ? '#15803D' : '#B45309', fontWeight: 600 }}>{l.qty_received}</td>
                    </tr>
                  );
                })}
                {(!data.lines || data.lines.length === 0) && <tr><td colSpan={4} style={{ padding: 12, color: '#94A3B8' }}>No line items on this PO.</td></tr>}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

function CalendarView({ rows, onOpen }) {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const byDate = {};
  for (const po of rows) { if (po.expected_date) { const k = String(po.expected_date).slice(0, 10); (byDate[k] ||= []).push(po); } }

  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const startDow = (first.getDay() + 6) % 7;
  const gridStart = new Date(first); gridStart.setDate(first.getDate() - startDow);
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d; });
  const expectingToday = byDate[todayKey] || [];

  return (
    <div>
      {expectingToday.length > 0 && (
        <div style={{ background: '#EEF4FF', border: '1px solid rgba(0,86,251,0.2)', borderRadius: 10, padding: '12px 16px', marginBottom: 14, fontSize: 13, color: '#1E3A8A' }}>
          <b>Expected today:</b> {expectingToday.map(p => `${p.customer_name || '—'} (${p.po_number || p.id.slice(0, 6)})`).join(' · ')}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: HEADER }}>{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} style={navBtn}><ChevronLeft size={16} /></button>
          <button onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }} style={{ ...navBtn, width: 'auto', padding: '0 12px', fontSize: 12, fontWeight: 600 }}>Today</button>
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} style={navBtn}><ChevronRight size={16} /></button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 1, background: 'rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 10, overflow: 'hidden' }}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
          <div key={d} style={{ background: '#F8FAFC', padding: '7px 8px', fontSize: 11, fontWeight: 700, color: MUTED }}>{d}</div>
        ))}
        {days.map((d, i) => {
          const k = fmt(d); const inMonth = d.getMonth() === month.getMonth(); const pos = byDate[k] || []; const isToday = k === todayKey;
          return (
            <div key={i} style={{ background: inMonth ? '#fff' : '#FBFBFC', minHeight: 96, padding: 6, opacity: inMonth ? 1 : 0.55 }}>
              <div style={{ fontSize: 11, fontWeight: isToday ? 800 : 600, color: isToday ? ACCENT : '#94A3B8', marginBottom: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: '50%', background: isToday ? 'rgba(0,86,251,0.12)' : 'transparent' }}>{d.getDate()}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {pos.slice(0, 4).map(po => {
                  const c = isOverdue(po) ? '#E11D48' : (HELM_STATUS[effOf(po)] || { c: MUTED }).c;
                  return (
                    <div key={po.id} onClick={() => onOpen(po.id)} title={`${po.customer_name || ''} · ${po.po_number || ''} · ${po.total_units} units`}
                      style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 11, padding: '2px 5px', borderRadius: 5, background: `${c}14`, color: '#334155', overflow: 'hidden' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: c, flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{po.customer_name || po.po_number || 'PO'}</span>
                    </div>
                  );
                })}
                {pos.length > 4 && <div style={{ fontSize: 10, color: MUTED }}>+{pos.length - 4} more</div>}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11.5, color: MUTED, marginTop: 10 }}>Inbound POs by expected delivery date. Click one for the SKU breakdown.</div>
    </div>
  );
}

export default function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const [listView, setListView] = useState('inbound');
  const [openId, setOpenId] = useState(null);
  const [mode, setMode] = useState('list');

  const view = mode === 'calendar' ? 'inbound' : listView;
  const { data: stats } = useQuery({ queryKey: ['po-stats'], queryFn: poStats });
  const { data, isLoading } = useQuery({ queryKey: ['purchase-orders', view], queryFn: () => listPurchaseOrders({ view, limit: 500 }) });
  const rows = data?.purchase_orders || [];

  return (
    <div style={{ width: '100%', maxWidth: 1280 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <PackagePlus size={20} color={ACCENT} />
          <h1 style={{ fontSize: 23, fontWeight: 800, color: HEADER, margin: 0, letterSpacing: -0.5 }}>Purchase Orders</h1>
        </div>
        <div style={{ display: 'flex', background: '#F1F5F9', borderRadius: 9, padding: 3 }}>
          {[['list', 'List', List], ['calendar', 'Calendar', Calendar]].map(([k, l, Ic]) => (
            <button key={k} onClick={() => setMode(k)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', background: mode === k ? '#fff' : 'transparent', color: mode === k ? ACCENT : MUTED, boxShadow: mode === k ? SHADOW : 'none' }}>
              <Ic size={14} /> {l}
            </button>
          ))}
        </div>
      </div>

      {/* Focused inbound KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Submitted (inbound)', v: stats?.submitted, c: TEAL },
          { l: 'Partially received', v: stats?.partially_received, c: '#F59E0B' },
          { l: 'Exceptions', v: stats?.exceptions, c: '#E11D48' },
        ].map(s => (
          <div key={s.l} style={{ background: '#fff', border: '1px solid rgba(16,24,40,0.06)', borderRadius: 12, boxShadow: SHADOW, padding: '14px 16px' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.c, letterSpacing: -0.5 }}>{s.v ?? '—'}</div>
            <div style={{ fontSize: 12, color: MUTED }}>{s.l}</div>
          </div>
        ))}
      </div>

      {mode === 'calendar' ? (
        <div style={{ background: '#fff', border: '1px solid rgba(16,24,40,0.06)', borderRadius: 12, boxShadow: SHADOW, padding: 18 }}>
          <CalendarView rows={rows} onOpen={setOpenId} />
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            {VIEWS.map(v => (
              <button key={v.key} onClick={() => setListView(v.key)} style={{ fontSize: 12, fontWeight: 600, padding: '6px 13px', borderRadius: 999, cursor: 'pointer', border: '1px solid', borderColor: listView === v.key ? HEADER : 'rgba(0,0,0,0.12)', background: listView === v.key ? HEADER : '#fff', color: listView === v.key ? '#fff' : '#334155' }}>{v.label}</button>
            ))}
          </div>
          <div style={{ background: '#fff', border: '1px solid rgba(16,24,40,0.06)', borderRadius: 12, boxShadow: SHADOW, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: '#F8FAFC', color: MUTED, textAlign: 'left' }}>
                <th style={th}>PO number</th><th style={th}>Customer</th><th style={th}>Status</th><th style={th}>Expected</th><th style={th}>Lines</th><th style={th}>Units</th>
              </tr></thead>
              <tbody>
                {isLoading && <tr><td colSpan={6} style={{ ...td, color: '#94A3B8' }}>Loading…</td></tr>}
                {!isLoading && rows.length === 0 && <tr><td colSpan={6} style={{ ...td, color: '#94A3B8' }}>Nothing in this view.</td></tr>}
                {rows.map(po => (
                  <tr key={po.id} onClick={() => setOpenId(po.id)} style={{ cursor: 'pointer', borderTop: '1px solid rgba(0,0,0,0.05)' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'} onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                    <td style={{ ...td, fontWeight: 600, color: TITLE }}>{po.po_number || po.id.slice(0, 8)}</td>
                    <td style={td}>{po.customer_id ? <span onClick={e => { e.stopPropagation(); navigate(`/customers/${po.customer_id}`); }} style={{ color: ACCENT, cursor: 'pointer' }}>{po.customer_name || '—'}</span> : (po.customer_name || '—')}</td>
                    <td style={td}><StatusPill po={po} /></td>
                    <td style={td}>{po.expected_date ? new Date(po.expected_date).toLocaleDateString('en-GB') : '—'}</td>
                    <td style={td}>{po.total_lines}</td><td style={td}>{po.total_units}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {openId && <PoDrawer id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

const th = { padding: '10px 14px', fontWeight: 600, fontSize: 12 };
const td = { padding: '11px 14px', color: '#334155' };
const navBtn = { width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)', background: '#fff', cursor: 'pointer', color: '#334155' };
