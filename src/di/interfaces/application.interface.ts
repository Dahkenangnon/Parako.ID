import { Express } from 'express';

export interface IApplication {
  /**
   * Express application instance
   */
  readonly app: Express;

  /**
   * Whether the application has been initialized
   */
  readonly isInitialized: boolean;

  /**
   * Initialize the application with all middleware and routes
   * @returns Promise that resolves to the Express app
   */
  initialize(): Promise<Express>;
}
