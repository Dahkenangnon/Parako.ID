import { Request, Response, NextFunction } from 'express';

/**
 * Interface for UIMiddleware - handles theme, locale, and i18n functionality
 */
export interface IUIMiddleware {
  /**
   * Sets theme-related locals for the user interface
   */
  setThemeLocals: (
    req: Request,
    res: Response,
    next: NextFunction
  ) => Promise<void>;

  /**
   * Updates the user's theme preference
   */
  updateTheme: (req: Request, res: Response) => Promise<void>;

  /**
   * Sets sidebar-related locals for the user interface
   */
  setSidebarLocals: (
    req: Request,
    res: Response,
    next: NextFunction
  ) => Promise<void>;

  /**
   * Updates the user's sidebar state preference
   */
  updateSidebar: (req: Request, res: Response) => Promise<void>;

  /**
   * Sets locale-related locals for the user interface
   */
  setLocaleLocals: (
    req: Request,
    res: Response,
    next: NextFunction
  ) => Promise<void>;

  /**
   * Updates the user's locale preference
   */
  updateLocale: (req: Request, res: Response) => Promise<void>;

  /**
   * Updates the user's timezone preference
   */
  updateTimezone: (req: Request, res: Response) => Promise<void>;

  /**
   * Gets available locales with their display information
   */
  getAvailableLocales: () => Array<{
    code: string;
    flag: string;
    label: string;
  }>;

  /**
   * Initializes i18n for the request
   */
  initI18n: (req: Request, res: Response, next: NextFunction) => void;

  /**
   * Handles language selection and sets cookies
   */
  handleLanguage: (req: Request, res: Response, next: NextFunction) => void;

  /**
   * Adds i18n helper functions to res.locals
   */
  addI18nHelpers: (req: Request, res: Response, next: NextFunction) => void;

  /**
   * Sets all UI-related locals in one middleware call
   * Combines theme, locale, and i18n setup
   */
  setAllUILocals: (
    req: Request,
    res: Response,
    next: NextFunction
  ) => Promise<void>;
}
