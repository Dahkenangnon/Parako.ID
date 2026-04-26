import type { Request, Response, NextFunction } from 'express';

/** Standard Express route handler signature used by all API v1 controllers. */
export type RouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<void>;
