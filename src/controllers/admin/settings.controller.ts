import { injectable, inject } from 'inversify';
import { Request, Response } from 'express';
import { Redis } from 'ioredis';
import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';
import type { IAdminSettingsController } from '../../di/interfaces/admin-settings-controller.interface.js';
import type { ISessionManager } from '../../di/interfaces/session-manager.interface.js';
import type { ILogger } from '../../di/interfaces/logger.interface.js';
import type { IEmailService } from '../../di/interfaces/email-service.interface.js';
import type { IActivityService } from '../../di/interfaces/activity-service.interface.js';
import type { ISettingsService } from '../../di/interfaces/settings-service.interface.js';
import type { IUploadMiddleware } from '../../di/interfaces/upload-middleware.interface.js';
import type { IClientDeviceInfoManager } from '../../di/interfaces/client-device-info-manager.interface.js';
import { TYPES } from '../../di/types.js';
import { activityLoggerFor } from '../../utils/activity-logger.factory.js';
import { getDefaultFullConfig } from '../../config/constants.js';
import { mergeConfig } from '../../utils/config-merge.js';
import {
  convertBrandingFormData,
  convertDeploymentFormData,
  convertFeaturesFormData,
  convertOidcFormData,
  convertIntegrationsFormData,
  convertNotificationsFormData,
  convertSecurityFormData,
  getSectionIcon,
  getSectionStatus,
  prepareSensitiveConfigForDisplay,
  restoreMaskedSensitiveFields,
  SENSITIVE_FIELDS,
  BOOTSTRAP_ONLY_FIELDS,
  getNestedValue,
} from '../../utils/settings.helper.js';

function getErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  return error instanceof Error ? error.message : fallback;
}

function getRequestedBy(
  userData: { email?: string | null } | null | undefined
): string {
  return userData?.email || 'unknown';
}

function getRequestIp(req: Request): string {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function getRequestUserAgent(req: Request): string {
  return req.get('user-agent') || 'unknown';
}

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    operation.then(
      value => {
        clearTimeout(timeout);
        resolve(value);
      },
      error => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

/**
 * Admin Settings Controller
 * Handles all settings management for the admin panel
 * Uses only ConfigManager as the single source of truth
 */
@injectable()
export class AdminSettingsController implements IAdminSettingsController {
  constructor(
    @inject(TYPES.ConfigManager) private configManager: IConfigManager,
    @inject(TYPES.SessionManager) private sessionManager: ISessionManager,
    @inject(TYPES.Logger) private logger: ILogger,
    @inject(TYPES.EmailService) private emailService: IEmailService,
    @inject(TYPES.ActivityService) private activityService: IActivityService,
    @inject(TYPES.SettingsService) private settingsService: ISettingsService,
    @inject(TYPES.UploadMiddleware) private uploadMiddleware: IUploadMiddleware,
    @inject(TYPES.ClientDeviceInfoManager)
    private readonly clientDeviceInfoManager: IClientDeviceInfoManager
  ) {}

  private get activityLoggerDeps() {
    return {
      activityService: this.activityService,
      sessionManager: this.sessionManager,
      clientDeviceInfoManager: this.clientDeviceInfoManager,
    };
  }

  /**
   * Audit a config-update operation. `type` is the activity-log event
   * type, `description` the human-readable summary, and `entity_data`
   * the payload that goes into the target's entity_data field.
   */
  private audit(
    req: Request,
    level: 'success' | 'failed' | 'warning' | 'info',
    type: string,
    description: string,
    entity_data?: Record<string, unknown>
  ): void {
    const logger = activityLoggerFor(this.activityLoggerDeps, req, {
      defaultActorType: 'admin',
    });
    const user = this.sessionManager.getActiveUser(req);
    logger[level](type, user, description, {
      target: {
        target_type: 'config',
        ...(entity_data ? { entity_data } : {}),
      },
    });
  }

  /**
   * Get configuration section with sensitive fields masked for display
   * This ensures secrets are never sent to the browser in plain text
   *
   * @param section - The section name ('security', 'oidc', 'integrations', etc.)
   * @returns Masked configuration section safe for UI display
   */
  private getMaskedConfigSection(section: string): any {
    const config = this.configManager.getPlatformConfig();
    const sectionConfig = (config as any)[section];

    if (!sectionConfig) {
      return {};
    }

    const tempConfig = { [section]: sectionConfig };

    const maskedConfig = prepareSensitiveConfigForDisplay(tempConfig);

    return maskedConfig[section];
  }

  /**
   * Remove bootstrap-only fields from configuration data
   * Bootstrap fields (environment, port, database URI) must be set in .env file
   * and should never be persisted to the database
   *
   * @param data - Configuration data to sanitize
   * @returns Sanitized data with bootstrap fields removed, and list of removed fields
   */
  private removeBootstrapFields(data: any): {
    sanitized: any;
    removed: string[];
  } {
    const sanitized = JSON.parse(JSON.stringify(data)); // Deep clone
    const removed: string[] = [];

    for (const fieldPath of BOOTSTRAP_ONLY_FIELDS) {
      const value = getNestedValue(sanitized, fieldPath);

      if (value !== undefined && value !== null) {
        removed.push(fieldPath);

        const keys = fieldPath.split('.');
        const lastKey = keys.pop()!;
        const parent = keys.reduce((current, key) => current[key], sanitized);
        delete parent[lastKey];
      }
    }

    return { sanitized, removed };
  }

  /**
   * Settings overview page - shows all sections
   */
  overview = async (req: Request, res: Response): Promise<void> => {
    try {
      const config = this.configManager.getPlatformConfig();

      const sections = [
        {
          key: 'application',
          name: 'Application',
          description: 'Basic application information and locales',
        },
        {
          key: 'branding',
          name: 'Branding',
          description: 'Company branding, theme, and UI customization',
        },
        {
          key: 'deployment',
          name: 'Deployment',
          description: 'Environment, server, cookies, and routes',
        },
        {
          key: 'security',
          name: 'Security',
          description: 'Security settings, authentication, and logging',
        },
        {
          key: 'features',
          name: 'Features',
          description: 'OIDC features, social providers, and developer API',
        },
        {
          key: 'oidc',
          name: 'OIDC',
          description: 'OIDC-specific configuration and settings',
        },
        {
          key: 'integrations',
          name: 'Integrations',
          description: 'Email and URL configuration',
        },
      ].map(section => ({
        ...section,
        icon: getSectionIcon(section.key),
        isConfigured: getSectionStatus(config, section.key),
      }));

      // Use the same key constant that SettingsService uses
      const configKey = 'parako_config';
      const versionHistory = await this.settingsService.findMany(
        { key: configKey },
        { sort: { created_at: -1 }, limit: 10 }
      );

      // Note: versionHistory is sorted by created_at desc, so the active version should be first
      const activeConfig =
        versionHistory.find(v => v.is_active) || versionHistory[0];
      const currentVersion = activeConfig?.version || '1.0.0';
      const currentVersionNum = activeConfig?._version || 0;

      res.render('admin/settings/overview', {
        title: 'Settings Overview',
        config,
        sections,
        isUsingFileConfig: this.configManager.isUsingFileConfig(),
        versionHistory,
        currentVersion,
        currentVersionNum,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'settings_overview_loading_failed',
      });
      this.sessionManager.flash(req).error('Failed to load settings overview');
      res.redirect('/admin');
    }
  };

  /**
   * Application settings - display and edit
   */
  application = async (req: Request, res: Response): Promise<void> => {
    try {
      const config = this.configManager.getPlatformConfig();

      if (req.method === 'GET') {
        res.render('admin/settings/application', {
          title: 'Application Settings',
          section: 'application',
          config: config.application,
        });
      } else if (req.method === 'POST') {
        const existingApplication = config.application || {};
        const mergedApplication = mergeConfig(existingApplication, req.body);

        await this.configManager.update({
          application: mergedApplication,
        });

        this.audit(
          req,
          'success',
          'update_config',
          'Updated application configuration',
          {
            fieldsModified: Object.keys(req.body).length,
          }
        );

        this.sessionManager
          .flash(req)
          .success('Application settings updated successfully');
        res.redirect('/admin/settings/application');
      } else {
        res.status(405).json({ error: 'Method not allowed' });
      }
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'application_settings_update_failed',
      });

      const errorMessage = getErrorMessage(error);
      this.audit(
        req,
        'failed',
        'update_config',
        'Failed to update application configuration',
        {
          error: errorMessage,
        }
      );

      this.sessionManager
        .flash(req)
        .error('Failed to update application settings');
      res.redirect('/admin/settings/application');
    }
  };

  /**
   * Branding settings - display and edit
   */
  branding = async (req: Request, res: Response): Promise<void> => {
    try {
      const config = this.configManager.getPlatformConfig();

      if (req.method === 'GET') {
        res.render('admin/settings/branding', {
          title: 'Branding Settings',
          section: 'branding',
          config: config.branding,
        });
      } else if (req.method === 'POST') {
        const file = (req as any).file; // Multer adds this

        const convertedData = convertBrandingFormData(req.body);

        if (file) {
          const storageKey = await this.uploadMiddleware.storeFile(
            file,
            'logos'
          );
          convertedData.logo = storageKey;

          if (config.branding?.logo) {
            await this.uploadMiddleware.deleteFile(config.branding.logo);
          }
        } else {
          // No file uploaded - remove logo from convertedData to preserve existing
          delete convertedData.logo;
        }

        const existingBranding = config.branding || {};
        const mergedBranding = mergeConfig(existingBranding, convertedData);

        await this.configManager.update({
          branding: mergedBranding,
        });

        this.audit(
          req,
          'success',
          'update_config',
          'Updated branding configuration',
          {
            fieldsModified: Object.keys(convertedData).length,
          }
        );

        this.sessionManager
          .flash(req)
          .success('Branding settings updated successfully');
        res.redirect('/admin/settings/branding');
      } else {
        res.status(405).json({ error: 'Method not allowed' });
      }
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'branding_settings_update_failed',
      });

      const errorMessage = getErrorMessage(error);
      this.audit(
        req,
        'failed',
        'update_config',
        'Failed to update branding configuration',
        {
          error: errorMessage,
        }
      );

      this.sessionManager
        .flash(req)
        .error('Failed to update branding settings');
      res.redirect('/admin/settings/branding');
    }
  };

  /**
   * Remove logo from branding settings
   */
  removeLogo = async (req: Request, res: Response): Promise<void> => {
    try {
      const config = this.configManager.getPlatformConfig();

      if (config.branding?.logo) {
        await this.uploadMiddleware.deleteFile(config.branding.logo);
      }

      await this.configManager.update({
        branding: {
          ...config.branding,
          logo: '',
        },
      });

      this.audit(req, 'success', 'update_config', 'Removed company logo', {
        action: 'remove_logo',
      });

      res.json({ success: true, message: 'Logo removed successfully' });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'logo_removal_failed',
      });

      const errorMessage = getErrorMessage(error);
      this.audit(
        req,
        'failed',
        'update_config',
        'Failed to remove company logo',
        {
          error: errorMessage,
        }
      );

      res.status(500).json({ error: 'Failed to remove logo' });
    }
  };

  /**
   * Reset theme colors to defaults
   */
  resetColors = async (req: Request, res: Response): Promise<void> => {
    try {
      const config = this.configManager.getPlatformConfig();

      const defaultColors = getDefaultFullConfig().branding.colors;

      await this.configManager.update({
        branding: {
          ...config.branding,
          colors: defaultColors,
        },
      });

      this.audit(
        req,
        'success',
        'update_config',
        'Reset theme colors to defaults',
        {
          action: 'reset_colors',
        }
      );

      res.json({ success: true, message: 'Colors reset to defaults' });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'color_reset_failed',
      });

      const errorMessage = getErrorMessage(error);
      this.audit(
        req,
        'failed',
        'update_config',
        'Failed to reset theme colors',
        {
          error: errorMessage,
        }
      );

      res.status(500).json({ error: 'Failed to reset colors' });
    }
  };

  /**
   * Reset fonts to defaults
   */
  resetFonts = async (req: Request, res: Response): Promise<void> => {
    try {
      const config = this.configManager.getPlatformConfig();

      const defaultFonts = getDefaultFullConfig().branding.fonts;

      await this.configManager.update({
        branding: {
          ...config.branding,
          fonts: defaultFonts,
        },
      });

      this.audit(req, 'success', 'update_config', 'Reset fonts to defaults', {
        action: 'reset_fonts',
      });

      res.json({ success: true, message: 'Fonts reset to defaults' });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'font_reset_failed',
      });

      const errorMessage = getErrorMessage(error);
      this.audit(req, 'failed', 'update_config', 'Failed to reset fonts', {
        error: errorMessage,
      });

      res.status(500).json({ error: 'Failed to reset fonts' });
    }
  };

  /**
   * Upload dark mode logo
   */
  uploadLogoDark = async (req: Request, res: Response): Promise<void> => {
    try {
      const config = this.configManager.getPlatformConfig();
      const file = (req as any).file;

      if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const logoDarkKey = await this.uploadMiddleware.storeFile(file, 'logos');

      if (config.branding?.logoDark) {
        await this.uploadMiddleware.deleteFile(config.branding.logoDark);
      }

      await this.configManager.update({
        branding: {
          ...config.branding,
          logoDark: logoDarkKey,
        },
      });

      this.audit(req, 'success', 'update_config', 'Uploaded dark mode logo', {
        action: 'upload_logo_dark',
        filename: file.filename,
      });

      res.json({
        success: true,
        message: 'Dark mode logo uploaded successfully',
        url: logoDarkKey,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'logo_dark_upload_failed',
      });

      const errorMessage = getErrorMessage(error);
      this.audit(
        req,
        'failed',
        'update_config',
        'Failed to upload dark mode logo',
        {
          error: errorMessage,
        }
      );

      res.status(500).json({ error: 'Failed to upload dark mode logo' });
    }
  };

  /**
   * Remove dark mode logo from branding settings
   */
  removeLogoDark = async (req: Request, res: Response): Promise<void> => {
    try {
      const config = this.configManager.getPlatformConfig();

      if (config.branding?.logoDark) {
        await this.uploadMiddleware.deleteFile(config.branding.logoDark);
      }

      await this.configManager.update({
        branding: {
          ...config.branding,
          logoDark: null,
        },
      });

      this.audit(req, 'success', 'update_config', 'Removed dark mode logo', {
        action: 'remove_logo_dark',
      });

      res.json({
        success: true,
        message: 'Dark mode logo removed successfully',
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'logo_dark_removal_failed',
      });

      const errorMessage = getErrorMessage(error);
      this.audit(
        req,
        'failed',
        'update_config',
        'Failed to remove dark mode logo',
        {
          error: errorMessage,
        }
      );

      res.status(500).json({ error: 'Failed to remove dark mode logo' });
    }
  };

  /**
   * Upload icon logo (light)
   */
  uploadLogoIcon = async (req: Request, res: Response): Promise<void> => {
    try {
      const config = this.configManager.getPlatformConfig();
      const file = (req as any).file;

      if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const logoIconKey = await this.uploadMiddleware.storeFile(file, 'logos');

      if (config.branding?.logoIcon) {
        await this.uploadMiddleware.deleteFile(config.branding.logoIcon);
      }

      await this.configManager.update({
        branding: {
          ...config.branding,
          logoIcon: logoIconKey,
        },
      });

      this.audit(req, 'success', 'update_config', 'Icon logo uploaded', {
        action: 'upload_logo_icon',
        filename: file.filename,
      });

      res.json({
        success: true,
        message: 'Icon logo uploaded successfully',
        url: logoIconKey,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'logo_icon_upload_failed',
      });

      const errorMessage = getErrorMessage(error);
      this.audit(req, 'failed', 'update_config', 'Failed to upload icon logo', {
        error: errorMessage,
      });

      res.status(500).json({ error: 'Failed to upload icon logo' });
    }
  };

  /**
   * Remove icon logo (light)
   */
  removeLogoIcon = async (req: Request, res: Response): Promise<void> => {
    try {
      const config = this.configManager.getPlatformConfig();

      if (config.branding?.logoIcon) {
        await this.uploadMiddleware.deleteFile(config.branding.logoIcon);
      }

      await this.configManager.update({
        branding: {
          ...config.branding,
          logoIcon: null,
        },
      });

      this.audit(req, 'success', 'update_config', 'Icon logo removed', {
        action: 'remove_logo_icon',
      });

      res.json({
        success: true,
        message: 'Icon logo removed successfully',
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'logo_icon_removal_failed',
      });

      const errorMessage = getErrorMessage(error);
      this.audit(req, 'failed', 'update_config', 'Failed to remove icon logo', {
        error: errorMessage,
      });

      res.status(500).json({ error: 'Failed to remove icon logo' });
    }
  };

  /**
   * Upload dark icon logo
   */
  uploadLogoIconDark = async (req: Request, res: Response): Promise<void> => {
    try {
      const config = this.configManager.getPlatformConfig();
      const file = (req as any).file;

      if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const logoIconDarkKey = await this.uploadMiddleware.storeFile(
        file,
        'logos'
      );

      if (config.branding?.logoIconDark) {
        await this.uploadMiddleware.deleteFile(config.branding.logoIconDark);
      }

      await this.configManager.update({
        branding: {
          ...config.branding,
          logoIconDark: logoIconDarkKey,
        },
      });

      this.audit(req, 'success', 'update_config', 'Dark icon logo uploaded', {
        action: 'upload_logo_icon_dark',
        filename: file.filename,
      });

      res.json({
        success: true,
        message: 'Dark icon logo uploaded successfully',
        url: logoIconDarkKey,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'logo_icon_dark_upload_failed',
      });

      const errorMessage = getErrorMessage(error);
      this.audit(
        req,
        'failed',
        'update_config',
        'Failed to upload dark icon logo',
        {
          error: errorMessage,
        }
      );

      res.status(500).json({ error: 'Failed to upload dark icon logo' });
    }
  };

  /**
   * Remove dark icon logo
   */
  removeLogoIconDark = async (req: Request, res: Response): Promise<void> => {
    try {
      const config = this.configManager.getPlatformConfig();

      if (config.branding?.logoIconDark) {
        await this.uploadMiddleware.deleteFile(config.branding.logoIconDark);
      }

      await this.configManager.update({
        branding: {
          ...config.branding,
          logoIconDark: null,
        },
      });

      this.audit(req, 'success', 'update_config', 'Dark icon logo removed', {
        action: 'remove_logo_icon_dark',
      });

      res.json({
        success: true,
        message: 'Dark icon logo removed successfully',
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'logo_icon_dark_removal_failed',
      });

      const errorMessage = getErrorMessage(error);
      this.audit(
        req,
        'failed',
        'update_config',
        'Failed to remove dark icon logo',
        {
          error: errorMessage,
        }
      );

      res.status(500).json({ error: 'Failed to remove dark icon logo' });
    }
  };

  /**
   * Upload favicon
   */
  uploadFavicon = async (req: Request, res: Response): Promise<void> => {
    try {
      const config = this.configManager.getPlatformConfig();
      const file = (req as any).file;

      if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const faviconKey = await this.uploadMiddleware.storeFile(
        file,
        'favicons'
      );

      if (config.branding?.favicon) {
        await this.uploadMiddleware.deleteFile(config.branding.favicon);
      }

      await this.configManager.update({
        branding: {
          ...config.branding,
          favicon: faviconKey,
        },
      });

      this.audit(req, 'success', 'update_config', 'Uploaded favicon', {
        action: 'upload_favicon',
        filename: file.filename,
      });

      res.json({
        success: true,
        message: 'Favicon uploaded successfully',
        url: faviconKey,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'favicon_upload_failed',
      });

      const errorMessage = getErrorMessage(error);
      this.audit(req, 'failed', 'update_config', 'Failed to upload favicon', {
        error: errorMessage,
      });

      res.status(500).json({ error: 'Failed to upload favicon' });
    }
  };

  /**
   * Remove favicon from branding settings
   */
  removeFavicon = async (req: Request, res: Response): Promise<void> => {
    try {
      const config = this.configManager.getPlatformConfig();

      if (config.branding?.favicon) {
        await this.uploadMiddleware.deleteFile(config.branding.favicon);
      }

      await this.configManager.update({
        branding: {
          ...config.branding,
          favicon: null,
        },
      });

      this.audit(req, 'success', 'update_config', 'Removed favicon', {
        action: 'remove_favicon',
      });

      res.json({ success: true, message: 'Favicon removed successfully' });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'favicon_removal_failed',
      });

      const errorMessage = getErrorMessage(error);
      this.audit(req, 'failed', 'update_config', 'Failed to remove favicon', {
        error: errorMessage,
      });

      res.status(500).json({ error: 'Failed to remove favicon' });
    }
  };

  /**
   * Deployment settings - display and edit
   */
  deployment = async (req: Request, res: Response): Promise<void> => {
    try {
      const config = this.configManager.getPlatformConfig();

      if (req.method === 'GET') {
        res.render('admin/settings/deployment', {
          title: 'Deployment Settings',
          section: 'deployment',
          config: config.deployment,
        });
      } else if (req.method === 'POST') {
        const convertedData = convertDeploymentFormData(req.body);

        // These fields (environment, port, database URI) must be set in .env file
        const { sanitized, removed } = this.removeBootstrapFields({
          deployment: convertedData,
        });

        if (removed.length > 0) {
          this.logger.warn('Bootstrap fields detected in deployment update', {
            removedFields: removed,
            user: this.sessionManager.getActiveUser(req)?.email,
            message: 'These fields must be set in .env file, not via UI',
          });

          this.sessionManager
            .flash(req)
            .warning(
              'Note: Environment, port, and database URI cannot be modified via this UI. ' +
                'These must be set in your .env file and require a server restart.'
            );
        }

        const existingDeployment = config.deployment || {};
        const mergedDeployment = mergeConfig(
          existingDeployment,
          sanitized.deployment
        );

        await this.configManager.update({
          deployment: mergedDeployment,
        });

        this.audit(
          req,
          'success',
          'update_config',
          'Updated deployment configuration',
          {
            fieldsModified: Object.keys(convertedData).length,
          }
        );

        this.sessionManager
          .flash(req)
          .success('Deployment settings updated successfully');
        res.redirect('/admin/settings/deployment');
      } else {
        res.status(405).json({ error: 'Method not allowed' });
      }
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'deployment_settings_update_failed',
      });

      const errorMessage = getErrorMessage(error);
      this.audit(
        req,
        'failed',
        'update_config',
        'Failed to update deployment configuration',
        {
          error: errorMessage,
        }
      );

      this.sessionManager
        .flash(req)
        .error('Failed to update deployment settings');
      res.redirect('/admin/settings/deployment');
    }
  };

  /**
   * Shared POST handler for all security sub-pages
   */
  private handleSecurityPost = async (
    req: Request,
    res: Response,
    redirectUrl: string
  ): Promise<void> => {
    const config = this.configManager.getPlatformConfig();

    const submittedCookieSecrets = Object.prototype.hasOwnProperty.call(
      req.body?.secrets ?? {},
      'cookie_secrets'
    );
    const convertedData = convertSecurityFormData(req.body);

    if (convertedData.secrets && !submittedCookieSecrets) {
      delete convertedData.secrets.cookie_secrets;
    }

    // Inline validation (moved from config-validation middleware for correct redirects)
    const validationErrors = this.validateSecurityData(convertedData);
    if (validationErrors.length > 0) {
      for (const error of validationErrors) {
        this.sessionManager.flash(req).error(error);
      }
      return res.redirect(redirectUrl);
    }

    // Restore any masked sensitive fields to prevent saving masked values
    const currentConfig = this.configManager.getPlatformConfig();
    const { restoredConfig, restoredFields } = restoreMaskedSensitiveFields(
      { security: convertedData },
      currentConfig
    );

    if (restoredFields.length > 0) {
      this.logger.info(
        `Restored ${restoredFields.length} masked sensitive fields`,
        {
          fields: restoredFields,
        }
      );
    }

    const existingSecurity = config.security || {};
    const mergedSecurity = mergeConfig(
      existingSecurity,
      restoredConfig.security
    );

    await this.configManager.update({
      security: mergedSecurity,
    });

    this.audit(
      req,
      'success',
      'update_config',
      'Updated security configuration',
      {
        fieldsModified: Object.keys(convertedData).length,
      }
    );

    this.sessionManager
      .flash(req)
      .success('Security settings updated successfully');
    res.redirect(redirectUrl);
  };

  /**
   * Shared error handler for security sub-pages
   */
  private handleSecurityError = (
    req: Request,
    res: Response,
    error: unknown,
    redirectUrl: string
  ): void => {
    this.logger.error(error as Error, {
      context: 'security_settings_update_failed',
    });

    const errorMessage = getErrorMessage(error);
    this.audit(
      req,
      'failed',
      'update_config',
      'Failed to update security configuration',
      {
        error: errorMessage,
      }
    );

    this.sessionManager.flash(req).error('Failed to update security settings');
    res.redirect(redirectUrl);
  };

  /**
   * Validate security configuration data
   * Replicates essential checks from config-validation middleware
   */
  private validateSecurityData(data: any): string[] {
    const errors: string[] = [];

    if (data.secrets) {
      if (data.secrets.jwt_secret && data.secrets.jwt_secret.length < 32) {
        errors.push(
          'JWT secret must be at least 32 characters long for security'
        );
      }

      if (data.secrets.cookie_secrets) {
        let cookieSecretsArray: string[] = [];
        if (Array.isArray(data.secrets.cookie_secrets)) {
          cookieSecretsArray = data.secrets.cookie_secrets;
        } else {
          errors.push(
            'Cookie secrets must be an array or newline-separated string'
          );
        }

        if (cookieSecretsArray.length === 0) {
          errors.push('At least one cookie secret is required');
        }
        if (cookieSecretsArray.some((s: string) => s.length < 32)) {
          errors.push('All cookie secrets must be at least 32 characters long');
        }
      }
    }

    if (data.authentication?.multi_factor) {
      const { totp, webauthn } = data.authentication.multi_factor;

      if (totp?.enabled && !totp.issuer_name) {
        errors.push('TOTP issuer name is required when TOTP is enabled');
      }

      if (webauthn?.enabled && !webauthn.rp_id) {
        errors.push(
          'WebAuthn Relying Party ID is required when WebAuthn is enabled'
        );
      }

      if (webauthn?.enabled && !webauthn.rp_name) {
        errors.push(
          'WebAuthn Relying Party name is required when WebAuthn is enabled'
        );
      }
    }

    return errors;
  }

  /**
   * Security settings - Authentication & Access sub-page
   */
  securityAuthentication = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      if (req.method === 'GET') {
        const maskedConfig = this.getMaskedConfigSection('security');
        res.render('admin/settings/security', {
          title: 'Authentication & Access',
          section: 'security',
          securityTab: 'authentication',
          config: maskedConfig,
        });
      } else {
        await this.handleSecurityPost(req, res, '/admin/settings/security');
      }
    } catch (error) {
      this.handleSecurityError(req, res, error, '/admin/settings/security');
    }
  };

  /**
   * Security settings - MFA sub-page
   */
  securityMfa = async (req: Request, res: Response): Promise<void> => {
    try {
      if (req.method === 'GET') {
        const maskedConfig = this.getMaskedConfigSection('security');
        res.render('admin/settings/security-mfa', {
          title: 'Multi-Factor Authentication',
          section: 'security',
          securityTab: 'mfa',
          config: maskedConfig,
        });
      } else {
        await this.handleSecurityPost(req, res, '/admin/settings/security/mfa');
      }
    } catch (error) {
      this.handleSecurityError(req, res, error, '/admin/settings/security/mfa');
    }
  };

  /**
   * Security settings - Sessions sub-page
   */
  securitySessions = async (req: Request, res: Response): Promise<void> => {
    try {
      if (req.method === 'GET') {
        const maskedConfig = this.getMaskedConfigSection('security');
        res.render('admin/settings/security-sessions', {
          title: 'Session Management',
          section: 'security',
          securityTab: 'sessions',
          config: maskedConfig,
        });
      } else {
        await this.handleSecurityPost(
          req,
          res,
          '/admin/settings/security/sessions'
        );
      }
    } catch (error) {
      this.handleSecurityError(
        req,
        res,
        error,
        '/admin/settings/security/sessions'
      );
    }
  };

  /**
   * Security settings - Protection sub-page
   */
  securityProtection = async (req: Request, res: Response): Promise<void> => {
    try {
      if (req.method === 'GET') {
        const maskedConfig = this.getMaskedConfigSection('security');
        res.render('admin/settings/security-protection', {
          title: 'Protection & Detection',
          section: 'security',
          securityTab: 'protection',
          config: maskedConfig,
        });
      } else {
        await this.handleSecurityPost(
          req,
          res,
          '/admin/settings/security/protection'
        );
      }
    } catch (error) {
      this.handleSecurityError(
        req,
        res,
        error,
        '/admin/settings/security/protection'
      );
    }
  };

  /**
   * Security settings - Secrets sub-page
   */
  securitySecrets = async (req: Request, res: Response): Promise<void> => {
    try {
      if (req.method === 'GET') {
        const maskedConfig = this.getMaskedConfigSection('security');
        res.render('admin/settings/security-secrets', {
          title: 'Security Secrets',
          section: 'security',
          securityTab: 'secrets',
          config: maskedConfig,
        });
      } else {
        await this.handleSecurityPost(
          req,
          res,
          '/admin/settings/security/secrets'
        );
      }
    } catch (error) {
      this.handleSecurityError(
        req,
        res,
        error,
        '/admin/settings/security/secrets'
      );
    }
  };

  /**
   * Features settings - display and edit
   */
  features = async (req: Request, res: Response): Promise<void> => {
    try {
      const config = this.configManager.getPlatformConfig();

      if (req.method === 'GET') {
        const maskedConfig = this.getMaskedConfigSection('features');

        res.render('admin/settings/features', {
          title: 'Features Settings',
          section: 'features',
          config: maskedConfig,
        });
      } else if (req.method === 'POST') {
        const convertedData = convertFeaturesFormData(req.body);

        // Restore any masked sensitive fields to prevent saving masked values
        const currentConfig = this.configManager.getPlatformConfig();
        const { restoredConfig, restoredFields } = restoreMaskedSensitiveFields(
          { features: convertedData },
          currentConfig
        );

        if (restoredFields.length > 0) {
          this.logger.info(
            `Restored ${restoredFields.length} masked sensitive fields`,
            {
              fields: restoredFields,
            }
          );
        }

        const existingFeatures = config.features || {};
        const mergedFeatures = mergeConfig(
          existingFeatures,
          restoredConfig.features
        );

        await this.configManager.update({
          features: mergedFeatures,
        });

        this.audit(
          req,
          'success',
          'update_config',
          'Updated features configuration',
          {
            fieldsModified: Object.keys(convertedData).length,
          }
        );

        this.sessionManager
          .flash(req)
          .success('Features settings updated successfully');
        res.redirect('/admin/settings/features');
      } else {
        res.status(405).json({ error: 'Method not allowed' });
      }
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'features_settings_update_failed',
      });

      const errorMessage = getErrorMessage(error);
      this.audit(
        req,
        'failed',
        'update_config',
        'Failed to update features configuration',
        {
          error: errorMessage,
        }
      );

      this.sessionManager
        .flash(req)
        .error('Failed to update features settings');
      res.redirect('/admin/settings/features');
    }
  };

  /**
   * OIDC settings - display and edit
   */
  oidc = async (req: Request, res: Response): Promise<void> => {
    try {
      const config = this.configManager.getPlatformConfig();

      if (req.method === 'GET') {
        const maskedConfig = this.getMaskedConfigSection('oidc');

        res.render('admin/settings/oidc', {
          title: 'OIDC Settings',
          section: 'oidc',
          config: maskedConfig,
          deploymentUrl: config.deployment.url || '',
        });
      } else if (req.method === 'POST') {
        this.logger.debug('OIDC form data received', {
          section: 'oidc',
          hasData: !!req.body,
          fieldCount: Object.keys(req.body).length,
          modifiedBy: this.sessionManager.getActiveUser(req)?.email,
        });

        const convertedData = convertOidcFormData(req.body);

        this.logger.debug('OIDC data converted', {
          section: 'oidc',
          hasConvertedData: !!convertedData,
          modifiedBy: this.sessionManager.getActiveUser(req)?.email,
        });

        // Restore any masked sensitive fields to prevent saving masked values
        const currentConfig = this.configManager.getPlatformConfig();
        const { restoredConfig, restoredFields } = restoreMaskedSensitiveFields(
          convertedData,
          currentConfig
        );

        if (restoredFields.length > 0) {
          this.logger.info(
            `Restored ${restoredFields.length} masked sensitive fields`,
            {
              fields: restoredFields,
            }
          );
        }

        const existingOidc = config.oidc || {};
        const mergedOidc = mergeConfig(existingOidc, restoredConfig.oidc);

        this.logger.debug('OIDC data merged', {
          section: 'oidc',
          hasMergedData: !!mergedOidc,
          modifiedBy: this.sessionManager.getActiveUser(req)?.email,
        });

        try {
          await this.configManager.update({
            oidc: mergedOidc,
          });

          this.audit(
            req,
            'success',
            'update_config',
            'Updated OIDC configuration',
            {
              fieldsModified: Object.keys(req.body).length,
            }
          );

          this.logger.info('OIDC config updated successfully', {
            section: 'oidc',
            modifiedBy: this.sessionManager.getActiveUser(req)?.email,
            timestamp: new Date().toISOString(),
          });
          this.sessionManager
            .flash(req)
            .success('OIDC settings updated successfully');
          res.redirect('/admin/settings/oidc');
        } catch (updateError) {
          this.logger.error(updateError as Error, {
            context: 'oidc_config_update_failed',
            section: 'oidc',
            modifiedBy: this.sessionManager.getActiveUser(req)?.email,
          });

          const errorMessage = getErrorMessage(updateError);
          this.audit(
            req,
            'failed',
            'update_config',
            'Failed to update OIDC configuration',
            {
              error: errorMessage,
            }
          );

          this.sessionManager
            .flash(req)
            .error(`Failed to update OIDC settings: ${errorMessage}`);
          res.redirect('/admin/settings/oidc');
        }
      } else {
        res.status(405).json({ error: 'Method not allowed' });
      }
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'oidc_settings_update_failed',
      });

      const errorMessage = getErrorMessage(error);
      this.audit(
        req,
        'failed',
        'update_config',
        'Failed to update OIDC configuration',
        {
          error: errorMessage,
        }
      );

      this.sessionManager.flash(req).error('Failed to update OIDC settings');
      res.redirect('/admin/settings/oidc');
    }
  };

  /**
   * Integrations settings - display and edit
   * Also handles notification channel configuration
   */
  integrations = async (req: Request, res: Response): Promise<void> => {
    try {
      const config = this.configManager.getPlatformConfig();

      if (req.method === 'GET') {
        const maskedIntegrations = this.getMaskedConfigSection('integrations');
        const maskedNotifications =
          this.getMaskedConfigSection('notifications');

        // This prevents view template errors when accessing nested properties
        const notificationsDefaults = {
          channels: {
            email: { enabled: true },
            sms: {
              enabled: false,
              provider: undefined,
              api_key: undefined,
              api_secret: undefined,
            },
          },
          defaults: {
            security_alerts: true,
            new_session_alerts: true,
            allow_user_preferences: true,
          },
        };

        // Deep merge defaults with actual config values
        const notificationsWithDefaults = {
          channels: {
            email: {
              ...notificationsDefaults.channels.email,
              ...(maskedNotifications?.channels?.email || {}),
            },
            sms: {
              ...notificationsDefaults.channels.sms,
              ...(maskedNotifications?.channels?.sms || {}),
            },
          },
          defaults: {
            ...notificationsDefaults.defaults,
            ...(maskedNotifications?.defaults || {}),
          },
        };

        res.render('admin/settings/integrations', {
          title: 'Integrations Settings',
          section: 'integrations',
          config: {
            ...maskedIntegrations,
            notifications: notificationsWithDefaults,
          },
        });
      } else if (req.method === 'POST') {
        const convertedData = convertIntegrationsFormData(req.body);

        const convertedNotifications = req.body.notifications
          ? convertNotificationsFormData(req.body)
          : null;

        // Restore any masked sensitive fields to prevent saving masked values
        const currentConfig = this.configManager.getPlatformConfig();
        const configToRestore: any = { integrations: convertedData };
        if (convertedNotifications) {
          configToRestore.notifications = convertedNotifications;
        }

        const { restoredConfig, restoredFields } = restoreMaskedSensitiveFields(
          configToRestore,
          currentConfig
        );

        if (restoredFields.length > 0) {
          this.logger.info(
            `Restored ${restoredFields.length} masked sensitive fields`,
            {
              fields: restoredFields,
            }
          );
        }

        const { urls, ...integrationFields } = restoredConfig.integrations;

        const existingIntegrations = config.integrations || {};
        const mergedIntegrations = mergeConfig(
          existingIntegrations,
          integrationFields
        );

        const existingUrls = existingIntegrations.urls || {};
        const mergedUrls = urls
          ? mergeConfig(existingUrls, urls)
          : existingUrls;

        const updateData: any = {
          integrations: {
            ...mergedIntegrations,
            urls: mergedUrls,
          },
        };

        // Use skipUndefined: false to allow clearing optional fields
        if (restoredConfig.notifications) {
          const existingNotifications = config.notifications || {};
          updateData.notifications = mergeConfig(
            existingNotifications,
            restoredConfig.notifications,
            { skipUndefined: false }
          );
        }

        await this.configManager.update(updateData);

        this.audit(
          req,
          'success',
          'update_config',
          'Updated integrations configuration',
          {
            fieldsModified: Object.keys(convertedData).length,
          }
        );

        this.sessionManager
          .flash(req)
          .success('Integrations settings updated successfully');
        res.redirect('/admin/settings/integrations');
      } else {
        res.status(405).json({ error: 'Method not allowed' });
      }
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'integrations_settings_update_failed',
      });

      const errorMessage = getErrorMessage(error);
      this.audit(
        req,
        'failed',
        'update_config',
        'Failed to update integrations configuration',
        {
          error: errorMessage,
        }
      );

      this.sessionManager
        .flash(req)
        .error('Failed to update integrations settings');
      res.redirect('/admin/settings/integrations');
    }
  };

  /**
   * Reload configuration from database
   */
  reload = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.configManager.reload();
      this.sessionManager
        .flash(req)
        .success('Configuration reloaded successfully');
      res.redirect('/admin/settings');
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'configuration_reload_failed',
      });
      this.sessionManager.flash(req).error('Failed to reload configuration');
      res.redirect('/admin/settings');
    }
  };

  /**
   * Test email configuration
   * Logs all attempts to ActivityService for security auditing
   */
  testEmail = async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    const userData = this.sessionManager.getActiveUser(req);
    const requestedBy = getRequestedBy(userData);
    const requestIp = getRequestIp(req);
    const userAgent = getRequestUserAgent(req);

    try {
      const { email } = req.body;

      this.logger.info('Test email requested', {
        requestedBy,
        recipientEmail: email,
        ip: requestIp,
        userAgent,
        context: 'test_email_attempt',
      });

      if (!email) {
        this.audit(
          req,
          'failed',
          'test_email',
          'Test email failed: Email address is required'
        );

        res.status(400).json({
          success: false,
          error: 'Email address is required',
        });
        return;
      }

      if (typeof email !== 'string') {
        this.audit(
          req,
          'failed',
          'test_email',
          'Test email failed: Invalid email format'
        );

        res.status(400).json({
          success: false,
          error: 'Invalid email address format',
        });
        return;
      }

      if (email.length > 254) {
        this.audit(
          req,
          'failed',
          'test_email',
          'Test email failed: Email address too long',
          {
            emailLength: email.length,
          }
        );

        res.status(400).json({
          success: false,
          error: 'Email address is too long',
        });
        return;
      }

      const emailRegex =
        /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
      if (!emailRegex.test(email)) {
        this.audit(
          req,
          'failed',
          'test_email',
          'Test email failed: Invalid email format'
        );

        res.status(400).json({
          success: false,
          error: 'Invalid email address format',
        });
        return;
      }

      const recipientDomain = email.split('@')[1].toLowerCase();
      const config = this.configManager.getPlatformConfig();
      const deploymentUrl = config.deployment?.url || 'http://localhost:3000';
      const appDomain = new URL(deploymentUrl).hostname.toLowerCase();

      const isExternalDomain =
        recipientDomain !== appDomain &&
        !recipientDomain.endsWith(`.${appDomain}`);
      if (isExternalDomain) {
        this.logger.warn('Test email to external domain', {
          requestedBy,
          recipientEmail: email,
          recipientDomain,
          appDomain,
          ip: requestIp,
          context: 'test_email_external_domain',
        });
      }

      const freeEmailProviders = [
        'gmail.com',
        'yahoo.com',
        'hotmail.com',
        'outlook.com',
        'aol.com',
        'icloud.com',
        'protonmail.com',
        'mail.com',
      ];
      const isFreeProvider = freeEmailProviders.includes(recipientDomain);

      this.emailService.initialize();

      const subject = 'Test Email from Parako.ID';
      const timestamp = new Date().toISOString();
      const text = `This is a test email from your Parako.ID configuration. If you received this email, your SMTP settings are working correctly.\n\nTimestamp: ${timestamp}\nRequested by: ${requestedBy}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Test Email from Parako.ID</h2>
          <p>This is a test email from your Parako.ID configuration. If you received this email, your SMTP settings are working correctly.</p>
          <p><strong>Timestamp:</strong> ${timestamp}</p>
          <p><strong>Requested by:</strong> ${requestedBy}</p>
          <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
          <p style="color: #666; font-size: 12px;">This is an automated test email. Please do not reply.</p>
        </div>
      `;

      await this.emailService.sendEmail(email, subject, text, html);

      const duration = Date.now() - startTime;

      this.logger.info('Test email sent successfully', {
        requestedBy,
        recipientEmail: email,
        recipientDomain,
        isExternalDomain,
        isFreeProvider,
        duration,
        ip: requestIp,
        context: 'test_email_success',
      });

      this.audit(req, 'success', 'test_email', 'Test email sent successfully', {
        recipientEmail: email,
      });

      res.json({
        success: true,
        message: 'Test email sent successfully',
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = getErrorMessage(error);

      this.logger.error(error as Error, {
        context: 'test_email_failed',
        requestedBy,
        recipientEmail: req.body.email,
        ip: requestIp,
        userAgent,
        duration,
        errorMessage,
      });

      this.audit(req, 'failed', 'test_email', 'Test email failed', {
        error: errorMessage,
      });

      res.status(500).json({
        success: false,
        error: getErrorMessage(error, 'Failed to send test email'),
      });
    }
  };

  /**
   * Rollback configuration to a previous version
   * Creates a new active version from a previous inactive version
   */
  rollback = async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    const userData = this.sessionManager.getActiveUser(req);
    const requestedBy = getRequestedBy(userData);
    const requestIp = getRequestIp(req);
    const userAgent = getRequestUserAgent(req);

    try {
      const rawVersionId = req.body.versionId;
      const versionId =
        typeof rawVersionId === 'string' ? rawVersionId.trim() : '';

      this.logger.info('Configuration rollback requested', {
        versionId,
        requestedBy,
        ip: requestIp,
        context: 'rollback_attempt',
      });

      if (!versionId) {
        this.sessionManager
          .flash(req)
          .error('Version ID is required for rollback');
        res.redirect('/admin/settings');
        return;
      }

      const targetVersion = await this.settingsService.findOne(versionId);

      if (!targetVersion) {
        this.logger.warn('Rollback failed: Version not found', {
          versionId,
          requestedBy,
          ip: requestIp,
        });

        this.sessionManager.flash(req).error('Configuration version not found');
        res.redirect('/admin/settings');
        return;
      }

      if (targetVersion.is_active) {
        this.logger.warn('Rollback failed: Cannot rollback to active version', {
          versionId,
          requestedBy,
          ip: requestIp,
        });

        this.sessionManager
          .flash(req)
          .error('Cannot rollback to the currently active version');
        res.redirect('/admin/settings');
        return;
      }

      const currentConfig = this.configManager.getPlatformConfig();
      const currentVersion = (currentConfig as any).version || 'unknown';

      const rollbackReason = `Rollback to version ${targetVersion.version} (from ${currentVersion})`;

      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructure-and-discard pattern strips Mongoose metadata fields before rollback save.
      const { _id, created_at, updated_at, __v, ...configData } =
        targetVersion as any;

      await this.settingsService.saveMainConfiguration(
        configData,
        requestedBy,
        rollbackReason
      );

      await this.configManager.reload();

      const duration = Date.now() - startTime;

      this.logger.info('Configuration rollback completed successfully', {
        fromVersion: currentVersion,
        toVersion: targetVersion.version,
        targetVersionId: versionId,
        requestedBy,
        duration,
        ip: requestIp,
        context: 'rollback_success',
      });

      this.audit(
        req,
        'success',
        'rollback_config',
        'Configuration rolled back successfully',
        {
          fromVersion: currentVersion,
          toVersion: targetVersion.version,
        }
      );

      this.sessionManager
        .flash(req)
        .success(
          `Configuration successfully rolled back to version ${targetVersion.version}`
        );
      res.redirect('/admin/settings');
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = getErrorMessage(error);

      this.logger.error(error as Error, {
        context: 'rollback_failed',
        versionId: req.body.versionId,
        requestedBy,
        ip: requestIp,
        userAgent,
        duration,
        errorMessage,
      });

      this.audit(
        req,
        'failed',
        'rollback_config',
        'Configuration rollback failed',
        {
          error: errorMessage,
        }
      );

      this.sessionManager
        .flash(req)
        .error(`Failed to rollback configuration: ${errorMessage}`);
      res.redirect('/admin/settings');
    }
  };

  /**
   * Get configuration statistics
   */
  stats = async (req: Request, res: Response): Promise<void> => {
    try {
      const config = this.configManager.getPlatformConfig();

      const stats = {
        isLoaded: this.configManager.isLoaded(),
        lastUpdated: new Date().toISOString(), // This would come from the actual config
        sections: {
          application: !!config.application,
          branding: !!config.branding,
          deployment: !!config.deployment,
          security: !!config.security,
          features: !!config.features,
          oidc: !!config.oidc,
          integrations: !!config.integrations,
        },
      };

      res.json(stats);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'configuration_stats_failed',
      });
      res.status(500).json({ error: 'Failed to get configuration statistics' });
    }
  };

  /**
   * Export current configuration as JSON file
   * Secrets are masked for security - must be manually added after import
   *
   * GET /admin/settings/export
   */
  exportConfig = async (req: Request, res: Response): Promise<void> => {
    try {
      const userData = this.sessionManager.getActiveUser(req);
      const requestIp = getRequestIp(req);
      const config = this.configManager.getPlatformConfig();

      const sanitizedConfig = prepareSensitiveConfigForDisplay(config);

      const now = new Date();
      const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD format
      const filename = `parako-config-export-${dateStr}.json`;

      this.logger.info('Configuration export requested', {
        exportedBy: getRequestedBy(userData),
        filename,
        ip: requestIp,
        context: 'config_export',
      });

      this.audit(req, 'info', 'export_config', 'Configuration exported', {
        filename,
      });

      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`
      );

      const exportData = {
        _export_metadata: {
          exportedAt: now.toISOString(),
          exportedBy: getRequestedBy(userData),
          version: (config as any).version || '1.0.0',
          warning:
            'SECURITY WARNING: Sensitive fields are masked with asterisks. ' +
            'You must manually add actual secret values after importing this configuration.',
        },
        ...sanitizedConfig,
      };

      res.json(exportData);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'config_export_failed',
        exportedBy: this.sessionManager.getActiveUser(req)?.email,
      });

      // Don't redirect for API endpoint - return error JSON
      res.status(500).json({
        error: 'Failed to export configuration',
        message: getErrorMessage(error),
      });
    }
  };

  /**
   * Configuration import page
   * Displays the dedicated import page for uploading/previewing/applying config
   *
   * GET /admin/settings/import
   */
  importPage = async (req: Request, res: Response): Promise<void> => {
    try {
      res.render('admin/settings/import', {
        title: 'Import Configuration',
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'import_page_failed',
      });
      this.sessionManager.flash(req).error('Failed to load import page');
      res.redirect('/admin/settings');
    }
  };

  /**
   * Preview configuration import
   * Validates uploaded config and shows diff without applying
   *
   * POST /admin/settings/import/preview
   */
  importConfigPreview = async (req: Request, res: Response): Promise<void> => {
    try {
      const importedConfig = req.body.config;

      if (!importedConfig) {
        res.status(400).json({
          success: false,
          error: 'No configuration data provided',
        });
        return;
      }

      let parsedConfig: any;
      try {
        parsedConfig =
          typeof importedConfig === 'string'
            ? JSON.parse(importedConfig)
            : importedConfig;
      } catch {
        res.status(400).json({
          success: false,
          error: 'Invalid JSON format',
        });
        return;
      }

      if (
        parsedConfig === null ||
        typeof parsedConfig !== 'object' ||
        Array.isArray(parsedConfig)
      ) {
        res.status(400).json({
          success: false,
          error: 'Configuration must be a JSON object',
        });
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructure-and-discard pattern strips the import-only metadata wrapper before diffing/applying the payload.
      const { _export_metadata, ...configData } = parsedConfig;

      const currentConfig = this.configManager.getPlatformConfig();

      const diff = this.settingsService.generateConfigDiff(
        currentConfig,
        configData
      );

      const impact = this.settingsService.analyzeConfigImpact(diff);

      const userData = this.sessionManager.getActiveUser(req);
      const requestIp = getRequestIp(req);

      this.logger.info('Configuration import preview requested', {
        requestedBy: getRequestedBy(userData),
        changeCount: diff.length,
        ip: requestIp,
        context: 'config_import_preview',
      });

      res.json({
        success: true,
        valid: true,
        diff,
        impact,
        changeCount: diff.length,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'config_import_preview_failed',
        importedBy: this.sessionManager.getActiveUser(req)?.email,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to preview configuration import',
        message: getErrorMessage(error),
      });
    }
  };

  /**
   * Apply configuration import
   * Applies the imported configuration after preview and confirmation
   *
   * POST /admin/settings/import/apply
   */
  applyImport = async (req: Request, res: Response): Promise<void> => {
    const userData = this.sessionManager.getActiveUser(req);
    const requestIp = getRequestIp(req);

    try {
      const importedConfig = req.body.config;

      if (!importedConfig) {
        this.sessionManager
          .flash(req)
          .error('No configuration data provided for import');
        res.redirect('/admin/settings');
        return;
      }

      let parsedConfig: any;
      try {
        parsedConfig =
          typeof importedConfig === 'string'
            ? JSON.parse(importedConfig)
            : importedConfig;
      } catch {
        this.sessionManager.flash(req).error('Invalid JSON format');
        res.redirect('/admin/settings');
        return;
      }

      if (
        parsedConfig === null ||
        typeof parsedConfig !== 'object' ||
        Array.isArray(parsedConfig)
      ) {
        this.sessionManager
          .flash(req)
          .error('Configuration must be a JSON object');
        res.redirect('/admin/settings');
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructure-and-discard pattern strips the import-only metadata wrapper before diffing/applying the payload.
      const { _export_metadata, ...configData } = parsedConfig;

      const currentConfig = this.configManager.getPlatformConfig();

      // This prevents the app from breaking when importing configs with masked secrets
      const { restoredConfig, restoredFields } = restoreMaskedSensitiveFields(
        configData,
        currentConfig
      );

      if (restoredFields.length > 0) {
        this.logger.info(
          'Restored masked sensitive fields from current config',
          {
            restoredFields,
            importedBy: getRequestedBy(userData),
            ip: requestIp,
            context: 'config_import_restore_masked',
          }
        );
      }

      await this.configManager.update(restoredConfig);

      await this.configManager.reload();

      this.logger.info('Configuration imported successfully', {
        importedBy: getRequestedBy(userData),
        ip: requestIp,
        context: 'config_import_applied',
      });

      this.audit(
        req,
        'success',
        'import_config',
        'Configuration imported and applied successfully'
      );

      res.json({
        success: true,
        message:
          'Configuration imported successfully. All changes have been applied and the system has been reloaded.',
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'config_import_apply_failed',
        importedBy: userData?.email,
      });

      const errorMessage = getErrorMessage(error);
      this.audit(
        req,
        'failed',
        'import_config',
        'Failed to import configuration',
        {
          error: errorMessage,
        }
      );

      res.status(500).json({
        success: false,
        error: errorMessage,
        message: `Failed to import configuration: ${errorMessage}`,
      });
    }
  };

  /**
   * Reveal a secret configuration value
   */
  public revealSecret = async (req: Request, res: Response): Promise<void> => {
    try {
      const { fieldPath } = req.body;
      // Use sessionManager.getActiveUser() instead of direct session access
      const userData = this.sessionManager.getActiveUser(req);
      if (!userData) {
        res.status(401).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      if (!fieldPath || typeof fieldPath !== 'string') {
        res.status(400).json({
          success: false,
          error: 'Field path is required',
        });
        return;
      }

      if (!SENSITIVE_FIELDS.includes(fieldPath as any)) {
        res.status(400).json({
          success: false,
          error: 'Invalid field path',
        });
        return;
      }

      const decryptedSettings =
        await this.settingsService.loadAndDecryptConfiguration();

      if (!decryptedSettings) {
        res.status(404).json({
          success: false,
          error: 'Configuration not found',
        });
        return;
      }

      // For new/undefined fields, return empty string to allow setting for the first time
      const actualValue = getNestedValue(decryptedSettings, fieldPath) ?? '';

      this.audit(
        req,
        'warning',
        'reveal_secret',
        'Admin revealed secret field',
        {
          fieldPath,
        }
      );

      this.logger.warn('Secret field revealed', {
        action: 'reveal_secret',
        fieldPath,
        username: userData.username,
        userId: userData.id,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        timestamp: new Date().toISOString(),
      });

      res.json({
        success: true,
        value: actualValue,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'reveal_secret_failed',
        fieldPath: req.body.fieldPath,
        username: this.sessionManager.getActiveUser(req)?.username,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to reveal secret',
      });
    }
  };

  /**
   * Configuration health check endpoint
   * Tests all critical configuration components and returns health status
   *
   * GET /admin/settings/health
   */
  healthCheck = async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    const checks: Record<string, boolean> = {};
    let overallHealthy = true;

    try {
      checks.configLoaded = this.configManager.isLoaded();
      if (!checks.configLoaded) {
        overallHealthy = false;
      }

      const config = checks.configLoaded
        ? this.configManager.getPlatformConfig()
        : null;

      try {
        await this.settingsService.findMany({}, { limit: 1 });
        checks.databaseConnectivity = true;
      } catch (error) {
        this.logger.warn('Database connectivity check failed', { error });
        checks.databaseConnectivity = false;
        overallHealthy = false;
      }

      if (config?.integrations?.email?.smtp_host) {
        try {
          // Test SMTP connection with timeout
          const testResult = await withTimeout(
            this.emailService.connectToEmailServer(),
            5000,
            'SMTP test timeout'
          );
          checks.smtpConnectivity = testResult === true;
        } catch (error) {
          this.logger.warn('SMTP connectivity check failed', { error });
          checks.smtpConnectivity = false;
          // SMTP is optional, don't mark as unhealthy
        }
      } else {
        checks.smtpConnectivity = null as any; // Not configured
      }

      const oidcAdapterType = config?.oidc_storage?.oidc_adapter?.type;
      if (oidcAdapterType === 'mongodb') {
        // MongoDB adapter uses same connection as main database
        checks.oidcStorageConnectivity = checks.databaseConnectivity;
      } else if (oidcAdapterType === 'redis' && config) {
        let testClient: Redis | undefined;
        try {
          const redisConfig = config.oidc_storage.oidc_adapter.redis;
          if (redisConfig?.host && redisConfig?.port) {
            const auth = redisConfig.password
              ? `:${encodeURIComponent(redisConfig.password)}@`
              : '';
            const uri = `redis://${auth}${redisConfig.host}:${redisConfig.port}/${redisConfig.database || 0}`;

            testClient = new Redis(uri, {
              lazyConnect: true,
              connectTimeout: 5000,
              maxRetriesPerRequest: 1,
            });

            await testClient.connect();
            const pingResult = await testClient.ping();
            checks.oidcStorageConnectivity = pingResult === 'PONG';
            if (!checks.oidcStorageConnectivity) {
              overallHealthy = false;
            }
          } else {
            checks.oidcStorageConnectivity = false;
            overallHealthy = false;
            this.logger.warn('Redis config incomplete for health check');
          }
        } catch (error) {
          this.logger.warn('Redis connectivity check failed', { error });
          checks.oidcStorageConnectivity = false;
          overallHealthy = false;
        } finally {
          if (testClient) {
            try {
              await testClient.quit();
            } catch (error) {
              this.logger.warn('Redis health client cleanup failed', {
                error,
              });
            }
          }
        }
      } else if (
        oidcAdapterType === 'sqlite' ||
        oidcAdapterType === 'postgresql'
      ) {
        // Prisma-backed adapters share the main database connectivity
        checks.oidcStorageConnectivity = checks.databaseConnectivity;
      } else {
        checks.oidcStorageConnectivity = false;
        overallHealthy = false;
      }

      if (config?.oidc?.issuer) {
        try {
          const issuerUrl = `${config.oidc.issuer}/.well-known/openid-configuration`;
          const response = await fetch(issuerUrl, {
            method: 'GET',
            signal: AbortSignal.timeout(5000), // 5 second timeout
          });
          checks.oidcIssuerReachable = response.ok;
          if (!checks.oidcIssuerReachable) {
            this.logger.warn('OIDC issuer not reachable', {
              issuerUrl,
              status: response.status,
            });
          }
        } catch (error) {
          this.logger.warn('OIDC issuer reachability check failed', { error });
          checks.oidcIssuerReachable = false;
          // Don't mark as critical failure since issuer might not be deployed yet
        }
      } else {
        checks.oidcIssuerReachable = null as any; // Not configured
      }

      const provider = this.configManager.isUsingFileConfig()
        ? 'file'
        : 'database';

      const metadata = (config as any)?._metadata;
      const lastLoaded = metadata?.loadedAt
        ? new Date(metadata.loadedAt).toISOString()
        : new Date().toISOString();

      const healthStatus = {
        status: overallHealthy ? 'healthy' : 'unhealthy',
        provider,
        lastLoaded,
        checks,
        responseTime: Date.now() - startTime,
      };

      this.logger.debug('Configuration health check completed', {
        ...healthStatus,
        requestedBy: this.sessionManager.getActiveUser(req)?.email,
      });

      const statusCode = overallHealthy ? 200 : 503;
      res.status(statusCode).json(healthStatus);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'health_check_failed',
      });

      res.status(503).json({
        status: 'unhealthy',
        error: 'Health check failed',
        checks,
        responseTime: Date.now() - startTime,
      });
    }
  };
}
