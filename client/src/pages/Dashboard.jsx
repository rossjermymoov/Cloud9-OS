import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Truck, PackageCheck, Bell, AlertTriangle, Boxes, Send, Hand } from 'lucide-react';
import api from '../api/client';
import { listNotifications } from '../api/notifications';
import { volumeSummary, volumeDaily, volumeByCustomer } from '../api/volume';

// RAG mapping for parcel statuses on the live board.
const STATUS_RAG = {
  delivered: 'green', collected: 'green', in_transit: 'green', at_depot: 'green',
  out_for_delivery: 'green', booked: 'amber', on_hold: 'amber',
  awaiting_collection: 'amber', customs_hold: 'amber',
  failed_delivery: 'red', exception: 'red', returned: 'red', damaged: 'red',
};
const RAG = { green: '#00C853', amber: '#F59E0B', red: '#E91E8C', grey: '#94A3B8' };
const STATUS_LABEL = {
  booked: 'Booked', collected: 'Collected', at_depot: 'At Hub', in_transit: 'In Transit',
  out_for_delivery: 'Out for Delivery', failed_delivery: 'Failed Attempt', delivered: 'Delivered',
  on_hold: 'On Hold', exception: 'Address Issue', returned: 'Returned', tracking_expired: 'Tracking Expired',
  cancelled: 'Cancelled', awaiting_collection: 'Awaiting Collection', damaged: 'Damaged',
  customs_hold: 'Customs Hold', unknown: 'Unknown',
};

function Card({ children, style }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 14,
      padding: 18, ...style,
    }}>{children}</div>
  );
}

function Stat({ Icon, label, value, color }) {
  return (
    <Card style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{
        width: 42, height: 42, borderRadius: 10, flexShrink: 0,
        background: `${color}1f`, color, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={20} strokeWidth={1.8} />
      </div>
      <div>
        <div style={{ fontSize: 24, fontWeight: 700, color: '#0F172A', lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>{label}</div>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { data: stats } = useQuery({
    queryKey: ['tracking-stats'],
    queryFn: () => api.get('/tracking/stats').then(r => r.data),
  });
  const { data: notifs } = useQuery({
    queryKey: ['dashboard-notifs'],
    queryFn: () => listNotifications({ limit: 8 }),
  });
  const { data: vol }       = useQuery({ queryKey: ['volume-summary'], queryFn: volumeSummary });
  const { data: daily }     = useQuery({ queryKey: ['volume-daily'], queryFn: () => volumeDaily(14) });
  const { data: byCustomer } = useQuery({ queryKey: ['volume-by-customer'], queryFn: () => volumeByCustomer(1) });

  const byStatus = stats?.by_status || {};
  const statusRows = Object.entries(byStatus).sort((a, b) => b[1] - a[1]);
  const maxParcels = Math.max(1, ...(daily || []).map(d => d.parcels));

  return (
    <div style={{ maxWidth: 1100 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', margin: '0 0 4px' }}>Air Traffic Control</h1>
      <p style={{ fontSize: 13, color: '#64748B', margin: '0 0 20px' }}>
        Live operational view across all 3PL activity.
      </p>

      {/* Stat row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14, marginBottom: 20 }}>
        <Stat Icon={Send}         label="Parcels sent today" value={vol?.parcels_today ?? '—'}    color="#0056FB" />
        <Stat Icon={Boxes}        label="Items sent today"   value={vol?.items_today ?? '—'}      color="#7B2FBE" />
        <Stat Icon={Hand}         label="Picks today"        value={vol?.picks_today ?? '—'}      color="#00BCD4" />
        <Stat Icon={Truck}        label="Active parcels"     value={stats?.total_active ?? '—'}   color="#5C6BC0" />
        <Stat Icon={PackageCheck} label="Delivered today"    value={stats?.delivered_today ?? '—'} color="#00C853" />
        <Stat Icon={AlertTriangle} label="Exceptions"
          value={statusRows.filter(([s]) => STATUS_RAG[s] === 'red').reduce((a, [, c]) => a + c, 0)}
          color="#E91E8C" />
      </div>

      {/* Dispatch volume */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginBottom: 16 }}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>Dispatch volume · last 14 days</span>
            <span style={{ fontSize: 12, color: '#64748B' }}>{vol?.parcels_7d ?? 0} parcels · {vol?.items_7d ?? 0} items (7d)</span>
          </div>
          {(!daily || daily.length === 0) && <div style={{ fontSize: 13, color: '#94A3B8' }}>No volume yet — run the Helm volume sync.</div>}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120 }}>
            {(daily || []).map(d => (
              <div key={d.date} title={`${d.date}: ${d.parcels} parcels, ${d.items} items`}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div style={{ width: '100%', background: '#0056FB', borderRadius: '3px 3px 0 0',
                  height: `${Math.round((d.parcels / maxParcels) * 96)}px`, minHeight: 2 }} />
                <span style={{ fontSize: 9, color: '#94A3B8' }}>{d.date.slice(8, 10)}/{d.date.slice(5, 7)}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginBottom: 14 }}>By customer · today</div>
          {(!byCustomer || byCustomer.length === 0) && <div style={{ fontSize: 13, color: '#94A3B8' }}>No dispatches recorded today.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {(byCustomer || []).slice(0, 8).map(c => (
              <div key={c.id} onClick={() => navigate(`/customers/${c.id}`)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <span style={{ fontSize: 13, color: '#334155', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.business_name}</span>
                <span style={{ fontSize: 12, color: '#64748B' }}>{c.items} items</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#0056FB', minWidth: 54, textAlign: 'right' }}>{c.parcels} parcels</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16 }}>
        {/* Live status board */}
        <Card>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginBottom: 14 }}>Live status board</div>
          {statusRows.length === 0 && <div style={{ fontSize: 13, color: '#94A3B8' }}>No parcels yet — waiting on tracking webhooks.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {statusRows.map(([status, count]) => {
              const rag = RAG[STATUS_RAG[status] || 'grey'];
              return (
                <div key={status} onClick={() => navigate(`/tracking?status=${status}`)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: rag, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: '#334155', flex: 1 }}>{STATUS_LABEL[status] || status}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>{count}</span>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Notification feed */}
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>Recent activity</span>
            <span onClick={() => navigate('/notifications')} style={{ fontSize: 12, color: '#00BCD4', cursor: 'pointer' }}>View all</span>
          </div>
          {(!notifs?.notifications?.length) && <div style={{ fontSize: 13, color: '#94A3B8' }}>No notifications yet.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(notifs?.notifications || []).map(n => (
              <div key={n.id} onClick={() => n.link_url && navigate(n.link_url)}
                style={{ display: 'flex', gap: 10, cursor: n.link_url ? 'pointer' : 'default' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', marginTop: 5, flexShrink: 0, background: RAG[n.severity] || RAG.grey }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: '#0F172A', fontWeight: 500 }}>{n.title}</div>
                  {n.body && <div style={{ fontSize: 12, color: '#64748B' }}>{n.body}</div>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
