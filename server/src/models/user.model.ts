import { Schema, model, models, type Types } from 'mongoose';

import { USER_ROLES, USER_STATUSES, type UserRole, type UserStatus } from '../config/constants';
import { applyJsonTransform, baseSchemaOptions } from './base';
import { paginatePlugin } from './plugins/paginate.plugin';
import { softDeletePlugin } from './plugins/soft-delete.plugin';
import type { SoftDeleteDocument, SoftDeleteModel } from './plugins/types';

/** Public shape of a user. Never includes `passwordHash`. */
export interface UserDocument extends SoftDeleteDocument {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
  displayName: string;
  avatarUrl: string | null;
  role: UserRole;
  status: UserStatus;
  locale: string;
  lastLoginAt: Date | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  /** Bumped to invalidate every issued refresh token at once. */
  tokenVersion: number;
  deletionReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Static side: `paginate`, plus the `alive`/`withDeleted` scopes. */
export type UserModel = SoftDeleteModel<UserDocument>;

const userSchema = new Schema<UserDocument>(
  {
    email: {
      type: String,
      required: [true, 'email is required'],
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    /**
     * `select: false` keeps the hash out of every query result unless a caller
     * opts in with `.select('+passwordHash')`, which is a decision someone has
     * to make on purpose. `applyJsonTransform` removes it a second time in case
     * that decision goes wrong.
     */
    passwordHash: {
      type: String,
      required: [true, 'passwordHash is required'],
      select: false,
    },
    displayName: {
      type: String,
      required: [true, 'displayName is required'],
      trim: true,
      maxlength: 60,
    },
    avatarUrl: { type: String, default: null, maxlength: 2048 },
    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      default: USER_ROLES.USER,
    },
    status: {
      type: String,
      enum: Object.values(USER_STATUSES),
      default: USER_STATUSES.ACTIVE,
    },
    locale: { type: String, default: 'en', maxlength: 10 },
    lastLoginAt: { type: Date, default: null },
    failedLoginCount: { type: Number, default: 0, min: 0 },
    lockedUntil: { type: Date, default: null },
    tokenVersion: { type: Number, default: 0, min: 0 },
    deletedAt: { type: Date, default: null },
    deletionReason: { type: String, maxlength: 280 },
  },
  baseSchemaOptions<UserDocument>({
    timestamps: true,
    collection: 'users',
  }),
);

// Uniqueness is enforced by this index rather than by a path-level `unique`,
// because a path-level flag would also create an unnamed `email_1` index and the
// two would collide on sync. Declaring it once keeps the index set honest.
userSchema.index({ email: 1 }, { unique: true, name: 'users_email_unique' });
// Admin user list, newest first.
userSchema.index({ role: 1, status: 1, createdAt: -1 }, { name: 'users_role_status' });
// A status-only filter is not served by the compound above, since role leads it.
userSchema.index({ status: 1, createdAt: -1 }, { name: 'users_status_recent' });

userSchema.plugin(softDeletePlugin).plugin(paginatePlugin);

userSchema.pre('save', function normaliseEmail(next) {
  if (this.isModified('email') || this.isNew) {
    this.email = this.email.trim().toLowerCase();
  }
  next();
});

applyJsonTransform(userSchema, { remove: ['passwordHash'] });

/** The default export shape every other module imports. */
export const User =
  (models.User as UserModel | undefined) ??
  model<UserDocument, UserModel>('User', userSchema, 'users');
