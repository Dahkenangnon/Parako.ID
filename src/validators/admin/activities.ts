/**
 * Admin activity-listing schemas for `GET /admin/activities` and the
 * per-user sub-listing at `GET /admin/users/:id/activities`.
 */

import { z } from 'zod';

import {
  limitSchema,
  pageSchema,
  searchSchema,
  sortOrderSchema,
  usernameSchema,
} from '../base-schemas.js';
import { ADMIN_ACTIVITY_SORT_FIELDS } from '../listing-query.js';

const activityStatusFilterValues = [
  'all',
  'success',
  'failed',
  'info',
  'warning',
] as const;

/** Free-text activity type filter (event name fragment). */
const activityTypeFilterSchema = z
  .string()
  .max(50, 'Activity type must be 50 characters or fewer')
  .optional();

/** ISO 8601 date string used by the date-range pickers. */
const isoDateSchema = z
  .string()
  .datetime({ message: 'Date must be a valid ISO 8601 timestamp' })
  .optional();

export const adminActivityListQuerySchema = z
  .object({
    page: pageSchema,
    limit: limitSchema,
    search: searchSchema,
    type: activityTypeFilterSchema,
    status: z.enum(activityStatusFilterValues).optional(),
    username: usernameSchema.optional(),
    dateFrom: isoDateSchema,
    dateTo: isoDateSchema,
    sortBy: z.enum(ADMIN_ACTIVITY_SORT_FIELDS).optional(),
    sortOrder: sortOrderSchema.optional(),
  })
  .passthrough();

export type AdminActivityListQuery = z.infer<
  typeof adminActivityListQuerySchema
>;

export const userActivityListQuerySchema = z
  .object({
    page: pageSchema,
    limit: limitSchema,
    type: activityTypeFilterSchema,
  })
  .passthrough();

export type UserActivityListQuery = z.infer<typeof userActivityListQuerySchema>;
