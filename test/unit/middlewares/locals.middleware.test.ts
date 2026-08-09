import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDefaultFullConfig,
  WEB_SAFE_FONTS,
} from '../../../src/config/constants.js';
import { LocalsMiddleware } from '../../../src/middlewares/locals.middleware.js';

describe('LocalsMiddleware', () => {
  type TestRuntimeConfig = ReturnType<typeof getDefaultFullConfig> & {
    deployment: ReturnType<typeof getDefaultFullConfig>['deployment'] & {
      environment: 'development' | 'staging' | 'production';
    };
  };

  let config: TestRuntimeConfig;
  let configManager: { getConfig: ReturnType<typeof vi.fn> };
  let logger: {
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };
  let sessionManager: Record<string, ReturnType<typeof vi.fn>>;
  let socialLoginManager: {
    getAvailableProviders: ReturnType<typeof vi.fn>;
  };
  let uploadMiddleware: { getFileUrl: ReturnType<typeof vi.fn> };
  let middleware: LocalsMiddleware;
  let req: Request;
  let res: Response;
  let next: NextFunction;

  beforeEach(() => {
    const persistedConfig = getDefaultFullConfig();
    config = {
      ...persistedConfig,
      deployment: {
        ...persistedConfig.deployment,
        environment: 'development',
      },
    };
    configManager = { getConfig: vi.fn(() => config) };
    logger = { error: vi.fn(), warn: vi.fn() };
    sessionManager = {
      isAuthenticated: vi.fn(),
      clearAuthenticationData: vi.fn(),
      getActiveUser: vi.fn(),
      getAuthenticatedUsers: vi.fn(),
    };
    socialLoginManager = {
      getAvailableProviders: vi.fn(() => ['github']),
    };
    uploadMiddleware = {
      getFileUrl: vi.fn((value: string) => `/files/${value}`),
    };
    middleware = new LocalsMiddleware(
      configManager as any,
      logger as any,
      sessionManager as any,
      socialLoginManager as any,
      uploadMiddleware as any
    );
    req = {
      protocol: 'https',
      hostname: 'id.example.test',
      originalUrl: '/auth/login?continue=%2Faccounts',
      url: '/auth/login?continue=%2Faccounts',
      method: 'GET',
    } as Request;
    res = { locals: {}, redirect: vi.fn() } as unknown as Response;
    next = vi.fn();
  });

  it('provides login templates with normalized usable custom identifiers', async () => {
    config.security.authentication.login.login_methods = [
      'email',
      'phone_number',
      'custom_identifier_1',
    ];
    config.security.authentication.custom_identifiers = {
      enabled: true,
      fields: [
        {
          slot: 1,
          key: 'employee_id',
          name: 'Employee ID',
          hint_for_user: 'Use the ID on your badge',
          usable_for_login: true,
          required: false,
          validation: {},
        },
        {
          slot: 2,
          key: 'internal_note',
          name: 'Internal note',
          hint_for_user: 'Not a login identifier',
          usable_for_login: false,
          required: false,
          validation: {},
        },
      ],
    };

    await middleware.configLocals(req, res, next);

    expect(res.locals.authentication.loginMethods).toMatchObject({
      email: true,
      phone: true,
      customIdentifier: true,
      bothEnabled: true,
      customIdentifiers: [
        {
          slot: 1,
          key: 'employee_id',
          name: 'Employee ID',
          hint: 'Use the ID on your badge',
        },
      ],
    });
    expect(next).toHaveBeenCalledOnce();
  });

  it('builds application, branding, social, OIDC, canonical, and Open Graph locals', async () => {
    config.application.title = 'Example Identity';
    config.application.description = 'Identity for Example';
    config.deployment.url = 'https://id.example.test';
    config.integrations.fingerprintjs = {
      enabled: true,
      api_key: 'public-browser-key',
      endpoint: 'https://metrics.example.test',
    };
    config.branding.companyName = 'Example Corp';
    config.branding.logo = 'tenant/logo.svg';
    config.branding.logoDark = '';
    config.branding.logoIcon = '';
    config.branding.logoIconDark = '';
    config.branding.favicon = '';
    config.features.social_providers.available = ['github', 'google'];

    await middleware.configLocals(req, res, next);

    expect(res.locals.app).toEqual({
      title: 'Example Identity',
      description: 'Identity for Example',
      locales: config.application.locales,
      url: 'https://id.example.test',
      env: config.deployment.environment,
      fingerprintJS: {
        apiKey: 'public-browser-key',
        endpoint: 'https://metrics.example.test',
      },
    });
    expect(res.locals.branding).toMatchObject({
      companyName: 'Example Corp',
      logo: '/files/tenant/logo.svg',
      logoDark: '/files/tenant/logo.svg',
      logoIcon: '/images/logo-icon-light.png',
      logoIconDark: '/images/logo-icon-dark.png',
      favicon: '/favicon.png',
      colors: config.branding.colors,
      fonts: config.branding.fonts,
    });
    expect(uploadMiddleware.getFileUrl).toHaveBeenCalledTimes(2);
    expect(res.locals.webSafeFonts).toBe(WEB_SAFE_FONTS);
    expect(res.locals.urls).toEqual(config.integrations.urls);
    expect(res.locals.socialProviders).toEqual({
      enabled: ['github'],
      available: ['github', 'google'],
    });
    expect(res.locals.oidc).toEqual({
      issuer: config.oidc.issuer,
      path: config.oidc.path,
    });
    expect(res.locals.canonical_url).toBe('https://id.example.test/auth/login');
    expect(res.locals.og).toEqual({
      title: 'Example Identity',
      description: 'Identity for Example',
      url: 'https://id.example.test/auth/login',
      site_name: 'Example Corp',
      locale: config.application.locales.default,
    });
    expect(res.locals.currentYear).toBe(new Date().getFullYear());
    expect(next).toHaveBeenCalledOnce();
  });

  it('uses safe optional defaults and derives the canonical origin from the request', async () => {
    config.deployment.url = '';
    config.branding.logo = undefined as any;
    config.branding.logoDark = undefined as any;
    config.branding.logoIcon = undefined as any;
    config.branding.logoIconDark = undefined as any;
    config.branding.favicon = undefined as any;
    config.branding.colors = undefined as any;
    config.branding.fonts = undefined as any;
    config.features.social_providers.available = undefined as any;
    config.security.authentication.login.login_methods = ['username'];
    config.security.authentication.signup.signup_methods = ['email'];
    config.security.authentication.signup.contact_channels = undefined as any;
    config.security.authentication.custom_identifiers = undefined as any;
    req.originalUrl = '/path with spaces?ignored=yes';

    await middleware.configLocals(req, res, next);

    expect(res.locals.app.fingerprintJS).toBeNull();
    expect(res.locals.branding).toMatchObject({
      logo: '',
      logoDark: '',
      logoIcon: '/images/logo-icon-light.png',
      logoIconDark: '/images/logo-icon-dark.png',
      favicon: '/favicon.png',
      colors: { light: {}, dark: {} },
      fonts: {},
    });
    expect(res.locals.socialProviders.available).toEqual([
      'google',
      'github',
      'microsoft',
      'linkedin',
      'facebook',
    ]);
    expect(res.locals.authentication).toMatchObject({
      loginMethods: {
        email: false,
        phone: false,
        customIdentifier: false,
        customIdentifiers: [],
        bothEnabled: false,
      },
      signupMethods: { bothEnabled: false, requireFullName: true },
      customIdentifiers: [],
      emailVerificationRequired: false,
      phoneVerificationRequired: false,
    });
    expect(res.locals.canonical_url).toBe(
      'https://id.example.test/path%20with%20spaces'
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('preserves already encoded path segments in the canonical URL', async () => {
    config.deployment.url = 'https://id.example.test';
    req.originalUrl = '/accounts/Maria%20Doe?tab=profile';

    await middleware.configLocals(req, res, next);

    expect(res.locals.canonical_url).toBe(
      'https://id.example.test/accounts/Maria%20Doe'
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('uses the canonical root when the request target is malformed', async () => {
    config.deployment.url = 'https://id.example.test';
    req.originalUrl = '//[';

    await middleware.configLocals(req, res, next);

    expect(res.locals.canonical_url).toBe('https://id.example.test/');
    expect(next).toHaveBeenCalledOnce();
  });

  it('treats an enabled custom-identifier feature without fields as empty', async () => {
    config.security.authentication.custom_identifiers = {
      enabled: true,
      fields: undefined,
    } as any;

    await middleware.configLocals(req, res, next);

    expect(res.locals.authentication.loginMethods.customIdentifiers).toEqual(
      []
    );
    expect(res.locals.authentication.customIdentifiers).toEqual([]);
    expect(next).toHaveBeenCalledOnce();
  });

  it('uses a complete safe fallback when configuration loading fails', async () => {
    const error = new Error('configuration unavailable');
    configManager.getConfig.mockImplementation(() => {
      throw error;
    });
    req.originalUrl = '/error path?ignored=yes';

    await middleware.configLocals(req, res, next);

    expect(logger.error).toHaveBeenCalledWith(error, {
      context: 'failed_to_load_config_for_locals',
    });
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(res.locals).toMatchObject({
      app: {
        title: 'Parako.ID',
        locales: { default: 'en', available: ['en'] },
      },
      branding: {
        logo: '/images/logo-light.png',
        logoDark: '/images/logo-dark.png',
      },
      socialProviders: { enabled: [] },
      authentication: {
        loginMethods: { email: true, customIdentifiers: [] },
      },
      oidc: {
        issuer: 'http://localhost:9007/oidc/v1',
        path: '/oidc/v1',
      },
      request: {
        url: req.url,
        method: 'GET',
        protocol: 'https',
        hostname: 'id.example.test',
        originalUrl: '/error path?ignored=yes',
      },
      canonical_url: 'http://localhost:9007/error%20path',
      features: {
        oidc: true,
        deviceFlow: true,
        mfa: true,
        socialLogin: false,
        rateLimiting: true,
      },
      routes: {
        app: { auth: '/auth', accounts: '/accounts', api: '/api/v1' },
        authFull: { login: '/auth/login', recovery_sms: '/auth/recovery-sms' },
        accountFull: {
          dashboard: '/accounts/',
          settings_social: '/accounts/settings/social',
        },
        oidc: {
          authorization: '/oidc/auth',
          token: '/oidc/token',
        },
      },
    });
    expect(res.locals.webSafeFonts).toBe(WEB_SAFE_FONTS);
    expect(res.locals.currentYear).toBe(new Date().getFullYear());
    expect(next).toHaveBeenCalledOnce();
  });

  it('builds locale-aware UI routes while leaving API and OIDC routes unprefixed', () => {
    res.locals.localePrefix = '/fr';

    middleware.buildRoutes(req, res, next);

    expect(res.locals.routes).toMatchObject({
      app: {
        auth: '/fr/auth',
        accounts: '/fr/accounts',
        api: '/api/v1',
        home: '/fr/',
        oidc: config.oidc.path,
      },
      api: '/api/v1',
      authFull: {
        login: '/fr/auth/login',
        mfa_webauthn: '/fr/auth/mfa-webauthn',
        recovery_security_questions: '/fr/auth/recovery-security-questions',
      },
      accountFull: {
        accounts_base: '/fr/accounts',
        dashboard: '/fr/accounts/',
        update_notification_preferences:
          '/fr/accounts/update-notification-preferences',
        setup_webauthn: '/fr/accounts/setup-webauthn',
        settings_social: '/fr/accounts/settings/social',
      },
      oidc: {
        authorization: `${config.oidc.path}${config.oidc.routes.authorization}`,
        end_session: `${config.oidc.path}${config.oidc.routes.end_session}`,
        token: `${config.oidc.path}${config.oidc.routes.token}`,
      },
    });
    expect(Object.keys(res.locals.routes.authFull)).toHaveLength(28);
    expect(Object.keys(res.locals.routes.accountFull)).toHaveLength(36);
    expect(Object.keys(res.locals.routes.oidc)).toHaveLength(13);
    expect(next).toHaveBeenCalledOnce();
  });

  it('builds routes without a locale prefix when none is present', () => {
    middleware.buildRoutes(req, res, next);

    expect(res.locals.routes.app.auth).toBe('/auth');
    expect(res.locals.routes.authFull.login).toBe('/auth/login');
    expect(res.locals.routes.accountFull.dashboard).toBe('/accounts/');
    expect(next).toHaveBeenCalledOnce();
  });

  it('propagates route construction errors', () => {
    const error = new Error('routes unavailable');
    configManager.getConfig.mockImplementation(() => {
      throw error;
    });

    middleware.buildRoutes(req, res, next);

    expect(logger.error).toHaveBeenCalledWith(error, {
      context: 'error_building_routes',
    });
    expect(next).toHaveBeenCalledWith(error);
  });

  it('clears stale authentication and redirects unauthenticated requests', async () => {
    sessionManager.isAuthenticated.mockResolvedValue(false);

    await middleware.setAccountLocals(req, res, next);

    expect(sessionManager.clearAuthenticationData).toHaveBeenCalledWith(req);
    expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    expect(sessionManager.getActiveUser).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('uses the locale-aware login route when redirecting an unauthenticated request', async () => {
    sessionManager.isAuthenticated.mockResolvedValue(false);
    res.locals.routes = { authFull: { login: '/fr/auth/login' } };

    await middleware.setAccountLocals(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith('/fr/auth/login');
    expect(next).not.toHaveBeenCalled();
  });

  it('clears stale authentication when the active user is missing', async () => {
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue(undefined);
    res.locals.routes = { authFull: { login: '/fr/auth/login' } };

    await middleware.setAccountLocals(req, res, next);

    expect(sessionManager.clearAuthenticationData).toHaveBeenCalledWith(req);
    expect(res.redirect).toHaveBeenCalledWith('/fr/auth/login');
    expect(next).not.toHaveBeenCalled();
  });

  it('presents a verified administrator with an external avatar and multiple accounts', async () => {
    const lastUsed = new Date('2026-08-01T12:00:00.000Z');
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue({
      username: 'maria',
      full_name: 'Doctor Maria Doe With A Long Name',
      given_name: 'Maria',
      family_name: 'Doe',
      picture: 'https://images.example.test/maria.png',
      last_used: lastUsed,
      roles: ['admin', 'auditor'],
      is_admin: true,
      zoneinfo: 'Africa/Porto-Novo',
      email_verified: true,
    });
    sessionManager.getAuthenticatedUsers.mockReturnValue({
      active: { username: 'maria' },
      others: [{ username: 'other' }],
    });

    await middleware.setAccountLocals(req, res, next);

    expect(res.locals.user).toMatchObject({
      picture: 'https://images.example.test/maria.png',
      initials: 'MD',
      displayName: 'Doctor Maria Doe With A Long Name',
      sidebarName: 'Doctor Maria Do…',
      lastUsedFormatted: lastUsed.toLocaleString(),
      rolesList: 'admin, auditor',
      accountType: 'Administrator',
      hasProfilePicture: true,
      hasFullName: true,
      hasVerifiedEmail: true,
    });
    expect(res.locals.currentUser).toBe(res.locals.user);
    expect(res.locals.displayTimezone).toBe('Africa/Porto-Novo');
    expect(res.locals.hasMultipleAccounts).toBe(true);
    expect(res.locals.totalAccountsCount).toBe(2);
    expect(uploadMiddleware.getFileUrl).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('resolves a local avatar synchronously and derives a short name', async () => {
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue({
      username: 'maria',
      given_name: 'Maria',
      picture: 'tenant/avatar.png',
      roles: [],
      is_admin: false,
      email_verified: false,
    });
    sessionManager.getAuthenticatedUsers.mockReturnValue({
      active: undefined,
      others: [{ username: 'other' }],
    });

    await middleware.setAccountLocals(req, res, next);

    expect(res.locals.user).toMatchObject({
      picture: '/files/tenant/avatar.png',
      initials: 'M',
      displayName: 'Maria',
      sidebarName: 'Maria',
      lastUsedFormatted: 'Not available',
      rolesList: null,
      accountType: 'User',
      hasProfilePicture: true,
      hasFullName: true,
      hasVerifiedEmail: false,
    });
    expect(res.locals.displayTimezone).toBe('UTC');
    expect(res.locals.hasMultipleAccounts).toBe(false);
    expect(res.locals.totalAccountsCount).toBe(1);
    expect(next).toHaveBeenCalledOnce();
  });

  it('awaits asynchronous avatar resolution and falls back to the username', async () => {
    uploadMiddleware.getFileUrl.mockResolvedValue(
      'https://signed.example.test/avatar.png'
    );
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue({
      username: 'averylongusername',
      picture: '/uploads/avatar.png',
    });
    sessionManager.getAuthenticatedUsers.mockReturnValue(null);

    await middleware.setAccountLocals(req, res, next);

    expect(res.locals.user).toMatchObject({
      picture: 'https://signed.example.test/avatar.png',
      initials: 'AV',
      displayName: 'averylongusername',
      sidebarName: 'averylonguserna…',
      hasProfilePicture: true,
      hasFullName: false,
    });
    expect(res.locals.totalAccountsCount).toBe(0);
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects unsafe avatars and uses anonymous presentation fallbacks', async () => {
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue({
      picture: 'javascript:alert(1)',
      email_verified: undefined,
    });
    sessionManager.getAuthenticatedUsers.mockReturnValue(null);

    await middleware.setAccountLocals(req, res, next);

    expect(res.locals.user).toMatchObject({
      picture: null,
      initials: 'U',
      sidebarName: 'User',
      hasProfilePicture: false,
      hasFullName: false,
      hasVerifiedEmail: false,
    });
    expect(res.locals.user.displayName).toBeUndefined();
    expect(uploadMiddleware.getFileUrl).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('logs account-local failures and propagates them to fail closed', async () => {
    const error = new Error('session unavailable');
    sessionManager.isAuthenticated.mockRejectedValue(error);

    await middleware.setAccountLocals(req, res, next);

    expect(logger.error).toHaveBeenCalledWith(error, {
      context: 'error_in_user_locals_middleware_set_account_locals',
    });
    expect(next).toHaveBeenCalledWith(error);
  });

  it('sets the active page and continues', () => {
    middleware.setActivePage('settings-security')(req, res, next);

    expect(res.locals.activePage).toBe('settings-security');
    expect(next).toHaveBeenCalledOnce();
  });
});
