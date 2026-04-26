import type { Request, Response, NextFunction } from 'express';
import type { errors as OIDCErrors } from 'oidc-provider';

export interface IOIDCErrorHandler {
  handle(
    err: OIDCErrors.OIDCProviderError,
    req: Request,
    res: Response,
    next: NextFunction
  ): void;
}
