import { injectable, inject } from 'inversify';
import { Request, Response } from 'express';
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
import { mergeConfig } from '../../utils/config-merge.js';
import {
  convertApplicationFormData,
  convertBrandingFormData,
  convertDeploymentFormData,
  convertFeaturesFormData,
  convertOidcFormData,
  convertIntegrationsFormData,
  convertNotificationsFormData,
  prepareSensitiveConfigForDisplay,
  restoreMaskedSensitiveFields,
  BOOTSTRAP_ONLY_FIELDS,
  getNestedValue,
} from '../../utils/settings.helper.js';
import { ConfigurationVersionConflictError } from '../../errors/configuration-version-conflict.error.js';
import {
  createSecuritySettingsViewModel,
  createSettingsOverviewViewModel,
  type ApplicationSettingsViewModel,
  type BrandingSettingsViewModel,
  type DeploymentSettingsViewModel,
  type FeaturesSettingsViewModel,
  type IntegrationsSettingsViewModel,
  type OidcSettingsViewModel,
} from './settings-view-model.js';
import {
  parseApplicationSettingsForm,
  parseBrandingSettingsForm,
  parseDeploymentSettingsForm,
  parseFeaturesSettingsForm,
  parseIntegrationsSettingsForm,
  parseOidcSettingsForm,
} from '../../config/schemas/settings-form-schema.js';
import { parseConfigurationVersionId } from '../../services/admin/configuration-version.service.js';
import type { AdminSettingsControllerOperationModules } from '../../di/factories/controller-operations.factory.js';

const CONFIGURATION_CONFLICT_MESSAGE =
  'Configuration was modified by another administrator. Reload the latest settings, review them, and try again.';

function parseConfigurationVersion(value: unknown): number {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new ConfigurationVersionConflictError();
  }

  const version = Number(value);
  if (!Number.isSafeInteger(version)) {
    throw new ConfigurationVersionConflictError();
  }

  return version;
}

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

/** Reads and writes settings exclusively through ConfigManager. */
@injectable()
export class AdminSettingsController implements IAdminSettingsController {
  private readonly brandingSettingsService: AdminSettingsControllerOperationModules['branding'];
  private readonly configurationTransferService: AdminSettingsControllerOperationModules['configurationTransfer'];
  private readonly configurationVersionService: AdminSettingsControllerOperationModules['configurationVersion'];
  private readonly securitySettingsService: AdminSettingsControllerOperationModules['security'];
  private readonly configurationHealthService: AdminSettingsControllerOperationModules['configurationHealth'];
  private readonly testEmailService: AdminSettingsControllerOperationModules['testEmail'];
  private readonly secretRevealService: AdminSettingsControllerOperationModules['secretReveal'];

  constructor(
    @inject(TYPES.ConfigManager) private configManager: IConfigManager,
    @inject(TYPES.SessionManager) private sessionManager: ISessionManager,
    @inject(TYPES.Logger) private logger: ILogger,
    @inject(TYPES.EmailService) private emailService: IEmailService,
    @inject(TYPES.ActivityService) private activityService: IActivityService,
    @inject(TYPES.SettingsService) private settingsService: ISettingsService,
    @inject(TYPES.UploadMiddleware) private uploadMiddleware: IUploadMiddleware,
    @inject(TYPES.ClientDeviceInfoManager)
    private readonly clientDeviceInfoManager: IClientDeviceInfoManager,
    @inject(TYPES.AdminSettingsControllerOperationModules)
    operationModules: AdminSettingsControllerOperationModules
  ) {
    this.brandingSettingsService = operationModules.branding;
    this.configurationTransferService = operationModules.configurationTransfer;
    this.configurationVersionService = operationModules.configurationVersion;
    this.securitySettingsService = operationModules.security;
    this.configurationHealthService = operationModules.configurationHealth;
    this.testEmailService = operationModules.testEmail;
    this.secretRevealService = operationModules.secretReveal;
  }

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

  overview = async (req: Request, res: Response): Promise<void> => {
    try {
      const versionHistory = await this.settingsService.findMany(
        { key: 'parako_config' },
        { sort: { created_at: -1 }, limit: 10 }
      );

      res.render(
        'admin/settings/overview',
        createSettingsOverviewViewModel(
          versionHistory,
          this.configManager.isUsingFileConfig()
        )
      );
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'settings_overview_loading_failed',
      });
      this.sessionManager.flash(req).error('Failed to load settings overview');
      res.redirect('/admin');
    }
  };

  application = async (req: Request, res: Response): Promise<void> => {
    try {
      const config = this.configManager.getPlatformConfig();

      if (req.method === 'GET') {
        const activeConfig = await this.settingsService.getMainConfiguration();
        res.render('admin/settings/application', {
          title: 'Application Settings',
          section: 'application',
          config: config.application,
          configVersion: activeConfig?._version,
        } satisfies ApplicationSettingsViewModel);
      } else if (req.method === 'POST') {
        const { data: applicationData, configVersion } =
          parseApplicationSettingsForm(req.body);
        const expectedVersion = parseConfigurationVersion(configVersion);
        const convertedApplicationData =
          convertApplicationFormData(applicationData);
        const existingApplication = config.application || {};
        const mergedApplication = mergeConfig(
          existingApplication,
          convertedApplicationData
        );

        await this.configManager.update(
          { application: mergedApplication },
          expectedVersion
        );

        this.audit(
          req,
          'success',
          'update_config',
          'Updated application configuration',
          {
            fieldsModified: Object.keys(convertedApplicationData).length,
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
        .error(
          error instanceof ConfigurationVersionConflictError
            ? CONFIGURATION_CONFLICT_MESSAGE
            : 'Failed to update application settings'
        );
      res.redirect('/admin/settings/application');
    }
  };

  branding = async (req: Request, res: Response): Promise<void> => {
    try {
      const config = this.configManager.getPlatformConfig();

      if (req.method === 'GET') {
        res.render('admin/settings/branding', {
          title: 'Branding Settings',
          section: 'branding',
          config: await this.brandingSettingsService.resolveAssetUrls(
            config.branding
          ),
        } satisfies BrandingSettingsViewModel);
      } else if (req.method === 'POST') {
        const file = req.file;
        const convertedData = convertBrandingFormData(
          parseBrandingSettingsForm(req.body)
        );
        const { modifiedFieldCount } =
          await this.brandingSettingsService.updateSettings(
            convertedData,
            file
          );

        this.audit(
          req,
          'success',
          'update_config',
          'Updated branding configuration',
          {
            fieldsModified: modifiedFieldCount,
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

  removeLogo = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.brandingSettingsService.removeAsset('logo');

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

  resetColors = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.brandingSettingsService.resetThemePart('colors');

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

  resetFonts = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.brandingSettingsService.resetThemePart('fonts');

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

  uploadLogoDark = async (req: Request, res: Response): Promise<void> => {
    try {
      const file = req.file;

      if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const { url } = await this.brandingSettingsService.replaceAsset(
        'logoDark',
        file
      );

      this.audit(req, 'success', 'update_config', 'Uploaded dark mode logo', {
        action: 'upload_logo_dark',
        filename: file.filename,
      });

      res.json({
        success: true,
        message: 'Dark mode logo uploaded successfully',
        url,
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

  removeLogoDark = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.brandingSettingsService.removeAsset('logoDark');

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

  uploadLogoIcon = async (req: Request, res: Response): Promise<void> => {
    try {
      const file = req.file;

      if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const { url } = await this.brandingSettingsService.replaceAsset(
        'logoIcon',
        file
      );

      this.audit(req, 'success', 'update_config', 'Icon logo uploaded', {
        action: 'upload_logo_icon',
        filename: file.filename,
      });

      res.json({
        success: true,
        message: 'Icon logo uploaded successfully',
        url,
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

  removeLogoIcon = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.brandingSettingsService.removeAsset('logoIcon');

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

  uploadLogoIconDark = async (req: Request, res: Response): Promise<void> => {
    try {
      const file = req.file;

      if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const { url } = await this.brandingSettingsService.replaceAsset(
        'logoIconDark',
        file
      );

      this.audit(req, 'success', 'update_config', 'Dark icon logo uploaded', {
        action: 'upload_logo_icon_dark',
        filename: file.filename,
      });

      res.json({
        success: true,
        message: 'Dark icon logo uploaded successfully',
        url,
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

  removeLogoIconDark = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.brandingSettingsService.removeAsset('logoIconDark');

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

  uploadFavicon = async (req: Request, res: Response): Promise<void> => {
    try {
      const file = req.file;

      if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const { url } = await this.brandingSettingsService.replaceAsset(
        'favicon',
        file
      );

      this.audit(req, 'success', 'update_config', 'Uploaded favicon', {
        action: 'upload_favicon',
        filename: file.filename,
      });

      res.json({
        success: true,
        message: 'Favicon uploaded successfully',
        url,
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

  removeFavicon = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.brandingSettingsService.removeAsset('favicon');

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

  deployment = async (req: Request, res: Response): Promise<void> => {
    try {
      const config = this.configManager.getPlatformConfig();

      if (req.method === 'GET') {
        res.render('admin/settings/deployment', {
          title: 'Deployment Settings',
          section: 'deployment',
          config: config.deployment,
        } satisfies DeploymentSettingsViewModel);
      } else if (req.method === 'POST') {
        const convertedData = convertDeploymentFormData(
          parseDeploymentSettingsForm(req.body)
        );

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

  private handleSecurityPost = async (
    req: Request,
    res: Response,
    redirectUrl: string
  ): Promise<void> => {
    const result = await this.securitySettingsService.update(req.body);

    if (result.status === 'invalid') {
      for (const error of result.errors) {
        this.sessionManager.flash(req).error(error);
      }
      res.redirect(redirectUrl);
      return;
    }

    if (result.restoredFields.length > 0) {
      this.logger.info(
        `Restored ${result.restoredFields.length} masked sensitive fields`,
        { fields: result.restoredFields }
      );
    }

    this.audit(
      req,
      'success',
      'update_config',
      'Updated security configuration',
      { fieldsModified: result.fieldsModified }
    );
    this.sessionManager
      .flash(req)
      .success('Security settings updated successfully');
    res.redirect(redirectUrl);
  };

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

  securityAuthentication = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      if (req.method === 'GET') {
        const maskedConfig = this.getMaskedConfigSection('security');
        res.render(
          'admin/settings/security',
          createSecuritySettingsViewModel('authentication', maskedConfig)
        );
      } else {
        await this.handleSecurityPost(req, res, '/admin/settings/security');
      }
    } catch (error) {
      this.handleSecurityError(req, res, error, '/admin/settings/security');
    }
  };

  securityMfa = async (req: Request, res: Response): Promise<void> => {
    try {
      if (req.method === 'GET') {
        const maskedConfig = this.getMaskedConfigSection('security');
        res.render(
          'admin/settings/security-mfa',
          createSecuritySettingsViewModel('mfa', maskedConfig)
        );
      } else {
        await this.handleSecurityPost(req, res, '/admin/settings/security/mfa');
      }
    } catch (error) {
      this.handleSecurityError(req, res, error, '/admin/settings/security/mfa');
    }
  };

  securitySessions = async (req: Request, res: Response): Promise<void> => {
    try {
      if (req.method === 'GET') {
        const maskedConfig = this.getMaskedConfigSection('security');
        const redisPrefix =
          this.configManager.getPlatformConfig().deployment.redis_prefix;
        res.render(
          'admin/settings/security-sessions',
          createSecuritySettingsViewModel('sessions', maskedConfig, redisPrefix)
        );
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

  securityProtection = async (req: Request, res: Response): Promise<void> => {
    try {
      if (req.method === 'GET') {
        const maskedConfig = this.getMaskedConfigSection('security');
        res.render(
          'admin/settings/security-protection',
          createSecuritySettingsViewModel('protection', maskedConfig)
        );
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

  securitySecrets = async (req: Request, res: Response): Promise<void> => {
    try {
      if (req.method === 'GET') {
        const maskedConfig = this.getMaskedConfigSection('security');
        res.render(
          'admin/settings/security-secrets',
          createSecuritySettingsViewModel('secrets', maskedConfig)
        );
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

  features = async (req: Request, res: Response): Promise<void> => {
    try {
      const config = this.configManager.getPlatformConfig();

      if (req.method === 'GET') {
        const maskedConfig = this.getMaskedConfigSection('features');

        res.render('admin/settings/features', {
          title: 'Features Settings',
          section: 'features',
          config: maskedConfig,
        } satisfies FeaturesSettingsViewModel);
      } else if (req.method === 'POST') {
        const featureData = parseFeaturesSettingsForm(req.body);
        const convertedData = convertFeaturesFormData(featureData);

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
        } satisfies OidcSettingsViewModel);
      } else if (req.method === 'POST') {
        const oidcFormData = parseOidcSettingsForm(req.body);

        this.logger.debug('OIDC form data received', {
          section: 'oidc',
          hasData: !!oidcFormData,
          fieldCount: Object.keys(oidcFormData).length,
          modifiedBy: this.sessionManager.getActiveUser(req)?.email,
        });

        const convertedData = convertOidcFormData(oidcFormData);

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
              fieldsModified: Object.keys(oidcFormData).length,
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
        } satisfies IntegrationsSettingsViewModel);
      } else if (req.method === 'POST') {
        const integrationsFormData = parseIntegrationsSettingsForm(req.body);
        const convertedData = convertIntegrationsFormData(integrationsFormData);

        const convertedNotifications = integrationsFormData.notifications
          ? convertNotificationsFormData(integrationsFormData)
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

  /** Records every email-configuration test in the security audit log. */
  testEmail = async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    const userData = this.sessionManager.getActiveUser(req);
    const requestedBy = getRequestedBy(userData);
    const requestIp = getRequestIp(req);
    const userAgent = getRequestUserAgent(req);
    const recipientEmail = req.body.email;

    try {
      this.logger.info('Test email requested', {
        requestedBy,
        recipientEmail,
        ip: requestIp,
        userAgent,
        context: 'test_email_attempt',
      });

      const result = await this.testEmailService.send(
        recipientEmail,
        requestedBy
      );
      if (result.status === 'invalid') {
        this.audit(
          req,
          'failed',
          'test_email',
          result.auditDescription,
          result.auditData
        );
        res.status(400).json({ success: false, error: result.error });
        return;
      }

      if (result.isExternalDomain) {
        this.logger.warn('Test email to external domain', {
          requestedBy,
          recipientEmail: result.recipientEmail,
          recipientDomain: result.recipientDomain,
          appDomain: result.appDomain,
          ip: requestIp,
          context: 'test_email_external_domain',
        });
      }

      const duration = Date.now() - startTime;
      this.logger.info('Test email sent successfully', {
        requestedBy,
        recipientEmail: result.recipientEmail,
        recipientDomain: result.recipientDomain,
        isExternalDomain: result.isExternalDomain,
        isFreeProvider: result.isFreeProvider,
        duration,
        ip: requestIp,
        context: 'test_email_success',
      });

      this.audit(req, 'success', 'test_email', 'Test email sent successfully', {
        recipientEmail: result.recipientEmail,
      });
      res.json({
        success: true,
        message: 'Test email sent successfully',
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      const publicErrorMessage = 'Failed to send test email';

      this.logger.error(publicErrorMessage, {
        context: 'test_email_failed',
        requestedBy,
        recipientEmail,
        ip: requestIp,
        userAgent,
        duration,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });

      this.audit(req, 'failed', 'test_email', 'Test email failed', {
        error: publicErrorMessage,
      });
      res.status(500).json({
        success: false,
        error: publicErrorMessage,
      });
    }
  };

  /** Rolls back by creating a new active version; history stays immutable. */
  rollback = async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    const userData = this.sessionManager.getActiveUser(req);
    const requestedBy = getRequestedBy(userData);
    const requestIp = getRequestIp(req);
    const userAgent = getRequestUserAgent(req);
    const versionId = parseConfigurationVersionId(req.body.versionId);

    try {
      this.logger.info('Configuration rollback requested', {
        versionId: versionId || '',
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

      const result = await this.configurationVersionService.rollback(
        versionId,
        requestedBy
      );

      if (result.status === 'not-found') {
        this.logger.warn('Rollback failed: Version not found', {
          versionId,
          requestedBy,
          ip: requestIp,
        });
        this.sessionManager.flash(req).error('Configuration version not found');
        res.redirect('/admin/settings');
        return;
      }

      if (result.status === 'active') {
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

      const duration = Date.now() - startTime;
      this.logger.info('Configuration rollback completed successfully', {
        fromVersion: result.fromVersion,
        toVersion: result.toVersion,
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
          fromVersion: result.fromVersion,
          toVersion: result.toVersion,
        }
      );

      this.sessionManager
        .flash(req)
        .success(
          `Configuration successfully rolled back to version ${result.toVersion}`
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

  /** Masks secrets so an exported configuration cannot disclose them. */
  exportConfig = async (req: Request, res: Response): Promise<void> => {
    try {
      const exportedBy = getRequestedBy(this.sessionManager.getActiveUser(req));
      const { filename, data } =
        this.configurationTransferService.createExport(exportedBy);

      this.logger.info('Configuration export requested', {
        exportedBy,
        filename,
        ip: getRequestIp(req),
        context: 'config_export',
      });

      this.audit(req, 'info', 'export_config', 'Configuration exported', {
        filename,
      });

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`
      );
      res.json(data);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'config_export_failed',
        exportedBy: this.sessionManager.getActiveUser(req)?.email,
      });

      res.status(500).json({
        error: 'Failed to export configuration',
        message: getErrorMessage(error),
      });
    }
  };

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

  importConfigPreview = async (req: Request, res: Response): Promise<void> => {
    try {
      const result = this.configurationTransferService.preview(req.body.config);

      if (!result.valid) {
        res.status(400).json({ success: false, error: result.error });
        return;
      }

      const requestedBy = getRequestedBy(
        this.sessionManager.getActiveUser(req)
      );
      this.logger.info('Configuration import preview requested', {
        requestedBy,
        changeCount: result.value.changeCount,
        ip: getRequestIp(req),
        context: 'config_import_preview',
      });

      res.json({
        success: true,
        valid: true,
        ...result.value,
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

  applyImport = async (req: Request, res: Response): Promise<void> => {
    const userData = this.sessionManager.getActiveUser(req);
    const importedBy = getRequestedBy(userData);
    const requestIp = getRequestIp(req);

    try {
      const result = await this.configurationTransferService.apply(
        req.body.config
      );

      if (!result.valid) {
        const message =
          result.error === 'No configuration data provided'
            ? 'No configuration data provided for import'
            : result.error;
        this.sessionManager.flash(req).error(message);
        res.redirect('/admin/settings');
        return;
      }

      if (result.value.restoredFields.length > 0) {
        this.logger.info(
          'Restored masked sensitive fields from current config',
          {
            restoredFields: result.value.restoredFields,
            importedBy,
            ip: requestIp,
            context: 'config_import_restore_masked',
          }
        );
      }

      this.logger.info('Configuration imported successfully', {
        importedBy,
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

  public revealSecret = async (req: Request, res: Response): Promise<void> => {
    const fieldPath = req.body.fieldPath;
    try {
      const userData = this.sessionManager.getActiveUser(req);
      if (!userData) {
        res.status(401).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      const result = await this.secretRevealService.reveal(fieldPath);
      if (result.status === 'invalid') {
        res.status(400).json({ success: false, error: result.error });
        return;
      }
      if (result.status === 'not_found') {
        res.status(404).json({
          success: false,
          error: 'Configuration not found',
        });
        return;
      }

      this.audit(
        req,
        'warning',
        'reveal_secret',
        'Admin revealed secret field',
        { fieldPath: result.fieldPath }
      );
      this.logger.warn('Secret field revealed', {
        action: 'reveal_secret',
        fieldPath: result.fieldPath,
        username: userData.username,
        userId: userData.id,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        timestamp: new Date().toISOString(),
      });
      res.json({ success: true, value: result.value });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'reveal_secret_failed',
        fieldPath,
        username: this.sessionManager.getActiveUser(req)?.username,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to reveal secret',
      });
    }
  };

  healthCheck = async (req: Request, res: Response): Promise<void> => {
    const result = await this.configurationHealthService.check();

    if (result.error) {
      this.logger.error(result.error as Error, {
        context: 'health_check_failed',
      });
    } else {
      this.logger.debug('Configuration health check completed', {
        ...result.response,
        requestedBy: this.sessionManager.getActiveUser(req)?.email,
      });
    }

    res
      .status(result.response.status === 'healthy' ? 200 : 503)
      .json(result.response);
  };
}
