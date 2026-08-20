import { z } from 'zod';

import { CONFIGURABLE_SOCIAL_PROVIDER_IDS } from '../../config/social-providers.js';
import { uuidSchema } from '../base-schemas.js';

export const VALID_SOCIAL_PROVIDERS = CONFIGURABLE_SOCIAL_PROVIDER_IDS;

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
