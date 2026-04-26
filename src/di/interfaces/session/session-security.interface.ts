import { Request, Response, NextFunction } from 'express';
import type { IOIDCAdapterBridge } from '../oidc-adapter-bridge.interface.js';

/**
 * Interface for session security operations
 * Handles session binding, timeouts, and concurrent session management
 */
export interface ISessionSecurity {
  /**
   * Set the OIDC adapter bridge for concurrent session management
   * @param bridge - OIDC adapter bridge instance
   */
  setOidcAdapterBridge(bridge: IOIDCAdapterBridge): void;

  /**
   * Enforce concurrent session limits for a user
   * Removes oldest sessions to make room for a new session
   * @param userId - User ID to enforce limits for
   * @param currentSessionId - Current session ID to exclude from the query
   * @returns Number of sessions removed
   */
  enforceSessionLimit(
    userId: string,
    currentSessionId?: string
  ): Promise<number>;

  /**
   * Validate session binding (IP address and User-Agent)
   * @param req - Express request object
   * @returns Object with validation result and reason for failure
   */
  validateSessionBinding(req: Request): { valid: boolean; reason?: string };

  /**
   * Create middleware to validate session binding (IP/User-Agent)
   * @returns Express middleware function
   */
  sessionBindingValidator(): (
    req: Request,
    res: Response,
    next: NextFunction
  ) => void;

  /**
   * Create middleware to enforce server-side idle timeout
   * @returns Express middleware function
   */
  idleTimeoutMiddleware(): (
    req: Request,
    res: Response,
    next: NextFunction
  ) => void;

  /**
   * Create middleware to enforce absolute session timeout
   * @returns Express middleware function
   */
  absoluteTimeoutMiddleware(): (
    req: Request,
    res: Response,
    next: NextFunction
  ) => void;

  /**
   * Revoke all Express sessions for a specific user
   * Used when admin disables an account to immediately log out the user
   * @param userId - Username or user ID to revoke sessions for
   * @returns Number of sessions revoked
   */
  revokeAllSessionsForUser(userId: string): Promise<number>;

  /**
   * Find all Express sessions for a specific user
   * @param accountId - Username or user ID to find sessions for
   * @returns Array of raw session documents from the session store
   */
  findExpressSessionsForUser(accountId: string): Promise<any[]>;

  /**
   * Revoke a single Express session by its session ID
   * @param sessionId - The session ID (_id in the store) to revoke
   * @returns true if the session was found and deleted, false otherwise
   */
  revokeExpressSession(sessionId: string): Promise<boolean>;

  /**
   * Find all authenticated Express sessions across all users with pagination
   * @param options - Optional pagination and search parameters
   * @returns Array of raw session documents from the session store
   */
  findAllExpressSessions(options?: {
    limit?: number;
    offset?: number;
    search?: string;
  }): Promise<any[]>;

  /**
   * Count all authenticated Express sessions across all users
   * @returns Total number of authenticated Express sessions
   */
  countAllExpressSessions(): Promise<number>;
}
