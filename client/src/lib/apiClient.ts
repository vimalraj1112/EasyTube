import type { AxiosError, AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import axios from 'axios';

import { clientEnv } from '@/config/env';
import { sessionStore } from '@/lib/sessionStore';
import type { ApiFailure, ApiSuccess, AuthSessionPayload } from '@/types/api';

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
      return new ApiClientError({
        kind: 'unknown',
        message: 'Request cancelled.',
        code: 'CANCELLED',
      });
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

const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['get', 'head', 'options']);

/**
 * Endpoints that must never carry a bearer token or trigger a refresh retry.
 *
 * `refresh` is the interesting one: it exists precisely because the access token
 * has expired, and sending the dead one back would be pointless. The sign-in
 * endpoints are included so a stale token in memory cannot leak into a request
 * that establishes a brand new session.
 */
const UNAUTHENTICATED_PATHS = ['/auth/register', '/auth/login', '/auth/refresh'] as const;

interface AuthRequestConfig extends InternalAxiosRequestConfig {
  /** Set on the refresh call itself so it cannot recurse into another refresh. */
  skipAuthRetry?: boolean;
  /** Set once a request has been replayed, so a second 401 is final. */
  didReplay?: boolean;
}

function isAuthEndpoint(url: string | undefined): boolean {
  const path = url ?? '';
  return UNAUTHENTICATED_PATHS.some((candidate) => path.startsWith(candidate));
}

let refreshInFlight: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  try {
    const response = await http.post<ApiSuccess<AuthSessionPayload>>('/auth/refresh', null, {
      skipAuthRetry: true,
    } as Partial<AuthRequestConfig>);
    sessionStore.set(response.data.data);
    return response.data.data.accessToken;
  } catch {
    // The refresh cookie is gone, expired or revoked: the session is over.
    sessionStore.clear();
    return null;
  }
}

/**
 * Exchanges the refresh cookie for a new access token.
 *
 * Single-flight on purpose. Several requests failing at once must not each
 * redeem the rotating refresh token, because the server treats a second
 * redemption of the same token as replay and revokes the whole family - a
 * single mistimed parallel request would sign the user out.
 */
function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= performRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

http.interceptors.request.use((config) => {
  config.headers.set('x-request-id', createRequestId());

  const method = (config.method ?? 'get').toLowerCase();
  const accessToken = sessionStore.getAccessToken();

  if (accessToken && !isAuthEndpoint(config.url)) {
    config.headers.set('Authorization', `Bearer ${accessToken}`);
  }

  if (!SAFE_METHODS.has(method)) {
    const csrfToken = sessionStore.getCsrfToken();
    if (csrfToken) config.headers.set(CSRF_HEADER, csrfToken);
  }

  return config;
});

http.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: unknown) => {
    const apiError = ApiClientError.from(error);
    const config = axios.isAxiosError(error)
      ? (error.config as AuthRequestConfig | undefined)
      : undefined;

    const canReplay =
      apiError.status === 401 &&
      config !== undefined &&
      config.skipAuthRetry !== true &&
      config.didReplay !== true &&
      !isAuthEndpoint(config.url);

    if (!canReplay) {
      return Promise.reject(apiError);
    }

    const token = await refreshAccessToken();
    if (!token) {
      return Promise.reject(apiError);
    }

    // Replaying re-runs the request interceptor, which attaches the fresh token.
    config.didReplay = true;
    return http.request(config);
  },
);
