import { Request, Response, NextFunction } from 'express';

export function setNoCache(_req: Request, res: Response, next: NextFunction) {
  res.set('cache-control', 'no-store');
  next();
}
