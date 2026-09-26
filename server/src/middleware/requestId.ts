import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

/**
 * Assigns a correlation id to every request. Honours an inbound `x-request-id`
 * (so a gateway or the client can propagate ids) and always echoes it back on
 * the response.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header('x-request-id');
  const id = inbound && inbound.length <= 200 ? inbound : randomUUID();

  req.requestId = id;
  res.setHeader('x-request-id', id);
  next();
}
