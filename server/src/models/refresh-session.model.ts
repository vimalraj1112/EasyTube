import { Schema, model, models, type Types } from 'mongoose';

import { applyJsonTransform, baseSchemaOptions } from './base';
import { paginatePlugin } from './plugins/paginate.plugin';
import type { PaginatedModel } from './plugins/types';

/**
 * One row per issued refresh token.
 *
 * Refresh rotation (Phase 4) means a token is single-use: redeeming one writes
 * a replacement in the same `family` and marks the old row `rotatedAt`. If a
 * row that was already rotated is ever presented again, that is a stolen token
 * being replayed, so the whole family is revoked. Storing the family as an
 * indexable field is what makes that revocation a single indexed update rather
 * than a scan.
 *
 * Only a hash of the token is stored. A database leak therefore does not hand
 * an attacker usable sessions.
 */
export interface RefreshSessionDocument {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  /** Hash of the raw token. The raw token is never persisted. */
  tokenHash: string;
  /** Rotation lineage: every descendant of one login shares this id. */
  family: Types.ObjectId;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
  rotatedAt: Date | null;
  replacedBy: Types.ObjectId | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type RefreshSessionModel = PaginatedModel<RefreshSessionDocument>;

const refreshSessionSchema = new Schema<RefreshSessionDocument>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    tokenHash: {
      type: String,
      required: true,
      select: false,
    },
    family: {
      type: Schema.Types.ObjectId,
      ref: 'RefreshSession',
      required: true,
    },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null, maxlength: 120 },
    rotatedAt: { type: Date, default: null },
    replacedBy: { type: Schema.Types.ObjectId, ref: 'RefreshSession', default: null },
    ip: { type: String, default: null, maxlength: 64 },
    userAgent: { type: String, default: null, maxlength: 512 },
  },
  baseSchemaOptions<RefreshSessionDocument>({
    timestamps: true,
    collection: 'refresh_sessions',
  }),
);

refreshSessionSchema.index({ tokenHash: 1 }, { unique: true, name: 'refresh_token_hash_unique' });
// Revoking a stolen family is one indexed update.
refreshSessionSchema.index({ family: 1, revokedAt: 1 }, { name: 'refresh_family_revoked' });
// "Active sessions for this user" on the security screen.
refreshSessionSchema.index({ user: 1, revokedAt: 1, expiresAt: 1 }, { name: 'refresh_user_active' });
// Mongo removes the row once the token could no longer be used anyway.
refreshSessionSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'refresh_expiry_ttl' },
);

refreshSessionSchema.plugin(paginatePlugin);

applyJsonTransform(refreshSessionSchema, { remove: ['tokenHash'] });

export const RefreshSession =
  (models.RefreshSession as RefreshSessionModel | undefined) ??
  model<RefreshSessionDocument, RefreshSessionModel>(
    'RefreshSession',
    refreshSessionSchema,
    'refresh_sessions',
  );
