import type { Request, Response } from 'express';

export interface IAdminOidcClientsController {
  list(req: Request, res: Response): Promise<void>;
  show(req: Request, res: Response): Promise<void>;
  getStats(req: Request, res: Response): Promise<void>;
}
