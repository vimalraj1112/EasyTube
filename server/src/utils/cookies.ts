import type { CookieOptions, Request, Response } from 'express';

import { AUTH_COOKIES } from '../config/constants';
import { env } from '../config/env';

/**
 * The refresh token cookie.
 *
 * This is the only place that knows how the token travels, and it is
 * deliberately hard to get wrong:
 *
 * - `httpOnly` is non-negotiable. The access token is intentionally readable by
 *   the client so it can be held in memory, but the refresh token is the durable
 *   credential, and a single `document.cookie` read during an XSS would
 *   otherwise hand over a month of access.
 * - `sameSite` blocks the cookie on cross-site requests by default. Combined
 *   with the JSON content type and the CORS allowlist, that is what stops a
 *   hostile page from driving an authenticated POST.
 * - `path` is `/` rather than scoped to the auth routes, because the CSRF cookie
 *   has to be readable by the client and a same-origin client served from `/`
 *   cannot see a cookie scoped to `/api/v1/auth`. The two cookies must therefore
 *   share their scope, which is why `authCookieOptions` is shared rather than
 *   written twice - a path changed on one alone would silently break CSRF.
 */

/**
 * Cookie attributes common to both auth cookies.
 *
 * They agree on `path`, `domain` and `secure` for two reasons: the CSRF check
 * reads the CSRF cookie from the same request that carries the refresh cookie,
 * and `clearCookie` only deletes a cookie whose name, path and domain all match
 * the original. Diverging them is the kind of bug that shows up as "logged out
 * but the browser still sends the old token", so the shared options live in one
 * place and callers only state what actually differs.
 */
export function authCookieOptions(overrides: CookieOptions = {}): CookieOptions {
  return {
    secure: env.cookieSecure,
    sameSite: env.COOKIE_SAME_SITE,
    path: '/',
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
    ...overrides,
  };
}

/**
 * Reads a cookie off the request.
 *
 * `req.cookies` is typed `any` by Express, so every read is narrowed here once
 * rather than being re-asserted at each call site. Returns null for a missing or
 * non-string value, so callers never have to distinguish those cases.
 */
export function readCookie(req: Request, name: string): string | null {
  const jar = req.cookies as Record<string, unknown> | undefined;
  const value = jar?.[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Sets the refresh cookie, expiring it with the token it carries. */
export function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(
    AUTH_COOKIES.REFRESH,
    token,
    authCookieOptions({
      httpOnly: true,
      // `expires` in milliseconds would be `maxAge`; an absolute date survives a
      // client clock that disagrees with the server's, which a duration does not.
      expires: expiresAt,
    }),
  );
}

/**
 * Clears the refresh cookie.
 *
 * The attributes must match those used when setting it, or the browser keeps the
 * original: a cookie is identified by name plus path plus domain, not by the
 * rest of its configuration.
 */
export function clearRefreshCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIES.REFRESH, authCookieOptions({ httpOnly: true }));
}
