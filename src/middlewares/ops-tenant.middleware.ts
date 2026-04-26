/**
 * Ops Tenant Route Guard Middleware
 *
 * Restricts the `_ops` infrastructure tenant to a narrow whitelist of
 * routes and enforces GET-only access. All other requests receive 404
 * (unrecognized route) or 405 (wrong method).
 *
 * Whitelisted routes:
 *   GET /social/:provider/callback  — OAuth callback relay
 *   GET /health                     — Health probe
 *   GET /metrics                    — Metrics endpoint
 */

import type { Request, Response, NextFunction } from 'express';
import { injectable, inject } from 'inversify';
import { TYPES } from '../di/types.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';

/**
 * Route patterns that _ops accepts. Each pattern is a regex that
 * must match the full `req.path`.
 */
const ALLOWED_ROUTES: RegExp[] = [
  /^\/social\/[a-z][a-z0-9-]*\/callback$/,
  /^\/health$/,
  /^\/metrics$/,
];

function isAllowedRoute(path: string): boolean {
  return ALLOWED_ROUTES.some(pattern => pattern.test(path));
}

@injectable()
export class OpsTenantMiddleware {
  constructor(@inject(TYPES.Logger) private readonly logger: ILogger) {}

  public handler = (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'GET') {
      this.logger.warn('ops_method_blocked', {
        method: req.method,
        path: req.path,
      });
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    if (!isAllowedRoute(req.path)) {
      this.logger.warn('ops_route_blocked', {
        path: req.path,
      });
      res.status(404).json({ error: 'Not found' });
      return;
    }

    next();
  };
}
