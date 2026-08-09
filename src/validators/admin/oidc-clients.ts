/**
 * Admin OIDC-client schemas: listing query, source-only query for
 * view/edit/delete URLs, and create / edit form bodies.
 *
 * The application-type, environment, status, and source enums
 * capture structural rules only — the substantive client policy
 * lives in `OidcClientService` and the admin UI, not in this schema.
 */

import { z } from 'zod';

import {
  limitSchema,
  pageSchema,
  searchSchema,
  sortOrderSchema,
} from '../base-schemas.js';
import { ADMIN_OIDC_CLIENT_SORT_FIELDS } from '../listing-query.js';

const APPLICATION_TYPE_VALUES = ['web', 'native', 'spa'] as const;
const ENVIRONMENT_FILTER_VALUES = [
  'development',
  'staging',
  'production',
  'all',
] as const;
const STATUS_FILTER_VALUES = ['active', 'inactive', 'all'] as const;
const SOURCE_FILTER_VALUES = ['static', 'dynamic', 'database'] as const;
export const adminOidcClientListQuerySchema = z
  .object({
    page: pageSchema,
    limit: limitSchema,
    search: searchSchema,
    application_type: z.enum(APPLICATION_TYPE_VALUES).optional(),
    environment: z.enum(ENVIRONMENT_FILTER_VALUES).optional(),
    status: z.enum(STATUS_FILTER_VALUES).optional(),
    source: z.enum(SOURCE_FILTER_VALUES).optional(),
    sortBy: z.enum(ADMIN_OIDC_CLIENT_SORT_FIELDS).optional(),
    sortOrder: sortOrderSchema.optional(),
  })
  .passthrough();

export type AdminOidcClientListQuery = z.infer<
  typeof adminOidcClientListQuerySchema
>;

/**
 * Source-only query schema for `GET /admin/oidc-clients/view/:id` and
 * `GET /admin/oidc-clients/edit/:id`.
 */
export const oidcClientSourceQuerySchema = z
  .object({
    source: z.enum(SOURCE_FILTER_VALUES).optional(),
  })
  .passthrough();

export type OidcClientSourceQuery = z.infer<typeof oidcClientSourceQuerySchema>;

/**
 * Body schema for `POST /admin/oidc-clients`. Only `client_name` and
 * `application_type` are enforced here; the controller and service
 * layer perform the substantive OIDC client validation.
 */
export const adminOidcClientCreateBodySchema = z
  .object({
    client_name: z.string().trim().min(1, 'Client name is required'),
    application_type: z.enum(APPLICATION_TYPE_VALUES, {
      error: 'Valid application type is required',
    }),
  })
  .passthrough();

export type AdminOidcClientCreateBody = z.infer<
  typeof adminOidcClientCreateBodySchema
>;

/** Body schema for `POST /admin/oidc-clients/edit/:id`. */
export const adminOidcClientUpdateBodySchema = z
  .object({
    client_name: z.string().trim().min(1, 'Client name is required'),
    application_type: z.enum(APPLICATION_TYPE_VALUES, {
      error: 'Valid application type is required',
    }),
  })
  .passthrough();

export type AdminOidcClientUpdateBody = z.infer<
  typeof adminOidcClientUpdateBodySchema
>;
