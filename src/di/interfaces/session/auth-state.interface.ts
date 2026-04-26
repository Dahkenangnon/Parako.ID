import { Request } from 'express';
import { SessionData, SessionUserAccount } from '../../../utils/session.js';

/**
 * Interface for authentication state management
 * Handles user authentication status and active user operations
 */
export interface IAuthState {
  /**
   * Check if user is authenticated in current session and their account is enabled
   * @param req - Express request object
   * @returns Promise<boolean> - true if authenticated and account is enabled
   */
  isAuthenticated(req: Request): Promise<boolean>;

  /**
   * Set session as authenticated with user data
   * @param req - Express request object
   * @param userData - Additional user data to store in session
   */
  setAuthenticated(req: Request, userData?: Partial<SessionData>): void;

  /**
   * Clear all authentication-related data from session
   * @param req - Express request object
   */
  clearAuthenticationData(req: Request): void;

  /**
   * Get the currently active user account
   * @param req - Express request object
   * @returns The active user account or undefined if not authenticated
   */
  getActiveUser(req: Request): SessionUserAccount | undefined;

  /**
   * Get a specific property from the active user
   * @param req - Express request object
   * @param property - Property name to retrieve
   * @returns Property value or undefined if not authenticated or property doesn't exist
   */
  getUserProperty<K extends keyof SessionUserAccount>(
    req: Request,
    property: K
  ): SessionUserAccount[K] | undefined;

  /**
   * Check if the active user has a specific role
   * @param req - Express request object
   * @param role - Role to check
   * @returns True if user has the role, false otherwise
   */
  hasRole(req: Request, role: string): boolean;

  /**
   * Check if the active user is an admin
   * @param req - Express request object
   * @returns True if user is admin, false otherwise
   */
  isAdmin(req: Request): boolean;
}
