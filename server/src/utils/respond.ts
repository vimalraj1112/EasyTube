import type { Response } from 'express';

import type { ApiSuccess } from '../types/api';

interface SuccessOptions<TData> {
  message: string;
  data: TData;
  status?: number;
}

/**
 * Typed response helpers.
 *
 * Controllers use these instead of hand-building the envelope, which keeps the
 * success/failure contract in exactly one place.
 */
export function sendSuccess<TData>(
  res: Response,
  { message, data, status = 200 }: SuccessOptions<TData>,
): Response {
  const body: ApiSuccess<TData> = {
    success: true,
    message,
    data,
    requestId: res.req.requestId,
  };
  return res.status(status).json(body);
}

/** 201 Created with a Location header. */
export function sendCreated<TData>(
  res: Response,
  options: SuccessOptions<TData>,
  location?: string,
): Response {
  if (location) {
    res.location(location);
  }
  return sendSuccess(res, { ...options, status: 201 });
}

export function sendNoContent(res: Response): Response {
  return res.status(204).end();
}
