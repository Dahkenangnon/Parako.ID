/**
 * Zod validation schemas for user create / update / password-reset request bodies.
 *
 * These schemas enforce the shape and constraints of incoming payloads
 * before they reach the controller logic. The `updateUserSchema` makes
 * all fields optional (including email) for PUT and PATCH operations.
 */

import { z } from 'zod';

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const usernameSchema = z.string().trim().min(1).max(100);
const shortProfileFieldSchema = z.string().trim().max(100);
const roleSchema = z.string().trim().min(1).max(50);

export const createUserSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(128),
  username: usernameSchema.optional(),
  given_name: shortProfileFieldSchema.optional(),
  family_name: shortProfileFieldSchema.optional(),
  name: z.string().trim().max(200).optional(),
  nickname: shortProfileFieldSchema.optional(),
  role: roleSchema.optional(),
  account_enabled: z.boolean().optional(),
});

export const updateUserSchema = createUserSchema
  .omit({ password: true, email: true })
  .partial()
  .extend({
    email: emailSchema.optional(),
  });

export const passwordResetSchema = z.object({
  new_password: z.string().min(8).max(128),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type PasswordResetInput = z.infer<typeof passwordResetSchema>;
