import { Request, Response, NextFunction } from 'express';

export interface IUIMiddleware {
  setThemeLocals: (
    req: Request,
    res: Response,
    next: NextFunction
  ) => Promise<void>;

  updateTheme: (req: Request, res: Response) => Promise<void>;

  setSidebarLocals: (
    req: Request,
    res: Response,
    next: NextFunction
  ) => Promise<void>;

  updateSidebar: (req: Request, res: Response) => Promise<void>;

  setLocaleLocals: (
    req: Request,
    res: Response,
    next: NextFunction
  ) => Promise<void>;

  updateLocale: (req: Request, res: Response) => Promise<void>;

  updateTimezone: (req: Request, res: Response) => Promise<void>;

  getAvailableLocales: () => Array<{
    code: string;
    flag: string;
    label: string;
  }>;

  initI18n: (req: Request, res: Response, next: NextFunction) => void;

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
