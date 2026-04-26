import { Response } from 'express';
import { CookieType, CookieOptions } from '../../utils/cookies.js';

/**
 * Interface for cookie manager service
 * Defines the contract for cookie management operations
 */
export interface ICookieManager {
  /**
   * Set a cookie with proper configuration based on cookie type and deployment environment
   * @param res - Express response object
   * @param cookieType - Type of cookie to set
   * @param value - Cookie value
   * @param options - Optional cookie options
   */
  setCookie(
    res: Response,
    cookieType: CookieType,
    value: string,
    options?: CookieOptions
  ): void;

  /**
   * Set a locale preference cookie
   * @param res - Express response object
   * @param locale - Locale value
   * @param options - Optional cookie options
   */
  setLocaleCookie(res: Response, locale: string, options?: CookieOptions): void;

  /**
   * Set a theme preference cookie
   * @param res - Express response object
   * @param theme - Theme value
   * @param options - Optional cookie options
   */
  setThemeCookie(res: Response, theme: string, options?: CookieOptions): void;

  /**
   * Set a session cookie
   * @param res - Express response object
   * @param sessionId - Session ID value
   * @param options - Optional cookie options
   */
  setSessionCookie(
    res: Response,
    sessionId: string,
    options?: CookieOptions
  ): void;

  /**
   * Get cookie configuration for a specific type
   * @param cookieType - Type of cookie
   * @returns Cookie configuration
   */
  getCookieConfig(cookieType: CookieType): CookieOptions;

  /**
   * Get default cookie configuration
   * @returns Default cookie configuration
   */
  getDefaultConfig(): CookieOptions;

  /**
   * Check if a cookie type is supported
   * @param cookieType - Cookie type to check
   * @returns True if cookie type is supported
   */
  isCookieTypeSupported(cookieType: string): cookieType is CookieType;
}
