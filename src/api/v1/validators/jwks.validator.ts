/**
 * Zod validation schemas for JWKS query parameters.
 *
 * Minimal schema — JWKS endpoints are mostly parameterless. The only
 * validation needed is an optional `status` filter on the list endpoint.
 */

import { z } from 'zod';

export const jwksQuerySchema = z.object({
  status: z.enum(['active', 'expiring', 'retired']).optional(),
});

export type JwksQueryInput = z.infer<typeof jwksQuerySchema>;
