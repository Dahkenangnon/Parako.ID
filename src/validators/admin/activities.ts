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

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const isoTimestampSchema = z.string().datetime();

function isValidActivityDate(value: string): boolean {
  if (DATE_ONLY_PATTERN.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime())) return false;
    return date.toISOString().slice(0, 10) === value;
  }
  return isoTimestampSchema.safeParse(value).success;
}

/** ISO date or timestamp accepted from the date-range pickers and API. */
const isoDateSchema = z
  .string()
  .refine(isValidActivityDate, {
    message: 'Date must be a valid ISO 8601 date or timestamp',
  })
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
