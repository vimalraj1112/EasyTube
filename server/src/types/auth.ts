import type { UserRole } from '../config/constants';

/**
 * The authenticated caller, attached to the request by `authenticate`.
 *
 * Deliberately small. Everything here is re-read from the database on every
 * request rather than trusted from the token, so a suspension or a role change
 * takes effect immediately instead of waiting for a token to expire.
 */
export interface RequestAuth {
  userId: string;
  email: string;
  role: UserRole;
  /**
   * The refresh session this request arrived on, when the caller presented the
   * refresh cookie. Access tokens do not carry it, so a pure API call has null
   * here; the session endpoints fall back to the cookie.
   */
  sessionId: string | null;
}

/** Request-scoped facts the auth service records in the audit trail. */
export interface RequestFingerprint {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}
