import type { Request, Response } from 'express';

export interface IAdminSessionsController {
  list(req: Request, res: Response): Promise<void>;
  show(req: Request, res: Response): Promise<void>;
  revokeSession(req: Request, res: Response): Promise<void>;
  revokeUserSessions(req: Request, res: Response): Promise<void>;
  getStats(req: Request, res: Response): Promise<void>;
}
