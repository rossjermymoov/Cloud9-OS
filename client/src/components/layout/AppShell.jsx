import { useRef, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

export default function AppShell() {
  const scrollRef = useRef(null);
  const location  = useLocation();

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [location.pathname]);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#F1F5F9' }}>
      <Sidebar />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <TopBar />
        <main style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {/* Master content wrapper — the single owner of the page gutter. Holds a
              consistent fluid side padding (px-8) and NO max-width, so every page
              fills 100% of the available canvas next to the sidebar. */}
          <div ref={scrollRef} style={{ position: 'absolute', inset: 0, overflowY: 'auto', width: '100%', maxWidth: 'none', padding: '24px 32px' }}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
