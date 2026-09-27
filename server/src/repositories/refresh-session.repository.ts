import { Types } from 'mongoose';

import {
  RefreshSession,
  type RefreshSessionDocument,
  type RefreshSessionModel,
} from '../models/refresh-session.model';
import type { RefreshSessionPort, RefreshSessionRecord } from '../services/auth.service';

/**
 * Mongoose implementation of the auth service's `RefreshSessionPort`.
 *
 * Every write here is a single indexed update rather than a read-modify-write.
 * That matters most for `revokeFamily`: reuse detection runs it the moment a
 * stolen token is replayed, and two concurrent replays of the same family must
 * both succeed in revoking rather than racing each other and leaving part of the
 * family alive.
 */

function toRecord(doc: RefreshSessionDocument): RefreshSessionRecord {
  return {
    _id: doc._id,
    user: doc.user,
    family: doc.family,
    expiresAt: doc.expiresAt,
    revokedAt: doc.revokedAt ?? null,
    rotatedAt: doc.rotatedAt ?? null,
    ip: doc.ip ?? null,
    userAgent: doc.userAgent ?? null,
    createdAt: doc.createdAt,
  };
}

export function createRefreshSessionRepository(
  model: RefreshSessionModel = RefreshSession,
): RefreshSessionPort {
  return {
    async findById(id) {
      if (!Types.ObjectId.isValid(id)) {
        return null;
      }
      // `tokenHash` is `select: false`; redemption is the one place it is needed,
      // and it is compared in the service rather than in a query so a mismatched
      // token can be told apart from a missing row.
      const doc = await model.findById(id).select('+tokenHash').exec();
      if (!doc) {
        return null;
      }
      return { ...toRecord(doc), tokenHash: doc.tokenHash };
    },

    async insert(values) {
      const doc = await model.create({
        _id: new Types.ObjectId(values._id),
        user: new Types.ObjectId(values.user),
        family: new Types.ObjectId(values.family),
        tokenHash: values.tokenHash,
        expiresAt: values.expiresAt,
        ip: values.ip,
        userAgent: values.userAgent,
      });
      return toRecord(doc);
    },

    async markRotated(id, replacedBy, at) {
      const result = await model
        .updateOne(
          { _id: id, rotatedAt: null, revokedAt: null },
          { $set: { rotatedAt: at, replacedBy: new Types.ObjectId(replacedBy) } },
        )
        .exec();

      // `modifiedCount` is the compare-and-set result: 1 means this caller won
      // the claim, 0 means a concurrent request already spent the session.
      return result.modifiedCount === 1;
    },

    async revokeFamily(family, reason, at) {
      const result = await model
        .updateMany({ family, revokedAt: null }, { $set: { revokedAt: at, revokedReason: reason } })
        .exec();
      return result.modifiedCount;
    },

    async revokeAllForUser(user, reason, at) {
      const result = await model
        .updateMany({ user, revokedAt: null }, { $set: { revokedAt: at, revokedReason: reason } })
        .exec();
      return result.modifiedCount;
    },

    async revokeById(id, reason, at) {
      await model
        .updateOne({ _id: id, revokedAt: null }, { $set: { revokedAt: at, revokedReason: reason } })
        .exec();
    },

    async listForUser(user) {
      const docs = await model.find({ user }).sort({ createdAt: -1 }).exec();
      return docs.map(toRecord);
    },
  };
}
