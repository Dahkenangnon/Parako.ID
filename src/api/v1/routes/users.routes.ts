/**
 * User domain routes for the Parako.ID Management API v1.
 *
 * Mounts CRUD endpoints, account lifecycle actions (lock / unlock),
 * administrative password and MFA resets, and per-user activity and
 * session listing under the `/users` prefix. Every route is guarded
 * by a scope check and a tiered rate limiter appropriate to the
 * operation.
 */

import { Router } from 'express';

import type { IUsersRouteController } from './index.js';
import { requireScope } from '../middleware/scope-guard.middleware.js';
import { apiRateLimiter } from '../middleware/rate-limiter.middleware.js';
import { SCOPES } from '../scopes.js';

/**
 * Create the `/users` sub-router.
 *
 * @param controller  A `UsersController` instance whose methods are
 *                    bound arrow functions (safe to pass as route handlers).
 */
export function userRoutes(controller: IUsersRouteController): Router {
  const router = Router();

  // GET /users — list
  router.get(
    '/',
    requireScope(SCOPES.USERS_READ),
    apiRateLimiter('read'),
    controller.list
  );

  // POST /users — create
  router.post(
    '/',
    requireScope(SCOPES.USERS_WRITE),
    apiRateLimiter('write'),
    controller.create
  );

  // GET /users/:user_id — get one
  router.get(
    '/:user_id',
    requireScope(SCOPES.USERS_READ),
    apiRateLimiter('read'),
    controller.get
  );

  // PUT /users/:user_id — full update
  router.put(
    '/:user_id',
    requireScope(SCOPES.USERS_WRITE),
    apiRateLimiter('write'),
    controller.update
  );

  // PATCH /users/:user_id — partial update
  router.patch(
    '/:user_id',
    requireScope(SCOPES.USERS_WRITE),
    apiRateLimiter('write'),
    controller.patch
  );

  // DELETE /users/:user_id — destroy (anonymize)
  router.delete(
    '/:user_id',
    requireScope(SCOPES.USERS_DELETE),
    apiRateLimiter('delete'),
    controller.destroy
  );

  // POST /users/:user_id/lock — lock account
  router.post(
    '/:user_id/lock',
    requireScope(SCOPES.USERS_WRITE),
    apiRateLimiter('write'),
    controller.lock
  );

  // DELETE /users/:user_id/lock — unlock account
  router.delete(
    '/:user_id/lock',
    requireScope(SCOPES.USERS_WRITE),
    apiRateLimiter('write'),
    controller.unlock
  );

  // POST /users/:user_id/password-reset — admin password reset
  router.post(
    '/:user_id/password-reset',
    requireScope(SCOPES.USERS_WRITE),
    apiRateLimiter('sensitive'),
    controller.passwordReset
  );

  // POST /users/:user_id/mfa/reset — reset MFA
  router.post(
    '/:user_id/mfa/reset',
    requireScope(SCOPES.USERS_WRITE),
    apiRateLimiter('sensitive'),
    controller.mfaReset
  );

  // GET /users/:user_id/activities — user activity log
  router.get(
    '/:user_id/activities',
    requireScope(SCOPES.USERS_READ),
    apiRateLimiter('read'),
    controller.activities
  );

  // GET /users/:user_id/sessions — user sessions
  router.get(
    '/:user_id/sessions',
    requireScope(SCOPES.SESSIONS_READ),
    apiRateLimiter('read'),
    controller.sessions
  );

  return router;
}
