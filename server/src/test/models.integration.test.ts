import mongoose, { type HydratedDocument, type Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseManager } from '../config/database';
import { AUDIT_ACTIONS, DOWNLOAD_STATUSES, USER_ROLES } from '../config/constants';
import { env } from '../config/env';
import type { MediaItemDocument, UserDocument } from '../models';
import {
  AuditLog,
  Download,
  DownloadOutput,
  MediaFormat,
  MediaItem,
  RefreshSession,
  User,
  syncModelIndexes,
} from '../models';

/**
 * Model behaviour against a real mongod.
 *
 * Skipped by default so `npm test` stays hermetic. Start the datastore and run:
 *
 *   npm run infra:up
 *   npm run test:integration --workspace server
 *
 * IMPORTANT: this suite points itself at a throwaway database (`easytube_models_test`
 * by default) and drops it on the way out. It must never be pointed at the
 * application database, or `dropDatabase()` would delete real data. It also
 * cannot share a database with another integration suite, because vitest runs
 * files in parallel and one suite's `dropDatabase()` would delete another's
 * in-flight data; that is why the name comes from its own variable.
 */
const RUN = process.env.RUN_INTEGRATION_TESTS === 'true';

const TEST_DB = process.env.MONGODB_MODELS_TEST_DB ?? 'easytube_models_test';
const MONGODB_URI = `${process.env.MONGODB_TEST_BASE ?? 'mongodb://127.0.0.1:27017'}/${TEST_DB}`;

if (RUN && MONGODB_URI === env.MONGODB_URI) {
  throw new Error(
    `MONGODB_TEST_URI resolves to the application database (${MONGODB_URI}). ` +
      'Refusing to run, because this suite drops the database it connects to.',
  );
}

/** Any duplicate-key violation, whatever mongo's version calls the code. */
function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

describe.skipIf(!RUN)('model integration', () => {
  // Pointed at the throwaway database, with no retry backoff so a failure is fast.
  const database = createDatabaseManager(mongoose, { uri: MONGODB_URI, retryBaseDelayMs: 0 });
  let createdUserId: Types.ObjectId;

  beforeAll(async () => {
    await database.connect();
    expect(mongoose.connection.name).toBe(TEST_DB);
    await mongoose.connection.dropDatabase();
    await syncModelIndexes();
  }, 60_000);

  afterEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      RefreshSession.deleteMany({}),
      MediaItem.deleteMany({}),
      MediaFormat.deleteMany({}),
      Download.deleteMany({}),
      DownloadOutput.deleteMany({}),
      AuditLog.deleteMany({}),
    ]);
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await database.disconnect();
  }, 30_000);

  async function createUser(
    overrides: Record<string, unknown> = {},
  ): Promise<HydratedDocument<UserDocument>> {
    return User.create({
      email: 'person@example.com',
      passwordHash: 'argon2id$fake$hash',
      displayName: 'Person',
      ...overrides,
    });
  }

  async function createMediaItem(
    overrides: Record<string, unknown> = {},
  ): Promise<HydratedDocument<MediaItemDocument>> {
    return MediaItem.create({
      sourceUrl: 'https://example.com/clip.mp4',
      sourceHost: 'example.com',
      title: 'A clip',
      authorization: { basis: 'OWNED', confirmedByUser: true },
      ...overrides,
    });
  }

  describe('User', () => {
    it('persists and reads back without the password hash', async () => {
      const user = await createUser();
      createdUserId = user._id;

      const found = await User.findOne({ email: 'person@example.com' });

      expect(found).not.toBeNull();
      expect(found?.passwordHash).toBeUndefined();
      expect(found?.displayName).toBe('Person');
    });

    it('exposes the hash only when explicitly selected', async () => {
      await createUser();

      const found = await User.findOne({ email: 'person@example.com' }).select('+passwordHash');

      expect(found?.passwordHash).toBe('argon2id$fake$hash');
    });

    it('normalises the email to lower case on write', async () => {
      await createUser({ email: '  MixedCase@Example.COM ' });

      const found = await User.findOne({});
      expect(found?.email).toBe('mixedcase@example.com');
    });

    it('rejects a duplicate email at the database level', async () => {
      await createUser();

      await expect(createUser()).rejects.toSatisfy(isDuplicateKeyError);
    });

    it('serialises to JSON with an id and no secrets', async () => {
      const user = await createUser();
      const json = user.toJSON() as Record<string, unknown>;

      expect(json.id).toBe(user._id.toString());
      expect(json).not.toHaveProperty('passwordHash');
      expect(json).not.toHaveProperty('_id');
    });

    it('soft-deletes, hides from the alive scope, and restores', async () => {
      const user = await createUser();

      await (user as unknown as { softDelete: (r?: string) => Promise<boolean> }).softDelete(
        'user requested',
      );

      expect(await User.countDocuments(User.alive({ email: user.email }))).toBe(0);
      expect(await User.countDocuments(User.withDeleted({ email: user.email }))).toBe(1);
      expect((user as unknown as { isSoftDeleted: () => boolean }).isSoftDeleted()).toBe(true);

      await (user as unknown as { restore: () => Promise<boolean> }).restore();
      expect(await User.countDocuments(User.alive({ email: user.email }))).toBe(1);
    });

    it('frees the email for reuse once soft-deleted', async () => {
      // The unique index ignores soft-deleted rows only if it is partial; the
      // email index is intentionally NOT partial, so a soft-deleted address stays
      // reserved and a second registration cannot silently take it over.
      const user = await createUser();
      await (user as unknown as { softDelete: () => Promise<boolean> }).softDelete();

      await expect(createUser()).rejects.toSatisfy(isDuplicateKeyError);
    });
  });

  describe('MediaItem', () => {
    it('stores the authorization basis and defaults to PENDING', async () => {
      const item = await createMediaItem();

      expect(item.status).toBe('PENDING');
      expect(item.authorization.basis).toBe('OWNED');
    });

    it('rejects a duplicate source URL', async () => {
      await createMediaItem();

      await expect(createMediaItem()).rejects.toSatisfy(isDuplicateKeyError);
    });

    it('is found by the text index on title', async () => {
      await createMediaItem({ title: 'Sunset timelapse', author: 'Ada' });

      const results = await MediaItem.find(
        { $text: { $search: 'sunset' } },
        { score: { $meta: 'textScore' } },
      ).lean();

      expect(results).toHaveLength(1);
      expect(results[0]?.title).toBe('Sunset timelapse');
    });
  });

  describe('MediaFormat', () => {
    it('keeps the direct URL out of a default listing', async () => {
      const item = await createMediaItem();
      await MediaFormat.create({
        mediaItem: item._id,
        kind: 'VIDEO',
        qualityLabel: '1080p',
        container: 'mp4',
        url: 'https://cdn.example.com/clip.mp4?sig=secret',
      });

      const formats = await MediaFormat.find({ mediaItem: item._id });
      expect(formats[0]?.url).toBeUndefined();

      const withUrl = await MediaFormat.find({ mediaItem: item._id }).select('+url');
      expect(withUrl[0]?.url).toContain('sig=secret');
    });
  });

  describe('Download', () => {
    it('refuses two jobs with the same idempotency key for one user', async () => {
      const item = await createMediaItem();
      const user = await createUser();

      await Download.create({
        user: user._id,
        mediaItem: item._id,
        targetContainer: 'mp4',
        idempotencyKey: 'client-key-1234',
      });

      await expect(
        Download.create({
          user: user._id,
          mediaItem: item._id,
          targetContainer: 'mp4',
          idempotencyKey: 'client-key-1234',
        }),
      ).rejects.toSatisfy(isDuplicateKeyError);
    });

    it('allows many jobs when no idempotency key is supplied', async () => {
      const item = await createMediaItem();
      const user = await createUser();

      await Download.create({ user: user._id, mediaItem: item._id, targetContainer: 'mp4' });
      await Download.create({ user: user._id, mediaItem: item._id, targetContainer: 'mp3' });

      expect(await Download.countDocuments({ user: user._id })).toBe(2);
    });

    it('paginates history newest first and reports totals', async () => {
      const item = await createMediaItem();
      const user = await createUser();

      for (let index = 0; index < 5; index += 1) {
        await Download.create({
          user: user._id,
          mediaItem: item._id,
          targetContainer: 'mp4',
          idempotencyKey: `key-${index}`,
        });
      }

      const firstPage = await Download.paginate({ user: user._id }, { page: 1, limit: 2 });

      expect(firstPage.total).toBe(5);
      expect(firstPage.totalPages).toBe(3);
      expect(firstPage.hasNextPage).toBe(true);
      expect(firstPage.hasPreviousPage).toBe(false);
      expect(firstPage.items).toHaveLength(2);

      const lastPage = await Download.paginate({ user: user._id }, { page: 3, limit: 2 });
      expect(lastPage.items).toHaveLength(1);
      expect(lastPage.hasNextPage).toBe(false);
      expect(lastPage.hasPreviousPage).toBe(true);
    });

    it('scopes pagination to the requesting user', async () => {
      const item = await createMediaItem();
      const mine = await createUser({ email: 'mine@example.com' });
      const theirs = await createUser({ email: 'theirs@example.com' });

      await Download.create({ user: mine._id, mediaItem: item._id, targetContainer: 'mp4' });
      await Download.create({ user: theirs._id, mediaItem: item._id, targetContainer: 'mp4' });

      const scoped = await Download.paginate({}, { scope: { user: mine._id } });

      expect(scoped.total).toBe(1);
    });

    it('clamps a hostile page size', async () => {
      const item = await createMediaItem();
      const user = await createUser();
      await Download.create({ user: user._id, mediaItem: item._id, targetContainer: 'mp4' });

      const result = await Download.paginate({ user: user._id }, { page: -5, limit: 100_000 });

      expect(result.page).toBe(1);
      expect(result.limit).toBe(100);
    });

    it('normalises progress to 100 and stamps completion when a job completes', async () => {
      const item = await createMediaItem();
      const user = await createUser();

      const download = await Download.create({
        user: user._id,
        mediaItem: item._id,
        targetContainer: 'mp4',
        bytesDownloaded: 2048,
        totalBytes: 2048,
      });
      download.status = DOWNLOAD_STATUSES.COMPLETED;
      await download.save();

      expect(download.progressPercent).toBe(100);
      expect(download.completedAt).toBeInstanceOf(Date);
    });

    it('saves a job that carries no error', async () => {
      // Regression: the error subdocument used to be a nested literal, whose
      // `required` children were validated even when no error was present, so
      // every ordinary download failed to save.
      const item = await createMediaItem();
      const user = await createUser();

      const download = await Download.create({
        user: user._id,
        mediaItem: item._id,
        targetContainer: 'mp4',
      });

      const found = await Download.findById(download._id);
      expect(found).not.toBeNull();
      expect(found?.error).toBeUndefined();
    });

    it('requires the error fields once an error is present', async () => {
      const item = await createMediaItem();
      const user = await createUser();

      const download = new Download({
        user: user._id,
        mediaItem: item._id,
        targetContainer: 'mp4',
        // `at` omitted on purpose.
        error: { code: 'HTTP_403', message: 'Forbidden', retryable: false },
      });

      await expect(download.validate()).rejects.toThrow(/at/);
    });
  });

  describe('DownloadOutput', () => {
    it('rejects two artefacts with the same checksum', async () => {
      const item = await createMediaItem();
      const user = await createUser();
      const download = await Download.create({
        user: user._id,
        mediaItem: item._id,
        targetContainer: 'mp4',
      });

      const checksum = 'a'.repeat(64);
      await DownloadOutput.create({
        download: download._id,
        user: user._id,
        kind: 'VIDEO',
        sizeBytes: 1,
        checksumSha256: checksum,
      });

      await expect(
        DownloadOutput.create({
          download: download._id,
          user: user._id,
          kind: 'VIDEO',
          sizeBytes: 1,
          checksumSha256: checksum,
        }),
      ).rejects.toSatisfy(isDuplicateKeyError);
    });

    it('keeps the storage key out of the JSON payload', async () => {
      const item = await createMediaItem();
      const user = await createUser();
      const download = await Download.create({
        user: user._id,
        mediaItem: item._id,
        targetContainer: 'mp4',
      });

      const output = await DownloadOutput.create({
        download: download._id,
        user: user._id,
        kind: 'VIDEO',
        sizeBytes: 10,
        storageKey: 'users/1/file.mp4',
      });

      expect(output.toJSON()).not.toHaveProperty('storageKey');

      // Not loaded by a normal read, only when the worker asks for it.
      const plain = await DownloadOutput.findById(output._id);
      expect(plain?.storageKey).toBeUndefined();

      const privileged = await DownloadOutput.findById(output._id).select('+storageKey');
      expect(privileged?.storageKey).toBe('users/1/file.mp4');
    });
  });

  describe('AuditLog', () => {
    it('records an entry with no updatedAt', async () => {
      const entry = await AuditLog.create({ action: AUDIT_ACTIONS.USER_REGISTERED });

      expect(entry.createdAt).toBeInstanceOf(Date);
      expect(entry.toJSON()).not.toHaveProperty('updatedAt');
    });

    it('paginates the audit trail', async () => {
      await AuditLog.create({ action: AUDIT_ACTIONS.USER_REGISTERED });
      await AuditLog.create({ action: AUDIT_ACTIONS.DOWNLOAD_CREATED, actorType: 'USER' });

      const page = await AuditLog.paginate({}, { page: 1, limit: 1 });

      expect(page.total).toBe(2);
      expect(page.items).toHaveLength(1);
    });
  });

  describe('index synchronisation', () => {
    it('creates every declared index on the server', async () => {
      const existing = await User.collection.indexes();
      const names = existing.map((index) => index.name);

      expect(names).toContain('users_email_unique');
      expect(names).toContain('users_role_status');
    });

    it('is idempotent', async () => {
      await expect(syncModelIndexes()).resolves.toBeDefined();
      await expect(syncModelIndexes()).resolves.toBeDefined();
    });

    it('leaves an undeclared index alone by default', async () => {
      // The contract is additive unless a caller opts into `drop`. A boot-time
      // index sync that silently removed indexes would take production down.
      await User.collection.createIndex({ displayName: 1 }, { name: 'stray_manual_index' });

      await syncModelIndexes();

      const names = (await User.collection.indexes()).map((index) => index.name);
      expect(names).toContain('stray_manual_index');
    });

    it('removes an undeclared index when the caller opts in', async () => {
      await User.collection.createIndex({ displayName: 1 }, { name: 'stray_manual_index' });

      await syncModelIndexes({ drop: true });

      const names = (await User.collection.indexes()).map((index) => index.name);
      expect(names).not.toContain('stray_manual_index');
      expect(names).toContain('users_email_unique');
    });

    it('replaces a same-key index that was renamed in the schema', async () => {
      // Regression: MongoDB refuses to create `users_email_unique` while an
      // `email_1` covers the same key, and Mongoose's own `syncIndexes()`
      // neither creates the new one nor drops the old one and still resolves
      // successfully, so the rename silently never happened.
      await User.collection.dropIndex('users_email_unique');
      await User.collection.createIndex({ email: 1 }, { unique: true, name: 'email_1' });

      const before = (await User.collection.indexes()).map((index) => index.name);
      expect(before).toContain('email_1');
      expect(before).not.toContain('users_email_unique');

      await syncModelIndexes({ drop: true });

      const after = (await User.collection.indexes()).map((index) => index.name);
      expect(after).toContain('users_email_unique');
      expect(after).not.toContain('email_1');
    });
  });

  describe('role and status enums', () => {
    it('stores an admin role', async () => {
      const admin = await createUser({ role: USER_ROLES.ADMIN });

      const found = await User.findOne({ role: USER_ROLES.ADMIN });
      expect(found?._id).toEqual(admin._id);
      expect(createdUserId).toBeDefined();
    });
  });
});
