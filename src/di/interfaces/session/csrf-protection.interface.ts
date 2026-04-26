import { Request, Response, NextFunction } from 'express';

/**
 * Interface for CSRF protection operations
 * Handles CSRF token generation, validation, and protection middleware
 */
export interface ICsrfProtection {
  /**
   * Generate a secure CSRF token and store it in the session
   * @param req - Express request object
   * @returns Generated CSRF token
   */
  generateCsrfToken(req: Request): string;

  /**
   * Validate a CSRF token against the one stored in session
   * @param req - Express request object
   * @param token - CSRF token to validate
   * @returns true if token is valid, false otherwise
   */
  validateCsrfToken(req: Request, token: string): boolean;

  /**
   * Rotate CSRF token after sensitive operations
   * Should be called after: password change, account deletion, session management, MFA changes
   * @param req - Express request object
   * @returns New CSRF token
   */
  rotateCsrfToken(req: Request): string;

  /**
   * Middleware for CSRF protection
   * @returns Express middleware function
   */
  csrfProtection(): (req: Request, res: Response, next: NextFunction) => void;
}
