import type { Request, Response, NextFunction } from 'express';
import type { Provider } from 'oidc-provider';

export interface IOIDCLoginHandler {
  handle(
    req: Request,
    res: Response,
    next: NextFunction,
    provider: Provider
  ): Promise<void>;
}
