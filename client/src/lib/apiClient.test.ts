import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { http } from './apiClient';
import { authApi } from './api';
import { sessionStore } from './sessionStore';
import type { ApiSuccess, AuthSessionPayload } from '@/types/api';

const USER = {
  id: 'u1',
  email: 'you@example.com',
  displayName: 'Alex Rivera',
  avatarUrl: null,
  locale: 'en',
  role: 'USER',
  status: 'ACTIVE',
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
} satisfies AuthSessionPayload['user'];

function payload(accessToken: string): AuthSessionPayload {
  return { user: USER, accessToken, expiresIn: 900, csrfToken: 'csrf-value' };
}

function ok(data: unknown): ApiSuccess<unknown> {
  return { success: true, message: 'ok', requestId: 'r1', data };
}

function unauthorized(config: InternalAxiosRequestConfig): AxiosError {
  return new AxiosError(
    'Request failed with status code 401',
    'ERR_BAD_REQUEST',
    config,
    undefined,
    {
      status: 401,
      statusText: 'Unauthorized',
      headers: {},
      config,
      data: {
        success: false,
        message: 'Invalid or expired access token.',
        requestId: 'r1',
        error: { code: 'UNAUTHORIZED' },
      },
    } as AxiosResponse,
  );
}

let seen: InternalAxiosRequestConfig[] = [];
let originalAdapter: unknown;

beforeEach(() => {
  seen = [];
  originalAdapter = http.defaults.adapter;
  sessionStore.clear();
});

afterEach(() => {
  http.defaults.adapter = originalAdapter as typeof http.defaults.adapter;
  sessionStore.clear();
});

/** Replaces the transport so tests can assert on what actually went out. */
function intercept(
  handler: (config: InternalAxiosRequestConfig) => AxiosResponse | Promise<AxiosResponse>,
): void {
  http.defaults.adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    seen.push(config);
    return handler(config);
  };
}

function lastRequestTo(path: string): InternalAxiosRequestConfig | undefined {
  return seen.filter((config) => (config.url ?? '').startsWith(path)).at(-1);
}

describe('auth transport', () => {
  it('sends the access token as a bearer header once a session exists', async () => {
    sessionStore.set(payload('access-1'));
    intercept(() => ({ data: ok({ user: USER }), status: 200 }) as AxiosResponse);

    await authApi.me();

    expect(lastRequestTo('/auth/me')?.headers.get('Authorization')).toBe('Bearer access-1');
  });

  it('sends the CSRF token on unsafe methods and omits it on reads', async () => {
    sessionStore.set(payload('access-1'));
    intercept(() => ({ data: ok({ sessions: [] }), status: 200 }) as AxiosResponse);

    await authApi.sessions();
    await authApi.logout();

    expect(lastRequestTo('/auth/sessions')?.headers.get('x-csrf-token')).toBeUndefined();
    expect(lastRequestTo('/auth/logout')?.headers.get('x-csrf-token')).toBe('csrf-value');
  });

  it('does not attach a stale bearer token to sign-in requests', async () => {
    sessionStore.set(payload('access-1'));
    intercept(() => ({ data: ok(payload('access-2')), status: 200 }) as AxiosResponse);

    await authApi.login({ email: 'you@example.com', password: 'whatever' });

    expect(lastRequestTo('/auth/login')?.headers.get('Authorization')).toBeUndefined();
  });

  it('replays a 401 once with a token obtained from the refresh cookie', async () => {
    sessionStore.set(payload('access-1'));

    intercept((config) => {
      if (config.url?.startsWith('/auth/refresh')) {
        return { data: ok(payload('access-2')), status: 200 } as AxiosResponse;
      }
      if (config.headers.get('Authorization') === 'Bearer access-1') {
        return Promise.reject(unauthorized(config));
      }
      return { data: ok({ user: USER }), status: 200 } as AxiosResponse;
    });

    const { user } = await authApi.me();

    expect(user.email).toBe('you@example.com');
    expect(lastRequestTo('/auth/me')?.headers.get('Authorization')).toBe('Bearer access-2');
    expect(sessionStore.getAccessToken()).toBe('access-2');
  });

  it('redeems the rotating refresh token once when several requests fail together', async () => {
    sessionStore.set(payload('access-1'));

    intercept((config) => {
      if (config.url?.startsWith('/auth/refresh')) {
        return { data: ok(payload('access-2')), status: 200 } as AxiosResponse;
      }
      if (config.headers.get('Authorization') === 'Bearer access-1') {
        return Promise.reject(unauthorized(config));
      }
      return { data: ok({ user: USER }), status: 200 } as AxiosResponse;
    });

    await Promise.all([authApi.me(), authApi.sessions(), authApi.sessions()]);

    // A second redemption of the same refresh token is treated by the server as
    // replay, which revokes the whole family. Parallel 401s must not cause that.
    expect(seen.filter((config) => config.url?.startsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('clears the session when the refresh cookie is no longer valid', async () => {
    sessionStore.set(payload('access-1'));

    intercept((config) => Promise.reject(unauthorized(config)));

    await expect(authApi.me()).rejects.toThrow();

    expect(sessionStore.getAccessToken()).toBeNull();
  });
});
