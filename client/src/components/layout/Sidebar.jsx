import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Users, Truck, PackagePlus, RotateCcw, Bell, MessageSquare, Settings,
  ScanBarcode, Clock, UserCog, Warehouse, LayoutGrid, LineChart, ClipboardCheck, CalendarClock,
  Sun, Sparkles
} from 'lucide-react';

const SECTIONS = [
  {
    title: 'EXECUTIVE & OPS',
    items: [
      { to: '/standup',         label: 'Morning Briefing',  Icon: Sun, badge: 'Daily' },
      { to: '/',                label: 'Command Centre',    Icon: LayoutDashboard, end: true },
      { to: '/status-board',    label: 'Status Board',      Icon: LayoutGrid },
      { to: '/statistics',      label: 'Statistics',        Icon: LineChart },
      { to: '/on-time',         label: 'On-Time SLA',       Icon: Clock },
    ]
  },
  {
    title: 'WAREHOUSE & FLOOR',
    items: [
      { to: '/picking',             label: 'Picking & Labor',     Icon: ScanBarcode },
      { to: '/storage',             label: 'Storage Footprint',   Icon: Warehouse },
      { to: '/purchase-orders',     label: 'Purchase Orders',     Icon: PackagePlus },
      { to: '/inventory-validator', label: 'Inventory Validator', Icon: ClipboardCheck },
    ]
  },
  {
    title: 'LOGISTICS & CLIENTS',
    items: [
      { to: '/tracking',        label: 'Tracking & Exceptions', Icon: Truck },
      { to: '/collections',     label: 'Collections',          Icon: CalendarClock },
      { to: '/customers',       label: 'Customers',            Icon: Users },
      { to: '/queries',         label: 'Queries & Claims',     Icon: MessageSquare },
      { to: '/returns',         label: 'Returns',              Icon: RotateCcw },
    ]
  },
  {
    title: 'ADMIN & SYSTEM',
    items: [
      { to: '/notifications',   label: 'Notifications',       Icon: Bell },
      { to: '/users',           label: 'Users & Roles',       Icon: UserCog },
      { to: '/settings',        label: 'Settings',            Icon: Settings },
    ]
  }
];

export default function Sidebar() {
  return (
    <aside style={{
      width: 232, flexShrink: 0, background: '#0E131F', color: '#fff',
      display: 'flex', flexDirection: 'column', height: '100vh',
      borderRight: '1px solid rgba(255,255,255,0.06)',
    }}>
      {/* Brand */}
      <div style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 11, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{
          width: 32, height: 32, borderRadius: 9,
          background: 'linear-gradient(135deg, #0056FB 0%, #7B2FBE 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 800, fontSize: 14, color: '#fff', boxShadow: '0 2px 8px rgba(0,86,251,0.3)'
        }}>C9</div>
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 800, letterSpacing: -0.2 }}>Cloud9 OS</div>
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', fontWeight: 500 }}>3PL Operations Suite</div>
        </div>
      </div>

      {/* Nav List grouped by category */}
      <nav style={{ flex: 1, padding: '12px 10px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {SECTIONS.map((sec, sIdx) => (
          <div key={sIdx}>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: 0.8,
              color: 'rgba(255,255,255,0.35)', padding: '0 10px 6px',
              textTransform: 'uppercase'
            }}>
              {sec.title}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {sec.items.map(({ to, label, Icon, end, badge }) => (
                <NavLink key={to} to={to} end={end}
                  style={({ isActive }) => ({
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '7px 11px', borderRadius: 8,
                    fontSize: 12.5, fontWeight: isActive ? 700 : 500, textDecoration: 'none',
                    color: isActive ? '#fff' : 'rgba(255,255,255,0.65)',
                    background: isActive ? 'rgba(0,86,251,0.22)' : 'transparent',
                    border: isActive ? '1px solid rgba(0,86,251,0.4)' : '1px solid transparent',
                    transition: 'all 0.12s ease'
                  })}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Icon size={16} strokeWidth={1.8} style={{ opacity: 0.9 }} />
                    <span>{label}</span>
                  </div>
                  {badge && (
                    <span style={{
                      fontSize: 9.5, fontWeight: 800, background: 'rgba(245,158,11,0.2)',
                      color: '#FCD34D', border: '1px solid rgba(245,158,11,0.3)',
                      padding: '1px 5px', borderRadius: 5
                    }}>
                      {badge}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div style={{ padding: '12px 20px', fontSize: 11, color: 'rgba(255,255,255,0.35)', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Cloud9 OS · v1.0</span>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10B981' }} title="System operational" />
      </div>
    </aside>
  );
}
