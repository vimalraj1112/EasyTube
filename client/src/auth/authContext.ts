import { createContext, useContext } from 'react';

import type { AuthUser, LoginInput, RegisterInput } from '@/types/api';

/**
 * `loading` covers the one-time bootstrap, when the app is asking the refresh
 * cookie whether there is a session. Routing waits for it so a signed-in reload
 * never flashes the sign-in screen.
 */
export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  login: (input: LoginInput) => Promise<AuthUser>;
  register: (input: RegisterInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside <AuthProvider>.');
  }
  return value;
}
