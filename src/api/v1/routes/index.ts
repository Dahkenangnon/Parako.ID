/**
 * API v1 route index for the Parako.ID Management API.
 *
 * Creates the top-level v1 router and mounts all domain-specific routers
 * under their respective path prefixes. Global middleware (JWT authentication
 * and audit logging) is applied once at this level so every downstream route
 * inherits it automatically.
 */

import { Router } from 'express';
import type { RequestHandler, ErrorRequestHandler } from 'express';

import type { RouteHandler } from './route-handler.js';
import { clientRoutes } from './clients.routes.js';
import { userRoutes } from './users.routes.js';
import { sessionRoutes } from './sessions.routes.js';
import { jwksRoutes } from './jwks.routes.js';
import { auditRoutes } from './audit.routes.js';
import { statsRoutes } from './stats.routes.js';
import { tenantRoutes } from './tenants.routes.js';
import { registrationTokenRoutes } from './registration-tokens.routes.js';
import { notFound } from '../errors.js';

// Controller interfaces (duck-typed method sets)

export interface IClientsRouteController {
  list: RouteHandler;
  create: RouteHandler;
  get: RouteHandler;
  update: RouteHandler;
  patch: RouteHandler;
  destroy: RouteHandler;
  activate: RouteHandler;
  deactivate: RouteHandler;
  regenerateSecret: RouteHandler;
  stats: RouteHandler;
}

export interface IUsersRouteController {
  list: RouteHandler;
  create: RouteHandler;
  get: RouteHandler;
  update: RouteHandler;
  patch: RouteHandler;
  destroy: RouteHandler;
  lock: RouteHandler;
  unlock: RouteHandler;
  passwordReset: RouteHandler;
  mfaReset: RouteHandler;
  activities: RouteHandler;
  sessions: RouteHandler;
}

export interface ISessionsRouteController {
  list: RouteHandler;
  get: RouteHandler;
  revoke: RouteHandler;
  bulkRevoke: RouteHandler;
}

export interface IJwksRouteController {
  list: RouteHandler;
  get: RouteHandler;
  rotate: RouteHandler;
  retireExpired: RouteHandler;
  retire: RouteHandler;
}

export interface IAuditRouteController {
  list: RouteHandler;
  get: RouteHandler;
  types: RouteHandler;
  stats: RouteHandler;
}

export interface IStatsRouteController {
  overview: RouteHandler;
  health: RouteHandler;
}

export interface ITenantsRouteController {
  list: RouteHandler;
  create: RouteHandler;
  get: RouteHandler;
  getConfig: RouteHandler;
  updateConfig: RouteHandler;
}

export interface IRegistrationTokensRouteController {
  list: RouteHandler;
  create: RouteHandler;
  get: RouteHandler;
  destroy: RouteHandler;
}

/** Dependencies injected into the v1 router factory. */
export interface ApiV1Dependencies {
  jwtAuth: RequestHandler;
  auditLogger: RequestHandler;
  errorHandler: ErrorRequestHandler;

  clientsController: IClientsRouteController;
  usersController: IUsersRouteController;
  sessionsController: ISessionsRouteController;
  jwksController: IJwksRouteController;
  auditController: IAuditRouteController;
  statsController: IStatsRouteController;
  tenantsController: ITenantsRouteController;
  registrationTokensController: IRegistrationTokensRouteController;
}

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
  router.all('/*unmatched', (req, _res, next) => {
    next(notFound(`No endpoint matches ${req.method} ${req.originalUrl}`));
  });

  // Error handler must be last
  router.use(deps.errorHandler);

  return router;
}
