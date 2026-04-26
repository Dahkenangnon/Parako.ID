import { Request, Response, NextFunction } from 'express';
import { ValidationResult } from '../../middlewares/config-validation.middleware.js';

/**
 * Interface for configuration validation middleware
 */
export interface IConfigValidationMiddleware {
  /**
   * Middleware factory for validating configuration updates
   * @param section - Configuration section to validate
   * @returns Express middleware function
   */
  validateConfigUpdate(
    section: string
  ): (req: Request, res: Response, next: NextFunction) => Promise<void>;

  /**
   * Validate deployment configuration
   * @param data - Deployment configuration data
   * @returns Validation result
   */
  validateDeploymentConfig(data: unknown): Promise<ValidationResult>;
}
