import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [access, setAccess] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  async function loadAccess() {
    if (!getToken()) {
      setAccess(null);
      return null;
    }
    const data = await api('/access/summary');
    setAccess(data.access);
    return data.access;
  }

  useEffect(() => {
    const onInvalidSession = (event) => {
      setToken(null);
      setUser(null);
      setAccess(null);

      const suspended = event?.detail?.code === 'ACCOUNT_SUSPENDED';
      const pathname = window.location.pathname;
      const isProtectedPage = pathname === '/app' || pathname.startsWith('/app/');

      // Invalid/expired tokens found while visiting public pages are cleared
      // silently. Redirect to login only when the user is actually inside the
      // protected application area.
      if (isProtectedPage) {
        window.location.assign(suspended ? '/login?status=suspended' : '/login');
      }
    };
    window.addEventListener('calamelle:session-invalid', onInvalidSession);
    return () => window.removeEventListener('calamelle:session-invalid', onInvalidSession);
  }, []);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    Promise.all([api('/auth/me'), api('/access/summary')])
      .then(([me, rights]) => {
        setUser(me.user);
        setAccess(rights.access);
      })
      .catch(() => {
        setToken(null);
        setUser(null);
        setAccess(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo(() => ({
    user,
    access,
    loading,
    async login(email, password) {
      const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      setToken(data.token);
      setUser(data.user);
      try { await loadAccess(); } catch { setAccess(null); }
      return data.user;
    },
    async startRegistration(firstName, lastName, email, password) {
      return api('/auth/register/start', { method: 'POST', body: JSON.stringify({ firstName, lastName, email, password }) });
    },
    async verifyRegistration(email, otp) {
      const data = await api('/auth/register/verify', { method: 'POST', body: JSON.stringify({ email, otp }) });
      setToken(data.token);
      setUser(data.user);
      try { await loadAccess(); } catch { setAccess(null); }
      return data.user;
    },
    async resendRegistration(email) {
      return api('/auth/register/resend', { method: 'POST', body: JSON.stringify({ email }) });
    },
    async requestPasswordReset(email) {
      return api('/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email }) });
    },
    async resetPassword(token, password) {
      return api('/auth/password/reset', { method: 'POST', body: JSON.stringify({ token, password }) });
    },
    async logout() {
      const token = getToken();
      try {
        if (token) {
          await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` }
          });
        }
      } catch {
        // Local logout must still succeed if the network is temporarily unavailable.
      } finally {
        setToken(null);
        setUser(null);
        setAccess(null);
        window.location.assign('/');
      }
    },
    async refreshAccess() {
      return loadAccess();
    },
    async refresh() {
      const [me, rights] = await Promise.all([api('/auth/me'), api('/access/summary')]);
      setUser(me.user);
      setAccess(rights.access);
      return me.user;
    }
  }), [user, access, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
