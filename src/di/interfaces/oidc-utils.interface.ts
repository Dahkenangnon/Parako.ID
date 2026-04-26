import type { Request } from 'express';
import type { KoaContextWithOIDC } from 'oidc-provider';
import type { SessionUserAccount } from '../../utils/session.js';

/**
 * Interface for OIDC utilities service
 */
export interface IOIDCUtils {
  // /**
  //  * Logout a user from OIDC system
  //  * @param accountId - The account ID to logout
  //  * @returns Promise with logout result
  //  */
  // logout(accountId: string): Promise<ClearOIDCUserDataResult>;

  /**
   * Get the user's preferred locale from the Koa context
   * @param ctx - The Koa context object
   * @param defaultLocale - Default locale if none is found
   * @returns The determined locale code
   */
  getLocale(ctx: KoaContextWithOIDC, defaultLocale?: string): string;

  /**
   * Parse cookies from Koa context
   * @param ctx - The Koa context
   * @returns Object with cookie name-value pairs
   */
  parseCookies(ctx: KoaContextWithOIDC): Record<string, string>;

  /**
   * Add or update an authenticated user in the session
   * @param req - Express request object
   * @param userAccount - User account data to add/update
   * @param makeActive - Whether to make this account the active one
   * @returns Boolean indicating success
   */
  addOrUpdateAccountInSession(
    req: Request,
    userAccount: SessionUserAccount,
    makeActive?: boolean
  ): boolean;

  /**
   * Sync Express session with OIDC session after consent
   * @param req - Express request object
   * @param accountId - The account ID to sync
   */
  syncSessionAfterConsent(req: Request, accountId: string): Promise<void>;

  /**
   * Prepare template variables for OIDC interaction pages
   * @param prompt - OIDC prompt object
   * @param params - OIDC parameters
   * @param req - Express request object
   * @returns Template variables object
   */
  prepareTemplateVariables(prompt: any, params: any, req: Request): any;

  /**
   * Format user data for templates
   * @param activeUser - Active user object
   * @returns Formatted user data
   */
  formatUserForTemplate(activeUser: any): any;

  /**
   * Transform scopes into readable format for templates
   * @param missingOIDCScope - Set of missing OIDC scopes
   * @returns Array of readable scope descriptions
   */
  transformScopesForTemplate(missingOIDCScope: Set<string>): string[];

  /**
   * Prepare accounts list for account selection template
   * @param authenticatedUsers - Authenticated users object
   * @returns Array of account objects
   */
  prepareAccountsList(authenticatedUsers: any): any[];

  /**
   * Validate login credentials
   * @param req - Express request object
   * @returns Validation result with credentials
   */
  validateLoginCredentials(req: Request): {
    isValid: boolean;
    identifier?: string;
    password?: string;
  };

  /**
   * Detect the type of identifier (email, phone, or custom identifier)
   *
   * This enables a single "identifier" field on the login form that auto-detects
   * whether the user entered an email, phone number, or custom identifier.
   *
   * @param identifier - The identifier string to analyze
   * @returns The detected identifier type
   */
  detectIdentifierType(
    identifier: string
  ):
    | 'email'
    | 'phone'
    | { type: 'custom_identifier'; slot: 1 | 2 | 3; key: string };

  /**
   * Validate MFA code
   * @param req - Express request object
   * @returns Validation result with code
   */
  validateMfaCode(req: Request): { isValid: boolean; code?: string };

  /**
   * Validate account selection
   * @param req - Express request object
   * @returns Validation result with account ID
   */
  validateAccountSelection(req: Request): {
    isValid: boolean;
    accountId?: string;
  };

  /**
   * Check if user has valid MFA setup
   * @param user - User object
   * @returns MFA validation result
   */
  validateMfaSetup(user: any): { hasMfa: boolean; method?: string };

  /**
   * Get application title
   * @returns Application title string
   */
  getAppTitle(): string;

  /**
   * Parse user agent string to extract browser and OS information
   * @param userAgent - User agent string
   * @returns Object with browser, os, and device information
   */
  parseUserAgent(userAgent: string): {
    browser: string;
    os: string;
    device: string;
  };

  /**
   * Format timestamp to relative time
   * @param timestamp - Unix timestamp
   * @param future - Whether the timestamp is in the future
   * @returns Formatted relative time string
   */
  formatTimeAgo(timestamp: number, future?: boolean): string;

  /**
   * Format timestamp to readable date string
   * @param timestamp - Unix timestamp
   * @returns Formatted date string
   */
  formatDate(timestamp: number): string;

  /**
   * Process session data and enrich with additional information
   * @param session - Session object
   * @returns Promise with processed session data
   */
  processSessionData(session: any): Promise<any>;

  /**
   * Process session data for export (simplified version)
   * @param session - Session object
   * @returns Promise with export-ready session data
   */
  processSessionForExport(session: any): Promise<any>;
}
