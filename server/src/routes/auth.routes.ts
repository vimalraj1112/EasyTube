import { Router } from 'express';
import { z } from 'zod';

import { createAuthController } from '../controllers/auth.controller';
import { createAuthenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  changePasswordSchema,
  loginSchema,
  registerUserSchema,
} from '../schemas/user.schema';
import type { AuthService, UserPort } from '../services/auth.service';
import { asyncHandler } from '../utils/asyncHandler';

/**
 * `/auth` surface.
 *
 * Middleware order per route is deliberate and load-bearing: `validate` first so
 * a malformed body is rejected before any hashing happens, then `authenticate`
 * so a handler can rely on `req.auth` existing.
 */
const sessionIdParamsSchema = z.object({
  sessionId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be a valid session id'),
});

export function createAuthRoutes(deps: { service: AuthService; users: UserPort }): Router {
  const router = Router();
  const controller = createAuthController(deps.service);
  const authenticate = createAuthenticate(deps.users);

  // --- Public -------------------------------------------------------------
  // No access token required: these are how one is obtained in the first place.

  /** POST /auth/register - create an account, signed in on success. */
  router.post(
    '/auth/register',
    validate({ body: registerUserSchema }),
    asyncHandler(controller.register),
  );

  /** POST /auth/login - exchange credentials for a token pair. */
  router.post('/auth/login', validate({ body: loginSchema }), asyncHandler(controller.login));

  /**
   * POST /auth/refresh - rotate the refresh cookie. Authenticated by that cookie
   * rather than by an access token, which is the whole point: the access token
   * has usually expired by the time this is needed.
   */
  router.post('/auth/refresh', asyncHandler(controller.refresh));

  /**
   * POST /auth/logout - ends the current session.
   *
   * Deliberately unauthenticated and idempotent. Requiring a valid access token
   * would mean a user whose token expired could never sign out, and would turn
   * "end my session" into a failure mode.
   */
  router.post('/auth/logout', asyncHandler(controller.logout));

  // --- Authenticated ------------------------------------------------------

  /** GET /auth/me - the caller's own record. */
  router.get('/auth/me', authenticate, asyncHandler(controller.me));

  /** POST /auth/logout-all - end every session for this account. */
  router.post('/auth/logout-all', authenticate, asyncHandler(controller.logoutAll));

  /** POST /auth/change-password - rotate the hash, end all sessions. */
  router.post(
    '/auth/change-password',
    authenticate,
    validate({ body: changePasswordSchema }),
    asyncHandler(controller.changePassword),
  );

  /** GET /auth/sessions - active sessions for the security screen. */
  router.get('/auth/sessions', authenticate, asyncHandler(controller.listSessions));

  /** DELETE /auth/sessions/:sessionId - sign one device out. */
  router.delete(
    '/auth/sessions/:sessionId',
    authenticate,
    validate({ params: sessionIdParamsSchema }),
    asyncHandler(controller.revokeSession),
  );

  return router;
}
