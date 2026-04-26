/**
 * Zod validation schemas for session query parameters.
 *
 * Minimal schema — sessions are read-only OIDC adapter resources so the
 * only validation needed is on query filters for list and bulk operations.
 */

import { z } from 'zod';

export const sessionQuerySchema = z.object({
  username: z.string().max(255).optional(),
  client_id: z.string().max(255).optional(),
  active: z.enum(['true', 'false']).optional(),
});

export type SessionQueryInput = z.infer<typeof sessionQuerySchema>;
