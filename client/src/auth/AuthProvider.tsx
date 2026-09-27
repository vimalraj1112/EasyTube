import { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import { AuthContext, type AuthContextValue, type AuthStatus } from './authContext';
import { authApi } from '@/lib/api';
import { sessionStore, subscribeToSessionEnd } from '@/lib/sessionStore';
import type { AuthSessionPayload, AuthUser, LoginInput, RegisterInput } from '@/types/api';

/**
 * Owns "is anyone signed in" for the whole app.
 *
 * The access token lives in `sessionStore` (memory only), so a page load starts
 * with nothing and has to ask the server whether the httpOnly refresh cookie
 * still stands. That bootstrap is why `status` starts as `loading`.
 */
export function AuthProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  const applySession = useCallback((payload: AuthSessionPayload): AuthUser => {
    sessionStore.set(payload);
    setUser(payload.user);
    setStatus('authenticated');
    return payload.user;
  }, []);

  const endSession = useCallback((): void => {
    // `sessionStore.clear()` notifies subscribers, which covers the forced
    // sign-out path; clearing state here as well keeps the explicit path
    // correct even if the notification is ever changed.
    sessionStore.clear();
    setUser(null);
    setStatus('anonymous');
  }, []);

  useEffect(() => {
    let active = true;

    void (async (): Promise<void> => {
      try {
        const payload = await authApi.refresh();
        if (!active) return;
        applySession(payload);
      } catch {
        // No cookie, an expired one, or the API is down. All three mean the same
        // thing to the UI: nobody is signed in yet.
        if (!active) return;
        setUser(null);
        setStatus('anonymous');
      }
    })();

    return () => {
      active = false;
    };
  }, [applySession]);

  // A refresh that fails mid-session clears the store, which is the only signal
  // the UI gets that it has been signed out from under it.
  useEffect(() => subscribeToSessionEnd(() => setStatus('anonymous')), []);

  const login = useCallback(
    async (input: LoginInput): Promise<AuthUser> => applySession(await authApi.login(input)),
    [applySession],
  );

  const register = useCallback(
    async (input: RegisterInput): Promise<AuthUser> => applySession(await authApi.register(input)),
    [applySession],
  );

  // Both sign-out paths are best effort and never reject. The caller's intent is
  // "get me out of this app", which is satisfied locally even when the request
  // fails. A failed request does mean the refresh cookie survives, so a reload
  // will restore the session - the honest outcome, since the server never
  // confirmed the revoke and we cannot clear an httpOnly cookie from script.
  const logout = useCallback(async (): Promise<void> => {
    try {
      await authApi.logout();
    } catch {
      // Intentionally swallowed; see above.
    } finally {
      endSession();
    }
  }, [endSession]);

  const logoutAll = useCallback(async (): Promise<void> => {
    try {
      await authApi.logoutAll();
    } catch {
      // Intentionally swallowed; see above.
    } finally {
      endSession();
    }
  }, [endSession]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, register, logout, logoutAll }),
    [status, user, login, register, logout, logoutAll],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
