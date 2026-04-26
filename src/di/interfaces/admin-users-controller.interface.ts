import { Request, Response } from 'express';

/**
 * Interface for AdminUsersController - handles admin user management operations
 */
export interface IAdminUsersController {
  // User listing and viewing
  list(req: Request, res: Response): Promise<void>;
  show(req: Request, res: Response): Promise<void>;
  activities(req: Request, res: Response): Promise<void>;

  // User creation and editing
  create(req: Request, res: Response): Promise<void>;
  store(req: Request, res: Response): Promise<void>;
  edit(req: Request, res: Response): Promise<void>;
  update(req: Request, res: Response): Promise<void>;

  enable(req: Request, res: Response): Promise<void>;
  disable(req: Request, res: Response): Promise<void>;
  destroy(req: Request, res: Response): Promise<void>;
}
