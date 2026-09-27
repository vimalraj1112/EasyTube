import request, { type Response } from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app';
import { AUTH_COOKIES } from '../config/constants';
import { createAuthService, type PublicUser, type SessionSummary } from '../services/auth.service';
import { createAuthModule } from '../services/auth.module';
import { verifyAccessToken } from '../utils/token';
import { createHarness, createUserPort, type Harness } from './helpers/auth.fakes';

/**
 * End-to-end HTTP tests for `/auth`, with the repositories faked but the real
 * Express stack: real body parsing, real cookies, real CSRF middleware, real
 * error handler, real status codes and envelopes.
 *
 * The point of testing at this level is the wiring. It is where a token leaks
 * into a response body, a cookie loses `httpOnly`, or the CSRF check is mounted
 * in the wrong order - none of which a service-level test can see.
 */

const VALID_PASSWORD = 'CorrectHorseBattery9';
const CREDENTIALS = {
  email: 'user@example.com',
  password: VALID_PASSWORD,
  displayName: 'Test User',
};

type App = ReturnType<typeof createApp>;

/** One harness and app per test, so no state leaks between them. */
function build(): { app: App; harness: Harness } {
  const harness = createHarness();
  const app = createApp({
    auth: {
      users: createUserPort(harness.state),
      service: createAuthService({ ...harness.deps }),
    },
  });
  return { app, harness };
}

/** Registers and returns the agent plus the tokens from the response. */
async function register(app: App): Promise<{
  response: Response;
  agent: ReturnType<typeof request.agent>;
}> {
  const response = await request(app).post('/api/v1/auth/register').send(CREDENTIALS);
  return { response, agent: request.agent(app) };
}

/**
 * All `Set-Cookie` header values.
 *
 * Superagent types the header bag loosely, so the value is asserted to a real
 * union here - once - rather than letting `any` spread into every assertion
 * downstream, where a typo in a cookie name would silently pass.
 */
function setCookies(response: Response): string[] {
  const header = response.headers['set-cookie'] as string | string[] | undefined;
  if (!header) {
    return [];
  }
  return Array.isArray(header) ? header : [header];
}

/** Reads one cookie's value off a `Set-Cookie` header, or undefined when absent. */
function cookieValue(response: Response, name: string): string | undefined {
  const match = setCookies(response).find((cookie) => cookie.startsWith(`${name}=`));
  return match?.split(';')[0]?.slice(name.length + 1);
}

/**
 * The response envelope every endpoint returns.
 *
 * `Response.body` is `any` in superagent's types, so reading it directly leaks
 * untyped values into every assertion - a renamed field would still typecheck.
 * These readers narrow it once, at the boundary, against the shapes the routes
 * actually send.
 */
interface SuccessEnvelope {
  data: AuthPayload;
}

interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

/** Union of the payloads `register`/`login`/`refresh`/`change-password` return. */
interface AuthPayload {
  user: PublicUser;
  accessToken: string;
  /** Present on session-establishing responses, for the client to echo back. */
  csrfToken: string;
  /** Access-token lifetime in seconds. */
  expiresIn: number;
  /** `logout-all` reports how many live sessions it ended. */
  revoked: number;
  sessions: SessionSummary[];
}

/** The success payload of a response. */
function dataOf(response: Response): AuthPayload {
  const { data } = response.body as SuccessEnvelope;
  return data;
}

/** The error payload of a response. */
function errorOf(response: Response): ErrorEnvelope['error'] {
  const { error } = response.body as ErrorEnvelope;
  return error;
}

/**
 * The id of the one session a freshly registered account has.
 *
 * Asserting the count here rather than indexing blind means a broken listing
 * fails with a clear message instead of a `TypeError` three lines later.
 */
function onlySessionId(response: Response): string {
  const [first, ...rest] = dataOf(response).sessions;
  if (!first || rest.length > 0) {
    throw new Error(`expected exactly one session, got ${rest.length + (first ? 1 : 0)}`);
  }
  return first.id;
}

describe('POST /api/v1/auth/register', () => {
  let app: ReturnType<typeof createApp>;
  let harness: Harness;

  beforeEach(() => {
    ({ app, harness } = build());
  });

  it('creates the account and returns 201', async () => {
    const { response } = await register(app);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      message: 'Account created.',
      data: {
        user: { email: CREDENTIALS.email, displayName: CREDENTIALS.displayName, role: 'USER' },
        csrfToken: expect.any(String),
        expiresIn: expect.any(Number),
      },
    });
    expect(harness.state.users).toHaveLength(1);
  });

  it('returns the access token in the body but never the refresh token', async () => {
    const { response } = await register(app);

    expect(dataOf(response).accessToken.split('.')).toHaveLength(3);
    // The whole point of the httpOnly cookie. A refresh token in the body would
    // be readable by any injected script and would undo every other protection.
    expect(JSON.stringify(response.body)).not.toContain('refreshToken');
    expect(cookieValue(response, AUTH_COOKIES.REFRESH)).toEqual(expect.any(String));
  });

  it('sets the refresh cookie httpOnly and with a path', async () => {
    const { response } = await register(app);
    const raw = setCookies(response).find((cookie) => cookie.startsWith(AUTH_COOKIES.REFRESH));
    expect(raw).toBeDefined();
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/Path=\//i);
    expect(raw).toMatch(/Expires=/i);
  });

  it('sets a readable CSRF cookie alongside it', async () => {
    // Deliberately not httpOnly: the client has to read it to echo it back.
    const { response } = await register(app);
    const raw = setCookies(response).find((cookie) => cookie.startsWith(AUTH_COOKIES.CSRF));
    expect(raw).toBeDefined();
    expect(raw).not.toMatch(/HttpOnly/i);
    expect(dataOf(response).csrfToken).toEqual(expect.any(String));
  });

  it('rejects a weak password with 400 before hashing anything', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...CREDENTIALS, password: 'short' });

    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('VALIDATION_ERROR');
    expect(harness.state.users).toHaveLength(0);
    expect(harness.hasher.hashes).toBe(0);
  });

  it('rejects a malformed email', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...CREDENTIALS, email: 'not-an-email' });

    expect(response.status).toBe(400);
  });

  it('answers 409 for a duplicate address', async () => {
    await register(app);
    const { response } = await register(app);

    expect(response.status).toBe(409);
    expect(errorOf(response).code).toBe('CONFLICT');
  });
});

describe('POST /api/v1/auth/login', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    const built = build();
    app = built.app;
    await register(app);
  });

  it('signs in and issues a pair', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: CREDENTIALS.email, password: VALID_PASSWORD });

    expect(response.status).toBe(200);
    expect(dataOf(response).accessToken).toEqual(expect.any(String));
    expect(cookieValue(response, AUTH_COOKIES.REFRESH)).toEqual(expect.any(String));
  });

  it('answers 401 with an identical body for a wrong password and an unknown address', async () => {
    // The single most important anti-enumeration property of the login route.
    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: CREDENTIALS.email, password: 'WrongPassword123' });
    const unknownUser = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: VALID_PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(errorOf(wrongPassword).message).toBe(errorOf(unknownUser).message);
    expect(errorOf(wrongPassword).code).toBe(errorOf(unknownUser).code);
  });

  it('answers 429 once the account is locked', async () => {
    const { harness: h } = build();
    const locked = createApp({
      auth: { users: createUserPort(h.state), service: createAuthService({ ...h.deps }) },
    });
    await request(locked).post('/api/v1/auth/register').send(CREDENTIALS);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(locked)
        .post('/api/v1/auth/login')
        .send({ email: CREDENTIALS.email, password: 'WrongPassword123' });
    }

    const response = await request(locked)
      .post('/api/v1/auth/login')
      .send({ email: CREDENTIALS.email, password: VALID_PASSWORD });

    expect(response.status).toBe(429);
    expect(errorOf(response).code).toBe('TOO_MANY_REQUESTS');
  });
});

describe('POST /api/v1/auth/refresh', () => {
  it('rotates the cookie and returns a new access token', async () => {
    const { app, harness } = build();
    // An agent keeps cookies between calls, which is what a browser does and is
    // required here: the refresh cookie is the credential.
    const agent = request.agent(app);
    const registered = await agent.post('/api/v1/auth/register').send(CREDENTIALS);

    const first = await agent
      .post('/api/v1/auth/refresh')
      .set('X-CSRF-Token', dataOf(registered).csrfToken);

    expect(first.status).toBe(200);
    expect(cookieValue(first, AUTH_COOKIES.REFRESH)).toEqual(expect.any(String));
    expect(harness.state.sessions).toHaveLength(2);
    expect(harness.state.sessions[0]?.rotatedAt).not.toBeNull();
  });

  it('rotates the CSRF token along with the session', async () => {
    const { app } = build();
    const agent = request.agent(app);
    const registered = await agent.post('/api/v1/auth/register').send(CREDENTIALS);

    const first = await agent
      .post('/api/v1/auth/refresh')
      .set('X-CSRF-Token', dataOf(registered).csrfToken);

    expect(dataOf(first).csrfToken).not.toBe(dataOf(registered).csrfToken);
  });

  it('rejects a replayed cookie and burns the family', async () => {
    // The core replay property, observed over HTTP: a stolen refresh token is
    // worth at most one use, and using it locks out the legitimate owner too.
    const { app, harness } = build();
    const registered = await request(app).post('/api/v1/auth/register').send(CREDENTIALS);
    const original = cookieValue(registered, AUTH_COOKIES.REFRESH)!;
    const csrf = dataOf(registered).csrfToken;

    // A second client replaying a token it intercepted.
    const attacker = request.agent(app);
    const stolen = await attacker
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${AUTH_COOKIES.REFRESH}=${original}; ${AUTH_COOKIES.CSRF}=${csrf}`)
      .set('X-CSRF-Token', csrf);
    expect(stolen.status).toBe(200);

    // The rightful owner now presents the same, already-spent token.
    const owner = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${AUTH_COOKIES.REFRESH}=${original}; ${AUTH_COOKIES.CSRF}=${csrf}`)
      .set('X-CSRF-Token', csrf);
    expect(owner.status).toBe(401);

    // The attacker's replacement is dead as well, so the theft bought nothing.
    // Their agent now holds the *rotated* CSRF token, which is why the header has
    // to be refreshed too - a stale one is rejected by the CSRF check first.
    const attackerRetry = await attacker
      .post('/api/v1/auth/refresh')
      .set('X-CSRF-Token', dataOf(stolen).csrfToken);
    expect(attackerRetry.status).toBe(401);
    expect(harness.state.sessions.every((session) => session.revokedAt !== null)).toBe(true);
  });

  it('answers 401 when no cookie is sent at all', async () => {
    const { app } = build();
    const response = await request(app).post('/api/v1/auth/refresh');

    expect(response.status).toBe(401);
  });
});

describe('CSRF protection', () => {
  it('rejects a cookie-authenticated POST with no CSRF header', async () => {
    // The browser attaches the refresh cookie automatically on a cross-site form
    // post. Without the header check, that is a forged request - and it is
    // rejected even though the caller also sent a perfectly valid access token.
    const { app } = build();
    const registered = await request(app).post('/api/v1/auth/register').send(CREDENTIALS);
    const cookie = cookieValue(registered, AUTH_COOKIES.REFRESH)!;
    const csrf = cookieValue(registered, AUTH_COOKIES.CSRF)!;

    const response = await request(app)
      .post('/api/v1/auth/logout-all')
      .set('Cookie', `${AUTH_COOKIES.REFRESH}=${cookie}; ${AUTH_COOKIES.CSRF}=${csrf}`)
      .set('Authorization', `Bearer ${dataOf(registered).accessToken}`);

    expect(response.status).toBe(403);
  });

  it('rejects a mismatched CSRF header', async () => {
    const { app } = build();
    const registered = await request(app).post('/api/v1/auth/register').send(CREDENTIALS);
    const cookie = cookieValue(registered, AUTH_COOKIES.REFRESH)!;
    const csrf = cookieValue(registered, AUTH_COOKIES.CSRF)!;

    const response = await request(app)
      .post('/api/v1/auth/logout-all')
      .set('Cookie', `${AUTH_COOKIES.REFRESH}=${cookie}; ${AUTH_COOKIES.CSRF}=${csrf}`)
      .set('X-CSRF-Token', 'a'.repeat(64))
      .set('Authorization', `Bearer ${dataOf(registered).accessToken}`);

    expect(response.status).toBe(403);
  });

  it('rejects a missing CSRF cookie even when the header looks right', async () => {
    // A token in the header with no cookie to compare against is a forgery
    // attempt: the genuine pair is always issued together.
    const { app } = build();
    const registered = await request(app).post('/api/v1/auth/register').send(CREDENTIALS);
    const cookie = cookieValue(registered, AUTH_COOKIES.REFRESH)!;

    const response = await request(app)
      .post('/api/v1/auth/logout-all')
      .set('Cookie', `${AUTH_COOKIES.REFRESH}=${cookie}`)
      .set('X-CSRF-Token', dataOf(registered).csrfToken)
      .set('Authorization', `Bearer ${dataOf(registered).accessToken}`);

    expect(response.status).toBe(403);
  });

  it('does not require a CSRF token when no refresh cookie is present', async () => {
    // A bearer-token request is not forgeable cross-site, so demanding a token
    // would be friction with no security benefit.
    const { app } = build();
    const registered = await request(app).post('/api/v1/auth/register').send(CREDENTIALS);

    const response = await request(app)
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${dataOf(registered).accessToken}`);

    expect(response.status).toBe(200);
  });

  it('does not require a CSRF token for safe methods', async () => {
    const { app } = build();
    const registered = await request(app).post('/api/v1/auth/register').send(CREDENTIALS);

    const response = await request(app)
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${dataOf(registered).accessToken}`);

    expect(response.status).toBe(200);
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns the caller from the access token', async () => {
    const { app } = build();
    const registered = await request(app).post('/api/v1/auth/register').send(CREDENTIALS);

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${dataOf(registered).accessToken}`);

    expect(response.status).toBe(200);
    expect(dataOf(response).user).toMatchObject({ email: CREDENTIALS.email, role: 'USER' });
  });

  it('never includes the password hash', async () => {
    const { app, harness } = build();
    const registered = await request(app).post('/api/v1/auth/register').send(CREDENTIALS);

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${dataOf(registered).accessToken}`);

    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain(harness.state.users[0]?.passwordHash);
  });

  it('rejects a missing token', async () => {
    const { app } = build();
    const response = await request(app).get('/api/v1/auth/me');

    expect(response.status).toBe(401);
  });

  it('rejects a refresh token presented as an access token', async () => {
    const { app } = build();
    const registered = await request(app).post('/api/v1/auth/register').send(CREDENTIALS);
    const cookie = cookieValue(registered, AUTH_COOKIES.REFRESH)!;

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${cookie}`);

    expect(response.status).toBe(401);
  });

  it('rejects a suspended account even with a valid unexpired token', async () => {
    // The reason the user is re-read on every request: a stateless check would
    // keep honouring this token until it expired.
    const { app, harness } = build();
    const registered = await request(app).post('/api/v1/auth/register').send(CREDENTIALS);
    harness.state.users[0]!.status = 'SUSPENDED';

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${dataOf(registered).accessToken}`);

    expect(response.status).toBe(403);
  });

  it('rejects a token for a user that no longer exists', async () => {
    const { app, harness } = build();
    const registered = await request(app).post('/api/v1/auth/register').send(CREDENTIALS);
    harness.state.users = [];

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${dataOf(registered).accessToken}`);

    expect(response.status).toBe(401);
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('revokes the session and clears both cookies', async () => {
    const { app, harness } = build();
    const agent = request.agent(app);
    const registered = await agent.post('/api/v1/auth/register').send(CREDENTIALS);

    const response = await agent
      .post('/api/v1/auth/logout')
      .set('X-CSRF-Token', dataOf(registered).csrfToken);

    expect(response.status).toBe(200);
    expect(harness.state.sessions[0]?.revokedAt).not.toBeNull();

    // The cleared cookie must match the original's path, or the browser keeps it.
    const cleared = setCookies(response).find((cookie) => cookie.startsWith(AUTH_COOKIES.REFRESH));
    expect(cleared).toMatch(/easytube_rt=;/);
    expect(cleared).toMatch(/Path=\//i);
  });

  it('is idempotent and works with no cookie at all', async () => {
    // A logout that can fail leaves a session alive, which is the opposite of
    // what the user asked for.
    const { app } = build();
    const response = await request(app).post('/api/v1/auth/logout');

    expect(response.status).toBe(200);
  });

  it('does not need an access token', async () => {
    const { app } = build();
    const agent = request.agent(app);
    const registered = await agent.post('/api/v1/auth/register').send(CREDENTIALS);

    // No Authorization header: signing out must work even once the access token
    // has expired, which is exactly when someone most wants to sign out.
    const response = await agent
      .post('/api/v1/auth/logout')
      .set('X-CSRF-Token', dataOf(registered).csrfToken);
    expect(response.status).toBe(200);
  });
});

describe('POST /api/v1/auth/logout-all', () => {
  it('ends every session and clears the cookie', async () => {
    const { app, harness } = build();
    const phone = request.agent(app);
    const registered = await phone.post('/api/v1/auth/register').send(CREDENTIALS);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: CREDENTIALS.email, password: VALID_PASSWORD });

    const response = await phone
      .post('/api/v1/auth/logout-all')
      .set('X-CSRF-Token', dataOf(registered).csrfToken)
      .set('Authorization', `Bearer ${dataOf(registered).accessToken}`);

    expect(response.status).toBe(200);
    expect(dataOf(response).revoked).toBe(2);
    expect(harness.state.sessions.every((session) => session.revokedAt !== null)).toBe(true);
  });

  it('requires authentication', async () => {
    const { app } = build();
    const response = await request(app).post('/api/v1/auth/logout-all');

    expect(response.status).toBe(401);
  });
});

describe('session endpoints', () => {
  it('lists active sessions with no token material', async () => {
    const { app } = build();
    const agent = request.agent(app);
    const registered = await agent.post('/api/v1/auth/register').send(CREDENTIALS);

    const response = await agent
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${dataOf(registered).accessToken}`);

    expect(response.status).toBe(200);
    expect(dataOf(response).sessions).toHaveLength(1);
    expect(dataOf(response).sessions[0]).toMatchObject({ kind: 'primary', current: true });
    expect(JSON.stringify(response.body)).not.toContain('tokenHash');
  });

  it('revokes a session the caller owns', async () => {
    const { app } = build();
    const agent = request.agent(app);
    const registered = await agent.post('/api/v1/auth/register').send(CREDENTIALS);
    const sessions = await agent
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${dataOf(registered).accessToken}`);

    // DELETE is not a safe method, so the cookie this agent is holding brings the
    // CSRF requirement with it.
    const response = await agent
      .delete(`/api/v1/auth/sessions/${onlySessionId(sessions)}`)
      .set('X-CSRF-Token', dataOf(registered).csrfToken)
      .set('Authorization', `Bearer ${dataOf(registered).accessToken}`);

    expect(response.status).toBe(200);
  });

  it('clears the cookie when the revoked session is the caller its own', async () => {
    // Otherwise the browser is left holding a cookie that can no longer be
    // redeemed, and the client has to guess when to clear it.
    const { app } = build();
    const agent = request.agent(app);
    const registered = await agent.post('/api/v1/auth/register').send(CREDENTIALS);
    const sessions = await agent
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${dataOf(registered).accessToken}`);

    const response = await agent
      .delete(`/api/v1/auth/sessions/${onlySessionId(sessions)}`)
      .set('X-CSRF-Token', dataOf(registered).csrfToken)
      .set('Authorization', `Bearer ${dataOf(registered).accessToken}`);

    const cleared = setCookies(response).find((cookie) => cookie.startsWith(AUTH_COOKIES.REFRESH));
    expect(cleared).toMatch(/easytube_rt=;/);
  });

  it('answers 400 for a malformed session id', async () => {
    const { app } = build();
    const agent = request.agent(app);
    const registered = await agent.post('/api/v1/auth/register').send(CREDENTIALS);

    const response = await agent
      .delete('/api/v1/auth/sessions/not-an-object-id')
      .set('X-CSRF-Token', dataOf(registered).csrfToken)
      .set('Authorization', `Bearer ${dataOf(registered).accessToken}`);

    expect(response.status).toBe(400);
  });

  it('answers 404 for a session the caller does not own', async () => {
    const { app, harness } = build();
    const mine = await request(app).post('/api/v1/auth/register').send(CREDENTIALS);
    const other = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...CREDENTIALS, email: 'other@example.com' });

    const otherSessions = harness.state.sessions.filter(
      (session) => session.user.toString() === harness.state.users[1]?._id.toString(),
    );

    const response = await request(app)
      .delete(`/api/v1/auth/sessions/${otherSessions[0]?._id.toString()}`)
      .set('Authorization', `Bearer ${dataOf(mine).accessToken}`);

    expect(response.status).toBe(404);
    // And the other user's session survives.
    expect(other.status).toBe(201);
    expect(otherSessions[0]?.revokedAt).toBeNull();
  });
});

describe('POST /api/v1/auth/change-password', () => {
  it('changes the password, ends other sessions, and returns a working pair', async () => {
    const { app, harness } = build();
    const phone = request.agent(app);
    const registered = await phone.post('/api/v1/auth/register').send(CREDENTIALS);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: CREDENTIALS.email, password: VALID_PASSWORD });

    const response = await phone
      .post('/api/v1/auth/change-password')
      .set('X-CSRF-Token', dataOf(registered).csrfToken)
      .set('Authorization', `Bearer ${dataOf(registered).accessToken}`)
      .send({ currentPassword: VALID_PASSWORD, newPassword: 'AnotherStrongPass7' });

    expect(response.status).toBe(200);

    // The returned pair works, which is the off-by-one this would catch.
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${dataOf(response).accessToken}`);
    expect(me.status).toBe(200);
    expect(harness.state.sessions.filter((session) => !session.revokedAt)).toHaveLength(1);
  });

  it('rejects a wrong current password', async () => {
    const { app } = build();
    const agent = request.agent(app);
    const registered = await agent.post('/api/v1/auth/register').send(CREDENTIALS);

    const response = await agent
      .post('/api/v1/auth/change-password')
      .set('X-CSRF-Token', dataOf(registered).csrfToken)
      .set('Authorization', `Bearer ${dataOf(registered).accessToken}`)
      .send({ currentPassword: 'WrongPassword123', newPassword: 'AnotherStrongPass7' });

    expect(response.status).toBe(401);
  });

  it('rejects a new password that fails the policy', async () => {
    const { app } = build();
    const agent = request.agent(app);
    const registered = await agent.post('/api/v1/auth/register').send(CREDENTIALS);

    const response = await agent
      .post('/api/v1/auth/change-password')
      .set('X-CSRF-Token', dataOf(registered).csrfToken)
      .set('Authorization', `Bearer ${dataOf(registered).accessToken}`)
      .send({ currentPassword: VALID_PASSWORD, newPassword: 'alllowercase' });

    expect(response.status).toBe(400);
  });
});

describe('access token contents', () => {
  it('carries the user id, email and role, and nothing sensitive', async () => {
    const { app } = build();
    const { response } = await register(app);
    const claims = verifyAccessToken(dataOf(response).accessToken);

    expect(claims.sub).toEqual(expect.any(String));
    expect(claims.email).toBe(CREDENTIALS.email);
    expect(claims.role).toBe('USER');
    expect(JSON.stringify(claims)).not.toContain(VALID_PASSWORD);
  });
});

describe('default wiring', () => {
  it('builds an auth module without a database connection', () => {
    // `createApp()` with no options must not require a live MongoDB; the
    // repositories are lazy until a query runs.
    expect(() => createAuthModule()).not.toThrow();
  });
});
