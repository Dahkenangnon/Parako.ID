import { Request, Response, NextFunction } from 'express';

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

  setAccountLocals: (
    req: Request,
    res: Response,
    next: NextFunction
  ) => Promise<void>;

  setActivePage: (
    pageName: string
  ) => (req: Request, res: Response, next: NextFunction) => void;
}
