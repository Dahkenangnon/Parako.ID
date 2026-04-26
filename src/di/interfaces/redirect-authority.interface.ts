import type { Request, Response } from 'express';
import {
  RedirectIntent,
  RedirectValidationOptions,
  RedirectValidationResult,
  RedirectBuilder,
} from '../../utils/redirect-authority.js';

/**
 * Interface for redirect authority service
 * Defines the contract for redirect validation and intent management operations
 */
export interface IRedirectAuthority {
  /**
   * Validates a URL against trusted domains and security policies
   * @param url - The URL to validate
   * @param options - Validation options
   * @returns Validation result with isValid flag and processed URL
   */
  validateUrl(
    url: string,
    options?: RedirectValidationOptions
  ): RedirectValidationResult;

  /**
   * Stores a redirect intent securely in the user's session
   * @param req - Express request object
   * @param url - The redirect URL (will be validated)
   * @param intent - The purpose/intent of the redirect
   * @param metadata - Optional metadata to store with the intent
   * @param options - Validation options
   * @returns Whether the intent was successfully stored
   */
  storeIntent(
    req: Request,
    url: string,
    intent: string,
    metadata?: Record<string, unknown>,
    options?: RedirectValidationOptions
  ): Promise<boolean>;

  /**
   * Retrieves a redirect intent from the user's session
   * @param req - Express request object
   * @param expectedIntent - The expected intent type
   * @param consume - Whether to remove the intent after retrieval (default: true)
   * @param maxAge - Maximum age of intent in milliseconds (default: 1 hour)
   * @returns The redirect URL or null if not found/invalid
   */
  getIntent(
    req: Request,
    expectedIntent: string,
    consume?: boolean,
    maxAge?: number
  ): string | null;

  /**
   * Gets redirect intent with metadata
   * @param req - Express request object
   * @param expectedIntent - The expected intent type
   * @param consume - Whether to remove the intent after retrieval
   * @param maxAge - Maximum age of intent in milliseconds
   * @returns The redirect intent object or null
   */
  getIntentWithMetadata(
    req: Request,
    expectedIntent: string,
    consume?: boolean,
    maxAge?: number
  ): RedirectIntent | null;

  /**
   * Checks if a redirect intent exists without consuming it
   * @param req - Express request object
   * @param expectedIntent - The expected intent type (optional)
   * @returns Whether a valid intent exists
   */
  hasIntent(req: Request, expectedIntent?: string): boolean;

  /**
   * Clears any stored redirect intent
   * @param req - Express request object
   * @returns Whether intent was cleared
   */
  clearIntent(req: Request): boolean;

  /**
   * Builds a redirect URL with query parameters
   * @param baseUrl - The base URL
   * @param params - Query parameters to add
   * @returns The URL with parameters
   */
  buildRedirectUrl(baseUrl: string, params?: Record<string, string>): string;

  /**
   * Validates and builds a secure redirect URL with parameters
   * @param baseUrl - The base URL to validate and use
   * @param params - Query parameters to add
   * @param options - Validation options
   * @returns The validated URL with parameters, or null if invalid
   */
  buildSecureRedirectUrl(
    baseUrl: string,
    params?: Record<string, string>,
    options?: RedirectValidationOptions
  ): string | null;

  /**
   * Creates a fluent redirect builder for secure redirects
   * @param response - Express response object
   * @param options - Optional validation options
   * @returns RedirectBuilder instance for method chaining
   */
  redirect(
    response: Response,
    options?: RedirectValidationOptions
  ): RedirectBuilder;
}
