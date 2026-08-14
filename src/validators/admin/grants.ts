/**
 * Admin grant-listing query schema for `GET /admin/user-grants`.
 *
 * The `clientId` filter remains literal because repositories apply it as
 * an exact-match field. Only the free-text search filter is regex-escaped.
 */

import { z } from 'zod';

import { ADMIN_GRANT_SORT_FIELDS } from '../listing-query.js';

import {
  limitSchema,
  pageSchema,
  searchSchema,
  sortOrderSchema,
  usernameSchema,
} from '../base-schemas.js';

const grantClientIdSchema = z
  .string()
  .trim()
  .min(1, 'Client id is required')
  .max(100, 'Client id must be 100 characters or fewer')
  .optional();

export const adminGrantListQuerySchema = z
  .object({
    page: pageSchema,
    limit: limitSchema,
    search: searchSchema,
    clientId: grantClientIdSchema,
    username: usernameSchema.optional(),
    sortBy: z.enum(ADMIN_GRANT_SORT_FIELDS).optional(),
    sortOrder: sortOrderSchema.optional(),
  })
  .passthrough();

export type AdminGrantListQuery = z.infer<typeof adminGrantListQuerySchema>;
