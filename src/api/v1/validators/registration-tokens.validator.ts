/**
 * Zod validation schemas for registration token (DCR IAT) endpoints.
 */

import { z } from 'zod';

export const createRegistrationTokenSchema = z.object({
  /** Token lifetime in seconds. Min 5 minutes, max 30 days. */
  expires_in: z
    .number()
    .int()
    .min(300, 'Minimum expiry is 300 seconds (5 minutes)')
    .max(2_592_000, 'Maximum expiry is 2592000 seconds (30 days)'),

  /** Maximum number of client registrations this token can authorize. */
  max_usage_count: z
    .number()
    .int()
    .min(1, 'Must allow at least 1 registration')
    .max(1000, 'Maximum usage count is 1000'),

  /** Registration policies to attach. Defaults to ['general-policy']. */
  policies: z
    .array(z.string().min(1).max(128))
    .min(1)
    .max(10)
    .default(['general-policy']),

  /** Optional admin note for identifying the token's purpose. */
  note: z.string().max(500).optional(),
});

export type CreateRegistrationTokenInput = z.infer<
  typeof createRegistrationTokenSchema
>;
