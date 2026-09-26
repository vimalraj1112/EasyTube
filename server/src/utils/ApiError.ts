import { StatusCodes } from 'http-status-codes';
import { ZodError } from 'zod';

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'UNSUPPORTED_SOURCE'
  | 'TOO_MANY_REQUESTS'
  | 'PAYLOAD_TOO_LARGE'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

/**
 * Operational error carrying an HTTP status, a stable machine-readable code and
 * an optional payload for the client. Anything thrown that is *not* an
 * ApiError is treated as an unexpected failure and reported as a 500 without
 * leaking internals.
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: ApiErrorCode;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(
    statusCode: number,
    message: string,
    code: ApiErrorCode = 'INTERNAL_ERROR',
    details?: unknown,
    isOperational = true,
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message = 'Bad request.', details?: unknown): ApiError {
    return new ApiError(StatusCodes.BAD_REQUEST, message, 'BAD_REQUEST', details);
  }

  static validation(message = 'Validation failed.', details?: unknown): ApiError {
    return new ApiError(StatusCodes.BAD_REQUEST, message, 'VALIDATION_ERROR', details);
  }

  static unauthorized(message = 'Authentication required.'): ApiError {
    return new ApiError(StatusCodes.UNAUTHORIZED, message, 'UNAUTHORIZED');
  }

  static forbidden(message = 'You do not have access to this resource.'): ApiError {
    return new ApiError(StatusCodes.FORBIDDEN, message, 'FORBIDDEN');
  }

  static notFound(message = 'Resource not found.'): ApiError {
    return new ApiError(StatusCodes.NOT_FOUND, message, 'NOT_FOUND');
  }

  static conflict(message = 'Resource already exists.'): ApiError {
    return new ApiError(StatusCodes.CONFLICT, message, 'CONFLICT');
  }

  static unsupportedSource(message = 'This source is not currently supported.'): ApiError {
    return new ApiError(StatusCodes.BAD_REQUEST, message, 'UNSUPPORTED_SOURCE');
  }

  static tooManyRequests(
    message = 'You are moving a little fast. Please try again shortly.',
  ): ApiError {
    return new ApiError(StatusCodes.TOO_MANY_REQUESTS, message, 'TOO_MANY_REQUESTS');
  }

  static serviceUnavailable(
    message = 'Service is temporarily unavailable. Please try again shortly.',
    details?: unknown,
  ): ApiError {
    return new ApiError(
      StatusCodes.SERVICE_UNAVAILABLE,
      message,
      'SERVICE_UNAVAILABLE',
      details,
    );
  }

  static internal(message = 'Something went wrong while processing this media.'): ApiError {
    return new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      message,
      'INTERNAL_ERROR',
      undefined,
      true,
    );
  }

  /**
   * Normalises unknown throwables into an ApiError. Framework-level errors
   * (malformed JSON body, unsupported content type) are mapped to sensible
   * statuses; everything else becomes an opaque 500.
   */
  static from(error: unknown): ApiError {
    if (error instanceof ApiError) {
      return error;
    }

    if (error instanceof ZodError) {
      return ApiError.validation('Validation failed.', error.flatten());
    }

    if (error instanceof SyntaxError && 'body' in error) {
      return new ApiError(StatusCodes.BAD_REQUEST, 'Malformed JSON payload.', 'BAD_REQUEST');
    }

    if (
      typeof error === 'object' &&
      error !== null &&
      'type' in error &&
      (error as { type?: string }).type === 'entity.too.large'
    ) {
      return new ApiError(413, 'Payload too large.', 'PAYLOAD_TOO_LARGE');
    }

    const message = error instanceof Error ? error.message : 'Unexpected error';

    return new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      message,
      'INTERNAL_ERROR',
      undefined,
      false,
    );
  }
}
