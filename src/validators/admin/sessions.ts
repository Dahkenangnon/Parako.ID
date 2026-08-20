import { z } from 'zod';

import {
  limitSchema,
  literalSearchSchema,
  pageSchema,
  sortOrderSchema,
} from '../base-schemas.js';
import { ADMIN_SESSION_SORT_FIELDS } from '../listing-query.js';

const sessionStatusFilterValues = ['all', 'active', 'expired'] as const;
const sessionUsernameFilterSchema = z
  .string()
  .trim()
  .min(1, 'Username is required')
  .max(100, 'Username must be 100 characters or fewer');

export const adminSessionListQuerySchema = z
  .object({
    page: pageSchema,
    limit: limitSchema,
    search: literalSearchSchema,
    username: sessionUsernameFilterSchema.optional(),
    status: z.enum(sessionStatusFilterValues).optional(),
    sortBy: z.enum(ADMIN_SESSION_SORT_FIELDS).optional(),
    sortOrder: sortOrderSchema.optional(),
  })
  .passthrough();

export type AdminSessionListQuery = z.infer<typeof adminSessionListQuerySchema>;
