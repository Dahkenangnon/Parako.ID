/**
 * Zod validation schemas for audit log query parameters.
 *
 * These schemas enforce the shape and constraints of incoming query
 * parameters before they reach the controller logic. The audit domain
 * is read-only so only filter schemas are needed.
 */

import { z } from 'zod';

const auditFilterSchema = z.string().trim().min(1).max(255);
const auditTimestampSchema = z.string().datetime({ offset: true });

export const auditQuerySchema = z
  .object({
    type: auditFilterSchema.optional(),
    status: z.enum(['success', 'failed', 'info', 'warning']).optional(),
    username: auditFilterSchema.optional(),
    client_id: auditFilterSchema.optional(),
    from: auditTimestampSchema.optional(),
    to: auditTimestampSchema.optional(),
  })
  .superRefine((query, context) => {
    if (
      query.from !== undefined &&
      query.to !== undefined &&
      Date.parse(query.from) > Date.parse(query.to)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'to must be at or after from',
      });
    }
  });

export type AuditQueryInput = z.infer<typeof auditQuerySchema>;
