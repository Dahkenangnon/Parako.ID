/**
 * Schemas for the social-login routes
 * (`/auth/social/:provider/complete`,
 *  `/auth/social/:provider/callback`).
 *
 * `VALID_SOCIAL_PROVIDERS` is co-located here so the provider
 * allow-list lives next to its schema rather than being redefined at
 * the route mount site.
 */

import { z } from 'zod';

import { uuidSchema } from '../base-schemas.js';

export const VALID_SOCIAL_PROVIDERS = [
  'google',
  'github',
  'facebook',
  'linkedin',
  'microsoft',
  'apple',
  'twitter',
] as const;

export const socialProviderParamSchema = z.object({
  provider: z.enum(VALID_SOCIAL_PROVIDERS, {
    error: 'Unknown social provider',
  }),
});

export type SocialProviderParam = z.infer<typeof socialProviderParamSchema>;

/**
 * Ref query parameter used by `/auth/social/:provider/complete` to
 * correlate the tier-1 completion request with the prior social
 * callback. RFC 4122 UUID v4 in practice. `.passthrough()` keeps
 * any additional parameters the gateway forwards.
 */
export const socialRefQuerySchema = z
  .object({
    ref: uuidSchema,
  })
  .passthrough();

export type SocialRefQuery = z.infer<typeof socialRefQuerySchema>;
