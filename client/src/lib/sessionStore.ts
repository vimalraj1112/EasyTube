import type { AuthSessionPayload } from '@/types/api';

/**
 * In-memory holder for the access token and the CSRF token.
 *
 * The access token is deliberately never written to `localStorage` or
 * `sessionStorage`: anything in web storage is readable by any script on the
 * page, which is exactly the exposure `httpOnly` cookies exist to prevent. The
 * cost of that choice is that a reload starts out anonymous and has to
 * re-establish the session through the httpOnly refresh cookie - which is what
 * `AuthProvider`'s bootstrap does.
 */
let accessToken: string | null = null;
let csrfToken: string | null = null;
let expiresAt: number | null = null;

const listeners = new Set<() => void>();

/**
 * Reads the CSRF cookie the server mirrors for the double-submit check.
 *
 * Only reachable when the client and the API share an origin (the Vite dev
 * proxy, or a host that rewrites `/api`). On a split-host deployment the cookie
 * belongs to the API's domain, so script on the client domain cannot read it and
 * the in-memory copy from the last auth response is used instead.
 */
export function readCsrfCookie(name = 'easytube_csrf'): string | null {
  if (typeof document === 'undefined') return null;

  for (const part of document.cookie.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName === name) return decodeURIComponent(rawValue.join('='));
  }

  return null;
}

export const sessionStore = {
  getAccessToken: (): string | null => accessToken,

  getCsrfToken: (): string | null => csrfToken ?? readCsrfCookie(),

  /** True once the access token is known to be past its expiry. */
  isExpired: (): boolean => expiresAt !== null && Date.now() >= expiresAt,

  set(payload: AuthSessionPayload): void {
    accessToken = payload.accessToken;
    csrfToken = payload.csrfToken;
    expiresAt = Date.now() + payload.expiresIn * 1000;
  },

  /**
   * Drops the tokens and tells subscribers the session is over.
   *
   * Notifying here rather than at each call site means a forced sign-out (a
   * refresh that failed mid-session) and an explicit one both end up in the same
   * place, so the UI cannot drift out of sync with the tokens it holds.
   */
  clear(): void {
    accessToken = null;
    csrfToken = null;
    expiresAt = null;
    for (const listener of listeners) listener();
  },
};

/** Subscribes to session termination. Returns an unsubscribe function. */
export function subscribeToSessionEnd(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
