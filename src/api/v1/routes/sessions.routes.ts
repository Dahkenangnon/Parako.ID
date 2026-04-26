/**
 * Session domain routes for the Parako.ID Management API v1.
 *
 * Mounts list, get, revoke, and bulk-revoke endpoints under the
 * `/sessions` prefix. Every route is guarded by a scope check and a
 * tiered rate limiter appropriate to the operation.
 */

import { Router } from 'express';

import type { ISessionsRouteController } from './index.js';
import { requireScope } from '../middleware/scope-guard.middleware.js';
import { apiRateLimiter } from '../middleware/rate-limiter.middleware.js';
import { SCOPES } from '../scopes.js';

/**
 * Create the `/sessions` sub-router.
 *
 * @param controller  A `SessionsController` instance whose methods are
 *                    bound arrow functions (safe to pass as route handlers).
 */
export function sessionRoutes(controller: ISessionsRouteController): Router {
  const router = Router();

  // GET /sessions — list
  router.get(
    '/',
    requireScope(SCOPES.SESSIONS_READ),
    apiRateLimiter('read'),
    controller.list
  );

  // GET /sessions/:jti — get one
  router.get(
    '/:jti',
    requireScope(SCOPES.SESSIONS_READ),
    apiRateLimiter('read'),
    controller.get
  );

  // DELETE /sessions/:jti — revoke one
  router.delete(
    '/:jti',
    requireScope(SCOPES.SESSIONS_REVOKE),
    apiRateLimiter('delete'),
    controller.revoke
  );

  // DELETE /sessions — bulk revoke
  router.delete(
    '/',
    requireScope(SCOPES.SESSIONS_REVOKE),
    apiRateLimiter('delete'),
    controller.bulkRevoke
  );

  return router;
}
