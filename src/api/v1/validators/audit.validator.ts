/**
 * Zod validation schemas for audit log query parameters.
 *
 * These schemas enforce the shape and constraints of incoming query
 * parameters before they reach the controller logic. The audit domain
 * is read-only so only filter schemas are needed.
 */

import { z } from 'zod';

export const auditQuerySchema = z.object({
  type: z.string().optional(),
  status: z.enum(['success', 'failed', 'info', 'warning']).optional(),
  username: z.string().optional(),
  client_id: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type AuditQueryInput = z.infer<typeof auditQuerySchema>;
