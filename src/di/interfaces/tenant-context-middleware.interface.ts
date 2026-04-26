import type { Request, Response, NextFunction } from 'express';

export interface ITenantContextMiddleware {
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>;
}
