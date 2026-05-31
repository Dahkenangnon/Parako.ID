/**
 * Admin session-listing query schema for `GET /admin/sessions`.
 */

import { z } from 'zod';

import {
  limitSchema,
  pageSchema,
  searchSchema,
  sortOrderSchema,
  usernameSchema,
} from '../base-schemas.js';
import { ADMIN_SESSION_SORT_FIELDS } from '../listing-query.js';

const sessionStatusFilterValues = ['all', 'active', 'expired'] as const;

export const adminSessionListQuerySchema = z
  .object({
    page: pageSchema,
    limit: limitSchema,
    search: searchSchema,
    username: usernameSchema.optional(),
    status: z.enum(sessionStatusFilterValues).optional(),
    sortBy: z.enum(ADMIN_SESSION_SORT_FIELDS).optional(),
    sortOrder: sortOrderSchema.optional(),
  })
  .passthrough();

export type AdminSessionListQuery = z.infer<typeof adminSessionListQuerySchema>;
