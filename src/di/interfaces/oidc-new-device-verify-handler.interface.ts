import { Request, Response, NextFunction } from 'express';
import Provider from 'oidc-provider';

/**
 * Interface for OIDC new device verification handler
 */
export interface IOIDCNewDeviceVerifyHandler {
  /**
   * Handle GET request for new device verification page
   */
  handleGet(
    req: Request,
    res: Response,
    next: NextFunction,
    provider: Provider
  ): Promise<void>;

  /**
   * Handle POST request for new device verification submission
   */
  handlePost(
    req: Request,
    res: Response,
    next: NextFunction,
    provider: Provider
  ): Promise<void>;
}
