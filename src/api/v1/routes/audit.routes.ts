/**
 * Audit domain routes for the Parako.ID Management API v1.
 *
 * Mounts list, get, types, and stats endpoints under the `/audit`
 * prefix. Every route is guarded by a scope check and a tiered rate
 * limiter appropriate to the operation.
 *
 * IMPORTANT: `/types` and `/stats` must come before `/:id` to avoid
 * being matched as dynamic parameters.
 */

import { Router } from 'express';

import type { IAuditRouteController } from './index.js';
import { requireScope } from '../middleware/scope-guard.middleware.js';
import { apiRateLimiter } from '../middleware/rate-limiter.middleware.js';
import { SCOPES } from '../scopes.js';

/**
 * Create the `/audit` sub-router.
 *
 * @param controller  An `AuditController` instance whose methods are
 *                    bound arrow functions (safe to pass as route handlers).
 */
export function auditRoutes(controller: IAuditRouteController): Router {
  const router = Router();

  // GET /audit/types — distinct activity types (must come before /:id)
  router.get(
    '/types',
    requireScope(SCOPES.AUDIT_READ),
    apiRateLimiter('read'),
    controller.types
  );

  // GET /audit/stats — aggregate statistics (must come before /:id)
  router.get(
    '/stats',
    requireScope(SCOPES.STATS_READ),
    apiRateLimiter('read'),
    controller.stats
  );

  // GET /audit — list
  router.get(
    '/',
    requireScope(SCOPES.AUDIT_READ),
    apiRateLimiter('read'),
    controller.list
  );

  // GET /audit/:id — get one
  router.get(
    '/:id',
    requireScope(SCOPES.AUDIT_READ),
    apiRateLimiter('read'),
    controller.get
  );

  return router;
}
