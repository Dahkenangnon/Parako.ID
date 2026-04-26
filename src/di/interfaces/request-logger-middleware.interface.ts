import type { Request, Response, NextFunction } from 'express';

export interface IRequestLoggerMiddleware {
  handler(req: Request, res: Response, next: NextFunction): void;
}
