import { Types, type FilterQuery, type Query } from 'mongoose';

import { User, type UserDocument, type UserModel } from '../models/user.model';
import type { UserPort, UserProfile, UserWithCredentials } from '../services/auth.service';

/**
 * Mongoose implementation of the auth service's `UserPort`.
 *
 * Three details here are load-bearing:
 *
 * - `passwordHash` is `select: false`, so a read that needs to verify a password
 *   opts in with `.select('+passwordHash')` explicitly rather than by accident.
 *   Only `findByEmail` and `findCredentialsById` do that, so the secret reaches
 *   exactly the two flows that compare against it - and never the auth
 *   middleware, which runs on every authenticated request.
 * - Soft-deleted users are excluded via the `alive` scope, not a global hook, so
 *   a deleted account cannot sign in and cannot shadow a live one's address.
 * - Lookups take a string id from a token claim, so a malformed one is rejected
 *   before it reaches the driver rather than becoming a cast error.
 */

function toProfile(doc: UserDocument): UserProfile {
  return {
    _id: doc._id,
    email: doc.email,
    displayName: doc.displayName,
    avatarUrl: doc.avatarUrl ?? null,
    locale: doc.locale,
    role: doc.role,
    status: doc.status,
    failedLoginCount: doc.failedLoginCount,
    lockedUntil: doc.lockedUntil ?? null,
    lastLoginAt: doc.lastLoginAt ?? null,
    tokenVersion: doc.tokenVersion,
    createdAt: doc.createdAt,
  };
}

function toRecord(doc: UserDocument): UserWithCredentials {
  return { ...toProfile(doc), passwordHash: doc.passwordHash };
}

export function createUserRepository(model: UserModel = User): UserPort {
  /**
   * A live user by id, or null when the id is not a usable ObjectId.
   *
   * `alive` is applied here for the same reason it is applied to the email
   * lookup: a soft-deleted account must not be reachable by id either. Leaving
   * it off would let a deleted user keep refreshing tokens and changing their
   * password, because neither path goes through the email lookup.
   */
  const liveById = (id: string): Query<UserDocument | null, UserDocument> | null =>
    Types.ObjectId.isValid(id) ? model.findOne(model.alive({ _id: id })) : null;

  return {
    async findByEmail(email) {
      const doc = await model
        .findOne(model.alive({ email }) as FilterQuery<UserDocument>)
        .select('+passwordHash')
        .exec();
      return doc ? toRecord(doc) : null;
    },

    async findById(id) {
      const query = liveById(id);
      if (!query) {
        return null;
      }
      const doc = await query.exec();
      return doc ? toProfile(doc) : null;
    },

    async findCredentialsById(id) {
      const query = liveById(id);
      if (!query) {
        return null;
      }
      const doc = await query.select('+passwordHash').exec();
      return doc ? toRecord(doc) : null;
    },

    async insert(values) {
      const doc = await model.create(values);
      return toRecord(doc);
    },

    async recordFailedLogin(id, failedLoginCount, lockedUntil) {
      await model
        .updateOne({ _id: id }, { $set: { failedLoginCount, lockedUntil } })
        .exec();
    },

    async recordSuccessfulLogin(id, at) {
      // A success clears the counter, so the lockout measures *consecutive*
      // failures rather than lifetime failures.
      await model
        .updateOne(
          { _id: id },
          { $set: { lastLoginAt: at, failedLoginCount: 0, lockedUntil: null } },
        )
        .exec();
    },

    async updatePasswordHash(id, passwordHash, options) {
      const update = options?.bumpTokenVersion
        ? { $set: { passwordHash }, $inc: { tokenVersion: 1 } }
        : { $set: { passwordHash } };

      await model.updateOne({ _id: id }, update).exec();
    },
  };
}
