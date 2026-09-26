import { describe, expect, it } from 'vitest';

import { ApiError } from '../utils/ApiError';
import { createAuthService, fingerprintToken, type AuthResult } from '../services/auth.service';
import { issueRefreshToken, verifyRefreshToken } from '../utils/token';
import { createHarness, createUserPort, type Harness } from './helpers/auth.fakes';

/**
 * The auth service is where the security properties actually live, so these
 * tests are about behaviour an attacker would try to provoke: replaying a spent
 * refresh token, guessing a password, enumerating accounts, and riding a
 * session that has already been revoked.
 *
 * Real JWTs are used throughout, so signature and claim handling are genuinely
 * exercised. Only the password hashing is substituted, for speed.
 */

const SUBJECT = '507f1f77bcf86cd799439011';
const CONTEXT = { ip: '203.0.113.10', userAgent: 'vitest', requestId: 'req-1' };
const VALID_PASSWORD = 'CorrectHorseBattery9';

function harness(now = new Date('2026-01-01T00:00:00.000Z')): Harness & {
  service: ReturnType<typeof createAuthService>;
  clock: { value: Date };
} {
  const built = createHarness();
  const clock = { value: now };
  const service = createAuthService({ ...built.deps, now: () => clock.value });
  return { ...built, service, clock };
}

async function registerUser(
  h: ReturnType<typeof harness>,
  email = 'user@example.com',
): Promise<AuthResult> {
  return h.service.register(
    { email, password: VALID_PASSWORD, displayName: 'Test User', locale: 'en' },
    CONTEXT,
  );
}

async function expectApiError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error('Expected the call to reject, but it resolved.');
}

describe('registration', () => {
  it('creates an account, signs in, and never returns the password hash', async () => {
    const h = harness();
    const result = await registerUser(h);

    expect(result.user).toMatchObject({
      email: 'user@example.com',
      displayName: 'Test User',
      role: 'USER',
      status: 'ACTIVE',
    });
    expect(JSON.stringify(result)).not.toContain(VALID_PASSWORD);
    expect(JSON.stringify(result)).not.toContain('passwordHash');

    expect(h.state.users).toHaveLength(1);
    expect(h.state.users[0]?.passwordHash).not.toBe(VALID_PASSWORD);
  });

  it('issues a token pair and a single session', async () => {
    const h = harness();
    const result = await registerUser(h);

    expect(result.tokens.accessToken.split('.')).toHaveLength(3);
    expect(result.tokens.expiresIn).toBeGreaterThan(0);
    expect(h.state.sessions).toHaveLength(1);
    expect(h.state.sessions[0]?.rotatedAt).toBeNull();
    expect(h.state.sessions[0]?.revokedAt).toBeNull();
  });

  it('stores only a digest of the refresh token', async () => {
    const h = harness();
    const result = await registerUser(h);

    // A database leak must not yield a usable session.
    expect(h.state.sessions[0]?.tokenHash).toBe(fingerprintToken(result.tokens.refreshToken));
    expect(h.state.sessions[0]?.tokenHash).not.toBe(result.tokens.refreshToken);
  });

  it('makes the first session the root of its own family', async () => {
    const h = harness();
    await registerUser(h);

    const session = h.state.sessions[0];
    expect(session?._id.toString()).toBe(session?.family.toString());
  });

  it('rejects a duplicate email', async () => {
    const h = harness();
    await registerUser(h);

    const error = await expectApiError(registerUser(h));
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe('CONFLICT');
  });

  it('survives a concurrent duplicate insert by mapping the index violation', async () => {
    const h = harness();
    await registerUser(h);

    // Simulate losing the race: the pre-check passed, then Mongo rejected it.
    const racing = createAuthService({
      ...h.deps,
      users: {
        ...createUserPort(h.state),
        findByEmail() {
          return Promise.resolve(null);
        },
      },
    });

    const error = await expectApiError(
      racing.register(
        { email: 'user@example.com', password: VALID_PASSWORD, displayName: 'R', locale: 'en' },
        CONTEXT,
      ),
    );
    expect(error.statusCode).toBe(409);
  });

  it('records an audit entry', async () => {
    const h = harness();
    await registerUser(h);

    expect(h.state.audit.map((entry) => entry.action)).toContain('USER_REGISTERED');
  });
});

describe('login', () => {
  it('accepts the right password and starts a fresh session', async () => {
    const h = harness();
    await registerUser(h);

    const result = await h.service.login(
      { email: 'user@example.com', password: VALID_PASSWORD },
      CONTEXT,
    );

    expect(result.user.email).toBe('user@example.com');
    expect(h.state.sessions).toHaveLength(2);
    expect(h.state.sessions[0]?.revokedAt).toBeNull();
  });

  it('gives the same error for a wrong password and an unknown address', async () => {
    // If these two differed, the response alone would enumerate every registered
    // address. They must be indistinguishable, in message and in status.
    const h = harness();
    await registerUser(h);

    const wrongPassword = await expectApiError(
      h.service.login({ email: 'user@example.com', password: 'WrongPassword123' }, CONTEXT),
    );
    const unknownUser = await expectApiError(
      h.service.login({ email: 'nobody@example.com', password: VALID_PASSWORD }, CONTEXT),
    );

    expect(wrongPassword.message).toBe(unknownUser.message);
    expect(wrongPassword.statusCode).toBe(unknownUser.statusCode);
  });

  it('spends hash time on the unknown-address path', async () => {
    const h = harness();
    await registerUser(h);
    const before = h.hasher.verifications;

    await expectApiError(
      h.service.login({ email: 'nobody@example.com', password: VALID_PASSWORD }, CONTEXT),
    ).catch(() => undefined);

    // Without this, a fast rejection would give the whole thing away.
    expect(h.hasher.timingEqualised).toBe(1);
    expect(h.hasher.verifications).toBe(before);
  });

  it('locks out after the configured number of failures and then refuses', async () => {
    const h = harness();
    await registerUser(h);

    const user = h.state.users[0];
    expect(user).toBeDefined();

    // Default threshold is 10; drive straight to it.
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const error = await expectApiError(
        h.service.login({ email: 'user@example.com', password: 'WrongPassword123' }, CONTEXT),
      );
      expect(error.statusCode).toBe(401);
    }

    const threshold = await expectApiError(
      h.service.login({ email: 'user@example.com', password: 'WrongPassword123' }, CONTEXT),
    );
    expect(threshold.statusCode).toBe(401);
    expect(user?.failedLoginCount).toBe(10);
    expect(user?.lockedUntil).not.toBeNull();

    // The very next attempt is refused even with the *correct* password, and is
    // refused as rate-limiting rather than as a bad credential.
    const locked = await expectApiError(
      h.service.login({ email: 'user@example.com', password: VALID_PASSWORD }, CONTEXT),
    );
    expect(locked.statusCode).toBe(429);
    expect(locked.code).toBe('TOO_MANY_REQUESTS');
  });

  it('clears the failure count and the lock after a successful login', async () => {
    const h = harness();
    await registerUser(h);

    await expectApiError(
      h.service.login({ email: 'user@example.com', password: 'WrongPassword123' }, CONTEXT),
    ).catch(() => undefined);

    const before = h.state.users[0]?.failedLoginCount ?? 0;
    expect(before).toBe(1);

    await h.service.login({ email: 'user@example.com', password: VALID_PASSWORD }, CONTEXT);

    expect(h.state.users[0]?.failedLoginCount).toBe(0);
    expect(h.state.users[0]?.lockedUntil).toBeNull();
    expect(h.state.users[0]?.lastLoginAt).not.toBeNull();
  });

  it('lets a lock expire', async () => {
    const h = harness();
    await registerUser(h);
    const user = h.state.users[0];

    user!.failedLoginCount = 99;
    user!.lockedUntil = new Date(h.clock.value.getTime() + 60_000);

    // Jump past the lockout window.
    h.clock.value = new Date(h.clock.value.getTime() + 61 * 60_000);

    const result = await h.service.login(
      { email: 'user@example.com', password: VALID_PASSWORD },
      CONTEXT,
    );
    expect(result.user.email).toBe('user@example.com');
  });

  it('refuses a suspended account', async () => {
    const h = harness();
    await registerUser(h);
    h.state.users[0]!.status = 'SUSPENDED';

    const error = await expectApiError(
      h.service.login({ email: 'user@example.com', password: VALID_PASSWORD }, CONTEXT),
    );
    expect(error.statusCode).toBe(403);
  });
});

describe('refresh rotation', () => {
  it('exchanges a token for a new pair and marks the old one spent', async () => {
    const h = harness();
    const login = await registerUser(h);

    const refreshed = await h.service.refresh(login.tokens.refreshToken, CONTEXT);

    // The refresh token must genuinely differ: that is what makes it single-use.
    // The access token is not compared, because two tokens minted for the same
    // user within the same second are byte-identical (JWT `iat` has one-second
    // resolution) while carrying exactly the same authority. That is a property
    // of the format, not a weakness.
    expect(refreshed.tokens.refreshToken).not.toBe(login.tokens.refreshToken);
    expect(h.state.sessions).toHaveLength(2);
    expect(h.state.sessions[0]?.rotatedAt).not.toBeNull();
  });

  it('keeps the replacement in the same family', async () => {
    const h = harness();
    const login = await registerUser(h);

    await h.service.refresh(login.tokens.refreshToken, CONTEXT);
    const first = h.state.sessions[0];
    const second = h.state.sessions[1];

    expect(first?.family.toString()).toBe(second?.family.toString());
    // The root is still the original row; the descendant is not its own root.
    expect(second?._id.toString()).not.toBe(second?.family.toString());
  });

  it('survives many consecutive rotations', async () => {
    const h = harness();
    let current = await registerUser(h);

    for (let round = 0; round < 5; round += 1) {
      current = await h.service.refresh(current.tokens.refreshToken, CONTEXT);
    }

    expect(h.state.sessions).toHaveLength(6);
    // Every lineage member shares one family id.
    const families = new Set(h.state.sessions.map((session) => session.family.toString()));
    expect(families.size).toBe(1);
  });

  it('rejects a replayed token and burns the whole family', async () => {
    // This is the core of the design: a stolen token is worth at most one use,
    // and using it logs the legitimate owner out too.
    const h = harness();
    const login = await registerUser(h);

    const attacker = await h.service.refresh(login.tokens.refreshToken, {
      ...CONTEXT,
      ip: '198.51.100.99',
    });
    expect(attacker.tokens.refreshToken).toBeTruthy();

    // The rightful owner now presents the same, already-spent token.
    const error = await expectApiError(h.service.refresh(login.tokens.refreshToken, CONTEXT));
    expect(error.statusCode).toBe(401);

    // The attacker's replacement is dead as well, so the theft bought nothing.
    const attackerRetry = await expectApiError(
      h.service.refresh(attacker.tokens.refreshToken, CONTEXT),
    );
    expect(attackerRetry.statusCode).toBe(401);
  });

  it('records reuse detection in the audit trail', async () => {
    const h = harness();
    const login = await registerUser(h);
    await h.service.refresh(login.tokens.refreshToken, CONTEXT);
    await expectApiError(h.service.refresh(login.tokens.refreshToken, CONTEXT)).catch(
      () => undefined,
    );

    expect(h.state.audit.map((entry) => entry.action)).toContain('TOKEN_REUSE_DETECTED');
  });

  it('gives one opaque error for every rejection reason', async () => {
    // Expired, replayed, unknown, malformed and mis-versioned all look the same
    // from outside, so the endpoint is not a probing oracle.
    const h = harness();
    const login = await registerUser(h);
    const messages = new Set<string>();

    // Malformed signature.
    messages.add((await expectApiError(h.service.refresh('garbage', CONTEXT))).message);
    // Valid signature, but naming a session that does not exist.
    messages.add(
      (
        await expectApiError(
          h.service.refresh(
            issueRefreshToken({ sub: SUBJECT, sid: SUBJECT, fam: SUBJECT, ver: 0 }).token,
            CONTEXT,
          ),
        )
      ).message,
    );
    // Already spent.
    await h.service.refresh(login.tokens.refreshToken, CONTEXT);
    messages.add(
      (await expectApiError(h.service.refresh(login.tokens.refreshToken, CONTEXT))).message,
    );

    expect(messages.size).toBe(1);
  });

  it('rejects an expired session', async () => {
    const h = harness();
    const login = await registerUser(h);

    // Past the refresh TTL.
    h.clock.value = new Date(h.clock.value.getTime() + 8 * 24 * 60 * 60_000);

    const error = await expectApiError(h.service.refresh(login.tokens.refreshToken, CONTEXT));
    expect(error.statusCode).toBe(401);
  });

  it('rejects a token whose session row is gone', async () => {
    const h = harness();
    const login = await registerUser(h);
    h.state.sessions = [];

    const error = await expectApiError(h.service.refresh(login.tokens.refreshToken, CONTEXT));
    expect(error.statusCode).toBe(401);
  });

  it('refuses after the user is suspended, and ends the lineage', async () => {
    const h = harness();
    const login = await registerUser(h);
    h.state.users[0]!.status = 'SUSPENDED';

    const error = await expectApiError(h.service.refresh(login.tokens.refreshToken, CONTEXT));
    expect(error.statusCode).toBe(401);
    expect(h.state.sessions.every((session) => session.revokedAt !== null)).toBe(true);
  });

  it('refuses a token minted before the user version was bumped', async () => {
    // `tokenVersion` is the single-knob kill switch: one increment retires every
    // outstanding refresh token without hunting them down.
    const h = harness();
    const login = await registerUser(h);
    h.state.users[0]!.tokenVersion += 1;

    const error = await expectApiError(h.service.refresh(login.tokens.refreshToken, CONTEXT));
    expect(error.statusCode).toBe(401);
  });

  it('mints a replacement carrying the new version', async () => {
    // Guards the off-by-one that would make a post-password-change token fail
    // its own version check on first use.
    const h = harness();
    const registered = await registerUser(h);
    const userId = registered.user.id;
    const user = h.state.users.find((candidate) => candidate._id.toString() === userId)!;

    const changed = await h.service.changePassword(
      userId,
      VALID_PASSWORD,
      'AnotherStrongPass7',
      CONTEXT,
    );

    const claims = verifyRefreshToken(changed.tokens.refreshToken);
    expect(claims.ver).toBe(user.tokenVersion);
  });
});

describe('logout', () => {
  it('revokes a single session and leaves the others alone', async () => {
    const h = harness();
    const phone = await registerUser(h, 'a@example.com');
    await h.service.login({ email: 'a@example.com', password: VALID_PASSWORD }, CONTEXT);

    const sessions = await h.service.listSessions(phone.user.id);
    expect(sessions).toHaveLength(2);

    await h.service.logout(sessions[0]!.id, CONTEXT);

    const remaining = await h.service.listSessions(phone.user.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(sessions[1]?.id);
  });

  it('revokes every session for a user', async () => {
    const h = harness();
    const result = await registerUser(h);
    await h.service.login({ email: result.user.email, password: VALID_PASSWORD }, CONTEXT);

    const revoked = await h.service.logoutAll(result.user.id, CONTEXT);

    expect(revoked).toBe(2);
    expect(await h.service.listSessions(result.user.id)).toHaveLength(0);
  });

  it('makes logout idempotent', async () => {
    const h = harness();
    const result = await registerUser(h);
    const sessions = await h.service.listSessions(result.user.id);

    await h.service.logout(sessions[0]!.id, CONTEXT);
    // Revoking twice must not throw; the second call simply affects nothing.
    await expect(h.service.logout(sessions[0]!.id, CONTEXT)).resolves.toBeUndefined();
  });
});

describe('session listing', () => {
  it('lists every active session for the user', async () => {
    const h = harness();
    const first = await registerUser(h);
    await h.service.login({ email: first.user.email, password: VALID_PASSWORD }, CONTEXT);

    const sessions = await h.service.listSessions(first.user.id);

    expect(sessions).toHaveLength(2);
    expect(sessions.every((session) => session.current === false)).toBe(true);
  });

  it('marks the supplied session as current and labels lineage', async () => {
    const h = harness();
    const first = await registerUser(h);
    const refreshed = await h.service.refresh(first.tokens.refreshToken, CONTEXT);
    const currentId = verifyRefreshToken(refreshed.tokens.refreshToken).sid;

    const sessions = await h.service.listSessions(first.user.id, currentId);

    expect(sessions).toHaveLength(2);
    // Exactly one row is flagged, and it is the one the caller arrived on.
    expect(sessions.filter((session) => session.current)).toHaveLength(1);
    expect(sessions.find((session) => session.current)?.id).toBe(currentId);
    // The sign-in token is its own family root; its replacement is not.
    expect(sessions.map((session) => session.kind).sort()).toEqual(['primary', 'rotated']);
  });

  it('excludes expired and revoked sessions', async () => {
    const h = harness();
    const result = await registerUser(h);
    await h.service.logoutAll(result.user.id, CONTEXT);

    expect(await h.service.listSessions(result.user.id)).toHaveLength(0);
  });

  it('carries no token material at all', async () => {
    const h = harness();
    const result = await registerUser(h);

    const serialised = JSON.stringify(await h.service.listSessions(result.user.id));
    expect(serialised).not.toContain(result.tokens.refreshToken);
    expect(serialised).not.toContain('tokenHash');
  });
});

describe('revokeSession', () => {
  it('revokes a session the caller owns', async () => {
    const h = harness();
    const result = await registerUser(h);
    const sessions = await h.service.listSessions(result.user.id);

    await h.service.revokeSession(result.user.id, sessions[0]!.id, CONTEXT);

    expect(await h.service.listSessions(result.user.id)).toHaveLength(0);
  });

  it('answers 404, not 403, for a session belonging to someone else', async () => {
    // A 403 would confirm the id exists, turning the endpoint into a way to probe
    // other people's sessions.
    const h = harness();
    const mine = await registerUser(h, 'mine@example.com');
    const theirs = await registerUser(h, 'theirs@example.com');

    const theirSession = (await h.service.listSessions(theirs.user.id))[0]!;

    const error = await expectApiError(
      h.service.revokeSession(mine.user.id, theirSession.id, CONTEXT),
    );
    expect(error.statusCode).toBe(404);
  });
});

describe('changePassword', () => {
  it('replaces the hash, ends all sessions, and signs the caller back in', async () => {
    const h = harness();
    const result = await registerUser(h);
    const user = h.state.users[0]!;
    const oldHash = user.passwordHash;

    const changed = await h.service.changePassword(
      result.user.id,
      VALID_PASSWORD,
      'AnotherStrongPass7',
      CONTEXT,
    );

    expect(user.passwordHash).not.toBe(oldHash);
    expect(user.tokenVersion).toBe(1);
    // Only the brand new session is alive; the original is gone.
    expect(await h.service.listSessions(result.user.id)).toHaveLength(1);
    expect(changed.tokens.refreshToken).toBeTruthy();
  });

  it('rejects a wrong current password', async () => {
    const h = harness();
    const result = await registerUser(h);

    const error = await expectApiError(
      h.service.changePassword(result.user.id, 'NotThePassword1', 'AnotherStrongPass7', CONTEXT),
    );
    expect(error.statusCode).toBe(401);
  });

  it('invalidates the old password', async () => {
    const h = harness();
    const result = await registerUser(h);
    await h.service.changePassword(result.user.id, VALID_PASSWORD, 'AnotherStrongPass7', CONTEXT);

    const error = await expectApiError(
      h.service.login({ email: result.user.email, password: VALID_PASSWORD }, CONTEXT),
    );
    expect(error.statusCode).toBe(401);

    await expect(
      h.service.login({ email: result.user.email, password: 'AnotherStrongPass7' }, CONTEXT),
    ).resolves.toBeTruthy();
  });

  it('signs out every other device', async () => {
    const h = harness();
    const first = await registerUser(h);
    await h.service.login({ email: first.user.email, password: VALID_PASSWORD }, CONTEXT);

    await h.service.changePassword(
      first.user.id,
      VALID_PASSWORD,
      'AnotherStrongPass7',
      CONTEXT,
    );

    // Exactly one session remains: the one just issued for this request.
    const sessions = await h.service.listSessions(first.user.id);
    expect(sessions).toHaveLength(1);
  });
});

describe('audit resilience', () => {
  it('still signs a user in when the audit write fails', async () => {
    // Losing the trail is bad. Refusing a legitimate login because logging broke
    // is worse, and a thrown audit error must not become a 500 on the login path.
    const built = createHarness();
    const service = createAuthService({
      ...built.deps,
      audit: {
        write() {
          return Promise.reject(new Error('audit store is down'));
        },
      },
    });

    await service.register(
      { email: 'user@example.com', password: VALID_PASSWORD, displayName: 'U', locale: 'en' },
      CONTEXT,
    );
    const result = await service.login(
      { email: 'user@example.com', password: VALID_PASSWORD },
      CONTEXT,
    );

    expect(result.tokens.accessToken).toBeTruthy();
  });
});

describe('concurrent refresh', () => {
  it('lets only one of two simultaneous redemptions of the same token through', async () => {
    // A double-submit refresh is what a browser retry looks like. The loser must
    // be rejected as a replay rather than both succeeding, or rotation buys
    // nothing.
    const h = harness();
    const login = await registerUser(h);

    const [first, second] = await Promise.allSettled([
      h.service.refresh(login.tokens.refreshToken, CONTEXT),
      h.service.refresh(login.tokens.refreshToken, CONTEXT),
    ]);

    const fulfilled = [first, second].filter((outcome) => outcome.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
  });
});
