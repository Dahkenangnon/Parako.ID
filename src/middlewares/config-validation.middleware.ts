import { Request, Response, NextFunction } from 'express';
import { injectable, inject } from 'inversify';
import nodemailer from 'nodemailer';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { ISessionManager } from '../di/interfaces/session-manager.interface.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { ISettingsService } from '../di/interfaces/settings-service.interface.js';
import { TYPES } from '../di/types.js';
import type { BootstrapConfig } from '../config/types.js';

/**
 * Validation result interface
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Extended Express Request with validation warnings
 */
export interface RequestWithValidation extends Request {
  validationWarnings?: string[];
}

/**
 * Configuration Validation Middleware
 * Validates configuration updates before they are saved to the database
 * Provides section-specific validation for OIDC, integrations, security, and storage
 */
@injectable()
export class ConfigValidationMiddleware {
  constructor(
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.SettingsService)
    private readonly settingsService: ISettingsService
  ) {}

  /**
   * Validate integrations configuration
   * Tests SMTP connection if email settings are provided
   */
  private async validateIntegrationsConfig(
    data: any
  ): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (data.email) {
      const { smtp_host, smtp_port, smtp_username, smtp_password } = data.email;

      if (smtp_host && !smtp_port) {
        errors.push('SMTP port is required when SMTP host is provided');
      }

      if (smtp_port && (smtp_port < 1 || smtp_port > 65535)) {
        errors.push('SMTP port must be between 1 and 65535');
      }

      if (smtp_host && smtp_username && !smtp_password) {
        warnings.push(
          'SMTP password not provided. Connection may fail if authentication is required.'
        );
      }

      if (smtp_host && smtp_port) {
        try {
          this.logger.debug('Testing SMTP connection', {
            host: smtp_host,
            port: smtp_port,
          });

          const testTransporter = nodemailer.createTransport({
            host: smtp_host,
            port: smtp_port,
            secure: false,
            auth:
              smtp_username && smtp_password
                ? {
                    user: smtp_username,
                    pass: smtp_password,
                  }
                : undefined,
            tls: {
              rejectUnauthorized: false,
            },
          });

          await testTransporter.verify();

          warnings.push(
            'SMTP connection test successful. Email service will be reinitialized on save.'
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          errors.push(
            `SMTP connection test failed: ${errorMessage}. Please verify your SMTP settings.`
          );
        }
      }
    }

    if (data.social_providers) {
      const { google, github } = data.social_providers;

      if (google?.enabled) {
        if (!google.client_id) {
          errors.push(
            'Google OAuth2 client ID is required when Google login is enabled'
          );
        }
        if (!google.client_secret) {
          errors.push(
            'Google OAuth2 client secret is required when Google login is enabled'
          );
        }
      }

      if (github?.enabled) {
        if (!github.client_id) {
          errors.push(
            'GitHub OAuth2 client ID is required when GitHub login is enabled'
          );
        }
        if (!github.client_secret) {
          errors.push(
            'GitHub OAuth2 client secret is required when GitHub login is enabled'
          );
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate OIDC configuration
   * Checks issuer matches deployment URL and validates for breaking changes
   */
  private async validateOidcConfig(data: any): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    const currentConfig = this.configManager.getConfig();

    if (data.issuer) {
      const deploymentUrl = currentConfig.deployment.url;
      const oidcPath = data.path || currentConfig.oidc.path || '/oidc/v1';
      const expectedIssuer = `${deploymentUrl}${oidcPath}`;

      if (data.issuer !== expectedIssuer) {
        warnings.push(
          `OIDC issuer (${data.issuer}) does not match expected value (${expectedIssuer}). ` +
            'This is auto-computed from deployment.url and oidc.path. Manual changes will be overwritten.'
        );
      }
    }

    if (data.issuer || data.path) {
      const oldConfig = { oidc: currentConfig.oidc };
      const newConfig = { oidc: { ...currentConfig.oidc, ...data } };

      try {
        const diff = this.settingsService.generateConfigDiff(
          oldConfig,
          newConfig
        );
        const impact = this.settingsService.analyzeConfigImpact(diff);

        if (impact.warnings.length > 0) {
          warnings.push(...impact.warnings);
        }

        if (impact.requiresRestart) {
          warnings.push(
            'Application restart will be required for OIDC configuration changes to take effect.'
          );
        }
      } catch (error) {
        this.logger.error('Error analyzing OIDC config impact', { error });
      }
    }

    if (data.features) {
      const { introspection, revocation, device_flow } = data.features;

      if (introspection?.enabled && !introspection.client_auth_method) {
        errors.push(
          'Client authentication method is required when introspection is enabled'
        );
      }

      if (revocation?.enabled && !revocation.client_auth_method) {
        errors.push(
          'Client authentication method is required when revocation is enabled'
        );
      }

      if (device_flow?.enabled) {
        warnings.push(
          'Device flow is an advanced feature. Ensure your OIDC clients support RFC 8628.'
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate security configuration
   * Ensures strong secrets and HTTPS in production
   */
  private async validateSecurityConfig(data: any): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    const currentConfig = this.configManager.getConfig();
    const bootstrapConfig =
      (await this.configManager.getBootstrapConfig()) as unknown as BootstrapConfig;
    const environment = bootstrapConfig.deployment.environment;
    const deploymentUrl = currentConfig.deployment.url;

    // Production-specific validations
    if (environment === 'production') {
      if (deploymentUrl && !deploymentUrl.startsWith('https://')) {
        warnings.push(
          'CRITICAL: Deployment URL should use HTTPS in production for security. ' +
            'HTTP is only acceptable for local development.'
        );
      }

      if (data.cookies?.secure === false) {
        errors.push(
          'Secure cookies must be enabled in production. This is required for HTTPS environments.'
        );
      }

      if (data.sessions?.cookie?.secure === false) {
        errors.push('Secure session cookies must be enabled in production.');
      }
    }

    if (data.secrets) {
      const { jwt_secret, cookie_secrets } = data.secrets;

      // JWT secret length
      if (jwt_secret && jwt_secret.length < 32) {
        errors.push(
          'JWT secret must be at least 32 characters long for security'
        );
      }

      if (cookie_secrets) {
        let cookieSecretsArray: string[];
        if (typeof cookie_secrets === 'string') {
          cookieSecretsArray = cookie_secrets
            .split('\n')
            .map((s: string) => s.trim())
            .filter((s: string) => s.length > 0);
        } else if (Array.isArray(cookie_secrets)) {
          cookieSecretsArray = cookie_secrets;
        } else {
          errors.push(
            'Cookie secrets must be an array or newline-separated string'
          );
          cookieSecretsArray = [];
        }

        if (cookieSecretsArray.length === 0) {
          errors.push('At least one cookie secret is required');
        }
        if (cookieSecretsArray.some((s: string) => s.length < 32)) {
          errors.push('All cookie secrets must be at least 32 characters long');
        }
      }
    }

    if (data.rate_limiting) {
      const { enabled, window_ms, max_requests } = data.rate_limiting;

      if (enabled && (!window_ms || window_ms < 1000)) {
        errors.push('Rate limiting window must be at least 1000ms (1 second)');
      }

      if (enabled && (!max_requests || max_requests < 1)) {
        errors.push('Rate limiting max requests must be at least 1');
      }

      if (!enabled && environment === 'production') {
        warnings.push(
          'Rate limiting is disabled. This is not recommended for production environments.'
        );
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

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Middleware factory for validating configuration updates
   * Creates section-specific validation middleware
   *
   * @param section - Configuration section to validate (oidc, integrations, security)
   * @returns Express middleware function
   *
   * @example
   * ```typescript
   * router.post('/admin/settings/oidc',
   *   configValidationMiddleware.validateConfigUpdate('oidc'),
   *   settingsController.oidc
   * );
   * ```
   */
  public validateConfigUpdate = (section: string) => {
    return async (
      req: Request,
      res: Response,
      next: NextFunction
    ): Promise<void> => {
      try {
        this.logger.debug('Validating configuration update', {
          section,
          user: req.session?.user?.email,
        });

        let validationResult: ValidationResult;

        switch (section.toLowerCase()) {
          case 'integrations':
            validationResult = await this.validateIntegrationsConfig(req.body);
            break;

          case 'oidc':
            validationResult = await this.validateOidcConfig(req.body);
            break;

          case 'security':
            validationResult = await this.validateSecurityConfig(req.body);
            break;

          default:
            // No specific validation for this section, allow through
            this.logger.debug('No specific validation for section', {
              section,
            });
            return next();
        }

        if (validationResult.warnings.length > 0) {
          (req as RequestWithValidation).validationWarnings =
            validationResult.warnings;

          this.logger.info('Configuration validation warnings', {
            section,
            warnings: validationResult.warnings,
            user: req.session?.user?.email,
          });
        }

        // If validation failed, flash errors and redirect back
        if (!validationResult.valid) {
          this.logger.warn('Configuration validation failed', {
            section,
            errors: validationResult.errors,
            user: req.session?.user?.email,
          });

          for (const error of validationResult.errors) {
            this.sessionManager.flash(req).error(error);
          }

          // Flash warnings as info messages
          for (const warning of validationResult.warnings) {
            this.sessionManager.flash(req).info(warning);
          }

          return res.redirect(`/admin/settings/${section.toLowerCase()}`);
        }

        // Validation passed, continue to controller
        this.logger.debug('Configuration validation passed', { section });
        next();
      } catch (error) {
        this.logger.error('Error during configuration validation', { error });

        this.sessionManager
          .flash(req)
          .error(
            'An error occurred while validating configuration. Please try again.'
          );

        res.redirect(`/admin/settings/${section.toLowerCase()}`);
      }
    };
  };

  /**
   * Validate deployment configuration
   * Ensures valid URLs and deployment settings
   */
  public validateDeploymentConfig = async (
    data: any
  ): Promise<ValidationResult> => {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (data.url) {
      try {
        const url = new URL(data.url);

        if (data.url.endsWith('/')) {
          errors.push('Deployment URL must not end with a trailing slash');
        }

        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          errors.push('Deployment URL must use HTTP or HTTPS protocol');
        }

        // Production warning for HTTP
        const bootstrapConfig =
          (await this.configManager.getBootstrapConfig()) as unknown as BootstrapConfig;
        if (
          bootstrapConfig.deployment.environment === 'production' &&
          url.protocol === 'http:'
        ) {
          warnings.push(
            'CRITICAL: Using HTTP in production is not recommended. Use HTTPS for security.'
          );
        }
      } catch {
        errors.push('Deployment URL is not a valid URL');
      }
    }

    if (data.server?.allowed_origins) {
      const origins = data.server.allowed_origins;

      if (!Array.isArray(origins)) {
        errors.push('Allowed origins must be an array');
      } else {
        for (const origin of origins) {
          try {
            new URL(origin);
          } catch {
            errors.push(`Invalid origin URL: ${origin}`);
          }
        }
      }
    }

    if (data.server?.dev_allowed_origins) {
      const devOrigins = data.server.dev_allowed_origins;

      if (!Array.isArray(devOrigins)) {
        errors.push('Dev allowed origins must be an array');
      } else {
        for (const origin of devOrigins) {
          try {
            new URL(origin);
          } catch {
            errors.push(`Invalid dev origin URL: ${origin}`);
          }
        }
      }
    }

    if (
      data.server?.trust_proxy_hops !== undefined &&
      data.server?.trust_proxy_hops !== null
    ) {
      const hops = data.server.trust_proxy_hops;
      if (
        typeof hops !== 'number' ||
        !Number.isInteger(hops) ||
        hops < 0 ||
        hops > 10
      ) {
        errors.push('trust_proxy_hops must be an integer between 0 and 10');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  };
}
