import { Types } from 'mongoose';

import { AuditLog, type AuditLogModel } from '../models/audit-log.model';
import type { AuditPort } from '../services/auth.service';

/**
 * Mongoose implementation of the auth service's `AuditPort`.
 *
 * `targetType` is filled in from the action rather than left to the caller,
 * because the action is the only thing that reliably knows what a `targetId`
 * points at - a refresh session in every case the auth flow produces.
 */

const TARGET_TYPES: Record<string, string> = {
  TOKEN_REFRESHED: 'refresh_session',
  TOKEN_REUSE_DETECTED: 'refresh_session',
  USER_LOGGED_OUT: 'refresh_session',
  USER_REGISTERED: 'user',
};

export function createAuditRepository(model: AuditLogModel = AuditLog): AuditPort {
  return {
    async write(entry) {
      const actor =
        entry.actor && Types.ObjectId.isValid(entry.actor) ? new Types.ObjectId(entry.actor) : null;

      await model.create({
        action: entry.action,
        actorType: entry.actorType,
        actor,
        targetType: TARGET_TYPES[entry.action] ?? null,
        targetId: entry.target ?? null,
        ip: entry.ip,
        userAgent: entry.userAgent,
        requestId: entry.requestId,
        metadata: entry.metadata ?? {},
      });
    },
  };
}
