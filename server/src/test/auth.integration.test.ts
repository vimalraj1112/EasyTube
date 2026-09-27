import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseManager } from '../config/database';
import { AUDIT_ACTIONS, REVOKED_REASONS } from '../config/constants';
import { env } from '../config/env';
import { AuditLog, RefreshSession, User, syncModelIndexes } from '../models';
import { createAuthModule } from '../services/auth.module';
import { createAuthService, type AuthService } from '../services/auth.service';
import { createAuditRepository } from '../repositories/audit.repository';
import { createRefreshSessionRepository } from '../repositories/refresh-session.repository';
import { createUserRepository } from '../repositories/user.repository';
import { verifyRefreshToken } from '../utils/token';

/**
 * Auth against a real mongod: real indexes, real unique constraints, real
 * compare-and-set updates, real Argon2.
 *
 * The unit suites deliberately fake the datastores, which means the things most
 * worth breaking are exactly the things they cannot see. Whether the unique index
 * on `email` really rejects a duplicate depends on the index existing. Whether
 * `markRotated` is atomic depends on Mongo's `updateOne` filter semantics. Whether
 * the TTL index is declared correctly cannot be checked at all in memory. This
 * suite is where those are actually verified.
 *
 * Skipped by default so `npm test` stays hermetic. Start the datastore and run:
 *
 *   npm run test:integration
 *
 * IMPORTANT: this suite points itself at a throwaway database (`easytube_auth_test`
 * by default) and drops it on the way out. It must never be pointed at the
 * application database, or `dropDatabase()` would delete real data.
 */
const RUN = process.env.RUN_INTEGRATION_TESTS === 'true';

const TEST_DB = process.env.MONGODB_AUTH_TEST_DB ?? 'easytube_auth_test';
const MONGODB_URI = `${process.env.MONGODB_TEST_BASE ?? 'mongodb://127.0.0.1:27017'}/${TEST_DB}`;

if (RUN && MONGODB_URI === env.MONGODB_URI) {
  throw new Error(
    `MONGODB_TEST_URI resolves to the application database (${MONGODB_URI}). ` +
      'Refusing to run, because this suite drops the database it connects to.',
  );
}

const PASSWORD = 'CorrectHorseBattery9';
const OTHER_PASSWORD = 'AnotherGoodPassword7';
const CONTEXT = { ip: '203.0.113.10', userAgent: 'integration-test', requestId: 'req-1' };

describe.skipIf(!RUN)('auth integration', () => {
  const database = createDatabaseManager(mongoose, { uri: MONGODB_URI, retryBaseDelayMs: 0 });

  beforeAll(async () => {
    await database.connect();
    expect(mongoose.connection.name).toBe(TEST_DB);
    await mongoose.connection.dropDatabase();
    // The unique and TTL constraints are the point of this suite, so the indexes
    // have to be real rather than declared-and-assumed.
    await syncModelIndexes();
  }, 60_000);

  afterEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      RefreshSession.deleteMany({}),
      AuditLog.deleteMany({}),
    ]);
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await database.disconnect();
  }, 30_000);

  const service = (): AuthService => createAuthModule().service;

  describe('user repository', () => {
    it('stores the password hashed and never returns it by default', async () => {
      const users = createUserRepository();
      const created = await users.insert({
        email: 'hash@example.com',
        passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$abc$def',
        displayName: 'Hash Check',
        locale: 'en',
      });

      const byId = await users.findById(created._id.toString());
      // The repository's own projection cannot include the secret even by
      // accident, so this is `undefined` rather than absent-from-the-type.
      expect(byId).not.toBeNull();
      expect(byId && 'passwordHash' in byId).toBe(false);

      const credentials = await users.findCredentialsById(created._id.toString());
      expect(credentials?.passwordHash).toBe('$argon2id$v=19$m=19456,t=2,p=1$abc$def');
    });

    it('refuses a duplicate email at the database, not only in the service', async () => {
      const users = createUserRepository();
      const values = {
        email: 'dupe@example.com',
        passwordHash: 'hash',
        displayName: 'First',
        locale: 'en',
      };
      await users.insert(values);

      // The service checks for an existing user first, but two concurrent
      // registrations can both pass that check. Only the unique index settles it,
      // which is why this asserts the driver's own error code.
      await expect(users.insert(values)).rejects.toMatchObject({ code: 11000 });
    });

    it('hides a soft-deleted user from both lookups', async () => {
      const users = createUserRepository();
      const created = await users.insert({
        email: 'deleted@example.com',
        passwordHash: 'hash',
        displayName: 'Deleted',
        locale: 'en',
      });

      await User.updateOne({ _id: created._id }, { $set: { deletedAt: new Date() } }).exec();

      await expect(users.findByEmail('deleted@example.com')).resolves.toBeNull();
      await expect(users.findCredentialsById(created._id.toString())).resolves.toBeNull();
    });

    it('rejects a malformed id without reaching the driver', async () => {
      const users = createUserRepository();
      await expect(users.findById('not-an-object-id')).resolves.toBeNull();
      await expect(users.findCredentialsById('not-an-object-id')).resolves.toBeNull();
    });

    it('bumps tokenVersion only when asked, and records lockout state', async () => {
      const users = createUserRepository();
      const created = await users.insert({
        email: 'version@example.com',
        passwordHash: 'first',
        displayName: 'Version',
        locale: 'en',
      });
      const id = created._id.toString();

      await users.updatePasswordHash(id, 'second');
      const transparent = await users.findById(id);
      // The non-credential lookup does not even carry the field, so there is
      // nothing for a later refactor to accidentally log.
      expect(transparent !== null && 'passwordHash' in transparent).toBe(false);

      const credentials = await users.findCredentialsById(id);
      expect(credentials?.passwordHash).toBe('second');
      // A cost upgrade must not sign anyone out.
      expect(credentials?.tokenVersion).toBe(0);

      await users.updatePasswordHash(id, 'third', { bumpTokenVersion: true });
      const bumped = await users.findCredentialsById(id);
      expect(bumped?.passwordHash).toBe('third');
      expect(bumped?.tokenVersion).toBe(1);

      const until = new Date(Date.now() + 60_000);
      await users.recordFailedLogin(id, 3, until);
      const locked = await users.findById(id);
      expect(locked?.failedLoginCount).toBe(3);
      expect(locked?.lockedUntil).toEqual(until);

      await users.recordSuccessfulLogin(id, new Date());
      const cleared = await users.findById(id);
      expect(cleared?.failedLoginCount).toBe(0);
      expect(cleared?.lockedUntil).toBeNull();
    });
  });

  describe('refresh session repository', () => {
    async function seedSession(
      userId: string,
      over: Partial<{ family: string }> = {},
    ): Promise<string> {
      const id = new mongoose.Types.ObjectId().toString();
      await createRefreshSessionRepository().insert({
        _id: id,
        user: userId,
        tokenHash: `hash-${id}`,
        family: over.family ?? id,
        expiresAt: new Date(Date.now() + 86_400_000),
        ip: '203.0.113.10',
        userAgent: 'integration-test',
      });
      return id;
    }

    async function seedUser(email: string): Promise<string> {
      const created = await createUserRepository().insert({
        email,
        passwordHash: 'hash',
        displayName: 'Session Owner',
        locale: 'en',
      });
      return created._id.toString();
    }

    it('stores only the token hash, and the unique index rejects a repeat', async () => {
      const userId = await seedUser('session@example.com');
      const id = await seedSession(userId);
      const sessions = createRefreshSessionRepository();

      const found = await sessions.findById(id);
      expect(found?.tokenHash).toBe(`hash-${id}`);
      // The raw token is never a field, so it cannot be recovered from a dump.
      const raw = await RefreshSession.findById(id).lean().exec();
      expect(Object.keys(raw ?? {})).not.toContain('tokenHash');

      await expect(
        sessions.insert({
          _id: new mongoose.Types.ObjectId().toString(),
          user: userId,
          tokenHash: `hash-${id}`,
          family: new mongoose.Types.ObjectId().toString(),
          expiresAt: new Date(Date.now() + 86_400_000),
          ip: null,
          userAgent: null,
        }),
      ).rejects.toMatchObject({ code: 11000 });
    });

    it('lets exactly one caller claim a session for rotation', async () => {
      const userId = await seedUser('cas@example.com');
      const id = await seedSession(userId);
      const sessions = createRefreshSessionRepository();
      const replacement = new mongoose.Types.ObjectId().toString();
      const at = new Date();

      // Two simultaneous redemptions of the same token, as a replay attack or a
      // double-submit would produce. The compare-and-set must let exactly one win.
      const [first, second] = await Promise.all([
        sessions.markRotated(id, replacement, at),
        sessions.markRotated(id, replacement, at),
      ]);

      expect([first, second].filter(Boolean)).toHaveLength(1);

      const stored = await RefreshSession.findById(id).exec();
      expect(stored?.rotatedAt).not.toBeNull();
      expect(stored?.replacedBy?.toString()).toBe(replacement);

      // And a later claim cannot come back for it.
      await expect(sessions.markRotated(id, replacement, at)).resolves.toBe(false);
    });

    it('revokes a whole family without touching its neighbours', async () => {
      const userId = await seedUser('family@example.com');
      const sessions = createRefreshSessionRepository();
      const family = new mongoose.Types.ObjectId().toString();
      const otherFamily = new mongoose.Types.ObjectId().toString();

      const a = await seedSession(userId, { family });
      const b = await seedSession(userId, { family });
      const unrelated = await seedSession(userId, { family: otherFamily });
      const at = new Date();

      const revoked = await sessions.revokeFamily(family, REVOKED_REASONS.ROTATED, at);
      expect(revoked).toBe(2);

      const rows = await RefreshSession.find({ user: userId }).lean().exec();
      const byId = new Map(rows.map((row) => [row._id.toString(), row]));
      expect(byId.get(a)?.revokedAt).toEqual(at);
      expect(byId.get(b)?.revokedAt).toEqual(at);
      expect(byId.get(unrelated)?.revokedAt).toBeNull();
    });

    it('counts only the sessions it actually changed', async () => {
      const userId = await seedUser('counting@example.com');
      const sessions = createRefreshSessionRepository();
      const family = new mongoose.Types.ObjectId().toString();
      await seedSession(userId, { family });
      await seedSession(userId);

      expect(await sessions.revokeAllForUser(userId, REVOKED_REASONS.LOGOUT_ALL, new Date())).toBe(
        2,
      );
      // Revoking again changes nothing, so the number is a true delta - which is
      // what lets `logout-all` report "ended 2 sessions" honestly.
      expect(await sessions.revokeAllForUser(userId, REVOKED_REASONS.LOGOUT_ALL, new Date())).toBe(
        0,
      );
    });
  });

  describe('indexes the service depends on', () => {
    async function indexNames(collection: string): Promise<string[]> {
      const indexes = await mongoose.connection.collection(collection).indexes();
      return indexes.map((index) => index.name).filter((name): name is string => Boolean(name));
    }

    it('declares unique email and unique token hash', async () => {
      expect(await indexNames('users')).toContain('users_email_unique');
      expect(await indexNames('refresh_sessions')).toContain('refresh_token_hash_unique');
    });

    it('declares the expiry TTL that keeps spent rows from accumulating', async () => {
      const indexes = await mongoose.connection.collection('refresh_sessions').indexes();
      const ttl = indexes.find((index) => index.name === 'refresh_expiry_ttl');

      expect(ttl).toBeDefined();
      expect(ttl?.expireAfterSeconds).toBe(0);
    });
  });

  describe('service over real datastores', () => {
    it('signs in, rotates, and stores only digests of the tokens', async () => {
      const auth = service();
      const registered = await auth.register(
        { email: 'Flow@Example.com', password: PASSWORD, displayName: 'Flow User', locale: 'en' },
        CONTEXT,
      );

      const login = await auth.login({ email: 'flow@example.com', password: PASSWORD }, CONTEXT);
      expect(login.user.id).toBe(registered.user.id);
      // The stored row is the digest, never the token the client holds.
      const stored = await RefreshSession.findOne({ user: registered.user.id }).lean().exec();
      expect(stored).not.toBeNull();
      expect(JSON.stringify(stored)).not.toContain(login.tokens.refreshToken);

      const rotated = await auth.refresh(login.tokens.refreshToken, CONTEXT);
      expect(rotated.tokens.refreshToken).not.toBe(login.tokens.refreshToken);

      // One row each for the sign-up, the sign-in and the refresh of that
      // sign-in; the spent one is marked rather than removed, so the lineage of a
      // stolen token stays inspectable.
      const rows = await RefreshSession.find({ user: registered.user.id }).lean().exec();
      expect(rows).toHaveLength(3);
      expect(rows.filter((row) => row.rotatedAt !== null)).toHaveLength(1);
    });

    it('burns the family when a rotated token is replayed', async () => {
      const auth = service();
      const registered = await auth.register(
        {
          email: 'replay@example.com',
          password: PASSWORD,
          displayName: 'Replay User',
          locale: 'en',
        },
        CONTEXT,
      );
      const rotated = await auth.refresh(registered.tokens.refreshToken, CONTEXT);

      // The original token, already spent, presented again.
      await expect(auth.refresh(registered.tokens.refreshToken, CONTEXT)).rejects.toMatchObject({
        statusCode: 401,
      });

      // Its replacement dies with it: theft of one token buys nothing.
      await expect(auth.refresh(rotated.tokens.refreshToken, CONTEXT)).rejects.toMatchObject({
        statusCode: 401,
      });
      const live = await RefreshSession.countDocuments({
        user: registered.user.id,
        revokedAt: null,
      });
      expect(live).toBe(0);
    });

    it('ends every other session when the password changes', async () => {
      const auth = service();
      const registered = await auth.register(
        {
          email: 'change@example.com',
          password: PASSWORD,
          displayName: 'Change User',
          locale: 'en',
        },
        CONTEXT,
      );
      // A second device.
      const phone = await auth.login({ email: 'change@example.com', password: PASSWORD }, CONTEXT);
      const phoneSession = verifyRefreshToken(phone.tokens.refreshToken).sid;

      const result = await auth.changePassword(
        registered.user.id,
        PASSWORD,
        OTHER_PASSWORD,
        CONTEXT,
      );

      // The new session works.
      await expect(auth.refresh(result.tokens.refreshToken, CONTEXT)).resolves.toMatchObject({
        user: { id: registered.user.id },
      });
      // The old password does not.
      await expect(
        auth.login({ email: 'change@example.com', password: PASSWORD }, CONTEXT),
      ).rejects.toMatchObject({ statusCode: 401 });
      // And the other device is signed out, even though it never presented the
      // old token to the changed password.
      await expect(auth.refresh(phone.tokens.refreshToken, CONTEXT)).rejects.toMatchObject({
        statusCode: 401,
      });

      const rows = await RefreshSession.find({ user: registered.user.id }).lean().exec();
      expect(rows.find((row) => row._id.toString() === phoneSession)?.revokedAt).not.toBeNull();
    });

    it('locks an account out after repeated failures, then admits the right password', async () => {
      // Real repositories, real service, real lockout bookkeeping - but a fast
      // hasher, so the suite does not spend its budget on a dozen deliberately
      // wrong Argon2 hashes. The hashing itself is covered by the password suite.
      const fastHasher = {
        hash: (password: string) => Promise.resolve(`fast$${password}`),
        verify: (hash: string, password: string) =>
          Promise.resolve({ valid: hash === `fast$${password}`, needsRehash: false }),
        needsRehash: () => false,
        equaliseTiming: () => Promise.resolve(),
      };
      const auth = createAuthService({
        users: createUserRepository(),
        sessions: createRefreshSessionRepository(),
        audit: createAuditRepository(),
        hasher: fastHasher,
      });
      const registered = await auth.register(
        {
          email: 'lockout@example.com',
          password: PASSWORD,
          displayName: 'Lockout User',
          locale: 'en',
        },
        CONTEXT,
      );

      for (let attempt = 0; attempt < env.AUTH_MAX_FAILED_LOGINS; attempt += 1) {
        await expect(
          auth.login({ email: 'lockout@example.com', password: 'WrongPassword1' }, CONTEXT),
        ).rejects.toMatchObject({ statusCode: 401 });
      }

      const locked = await createUserRepository().findById(registered.user.id);
      expect(locked?.failedLoginCount).toBe(env.AUTH_MAX_FAILED_LOGINS);
      expect(locked?.lockedUntil?.getTime()).toBeGreaterThan(Date.now());

      // The correct password is refused too, while the lock stands.
      await expect(
        auth.login({ email: 'lockout@example.com', password: PASSWORD }, CONTEXT),
      ).rejects.toMatchObject({ statusCode: 429 });

      // Once the lock expires the account is usable again, and the counter resets.
      await User.updateOne(
        { _id: registered.user.id },
        { $set: { lockedUntil: new Date(Date.now() - 1_000) } },
      ).exec();
      await expect(
        auth.login({ email: 'lockout@example.com', password: PASSWORD }, CONTEXT),
      ).resolves.toMatchObject({ user: { id: registered.user.id } });
      const recovered = await createUserRepository().findById(registered.user.id);
      expect(recovered?.failedLoginCount).toBe(0);
      expect(recovered?.lockedUntil).toBeNull();
    });

    it('writes an audit trail that names the action, actor and request', async () => {
      const auth = service();
      const registered = await auth.register(
        { email: 'audit@example.com', password: PASSWORD, displayName: 'Audit User', locale: 'en' },
        CONTEXT,
      );

      const entry = await AuditLog.findOne({ action: AUDIT_ACTIONS.USER_REGISTERED }).lean().exec();
      expect(entry).not.toBeNull();
      expect(entry?.actor?.toString()).toBe(registered.user.id);
      expect(entry?.requestId).toBe(CONTEXT.requestId);
      expect(entry?.ip).toBe(CONTEXT.ip);
      expect(entry?.userAgent).toBe(CONTEXT.userAgent);
    });
  });
});
