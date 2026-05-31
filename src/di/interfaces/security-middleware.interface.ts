import { Request, Response, NextFunction } from 'express';

/**
 * Interface for SecurityMiddleware - handles authentication, authorization, and CSRF protection.
 */
export interface ISecurityMiddleware {
  /**
   * Middleware to require authentication
   * Redirects to login page if user is not authenticated
   */
  requireAuth: (
    req: Request,
    res: Response,
    next: NextFunction
  ) => Promise<void>;

  /**
   * Middleware to require specific roles
   * Redirects to login page if user doesn't have required role
   */
  requireRole: (
    role: string
  ) => (req: Request, res: Response, next: NextFunction) => Promise<void>;

  /**
   * Middleware to require admin privileges
   * Redirects to login page if user is not admin
   */
  requireAdmin: (
    req: Request,
    res: Response,
    next: NextFunction
  ) => Promise<void>;

  /**
   * Middleware to require specific permissions
   */
  requirePermissions: (
    permissions: string[]
  ) => (req: Request, res: Response, next: NextFunction) => Promise<void>;

  /**
   * Regenerate session after authentication state changes
   * Helps prevent session fixation attacks
   */
  regenerateSession: (
    req: Request,
    res: Response,
    next: NextFunction
  ) => Promise<void>;

  /**
   * Middleware to generate CSRF token and set it in res.locals for views
   */
  generateCsrfToken: (req: Request, res: Response, next: NextFunction) => void;

  /**
   * Middleware to validate CSRF token on non-GET requests
   */
  validateCsrfToken: (req: Request, res: Response, next: NextFunction) => void;

  /**
   * Middleware to restrict access to platform-only settings.
   * Allows access only from _platforms tenant or when multi-tenancy is disabled.
   */
  requirePlatformTenant: (
    req: Request,
    res: Response,
    next: NextFunction
  ) => void;

  /**
   * Sets up all security middleware in one call.
   * Combines authentication and CSRF protection.
   */
  setupAllSecurity: (
    authLevel: 'none' | 'user' | 'admin',
    enableCsrf: boolean
  ) => any[];
}
