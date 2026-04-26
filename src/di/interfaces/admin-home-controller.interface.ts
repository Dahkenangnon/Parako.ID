import type { Request, Response } from 'express';

export interface IAdminHomeController {
  dashboard(req: Request, res: Response): Promise<void>;
  updateTheme(req: Request, res: Response): Promise<void>;
}
