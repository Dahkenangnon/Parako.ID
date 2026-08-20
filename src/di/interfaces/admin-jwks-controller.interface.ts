import type { Request, Response } from 'express';

export interface IAdminJwksController {
  list(req: Request, res: Response): Promise<void>;
  show(req: Request, res: Response): Promise<void>;
  /** POST /admin/jwks/rotate - Manual key rotation */
  rotate(req: Request, res: Response): Promise<void>;
  /** POST /admin/jwks/retire-expired - Retire keys past overlap window */
  retireExpired(req: Request, res: Response): Promise<void>;
}
