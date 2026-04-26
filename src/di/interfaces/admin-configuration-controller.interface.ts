import { Request, Response } from 'express';

/**
 * Interface for Admin Configuration Controller
 * Handles per-tenant configuration overrides (whitelisted sections only)
 */
export interface IAdminConfigurationController {
  overview(req: Request, res: Response): Promise<void>;
  section(req: Request, res: Response): Promise<void>;
  updateSection(req: Request, res: Response): Promise<void>;
  resetSection(req: Request, res: Response): Promise<void>;

  // Branding: logo upload/remove
  uploadLogo(req: Request, res: Response): Promise<void>;
  removeLogo(req: Request, res: Response): Promise<void>;
  uploadLogoDark(req: Request, res: Response): Promise<void>;
  removeLogoDark(req: Request, res: Response): Promise<void>;
  uploadLogoIcon(req: Request, res: Response): Promise<void>;
  removeLogoIcon(req: Request, res: Response): Promise<void>;
  uploadLogoIconDark(req: Request, res: Response): Promise<void>;
  removeLogoIconDark(req: Request, res: Response): Promise<void>;
  uploadFavicon(req: Request, res: Response): Promise<void>;
  removeFavicon(req: Request, res: Response): Promise<void>;

  // Branding: reset
  resetColors(req: Request, res: Response): Promise<void>;
  resetFonts(req: Request, res: Response): Promise<void>;

  testEmail(req: Request, res: Response): Promise<void>;
  revealSecret(req: Request, res: Response): Promise<void>;
}
