import type { Request, Response, NextFunction } from 'express';

export interface IOIDCSocialCallbackHandler {
  handle(req: Request, res: Response, next: NextFunction): Promise<void>;
}
