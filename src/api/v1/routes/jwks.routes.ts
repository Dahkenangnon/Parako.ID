/**
 * JWKS domain routes for the Parako.ID Management API v1.
 *
 * Mounts key listing, single-key retrieval, rotation, expired-key
 * retirement, and single-key retirement endpoints under the `/jwks`
 * prefix. Every route is guarded by a scope check and a tiered rate
 * limiter appropriate to the operation.
 */

import { Router } from 'express';

import type { IJwksRouteController } from './index.js';
import { requireScope } from '../middleware/scope-guard.middleware.js';
import { apiRateLimiter } from '../middleware/rate-limiter.middleware.js';
import { SCOPES } from '../scopes.js';

/**
 * Create the `/jwks` sub-router.
 *
 * @param controller  A `JwksController` instance whose methods are
 *                    bound arrow functions (safe to pass as route handlers).
 */
export function jwksRoutes(controller: IJwksRouteController): Router {
  const router = Router();

  // GET /jwks — list all keys
  router.get(
    '/',
    requireScope(SCOPES.JWKS_READ),
    apiRateLimiter('read'),
    controller.list
  );

  // POST /jwks/rotate — rotate keys (must come before /:kid)
  router.post(
    '/rotate',
    requireScope(SCOPES.JWKS_ROTATE),
    apiRateLimiter('sensitive'),
    controller.rotate
  );

  // POST /jwks/retire-expired — retire expired keys (must come before /:kid)
  router.post(
    '/retire-expired',
    requireScope(SCOPES.JWKS_ROTATE),
    apiRateLimiter('sensitive'),
    controller.retireExpired
  );

  // GET /jwks/:kid — get one key
  router.get(
    '/:kid',
    requireScope(SCOPES.JWKS_READ),
    apiRateLimiter('read'),
    controller.get
  );

  // DELETE /jwks/:kid — retire a specific key
  router.delete(
    '/:kid',
    requireScope(SCOPES.JWKS_ROTATE),
    apiRateLimiter('sensitive'),
    controller.retire
  );

  return router;
}
