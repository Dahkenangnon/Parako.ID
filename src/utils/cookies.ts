import { Response } from 'express';
import { injectable, inject } from 'inversify';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type {
  CookieOptions,
  CookieType,
  ICookieManager,
} from '../di/interfaces/cookie-manager.interface.js';
import { TYPES } from '../di/types.js';

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

    res.cookie(options?.name ?? cookieConfig.name, value, {
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

  setLocaleCookie = (
    res: Response,
    locale: string,
    options?: CookieOptions
  ): void => {
    this.setCookie(res, 'locale', locale, options);
  };

  setThemeCookie = (
    res: Response,
    theme: string,
    options?: CookieOptions
  ): void => {
    this.setCookie(res, 'theme', theme, options);
  };

  setSessionCookie = (
    res: Response,
    sessionId: string,
    options?: CookieOptions
  ): void => {
    this.setCookie(res, 'session', sessionId, options);
  };

  getCookieConfig(cookieType: CookieType) {
    return this.configManager.getConfig().deployment.cookies.types[cookieType];
  }

  /**
   * Get default cookie configuration
   */
  getDefaultConfig() {
    return this.configManager.getConfig().deployment.cookies.defaults;
  }

  isCookieTypeSupported(cookieType: string): cookieType is CookieType {
    return ['locale', 'theme', 'session'].includes(cookieType);
  }
}

export default CookieManager;
