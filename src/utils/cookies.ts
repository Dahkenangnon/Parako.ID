import { Response } from 'express';
import { injectable, inject } from 'inversify';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { ICookieManager } from '../di/interfaces/cookie-manager.interface.js';
import { TYPES } from '../di/types.js';

export type CookieType = 'locale' | 'theme' | 'session';

export interface CookieOptions {
  name?: string;
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
  path?: string;
}

/**
 * Cookie utility class for managing application cookies with proper configuration
 */
@injectable()
export class CookieManager implements ICookieManager {
  // /**
  //  * Injected dependencies
  //  */
  // private configManager: IConfigManager;

  /**
   * Constructor with dependency injection
   * @param configManager - Configuration manager instance
   */
  constructor(
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager
  ) {}
  /**
   * Set a cookie with proper configuration based on cookie type and deployment environment
   */
  setCookie = (
    res: Response,
    cookieType: CookieType,
    value: string,
    options?: CookieOptions
  ): void => {
    const cookieConfig =
      this.configManager.getConfig().deployment.cookies.types[cookieType];
    const defaultConfig =
      this.configManager.getConfig().deployment.cookies.defaults;

    res.cookie(cookieConfig.name, value, {
      maxAge: options?.maxAge ?? cookieConfig.maxAge,
      httpOnly: options?.httpOnly ?? cookieConfig.httpOnly,
      secure:
        options?.secure ??
        (this.configManager.getConfig().deployment.environment === 'production'
          ? cookieConfig.secure
          : false),
      sameSite: options?.sameSite ?? cookieConfig.sameSite,
      path: options?.path ?? defaultConfig.path,
    });
  };

  /**
   * Set a locale preference cookie
   */
  setLocaleCookie = (
    res: Response,
    locale: string,
    options?: CookieOptions
  ): void => {
    this.setCookie(res, 'locale', locale, options);
  };

  /**
   * Set a theme preference cookie
   */
  setThemeCookie = (
    res: Response,
    theme: string,
    options?: CookieOptions
  ): void => {
    this.setCookie(res, 'theme', theme, options);
  };

  /**
   * Set a session cookie
   */
  setSessionCookie = (
    res: Response,
    sessionId: string,
    options?: CookieOptions
  ): void => {
    this.setCookie(res, 'session', sessionId, options);
  };

  /**
   * Get cookie configuration for a specific type
   */
  getCookieConfig(cookieType: CookieType) {
    return this.configManager.getConfig().deployment.cookies.types[cookieType];
  }

  /**
   * Get default cookie configuration
   */
  getDefaultConfig() {
    return this.configManager.getConfig().deployment.cookies.defaults;
  }

  /**
   * Check if a cookie type is configured
   */
  isCookieTypeSupported(cookieType: string): cookieType is CookieType {
    return ['locale', 'theme', 'session'].includes(cookieType);
  }
}

export default CookieManager;
