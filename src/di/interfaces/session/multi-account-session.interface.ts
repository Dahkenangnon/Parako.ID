import { Request } from 'express';
import {
  SessionUserAccount,
  AuthenticatedUsers,
} from '../../../utils/session.js';

/**
 * Result of adding an authenticated user to session
 */
export type AddAuthenticatedUserResult = {
  success: boolean;
  reason?: 'already_exists' | 'max_limit_reached' | 'multi_account_disabled';
};

/**
 * Result of switching to a different authenticated user
 */
export type SwitchUserResult = {
  success: boolean;
  reason?: 'user_not_found' | 'reauth_required';
};

/**
 * Interface for multi-account session support
 * Handles multiple authenticated users within a single browser session
 */
export interface IMultiAccountSession {
  /**
   * Get all authenticated user accounts
   * @param req - Express request object
   * @returns Object containing active and other user accounts
   */
  getAuthenticatedUsers(req: Request): AuthenticatedUsers | undefined;

  /**
   * Switch to a different authenticated user
   * @param req - Express request object
   * @param userId - ID of the user to switch to
   * @returns Result object with success flag and optional reason for failure
   */
  switchUser(req: Request, userId: string): SwitchUserResult;

  /**
   * Add another authenticated user to the session
   * @param req - Express request object
   * @param userAccount - User account to add
   * @param setAsActive - Whether to set this user as the active user
   * @returns Result object with success flag and optional reason for failure
   */
  addAuthenticatedUser(
    req: Request,
    userAccount: SessionUserAccount,
    setAsActive?: boolean
  ): AddAuthenticatedUserResult;

  /**
   * Remove an authenticated user from the session
   * Also revokes OIDC grants for the removed account
   * @param req - Express request object
   * @param userId - ID of the user to remove
   * @returns true if the user was removed, false if not found
   */
  removeAuthenticatedUser(req: Request, userId: string): Promise<boolean>;

  /**
   * Update specific fields of the active user account in session
   * @param req - Express request object
   * @param updates - Partial user data to update
   * @returns true if update was successful, false otherwise
   */
  updateActiveUserData(
    req: Request,
    updates: Partial<SessionUserAccount>
  ): boolean;
}
