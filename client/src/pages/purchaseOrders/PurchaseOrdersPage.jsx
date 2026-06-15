import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { X, PackagePlus } from 'lucide-react';
import { listPurchaseOrders, poStats, getPurchaseOrder } from '../../api/purchaseOrders';

// RAG per PO status (Ross's convention: green=done, amber=in progress, red=problem).
const STATUS = {
  open:               { c: '#F59E0B', l: 'Open' },
  partially_received: { c: '#F59E0B', l: 'Partially received' },
  received:           { c: '#00C853', l: 'Received' },
  cancelled:          { c: '#E91E8C', l: 'Cancelled' },
};
const FILTERS = [
  { key: '',                   label: 'All' },
  { key: 'open',               label: 'Open' },
  { key: 'partially_received', label: 'Partial' },
  { key: 'received',           label: 'Received' },
];

function StatusPill({ status }) {
  const s = STATUS[status] || { c: '#64748B', l: status };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: s.c }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.c }} /> {s.l}
    </span>
  );
}

function PoDrawer({ id, onClose }) {
  const { data, isLoading } = useQuery({ queryKey: ['po', id], queryFn: () => getPurchaseOrder(id), enabled: !!id });
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 100 }}>
      <div onClick={e => e.stopPropagation()} style={{
        position: 'absolute', top: 0, right: 0, height: '100%', width: 460, maxWidth: '90vw',
        background: '#fff', boxShadow: '-8px 0 24px rgba(0,0,0,0.12)', padding: 24, overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>{data?.po_number || 'Purchase order'}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }}><X size={18} /></button>
        </div>
        {isLoading && <div style={{ color: '#94A3B8', fontSize: 13 }}>Loading…</div>}
        {data && (
          <>
            <div style={{ display: 'flex', gap: 20, marginBottom: 18 }}>
              <div><div style={{ fontSize: 11, color: '#94A3B8' }}>Customer</div><div style={{ fontSize: 13, color: '#0F172A' }}>{data.customer_name || '—'}</div></div>
              <div><div style={{ fontSize: 11, color: '#94A3B8' }}>Status</div><StatusPill status={data.status} /></div>
              <div><div style={{ fontSize: 11, color: '#94A3B8' }}>Expected</div><div style={{ fontSize: 13, color: '#0F172A' }}>{data.expected_date ? new Date(data.expected_date).toLocaleDateString('en-GB') : '—'}</div></div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', marginBottom: 8 }}>Lines ({data.lines?.length || 0})</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ color: '#94A3B8', textAlign: 'left' }}>
                <th style={{ padding: '6px 4px' }}>SKU</th><th style={{ padding: '6px 4px' }}>Description</th>
                <th style={{ padding: '6px 4px', textAlign: 'right' }}>Recv/Ord</th>
              </tr></thead>
              <tbody>
                {(data.lines || []).map(l => {
                  const done = l.qty_received >= l.qty_ordered && l.qty_ordered > 0;
                  return (
                    <tr key={l.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                      <td style={{ padding: '7px 4px', color: '#334155' }}>{l.sku || '—'}</td>
                      <td style={{ padding: '7px 4px', color: '#64748B' }}>{l.description || '—'}</td>
                      <td style={{ padding: '7px 4px', textAlign: 'right', color: done ? '#00C853' : '#F59E0B', fontWeight: 600 }}>
                        {l.qty_received}/{l.qty_ordered}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

export default function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const [openId, setOpenId] = useState(null);

  const { data: stats } = useQuery({ queryKey: ['po-stats'], queryFn: poStats });
  const { data, isLoading } = useQuery({
    queryKey: ['purchase-orders', filter],
    queryFn: () => listPurchaseOrders({ status: filter || undefined, limit: 100 }),
  });
  const rows = data?.purchase_orders || [];

  return (
    <div style={{ maxWidth: 1000 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <PackagePlus size={20} color="#0056FB" />
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', margin: 0 }}>Purchase Orders</h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Open', v: stats?.open, c: '#F59E0B' },
          { l: 'Partially received', v: stats?.partially_received, c: '#F59E0B' },
          { l: 'Received', v: stats?.received, c: '#00C853' },
          { l: 'Total', v: stats?.total, c: '#0F172A' },
        ].map(s => (
          <div key={s.l} style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.c }}>{s.v ?? '—'}</div>
            <div style={{ fontSize: 12, color: '#64748B' }}>{s.l}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)} style={{
            fontSize: 12, padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
            border: '1px solid', borderColor: filter === f.key ? '#0F172A' : 'rgba(0,0,0,0.12)',
            background: filter === f.key ? '#0F172A' : '#fff', color: filter === f.key ? '#fff' : '#334155',
          }}>{f.label}</button>
        ))}
      </div>

      <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 14, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#F8FAFC', color: '#64748B', textAlign: 'left' }}>
              <th style={th}>PO number</th><th style={th}>Customer</th><th style={th}>Status</th>
              <th style={th}>Lines</th><th style={th}>Units</th><th style={th}>Raised</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} style={{ ...td, color: '#94A3B8' }}>Loading…</td></tr>}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={6} style={{ ...td, color: '#94A3B8' }}>No purchase orders yet — they appear here when a customer books stock in.</td></tr>
            )}
            {rows.map(po => (
              <tr key={po.id} onClick={() => setOpenId(po.id)}
                style={{ cursor: 'pointer', borderTop: '1px solid rgba(0,0,0,0.05)' }}
                onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
                onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                <td style={{ ...td, fontWeight: 600, color: '#0F172A' }}>{po.po_number || po.id.slice(0, 8)}</td>
                <td style={td}>
                  {po.customer_id
                    ? <span onClick={e => { e.stopPropagation(); navigate(`/customers/${po.customer_id}`); }} style={{ color: '#0056FB', cursor: 'pointer' }}>{po.customer_name || '—'}</span>
                    : (po.customer_name || '—')}
                </td>
                <td style={td}><StatusPill status={po.status} /></td>
                <td style={td}>{po.total_lines}</td>
                <td style={td}>{po.total_units}</td>
                <td style={td}>{new Date(po.created_at).toLocaleDateString('en-GB')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openId && <PoDrawer id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

const th = { padding: '10px 14px', fontWeight: 600, fontSize: 12 };
const td = { padding: '11px 14px', color: '#334155' };
