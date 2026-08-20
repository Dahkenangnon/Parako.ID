import type { ErrorRequestHandler, RequestHandler } from 'express';

import type { RouteHandler } from './route-handler.js';

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
