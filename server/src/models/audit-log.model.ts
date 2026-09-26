import { Schema, model, models, type Types } from 'mongoose';

import {
  AUDIT_ACTIONS,
  AUDIT_ACTOR_TYPES,
  type AuditAction,
  type AuditActorType,
} from '../config/constants';
import { applyJsonTransform, baseSchemaOptions } from './base';
import { paginatePlugin } from './plugins/paginate.plugin';
import type { PaginatedModel } from './plugins/types';

/**
 * Append-only record of anything worth being able to prove later.
 *
 * Two deliberate constraints: no `updatedAt` (a record that can be edited is not
 * evidence) and no soft delete (TTL only, so a retention window can be honoured
 * without a privileged delete path existing at all). Security events such as
 * `TOKEN_REUSE_DETECTED` land here for Phase 4, and admin actions for Phase 13.
 */
export interface AuditLogDocument {
  _id: Types.ObjectId;
  action: AuditAction;
  actorType: AuditActorType;
  /** Null for a system event with no user behind it. */
  actor: Types.ObjectId | null;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export type AuditLogModel = PaginatedModel<AuditLogDocument>;

const auditLogSchema = new Schema<AuditLogDocument>(
  {
    action: {
      type: String,
      enum: Object.values(AUDIT_ACTIONS),
      required: true,
    },
    actorType: {
      type: String,
      enum: Object.values(AUDIT_ACTOR_TYPES),
      default: AUDIT_ACTOR_TYPES.SYSTEM,
      required: true,
    },
    actor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    targetType: { type: String, default: null, maxlength: 60 },
    targetId: { type: String, default: null, maxlength: 100 },
    ip: { type: String, default: null, maxlength: 64 },
    userAgent: { type: String, default: null, maxlength: 512 },
    /** Ties the entry to the `x-request-id` in the log lines for that request. */
    requestId: { type: String, default: null, maxlength: 100 },
    metadata: { type: Schema.Types.Mixed, default: () => ({}) },
  },
  baseSchemaOptions<AuditLogDocument>({
    // Append-only: createdAt is set once and never updated.
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'audit_logs',
  }),
);

// The admin audit screen: most recent first, optionally filtered.
auditLogSchema.index({ createdAt: -1 }, { name: 'audit_recent' });
auditLogSchema.index({ action: 1, createdAt: -1 }, { name: 'audit_action_recent' });
auditLogSchema.index({ actor: 1, createdAt: -1 }, { name: 'audit_actor_recent' });
// "What happened to this record?" while investigating an incident.
auditLogSchema.index(
  { targetType: 1, targetId: 1, createdAt: -1 },
  { name: 'audit_target' },
);
// Retention. The value is overridden per deployment via collMod.
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90, name: 'audit_ttl' });

auditLogSchema.plugin(paginatePlugin);

applyJsonTransform(auditLogSchema);

export const AuditLog =
  (models.AuditLog as AuditLogModel | undefined) ??
  model<AuditLogDocument, AuditLogModel>('AuditLog', auditLogSchema, 'audit_logs');
