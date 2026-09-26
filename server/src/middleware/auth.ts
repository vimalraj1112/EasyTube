import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { USER_ROLES, USER_STATUSES, type UserRole } from '../config/constants';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { extractBearerToken, verifyAccessToken } from '../utils/token';
import type { UserPort } from '../services/auth.service';
import type { RequestFingerprint } from '../types/auth';

/**
 * Access-token authentication.
 *
 * The token is verified *and* the user is re-read from the database on every
 * request. A fully stateless check would be one lookup cheaper, but it would
 * mean a suspended user, a deleted account, or a revoked admin role kept working
 * for as long as the token lived. With a fifteen-minute access token that is a
 * fifteen-minute window of authority that has already been taken away, which is
 * exactly the window an incident responder is watching.
 *
 * The session id is not taken from the access token because access tokens
 * deliberately do not carry one; endpoints that need "which device is this?"
 * read it from the refresh cookie instead.
 */

/** Facts the audit trail records about a request. */
export function fingerprintOf(req: Request): RequestFingerprint {
  return {
    ip: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
    requestId: req.requestId ?? null,
  };
}

function bearerFrom(req: Request): string | null {
  return extractBearerToken(req.get('authorization'));
}

/**
 * Shared body of the required and optional variants.
 *
 * Returns null when there is no usable token, having already produced the
 * specific error in the required case.
 */
async function resolveAuth(
  req: Request,
  users: UserPort,
): Promise<{ userId: string; email: string; role: UserRole; sessionId: null } | ApiError> {
  const token = bearerFrom(req);
  if (!token) {
    return ApiError.unauthorized('An access token is required.');
  }

  let claims: { sub: string; email: string; role: string };
  try {
    claims = verifyAccessToken(token);
  } catch {
    // Expired, forged, or a refresh token presented as an access token. All
    // three are the same answer, so none of them is a probe.
    return ApiError.unauthorized('Invalid or expired access token.');
  }

  const user = await users.findById(claims.sub);
  if (!user) {
    return ApiError.unauthorized('Invalid or expired access token.');
  }

  if (user.status !== USER_STATUSES.ACTIVE) {
    return ApiError.forbidden('This account is not active.');
  }

  return { userId: user._id.toString(), email: user.email, role: user.role, sessionId: null };
}

/** Rejects the request unless it carries a valid access token. */
export function createAuthenticate(users: UserPort): RequestHandler {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const result = await resolveAuth(req, users);

    if (result instanceof ApiError) {
      next(result);
      return;
    }

    req.auth = result;
    next();
  });
}

/**
 * Attaches `req.auth` when a valid token is present and otherwise carries on.
 *
 * Used on endpoints that change their response for a signed-in caller, where an
 * anonymous request is legitimate rather than an error.
 */
export function createOptionalAuthenticate(users: UserPort): RequestHandler {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    if (!bearerFrom(req)) {
      next();
      return;
    }

    const result = await resolveAuth(req, users);
    if (!(result instanceof ApiError)) {
      req.auth = result;
    }
    next();
  });
}

/**
 * Restricts a route to the given roles. Must run after `authenticate`; on its
 * own it does nothing, because there is no `req.auth` to inspect yet.
 */
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      next(ApiError.unauthorized('Authentication required.'));
      return;
    }

    if (!roles.includes(req.auth.role)) {
      next(ApiError.forbidden('This action requires elevated privileges.'));
      return;
    }

    next();
  };
}

export const requireAdmin = requireRole(USER_ROLES.ADMIN);
