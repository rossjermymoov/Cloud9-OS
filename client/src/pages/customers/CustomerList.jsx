import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw } from 'lucide-react';
import { listCustomers, syncCustomersFromHelm } from '../../api/customers';

const HEALTH = { green: { c: '#00C853', l: 'Healthy' }, amber: { c: '#F59E0B', l: 'Warning' }, red: { c: '#E91E8C', l: 'At Risk' } };
const STATUS = { active: '#166534', on_stop: '#E91E8C', suspended: '#92400e', churned: '#64748B' };

export default function CustomerList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['customers', search],
    queryFn: () => listCustomers({ search: search || undefined, limit: 100 }),
  });

  const rows = data?.data || [];

  async function refreshCustomers() {
    setSyncing(true); setSyncMsg(null);
    try {
      const r = await syncCustomersFromHelm();
      await qc.invalidateQueries({ queryKey: ['customers'] });
      setSyncMsg(`✓ ${r.inserted} new · ${r.updated} updated`);
      setTimeout(() => setSyncMsg(null), 6000);
    } catch (e) {
      setSyncMsg(e?.response?.data?.error || 'Sync failed');
    } finally { setSyncing(false); }
  }

  return (
    <div style={{ width: '100%', maxWidth: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', margin: 0 }}>Customers</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {syncMsg && <span style={{ fontSize: 12.5, color: syncMsg.startsWith('✓') ? '#15803D' : '#B91C1C', fontWeight: 600 }}>{syncMsg}</span>}
          <span style={{ fontSize: 13, color: '#64748B' }}>{data?.total ?? 0} total</span>
          <button onClick={refreshCustomers} disabled={syncing} title="Pull new customers from Helm and fill in missing data"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: '1px solid #E2E8F0', background: '#fff', cursor: syncing ? 'default' : 'pointer', borderRadius: 9, padding: '8px 13px', fontSize: 12.5, fontWeight: 600, color: '#0F172A', opacity: syncing ? 0.6 : 1 }}>
            <RefreshCw size={14} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} /> {syncing ? 'Refreshing…' : 'Refresh customers'}
          </button>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <div style={{ position: 'relative', maxWidth: 320, marginBottom: 16 }}>
        <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, account, email…"
          style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px 9px 34px', borderRadius: 10,
            border: '1px solid rgba(0,0,0,0.12)', fontSize: 13, outline: 'none' }} />
      </div>

      <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 14, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#F8FAFC', color: '#64748B', textAlign: 'left' }}>
              <th style={th}>Fulfilment Client</th><th style={th}>Account</th><th style={th}>Tier</th>
              <th style={th}>Status</th><th style={th}>Health</th><th style={th}>Postcode</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} style={{ ...td, color: '#94A3B8' }}>Loading…</td></tr>}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={6} style={{ ...td, color: '#94A3B8' }}>No customers yet — sync from Helm to populate.</td></tr>
            )}
            {rows.map(c => (
              <tr key={c.id} onClick={() => navigate(`/customers/${c.id}`)}
                style={{ cursor: 'pointer', borderTop: '1px solid rgba(0,0,0,0.05)' }}
                onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
                onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                <td style={{ ...td, fontWeight: 600, color: '#0F172A' }}>{c.business_name}</td>
                <td style={td}>{c.helm_accounts_id || c.account_number}</td>
                <td style={{ ...td, textTransform: 'capitalize' }}>{c.tier}</td>
                <td style={td}>
                  <span style={{ color: STATUS[c.account_status] || '#64748B', textTransform: 'capitalize', fontWeight: 600 }}>
                    {String(c.account_status).replace('_', ' ')}
                  </span>
                </td>
                <td style={td}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} title={c.health_score_summary || ''}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: (HEALTH[c.health_score] || {}).c }} />
                    {(HEALTH[c.health_score] || {}).l}
                  </span>
                </td>
                <td style={td}>{c.postcode || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th = { padding: '10px 14px', fontWeight: 600, fontSize: 12 };
const td = { padding: '11px 14px', color: '#334155' };
