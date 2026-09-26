import { StatusCodes } from 'http-status-codes';
import type { Request, Response } from 'express';

import { AUTH_COOKIES } from '../config/constants';
import type {
  AuthResult,
  AuthService,
  PublicUser,
  SessionSummary,
} from '../services/auth.service';
import { fingerprintOf } from '../middleware/auth';
import type { ChangePasswordInput, LoginInput, RegisterUserInput } from '../schemas/user.schema';
import { ApiError } from '../utils/ApiError';
import { clearCsrfCookie, generateCsrfToken, setCsrfCookie } from '../utils/csrf';
import { clearRefreshCookie, readCookie, setRefreshCookie } from '../utils/cookies';
import { sendSuccess } from '../utils/respond';
import { verifyRefreshToken } from '../utils/token';

/**
 * HTTP surface for authentication.
 *
 * The one rule that shapes this whole file: **a refresh token never appears in a
 * response body.** It is set as an httpOnly cookie and that is the only place it
 * goes. A body is readable by any script on the page, and the refresh token is
 * the durable credential - leaking it defeats the httpOnly cookie, the CSRF
 * token, and the rotation all at once. The access token is the opposite
 * trade-off, deliberately: it is short-lived, held in memory by the client, and
 * sent as a header.
 */

export interface AuthResponseData {
  user: PublicUser;
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  /** Double-submit CSRF value; also set as a readable cookie. */
  csrfToken: string;
}

export interface AuthController {
  register: (req: Request, res: Response) => Promise<void>;
  login: (req: Request, res: Response) => Promise<void>;
  refresh: (req: Request, res: Response) => Promise<void>;
  logout: (req: Request, res: Response) => Promise<void>;
  logoutAll: (req: Request, res: Response) => Promise<void>;
  me: (req: Request, res: Response) => Promise<void>;
  changePassword: (req: Request, res: Response) => Promise<void>;
  listSessions: (req: Request, res: Response) => Promise<void>;
  revokeSession: (req: Request, res: Response) => Promise<void>;
}

/** Reads the refresh token from the cookie the previous response set. */
function refreshTokenFrom(req: Request): string | null {
  return readCookie(req, AUTH_COOKIES.REFRESH);
}

/**
 * The session id the current request is on, taken from the refresh cookie.
 *
 * Read from the token rather than the database: this is only used to highlight
 * one row in a session list, and the cookie is already going to be verified for
 * real by whichever endpoint actually redeems it.
 */
function currentSessionId(req: Request): string | null {
  const token = refreshTokenFrom(req);
  if (!token) {
    return null;
  }
  try {
    return verifyRefreshToken(token).sid;
  } catch {
    return null;
  }
}

function auth(req: Request): NonNullable<Request['auth']> {
  if (!req.auth) {
    // Unreachable behind `authenticate`; kept so a future route that forgets the
    // middleware fails loudly instead of dereferencing undefined.
    throw ApiError.unauthorized('Authentication required.');
  }
  return req.auth;
}

export function createAuthController(service: AuthService): AuthController {
  /**
   * Writes the token pair to the response: refresh in the cookie, access in the
   * body, plus a fresh CSRF token for both.
   */
  function establishSession(res: Response, result: AuthResult): AuthResponseData {
    setRefreshCookie(res, result.tokens.refreshToken, result.refreshExpiresAt);

    const csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken);

    return {
      user: result.user,
      accessToken: result.tokens.accessToken,
      expiresIn: result.tokens.expiresIn,
      csrfToken,
    };
  }

  /** POST /api/v1/auth/register - creates an account and signs in. */
  async function register(req: Request, res: Response): Promise<void> {
    const result = await service.register(req.body as RegisterUserInput, fingerprintOf(req));

    sendSuccess(res, {
      message: 'Account created.',
      status: StatusCodes.CREATED,
      data: establishSession(res, result),
    });
  }

  /** POST /api/v1/auth/login - exchanges credentials for a token pair. */
  async function login(req: Request, res: Response): Promise<void> {
    const result = await service.login(req.body as LoginInput, fingerprintOf(req));

    sendSuccess(res, {
      message: 'Signed in.',
      data: establishSession(res, result),
    });
  }

  /**
   * POST /api/v1/auth/refresh - rotates the refresh token.
   *
   * Reachable with no access token, since the point is that it has expired. The
   * CSRF middleware still applies, because the refresh cookie is what
   * authenticates the call.
   */
  async function refresh(req: Request, res: Response): Promise<void> {
    const token = refreshTokenFrom(req);
    if (!token) {
      throw ApiError.unauthorized('No session cookie was sent.');
    }

    const result = await service.refresh(token, fingerprintOf(req));

    sendSuccess(res, {
      message: 'Session refreshed.',
      data: establishSession(res, result),
    });
  }

  /**
   * POST /api/v1/auth/logout - ends the session the refresh cookie belongs to.
   *
   * Idempotent by design: signing out twice, or with a cookie that has already
   * expired, succeeds. A logout that can fail is a logout that leaves a session
   * alive.
   */
  async function logout(req: Request, res: Response): Promise<void> {
    const sessionId = currentSessionId(req);
    if (sessionId) {
      await service.logout(sessionId, fingerprintOf(req));
    }

    clearRefreshCookie(res);
    clearCsrfCookie(res);

    sendSuccess(res, { message: 'Signed out.', data: { sessionId } });
  }

  /** POST /api/v1/auth/logout-all - ends every session for the caller. */
  async function logoutAll(req: Request, res: Response): Promise<void> {
    const { userId } = auth(req);
    const revoked = await service.logoutAll(userId, fingerprintOf(req));

    clearRefreshCookie(res);
    clearCsrfCookie(res);

    sendSuccess(res, { message: 'Signed out of all devices.', data: { revoked } });
  }

  /** GET /api/v1/auth/me - the caller's own record, read fresh. */
  async function me(req: Request, res: Response): Promise<void> {
    const { userId } = auth(req);
    const user = await service.findUser(userId);

    if (!user) {
      throw ApiError.notFound('User not found.');
    }

    sendSuccess(res, { message: 'Current user.', data: { user } });
  }

  /**
   * POST /api/v1/auth/change-password - rotates the hash and ends every session.
   *
   * The service revokes everything, including this session, and issues one new
   * pair for the caller, so the response body is a fresh session rather than a
   * dead cookie. Without that the user would be signed out by their own password
   * change and have to sign in again immediately.
   */
  async function changePassword(req: Request, res: Response): Promise<void> {
    const { userId } = auth(req);
    const { currentPassword, newPassword } = req.body as ChangePasswordInput;

    const result = await service.changePassword(
      userId,
      currentPassword,
      newPassword,
      fingerprintOf(req),
    );

    sendSuccess(res, {
      message: 'Password changed. Other devices have been signed out.',
      data: establishSession(res, result),
    });
  }

  /** GET /api/v1/auth/sessions - active sessions, for the security screen. */
  async function listSessions(req: Request, res: Response): Promise<void> {
    const { userId } = auth(req);
    const sessions: SessionSummary[] = await service.listSessions(
      userId,
      currentSessionId(req),
    );

    sendSuccess(res, { message: 'Active sessions.', data: { sessions } });
  }

  /** DELETE /api/v1/auth/sessions/:id - signs one device out. */
  async function revokeSession(req: Request, res: Response): Promise<void> {
    const { userId } = auth(req);
    const sessionId = req.params.sessionId;

    if (!sessionId) {
      throw ApiError.badRequest('A session id is required.');
    }

    await service.revokeSession(userId, sessionId, fingerprintOf(req));

    // Revoking the session this request arrived on should not leave the browser
    // holding a cookie that can no longer be redeemed.
    if (sessionId === currentSessionId(req)) {
      clearRefreshCookie(res);
      clearCsrfCookie(res);
    }

    sendSuccess(res, { message: 'Session revoked.', data: { sessionId } });
  }

  return {
    register,
    login,
    refresh,
    logout,
    logoutAll,
    me,
    changePassword,
    listSessions,
    revokeSession,
  };
}
