import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { ApiError } from '../utils/ApiError';
import { requiresCsrfToken, verifyCsrfToken } from '../utils/csrf';
/**
 * Enforces the double-submit CSRF token on cookie-authenticated requests.
 *
 * Mounted globally rather than per route, because the rule is not about which
 * endpoint it is - it is about whether the browser attached the refresh cookie by
 * itself. A new route that mutates state and forgets this middleware is the kind
 * of omission that turns into a vulnerability a year later, so the default is
 * "checked", and the exemption is the deliberate exception.
 */
export function csrfProtection(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }

    // No refresh cookie means nothing authenticates this request automatically,
    // and a header-only credential cannot be forged cross-site.
    if (!requiresCsrfToken(req)) {
      next();
      return;
    }

    if (!verifyCsrfToken(req)) {
      next(
        new ApiError(
          403,
          'CSRF token missing or invalid. Send the X-CSRF-Token header with the value of the easytube_csrf cookie.',
          'FORBIDDEN',
        ),
      );
      return;
    }

    next();
  };
}
