import { Request, Response } from 'express';

/**
 * Interface for Admin OIDC Client Controller
 * Defines the contract for OIDC client management operations
 */
export interface IAdminOidcClientController {
  /**
   * List all OIDC clients with pagination and filtering
   * GET /admin/oidc-clients
   */
  list(req: Request, res: Response): Promise<void>;

  /**
   * Show OIDC client details
   * GET /admin/oidc-clients/:id
   */
  show(req: Request, res: Response): Promise<void>;

  /**
   * Show create OIDC client form
   * GET /admin/oidc-clients/create
   */
  create(req: Request, res: Response): Promise<void>;

  /**
   * Store new OIDC client
   * POST /admin/oidc-clients
   */
  store(req: Request, res: Response): Promise<void>;

  /**
   * Show edit OIDC client form
   * GET /admin/oidc-clients/:id/edit
   */
  edit(req: Request, res: Response): Promise<void>;

  /**
   * Update OIDC client
   * PUT /admin/oidc-clients/:id
   */
  update(req: Request, res: Response): Promise<void>;

  /**
   * Activate OIDC client
   * POST /admin/oidc-clients/:id/activate
   */
  activate(req: Request, res: Response): Promise<void>;

  /**
   * Deactivate OIDC client
   * POST /admin/oidc-clients/:id/deactivate
   */
  deactivate(req: Request, res: Response): Promise<void>;

  /**
   * Regenerate client secret
   * POST /admin/oidc-clients/:id/regenerate-secret
   */
  regenerateSecret(req: Request, res: Response): Promise<void>;

  /**
   * Delete OIDC client
   * DELETE /admin/oidc-clients/:id
   */
  destroy(req: Request, res: Response): Promise<void>;

  /**
   * Get client statistics
   * GET /admin/oidc-clients/statistics
   */
  statistics(req: Request, res: Response): Promise<void>;

  /**
   * Search OIDC clients
   * GET /admin/oidc-clients/search
   */
  search(req: Request, res: Response): Promise<void>;

  /**
   * Reveal client secret via API
   * POST /admin/oidc-clients/:id/reveal-secret
   */
  revealSecret(req: Request, res: Response): Promise<void>;
}
