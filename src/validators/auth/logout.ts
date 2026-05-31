/**
 * Logout query-parameter schema for /auth/logout (GET and POST).
 *
 * The `info`, `secondary`, and `confirmed` fields are *string*
 * booleans intentionally: downstream controller code at
 * `src/controllers/auth.controller.ts` compares them with `=== 'true'`,
 * so swapping in real booleans would silently invert the flag. The
 * shared `stringBoolSchema` makes the contract explicit.
 *
 * Redirect targets (`redirect_uri`, `cancel_url`, `next`) are
 * structurally validated only; trust policy is enforced by
 * `RedirectAuthority.validateUrl()` at the controller boundary.
 */

import { z } from 'zod';

import {
  emailSchema,
  redirectStringSchema,
  stringBoolSchema,
} from '../base-schemas.js';

const logoutTypeValues = ['single', 'all'] as const;

/**
 * Logout GET / POST routes accept additional query parameters the
 * provider can forward (e.g. OIDC `id_token_hint`, `post_logout_redirect_uri`,
 * `state`). `.passthrough()` preserves them; declared fields are
 * still structurally validated.
 */
export const logoutQuerySchema = z
  .object({
    type: z.enum(logoutTypeValues).optional(),
    account_id: z
      .string()
      .max(100, 'Account id must be 100 characters or fewer')
      .optional(),
    redirect_uri: redirectStringSchema,
    cancel_url: redirectStringSchema,
    email: emailSchema.optional(),
    name: z
      .string()
      .max(100, 'Name must be 100 characters or fewer')
      .optional(),
    info: stringBoolSchema.optional(),
    secondary: stringBoolSchema.optional(),
    confirmed: stringBoolSchema.optional(),
    next: redirectStringSchema,
  })
  .passthrough();

export type LogoutQuery = z.infer<typeof logoutQuerySchema>;
