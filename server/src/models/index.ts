import type { Model } from 'mongoose';

import { logger } from '../config/logger';
import { AuditLog } from './audit-log.model';
import { Download } from './download.model';
import { DownloadOutput } from './download-output.model';
import { MediaFormat } from './media-format.model';
import { MediaItem } from './media-item.model';
import { RefreshSession } from './refresh-session.model';
import { User } from './user.model';

export { AuditLog } from './audit-log.model';
export { Download } from './download.model';
export { DownloadOutput } from './download-output.model';
export { MediaFormat } from './media-format.model';
export { MediaItem } from './media-item.model';
export { RefreshSession } from './refresh-session.model';
export { User } from './user.model';

export type { AuditLogDocument, AuditLogModel } from './audit-log.model';
export type { DownloadDocument, DownloadModel } from './download.model';
export type { DownloadOutputDocument, DownloadOutputModel } from './download-output.model';
export type { MediaFormatDocument, MediaFormatModel } from './media-format.model';
export type { MediaItemDocument, MediaItemModel } from './media-item.model';
export type { RefreshSessionDocument, RefreshSessionModel } from './refresh-session.model';
export type { UserDocument, UserModel } from './user.model';
export { baseSchemaOptions, applyJsonTransform } from './base';
export { paginatePlugin, type PaginateOptions, type PaginateResult } from './plugins/paginate.plugin';
export { softDeletePlugin } from './plugins/soft-delete.plugin';

/** Every model the application owns, in dependency order. */
export const models = {
  User,
  RefreshSession,
  MediaItem,
  MediaFormat,
  Download,
  DownloadOutput,
  AuditLog,
} as const;

export type Models = typeof models;
export type ModelName = keyof Models;

export interface SyncIndexOptions {
  /**
   * Drop server indexes that the schema no longer declares, and drop an
   * existing index that the schema wants to replace under a different name.
   * Off by default, because it is destructive and irreversible.
   */
  drop?: boolean;
}

/** `keySignature` of an index key, so two definitions can be compared. */
function keySignature(key: Record<string, unknown>): string {
  return Object.entries(key)
    .map(([field, direction]) => `${field}:${String(direction)}`)
    .join(',');
}

/**
 * Reconciles one collection's indexes when a destructive pass was asked for.
 *
 * Mongoose's own `syncIndexes()` is not used even here, for a specific reason
 * observed against a live mongod: when a declared index has the same key as an
 * existing one but a different name (`users_email_unique` replacing `email_1`),
 * `syncIndexes()` neither creates the new index nor drops the old one, and then
 * resolves successfully. The rename is silently not applied. Dropping the
 * conflicting index first is the only way to express "this key, under this
 * name", so it is done explicitly here.
 */
async function reconcileIndexes(model: Model<unknown>): Promise<void> {
  const declaredByKey = new Map<string, string | undefined>();
  for (const [fields, options] of model.schema.indexes()) {
    const name = typeof options?.name === 'string' ? options.name : undefined;
    declaredByKey.set(keySignature(fields), name);
  }

  for (const serverIndex of await model.collection.indexes()) {
    if (serverIndex.name === undefined || serverIndex.name === '_id_') {
      continue;
    }

    const signature = keySignature(serverIndex.key);
    if (!declaredByKey.has(signature)) {
      await model.collection.dropIndex(serverIndex.name);
      logger.warn(
        { model: model.modelName, index: serverIndex.name },
        'Dropped index that the schema no longer declares',
      );
      continue;
    }

    const declaredName = declaredByKey.get(signature);
    if (declaredName !== undefined && declaredName !== serverIndex.name) {
      await model.collection.dropIndex(serverIndex.name);
      logger.warn(
        { model: model.modelName, from: serverIndex.name, to: declaredName },
        'Replaced index with the same key under its declared name',
      );
    }
  }
}

/**
 * Builds the declared indexes.
 *
 * Mongoose's `autoIndex` is disabled in production because a background index
 * build on a large collection competes with live traffic, and because silently
 * dropping an index that is no longer in the schema is how a deploy takes out
 * production. So indexes are created here, once, explicitly, at boot.
 *
 * The default is `createIndexes()`, which only adds what is missing and never
 * removes anything. Dropping, including replacing a renamed index, requires
 * `drop: true` from `npm run db:sync-indexes -- --drop`.
 */
export async function syncModelIndexes(
  options: SyncIndexOptions = {},
  registry: Models = models,
): Promise<Record<ModelName, string[]>> {
  const result = {} as Record<ModelName, string[]>;

  for (const [name, model] of Object.entries(registry) as Array<[ModelName, Model<unknown>]>) {
    if (options.drop) {
      await reconcileIndexes(model);
    }
    await model.createIndexes();

    // Read back what the server actually has rather than trusting the call's
    // return value: `createIndexes()` resolves to the model, which proves
    // nothing about the server's state.
    const serverIndexes = await model.collection.indexes();
    result[name] = serverIndexes
      .map((index) => index.name)
      .filter((indexName): indexName is string => typeof indexName === 'string');
    logger.info({ model: name, indexes: result[name] }, 'Model indexes synchronised');
  }

  return result;
}
