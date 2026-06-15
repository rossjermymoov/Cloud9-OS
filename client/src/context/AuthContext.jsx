import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

const TOKEN_KEY = 'moov_auth_token';
const API = '/api';

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);   // null = not loaded yet
  const [loading, setLoading] = useState(true);   // true while checking token/bypass
  const [bypass, setBypass]   = useState(false);  // true when no passwords set yet

  // Check bypass and restore session on mount
  useEffect(() => {
    async function init() {
      try {
        // First check if we're in bypass mode (no passwords set)
        const bypassRes = await fetch(`${API}/auth/bypass-check`);
        if (bypassRes.ok) {
          const data = await bypassRes.json();
          if (data.bypass) {
            setBypass(true);
            setLoading(false);
            return;
          }
        }

        // Not bypass — try to restore from stored token
        const token = localStorage.getItem(TOKEN_KEY);
        if (token) {
          const meRes = await fetch(`${API}/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (meRes.ok) {
            const me = await meRes.json();
            setUser(me);
          } else {
            localStorage.removeItem(TOKEN_KEY);
          }
        }
      } catch {
        // Network error — proceed as unauthenticated
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    localStorage.setItem(TOKEN_KEY, data.token);
    setUser(data.user);
    setBypass(false);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
    // Re-check bypass so admin can still access settings if they remove their own password
    fetch(`${API}/auth/bypass-check`)
      .then(r => r.json())
      .then(d => setBypass(d.bypass))
      .catch(() => {});
  }, []);

  // Helper — does the current user have access to a given page key?
  const canAccess = useCallback((pageKey) => {
    if (bypass) return true;
    if (!user)  return false;
    if (user.is_admin) return true;
    return (user.page_permissions || []).includes(pageKey);
  }, [user, bypass]);

  return (
    <AuthContext.Provider value={{ user, loading, bypass, login, logout, canAccess }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Get the stored JWT token for use in API calls */
export function getAuthToken() {
  return localStorage.getItem(TOKEN_KEY);
}
