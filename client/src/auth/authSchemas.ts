import { z } from 'zod';

/**
 * Client-side mirror of `passwordSchema` in `server/src/schemas/user.schema.ts`.
 *
 * The server stays the source of truth. Duplicating the rule here only buys
 * instant feedback, and if the two ever drift the outcome is a 400 from the API,
 * not a weaker password.
 */
export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters.')
  .max(200, 'That is longer than any password we accept.')
  .refine((value) => /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value), {
    message: 'Include lower case, upper case and a digit.',
  });

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Enter your email address.')
    .email('Enter a valid email address.'),
  // Deliberately only a presence check: the server must not leak, through a
  // validation error, that a password failed the *registration* policy.
  password: z.string().min(1, 'Enter your password.'),
});

export const registerSchema = z.object({
  displayName: z.string().trim().min(1, 'Tell us what to call you.').max(60),
  email: z
    .string()
    .trim()
    .min(1, 'Enter your email address.')
    .email('Enter a valid email address.'),
  password: passwordSchema,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: passwordSchema,
  })
  .refine((values) => values.currentPassword !== values.newPassword, {
    path: ['newPassword'],
    message: 'Choose a password you have not used here before.',
  });

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;
