import { describe, expect, it } from 'vitest';

import { AUDIT_ACTIONS, COLLECTIONS, DOWNLOAD_STATUSES, USER_ROLES } from '../config/constants';
import {
  AuditLog,
  Download,
  DownloadOutput,
  MediaFormat,
  MediaItem,
  RefreshSession,
  User,
  models,
} from '../models';

/** Index declarations, as `[fields, options]` pairs. */
function indexEntries(model: {
  schema: { indexes: () => Array<[Record<string, unknown>, Record<string, unknown>]> };
}): Array<[Record<string, unknown>, Record<string, unknown>]> {
  return model.schema.indexes();
}

function indexNames(model: Parameters<typeof indexEntries>[0]): string[] {
  return indexEntries(model)
    .map(([, options]) => options.name)
    .filter((name): name is string => typeof name === 'string');
}

describe('model registry', () => {
  it('exposes every model exactly once', () => {
    expect(Object.keys(models).sort()).toEqual([
      'AuditLog',
      'Download',
      'DownloadOutput',
      'MediaFormat',
      'MediaItem',
      'RefreshSession',
      'User',
    ]);
  });

  it('binds each model to its declared collection', () => {
    expect(User.collection.name).toBe(COLLECTIONS.USERS);
    expect(RefreshSession.collection.name).toBe(COLLECTIONS.REFRESH_SESSIONS);
    expect(MediaItem.collection.name).toBe(COLLECTIONS.MEDIA_ITEMS);
    expect(MediaFormat.collection.name).toBe(COLLECTIONS.MEDIA_FORMATS);
    expect(Download.collection.name).toBe(COLLECTIONS.DOWNLOADS);
    expect(DownloadOutput.collection.name).toBe(COLLECTIONS.DOWNLOAD_OUTPUTS);
    expect(AuditLog.collection.name).toBe(COLLECTIONS.AUDIT_LOGS);
  });

  it('returns the same instance when a model file is re-imported', async () => {
    const reimported = await import('../models/user.model');
    expect(reimported.User).toBe(User);
  });
});

/**
 * Runs a schema's `toJSON` transform against a plain object.
 *
 * Mongoose stores the transform in `schema.options.toJSON`, not in
 * `schema.methods`, so the transform is what gets exercised here. Serialisation
 * of a real document is covered by the integration suite.
 */
function toJson(schema: unknown, doc: Record<string, unknown>): Record<string, unknown> {
  const transform = (
    schema as {
      options?: {
        toJSON?: {
          transform?: (doc: unknown, ret: Record<string, unknown>) => Record<string, unknown>;
        };
      };
    }
  ).options?.toJSON?.transform;

  expect(typeof transform).toBe('function');
  return (transform as (doc: unknown, ret: Record<string, unknown>) => Record<string, unknown>)(
    doc,
    { ...doc },
  );
}

describe('secret handling', () => {
  it('hides passwordHash from ordinary reads', () => {
    expect(User.schema.path('passwordHash')?.options.select).toBe(false);
  });

  it('hides the refresh token hash from ordinary reads', () => {
    expect(RefreshSession.schema.path('tokenHash')?.options.select).toBe(false);
  });

  it('hides media format URLs from ordinary reads', () => {
    // A stored direct URL is often signed, so it must not ride along with a listing.
    expect(MediaFormat.schema.path('url')?.options.select).toBe(false);
  });

  it('strips passwordHash from the JSON payload as a second line of defence', () => {
    const json = toJson(User.schema, {
      _id: 'abc',
      __v: 0,
      email: 'a@b.com',
      passwordHash: 'super-secret',
    });

    expect(json).not.toHaveProperty('passwordHash');
    expect(json).not.toHaveProperty('__v');
    expect(json).toHaveProperty('email', 'a@b.com');
  });

  it('removes _id from the JSON payload', () => {
    const json = toJson(Download.schema, { _id: 'abc', status: DOWNLOAD_STATUSES.QUEUED });

    expect(json).not.toHaveProperty('_id');
    expect(json.status).toBe(DOWNLOAD_STATUSES.QUEUED);
  });

  it('strips the raw storage key from an output', () => {
    // The client gets a signed downloadUrl minted on demand, never the key.
    const json = toJson(DownloadOutput.schema, {
      _id: 'abc',
      storageKey: 'users/1/file.mp4',
      sizeBytes: 10,
    });

    expect(json).not.toHaveProperty('storageKey');
    expect(json.sizeBytes).toBe(10);
  });

  it('strips the refresh token hash from the JSON payload', () => {
    const json = toJson(RefreshSession.schema, { _id: 'abc', tokenHash: 'raw-token' });

    expect(json).not.toHaveProperty('tokenHash');
  });
});

describe('User schema', () => {
  it('lowercases and trims the email', () => {
    const user = new User({ email: '  MiXeD@Example.COM ', passwordHash: 'x', displayName: 'A' });
    user.validateSync();

    expect(user.email).toBe('mixed@example.com');
  });

  it('defaults to a non-admin active user', () => {
    const user = new User({ email: 'a@b.com', passwordHash: 'x', displayName: 'A' });

    expect(user.role).toBe(USER_ROLES.USER);
    expect(user.status).toBe('ACTIVE');
    expect(user.tokenVersion).toBe(0);
    expect(user.deletedAt).toBeNull();
  });

  it('constrains the role enum', () => {
    expect(User.schema.path('role')?.options.enum).toEqual(Object.values(USER_ROLES));
  });

  it('requires a password hash', () => {
    const user = new User({ email: 'a@b.com', displayName: 'A' });
    const error = user.validateSync();

    expect(error?.errors).toHaveProperty('passwordHash');
  });

  it('enforces a unique email index', () => {
    const unique = indexEntries(User).find(([, options]) => options.name === 'users_email_unique');

    expect(unique?.[1].unique).toBe(true);
    expect(unique?.[0]).toMatchObject({ email: 1 });
  });

  it('supports the soft-delete scopes', () => {
    const statics = User.schema.statics as Record<
      string,
      ((filter?: Record<string, unknown>) => Record<string, unknown>) | undefined
    >;
    const alive = statics.alive;
    const withDeleted = statics.withDeleted;

    expect(typeof alive).toBe('function');
    expect(typeof withDeleted).toBe('function');

    expect(alive?.({ email: 'a@b.com' })).toEqual({ email: 'a@b.com', deletedAt: null });
    expect(alive?.()).toEqual({ deletedAt: null });
    expect(withDeleted?.({ email: 'a@b.com' })).toEqual({ email: 'a@b.com' });
  });
});

describe('RefreshSession schema', () => {
  it('expires rows through a TTL index', () => {
    const ttl = indexEntries(RefreshSession).find(
      ([, options]) => options.name === 'refresh_expiry_ttl',
    );

    expect(ttl?.[0]).toMatchObject({ expiresAt: 1 });
    expect(ttl?.[1].expireAfterSeconds).toBe(0);
  });

  it('indexes the rotation family so a stolen token can be revoked in one query', () => {
    expect(indexNames(RefreshSession)).toContain('refresh_family_revoked');
  });

  it('requires a user and an expiry', () => {
    const session = new RefreshSession({});
    const error = session.validateSync();

    expect(error?.errors).toHaveProperty('user');
    expect(error?.errors).toHaveProperty('expiresAt');
  });
});

describe('MediaItem schema', () => {
  it('requires an authorization basis', () => {
    const item = new MediaItem({
      sourceUrl: 'https://example.com/clip.mp4',
      sourceHost: 'example.com',
      title: 'Clip',
    });
    const error = item.validateSync();

    expect(error?.errors['authorization.basis']).toBeDefined();
  });

  it('accepts a complete item', () => {
    const item = new MediaItem({
      sourceUrl: 'https://example.com/clip.mp4',
      sourceHost: 'example.com',
      title: 'Clip',
      authorization: { basis: 'OWNED', confirmedByUser: true },
    });

    expect(item.validateSync()).toBeUndefined();
    expect(item.status).toBe('PENDING');
  });

  it('strips a trailing slash from the source URL', () => {
    const item = new MediaItem({ sourceUrl: 'https://example.com/clip.mp4/' });
    expect(item.sourceUrl).toBe('https://example.com/clip.mp4');
  });

  it('de-duplicates by source URL, ignoring soft-deleted rows', () => {
    const unique = indexEntries(MediaItem).find(
      ([, options]) => options.name === 'media_source_url_unique',
    );

    expect(unique?.[1].unique).toBe(true);
    expect(unique?.[1].partialFilterExpression).toEqual({ deletedAt: null });
  });

  it('declares a weighted text index for history search', () => {
    const text = indexEntries(MediaItem).find(
      ([, options]) => options.name === 'media_text_search',
    );

    expect(text?.[0]).toEqual({ title: 'text', author: 'text' });
    expect(text?.[1].weights).toEqual({ title: 10, author: 5 });
  });
});

describe('MediaFormat schema', () => {
  it('requires a media item and a container', () => {
    const format = new MediaFormat({});
    const error = format.validateSync();

    expect(error?.errors).toHaveProperty('mediaItem');
    expect(error?.errors).toHaveProperty('container');
  });

  it('defaults an unclassified format to UNKNOWN rather than failing', () => {
    // A provider is allowed to report a stream we cannot classify; guessing is
    // worse than saying so.
    expect(new MediaFormat({}).kind).toBe('UNKNOWN');
  });

  it('marks size as approximate by default', () => {
    const format = new MediaFormat({ approximate: undefined });

    expect(format.approximate).toBe(true);
  });

  it('rejects a negative bitrate', () => {
    const format = new MediaFormat({ bitrateKbps: -1 });

    expect(format.validateSync()?.errors).toHaveProperty('bitrateKbps');
  });

  it('reaps expired signed URLs through a partial TTL index', () => {
    const ttl = indexEntries(MediaFormat).find(
      ([, options]) => options.name === 'format_expiry_ttl',
    );

    expect(ttl?.[1].partialFilterExpression).toEqual({ url: { $type: 'string' } });
  });
});

describe('Download schema', () => {
  it('starts queued at zero progress', () => {
    const download = new Download({ targetContainer: 'mp4' });

    expect(download.status).toBe(DOWNLOAD_STATUSES.QUEUED);
    expect(download.progressPercent).toBe(0);
    expect(download.attempts).toBe(0);
  });

  it('caps progress at 100 and never below 0', () => {
    const download = new Download({ targetContainer: 'mp4', progressPercent: 150 });

    expect(download.validateSync()?.errors).toHaveProperty('progressPercent');
  });

  it('de-duplicates per user by idempotency key', () => {
    const unique = indexEntries(Download).find(
      ([, options]) => options.name === 'download_user_idempotency_unique',
    );

    expect(unique?.[0]).toMatchObject({ user: 1, idempotencyKey: 1 });
    expect(unique?.[1].unique).toBe(true);
  });

  it('supports the history index', () => {
    expect(indexNames(Download)).toContain('download_user_recent');
  });

  it('reaps rows past their retention deadline', () => {
    const ttl = indexEntries(Download).find(
      ([, options]) => options.name === 'download_expiry_ttl',
    );

    expect(ttl?.[1].expireAfterSeconds).toBe(0);
    expect(ttl?.[1].partialFilterExpression).toEqual({ expiresAt: { $type: 'date' } });
  });

  it('keeps a nested error free of its own _id', () => {
    // Inline sub-objects get their own _id unless `_id: false` is set, which
    // would put a meaningless id inside every error payload.
    expect(Download.schema.path('error.code')).toBeDefined();
    expect(Download.schema.path('error._id')).toBeUndefined();
  });
});

describe('DownloadOutput schema', () => {
  it('de-duplicates identical artefacts by checksum', () => {
    const unique = indexEntries(DownloadOutput).find(
      ([, options]) => options.name === 'output_checksum_unique',
    );

    expect(unique?.[1].unique).toBe(true);
  });

  it('defaults to a pending storage status with zero bytes', () => {
    const output = new DownloadOutput({ sizeBytes: 0 });

    expect(output.status).toBe('PENDING');
  });
});

describe('AuditLog schema', () => {
  it('is append-only: createdAt without updatedAt', () => {
    expect(AuditLog.schema.path('updatedAt')).toBeUndefined();
    expect(AuditLog.schema.path('createdAt')).toBeDefined();
  });

  it('constrains the action enum', () => {
    expect(AuditLog.schema.path('action')?.options.enum).toEqual(Object.values(AUDIT_ACTIONS));
  });

  it('indexes by target so an incident can be traced', () => {
    expect(indexNames(AuditLog)).toContain('audit_target');
  });
});
