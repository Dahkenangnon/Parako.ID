import type { Request, Response } from 'express';

export interface IAdminJwksController {
  /** GET /admin/jwks - List all keys with status badges */
  list(req: Request, res: Response): Promise<void>;
  /** GET /admin/jwks/:kid - View individual key details */
  show(req: Request, res: Response): Promise<void>;
  /** POST /admin/jwks/rotate - Manual key rotation */
  rotate(req: Request, res: Response): Promise<void>;
  /** POST /admin/jwks/retire-expired - Retire keys past overlap window */
  retireExpired(req: Request, res: Response): Promise<void>;
}
