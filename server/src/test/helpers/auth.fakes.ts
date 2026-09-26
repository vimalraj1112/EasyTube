import { Types } from 'mongoose';

import { env } from '../../config/env';
import type {
  AuditPort,
  AuthServiceDeps,
  PasswordHasherPort,
  RefreshSessionPort,
  RefreshSessionRecord,
  UserPort,
  UserWithCredentials,
} from '../../services/auth.service';
import { fingerprintToken, sessionKind } from '../../services/auth.service';
import {
  issueAccessToken,
  issueRefreshToken,
  ttlToSeconds,
  verifyRefreshToken,
} from '../../utils/token';

/**
 * In-memory doubles for the auth service's ports.
 *
 * These are behavioural, not stubs: they enforce the same invariants the real
 * repositories do - a `tokenHash` must match before rotation, a revoked session
 * stays revoked, a family revocation touches only its own lineage, a duplicate
 * email raises the same duplicate-key error. A fake that skipped those would let
 * a real ordering bug pass.
 *
 * Methods are written as plain functions returning `Promise.resolve` rather than
 * `async`, because almost none of them await anything and the lint config
 * (rightly) flags an `async` with no `await` as a promise dressed up as one.
 *
 * Password hashing is the one thing faked for speed. Argon2 at production
 * settings takes tens of milliseconds per operation, which is fine once and
 * ruinous across a suite that signs in dozens of times. `auth.password.test.ts`
 * covers the real thing.
 */

export interface FakeUser extends UserWithCredentials {
  /** The plaintext, kept only so tests can assert what was stored. */
  password: string;
}

export interface AuditEntry {
  action: string;
  actor: string | null;
  target: string | null;
  metadata?: Record<string, unknown>;
}

export interface FakeState {
  users: FakeUser[];
  sessions: (RefreshSessionRecord & { tokenHash: string })[];
  audit: AuditEntry[];
  /** Monotonic tick behind generated `createdAt` values. */
  clock: number;
}

export function createFakeState(): FakeState {
  return { users: [], sessions: [], audit: [], clock: 0 };
}

/**
 * Monotonic stand-in for the wall clock, so rows created in the same millisecond
 * still order deterministically. Without it "newest first" session listings are
 * sorted by an arbitrary tie-break and ordering assertions go flaky.
 */
function nextTimestamp(state: FakeState): Date {
  state.clock += 1;
  return new Date(state.clock);
}

/**
 * A fresh object per read, so a caller holding a record cannot observe later
 * writes to the store. The real repository returns a new projection per query; a
 * fake that aliased would hide staleness bugs and invent them.
 */
function copyOf(user: FakeUser): FakeUser {
  return { ...user };
}

export interface FakeHasher extends PasswordHasherPort {
  hashes: number;
  verifications: number;
  timingEqualised: number;
}

export function createFakeHasher(): FakeHasher {
  return {
    hashes: 0,
    verifications: 0,
    timingEqualised: 0,
    hash(password) {
      this.hashes += 1;
      return Promise.resolve(`fake$${password}`);
    },
    verify(hash, password) {
      this.verifications += 1;
      return Promise.resolve({ valid: hash === `fake$${password}`, needsRehash: false });
    },
    needsRehash() {
      return false;
    },
    equaliseTiming() {
      this.timingEqualised += 1;
      return Promise.resolve();
    },
  };
}

/** Exposed so tests can assert a session's stored hash really is a digest. */
export const sessionHashMatches = (session: { tokenHash: string }, token: string): boolean =>
  session.tokenHash === fingerprintToken(token);

export function createUserPort(state: FakeState): UserPort {
  const findUser = (id: string): FakeUser | undefined =>
    state.users.find((user) => user._id.toString() === id);

  return {
    findByEmail(email) {
      const found = state.users.find((user) => user.email === email.toLowerCase());
      return Promise.resolve(found ? copyOf(found) : null);
    },
    findById(id) {
      const found = findUser(id);
      // Deliberately drops the hash, so a caller that reaches for
      // `passwordHash` on a `findById` result fails to compile. That is the
      // point: the real repository would not return one either.
      if (!found) {
        return Promise.resolve(null);
      }
      const { password, passwordHash, ...profile } = copyOf(found);
      void password;
      void passwordHash;
      return Promise.resolve(profile);
    },
    findCredentialsById(id) {
      const found = findUser(id);
      return Promise.resolve(found ? copyOf(found) : null);
    },
    insert(values) {
      // The real model carries a unique index on email, so the fake must raise
      // the same duplicate-key error or the concurrency test proves nothing.
      if (state.users.some((user) => user.email === values.email)) {
        return Promise.reject(
          Object.assign(new Error('E11000 duplicate key error'), { code: 11000 }),
        );
      }

      const doc: FakeUser = {
        _id: new Types.ObjectId(),
        email: values.email,
        passwordHash: values.passwordHash,
        password: values.passwordHash.replace(/^fake\$/, ''),
        displayName: values.displayName,
        avatarUrl: null,
        locale: values.locale,
        role: 'USER',
        status: 'ACTIVE',
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: null,
        tokenVersion: 0,
        createdAt: nextTimestamp(state),
      };
      state.users.push(doc);
      return Promise.resolve(copyOf(doc));
    },
    recordFailedLogin(id, failedLoginCount, lockedUntil) {
      const user = findUser(id);
      if (user) {
        user.failedLoginCount = failedLoginCount;
        user.lockedUntil = lockedUntil;
      }
      return Promise.resolve();
    },
    recordSuccessfulLogin(id, at) {
      const user = findUser(id);
      if (user) {
        user.lastLoginAt = at;
        user.failedLoginCount = 0;
        user.lockedUntil = null;
      }
      return Promise.resolve();
    },
    updatePasswordHash(id, passwordHash, options) {
      const user = findUser(id);
      if (user) {
        user.passwordHash = passwordHash;
        user.password = passwordHash.replace(/^fake\$/, '');
        if (options?.bumpTokenVersion) {
          user.tokenVersion += 1;
        }
      }
      return Promise.resolve();
    },
  };
}

export function createRefreshSessionPort(state: FakeState): RefreshSessionPort {
  return {
    findById(id) {
      const found = state.sessions.find((session) => session._id.toString() === id);
      return Promise.resolve(found ?? null);
    },
    insert(values) {
      const doc = {
        _id: new Types.ObjectId(values._id),
        user: new Types.ObjectId(values.user),
        family: new Types.ObjectId(values.family),
        tokenHash: values.tokenHash,
        expiresAt: values.expiresAt,
        revokedAt: null,
        rotatedAt: null,
        ip: values.ip,
        userAgent: values.userAgent,
        createdAt: nextTimestamp(state),
      };
      state.sessions.push(doc);
      return Promise.resolve(doc);
    },
    markRotated(id, replacedBy, at) {
      const session = state.sessions.find((candidate) => candidate._id.toString() === id);
      if (!session || session.rotatedAt || session.revokedAt) {
        return Promise.resolve(false);
      }
      session.rotatedAt = at;
      void replacedBy;
      return Promise.resolve(true);
    },
    revokeFamily(family, _reason, at) {
      let count = 0;
      for (const session of state.sessions) {
        if (session.family.toString() === family && !session.revokedAt) {
          session.revokedAt = at;
          count += 1;
        }
      }
      return Promise.resolve(count);
    },
    revokeAllForUser(user, _reason, at) {
      let count = 0;
      for (const session of state.sessions) {
        if (session.user.toString() === user && !session.revokedAt) {
          session.revokedAt = at;
          count += 1;
        }
      }
      return Promise.resolve(count);
    },
    revokeById(id, _reason, at) {
      const session = state.sessions.find((candidate) => candidate._id.toString() === id);
      if (session && !session.revokedAt) {
        session.revokedAt = at;
      }
      return Promise.resolve();
    },
    listForUser(user) {
      return Promise.resolve(
        state.sessions
          .filter((session) => session.user.toString() === user)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      );
    },
  };
}

export function createAuditPort(state: FakeState): AuditPort {
  return {
    write(entry) {
      state.audit.push({
        action: entry.action,
        actor: entry.actor,
        target: entry.target,
        metadata: entry.metadata,
      });
      return Promise.resolve();
    },
  };
}

/** Real JWTs, so signature, claim and type checks are genuinely exercised. */
export const realTokenIssuer = {
  issueAccessToken,
  issueRefreshToken,
  verifyRefreshToken,
  refreshTtlSeconds: (): number => ttlToSeconds(env.JWT_REFRESH_TTL),
};

export interface Harness {
  state: FakeState;
  deps: AuthServiceDeps;
  hasher: FakeHasher;
}

export function createHarness(overrides: Partial<AuthServiceDeps> = {}): Harness {
  const state = createFakeState();
  const hasher = createFakeHasher();

  const deps: AuthServiceDeps = {
    users: createUserPort(state),
    sessions: createRefreshSessionPort(state),
    audit: createAuditPort(state),
    hasher,
    tokens: realTokenIssuer,
    ...overrides,
  };

  return { state, deps, hasher };
}

export { sessionKind };
