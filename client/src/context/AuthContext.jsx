import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '../services/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('sw_user') || 'null');
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const login = useCallback(async (email, password) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post('/auth/login', { email, password });
      // Staff with 2FA don't get a session here — just a challenge to verify.
      if (data.requires2fa) {
        return { requires2fa: true, mustEnroll: !!data.mustEnroll, challengeToken: data.challengeToken };
      }
      localStorage.setItem('sw_token', data.token);
      localStorage.setItem('sw_user', JSON.stringify(data.user));
      setUser(data.user);
      return data.user;
    } catch (err) {
      const msg = err.response?.data?.error || 'Login failed';
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const verify2fa = useCallback(async (challengeToken, token) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post('/auth/2fa/verify', { challengeToken, token });
      localStorage.setItem('sw_token', data.token);
      localStorage.setItem('sw_user', JSON.stringify(data.user));
      setUser(data.user);
      return data.user;
    } catch (err) {
      const msg = err.response?.data?.error || 'Verification failed';
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    // Best-effort server-side audit; local logout always completes.
    try {
      await api.post('/auth/logout');
    } catch {
      // Ignore — token is discarded locally regardless.
    }
    localStorage.removeItem('sw_token');
    localStorage.removeItem('sw_user');
    setUser(null);
  }, []);

  useEffect(() => {
    // Re-validate session on load if a token exists
    const token = localStorage.getItem('sw_token');
    if (token && !user) {
      api.get('/auth/me').then(({ data }) => {
        setUser(data.user);
        localStorage.setItem('sw_user', JSON.stringify(data.user));
      }).catch(() => logout());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(() => ({ user, loading, error, login, verify2fa, logout }), [user, loading, error, login, verify2fa, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
