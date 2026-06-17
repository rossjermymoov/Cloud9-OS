import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Building2, Users, MessageSquare, TrendingUp, PoundSterling,
  PackagePlus, RotateCcw, Heart, Pencil, Check, X, Trash2, Plus, Boxes, Send,
} from 'lucide-react';
import api from '../../api/client';
import {
  getCustomer, updateCustomer, addContact, updateContact, deleteContact,
  listCommunications, addCommunication,
} from '../../api/customers';
import { volumeCustomer } from '../../api/volume';

const RAG = { green: '#00C853', amber: '#F59E0B', red: '#E11D48', grey: '#94A3B8' };
const HEALTH = { green: 'Healthy', amber: 'Warning', red: 'At Risk' };
const STATUS = { active: { c: '#15803D', l: 'Active' }, on_stop: { c: '#E11D48', l: 'On Stop' }, suspended: { c: '#B45309', l: 'Suspended' }, churned: { c: '#64748B', l: 'Churned' } };
const SHADOW = '0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.10)';
const HEADER = '#0B1220', TITLE = '#0F172A', MUTED = '#64748B', ACCENT = '#0056FB';
const gbp = (n) => `£${parseFloat(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const TABS = [
  { key: 'overview',  label: 'Overview',        Icon: Building2 },
  { key: 'contacts',  label: 'Contacts',        Icon: Users },
  { key: 'comms',     label: 'Communications',  Icon: MessageSquare },
  { key: 'performance', label: 'Performance',   Icon: TrendingUp },
  { key: 'financial', label: 'Financial',       Icon: PoundSterling },
  { key: 'pos',       label: 'Purchase Orders', Icon: PackagePlus },
  { key: 'returns',   label: 'Returns',         Icon: RotateCcw },
  { key: 'happiness', label: 'Happiness',       Icon: Heart },
];

function Card({ title, right, children, style }) {
  return (
    <div style={{ background: '#fff', border: '1px solid rgba(16,24,40,0.06)', borderRadius: 12, boxShadow: SHADOW, padding: 18, ...style }}>
      {(title || right) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          {title && <span style={{ fontSize: 13, fontWeight: 700, color: TITLE }}>{title}</span>}
          {right}
        </div>
      )}
      {children}
    </div>
  );
}
function Field({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', minHeight: 24 }}>
      <span style={{ fontSize: 12, color: MUTED, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12.5, color: TITLE, textAlign: 'right', wordBreak: 'break-word' }}>{value || '—'}</span>
    </div>
  );
}
const inp = { width: '100%', boxSizing: 'border-box', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.14)', fontSize: 12.5, outline: 'none' };
function EditRow({ label, k, form, set, placeholder }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', padding: '3px 0' }}>
      <span style={{ fontSize: 12, color: MUTED, flexShrink: 0 }}>{label}</span>
      <input style={{ ...inp, width: 200 }} value={form[k] ?? ''} placeholder={placeholder || ''} onChange={e => set(k, e.target.value)} />
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────
function OverviewTab({ c, onSaved }) {
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({});
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  function start() {
    setForm({
      business_name: c.business_name || '', company_type: c.company_type || '', company_reg_number: c.company_reg_number || '',
      vat_number: c.vat_number || '', phone_number: c.phone_number || '', primary_email: c.primary_email || '', accounts_email: c.accounts_email || '',
      address_line_1: c.address_line_1 || '', address_line_2: c.address_line_2 || '', city: c.city || '', county: c.county || '',
      postcode: c.postcode || '', country: c.country || 'United Kingdom',
      credit_limit: c.credit_limit ?? 0, payment_terms_days: c.payment_terms_days ?? 30, billing_cycle: c.billing_cycle || 'monthly', tier: c.tier || 'bronze',
    });
    setEdit(true);
  }
  const save = useMutation({
    mutationFn: () => updateCustomer(c.id, { ...form, credit_limit: parseFloat(form.credit_limit) || 0, payment_terms_days: parseInt(form.payment_terms_days) || 30 }),
    onSuccess: () => { onSaved(); setEdit(false); },
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12, gap: 8 }}>
        {edit ? (
          <>
            <button onClick={() => setEdit(false)} style={btnGhost}><X size={13} /> Cancel</button>
            <button onClick={() => save.mutate()} disabled={save.isPending} style={btnPrimary}><Check size={13} /> {save.isPending ? 'Saving…' : 'Save'}</button>
          </>
        ) : <button onClick={start} style={btnGhost}><Pencil size={13} /> Edit details</button>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card title="Business details">
            {edit ? <>
              <EditRow label="Business name" k="business_name" form={form} set={set} />
              <EditRow label="Company type" k="company_type" form={form} set={set} placeholder="limited_company" />
              <EditRow label="Company reg." k="company_reg_number" form={form} set={set} />
              <EditRow label="VAT number" k="vat_number" form={form} set={set} />
              <EditRow label="Phone" k="phone_number" form={form} set={set} />
              <EditRow label="Main email" k="primary_email" form={form} set={set} />
              <EditRow label="Accounts email" k="accounts_email" form={form} set={set} />
            </> : <>
              <Field label="Business name" value={c.business_name} />
              <Field label="Company type" value={c.company_type} />
              <Field label="Company reg." value={c.company_reg_number} />
              <Field label="VAT number" value={c.vat_number} />
              <Field label="Phone" value={c.phone_number} />
              <Field label="Main email" value={c.primary_email} />
              <Field label="Accounts email" value={c.accounts_email} />
              <Field label="Account ID (Helm / Xero)" value={c.helm_accounts_id} />
            </>}
          </Card>
          <Card title="Address">
            <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 8 }}>Not provided by Helm — fill in manually.</div>
            {edit ? <>
              <EditRow label="Address 1" k="address_line_1" form={form} set={set} />
              <EditRow label="Address 2" k="address_line_2" form={form} set={set} />
              <EditRow label="City / town" k="city" form={form} set={set} />
              <EditRow label="County" k="county" form={form} set={set} />
              <EditRow label="Postcode" k="postcode" form={form} set={set} />
              <EditRow label="Country" k="country" form={form} set={set} />
            </> : <>
              <Field label="Address 1" value={c.address_line_1} />
              <Field label="Address 2" value={c.address_line_2} />
              <Field label="City / town" value={c.city} />
              <Field label="County" value={c.county} />
              <Field label="Postcode" value={c.postcode} />
              <Field label="Country" value={c.country} />
            </>}
          </Card>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card title="Account settings">
            {edit ? <>
              <EditRow label="Tier" k="tier" form={form} set={set} />
              <EditRow label="Credit limit (£)" k="credit_limit" form={form} set={set} />
              <EditRow label="Payment terms (days)" k="payment_terms_days" form={form} set={set} />
              <EditRow label="Billing cycle" k="billing_cycle" form={form} set={set} />
            </> : <>
              <Field label="Tier" value={c.tier} />
              <Field label="Credit limit" value={gbp(c.credit_limit)} />
              <Field label="Payment terms" value={`${c.payment_terms_days} days`} />
              <Field label="Billing cycle" value={c.billing_cycle} />
              <Field label="Status" value={(STATUS[c.account_status] || {}).l} />
            </>}
          </Card>
          <Card title="Health detail">
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: RAG[c.health_score] }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: TITLE }}>{HEALTH[c.health_score]}</span>
            </div>
            <p style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.6, margin: 0 }}>{c.health_score_summary || 'Not yet calculated.'}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ── Contacts ────────────────────────────────────────────────
const BLANK = { full_name: '', job_title: '', phone_number: '', email_address: '', is_main_contact: false, is_finance_contact: false };
function ContactsTab({ customerId, contacts, onRefresh }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(BLANK);
  const add = useMutation({ mutationFn: () => addContact(customerId, form), onSuccess: () => { setAdding(false); setForm(BLANK); onRefresh(); } });
  const del = useMutation({ mutationFn: (cid) => deleteContact(customerId, cid), onSuccess: onRefresh });
  const flag = useMutation({ mutationFn: ({ cid, data }) => updateContact(customerId, cid, data), onSuccess: onRefresh });

  return (
    <Card title="Contacts" right={!adding && <button onClick={() => setAdding(true)} style={btnGhost}><Plus size={13} /> Add contact</button>}>
      {adding && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 12, padding: 12, background: '#F8FAFC', borderRadius: 8 }}>
          {[['full_name', 'Full name *'], ['job_title', 'Job title'], ['phone_number', 'Phone'], ['email_address', 'Email *']].map(([k, l]) => (
            <input key={k} style={inp} placeholder={l} value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />
          ))}
          <label style={chkLabel}><input type="checkbox" checked={form.is_main_contact} onChange={e => setForm(f => ({ ...f, is_main_contact: e.target.checked }))} /> Main</label>
          <label style={chkLabel}><input type="checkbox" checked={form.is_finance_contact} onChange={e => setForm(f => ({ ...f, is_finance_contact: e.target.checked }))} /> Finance</label>
          <div style={{ gridColumn: 'span 2', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => { setAdding(false); setForm(BLANK); }} style={btnGhost}>Cancel</button>
            <button onClick={() => add.mutate()} disabled={!form.full_name || !form.email_address} style={btnPrimary}><Check size={13} /> Save</button>
          </div>
        </div>
      )}
      {contacts.length === 0 && !adding ? <div style={{ fontSize: 12.5, color: '#94A3B8', padding: '16px 0' }}>No contacts yet.</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead><tr style={{ color: MUTED, textAlign: 'left' }}>
            <th style={th}>Name</th><th style={th}>Role</th><th style={th}>Phone</th><th style={th}>Email</th><th style={th}>Flags</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {contacts.map(ct => (
              <tr key={ct.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ ...td, fontWeight: 600 }}>{ct.full_name}</td>
                <td style={td}>{ct.job_title || '—'}</td>
                <td style={td}>{ct.phone_number || '—'}</td>
                <td style={{ ...td, color: ACCENT }}>{ct.email_address}</td>
                <td style={td}>
                  <span onClick={() => flag.mutate({ cid: ct.id, data: { is_main_contact: !ct.is_main_contact } })}
                    style={{ ...tag, cursor: 'pointer', background: ct.is_main_contact ? 'rgba(0,200,83,0.15)' : '#F1F5F9', color: ct.is_main_contact ? '#15803D' : '#94A3B8' }}>Main</span>
                  <span onClick={() => flag.mutate({ cid: ct.id, data: { is_finance_contact: !ct.is_finance_contact } })}
                    style={{ ...tag, cursor: 'pointer', marginLeft: 5, background: ct.is_finance_contact ? 'rgba(123,47,190,0.15)' : '#F1F5F9', color: ct.is_finance_contact ? '#7B2FBE' : '#94A3B8' }}>Finance</span>
                </td>
                <td style={td}><button onClick={() => del.mutate(ct.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#E11D48' }}><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ── Communications ──────────────────────────────────────────
function CommsTab({ customerId }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const { data: comms } = useQuery({ queryKey: ['comms', customerId], queryFn: () => listCommunications(customerId) });
  const add = useMutation({ mutationFn: () => addCommunication(customerId, { body: note }), onSuccess: () => { setNote(''); qc.invalidateQueries({ queryKey: ['comms', customerId] }); } });
  return (
    <Card title="Communications">
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input style={inp} placeholder="Add an internal note…" value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => e.key === 'Enter' && note.trim() && add.mutate()} />
        <button onClick={() => add.mutate()} disabled={!note.trim()} style={btnPrimary}><Plus size={13} /> Add note</button>
      </div>
      <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 10 }}>Email correspondence will appear here once the Queries / inbox module is connected.</div>
      {(!comms || comms.length === 0) ? <div style={{ fontSize: 12.5, color: '#94A3B8' }}>No communications logged yet.</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {comms.map(m => (
            <div key={m.id} style={{ borderLeft: `3px solid ${m.direction === 'inbound' ? ACCENT : '#CBD5E1'}`, paddingLeft: 10 }}>
              <div style={{ fontSize: 11, color: MUTED }}>{m.channel} · {new Date(m.created_at).toLocaleString('en-GB')}</div>
              {m.subject && <div style={{ fontSize: 12.5, fontWeight: 600, color: TITLE }}>{m.subject}</div>}
              <div style={{ fontSize: 12.5, color: '#334155' }}>{m.body}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Performance ─────────────────────────────────────────────
function Toggle({ value, onChange, options }) {
  return (
    <div style={{ display: 'inline-flex', background: '#F1F5F9', borderRadius: 8, padding: 3 }}>
      {options.map(([v, l]) => (
        <button key={v} onClick={() => onChange(v)} style={{ fontSize: 12, fontWeight: 600, padding: '5px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', background: value === v ? '#fff' : 'transparent', color: value === v ? ACCENT : MUTED, boxShadow: value === v ? SHADOW : 'none' }}>{l}</button>
      ))}
    </div>
  );
}

function PerformanceTab({ customerId }) {
  const [tf, setTf] = useState('month');
  const [metric, setMetric] = useState('parcels');
  const [custFrom, setCustFrom] = useState('');
  const [custTo, setCustTo] = useState('');
  const [hover, setHover] = useState(null);

  const ymd = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const back = (n) => { const d = new Date(today); d.setDate(today.getDate() - n); return d; };
  let from, to;
  if (tf === 'custom') { from = custFrom; to = custTo; }
  else { to = ymd(today); from = ymd(tf === 'day' ? today : tf === 'week' ? back(6) : tf === 'month' ? back(29) : back(89)); }

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['cust-volume', customerId, from, to],
    queryFn: () => volumeCustomer(customerId, { from, to }),
    enabled: !!customerId && !!from && !!to,
  });

  const totalParcels = rows.reduce((a, r) => a + (r.parcels || 0), 0);
  const totalItems = rows.reduce((a, r) => a + (r.items || 0), 0);
  const max = Math.max(1, ...rows.map(r => r[metric] || 0));
  // Date label under each bar — thinned out as the range grows; month shown when it changes.
  const step = Math.max(1, Math.ceil(rows.length / 14));
  const barLabels = (() => {
    const out = []; let prevMonth = null;
    rows.forEach((r, i) => {
      const show = i % step === 0 || i === rows.length - 1;
      if (!show) { out.push(null); return; }
      const d = new Date(r.date); const m = d.getMonth();
      out.push(m !== prevMonth ? `${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}` : `${d.getDate()}`);
      prevMonth = m;
    });
    return out;
  })();
  const TF = [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['quarter', 'Quarter'], ['custom', 'Custom']];
  const dateInp = { fontSize: 12, padding: '5px 8px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.14)', outline: 'none' };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 22 }}>
          <div><div style={{ fontSize: 26, fontWeight: 800, color: HEADER, letterSpacing: -0.6 }}>{totalParcels.toLocaleString()}</div><div style={{ fontSize: 11.5, color: MUTED }}>parcels in range</div></div>
          <div><div style={{ fontSize: 26, fontWeight: 800, color: '#7B2FBE', letterSpacing: -0.6 }}>{totalItems.toLocaleString()}</div><div style={{ fontSize: 11.5, color: MUTED }}>items in range</div></div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Toggle value={metric} onChange={setMetric} options={[['parcels', 'Parcels'], ['items', 'Items']]} />
          <Toggle value={tf} onChange={setTf} options={TF} />
          {tf === 'custom' && <>
            <input type="date" value={custFrom} onChange={e => setCustFrom(e.target.value)} style={dateInp} />
            <span style={{ color: MUTED, fontSize: 12 }}>→</span>
            <input type="date" value={custTo} onChange={e => setCustTo(e.target.value)} style={dateInp} />
          </>}
        </div>
      </div>

      <Card>
        {tf === 'custom' && (!from || !to)
          ? <div style={{ color: '#94A3B8', fontSize: 13, padding: '60px 0', textAlign: 'center' }}>Pick a start and end date.</div>
          : isLoading
            ? <div style={{ color: '#94A3B8', fontSize: 13, padding: '60px 0', textAlign: 'center' }}>Loading…</div>
            : rows.length === 0
              ? <div style={{ color: '#94A3B8', fontSize: 13, padding: '60px 0', textAlign: 'center' }}>No dispatch volume in this range.</div>
              : (
                <div style={{ position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'stretch', gap: rows.length > 45 ? 2 : 4, height: 360 }}>
                    {rows.map((r, i) => {
                      const isH = hover === i;
                      return (
                        <div key={r.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                          style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', cursor: 'default' }}>
                          <div style={{ width: '82%', minWidth: 3, background: isH ? '#3B82F6' : ACCENT, borderRadius: '3px 3px 0 0', height: Math.max(2, Math.round((r[metric] / max) * 300)), transition: 'background 0.12s ease' }} />
                          <div style={{ height: 26, paddingTop: 5, display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
                            {barLabels[i] && <span style={{ fontSize: 9.5, fontWeight: isH ? 700 : 400, color: isH ? '#334155' : '#94A3B8', whiteSpace: 'nowrap' }}>{barLabels[i]}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {hover != null && rows[hover] && (
                    <div style={{ position: 'absolute', top: 0, left: `${(hover / Math.max(1, rows.length - 1)) * 100}%`, transform: 'translateX(-50%)', background: '#0B1220', color: '#fff', borderRadius: 8, padding: '8px 11px', fontSize: 12, pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 10, boxShadow: '0 6px 18px rgba(0,0,0,0.2)' }}>
                      <div style={{ fontWeight: 700 }}>{new Date(rows[hover].date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
                      <div style={{ color: 'rgba(255,255,255,0.85)' }}>{rows[hover].parcels} parcels · {rows[hover].items} items</div>
                    </div>
                  )}
                </div>
              )}
      </Card>
    </div>
  );
}

// ── Financial ───────────────────────────────────────────────
function FinancialTab({ c }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      <Card title="Financial summary">
        <Field label="Credit limit" value={gbp(c.credit_limit)} />
        <Field label="Outstanding balance" value={gbp(c.outstanding_balance)} />
        <Field label="Payment terms" value={`${c.payment_terms_days} days`} />
        <Field label="Billing cycle" value={c.billing_cycle} />
      </Card>
      <Card title="Xero link">
        <Field label="Account ID" value={c.helm_accounts_id} />
        <div style={{ fontSize: 12, color: MUTED, marginTop: 8, lineHeight: 1.6 }}>
          This Account ID matches the Xero contact. Live invoices and balances will appear here once Xero is connected.
        </div>
      </Card>
    </div>
  );
}

// ── Purchase Orders ─────────────────────────────────────────
function POsTab({ customerId }) {
  const { data } = useQuery({ queryKey: ['cust-pos', customerId], queryFn: () => api.get('/purchase-orders', { params: { customer_id: customerId, limit: 100 } }).then(r => r.data) });
  const rows = data?.purchase_orders || [];
  return (
    <Card title="Purchase order history">
      {rows.length === 0 ? <div style={{ fontSize: 12.5, color: '#94A3B8' }}>No purchase orders for this customer yet.</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead><tr style={{ color: MUTED, textAlign: 'left' }}><th style={th}>PO</th><th style={th}>Status</th><th style={th}>Lines</th><th style={th}>Units</th><th style={th}>Raised</th></tr></thead>
          <tbody>{rows.map(po => (
            <tr key={po.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
              <td style={{ ...td, fontWeight: 600 }}>{po.po_number || po.id.slice(0, 8)}</td>
              <td style={{ ...td, textTransform: 'capitalize', color: po.status === 'received' ? '#15803D' : '#B45309' }}>{String(po.status).replace('_', ' ')}</td>
              <td style={td}>{po.total_lines}</td><td style={td}>{po.total_units}</td>
              <td style={td}>{new Date(po.created_at).toLocaleDateString('en-GB')}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </Card>
  );
}

// ── Returns ─────────────────────────────────────────────────
function ReturnsTab({ customerId }) {
  const { data } = useQuery({ queryKey: ['cust-returns', customerId], queryFn: () => api.get('/returns', { params: { customer_id: customerId, limit: 100 } }).then(r => r.data) });
  const rows = data?.returns || [];
  return (
    <Card title="Returns history">
      {rows.length === 0 ? <div style={{ fontSize: 12.5, color: '#94A3B8' }}>No returns for this customer yet.</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead><tr style={{ color: MUTED, textAlign: 'left' }}><th style={th}>Reference</th><th style={th}>Order</th><th style={th}>Reason</th><th style={th}>Status</th><th style={th}>Raised</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
              <td style={{ ...td, fontWeight: 600 }}>{r.reference || r.helm_return_id || r.id.slice(0, 8)}</td>
              <td style={td}>{r.order_ref || '—'}</td><td style={td}>{r.reason || '—'}</td>
              <td style={td}>{r.status || '—'}</td><td style={td}>{new Date(r.created_at).toLocaleDateString('en-GB')}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </Card>
  );
}

// ── Happiness ───────────────────────────────────────────────
function HappinessTab({ c }) {
  return (
    <Card title="Happiness / health score">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
        <div style={{ width: 54, height: 54, borderRadius: '50%', background: `${RAG[c.health_score]}1a`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Heart size={24} color={RAG[c.health_score]} />
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: RAG[c.health_score], letterSpacing: -0.5 }}>{HEALTH[c.health_score]}</div>
          <div style={{ fontSize: 12, color: MUTED }}>{c.health_score_updated ? `Updated ${new Date(c.health_score_updated).toLocaleString('en-GB')}` : 'Not yet calculated'}</div>
        </div>
      </div>
      <p style={{ fontSize: 13, color: '#334155', lineHeight: 1.6 }}>{c.health_score_summary || 'Score will calculate from dispatch volume trend, inactivity and returns once data is flowing.'}</p>
      <div style={{ fontSize: 11.5, color: MUTED, marginTop: 8 }}>Signals: dispatch-volume trend (week-on-week), inactivity, returns rate. Ticket sentiment is added when the Queries module is live.</div>
    </Card>
  );
}

export default function CustomerRecord() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState('overview');
  const { data, isLoading } = useQuery({ queryKey: ['customer', id], queryFn: () => getCustomer(id) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['customer', id] });

  if (isLoading) return <div style={{ color: '#94A3B8' }}>Loading…</div>;
  if (!data) return <div style={{ color: '#94A3B8' }}>Customer not found.</div>;
  const c = data.customer;

  return (
    // Full-width, edge-to-edge — matches the dashboard. The AppShell scroll
    // container already supplies the fluid 24px horizontal padding (≈ px-6),
    // so no max-width cap or auto-centering here.
    <div style={{ width: '100%', maxWidth: 'none' }}>
      <button onClick={() => navigate('/customers')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: MUTED, fontSize: 13, cursor: 'pointer', marginBottom: 14, padding: 0 }}>
        <ArrowLeft size={15} /> Customers
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 23, fontWeight: 800, color: HEADER, margin: 0, letterSpacing: -0.6 }}>{c.business_name}</h1>
        <span style={{ fontSize: 12, color: MUTED, background: '#F1F5F9', borderRadius: 6, padding: '3px 8px' }}>{c.helm_accounts_id || c.account_number}</span>
        <span style={{ ...tag, color: (STATUS[c.account_status] || {}).c, background: `${(STATUS[c.account_status] || {}).c}1a` }}>{(STATUS[c.account_status] || {}).l}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#334155' }} title={c.health_score_summary || ''}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: RAG[c.health_score] }} /> {HEALTH[c.health_score]}
        </span>
      </div>
      <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 18 }}>{c.primary_email} · {c.phone_number || 'no phone'}</div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid rgba(0,0,0,0.08)', marginBottom: 18, overflowX: 'auto' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', fontSize: 13, fontWeight: 600,
            background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
            color: tab === t.key ? ACCENT : MUTED, borderBottom: `2px solid ${tab === t.key ? ACCENT : 'transparent'}`, marginBottom: -1,
          }}>
            <t.Icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview'    && <OverviewTab c={c} onSaved={refresh} />}
      {tab === 'contacts'    && <ContactsTab customerId={id} contacts={data.contacts || []} onRefresh={refresh} />}
      {tab === 'comms'       && <CommsTab customerId={id} />}
      {tab === 'performance' && <PerformanceTab customerId={id} />}
      {tab === 'financial'   && <FinancialTab c={c} />}
      {tab === 'pos'         && <POsTab customerId={id} />}
      {tab === 'returns'     && <ReturnsTab customerId={id} />}
      {tab === 'happiness'   && <HappinessTab c={c} />}
    </div>
  );
}

const btnGhost = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#475569', background: '#fff', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 8, padding: '7px 12px', cursor: 'pointer' };
const btnPrimary = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: '#fff', background: ACCENT, border: 'none', borderRadius: 8, padding: '7px 12px', cursor: 'pointer' };
const th = { padding: '8px 10px', fontWeight: 600, fontSize: 11.5 };
const td = { padding: '9px 10px', color: '#334155' };
const tag = { fontSize: 11, fontWeight: 700, borderRadius: 6, padding: '2px 8px' };
const chkLabel = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#334155' };
