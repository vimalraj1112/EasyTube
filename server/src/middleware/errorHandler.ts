import type { ErrorRequestHandler } from 'express';

import { env } from '../config/env';
import { logger as rootLogger } from '../config/logger';
import type { ApiFailure } from '../types/api';
import { ApiError } from '../utils/ApiError';

/**
 * Centralised error handler. Mounted last, after `notFoundHandler`, so every
 * failure - thrown, rejected or unmatched - resolves into the same JSON
 * envelope. Keeps all four parameters: Express detects error handlers by arity.
 */
export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  const apiError = ApiError.from(error);
  const isServerError = apiError.statusCode >= 500;

  const logPayload = {
    err: apiError.isOperational ? { message: apiError.message, code: apiError.code } : error,
    statusCode: apiError.statusCode,
    method: req.method,
    path: req.originalUrl,
    userId: (req as { userId?: string }).userId,
    requestId: req.requestId,
  };

  // pino-http already writes the access log (method, url, status, duration) for
  // every response, so this handler only adds an entry for genuine server-side
  // faults. Logging 4xx here too would duplicate every line.
  //
  // `req.log` is absent if a request fails before the logging middleware runs;
  // fall back to the root logger rather than throwing inside the error handler.
  if (isServerError) {
    (req.log ?? rootLogger).error(logPayload, 'Request failed');
  }

  const body: ApiFailure = {
    success: false,
    message: apiError.message,
    error: {
      code: apiError.code,
      ...(apiError.details !== undefined ? { details: apiError.details } : {}),
      // Stack traces are a development affordance only - never leak them in production.
      ...(!env.isProduction && isServerError && apiError.details === undefined
        ? { details: (error as Error | undefined)?.stack }
        : {}),
    },
    requestId: req.requestId,
  };

  if (res.headersSent) {
    res.end();
    return;
  }

  res.status(apiError.statusCode).json(body);
};
