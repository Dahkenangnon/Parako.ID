import { Request, Response } from 'express';

/**
 * Interface for AdminActivitiesController - handles admin activity management operations
 */
export interface IAdminActivitiesController {
  // Activity listing and viewing
  list(req: Request, res: Response): Promise<void>;
  show(req: Request, res: Response): Promise<void>;

  clearOldActivities(req: Request, res: Response): Promise<void>;
}
