import { useState, useEffect } from 'react';
import { Search, Bell, Settings, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const BORDER = 'rgba(255,255,255,0.08)';
const MUTED  = 'rgba(255,255,255,0.40)';
const TEXT   = '#FFFFFF';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

export default function TopBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const firstName = user?.full_name?.split(' ')[0] || 'Ross';
  const initials  = user?.full_name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'R';

  return (
    <header style={{
      background: '#1A1A1F',
      borderBottom: `0.5px solid ${BORDER}`,
      height: 56,
      display: 'flex',
      alignItems: 'center',
      padding: '0 24px',
      gap: 20,
      flexShrink: 0,
      zIndex: 50,
    }}>

      {/* Greeting */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: TEXT }}>
          Good {getGreeting()}, {firstName}
        </span>
        <span style={{ fontSize: 12, color: MUTED }}>
          {dateStr} · {timeStr}
        </span>
      </div>

      {/* Search */}
      <div style={{ position: 'relative', width: 240 }}>
        <Search size={13} style={{
          position: 'absolute', left: 10, top: '50%',
          transform: 'translateY(-50%)', color: MUTED, pointerEvents: 'none',
        }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search customers, accounts…"
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'rgba(255,255,255,0.08)', border: `0.5px solid rgba(255,255,255,0.12)`,
            borderRadius: 8, padding: '7px 10px 7px 30px',
            fontSize: 12, color: '#FFFFFF', outline: 'none',
          }}
        />
        <div style={{
          position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
          fontSize: 10, color: MUTED, background: 'rgba(0,0,0,0.06)',
          borderRadius: 4, padding: '1px 5px',
        }}>
          ⌘K
        </div>
      </div>

      {/* Utility icons */}
      <div style={{ display: 'flex', gap: 6 }}>
        {[
          { Icon: Bell, action: () => navigate('/notifications') },
          { Icon: Settings, action: () => navigate('/settings') },
        ].map(({ Icon, action }, i) => (
          <button key={i} onClick={action} style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'transparent', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: MUTED,
          }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.10)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <Icon size={16} strokeWidth={1.5} />
          </button>
        ))}
      </div>

      {/* User avatar */}
      <div title={user?.full_name || user?.email || ''} style={{
        width: 30, height: 30, borderRadius: '50%',
        background: 'rgba(255,255,255,0.12)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 500, color: TEXT,
        flexShrink: 0,
      }}>
        {initials}
      </div>

      {/* Sign out */}
      <button onClick={logout} title="Sign out" style={{
        width: 32, height: 32, borderRadius: 8, background: 'transparent', border: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: MUTED,
      }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.10)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
        <LogOut size={16} strokeWidth={1.5} />
      </button>
    </header>
  );
}
