/**
 * Admin grant-listing query schema for `GET /admin/user-grants`.
 *
 * The `clientId` filter is regex-escaped via `usernameSchema`-style
 * treatment so a crafted value cannot inject metacharacters into a
 * Mongo `$regex` clause downstream.
 */

import { z } from 'zod';

import {
  limitSchema,
  pageSchema,
  searchSchema,
  sortOrderSchema,
  usernameSchema,
} from '../base-schemas.js';
import { escapeRegExp } from '../listing-query.js';

const ADMIN_GRANT_SORT_FIELDS = [
  'createdAt',
  'payload.iat',
  'payload.accountId',
  'payload.clientId',
] as const;

const grantClientIdSchema = z
  .string()
  .trim()
  .min(1, 'Client id is required')
  .max(100, 'Client id must be 100 characters or fewer')
  .transform(escapeRegExp)
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
