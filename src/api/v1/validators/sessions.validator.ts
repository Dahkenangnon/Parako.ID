/**
 * Zod validation schemas for session query parameters.
 *
 * Minimal schema — sessions are read-only OIDC adapter resources so the
 * only validation needed is on query filters for list and bulk operations.
 */

import { z } from 'zod';

const identifierFilter = z.string().trim().min(1).max(255);

export const sessionQuerySchema = z.object({
  username: identifierFilter.optional(),
  client_id: identifierFilter.optional(),
  active: z.enum(['true', 'false']).optional(),
});

export type SessionQueryInput = z.infer<typeof sessionQuerySchema>;
