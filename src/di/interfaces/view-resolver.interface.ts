import { Application } from 'express';
import nunjucks from 'nunjucks';
import { ViewResolverConfig, ViewKeys } from '../../utils/view-resolver.js';

/**
 * Interface for view resolver service
 * Defines the contract for view resolution operations
 */
export interface IViewResolver {
  /**
   * Get type-safe view keys for controllers
   * Usage: res.render(viewResolver.views.auth.login, {...})
   */
  get views(): ViewKeys;

  /**
   * Configure Express app with resolved view paths
   * Sets up Nunjucks with proper view directories
   * @param app - Express application instance
   * @param njk - Nunjucks module
   * @returns Nunjucks environment or null if configuration fails
   */
  configureExpressViews(
    app: Application,
    njk: typeof nunjucks
  ): nunjucks.Environment | null;

  /**
   * Reload configuration
   */
  reloadConfig(): void;

  /**
   * Get current configuration
   * @returns Current view resolver configuration
   */
  getCurrentConfig(): ViewResolverConfig;
}
