/**
 * OAuth callback query-parameter schema for
 * /auth/social/:provider/callback.
 *
 * Structural validation only — OAuth state-checking and code-exchange
 * authorisation live in `auth.controller.socialCallback`.
 */

import { z } from 'zod';

/**
 * OAuth providers return varying additional parameters on callback
 * (e.g. `scope`, `id_token`, provider-specific extensions).
 * `.passthrough()` preserves them; declared fields are still
 * structurally validated.
 */
export const oauthCallbackQuerySchema = z
  .object({
    code: z
      .string()
      .max(2000, 'Code must be 2000 characters or fewer')
      .optional(),
    state: z
      .string()
      .max(500, 'State must be 500 characters or fewer')
      .optional(),
    error: z
      .string()
      .max(100, 'Error code must be 100 characters or fewer')
      .optional(),
    error_description: z
      .string()
      .max(500, 'Error description must be 500 characters or fewer')
      .optional(),
  })
  .passthrough();

export type OAuthCallbackQuery = z.infer<typeof oauthCallbackQuerySchema>;
