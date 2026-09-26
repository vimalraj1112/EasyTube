import type { AxiosError, AxiosInstance, AxiosResponse } from 'axios';
import axios from 'axios';

import { clientEnv } from '@/config/env';
import type { ApiFailure } from '@/types/api';

/**
 * Normalised transport-level error. UI code branches on `kind` and reads a
 * human-ready `message`, so no component ever inspects an Axios error.
 */
export class ApiClientError extends Error {
  public readonly kind: 'network' | 'timeout' | 'http' | 'unknown';
  public readonly status: number | undefined;
  public readonly code: string;
  public readonly requestId: string | undefined;
  public readonly details: unknown;

  constructor(params: {
    kind: ApiClientError['kind'];
    message: string;
    status?: number;
    code?: string;
    requestId?: string;
    details?: unknown;
  }) {
    super(params.message);
    this.name = 'ApiClientError';
    this.kind = params.kind;
    this.status = params.status;
    this.code = params.code ?? 'UNKNOWN';
    this.requestId = params.requestId;
    this.details = params.details;
  }

  static from(error: unknown): ApiClientError {
    if (error instanceof ApiClientError) return error;

    if (axios.isCancel(error)) {
      return new ApiClientError({ kind: 'unknown', message: 'Request cancelled.', code: 'CANCELLED' });
    }

    if (axios.isAxiosError(error)) {
      return ApiClientError.fromAxios(error as AxiosError<ApiFailure>);
    }

    return new ApiClientError({
      kind: 'unknown',
      message: 'Something went wrong. Please try again.',
      code: 'UNKNOWN',
    });
  }

  private static fromAxios(error: AxiosError<ApiFailure>): ApiClientError {
    const { response, code } = error;
    const requestId = response?.headers?.['x-request-id'] as string | undefined;

    if (response?.data?.success === false) {
      return new ApiClientError({
        kind: 'http',
        message: response.data.message,
        status: response.status,
        code: response.data.error?.code ?? 'HTTP_ERROR',
        requestId: response.data.requestId ?? requestId,
        details: response.data.error?.details,
      });
    }

    if (response) {
      return new ApiClientError({
        kind: 'http',
        message: 'Something went wrong while processing this media.',
        status: response.status,
        code: code ?? 'HTTP_ERROR',
        requestId,
      });
    }

    const isTimeout = code === 'ECONNABORTED' || code === 'ETIMEDOUT';

    return new ApiClientError({
      kind: isTimeout ? 'timeout' : 'network',
      message: isTimeout
        ? 'The request took too long. Please try again.'
        : 'Connection lost. Check your internet and try again.',
      code: code ?? (isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR'),
    });
  }
}

/** Correlation id helper with a fallback for non-secure contexts. */
function createRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export const http: AxiosInstance = axios.create({
  baseURL: clientEnv.VITE_API_BASE_URL,
  timeout: clientEnv.VITE_API_TIMEOUT_MS,
  // httpOnly refresh cookies must ride along with auth requests.
  withCredentials: true,
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
});

http.interceptors.request.use((config) => {
  config.headers.set('x-request-id', createRequestId());
  return config;
});

http.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: unknown) => Promise.reject(ApiClientError.from(error)),
);
