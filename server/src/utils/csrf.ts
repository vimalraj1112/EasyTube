import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';

import { AUTH_COOKIES } from '../config/constants';
import { authCookieOptions, readCookie } from './cookies';

/**
 * Double-submit CSRF protection for the cookie-authenticated endpoints.
 *
 * The refresh token is the one credential that travels automatically, so it is
 * the only thing a cross-site request could ride on. This is a second,
 * attacker-unreadable value that a forged request cannot produce:
 *
 * 1. The server sets `easytube_csrf` as a *readable* cookie and returns the same
 *    value in the JSON body. Script can read it; a hostile origin cannot, because
 *    the browser will not expose this domain's cookies to it.
 * 2. The client echoes it in the `X-CSRF-Token` header.
 * 3. The two are compared, so a request that merely carries the cookie -
 *    because the browser attached it automatically - is rejected.
 *
 * The value is rotated whenever the refresh token is, which stops a token
 * captured before a sign-in from being reused afterwards.
 *
 * Requests authenticated purely by a bearer token are exempt: a header cannot be
 * set by a cross-site form or image, so there is nothing to forge.
 */

const CSRF_HEADER = 'x-csrf-token';
const CSRF_BYTES = 32;

export function generateCsrfToken(): string {
  return randomBytes(CSRF_BYTES).toString('hex');
}

/**
 * The CSRF cookie is intentionally *not* httpOnly - the client has to read it to
 * put the value in the header. That is safe because the cookie holds no
 * authority on its own; it is only ever compared against the header.
 */
export function csrfCookieOptions(): CookieOptions {
  return authCookieOptions({ httpOnly: false });
}

export function setCsrfCookie(res: Response, token: string): void {
  // A session cookie: it should not outlive the browser session, and a stale one
  // is useless anyway because the refresh token next to it will be gone.
  res.cookie(AUTH_COOKIES.CSRF, token, csrfCookieOptions());
}

export function clearCsrfCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIES.CSRF, csrfCookieOptions());
}

/** Constant-time comparison; length mismatch fails rather than throwing. */
function matches(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');

  if (left.length !== right.length || left.length === 0) {
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * Whether this request must carry a CSRF token: it does when a refresh cookie is
 * present, since that is what makes the browser authenticate it on its own.
 */
export function requiresCsrfToken(req: Request): boolean {
  return readCookie(req, AUTH_COOKIES.REFRESH) !== null;
}

export function verifyCsrfToken(req: Request): boolean {
  const header = req.get(CSRF_HEADER);
  const cookie = readCookie(req, AUTH_COOKIES.CSRF);

  if (!header || !cookie) {
    return false;
  }
  return matches(header, cookie);
}

export { CSRF_HEADER };
