import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { ApiError } from '../utils/ApiError';

/**
 * Terminal 404 handler. Mounted after all routers so unmatched paths produce a
 * consistent JSON envelope instead of Express' HTML fallback.
 */
export const notFoundHandler: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} does not exist.`));
};
