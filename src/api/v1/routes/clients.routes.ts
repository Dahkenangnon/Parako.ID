/**
 * Client domain routes for the Parako.ID Management API v1.
 *
 * Mounts CRUD endpoints, lifecycle actions (activate / deactivate),
 * secret regeneration, and per-client statistics under the `/clients`
 * prefix. Every route is guarded by a scope check and a tiered rate
 * limiter appropriate to the operation.
 */

import { Router } from 'express';

import type { IClientsRouteController } from './index.js';
import { requireScope } from '../middleware/scope-guard.middleware.js';
import { apiRateLimiter } from '../middleware/rate-limiter.middleware.js';
import { validateBody } from '../middleware/validate-body.middleware.js';
import { SCOPES } from '../scopes.js';
import {
  createClientSchema,
  updateClientSchema,
} from '../validators/clients.validator.js';

/**
 * Create the `/clients` sub-router.
 *
 * @param controller  A `ClientsController` instance whose methods are
 *                    bound arrow functions (safe to pass as route handlers).
 */
export function clientRoutes(controller: IClientsRouteController): Router {
  const router = Router();

  // GET /clients — list
  router.get(
    '/',
    requireScope(SCOPES.CLIENTS_READ),
    apiRateLimiter('read'),
    controller.list
  );

  // POST /clients — create
  router.post(
    '/',
    requireScope(SCOPES.CLIENTS_WRITE),
    apiRateLimiter('write'),
    validateBody(createClientSchema),
    controller.create
  );

  // GET /clients/:client_id — get one
  router.get(
    '/:client_id',
    requireScope(SCOPES.CLIENTS_READ),
    apiRateLimiter('read'),
    controller.get
  );

  // PUT /clients/:client_id — full update
  router.put(
    '/:client_id',
    requireScope(SCOPES.CLIENTS_WRITE),
    apiRateLimiter('write'),
    validateBody(updateClientSchema),
    controller.update
  );

  // PATCH /clients/:client_id — partial update
  router.patch(
    '/:client_id',
    requireScope(SCOPES.CLIENTS_WRITE),
    apiRateLimiter('write'),
    validateBody(updateClientSchema),
    controller.patch
  );

  // DELETE /clients/:client_id — delete
  router.delete(
    '/:client_id',
    requireScope(SCOPES.CLIENTS_DELETE),
    apiRateLimiter('delete'),
    controller.destroy
  );

  // POST /clients/:client_id/activate
  router.post(
    '/:client_id/activate',
    requireScope(SCOPES.CLIENTS_WRITE),
    apiRateLimiter('write'),
    controller.activate
  );

  // POST /clients/:client_id/deactivate
  router.post(
    '/:client_id/deactivate',
    requireScope(SCOPES.CLIENTS_WRITE),
    apiRateLimiter('write'),
    controller.deactivate
  );

  // POST /clients/:client_id/secret — regenerate
  router.post(
    '/:client_id/secret',
    requireScope(SCOPES.CLIENTS_DELETE),
    apiRateLimiter('sensitive'),
    controller.regenerateSecret
  );

  router.get(
    '/:client_id/stats',
    requireScope(SCOPES.CLIENTS_READ),
    apiRateLimiter('read'),
    controller.stats
  );

  return router;
}
