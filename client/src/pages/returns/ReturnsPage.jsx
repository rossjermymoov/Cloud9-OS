import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import { listReturns, returnStats } from '../../api/returns';

export default function ReturnsPage() {
  const navigate = useNavigate();
  const { data: stats } = useQuery({ queryKey: ['return-stats'], queryFn: returnStats });
  const { data, isLoading } = useQuery({ queryKey: ['returns'], queryFn: () => listReturns({ limit: 100 }) });
  const rows = data?.returns || [];

  return (
    <div style={{ width: '100%', maxWidth: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <RotateCcw size={20} color="#E91E8C" />
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', margin: 0 }}>Returns</h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Today', v: stats?.today, c: '#E91E8C' },
          { l: 'Last 7 days', v: stats?.last_7d, c: '#F59E0B' },
          { l: 'Total', v: stats?.total, c: '#0F172A' },
        ].map(s => (
          <div key={s.l} style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.c }}>{s.v ?? '—'}</div>
            <div style={{ fontSize: 12, color: '#64748B' }}>{s.l}</div>
          </div>
        ))}
      </div>

      <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 14, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#F8FAFC', color: '#64748B', textAlign: 'left' }}>
              <th style={th}>Reference</th><th style={th}>Customer</th><th style={th}>Order</th>
              <th style={th}>Reason</th><th style={th}>Status</th><th style={th}>Raised</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} style={{ ...td, color: '#94A3B8' }}>Loading…</td></tr>}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={6} style={{ ...td, color: '#94A3B8' }}>No returns yet — they appear here when a return is raised in Helm.</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ ...td, fontWeight: 600, color: '#0F172A' }}>{r.reference || r.helm_return_id || r.id.slice(0, 8)}</td>
                <td style={td}>
                  {r.customer_id
                    ? <span onClick={() => navigate(`/customers/${r.customer_id}`)} style={{ color: '#0056FB', cursor: 'pointer' }}>{r.customer_name || '—'}</span>
                    : (r.customer_name || '—')}
                </td>
                <td style={td}>{r.order_ref || '—'}</td>
                <td style={td}>{r.reason || '—'}</td>
                <td style={td}>{r.status || '—'}</td>
                <td style={td}>{new Date(r.created_at).toLocaleDateString('en-GB')}</td>
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
