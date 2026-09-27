import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '@/App';
import { api, authApi } from '@/lib/api';
import { ApiClientError } from '@/lib/apiClient';
import { sessionStore } from '@/lib/sessionStore';
import type { AuthSession, AuthSessionPayload, AuthUser, HealthData } from '@/types/api';

const HEALTH: HealthData = {
  status: 'ok',
  service: 'easytube-api',
  version: '0.1.0',
  environment: 'test',
  uptimeSeconds: 125,
  timestamp: '2026-01-01T00:00:00.000Z',
};

const USER: AuthUser = {
  id: 'u1',
  email: 'you@example.com',
  displayName: 'Alex Rivera',
  avatarUrl: null,
  locale: 'en',
  role: 'USER',
  status: 'ACTIVE',
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const SESSIONS: AuthSession[] = [
  {
    id: 's1',
    current: true,
    kind: 'primary',
    ip: '203.0.113.9',
    userAgent: 'Firefox on Linux',
    createdAt: '2026-01-02T10:00:00.000Z',
    expiresAt: '2026-01-09T10:00:00.000Z',
  },
];

function payload(overrides: Partial<AuthSessionPayload> = {}): AuthSessionPayload {
  return {
    user: USER,
    accessToken: 'access-1',
    expiresIn: 900,
    csrfToken: 'csrf-1',
    ...overrides,
  };
}

function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

/** The signed-out default, so no test can reach the network by accident. */
function signedOut(): ApiClientError {
  return new ApiClientError({
    kind: 'http',
    message: 'No session cookie was sent.',
    status: 401,
    code: 'UNAUTHORIZED',
  });
}

beforeEach(() => {
  sessionStore.clear();
  vi.spyOn(api, 'health').mockResolvedValue(HEALTH);
  vi.spyOn(authApi, 'refresh').mockRejectedValue(signedOut());
  vi.spyOn(authApi, 'sessions').mockResolvedValue({ sessions: [] });
  vi.spyOn(authApi, 'login').mockRejectedValue(signedOut());
  vi.spyOn(authApi, 'register').mockRejectedValue(signedOut());
  vi.spyOn(authApi, 'logout').mockResolvedValue({ sessionId: null });
  vi.spyOn(authApi, 'logoutAll').mockResolvedValue({ revoked: 0 });
});

describe('anonymous visitor', () => {
  it('offers sign-in when the refresh cookie is not usable', async () => {
    renderApp();

    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create account' })).toBeInTheDocument();
  });

  it('sends a signed-out visitor from a protected route to the sign-in page', async () => {
    renderApp('/account');

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('existing session', () => {
  it('restores the session from the refresh cookie without a sign-in form', async () => {
    vi.spyOn(authApi, 'refresh').mockResolvedValue(payload());
    vi.spyOn(authApi, 'sessions').mockResolvedValue({ sessions: SESSIONS });

    renderApp('/account');

    expect(await screen.findByRole('heading', { name: 'Your account' })).toBeInTheDocument();
    expect(screen.getByText('you@example.com')).toBeInTheDocument();
    expect(sessionStore.getAccessToken()).toBe('access-1');
  });

  it('lists active sessions and marks the current device', async () => {
    vi.spyOn(authApi, 'refresh').mockResolvedValue(payload());
    vi.spyOn(authApi, 'sessions').mockResolvedValue({ sessions: SESSIONS });

    renderApp('/account');

    expect(await screen.findByText('This device')).toBeInTheDocument();
    expect(screen.getByText(/Firefox on Linux/)).toBeInTheDocument();
  });

  it('sends a signed-in visitor away from the sign-in page', async () => {
    vi.spyOn(authApi, 'refresh').mockResolvedValue(payload());

    renderApp('/login');

    expect(await screen.findByRole('heading', { name: 'Your account' })).toBeInTheDocument();
  });
});

describe('signing in', () => {
  it('signs in through the form and lands on the account page', async () => {
    const login = vi.spyOn(authApi, 'login').mockResolvedValue(payload());
    vi.spyOn(authApi, 'sessions').mockResolvedValue({ sessions: SESSIONS });

    renderApp('/login');

    fireEvent.change(await screen.findByLabelText('Email'), {
      target: { value: 'you@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'CorrectHorseBattery9' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Your account' })).toBeInTheDocument();
    expect(login).toHaveBeenCalledWith({
      email: 'you@example.com',
      password: 'CorrectHorseBattery9',
    });
  });

  it('shows the server message when the credentials are refused', async () => {
    vi.spyOn(authApi, 'login').mockRejectedValue(
      new ApiClientError({ kind: 'http', message: 'Invalid email or password.', status: 401 }),
    );

    renderApp('/login');

    fireEvent.change(await screen.findByLabelText('Email'), {
      target: { value: 'you@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'WrongPassword123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument();
  });

  it('reports a weak password before the request is ever sent', async () => {
    const register = vi.spyOn(authApi, 'register');

    renderApp('/register');

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Alex Rivera' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'you@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Use at least 12 characters.')).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });
});

describe('signing out', () => {
  it('clears the client session even when the sign-out request fails', async () => {
    vi.spyOn(authApi, 'refresh').mockResolvedValue(payload());
    vi.spyOn(authApi, 'sessions').mockResolvedValue({ sessions: SESSIONS });
    vi.spyOn(authApi, 'logout').mockRejectedValue(
      new ApiClientError({ kind: 'network', message: 'Connection lost.', code: 'NETWORK_ERROR' }),
    );

    renderApp('/account');

    await screen.findByRole('heading', { name: 'Your account' });

    // Both the header and the account page offer "Sign out"; this asserts on the
    // header control so the account page's own button cannot satisfy the query.
    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Sign out' }));

    await waitFor(() => {
      expect(sessionStore.getAccessToken()).toBeNull();
    });
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });
});
