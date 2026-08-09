import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createTransport, verifyTransport } = vi.hoisted(() => ({
  createTransport: vi.fn(),
  verifyTransport: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  default: { createTransport },
}));

import { getDefaultFullConfig } from '../../../src/config/constants.js';
import {
  ConfigValidationMiddleware,
  type RequestWithValidation,
} from '../../../src/middlewares/config-validation.middleware.js';

describe('ConfigValidationMiddleware', () => {
  let config: ReturnType<typeof getDefaultFullConfig>;
  let configManager: Record<string, ReturnType<typeof vi.fn>>;
  let sessionManager: Record<string, ReturnType<typeof vi.fn>>;
  let logger: Record<string, ReturnType<typeof vi.fn>>;
  let settingsService: Record<string, ReturnType<typeof vi.fn>>;
  let middleware: ConfigValidationMiddleware;
  let req: Request;
  let res: Response;
  let next: NextFunction;
  let flashError: ReturnType<typeof vi.fn>;
  let flashInfo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    config = getDefaultFullConfig();
    configManager = {
      getConfig: vi.fn(() => config),
      getBootstrapConfig: vi.fn(async () => ({
        deployment: { environment: 'production' },
      })),
    };
    flashError = vi.fn();
    flashInfo = vi.fn();
    sessionManager = {
      flash: vi.fn(() => ({ error: flashError, info: flashInfo })),
    };
    logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    settingsService = {
      generateConfigDiff: vi.fn(() => []),
      analyzeConfigImpact: vi.fn(() => ({
        warnings: [],
        requiresRestart: false,
      })),
    };
    middleware = new ConfigValidationMiddleware(
      configManager as any,
      sessionManager as any,
      logger as any,
      settingsService as any
    );
    req = {
      body: {},
      session: { user: { email: 'admin@example.test' } },
    } as any;
    res = { redirect: vi.fn() } as unknown as Response;
    next = vi.fn();
    verifyTransport.mockReset();
    verifyTransport.mockResolvedValue(true);
    createTransport.mockReset();
    createTransport.mockReturnValue({ verify: verifyTransport });
  });

  const validateSection = async (section: string, body: unknown) => {
    req.body = body;
    await middleware.validateConfigUpdate(section)(req, res, next);
  };

  it('rejects non-HTTP allowed origins used by browser CORS configuration', async () => {
    const result = await middleware.validateDeploymentConfig({
      server: {
        allowed_origins: ['javascript:alert(1)'],
        dev_allowed_origins: ['file:///tmp/demo.html'],
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      'Invalid origin URL: javascript:alert(1)',
      'Invalid dev origin URL: file:///tmp/demo.html',
    ]);
  });

  it('allows unknown configuration sections without applying validation', async () => {
    await validateSection('Branding', { anything: true });

    expect(next).toHaveBeenCalledOnce();
    expect(logger.debug).toHaveBeenCalledWith(
      'No specific validation for section',
      { section: 'Branding' }
    );
  });

  it('accepts an empty integrations update', async () => {
    await validateSection('integrations', {});

    expect(next).toHaveBeenCalledOnce();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('validates SMTP dependencies and enabled social-provider credentials', async () => {
    await validateSection('INTEGRATIONS', {
      email: {
        smtp_host: 'smtp.example.test',
        smtp_port: 70_000,
        smtp_username: 'mailer',
      },
      social_providers: {
        google: { enabled: true },
        github: { enabled: true },
      },
    });

    expect(flashError.mock.calls.map(([message]) => message)).toEqual([
      'SMTP port must be between 1 and 65535',
      'Google OAuth2 client ID is required when Google login is enabled',
      'Google OAuth2 client secret is required when Google login is enabled',
      'GitHub OAuth2 client ID is required when GitHub login is enabled',
      'GitHub OAuth2 client secret is required when GitHub login is enabled',
    ]);
    expect(flashInfo).toHaveBeenCalledWith(
      'SMTP password not provided. Connection may fail if authentication is required.'
    );
    expect(res.redirect).toHaveBeenCalledWith('/admin/settings/integrations');
    expect(next).not.toHaveBeenCalled();
  });

  it('requires an SMTP port when a host is configured', async () => {
    await validateSection('integrations', {
      email: { smtp_host: 'smtp.example.test' },
    });

    expect(flashError).toHaveBeenCalledWith(
      'SMTP port is required when SMTP host is provided'
    );
  });

  it.each([0, 65_536])('rejects SMTP port %s', async smtpPort => {
    await validateSection('integrations', {
      email: { smtp_port: smtpPort },
    });

    if (smtpPort === 0) {
      expect(next).toHaveBeenCalledOnce();
    } else {
      expect(flashError).toHaveBeenCalledWith(
        'SMTP port must be between 1 and 65535'
      );
    }
  });

  it('verifies authenticated SMTP configuration and forwards its warning', async () => {
    await validateSection('integrations', {
      email: {
        smtp_host: 'smtp.example.test',
        smtp_port: 587,
        smtp_username: 'mailer',
        smtp_password: 'secret',
      },
      social_providers: {
        google: {
          enabled: true,
          client_id: 'google-id',
          client_secret: 'google-secret',
        },
        github: {
          enabled: false,
        },
      },
    });

    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.test',
      port: 587,
      secure: false,
      auth: { user: 'mailer', pass: 'secret' },
      tls: { rejectUnauthorized: true },
    });
    expect(verifyTransport).toHaveBeenCalledOnce();
    expect((req as RequestWithValidation).validationWarnings).toEqual([
      'SMTP connection test successful. Email service will be reinitialized on save.',
    ]);
    expect(next).toHaveBeenCalledOnce();
  });

  it('verifies unauthenticated SMTP configuration without an auth object', async () => {
    await validateSection('integrations', {
      email: { smtp_host: 'smtp.example.test', smtp_port: 25 },
    });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: undefined })
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('honors an explicit SMTP certificate-verification override', async () => {
    await validateSection('integrations', {
      email: {
        smtp_host: 'smtp.internal.example.test',
        smtp_port: 587,
        tls_reject_unauthorized: false,
      },
    });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ tls: { rejectUnauthorized: false } })
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('preserves the persisted SMTP certificate-verification policy on partial updates', async () => {
    config.integrations.email.tls_reject_unauthorized = false;

    await validateSection('integrations', {
      email: {
        smtp_host: 'smtp.internal.example.test',
        smtp_port: 587,
      },
    });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ tls: { rejectUnauthorized: false } })
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('allows self-signed SMTP certificates by default outside production', async () => {
    configManager.getBootstrapConfig.mockResolvedValue({
      deployment: { environment: 'development' },
    });

    await validateSection('integrations', {
      email: { smtp_host: 'localhost', smtp_port: 1025 },
    });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ tls: { rejectUnauthorized: false } })
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('accepts disabled Google and complete enabled GitHub configuration', async () => {
    await validateSection('integrations', {
      social_providers: {
        google: { enabled: false },
        github: {
          enabled: true,
          client_id: 'github-id',
          client_secret: 'github-secret',
        },
      },
    });

    expect(next).toHaveBeenCalledOnce();
    expect(flashError).not.toHaveBeenCalled();
  });

  it.each([new Error('connection refused'), 'connection refused'])(
    'rejects failed SMTP verification: %s',
    async smtpError => {
      verifyTransport.mockRejectedValue(smtpError);

      await validateSection('integrations', {
        email: { smtp_host: 'smtp.example.test', smtp_port: 587 },
      });

      expect(flashError).toHaveBeenCalledWith(
        'SMTP connection test failed: connection refused. Please verify your SMTP settings.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/settings/integrations');
    }
  );

  it('reports OIDC issuer drift, impact warnings, and restart requirements', async () => {
    config.deployment.url = 'https://id.example.test';
    config.oidc.path = '/oidc/v1';
    settingsService.generateConfigDiff.mockReturnValue([{ path: 'oidc.path' }]);
    settingsService.analyzeConfigImpact.mockReturnValue({
      warnings: ['Existing clients must update metadata'],
      requiresRestart: true,
    });

    await validateSection('oidc', {
      issuer: 'https://other.example.test/custom',
      path: '/custom',
    });

    expect((req as RequestWithValidation).validationWarnings).toEqual([
      expect.stringContaining('does not match expected value'),
      'Existing clients must update metadata',
      'Application restart will be required for OIDC configuration changes to take effect.',
    ]);
    expect(settingsService.generateConfigDiff).toHaveBeenCalledWith(
      { oidc: config.oidc },
      {
        oidc: {
          ...config.oidc,
          issuer: 'https://other.example.test/custom',
          path: '/custom',
        },
      }
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('uses the current OIDC path when validating a matching issuer', async () => {
    config.deployment.url = 'https://id.example.test';
    config.oidc.path = '/oidc/v1';

    await validateSection('oidc', {
      issuer: 'https://id.example.test/oidc/v1',
    });

    expect((req as RequestWithValidation).validationWarnings).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it('uses the standard OIDC path when current and proposed paths are empty', async () => {
    config.deployment.url = 'https://id.example.test';
    config.oidc.path = '';

    await validateSection('oidc', {
      issuer: 'https://id.example.test/oidc/v1',
    });

    expect(next).toHaveBeenCalledOnce();
    expect((req as RequestWithValidation).validationWarnings).toBeUndefined();
  });

  it('rejects incomplete advanced OIDC features and warns about device flow', async () => {
    await validateSection('oidc', {
      features: {
        introspection: { enabled: true },
        revocation: { enabled: true },
        device_flow: { enabled: true },
      },
    });

    expect(flashError.mock.calls.map(([message]) => message)).toEqual([
      'Client authentication method is required when introspection is enabled',
      'Client authentication method is required when revocation is enabled',
    ]);
    expect(flashInfo).toHaveBeenCalledWith(
      'Device flow is an advanced feature. Ensure your OIDC clients support RFC 8628.'
    );
  });

  it('accepts complete or disabled advanced OIDC features', async () => {
    await validateSection('oidc', {
      features: {
        introspection: {
          enabled: true,
          client_auth_method: 'client_secret_basic',
        },
        revocation: { enabled: false },
        device_flow: { enabled: false },
      },
    });

    expect(next).toHaveBeenCalledOnce();
    expect(flashError).not.toHaveBeenCalled();
    expect((req as RequestWithValidation).validationWarnings).toBeUndefined();
  });

  it('logs OIDC impact-analysis failures without rejecting a valid update', async () => {
    const error = new Error('diff failed');
    settingsService.generateConfigDiff.mockImplementation(() => {
      throw error;
    });

    await validateSection('oidc', { path: '/new-path' });

    expect(logger.error).toHaveBeenCalledWith(
      'Error analyzing OIDC config impact',
      { error }
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('redirects safely when section validation itself throws', async () => {
    const error = new Error('configuration unavailable');
    configManager.getConfig.mockImplementation(() => {
      throw error;
    });

    await validateSection('OIDC', { issuer: 'https://id.example.test' });

    expect(logger.error).toHaveBeenCalledWith(
      'Error during configuration validation',
      { error }
    );
    expect(flashError).toHaveBeenCalledWith(
      'An error occurred while validating configuration. Please try again.'
    );
    expect(res.redirect).toHaveBeenCalledWith('/admin/settings/oidc');
  });

  it('rejects insecure production security settings and weak credentials', async () => {
    config.deployment.url = 'http://id.example.test';

    await validateSection('security', {
      cookies: { secure: false },
      sessions: { cookie: { secure: false } },
      secrets: {
        jwt_secret: 'short',
        cookie_secrets: '  short-secret  \n\n',
      },
      rate_limiting: { enabled: true, window_ms: 999, max_requests: 0 },
      authentication: {
        multi_factor: {
          totp: { enabled: true },
          webauthn: { enabled: true },
        },
      },
    });

    expect(flashError.mock.calls.map(([message]) => message)).toEqual([
      'Secure cookies must be enabled in production. This is required for HTTPS environments.',
      'Secure session cookies must be enabled in production.',
      'JWT secret must be at least 32 characters long for security',
      'All cookie secrets must be at least 32 characters long',
      'Rate limiting window must be at least 1000ms (1 second)',
      'Rate limiting max requests must be at least 1',
      'TOTP issuer name is required when TOTP is enabled',
      'WebAuthn Relying Party ID is required when WebAuthn is enabled',
      'WebAuthn Relying Party name is required when WebAuthn is enabled',
    ]);
    expect(flashInfo).toHaveBeenCalledWith(
      expect.stringContaining('Deployment URL should use HTTPS in production')
    );
    expect(res.redirect).toHaveBeenCalledWith('/admin/settings/security');
  });

  it.each([null, 42, {}])(
    'rejects malformed cookie secrets value %j',
    async cookieSecrets => {
      await validateSection('security', {
        secrets: { cookie_secrets: cookieSecrets },
      });

      if (cookieSecrets === null) {
        expect(next).toHaveBeenCalledOnce();
      } else {
        expect(flashError.mock.calls.map(([message]) => message)).toEqual([
          'Cookie secrets must be an array or newline-separated string',
          'At least one cookie secret is required',
        ]);
      }
    }
  );

  it('rejects an empty cookie-secret array', async () => {
    await validateSection('security', {
      secrets: { cookie_secrets: [] },
    });

    expect(flashError).toHaveBeenCalledWith(
      'At least one cookie secret is required'
    );
  });

  it('accepts strong array credentials and complete multifactor settings', async () => {
    configManager.getBootstrapConfig.mockResolvedValue({
      deployment: { environment: 'development' },
    });

    await validateSection('security', {
      cookies: { secure: false },
      sessions: { cookie: { secure: false } },
      secrets: {
        jwt_secret: 'j'.repeat(32),
        cookie_secrets: ['c'.repeat(32)],
      },
      rate_limiting: { enabled: true, window_ms: 1000, max_requests: 1 },
      authentication: {
        multi_factor: {
          totp: { enabled: true, issuer_name: 'Parako' },
          webauthn: {
            enabled: true,
            rp_id: 'id.example.test',
            rp_name: 'Parako',
          },
        },
      },
    });

    expect(next).toHaveBeenCalledOnce();
    expect(flashError).not.toHaveBeenCalled();
  });

  it('warns when rate limiting is disabled in production', async () => {
    await validateSection('security', {
      rate_limiting: { enabled: false },
    });

    expect((req as RequestWithValidation).validationWarnings).toEqual([
      'Rate limiting is disabled. This is not recommended for production environments.',
    ]);
    expect(next).toHaveBeenCalledOnce();
  });

  it('accepts an empty deployment update', async () => {
    await expect(middleware.validateDeploymentConfig({})).resolves.toEqual({
      valid: true,
      errors: [],
      warnings: [],
    });
  });

  it('validates deployment URL shape, scheme, and production transport', async () => {
    const trailing = await middleware.validateDeploymentConfig({
      url: 'https://id.example.test/',
    });
    const unsupported = await middleware.validateDeploymentConfig({
      url: 'ftp://id.example.test',
    });
    const malformed = await middleware.validateDeploymentConfig({
      url: 'not a URL',
    });
    const insecure = await middleware.validateDeploymentConfig({
      url: 'http://id.example.test',
    });

    expect(trailing.errors).toContain(
      'Deployment URL must not end with a trailing slash'
    );
    expect(unsupported.errors).toContain(
      'Deployment URL must use HTTP or HTTPS protocol'
    );
    expect(malformed.errors).toEqual(['Deployment URL is not a valid URL']);
    expect(insecure.warnings).toEqual([
      'CRITICAL: Using HTTP in production is not recommended. Use HTTPS for security.',
    ]);
  });

  it('does not warn about HTTP deployment URLs outside production', async () => {
    configManager.getBootstrapConfig.mockResolvedValue({
      deployment: { environment: 'development' },
    });

    const result = await middleware.validateDeploymentConfig({
      url: 'http://localhost:9007',
    });

    expect(result).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it('accepts HTTP and HTTPS origin arrays', async () => {
    const result = await middleware.validateDeploymentConfig({
      server: {
        allowed_origins: ['https://app.example.test', 'http://localhost:3000'],
        dev_allowed_origins: ['http://127.0.0.1:3000'],
      },
    });

    expect(result).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it('rejects malformed and non-array origin lists', async () => {
    const nonArrays = await middleware.validateDeploymentConfig({
      server: {
        allowed_origins: 'https://app.example.test',
        dev_allowed_origins: {},
      },
    });
    const malformed = await middleware.validateDeploymentConfig({
      server: {
        allowed_origins: ['not a URL'],
        dev_allowed_origins: ['also not a URL'],
      },
    });

    expect(nonArrays.errors).toEqual([
      'Allowed origins must be an array',
      'Dev allowed origins must be an array',
    ]);
    expect(malformed.errors).toEqual([
      'Invalid origin URL: not a URL',
      'Invalid dev origin URL: also not a URL',
    ]);
  });

  it.each([0, 1, 10, null, undefined])(
    'accepts trust_proxy_hops value %s',
    async hops => {
      const result = await middleware.validateDeploymentConfig({
        server: { trust_proxy_hops: hops },
      });

      expect(result.errors).toEqual([]);
    }
  );

  it.each([-1, 11, 1.5, '1', Number.NaN])(
    'rejects invalid trust_proxy_hops value %s',
    async hops => {
      const result = await middleware.validateDeploymentConfig({
        server: { trust_proxy_hops: hops },
      });

      expect(result.errors).toEqual([
        'trust_proxy_hops must be an integer between 0 and 10',
      ]);
    }
  );
});
