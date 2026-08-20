import { Request, Response, NextFunction } from 'express';
import Provider from 'oidc-provider';

export interface IOIDCNewDeviceVerifyHandler {
  handleGet(
    req: Request,
    res: Response,
    next: NextFunction,
    provider: Provider
  ): Promise<void>;

  handlePost(
    req: Request,
    res: Response,
    next: NextFunction,
    provider: Provider
  ): Promise<void>;
}
