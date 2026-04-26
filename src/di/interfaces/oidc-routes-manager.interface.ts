import type { Application } from 'express';

export interface IOidcRoutesManager {
  /**
   * Register all OIDC interaction routes.
   * Provider is resolved per-request from ProviderService (tenant-aware).
   * @param app - Express Application instance
   */
  registerRoutes(app: Application): void;
}
