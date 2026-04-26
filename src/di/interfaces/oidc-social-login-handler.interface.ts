import type { Request, Response, NextFunction } from 'express';

export interface IOIDCSocialLoginHandler {
  handle(req: Request, res: Response, next: NextFunction): Promise<void>;
}
