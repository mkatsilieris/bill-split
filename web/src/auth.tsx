import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getToken, setToken } from './api';
import type { User } from './types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthState | null>(null);

// Set when the session was opened through Cloudflare Access, so that logging out also ends the
// Access session (otherwise the next page load would silently sign the person in again).
const VIA_ACCESS_KEY = 'billsplit.viaAccess';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function boot() {
      if (getToken()) {
        try {
          const r = await api<{ user: User }>('/auth/me');
          setUser(r.user);
          return;
        } catch {
          setToken(null);
        }
      }
      // No usable token: behind Cloudflare Access the API can sign us in from the Access assertion.
      // Anywhere else this fails quietly and the normal login form is shown.
      try {
        const r = await api<{ token: string; user: User }>('/auth/access', { method: 'POST' });
        setToken(r.token);
        try {
          localStorage.setItem(VIA_ACCESS_KEY, '1');
        } catch {
          /* storage unavailable */
        }
        setUser(r.user);
      } catch {
        /* not behind Access, or not allowed: show the login form */
      }
    }
    boot().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onLogout = () => setUser(null);
    window.addEventListener('billsplit:logout', onLogout);
    return () => window.removeEventListener('billsplit:logout', onLogout);
  }, []);

  const login = useCallback((token: string, u: User) => {
    setToken(token);
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    let viaAccess = false;
    try {
      viaAccess = localStorage.getItem(VIA_ACCESS_KEY) === '1';
      localStorage.removeItem(VIA_ACCESS_KEY);
    } catch {
      /* storage unavailable */
    }
    if (viaAccess) window.location.assign('/cdn-cgi/access/logout');
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout, setUser }), [user, loading, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
