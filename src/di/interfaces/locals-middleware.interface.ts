import { Request, Response, NextFunction } from 'express';

/**
 * Interface for LocalsMiddleware - handles setting up locals for Express views
 */
export interface ILocalsMiddleware {
  /**
   * Middleware to set configuration-based locals for all requests
   */
  configLocals: (
    req: Request,
    res: Response,
    next: NextFunction
  ) => Promise<void>;

  /**
   * Middleware to build locale-aware routes
   * Must run after handleLanguage middleware
   */
  buildRoutes: (req: Request, res: Response, next: NextFunction) => void;

  /**
   * Sets account-related locals for authenticated users
   */
  setAccountLocals: (
    req: Request,
    res: Response,
    next: NextFunction
  ) => Promise<void>;

  /**
   * Sets the active page name in locals
   */
  setActivePage: (
    pageName: string
  ) => (req: Request, res: Response, next: NextFunction) => void;
}
