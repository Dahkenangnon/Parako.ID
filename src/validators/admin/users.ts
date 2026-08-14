/**
 * Admin users-domain schemas for the listing GET and the create / edit
 * form POSTs.
 *
 * Password rules are NOT enforced here. The runtime password policy
 * (length, complexity, history) is tenant-configurable and is checked
 * in `UserService.validatePassword`. A static schema-layer rule would
 * either silently disagree with the runtime check or under-enforce
 * the configured policy.
 */

import { z } from 'zod';

import {
  emailSchema,
  limitSchema,
  pageSchema,
  literalSearchSchema,
  sortOrderSchema,
} from '../base-schemas.js';
import { ADMIN_USER_SORT_FIELDS } from '../listing-query.js';

const userRoleFilterValues = ['user', 'admin', 'moderator', 'all'] as const;
const userStatusFilterValues = [
  'all',
  'active',
  'disabled',
  'anonymized',
] as const;

export const adminUserListQuerySchema = z
  .object({
    page: pageSchema,
    limit: limitSchema,
    search: literalSearchSchema,
    role: z.enum(userRoleFilterValues).optional(),
    status: z.enum(userStatusFilterValues).optional(),
    sortBy: z.enum(ADMIN_USER_SORT_FIELDS).optional(),
    sortOrder: sortOrderSchema.optional(),
  })
  .passthrough();

export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;

/**
 * Body schema for `POST /admin/users/new`.
 *
 * `.passthrough()` is intentional: the controller consumes additional
 * optional profile fields (`gender`, `birthdate`, `roles`, address
 * components, locale, custom identifiers, etc.) that are not
 * structurally validated here. The controller's explicit destructuring
 * is the mass-assignment boundary — the schema enforces only the
 * required-field and type rules.
 */
export const adminUserCreateBodySchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1, 'Password is required'),
    given_name: z.string().trim().min(1, 'First name is required'),
    family_name: z.string().trim().min(1, 'Last name is required'),
  })
  .passthrough();

export type AdminUserCreateBody = z.infer<typeof adminUserCreateBodySchema>;

/** Body schema for `POST /admin/users/:id/edit`. See create note for `.passthrough()` rationale. */
export const adminUserUpdateBodySchema = z
  .object({
    email: emailSchema,
    given_name: z.string().trim().min(1, 'First name is required'),
    family_name: z.string().trim().min(1, 'Last name is required'),
  })
  .passthrough();

export type AdminUserUpdateBody = z.infer<typeof adminUserUpdateBodySchema>;
