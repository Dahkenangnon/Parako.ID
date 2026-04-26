import { Application } from 'express';

export interface IMainRoutesManager {
  /**
   * Register locale extractor middleware (must be called BEFORE i18n initialization)
   * @param app - Express Application instance
   */
  registerLocaleExtractor(app: Application): void;

  /**
   * Register all application routes with the Express app
   * @param app - Express Application instance
   */
  registerRoutes(app: Application): void;
}
