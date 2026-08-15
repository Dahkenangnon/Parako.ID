import { injectable, inject } from 'inversify';
import { Request, Response } from 'express';
import type { IAdminConfigurationController } from '../../di/interfaces/admin-configuration-controller.interface.js';
import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';
import type { ITenantSettingsOverrideService } from '../../di/interfaces/tenant-settings-override-service.interface.js';
import type { ISessionManager } from '../../di/interfaces/session-manager.interface.js';
import type { ILogger } from '../../di/interfaces/logger.interface.js';
import type { IActivityService } from '../../di/interfaces/activity-service.interface.js';
import type { IEmailService } from '../../di/interfaces/email-service.interface.js';
import type { IUploadMiddleware } from '../../di/interfaces/upload-middleware.interface.js';
import type { IClientDeviceInfoManager } from '../../di/interfaces/client-device-info-manager.interface.js';
import type { IPlatformAdminService } from '../../services/platform-admin.service.js';
import { TYPES } from '../../di/types.js';
import { activityLoggerFor } from '../../utils/activity-logger.factory.js';
import { tenantContext } from '../../multi-tenancy/tenant-context.js';
import { deriveTenantIssuerUrl } from '../../multi-tenancy/tenant-issuer.js';
import { ensureDecrypted } from '../../utils/encryption.js';
import { getNestedValue } from '../../utils/nested-value.js';
import { resolveBrandingUrlAsync } from '../../utils/views.js';
import { TENANT_SENSITIVE_FIELDS } from '../../services/tenant-settings-override.service.js';
import {
  convertApplicationFormData,
  convertBrandingFormData,
  convertFeaturesFormData,
  convertIntegrationsFormData,
  convertNotificationsFormData,
  convertOidcFormData,
  convertSecurityFormData,
} from '../../utils/settings.helper.js';

/**
 * Sections that tenants are allowed to customize.
 * Maps section name -> display label.
 */
const CONFIGURABLE_SECTIONS = {
  application: 'Application',
  branding: 'Branding',
  security: 'Security',
  features: 'Features',
  oidc: 'OIDC',
  integrations: 'Integrations',
  notifications: 'Notifications',
} as const;

type ConfigurableSection = keyof typeof CONFIGURABLE_SECTIONS;

/**
 * Section descriptions for the overview page.
 */
const SECTION_DESCRIPTIONS: Record<ConfigurableSection, string> = {
  application: 'Name, description, and language preferences',
  branding: 'Company name, logos, theme colors, and typography',
  security: 'Authentication policies, registration, and rate limiting',
  features: 'Social login providers and behavior settings',
  oidc: 'OpenID Connect identity and discovery configuration',
  integrations: 'Email, URLs, and external service configuration',
  notifications:
    'Notification channels, SMS configuration, and user notification preferences',
};

const VIEW_TEMPLATES: Record<ConfigurableSection, string> = {
  application: 'admin/configuration/application',
  branding: 'admin/configuration/branding',
  security: 'admin/configuration/security',
  features: 'admin/configuration/features',
  oidc: 'admin/configuration/oidc',
  integrations: 'admin/configuration/integrations',
  notifications: 'admin/configuration/notifications',
};

function isConfigurableSection(
  section: string
): section is ConfigurableSection {
  return Object.prototype.hasOwnProperty.call(CONFIGURABLE_SECTIONS, section);
}

function buildSectionOverrides(
  section: ConfigurableSection,
  sectionData: Record<string, any>
): Partial<Record<ConfigurableSection, Record<string, any>>> {
  return { [section]: sectionData };
}

/**
 * Helper: resolve tenant ID strictly.
 * Uses getTenantId() which throws in strict mode if no ALS context is active.
 */
function resolveTenantId(): string {
  return tenantContext.getTenantId();
}

/**
 * Admin Configuration Controller
 * Manages per-tenant configuration overrides (whitelisted sections only).
 * Uses TenantSettingsOverrideService -- NOT SettingsService.
 *
 * Security hardening:
 * - Shows only tenant overrides (not global config values)
 * - Uses strict tenant context (throws if missing)
 * - Sanitizes error messages (no internal detail leakage)
 * - Rate limiting on all mutation endpoints
 * - Audit logging for sensitive operations
 */
@injectable()
export class AdminConfigurationController implements IAdminConfigurationController {
  constructor(
    @inject(TYPES.ConfigManager) private configManager: IConfigManager,
    @inject(TYPES.TenantSettingsOverrideService)
    private overrideService: ITenantSettingsOverrideService,
    @inject(TYPES.SessionManager) private sessionManager: ISessionManager,
    @inject(TYPES.Logger) private logger: ILogger,
    @inject(TYPES.ActivityService) private activityService: IActivityService,
    @inject(TYPES.EmailService) private emailService: IEmailService,
    @inject(TYPES.UploadMiddleware) private uploadMiddleware: IUploadMiddleware,
    @inject(TYPES.ClientDeviceInfoManager)
    private readonly clientDeviceInfoManager: IClientDeviceInfoManager,
    @inject(TYPES.PlatformAdminService)
    private readonly platformAdminService: IPlatformAdminService
  ) {}

  private get activityLoggerDeps() {
    return {
      activityService: this.activityService,
      sessionManager: this.sessionManager,
      clientDeviceInfoManager: this.clientDeviceInfoManager,
    };
  }

  overview = async (_req: Request, res: Response): Promise<void> => {
    let tenantId: string;
    try {
      tenantId = resolveTenantId();
    } catch {
      this.sessionManager.flash(_req).error('Tenant context not available');
      return res.redirect('/admin');
    }

    let overrides: Record<string, any> | null = null;
    try {
      overrides = (await this.overrideService.loadOverrides(
        tenantId
      )) as Record<string, any> | null;
    } catch {
      // Non-fatal -- show overview without override indicators
    }

    const sections = (
      Object.entries(CONFIGURABLE_SECTIONS) as Array<
        [ConfigurableSection, string]
      >
    ).map(([key, label]) => ({
      key,
      label,
      description: SECTION_DESCRIPTIONS[key],
      hasOverride: overrides ? key in overrides : false,
    }));

    res.render('admin/configuration/overview', {
      title: 'Configuration',
      sections,
      activePage: 'configuration',
    });
  };

  section = async (req: Request, res: Response): Promise<void> => {
    const { section } = req.params;

    if (!isConfigurableSection(section)) {
      this.sessionManager.flash(req).error('Invalid configuration section');
      return res.redirect('/admin/configuration');
    }

    let tenantId: string;
    try {
      tenantId = resolveTenantId();
    } catch {
      this.sessionManager.flash(req).error('Tenant context not available');
      return res.redirect('/admin/configuration');
    }

    let overrides: Record<string, any> | null = null;
    try {
      overrides = (await this.overrideService.loadOverrides(
        tenantId
      )) as Record<string, any> | null;
    } catch {
      // Non-fatal -- show empty form
    }

    const sectionData = overrides?.[section] ?? {};
    const hasOverride = overrides ? section in overrides : false;

    const renderData: Record<string, any> = {
      title: `${CONFIGURABLE_SECTIONS[section]} Configuration`,
      section,
      sectionLabel: CONFIGURABLE_SECTIONS[section],
      config: sectionData,
      hasOverride,
      activePage: `configuration-${section}`,
    };

    // Pass platform defaults for ceiling/floor constraint hints in the UI.
    // Each section gets the relevant slice of the global config so templates
    // can set max/min attributes on number inputs dynamically.
    // Uses getPlatformConfig() to always get the raw global config — never
    // the tenant-merged config (which would cause floor-enforced disabled
    // checkboxes to appear only after first save, not on initial load).
    const globalConfig = this.configManager.getPlatformConfig() as Record<
      string,
      any
    >;

    if (section === 'oidc') {
      const tenantConfig = this.configManager.getConfig();
      const oidcPath = tenantConfig.oidc?.path || '/oidc/v1';
      const deploymentUrl = tenantConfig.deployment?.url || '';
      const tenant = await this.platformAdminService.getTenantBySlug(tenantId);

      renderData.issuer = tenant
        ? deriveTenantIssuerUrl(tenantId, tenant, deploymentUrl, oidcPath)
        : globalConfig.oidc?.issuer || deploymentUrl;
      renderData.oidcPath = oidcPath;
      renderData.deploymentUrl = deploymentUrl;
      renderData.platformTokenTtl = globalConfig.oidc?.token_ttl || {};
      renderData.platformDiscovery = globalConfig.oidc?.discovery || {};
    }

    if (section === 'branding') {
      renderData.platformBranding = globalConfig.branding || {};
      renderData.config = await this._resolveBrandingUrls(sectionData);
    }

    if (section === 'security') {
      renderData.platformSecurity = globalConfig.security || {};
    }

    if (section === 'notifications') {
      renderData.platformNotifications = globalConfig.notifications || {};
    }

    if (section === 'features') {
      renderData.platformFeatures = globalConfig.features || {};
    }

    if (section === 'integrations') {
      renderData.platformIntegrations = globalConfig.integrations || {};
    }

    // The section was narrowed through isConfigurableSection(), and this
    // explicit map prevents user-controlled template paths.
    res.render(VIEW_TEMPLATES[section], renderData);
  };

  updateSection = async (req: Request, res: Response): Promise<void> => {
    const { section } = req.params;

    if (!isConfigurableSection(section)) {
      this.sessionManager.flash(req).error('Invalid configuration section');
      return res.redirect('/admin/configuration');
    }

    let tenantId: string;
    try {
      tenantId = resolveTenantId();
    } catch {
      this.sessionManager.flash(req).error('Tenant context not available');
      return res.redirect('/admin/configuration');
    }

    let uploadedBrandingStorageKey: string | undefined;
    let previousBrandingStorageKey: string | undefined;

    try {
      // Transport-only fields remain on req.body for downstream audit/device
      // processing, but must never become persisted tenant configuration.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructure-and-discard strips transport metadata from the configuration payload.
      const { _csrf, _deviceInfo, ...rawSectionData } = req.body;

      // and merge with existing overrides to preserve logo fields not in form
      let sectionData: Record<string, any>;
      if (section === 'application') {
        sectionData = convertApplicationFormData(rawSectionData);
      } else if (section === 'branding') {
        sectionData = convertBrandingFormData(rawSectionData);
      } else if (section === 'security') {
        sectionData = convertSecurityFormData(rawSectionData);
      } else if (section === 'features') {
        sectionData = convertFeaturesFormData(rawSectionData);
      } else if (section === 'oidc') {
        sectionData = convertOidcFormData({ oidc: rawSectionData }).oidc;
      } else if (section === 'integrations') {
        sectionData = convertIntegrationsFormData(rawSectionData);
      } else {
        // isConfigurableSection() narrows the only remaining case to notifications.
        sectionData = convertNotificationsFormData(rawSectionData);
      }

      if (section === 'branding') {
        const existing = (await this.overrideService.loadOverrides(
          tenantId
        )) as Record<string, any> | null;
        const existingSection = existing?.branding ?? {};

        const file = (req as any).file;
        if (file) {
          uploadedBrandingStorageKey = await this.uploadMiddleware.storeFile(
            file,
            'logos'
          );
          sectionData.logo = uploadedBrandingStorageKey;
          previousBrandingStorageKey = existingSection.logo;
        }

        sectionData = { ...existingSection, ...sectionData };
      }

      const overrides = buildSectionOverrides(section, sectionData);

      try {
        const platformConfig =
          this.configManager.getPlatformConfig() as unknown as Record<
            string,
            any
          >;
        await this.overrideService.saveOverrides(
          tenantId,
          overrides,
          (req as any).user?.email ?? 'admin',
          `Updated ${section} configuration`,
          platformConfig
        );
      } catch (error) {
        if (uploadedBrandingStorageKey) {
          await this._deleteFileBestEffort(
            uploadedBrandingStorageKey,
            'tenant_branding_form_upload_rollback_failed'
          );
        }
        throw error;
      }

      await this.configManager.invalidateTenantConfig(tenantId, {
        broadcast: true,
      });

      if (
        uploadedBrandingStorageKey &&
        previousBrandingStorageKey &&
        previousBrandingStorageKey !== uploadedBrandingStorageKey
      ) {
        await this._deleteFileBestEffort(
          previousBrandingStorageKey,
          'tenant_branding_form_old_file_cleanup_failed'
        );
      }

      // Audit trail — config updates are security-sensitive operations
      activityLoggerFor(this.activityLoggerDeps, req, {
        defaultActorType: 'admin',
      }).success(
        'update_config',
        this.sessionManager.getActiveUser(req),
        `Updated ${section} configuration`,
        {
          target: {
            target_type: 'config',
            entity_data: { action: 'update_section', section, tenantId },
          },
        }
      );

      this.sessionManager
        .flash(req)
        .success(
          `${CONFIGURABLE_SECTIONS[section]} configuration updated successfully`
        );
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'admin_configuration_update',
        section,
        tenantId,
      });
      this.sessionManager
        .flash(req)
        .error('Failed to update configuration. Please try again.');
    }

    res.redirect(`/admin/configuration/${section}`);
  };

  resetSection = async (req: Request, res: Response): Promise<void> => {
    const { section } = req.params;

    if (!isConfigurableSection(section)) {
      this.sessionManager.flash(req).error('Invalid configuration section');
      return res.redirect('/admin/configuration');
    }

    let tenantId: string;
    try {
      tenantId = resolveTenantId();
    } catch {
      this.sessionManager.flash(req).error('Tenant context not available');
      return res.redirect('/admin/configuration');
    }

    try {
      await this.overrideService.deleteSection(tenantId, section);
      await this.configManager.invalidateTenantConfig(tenantId, {
        broadcast: true,
      });

      activityLoggerFor(this.activityLoggerDeps, req, {
        defaultActorType: 'admin',
      }).success(
        'update_config',
        this.sessionManager.getActiveUser(req),
        `Reset ${section} configuration to defaults`,
        {
          target: {
            target_type: 'config',
            entity_data: { action: 'reset_section', section, tenantId },
          },
        }
      );

      this.sessionManager
        .flash(req)
        .success(
          `${CONFIGURABLE_SECTIONS[section]} configuration reset to defaults`
        );
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'admin_configuration_reset',
        section,
        tenantId,
      });
      this.sessionManager
        .flash(req)
        .error('Failed to reset configuration. Please try again.');
    }

    res.redirect(`/admin/configuration/${section}`);
  };

  uploadLogo = async (req: Request, res: Response): Promise<void> => {
    await this._handleLogoUpload(req, res, 'logo', 'company logo');
  };

  removeLogo = async (req: Request, res: Response): Promise<void> => {
    await this._handleLogoRemove(req, res, 'logo', 'company logo');
  };

  uploadLogoDark = async (req: Request, res: Response): Promise<void> => {
    await this._handleLogoUpload(req, res, 'logoDark', 'dark mode logo');
  };

  removeLogoDark = async (req: Request, res: Response): Promise<void> => {
    await this._handleLogoRemove(req, res, 'logoDark', 'dark mode logo');
  };

  uploadLogoIcon = async (req: Request, res: Response): Promise<void> => {
    await this._handleLogoUpload(req, res, 'logoIcon', 'icon logo');
  };

  removeLogoIcon = async (req: Request, res: Response): Promise<void> => {
    await this._handleLogoRemove(req, res, 'logoIcon', 'icon logo');
  };

  uploadLogoIconDark = async (req: Request, res: Response): Promise<void> => {
    await this._handleLogoUpload(req, res, 'logoIconDark', 'dark icon logo');
  };

  removeLogoIconDark = async (req: Request, res: Response): Promise<void> => {
    await this._handleLogoRemove(req, res, 'logoIconDark', 'dark icon logo');
  };

  uploadFavicon = async (req: Request, res: Response): Promise<void> => {
    await this._handleLogoUpload(req, res, 'favicon', 'favicon');
  };

  removeFavicon = async (req: Request, res: Response): Promise<void> => {
    await this._handleLogoRemove(req, res, 'favicon', 'favicon');
  };

  resetColors = async (req: Request, res: Response): Promise<void> => {
    await this._handleBrandingSubfieldReset(req, res, 'colors', 'theme colors');
  };

  resetFonts = async (req: Request, res: Response): Promise<void> => {
    await this._handleBrandingSubfieldReset(req, res, 'fonts', 'fonts');
  };

  testEmail = async (req: Request, res: Response): Promise<void> => {
    const userData = this.sessionManager.getActiveUser(req);
    const requestedBy = userData?.email || 'unknown';
    const requestIp = req.ip || req.socket?.remoteAddress || 'unknown';
    const activity = activityLoggerFor(this.activityLoggerDeps, req, {
      defaultActorType: 'admin',
    });

    try {
      const { email } = req.body;

      if (!email) {
        activity.failed(
          'test_email',
          userData,
          'Test email failed: Email address is required',
          { target: { target_type: 'config' } }
        );
        res
          .status(400)
          .json({ success: false, error: 'Email address is required' });
        return;
      }

      if (typeof email !== 'string') {
        activity.failed(
          'test_email',
          userData,
          'Test email failed: Invalid email format',
          { target: { target_type: 'config' } }
        );
        res
          .status(400)
          .json({ success: false, error: 'Invalid email address format' });
        return;
      }

      if (email.length > 254) {
        activity.failed(
          'test_email',
          userData,
          'Test email failed: Email address too long',
          { target: { target_type: 'config' } }
        );
        res
          .status(400)
          .json({ success: false, error: 'Email address is too long' });
        return;
      }

      const emailRegex =
        /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
      if (!emailRegex.test(email)) {
        activity.failed(
          'test_email',
          userData,
          'Test email failed: Invalid email format',
          { target: { target_type: 'config' } }
        );
        res
          .status(400)
          .json({ success: false, error: 'Invalid email address format' });
        return;
      }

      this.emailService.initialize();

      const timestamp = new Date().toISOString();
      const subject = 'Test Email from Parako.ID';
      const text = `This is a test email from your configuration. If you received this email, your SMTP settings are working correctly.\n\nTimestamp: ${timestamp}\nRequested by: ${requestedBy}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Test Email</h2>
          <p>This is a test email from your configuration. If you received this email, your SMTP settings are working correctly.</p>
          <p><strong>Timestamp:</strong> ${timestamp}</p>
          <p><strong>Requested by:</strong> ${requestedBy}</p>
          <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
          <p style="color: #666; font-size: 12px;">This is an automated test email. Please do not reply.</p>
        </div>
      `;

      await this.emailService.sendEmail(email, subject, text, html);

      activity.success('test_email', userData, 'Test email sent successfully', {
        target: {
          target_type: 'config',
          entity_data: { recipientEmail: email },
        },
      });

      res.json({ success: true, message: 'Test email sent successfully' });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'tenant_test_email_failed',
        requestedBy,
        ip: requestIp,
      });

      activity.failed('test_email', userData, 'Test email failed', {
        target: { target_type: 'config' },
      });

      res
        .status(500)
        .json({ success: false, error: 'Failed to send test email' });
    }
  };

  revealSecret = async (req: Request, res: Response): Promise<void> => {
    try {
      const { fieldPath } = req.body;
      const userData = this.sessionManager.getActiveUser(req);
      if (!userData) {
        res.status(401).json({ success: false, error: 'Not authenticated' });
        return;
      }

      if (!fieldPath || typeof fieldPath !== 'string') {
        res
          .status(400)
          .json({ success: false, error: 'Field path is required' });
        return;
      }

      if (!TENANT_SENSITIVE_FIELDS.includes(fieldPath)) {
        res.status(400).json({ success: false, error: 'Invalid field path' });
        return;
      }

      let tenantId: string;
      try {
        tenantId = resolveTenantId();
      } catch {
        res
          .status(400)
          .json({ success: false, error: 'Tenant context not available' });
        return;
      }

      const overrides = (await this.overrideService.loadOverrides(
        tenantId
      )) as Record<string, any> | null;

      const encryptedValue = overrides
        ? (getNestedValue(overrides, fieldPath) as string | undefined)
        : '';
      const actualValue = encryptedValue ? ensureDecrypted(encryptedValue) : '';

      activityLoggerFor(this.activityLoggerDeps, req, {
        defaultActorType: 'admin',
      }).warning('reveal_secret', null, 'Admin revealed tenant secret field', {
        target: {
          target_type: 'config',
          entity_data: { fieldPath, tenantId },
        },
      });

      this.logger.warn('Tenant secret field revealed', {
        action: 'reveal_secret',
        fieldPath,
        tenantId,
        username: userData.username,
        ip: req.ip,
      });

      res.json({ success: true, value: actualValue });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'tenant_reveal_secret_failed',
        fieldPath: req.body.fieldPath,
      });

      res
        .status(500)
        .json({ success: false, error: 'Failed to reveal secret' });
    }
  };

  /**
   * Generic logo/image upload handler for tenant branding overrides.
   */
  private async _handleLogoUpload(
    req: Request,
    res: Response,
    fieldName: string,
    displayName: string
  ): Promise<void> {
    try {
      const userData = this.sessionManager.getActiveUser(req);

      let tenantId: string;
      try {
        tenantId = resolveTenantId();
      } catch {
        res.status(400).json({ error: 'Tenant context not available' });
        return;
      }

      const file = (req as any).file;
      if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const overrides =
        ((await this.overrideService.loadOverrides(tenantId)) as Record<
          string,
          any
        >) ?? {};
      const existingBranding = overrides.branding ?? {};
      const existingStorageKey = existingBranding[fieldName] as
        string | undefined;
      const category = fieldName === 'favicon' ? 'favicons' : 'logos';
      const storageKey = await this.uploadMiddleware.storeFile(file, category);
      const branding = { ...existingBranding };

      branding[fieldName] = storageKey;

      try {
        const platformConfig =
          this.configManager.getPlatformConfig() as unknown as Record<
            string,
            any
          >;
        await this.overrideService.saveOverrides(
          tenantId,
          { branding },
          userData?.email ?? 'admin',
          `Uploaded ${displayName}`,
          platformConfig
        );
      } catch (error) {
        await this._deleteFileBestEffort(
          storageKey,
          `tenant_${fieldName}_upload_rollback_failed`
        );
        throw error;
      }

      await this.configManager.invalidateTenantConfig(tenantId, {
        broadcast: true,
      });

      if (existingStorageKey && existingStorageKey !== storageKey) {
        await this._deleteFileBestEffort(
          existingStorageKey,
          `tenant_${fieldName}_old_file_cleanup_failed`
        );
      }

      activityLoggerFor(this.activityLoggerDeps, req, {
        defaultActorType: 'admin',
      }).success('update_config', userData, `Uploaded ${displayName}`, {
        target: {
          target_type: 'config',
          entity_data: {
            action: `upload_${fieldName}`,
            filename: file.filename,
            tenantId,
          },
        },
      });

      const resolvedUrl = await this.uploadMiddleware.getFileUrl(storageKey);
      res.json({
        success: true,
        message: `${displayName} uploaded successfully`,
        url: typeof resolvedUrl === 'string' ? resolvedUrl : storageKey,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: `tenant_${fieldName}_upload_failed`,
      });
      res.status(500).json({ error: `Failed to upload ${displayName}` });
    }
  }

  private async _deleteFileBestEffort(
    storageKey: string,
    context: string
  ): Promise<void> {
    try {
      await this.uploadMiddleware.deleteFile(storageKey);
    } catch (error) {
      this.logger.error(error as Error, { context, storageKey });
    }
  }

  /**
   * Generic logo/image remove handler for tenant branding overrides.
   */
  private async _handleLogoRemove(
    req: Request,
    res: Response,
    fieldName: string,
    displayName: string
  ): Promise<void> {
    try {
      const userData = this.sessionManager.getActiveUser(req);

      let tenantId: string;
      try {
        tenantId = resolveTenantId();
      } catch {
        res.status(400).json({ error: 'Tenant context not available' });
        return;
      }

      const overrides =
        ((await this.overrideService.loadOverrides(tenantId)) as Record<
          string,
          any
        >) ?? {};
      const existingBranding = overrides.branding ?? {};
      const existingStorageKey = existingBranding[fieldName] as
        string | undefined;
      const branding = { ...existingBranding };

      branding[fieldName] = '';

      const platformConfig =
        this.configManager.getPlatformConfig() as unknown as Record<
          string,
          any
        >;
      await this.overrideService.saveOverrides(
        tenantId,
        { branding },
        userData?.email ?? 'admin',
        `Removed ${displayName}`,
        platformConfig
      );
      await this.configManager.invalidateTenantConfig(tenantId, {
        broadcast: true,
      });

      if (existingStorageKey) {
        await this._deleteFileBestEffort(
          existingStorageKey,
          `tenant_${fieldName}_removed_file_cleanup_failed`
        );
      }

      activityLoggerFor(this.activityLoggerDeps, req, {
        defaultActorType: 'admin',
      }).success('update_config', userData, `Removed ${displayName}`, {
        target: {
          target_type: 'config',
          entity_data: { action: `remove_${fieldName}`, tenantId },
        },
      });

      res.json({
        success: true,
        message: `${displayName} removed successfully`,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: `tenant_${fieldName}_remove_failed`,
      });
      res.status(500).json({ error: `Failed to remove ${displayName}` });
    }
  }

  /**
   * Resets a branding sub-field (colors or fonts) by removing it from
   * the tenant override doc, reverting to platform defaults.
   */
  private async _handleBrandingSubfieldReset(
    req: Request,
    res: Response,
    subField: string,
    displayName: string
  ): Promise<void> {
    try {
      const userData = this.sessionManager.getActiveUser(req);

      let tenantId: string;
      try {
        tenantId = resolveTenantId();
      } catch {
        res.status(400).json({ error: 'Tenant context not available' });
        return;
      }

      const overrides =
        ((await this.overrideService.loadOverrides(tenantId)) as Record<
          string,
          any
        >) ?? {};
      const branding = { ...overrides.branding };
      delete branding[subField];

      // If branding is empty after removing the subfield, delete entire section
      const hasRemainingFields = Object.keys(branding).length > 0;

      if (hasRemainingFields) {
        const platformConfig =
          this.configManager.getPlatformConfig() as unknown as Record<
            string,
            any
          >;
        await this.overrideService.saveOverrides(
          tenantId,
          { branding },
          userData?.email ?? 'admin',
          `Reset ${displayName} to defaults`,
          platformConfig
        );
      } else {
        await this.overrideService.deleteSection(tenantId, 'branding');
      }
      await this.configManager.invalidateTenantConfig(tenantId, {
        broadcast: true,
      });

      activityLoggerFor(this.activityLoggerDeps, req, {
        defaultActorType: 'admin',
      }).success(
        'update_config',
        userData,
        `Reset ${displayName} to defaults`,
        {
          target: {
            target_type: 'config',
            entity_data: { action: `reset_${subField}`, tenantId },
          },
        }
      );

      res.json({ success: true, message: `${displayName} reset to defaults` });
    } catch (error) {
      this.logger.error(error as Error, {
        context: `tenant_${subField}_reset_failed`,
      });
      res.status(500).json({ error: `Failed to reset ${displayName}` });
    }
  }

  /**
   * Resolve storage keys in branding data to signed serving URLs.
   * Used when rendering the branding config admin page so <img src="...">
   * tags get proper `/media/file/...` URLs instead of raw storage keys.
   */
  private async _resolveBrandingUrls(
    sectionData: Record<string, any>
  ): Promise<Record<string, any>> {
    const imageFields = [
      'logo',
      'logoDark',
      'logoIcon',
      'logoIconDark',
      'favicon',
    ];
    const resolved = { ...sectionData };
    for (const field of imageFields) {
      if (resolved[field] && typeof resolved[field] === 'string') {
        resolved[field] = await resolveBrandingUrlAsync(
          resolved[field],
          this.uploadMiddleware.getFileUrl.bind(this.uploadMiddleware)
        );
      }
    }
    return resolved;
  }
}
