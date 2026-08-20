import { Request, Response } from 'express';

export interface IAdminActivitiesController {
  // Activity listing and viewing
  list(req: Request, res: Response): Promise<void>;
  show(req: Request, res: Response): Promise<void>;

  clearOldActivities(req: Request, res: Response): Promise<void>;
}
