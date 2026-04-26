import type { Application } from 'express';

export interface IOidcManager {
  /**
   * Start the OIDC features
   * @param app - Express Application instance
   */
  start(app: Application): Promise<void>;
}
