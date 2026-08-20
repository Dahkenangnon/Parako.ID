/**
 * API v1 route index for the Parako.ID Management API.
 *
 * Creates the top-level v1 router and mounts all domain-specific routers
 * under their respective path prefixes. Global middleware (JWT authentication
 * and audit logging) is applied once at this level so every downstream route
 * inherits it automatically.
 */

import { Router } from 'express';

import type { ApiV1Dependencies } from './contracts.js';
import { clientRoutes } from './clients.routes.js';
import { userRoutes } from './users.routes.js';
import { sessionRoutes } from './sessions.routes.js';
import { jwksRoutes } from './jwks.routes.js';
import { auditRoutes } from './audit.routes.js';
import { statsRoutes } from './stats.routes.js';
import { tenantRoutes } from './tenants.routes.js';
import { registrationTokenRoutes } from './registration-tokens.routes.js';
import { notFound } from '../errors.js';

/**
 * Create the Express router for Management API v1.
 *
 * The returned router should be mounted at `/api/v1` by the application
 * bootstrap layer.
 */
export function createApiV1Router(deps: ApiV1Dependencies): Router {
  const router = Router();

  // Global middleware: JWT auth + audit logging
  router.use(deps.jwtAuth);
  router.use(deps.auditLogger);

  router.use('/clients', clientRoutes(deps.clientsController));
  router.use('/users', userRoutes(deps.usersController));
  router.use('/sessions', sessionRoutes(deps.sessionsController));
  router.use('/jwks', jwksRoutes(deps.jwksController));
  router.use('/audit', auditRoutes(deps.auditController));
  router.use('/stats', statsRoutes(deps.statsController));
  router.use('/tenants', tenantRoutes(deps.tenantsController));
  router.use(
    '/registration-tokens',
    registrationTokenRoutes(deps.registrationTokensController)
  );

  // Catch-all for unmatched routes — produces a 404 Problem Detail response
  router.all('/{*unmatched}', (req, _res, next) => {
    next(notFound(`No endpoint matches ${req.method} ${req.originalUrl}`));
  });

  // Error handler must be last
  router.use(deps.errorHandler);

  return router;
}
