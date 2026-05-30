/**
 * Tenant domain routes for the Parako.ID Management API v1.
 *
 * Mounts platform-only endpoints for tenant management and cross-tenant
 * configuration under the `/tenants` prefix. Every route is guarded by a
 * scope check and a tiered rate limiter appropriate to the operation.
 *
 * These are platform-level endpoints and require elevated scopes:
 * - `TENANTS_READ` / `TENANTS_WRITE` for listing, creating, and reading tenants
 * - `CROSS_TENANT_READ` / `CROSS_TENANT_WRITE` for reading and modifying
 *   tenant-specific configuration overrides
 */

import { Router } from 'express';

import type { ITenantsRouteController } from './index.js';
import { requireScope } from '../middleware/scope-guard.middleware.js';
import { apiRateLimiter } from '../middleware/rate-limiter.middleware.js';
import { validateBody } from '../middleware/validate-body.middleware.js';
import { SCOPES } from '../scopes.js';
import {
  createTenantSchema,
  updateConfigSectionSchema,
} from '../validators/tenants.validator.js';

/**
 * Create the `/tenants` sub-router.
 *
 * @param controller  A `TenantsController` instance whose methods are
 *                    bound arrow functions (safe to pass as route handlers).
 */
export function tenantRoutes(controller: ITenantsRouteController): Router {
  const router = Router();

  // GET /tenants — list all tenants
  router.get(
    '/',
    requireScope(SCOPES.TENANTS_READ),
    apiRateLimiter('read'),
    controller.list
  );

  // POST /tenants — create a new tenant
  router.post(
    '/',
    requireScope(SCOPES.TENANTS_WRITE),
    apiRateLimiter('write'),
    validateBody(createTenantSchema),
    controller.create
  );

  // GET /tenants/:slug — get a single tenant by slug
  router.get(
    '/:slug',
    requireScope(SCOPES.TENANTS_READ),
    apiRateLimiter('read'),
    controller.get
  );

  // GET /tenants/:slug/config — get tenant configuration overrides
  router.get(
    '/:slug/config',
    requireScope(SCOPES.CROSS_TENANT_READ),
    apiRateLimiter('read'),
    controller.getConfig
  );

  // PUT /tenants/:slug/config/:section — update a configuration section
  router.put(
    '/:slug/config/:section',
    requireScope(SCOPES.CROSS_TENANT_WRITE),
    apiRateLimiter('write'),
    validateBody(updateConfigSectionSchema),
    controller.updateConfig
  );

  return router;
}
