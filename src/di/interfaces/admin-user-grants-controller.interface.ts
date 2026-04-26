import type { Request, Response } from 'express';

export interface IAdminUserGrantsController {
  list(req: Request, res: Response): Promise<void>;
  show(req: Request, res: Response): Promise<void>;
  revokeGrant(req: Request, res: Response): Promise<void>;
  revokeUserGrants(req: Request, res: Response): Promise<void>;
  revokeClientGrants(req: Request, res: Response): Promise<void>;
  getStats(req: Request, res: Response): Promise<void>;
}
