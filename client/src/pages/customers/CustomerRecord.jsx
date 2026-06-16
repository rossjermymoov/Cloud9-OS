import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { getCustomer } from '../../api/customers';

const RAG = { green: '#00C853', amber: '#F59E0B', red: '#E91E8C', grey: '#94A3B8' };
const HEALTH = { green: 'Healthy', amber: 'Warning', red: 'At Risk' };

function Card({ title, children }) {
  return (
    <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 14, padding: 18 }}>
      {title && <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', marginBottom: 12 }}>{title}</div>}
      {children}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: '#0F172A' }}>{value || '—'}</div>
    </div>
  );
}

export default function CustomerRecord() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['customer', id], queryFn: () => getCustomer(id) });

  if (isLoading) return <div style={{ color: '#94A3B8' }}>Loading…</div>;
  if (!data) return <div style={{ color: '#94A3B8' }}>Customer not found.</div>;

  const c = data.customer;

  return (
    <div style={{ maxWidth: 1000 }}>
      <button onClick={() => navigate('/customers')} style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
        color: '#64748B', fontSize: 13, cursor: 'pointer', marginBottom: 14, padding: 0,
      }}>
        <ArrowLeft size={15} /> Customers
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', margin: 0 }}>{c.business_name}</h1>
        <span style={{ fontSize: 12, color: '#64748B', background: '#F1F5F9', borderRadius: 6, padding: '3px 8px' }}>{c.helm_accounts_id || c.account_number}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#334155' }}
          title={c.health_score_summary || ''}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: RAG[c.health_score] }} />
          {HEALTH[c.health_score]}
        </span>
      </div>
      {c.health_score_summary && (
        <div style={{ fontSize: 12.5, color: '#64748B', margin: '-8px 0 18px' }}>
          <span style={{ fontWeight: 600, color: RAG[c.health_score] }}>Health:</span> {c.health_score_summary}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card title="Details">
          <Field label="Primary email" value={c.primary_email} />
          <Field label="Phone" value={c.phone_number} />
          <Field label="Address" value={[c.address_line_1, c.city, c.postcode].filter(Boolean).join(', ')} />
          <Field label="Tier" value={c.tier} />
          <Field label="Account status" value={String(c.account_status).replace('_', ' ')} />
        </Card>

        <Card title="Commercial">
          <Field label="Credit limit" value={`£${Number(c.credit_limit || 0).toLocaleString()}`} />
          <Field label="Outstanding balance" value={`£${Number(c.outstanding_balance || 0).toLocaleString()}`} />
          <Field label="Payment terms" value={`${c.payment_terms_days} days`} />
          <Field label="Billing cycle" value={c.billing_cycle} />
          <Field label="Account ID (Helm / Xero)" value={c.helm_accounts_id} />
          <Field label="Helm client ID" value={c.helm_customer_id} />
        </Card>

        {/* Dispatch volume */}
        <Card title="Dispatch volume · last 90 days">
          {(() => {
            const snaps = data.volume_snapshots || [];
            const parcels = snaps.reduce((a, s) => a + (s.parcel_count || 0), 0);
            const items   = snaps.reduce((a, s) => a + (s.item_count || 0), 0);
            if (!snaps.length) return <div style={{ fontSize: 13, color: '#94A3B8' }}>No dispatch volume yet — run the Helm volume sync.</div>;
            return (
              <>
                <div style={{ display: 'flex', gap: 24, marginBottom: 12 }}>
                  <div><div style={{ fontSize: 22, fontWeight: 700, color: '#0056FB' }}>{parcels}</div><div style={{ fontSize: 11, color: '#94A3B8' }}>parcels</div></div>
                  <div><div style={{ fontSize: 22, fontWeight: 700, color: '#7B2FBE' }}>{items}</div><div style={{ fontSize: 11, color: '#94A3B8' }}>items</div></div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {snaps.slice(0, 7).map(s => (
                    <div key={s.snapshot_date} style={{ display: 'flex', fontSize: 12, color: '#64748B' }}>
                      <span style={{ flex: 1 }}>{new Date(s.snapshot_date).toLocaleDateString('en-GB')}</span>
                      <span style={{ width: 80, textAlign: 'right' }}>{s.parcel_count} parcels</span>
                      <span style={{ width: 70, textAlign: 'right' }}>{s.item_count} items</span>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </Card>

        {/* Activity feed — notifications threaded onto the customer record */}
        <Card title="Activity">
          {(!data.notifications?.length) && <div style={{ fontSize: 13, color: '#94A3B8' }}>No activity yet.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(data.notifications || []).map(n => (
              <div key={n.id} style={{ display: 'flex', gap: 10 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', marginTop: 5, flexShrink: 0, background: RAG[n.severity] || RAG.grey }} />
                <div>
                  <div style={{ fontSize: 13, color: '#0F172A', fontWeight: 500 }}>{n.title}</div>
                  {n.body && <div style={{ fontSize: 12, color: '#64748B' }}>{n.body}</div>}
                  <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{new Date(n.created_at).toLocaleString('en-GB')}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Purchase orders */}
        <Card title="Purchase orders">
          {(!data.purchase_orders?.length) && <div style={{ fontSize: 13, color: '#94A3B8' }}>No purchase orders yet.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(data.purchase_orders || []).map(po => (
              <div key={po.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 13, color: '#0F172A', flex: 1 }}>{po.po_number || po.id.slice(0, 8)}</span>
                <span style={{ fontSize: 12, color: '#64748B' }}>{po.total_units} units</span>
                <span style={{ fontSize: 11, textTransform: 'capitalize', color: po.status === 'received' ? '#00C853' : po.status === 'open' ? '#F59E0B' : '#64748B' }}>
                  {String(po.status).replace('_', ' ')}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
