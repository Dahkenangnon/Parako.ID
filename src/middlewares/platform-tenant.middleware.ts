/**
 * Platform Tenant Route Guard Middleware
 *
 * Restricts the `_platforms` admin portal to explicit platform roles or
 * the built-in administrator roles. Viewers remain read-only, while `admin`
 * and `superadmin` inherit `platform_admin` within this tenant.
 *
 * Security:
 * - Rejects unauthenticated users (401)
 * - Rejects users without platform or built-in administrator roles (403)
 * - Prevents write operations (POST/PUT/DELETE) for viewers (403)
 * - Sets `req.platformRole` for downstream authorization checks
 */

import type { Request, Response, NextFunction } from 'express';
import { injectable, inject } from 'inversify';
import { TYPES } from '../di/types.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { ISessionManager } from '../di/interfaces/session-manager.interface.js';
import {
  PLATFORM_ROLES,
  type PlatformRole,
} from '../multi-tenancy/platform-roles.js';

export type { PlatformRole } from '../multi-tenancy/platform-roles.js';

/** HTTP methods that mutate state (blocked for viewers). */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@injectable()
export class PlatformTenantMiddleware {
  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager
  ) {}

  public handler = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    // 1. Authentication check
    const isAuthenticated = await this.sessionManager.isAuthenticated(req);
    if (!isAuthenticated) {
      this.logger.warn('platform_auth_rejected', {
        reason: 'unauthenticated',
        path: req.path,
      });
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // 2. Resolve platform role (highest-privilege first)
    let resolvedRole = PLATFORM_ROLES.find(role =>
      this.sessionManager.hasRole(req, role)
    );

    // Built-in administrators on _platforms inherit platform_admin. Explicit
    // platform roles remain authoritative so platform_viewer stays read-only.
    if (
      !resolvedRole &&
      ['admin', 'superadmin'].some(role =>
        this.sessionManager.hasRole(req, role)
      )
    ) {
      resolvedRole = 'platform_admin';
    }

    if (!resolvedRole) {
      this.logger.warn('platform_role_rejected', {
        path: req.path,
        user: this.sessionManager.getActiveUser(req)?.username,
      });
      res.status(403).json({ error: 'Platform role required' });
      return;
    }

    // 3. Write protection for viewers
    if (resolvedRole === 'platform_viewer' && WRITE_METHODS.has(req.method)) {
      this.logger.warn('platform_write_blocked', {
        method: req.method,
        path: req.path,
        role: resolvedRole,
      });
      res.status(403).json({ error: 'Write access requires platform_admin' });
      return;
    }

    // 4. Annotate both the request and view locals. Controllers can perform
    // explicit authorization checks and templates can omit mutation controls
    // for read-only platform viewers.
    (req as Request & { platformRole?: PlatformRole }).platformRole =
      resolvedRole;
    res.locals.platformRole = resolvedRole;

    next();
  };
}
