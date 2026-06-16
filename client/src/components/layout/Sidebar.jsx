import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Users, Truck, PackagePlus, RotateCcw, Bell, MessageSquare, Settings, ScanBarcode, Clock,
} from 'lucide-react';

const NAV = [
  { to: '/',                label: 'Dashboard',        Icon: LayoutDashboard, end: true },
  { to: '/customers',       label: 'Customers',        Icon: Users },
  { to: '/tracking',        label: 'Tracking',         Icon: Truck },
  { to: '/purchase-orders', label: 'Purchase Orders',  Icon: PackagePlus },
  { to: '/picking',         label: 'Picking',          Icon: ScanBarcode },
  { to: '/on-time',         label: 'On-Time Dispatch', Icon: Clock },
  { to: '/returns',         label: 'Returns',          Icon: RotateCcw },
  { to: '/notifications',   label: 'Notifications',    Icon: Bell },
  { to: '/queries',         label: 'Queries',          Icon: MessageSquare },
  { to: '/settings',        label: 'Settings',         Icon: Settings },
];

export default function Sidebar() {
  return (
    <aside style={{
      width: 220, flexShrink: 0, background: '#1A1A1F', color: '#fff',
      display: 'flex', flexDirection: 'column', height: '100vh',
    }}>
      {/* Brand */}
      <div style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8,
          background: 'linear-gradient(135deg,#00BCD4,#7B2FBE)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 800, fontSize: 14,
        }}>C9</div>
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 0.2 }}>Cloud9 OS</div>
      </div>

      <nav style={{ flex: 1, padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end}
            style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: 11,
              padding: '9px 12px', borderRadius: 8,
              fontSize: 13, fontWeight: 500, textDecoration: 'none',
              color: isActive ? '#fff' : 'rgba(255,255,255,0.55)',
              background: isActive ? 'rgba(255,255,255,0.10)' : 'transparent',
            })}
          >
            <Icon size={17} strokeWidth={1.7} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div style={{ padding: '14px 20px', fontSize: 11, color: 'rgba(255,255,255,0.30)' }}>
        Cloud9 OS · v0.1
      </div>
    </aside>
  );
}
