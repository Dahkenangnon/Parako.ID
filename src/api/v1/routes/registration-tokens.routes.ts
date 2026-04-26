/**
 * Registration Tokens domain routes for the Parako.ID Management API v1.
 *
 * Mounts CRUD endpoints for DCR Initial Access Tokens under the
 * `/registration-tokens` prefix. Every route is guarded by a scope check
 * and a tiered rate limiter.
 */

import { Router } from 'express';

import type { IRegistrationTokensRouteController } from './index.js';
import { requireScope } from '../middleware/scope-guard.middleware.js';
import { apiRateLimiter } from '../middleware/rate-limiter.middleware.js';
import { SCOPES } from '../scopes.js';

/**
 * Create the `/registration-tokens` sub-router.
 *
 * @param controller  A `RegistrationTokensController` instance whose methods
 *                    are bound arrow functions (safe to pass as route handlers).
 */
export function registrationTokenRoutes(
  controller: IRegistrationTokensRouteController
): Router {
  const router = Router();

  // GET /registration-tokens — list active IATs
  router.get(
    '/',
    requireScope(SCOPES.REGISTRATION_TOKENS_READ),
    apiRateLimiter('read'),
    controller.list
  );

  // POST /registration-tokens — create a new IAT
  router.post(
    '/',
    requireScope(SCOPES.REGISTRATION_TOKENS_WRITE),
    apiRateLimiter('write'),
    controller.create
  );

  // GET /registration-tokens/:jti — get one IAT
  router.get(
    '/:jti',
    requireScope(SCOPES.REGISTRATION_TOKENS_READ),
    apiRateLimiter('read'),
    controller.get
  );

  // DELETE /registration-tokens/:jti — revoke an IAT
  router.delete(
    '/:jti',
    requireScope(SCOPES.REGISTRATION_TOKENS_DELETE),
    apiRateLimiter('delete'),
    controller.destroy
  );

  return router;
}
