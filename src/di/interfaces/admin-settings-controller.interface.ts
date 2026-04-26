import { Request, Response } from 'express';

/**
 * Interface for Admin Settings Controller
 * Handles all settings management for the admin panel
 */
export interface IAdminSettingsController {
  /**
   * Settings overview page - shows all sections
   */
  overview(req: Request, res: Response): Promise<void>;

  /**
   * Application settings - display and edit
   */
  application(req: Request, res: Response): Promise<void>;

  /**
   * Branding settings - display and edit
   */
  branding(req: Request, res: Response): Promise<void>;

  /**
   * Remove logo from branding settings
   */
  removeLogo(req: Request, res: Response): Promise<void>;

  /**
   * Upload dark mode logo
   */
  uploadLogoDark(req: Request, res: Response): Promise<void>;

  /**
   * Remove dark mode logo from branding settings
   */
  removeLogoDark(req: Request, res: Response): Promise<void>;

  /**
   * Upload icon logo (light)
   */
  uploadLogoIcon(req: Request, res: Response): Promise<void>;

  /**
   * Remove icon logo (light)
   */
  removeLogoIcon(req: Request, res: Response): Promise<void>;

  /**
   * Upload dark icon logo
   */
  uploadLogoIconDark(req: Request, res: Response): Promise<void>;

  /**
   * Remove dark icon logo
   */
  removeLogoIconDark(req: Request, res: Response): Promise<void>;

  /**
   * Upload favicon
   */
  uploadFavicon(req: Request, res: Response): Promise<void>;

  /**
   * Remove favicon from branding settings
   */
  removeFavicon(req: Request, res: Response): Promise<void>;

  /**
   * Reset branding colors to defaults
   */
  resetColors(req: Request, res: Response): Promise<void>;

  /**
   * Reset branding fonts to defaults
   */
  resetFonts(req: Request, res: Response): Promise<void>;

  /**
   * Deployment settings - display and edit
   */
  deployment(req: Request, res: Response): Promise<void>;

  /**
   * Security settings - Authentication & Access sub-page
   */
  securityAuthentication(req: Request, res: Response): Promise<void>;

  /**
   * Security settings - MFA sub-page
   */
  securityMfa(req: Request, res: Response): Promise<void>;

  /**
   * Security settings - Sessions sub-page
   */
  securitySessions(req: Request, res: Response): Promise<void>;

  /**
   * Security settings - Protection sub-page
   */
  securityProtection(req: Request, res: Response): Promise<void>;

  /**
   * Security settings - Secrets sub-page
   */
  securitySecrets(req: Request, res: Response): Promise<void>;

  /**
   * Features settings - display and edit
   */
  features(req: Request, res: Response): Promise<void>;

  /**
   * OIDC settings - display and edit
   */
  oidc(req: Request, res: Response): Promise<void>;

  /**
   * Integrations settings - display and edit
   */
  integrations(req: Request, res: Response): Promise<void>;

  /**
   * Reload configuration from database
   */
  reload(req: Request, res: Response): Promise<void>;

  /**
   * Test email configuration
   */
  testEmail(req: Request, res: Response): Promise<void>;

  /**
   * Get configuration statistics
   */
  stats(req: Request, res: Response): Promise<void>;

  /**
   * Configuration health check endpoint
   * Tests all critical configuration components and returns health status
   */
  healthCheck(req: Request, res: Response): Promise<void>;

  /**
   * Reveal a secret configuration value
   * SECURITY: This endpoint logs all access attempts for audit purposes
   */
  revealSecret(req: Request, res: Response): Promise<void>;

  /**
   * Rollback configuration to a previous version
   */
  rollback(req: Request, res: Response): Promise<void>;

  /**
   * Export configuration as JSON file
   * Masks sensitive fields for security
   */
  exportConfig(req: Request, res: Response): Promise<void>;

  /**
   * Configuration import page
   * Displays the dedicated import page for uploading/previewing/applying config
   */
  importPage(req: Request, res: Response): Promise<void>;

  /**
   * Preview configuration import
   * Validates and shows diff without applying
   */
  importConfigPreview(req: Request, res: Response): Promise<void>;

  /**
   * Apply configuration import
   * Applies imported configuration after confirmation
   */
  applyImport(req: Request, res: Response): Promise<void>;
}
