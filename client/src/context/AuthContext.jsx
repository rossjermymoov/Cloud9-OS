import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);
const TOKEN_KEY = 'cloud9_auth_token';
const API = '/api';

export function AuthProvider({ children }) {
  const [user, setUser]           = useState(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [loading, setLoading]     = useState(true);

  const refresh = useCallback(async () => {
    try {
      const s = await fetch(`${API}/auth/setup-status`).then(r => r.json()).catch(() => ({ needs_setup: false }));
      if (s.needs_setup) { setNeedsSetup(true); setUser(null); setLoading(false); return; }
      setNeedsSetup(false);
      const token = localStorage.getItem(TOKEN_KEY);
      if (token) {
        const meRes = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
        if (meRes.ok) setUser(await meRes.json());
        else { localStorage.removeItem(TOKEN_KEY); setUser(null); }
      } else setUser(null);
    } catch {
      /* network error — treat as logged out */
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = useCallback(async (email, password) => {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    localStorage.setItem(TOKEN_KEY, data.token);
    setUser(data.user); setNeedsSetup(false);
    return data.user;
  }, []);

  const setupAdmin = useCallback(async (full_name, email, password) => {
    const res = await fetch(`${API}/auth/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name, email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Setup failed');
    localStorage.setItem(TOKEN_KEY, data.token);
    setUser(data.user); setNeedsSetup(false);
    return data.user;
  }, []);

  const logout = useCallback(() => { localStorage.removeItem(TOKEN_KEY); setUser(null); }, []);
  const canAccess = useCallback(() => true, []);  // everyone has full access for now

  return (
    <AuthContext.Provider value={{ user, needsSetup, loading, login, setupAdmin, logout, canAccess }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export function getAuthToken() { return localStorage.getItem(TOKEN_KEY); }
