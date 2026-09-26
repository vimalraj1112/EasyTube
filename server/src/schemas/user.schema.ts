import { z } from 'zod';

import { USER_ROLES, USER_STATUSES } from '../config/constants';
import { paginationQuerySchema } from './common.schema';

const passwordSchema = z
  .string()
  .min(12, 'must be at least 12 characters')
  .max(200)
  .refine((value) => /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value), {
    message: 'must include lower case, upper case and a digit',
  });

export const registerUserSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(60),
  locale: z.string().trim().min(2).max(10).default('en'),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  // Not held to the registration policy: an old password should still be able
  // to sign in so it can be changed.
  password: z.string().min(1).max(200),
});

export const updateProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(60).optional(),
    avatarUrl: z.string().trim().url().max(2048).nullable().optional(),
    locale: z.string().trim().min(2).max(10).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'provide at least one field to update',
  });

/** Admin-only. Deliberately cannot change a password or a role implicitly. */
export const updateUserAdminSchema = z
  .object({
    role: z.enum([USER_ROLES.USER, USER_ROLES.ADMIN]).optional(),
    status: z.enum([USER_STATUSES.ACTIVE, USER_STATUSES.SUSPENDED]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'provide at least one field to update',
  });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

export const listUsersQuerySchema = paginationQuerySchema.extend({
  role: z.enum([USER_ROLES.USER, USER_ROLES.ADMIN]).optional(),
  status: z.enum([USER_STATUSES.ACTIVE, USER_STATUSES.SUSPENDED]).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  includeDeleted: z.coerce.boolean().default(false),
});

export type RegisterUserInput = z.infer<typeof registerUserSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UpdateUserAdminInput = z.infer<typeof updateUserAdminSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
