/**
 * Stats domain routes for the Parako.ID Management API v1.
 *
 * Mounts overview and health-check endpoints under the `/stats`
 * prefix. Every route is guarded by a scope check and a tiered rate
 * limiter appropriate to the operation.
 */

import { Router } from 'express';

import type { IStatsRouteController } from './index.js';
import { requireScope } from '../middleware/scope-guard.middleware.js';
import { apiRateLimiter } from '../middleware/rate-limiter.middleware.js';
import { SCOPES } from '../scopes.js';

/**
 * Create the `/stats` sub-router.
 *
 * @param controller  A `StatsController` instance whose methods are
 *                    bound arrow functions (safe to pass as route handlers).
 */
export function statsRoutes(controller: IStatsRouteController): Router {
  const router = Router();

  // GET /stats — aggregate overview
  router.get(
    '/',
    requireScope(SCOPES.STATS_READ),
    apiRateLimiter('read'),
    controller.overview
  );

  // GET /stats/health — system health check
  router.get(
    '/health',
    requireScope(SCOPES.STATS_READ),
    apiRateLimiter('read'),
    controller.health
  );

  return router;
}
