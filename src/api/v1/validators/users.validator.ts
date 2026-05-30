/**
 * Zod validation schemas for user create / update / password-reset request bodies.
 *
 * These schemas enforce the shape and constraints of incoming payloads
 * before they reach the controller logic. The `updateUserSchema` makes
 * all fields optional (including email) for PUT and PATCH operations.
 */

import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  username: z.string().min(1).max(100).optional(),
  given_name: z.string().max(100).optional(),
  family_name: z.string().max(100).optional(),
  name: z.string().max(200).optional(),
  nickname: z.string().max(100).optional(),
  role: z.string().optional(),
  account_enabled: z.boolean().optional(),
});

export const updateUserSchema = createUserSchema
  .omit({ password: true, email: true })
  .partial()
  .extend({
    email: z.string().email().optional(),
  });

export const passwordResetSchema = z.object({
  new_password: z.string().min(8).max(128),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type PasswordResetInput = z.infer<typeof passwordResetSchema>;
