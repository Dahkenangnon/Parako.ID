import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { injectable, inject } from 'inversify';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { IViewResolver } from '../di/interfaces/view-resolver.interface.js';
import { TYPES } from '../di/types.js';
import nunjucks from 'nunjucks';
import { Application } from 'express';
import { deepMerge } from './misc.js';
import type { IFileSystemUtils } from '../di/interfaces/file-system-utils.interface.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';

/**
 * View resolver configuration interface
 */
export interface ViewResolverConfig {
  /** Whether custom view resolution is enabled */
  enabled: boolean;
  /** Root path for custom views */
  customViewsRoot: string;
  /** Root path for default views */
  defaultViewsRoot: string;
  /** File extension for view templates */
  viewExtension: string;
}

/**
 * View key interface for type-safe view access
 */
export interface ViewKeys {
  auth: {
    login: string;
    register: string;
    forgot_password: string;
    reset_password: string;
    email_verification: string;
    verify_email: string;
    email_verification_success: string;
    account_select: string;
    continue: string;
    multi_factor: string;
    mfa_verify: string;
    mfa_resend: string;
    logout: string;
    social_password_setup: string;
    social_contact_info: string;
    account_recovery: string;
    recovery_backup_codes: string;
    recovery_secondary_email: string;
    recovery_verify_code: string;
    recovery_method_select: string;
    recovery_security_questions: string;
    recovery_sms: string;
    recovery_codes_display: string;
    setup_mfa: string;
    setup_webauthn: string;
    mfa_select: string;
    mfa_webauthn: string;
    mfa_no_fallback: string;
    social_callback: string;
    oidc: {
      consent: string;
      device_flow_code_input: string;
      device_flow_confirm_code: string;
      device_flow_success: string;
      error: string;
      login: string;
      logout_success: string;
      logout: string;
      mfa: string;
      mfa_select: string;
      mfa_webauthn: string;
      mfa_no_fallback: string;
      newDeviceVerify: string;
    };
  };
  accounts: {
    my_account: string;
    settings: string;
    settings_profile: string;
    settings_preferences: string;
    settings_notifications: string;
    settings_security: string;
    settings_recovery: string;
    settings_social: string;
    apps: string;
    sessions: string;
    recovery_codes: string;
    recovery_setup: string;
    security_questions_setup: string;
    passkeys: string;
  };
  errors: {
    unauthorized: string;
    forbidden: string;
    notfound: string;
    server_error: string;
    rate_limit: string;
  };
  email: {
    mail: string;
  };
  home: {
    index: string;
  };
}

/**
 * ViewResolver utility class for handling custom view resolution
 *
 * This class manages the resolution of view templates with the following principles:
 * 1. Configuration is the authority - only explicitly configured views are used
 * 2. Custom views must be explicitly declared in the configuration
 * 3. Invalid or missing custom views automatically fall back to defaults
 * 4. Provides type-safe view keys for controllers
 * 5. Handles deep merging of configuration with defaults
 */
@injectable()
export class ViewResolver implements IViewResolver {
  private viewKeys: ViewKeys | null = null;
  private configManager: IConfigManager;
  private logger: ILogger;
  private fileSystemUtils: IFileSystemUtils;

  constructor(
    @inject(TYPES.ConfigManager) configManager: IConfigManager,
    @inject(TYPES.Logger) logger: ILogger,
    @inject(TYPES.FileSystemUtils) fileSystemUtils: IFileSystemUtils
  ) {
    this.configManager = configManager;
    this.logger = logger;
    this.fileSystemUtils = fileSystemUtils;
  }

  /**
   * Get configuration from the main config
   */
  private getConfig(): ViewResolverConfig {
    try {
      const uiConfig =
        this.configManager.getConfig().branding?.ui?.customization;

      // In production (dist), views are in dist/src/views
      // In development, views are in src/views

      const currentFile = fileURLToPath(import.meta.url);
      const isRunningFromDist = currentFile.includes('/dist/src/');

      let defaultViewsRoot: string;

      if (isRunningFromDist) {
        const rootDirEndsWithDist =
          this.fileSystemUtils.rootDir.endsWith('/dist') ||
          this.fileSystemUtils.rootDir.endsWith('\\dist');

        if (rootDirEndsWithDist) {
          // rootDir is already in dist, so views are at 'src/views'
          defaultViewsRoot = 'src/views';
        } else {
          // rootDir is at project root, views are at 'dist/src/views'
          defaultViewsRoot = 'dist/src/views';
        }
      } else {
        // Development mode, views are at 'src/views'
        defaultViewsRoot = 'src/views';
      }

      return {
        enabled: uiConfig?.enabled || false,
        customViewsRoot: uiConfig?.rootPath || 'runtime/views',
        defaultViewsRoot,
        viewExtension: '.njk',
      };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'view_resolver_config_load_failed',
      });

      // Fallback with environment-aware default
      const currentFile = fileURLToPath(import.meta.url);
      const isRunningFromDist = currentFile.includes('/dist/src/');

      let defaultViewsRoot: string;

      if (isRunningFromDist) {
        const rootDirEndsWithDist =
          this.fileSystemUtils.rootDir.endsWith('/dist') ||
          this.fileSystemUtils.rootDir.endsWith('\\dist');

        if (rootDirEndsWithDist) {
          // rootDir is already in dist, so views are at 'src/views'
          defaultViewsRoot = 'src/views';
        } else {
          // rootDir is at project root, views are at 'dist/src/views'
          defaultViewsRoot = 'dist/src/views';
        }
      } else {
        // Development mode, views are at 'src/views'
        defaultViewsRoot = 'src/views';
      }

      return {
        enabled: false,
        customViewsRoot: 'runtime/views',
        defaultViewsRoot,
        viewExtension: '.njk',
      };
    }
  }

  /**
   * Initialize view keys based on configuration
   * Only processes explicitly configured views - no auto-detection from filesystem
   */
  private initializeViewKeys(): void {
    try {
      const uiConfig =
        this.configManager.getConfig().branding?.ui?.customization;

      if (!uiConfig?.views) {
        this.viewKeys = this.buildDefaultViewKeys();
        return;
      }

      this.viewKeys = this.buildViewKeysFromConfig(uiConfig.views);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'view_keys_initialization_failed',
      });
      // Fallback to default structure if config parsing fails
      this.viewKeys = this.buildDefaultViewKeys();
    }
  }

  /**
   * Build view keys from configuration
   * Only processes explicitly configured views - configuration is the authority
   * Invalid custom views automatically fall back to defaults
   */
  private buildViewKeysFromConfig(configViews: any): ViewKeys {
    const buildSection = (section: any, sectionName: string): any => {
      const result: any = {};

      // If section is not defined, return empty object (will use defaults)
      if (!section || typeof section !== 'object') {
        return {};
      }

      for (const [key, value] of Object.entries(section)) {
        if (typeof value === 'string') {
          const cleanedPath = this.validateAndCleanViewPath(
            value,
            `${sectionName}.${key}`
          );
          result[key] = this.ensureViewExtension(cleanedPath);
        } else if (typeof value === 'object' && value !== null) {
          result[key] = buildSection(value, `${sectionName}.${key}`);
        }
      }

      return result;
    };

    const authCustom = buildSection(configViews?.auth, 'auth');
    const accountsCustom = buildSection(configViews?.accounts, 'accounts');
    const errorsCustom = buildSection(configViews?.errorpage, 'errors');
    const emailCustom = buildSection(configViews?.email, 'email');
    const homeCustom = buildSection(configViews?.home, 'home');

    const defaults = this.buildDefaultViewKeys();

    // Deep merge custom views with defaults
    return deepMerge({}, defaults, {
      auth: authCustom,
      accounts: accountsCustom,
      errors: errorsCustom,
      email: emailCustom,
      home: homeCustom,
    });
  }

  /**
   * Validate and clean a view path
   * Only use custom views that are explicitly configured and exist
   * Falls back to default if custom view is invalid or missing
   */
  private validateAndCleanViewPath(
    configuredPath: string,
    configKey: string
  ): string {
    const config = this.getConfig();
    if (!config.enabled) {
      return this.getDefaultPath(configKey);
    }

    const customPath = path.join(
      this.fileSystemUtils.rootDir,
      config.customViewsRoot,
      configuredPath
    );

    if (this.isValidViewFile(customPath)) {
      return configuredPath;
    } else {
      return this.getDefaultPath(configKey);
    }
  }

  /**
   * Get the default path for a configuration key
   */
  private getDefaultPath(configKey: string): string {
    const defaultPathMap: Record<string, string> = {
      'auth.login': 'auth/login',
      'auth.register': 'auth/register',
      'auth.forgot_password': 'auth/forgot-password',
      'auth.reset_password': 'auth/reset-password',
      'auth.email_verification': 'auth/email-verification',
      'auth.verify_email': 'auth/verify-email',
      'auth.email_verification_success': 'auth/email-verification-success',
      'auth.account_select': 'auth/account-select',
      'auth.continue': 'auth/continue',
      'auth.multi_factor': 'auth/multi-factor',
      'auth.mfa_verify': 'auth/mfa-verify',
      'auth.mfa_resend': 'auth/mfa-resend',
      'auth.logout': 'auth/logout',
      'auth.social_password_setup': 'auth/social-password-setup',
      'auth.social_contact_info': 'auth/social-contact-info',
      'auth.account_recovery': 'auth/account-recovery',
      'auth.recovery_backup_codes': 'auth/recovery-backup-codes',
      'auth.recovery_secondary_email': 'auth/recovery-secondary-email',
      'auth.recovery_verify_code': 'auth/recovery-verify-code',
      'auth.recovery_method_select': 'auth/recovery-method-select',
      'auth.recovery_security_questions': 'auth/recovery-security-questions',
      'auth.recovery_sms': 'auth/recovery-sms',
      'auth.recovery_codes_display': 'auth/recovery-codes-display',
      'auth.setup_mfa': 'auth/setup-mfa',
      'auth.setup_webauthn': 'auth/setup-webauthn',
      'auth.mfa_select': 'auth/mfa-select',
      'auth.mfa_webauthn': 'auth/mfa-webauthn',
      'auth.mfa_no_fallback': 'auth/mfa-no-fallback',
      'auth.social_callback': 'auth/social-cb',
      'auth.oidc.consent': 'auth/oidc/consent',
      'auth.oidc.device_flow_code_input': 'auth/oidc/device-flow-code-input',
      'auth.oidc.device_flow_confirm_code':
        'auth/oidc/device-flow-confirm-code',
      'auth.oidc.device_flow_success': 'auth/oidc/device-flow-success',
      'auth.oidc.error': 'auth/oidc/error',
      'auth.oidc.login': 'auth/oidc/login',
      'auth.oidc.logout_success': 'auth/oidc/logout-success',
      'auth.oidc.logout': 'auth/oidc/logout',
      'auth.oidc.mfa': 'auth/oidc/mfa',
      'auth.oidc.mfa_select': 'auth/oidc/mfa-select',
      'auth.oidc.mfa_webauthn': 'auth/oidc/mfa-webauthn',
      'auth.oidc.mfa_no_fallback': 'auth/oidc/mfa-no-fallback',
      'auth.oidc.newDeviceVerify': 'auth/oidc/new-device-verify',
      'accounts.my_account': 'accounts/my-account',
      'accounts.settings': 'accounts/settings',
      'accounts.settings_profile': 'accounts/settings/profile',
      'accounts.settings_preferences': 'accounts/settings/preferences',
      'accounts.settings_notifications': 'accounts/settings/notifications',
      'accounts.settings_security': 'accounts/settings/security',
      'accounts.settings_recovery': 'accounts/settings/recovery',
      'accounts.settings_social': 'accounts/settings/social',
      'accounts.apps': 'accounts/apps',
      'accounts.sessions': 'accounts/sessions',
      'accounts.recovery_codes': 'accounts/recovery-codes',
      'accounts.recovery_setup': 'accounts/recovery-setup',
      'accounts.security_questions_setup': 'accounts/security-questions-setup',
      'accounts.passkeys': 'accounts/passkeys',
      'errors.unauthorized': 'error/401',
      'errors.forbidden': 'error/403',
      'errors.notfound': 'error/404',
      'errors.server_error': 'error/500',
      'errors.rate_limit': 'error/rate-limit-inline',
      'email.mail': 'email/mail',
      'home.index': 'home/index',
    };

    return defaultPathMap[configKey] || configKey;
  }

  /**
   * Check if a view file is valid (exists, readable, and not empty)
   */
  private isValidViewFile(filePath: string): boolean {
    try {
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return false;
      }

      const stats = fs.statSync(filePath);
      if (stats.size === 0) {
        return false;
      }

      const content = fs.readFileSync(filePath, 'utf8');
      return content.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Ensure view path has the proper extension
   */
  private ensureViewExtension(viewPath: string): string {
    const config = this.getConfig();
    if (viewPath.endsWith(config.viewExtension)) {
      return viewPath;
    }
    return `${viewPath}${config.viewExtension}`;
  }

  /**
   * Build default view keys as fallback when no custom configuration exists
   */
  private buildDefaultViewKeys(): ViewKeys {
    return {
      auth: {
        login: this.ensureViewExtension('auth/login'),
        register: this.ensureViewExtension('auth/register'),
        forgot_password: this.ensureViewExtension('auth/forgot-password'),
        reset_password: this.ensureViewExtension('auth/reset-password'),
        email_verification: this.ensureViewExtension('auth/email-verification'),
        verify_email: this.ensureViewExtension('auth/verify-email'),
        email_verification_success: this.ensureViewExtension(
          'auth/email-verification-success'
        ),
        account_select: this.ensureViewExtension('auth/account-select'),
        continue: this.ensureViewExtension('auth/continue'),
        multi_factor: this.ensureViewExtension('auth/multi-factor'),
        mfa_verify: this.ensureViewExtension('auth/mfa-verify'),
        mfa_resend: this.ensureViewExtension('auth/mfa-resend'),
        logout: this.ensureViewExtension('auth/logout'),
        social_password_setup: this.ensureViewExtension(
          'auth/social-password-setup'
        ),
        social_contact_info: this.ensureViewExtension(
          'auth/social-contact-info'
        ),
        account_recovery: this.ensureViewExtension('auth/account-recovery'),
        recovery_backup_codes: this.ensureViewExtension(
          'auth/recovery-backup-codes'
        ),
        recovery_secondary_email: this.ensureViewExtension(
          'auth/recovery-secondary-email'
        ),
        recovery_verify_code: this.ensureViewExtension(
          'auth/recovery-verify-code'
        ),
        recovery_method_select: this.ensureViewExtension(
          'auth/recovery-method-select'
        ),
        recovery_security_questions: this.ensureViewExtension(
          'auth/recovery-security-questions'
        ),
        recovery_sms: this.ensureViewExtension('auth/recovery-sms'),
        recovery_codes_display: this.ensureViewExtension(
          'auth/recovery-codes-display'
        ),
        setup_mfa: this.ensureViewExtension('auth/setup-mfa'),
        setup_webauthn: this.ensureViewExtension('auth/setup-webauthn'),
        mfa_select: this.ensureViewExtension('auth/mfa-select'),
        mfa_webauthn: this.ensureViewExtension('auth/mfa-webauthn'),
        mfa_no_fallback: this.ensureViewExtension('auth/mfa-no-fallback'),
        social_callback: this.ensureViewExtension('auth/social-cb'),
        oidc: {
          consent: this.ensureViewExtension('auth/oidc/consent'),
          device_flow_code_input: this.ensureViewExtension(
            'auth/oidc/device-flow-code-input'
          ),
          device_flow_confirm_code: this.ensureViewExtension(
            'auth/oidc/device-flow-confirm-code'
          ),
          device_flow_success: this.ensureViewExtension(
            'auth/oidc/device-flow-success'
          ),
          error: this.ensureViewExtension('auth/oidc/error'),
          login: this.ensureViewExtension('auth/oidc/login'),
          logout_success: this.ensureViewExtension('auth/oidc/logout-success'),
          logout: this.ensureViewExtension('auth/oidc/logout'),
          mfa: this.ensureViewExtension('auth/oidc/mfa'),
          mfa_select: this.ensureViewExtension('auth/oidc/mfa-select'),
          mfa_webauthn: this.ensureViewExtension('auth/oidc/mfa-webauthn'),
          mfa_no_fallback: this.ensureViewExtension(
            'auth/oidc/mfa-no-fallback'
          ),
          newDeviceVerify: this.ensureViewExtension(
            'auth/oidc/new-device-verify'
          ),
        },
      },
      accounts: {
        my_account: this.ensureViewExtension('accounts/my-account'),
        settings: this.ensureViewExtension('accounts/settings'),
        settings_profile: this.ensureViewExtension('accounts/settings/profile'),
        settings_preferences: this.ensureViewExtension(
          'accounts/settings/preferences'
        ),
        settings_notifications: this.ensureViewExtension(
          'accounts/settings/notifications'
        ),
        settings_security: this.ensureViewExtension(
          'accounts/settings/security'
        ),
        settings_recovery: this.ensureViewExtension(
          'accounts/settings/recovery'
        ),
        settings_social: this.ensureViewExtension('accounts/settings/social'),
        apps: this.ensureViewExtension('accounts/apps'),
        sessions: this.ensureViewExtension('accounts/sessions'),
        recovery_codes: this.ensureViewExtension('accounts/recovery-codes'),
        recovery_setup: this.ensureViewExtension('accounts/recovery-setup'),
        security_questions_setup: this.ensureViewExtension(
          'accounts/security-questions-setup'
        ),
        passkeys: this.ensureViewExtension('accounts/passkeys'),
      },
      errors: {
        unauthorized: this.ensureViewExtension('error/401'),
        forbidden: this.ensureViewExtension('error/403'),
        notfound: this.ensureViewExtension('error/404'),
        server_error: this.ensureViewExtension('error/500'),
        rate_limit: this.ensureViewExtension('error/rate-limit-inline'),
      },
      email: {
        mail: this.ensureViewExtension('email/mail'),
      },
      home: {
        index: this.ensureViewExtension('home/index'),
      },
    };
  }

  /**
   * Get type-safe view keys for controllers
   * Usage: res.render(viewResolver.views.auth.login, {...})
   */
  public get views(): ViewKeys {
    if (!this.viewKeys) {
      this.initializeViewKeys();
    }
    return this.viewKeys!;
  }

  /**
   * Configure Express app with resolved view paths
   * Sets up Nunjucks with proper view directories
   */
  public configureExpressViews(
    app: Application,
    njk: typeof nunjucks
  ): nunjucks.Environment | null {
    try {
      if (!this.viewKeys) {
        this.initializeViewKeys();
      }

      const config = this.getConfig();

      const viewDirs = [
        path.join(this.fileSystemUtils.rootDir, config.defaultViewsRoot),
      ];

      if (config.enabled) {
        viewDirs.unshift(
          path.join(this.fileSystemUtils.rootDir, config.customViewsRoot)
        );
      }

      const deploymentConfig = this.configManager.getConfig().deployment;
      this.logger.info(
        `Express views configured: ${viewDirs.map(dir => path.relative(this.fileSystemUtils.rootDir, dir)).join(', ')} (env: ${deploymentConfig.environment}, default: ${config.defaultViewsRoot})`,
        { context: 'express_views_configuration' }
      );

      const njkEnv = njk.configure(viewDirs, {
        autoescape: true,
        express: app,
        watch:
          this.configManager.getConfig().deployment.environment ===
          'development',
      });

      return njkEnv;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'express_views_configuration_failed',
      });
      throw error;
    }
  }

  /**
   * Reload configuration
   */
  public reloadConfig(): void {
    this.initializeViewKeys();
    this.logger.info('View resolver configuration reloaded');
  }

  /**
   * Get current configuration
   */
  public getCurrentConfig(): ViewResolverConfig {
    return this.getConfig();
  }
}

export default ViewResolver;
