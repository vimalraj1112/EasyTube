import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Wraps an async route handler so rejected promises reach the centralised
 * error middleware instead of becoming unhandled rejections.
 */
export function asyncHandler<
  TParams = Record<string, string>,
  TResBody = unknown,
  TReqBody = unknown,
  TQuery = Record<string, unknown>,
>(
  handler: (
    req: Request<TParams, TResBody, TReqBody, TQuery>,
    res: Response<TResBody>,
    next: NextFunction,
  ) => Promise<unknown>,
): RequestHandler<TParams, TResBody, TReqBody, TQuery> {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}
