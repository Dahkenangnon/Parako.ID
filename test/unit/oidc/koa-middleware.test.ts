import path from 'node:path';
import type nunjucks from 'nunjucks';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDefaultFullConfig } from '../../../src/config/constants.js';

const mocks = vi.hoisted(() => ({
  addFilter: vi.fn(),
  configure: vi.fn(),
  configureNunjucks: vi.fn(),
  render: vi.fn(),
  resolveBrandingUrl: vi.fn(),
}));

vi.mock('nunjucks', () => ({
  default: {
    configure: mocks.configure,
  },
}));

vi.mock('../../../src/utils/views.js', () => ({
  configureNunjucks: mocks.configureNunjucks,
  resolveBrandingUrl: mocks.resolveBrandingUrl,
}));

import { KoaMiddleware } from '../../../src/oidc/flows/middleware/koa.middleware.js';

function createHarness(
  options: {
    environment?: 'development' | 'production' | 'test';
    customViewsEnabled?: boolean;
  } = {}
) {
  const persistedConfig = getDefaultFullConfig();
  const config = {
    ...persistedConfig,
    deployment: {
      ...persistedConfig.deployment,
      environment: options.environment ?? 'production',
    },
  };

  const nunjucksEnvironment = {
    addFilter: mocks.addFilter,
    render: mocks.render,
  } as unknown as nunjucks.Environment;
  mocks.configure.mockReturnValue(nunjucksEnvironment);
  mocks.resolveBrandingUrl.mockImplementation(
    (value: string, getFileUrl: (path: string) => string) => getFileUrl(value)
  );

  const configManager = {
    getConfig: vi.fn(() => config),
  };
  const viewResolver = {
    getCurrentConfig: vi.fn(() => ({
      enabled: options.customViewsEnabled ?? false,
      defaultViewsRoot: 'dist/src/views',
      customViewsRoot: 'runtime/views',
    })),
  };
  const fileSystemUtils = { rootDir: '/srv/parako' };
  const oidcUtils = { getLocale: vi.fn(() => 'fr') };
  const i18nService = {
    getLocale: vi.fn(() => 'en'),
    getLocales: vi.fn(() => ['en', 'fr']),
    setLocale: vi.fn(),
    __: vi.fn((phrase: string) => `translated:${phrase}`),
    __n: vi.fn((phrase: string, count: number) => `${phrase}:${count}`),
  };
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
  const socialLoginManager = {
    getAvailableProviders: vi.fn<() => string[]>(() => []),
  };
  const uploadMiddleware = {
    getFileUrl: vi.fn((value: string) => `file:${value}`),
  };

  const middleware = new KoaMiddleware(
    configManager as never,
    viewResolver as never,
    fileSystemUtils as never,
    oidcUtils as never,
    i18nService as never,
    logger as never,
    socialLoginManager as never,
    uploadMiddleware as never
  );

  return {
    config,
    configManager,
    i18nService,
    logger,
    middleware,
    oidcUtils,
    socialLoginManager,
    uploadMiddleware,
    viewResolver,
  };
}

function getRegisteredFilter(name: string): (...args: unknown[]) => unknown {
  const registration = mocks.addFilter.mock.calls.find(
    ([registeredName]) => registeredName === name
  );
  expect(
    registration,
    `expected ${name} filter to be registered`
  ).toBeDefined();
  return registration?.[1] as (...args: unknown[]) => unknown;
}

describe('KoaMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Nunjucks initialization', () => {
    it('prefers custom views and disables caching outside production', () => {
      const { logger } = createHarness({
        customViewsEnabled: true,
        environment: 'development',
      });

      const expectedViewDirectories = [
        path.join('/srv/parako', 'runtime/views'),
        path.join('/srv/parako', 'dist/src/views'),
      ];
      expect(mocks.configure).toHaveBeenCalledWith(expectedViewDirectories, {
        autoescape: true,
        noCache: true,
      });
      expect(mocks.configureNunjucks).toHaveBeenCalledWith(
        mocks.configure.mock.results[0]?.value
      );
      expect(mocks.addFilter.mock.calls.map(([name]) => name)).toEqual([
        'date',
        'numberFormat',
        'tojson',
        'kebabCase',
      ]);
      expect(logger.info).toHaveBeenCalledWith(
        `KoaMiddleware Nunjucks initialized with view directories: ${expectedViewDirectories.join(', ')}`,
        expect.objectContaining({
          context: 'koa_nunjucks_init',
          viewDirs: expectedViewDirectories,
        })
      );
    });

    it('formats dates and preserves invalid or unsupported date values', () => {
      createHarness();
      const date = getRegisteredFilter('date');
      const value = new Date(2024, 0, 2, 3, 4);

      expect(date(undefined)).toBe('');
      expect(date('not-a-date')).toBe('not-a-date');
      expect(date(value)).toBe('Jan 02, 2024');
      expect(date(value, 'MMM DD, YYYY HH:mm')).toBe('Jan 02, 2024 03:04');
      expect(date(value, 'unsupported')).toBe(value);
    });

    it('formats numbers while treating absent values as empty output', () => {
      createHarness();
      const numberFormat = getRegisteredFilter('numberFormat');

      expect(numberFormat(undefined)).toBe('');
      expect(numberFormat(null)).toBe('');
      expect(numberFormat(1_234_567)).toBe('1,234,567');
    });

    it('serializes JSON and contains circular-value failures', () => {
      const { logger } = createHarness();
      const tojson = getRegisteredFilter('tojson');
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      expect(tojson(undefined)).toBe('null');
      expect(tojson(null)).toBe('null');
      expect(tojson({ enabled: true })).toBe('{"enabled":true}');
      expect(tojson(circular)).toBe('null');
      expect(logger.error).toHaveBeenCalledWith(
        'Error serializing object to JSON in tojson filter: '
      );
    });

    it('normalizes camel-case identifiers and rejects non-string values', () => {
      createHarness();
      const kebabCase = getRegisteredFilter('kebabCase');

      expect(kebabCase(undefined)).toBe('');
      expect(kebabCase(42)).toBe('');
      expect(kebabCase('primaryForeground')).toBe('primary-foreground');
    });
  });

  describe('localization', () => {
    it('derives the request locale using the configured locale as fallback', () => {
      const { i18nService, middleware, oidcUtils } = createHarness();
      const ctx = { state: {} } as never;

      expect(middleware.getKoaLocale(ctx)).toBe('fr');
      expect(i18nService.getLocale).toHaveBeenCalledOnce();
      expect(oidcUtils.getLocale).toHaveBeenCalledWith(ctx, 'en');
    });

    it('installs translation helpers without requiring pre-existing state', async () => {
      const { i18nService, middleware } = createHarness();
      const ctx = {} as any;
      const next = vi.fn(async () => undefined);

      await middleware.i18nKoaInit(ctx, next);

      expect(ctx.t('welcome', 'Maria')).toBe('translated:welcome');
      expect(ctx.tn('attempt', 2, 'remaining')).toBe('attempt:2');
      expect(i18nService.__).toHaveBeenCalledWith('welcome', 'Maria');
      expect(i18nService.__n).toHaveBeenCalledWith('attempt', 2, 'remaining');
      expect(ctx.state).toMatchObject({ t: ctx.t, tn: ctx.tn });
      expect(next).toHaveBeenCalledOnce();
    });

    it('persists a supported language and exposes normalized locale state', async () => {
      const { config, i18nService, middleware } = createHarness();
      const cookies = { set: vi.fn() };
      const ctx = {
        cookies,
        originalUrl: '/oidc/v1/interaction/123?lang=fr',
        query: { lang: 'fr' },
        state: {},
      } as any;
      const next = vi.fn(async () => undefined);

      await middleware.koaLanguageHandler(ctx, next);

      expect(cookies.set).toHaveBeenCalledWith('locale', 'fr', {
        maxAge: config.deployment.cookies.types.locale.maxAge,
        httpOnly: config.deployment.cookies.types.locale.httpOnly,
        secure: config.deployment.cookies.types.locale.secure,
        sameSite: config.deployment.cookies.types.locale.sameSite,
      });
      expect(i18nService.setLocale).toHaveBeenCalledWith('fr');
      expect(ctx.state).toEqual({
        currentUrl: '/oidc/v1/interaction/123',
        locale: 'fr',
        locales: ['en', 'fr'],
      });
      expect(next).toHaveBeenCalledOnce();
    });

    it('does not persist unsupported languages and tolerates a missing URL', async () => {
      const { middleware } = createHarness();
      const cookies = { set: vi.fn() };
      const ctx = {
        cookies,
        query: { lang: 'de' },
      } as any;

      await middleware.koaLanguageHandler(ctx, async () => undefined);

      expect(cookies.set).not.toHaveBeenCalled();
      expect(ctx.state.currentUrl).toBe('');
    });

    it('installs full i18n state and disables OIDC debug off localhost', async () => {
      const { i18nService, middleware } = createHarness();
      const cookies = { set: vi.fn() };
      const ctx = {
        cookies,
        hostname: 'id.example.test',
        originalUrl: '/authorize?lang=fr',
        query: { lang: 'fr' },
        showOIDCDebug: true,
      } as any;

      await middleware.koaI18nMiddleware(ctx, async () => undefined);

      expect(ctx.state).toMatchObject({
        currentUrl: '/authorize',
        locale: 'fr',
        locales: ['en', 'fr'],
        t: ctx.t,
        tn: ctx.tn,
      });
      expect(ctx.t('continue')).toBe('translated:continue');
      expect(ctx.tn('device', 3)).toBe('device:3');
      expect(i18nService.setLocale).toHaveBeenCalledWith('fr');
      expect(cookies.set).toHaveBeenCalledOnce();
      expect(ctx.showOIDCDebug).toBe(false);
    });

    it('preserves an explicit debug flag on localhost', async () => {
      const { middleware } = createHarness();
      const ctx = {
        cookies: { set: vi.fn() },
        hostname: 'localhost',
        query: {},
        showOIDCDebug: true,
        state: {},
      } as any;

      await middleware.koaI18nMiddleware(ctx, async () => undefined);

      expect(ctx.showOIDCDebug).toBe(true);
      expect(ctx.state.currentUrl).toBe('');
    });
  });

  describe('template rendering', () => {
    it('maps production configuration into tenant-aware template locals', async () => {
      const { config, middleware, socialLoginManager, uploadMiddleware } =
        createHarness({ environment: 'development' });
      config.features.social_providers.enabled = ['github', 'microsoft'];
      config.security.authentication.login.login_methods = [
        'email',
        'phone_number',
        'custom_identifier_1',
      ];
      config.security.authentication.signup.signup_methods = ['email'];
      config.security.authentication.signup.contact_channels.full_name.required = false;
      config.security.authentication.signup.require_email_verification = true;
      config.security.authentication.signup.require_phone_verification = true;
      config.security.authentication.custom_identifiers = {
        enabled: true,
        fields: [
          {
            slot: 1,
            key: 'employee_id',
            name: 'Employee ID',
            hint_for_user: 'Use the ID on your badge',
            usable_for_login: true,
          },
          {
            slot: 2,
            key: 'internal_note',
            name: 'Internal note',
            hint_for_user: 'Not a login identifier',
            usable_for_login: false,
          },
        ] as typeof config.security.authentication.custom_identifiers.fields,
      };
      socialLoginManager.getAvailableProviders.mockReturnValue([
        'google',
        'github',
      ]);
      mocks.render.mockImplementation((_template, locals, callback) =>
        callback(null, JSON.stringify(locals))
      );
      const ctx = {
        cookies: { get: vi.fn(() => undefined) },
        locals: {},
        path: '/oidc/v1/interaction/123',
        query: {},
        req: {},
        state: {},
        url: '/oidc/v1/interaction/123',
      } as any;

      await middleware.renderMiddleware(ctx, async () => {
        await ctx.render('auth/oidc/consent.njk');
      });

      const renderedLocals = mocks.render.mock.calls[0]?.[1];
      expect(renderedLocals).toMatchObject({
        app: {
          title: config.application.title,
          url: config.deployment.url,
          env: 'development',
        },
        authentication: {
          loginMethods: {
            bothEnabled: true,
            customIdentifier: true,
            email: true,
            phone: true,
          },
          signupMethods: {
            bothEnabled: false,
            requireFullName: false,
          },
          customIdentifiers: [
            {
              slot: 1,
              key: 'employee_id',
              name: 'Employee ID',
              hint: 'Use the ID on your badge',
            },
          ],
          emailVerificationRequired: true,
          phoneVerificationRequired: true,
        },
        environment: 'development',
        isDevelopment: true,
        isProduction: false,
        oidc: {
          issuer: config.oidc.issuer,
          path: config.oidc.path,
        },
        routes: {
          authFull: {
            login: `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.login}`,
          },
          oidc: {
            authorization: `${config.oidc.path}${config.oidc.routes.authorization}`,
            end_session: `${config.oidc.path}${config.oidc.routes.end_session}`,
          },
        },
        socialProviders: {
          available: config.features.social_providers.available,
          enabled: ['github'],
        },
        userTheme: 'light',
      });
      expect(uploadMiddleware.getFileUrl).toHaveBeenCalled();
      expect(ctx.type).toBe('html');
      expect(ctx.body).toBe(JSON.stringify(renderedLocals));
    });

    it('uses safe defaults for sparse legacy template configuration', async () => {
      const { config, middleware } = createHarness();
      const sparseConfig = config as any;
      sparseConfig.branding.logoDark = '';
      sparseConfig.branding.logoIcon = '';
      sparseConfig.branding.logoIconDark = '';
      sparseConfig.branding.favicon = '';
      sparseConfig.branding.colors = undefined;
      sparseConfig.branding.fonts = undefined;
      sparseConfig.features.social_providers.enabled = undefined;
      sparseConfig.features.social_providers.available = undefined;
      sparseConfig.security.authentication.login.login_methods = [];
      sparseConfig.security.authentication.signup.contact_channels = undefined;
      sparseConfig.security.authentication.custom_identifiers = {
        enabled: true,
        fields: undefined,
      };
      mocks.render.mockImplementation((_template, _locals, callback) =>
        callback(null, 'rendered')
      );
      const ctx = {
        cookies: { get: vi.fn() },
        locals: {},
        path: '/interaction/123',
        query: {},
        req: {},
        state: {},
        url: '/interaction/123',
      } as any;

      await middleware.renderMiddleware(ctx, async () => {
        await ctx.render('auth/oidc/login.njk');
      });

      expect(mocks.render.mock.calls[0]?.[1]).toMatchObject({
        authentication: {
          customIdentifiers: [],
          loginMethods: {
            bothEnabled: false,
            customIdentifier: false,
            email: false,
            phone: false,
          },
          signupMethods: {
            requireFullName: true,
          },
        },
        branding: {
          colors: { light: {}, dark: {} },
          favicon: 'file:/favicon.png',
          fonts: {},
          logoDark: `file:${config.branding.logo}`,
          logoIcon: 'file:/images/logo-icon-light.png',
          logoIconDark: 'file:/images/logo-icon-dark.png',
        },
        socialProviders: {
          available: ['google', 'github', 'microsoft', 'linkedin', 'facebook'],
          enabled: [],
        },
      });
    });

    it('merges request state, flash messages, theme, and OIDC client metadata', async () => {
      const { middleware } = createHarness();
      const stateTranslation = vi.fn((key: string) => `state:${key}`);
      const requestTranslation = vi.fn((key: string) => `request:${key}`);
      const localTranslation = vi.fn((key: string) => `local:${key}`);
      const flashMessages = { success: ['Consent granted'] };
      const requestFlash = vi.fn(() => flashMessages);
      mocks.render.mockImplementation((_template, _locals, callback) =>
        callback(null, '<main>Consent</main>')
      );
      const ctx = {
        cookies: { get: vi.fn(() => 'dark') },
        flash: { error: ['unused'] },
        locals: {
          csrfToken: 'local-csrf',
          locale: 'en',
          locales: ['en'],
          t: localTranslation,
        },
        oidc: {
          client: {
            clientId: 'rp-client',
            clientName: 'Example RP',
            clientUri: 'https://rp.example.test',
            logoUri: 'https://rp.example.test/logo.svg',
            policyUri: 'https://rp.example.test/privacy',
            tosUri: 'https://rp.example.test/terms',
          },
        },
        path: '/oidc/v1/interaction/123',
        query: { prompt: 'consent' },
        req: { flash: requestFlash },
        state: {
          csrfToken: 'state-csrf',
          locale: 'fr',
          locales: ['fr', 'en'],
          t: stateTranslation,
        },
        t: requestTranslation,
        url: '/oidc/v1/interaction/123?prompt=consent',
      } as any;

      await middleware.renderMiddleware(ctx, async () => {
        await ctx.render('auth/oidc/consent.njk', { title: 'Authorize' });
      });

      const renderedLocals = mocks.render.mock.calls[0]?.[1];
      expect(renderedLocals).toMatchObject({
        client: {
          clientId: 'rp-client',
          clientName: 'Example RP',
          clientUri: 'https://rp.example.test',
          logoUri: 'https://rp.example.test/logo.svg',
          policyUri: 'https://rp.example.test/privacy',
          tosUri: 'https://rp.example.test/terms',
        },
        csrf_token: 'state-csrf',
        flash: flashMessages,
        htmlClass: 'dark',
        locale: 'fr',
        locales: ['fr', 'en'],
        path: ctx.path,
        query: ctx.query,
        t: stateTranslation,
        title: 'Authorize',
        url: ctx.url,
        userTheme: 'dark',
      });
      expect(requestFlash).toHaveBeenCalledOnce();
      expect(ctx.body).toBe('<main>Consent</main>');
    });

    it('uses context flash, local locale data, and request translation fallbacks', async () => {
      const { middleware } = createHarness();
      const requestTranslation = vi.fn((key: string) => `request:${key}`);
      mocks.render.mockImplementation((_template, _locals, callback) =>
        callback(null, 'rendered')
      );
      const ctx = {
        cookies: { get: vi.fn(() => 'light') },
        flash: { warning: ['Check this request'] },
        locals: {
          csrfToken: 'local-csrf',
          locale: 'en',
          locales: ['en', 'fr'],
        },
        path: '/interaction/123',
        query: {},
        req: {},
        state: {},
        t: requestTranslation,
        url: '/interaction/123',
      } as any;

      await middleware.renderMiddleware(ctx, async () => {
        await ctx.render('auth/oidc/login.njk');
      });

      expect(mocks.render.mock.calls[0]?.[1]).toMatchObject({
        csrf_token: 'local-csrf',
        flash: ctx.flash,
        htmlClass: '',
        locale: 'en',
        locales: ['en', 'fr'],
        t: requestTranslation,
        userTheme: 'light',
      });
    });

    it('falls back from context translation to local and identity translators', async () => {
      const { middleware } = createHarness();
      const localTranslation = vi.fn((key: string) => `local:${key}`);
      mocks.render.mockImplementation((_template, _locals, callback) =>
        callback(null, 'rendered')
      );
      const baseContext = {
        cookies: { get: vi.fn() },
        path: '/interaction/123',
        query: {},
        req: {},
        state: {},
        url: '/interaction/123',
      };
      const localContext = {
        ...baseContext,
        locals: { t: localTranslation },
      } as any;

      await middleware.renderMiddleware(localContext, async () => {
        await localContext.render('auth/oidc/login.njk');
      });
      const localLocals = mocks.render.mock.calls[0]?.[1];
      expect(localLocals.t).toBe(localTranslation);

      const identityContext = {
        ...baseContext,
        cookies: { get: vi.fn() },
        locals: {},
        state: {},
      } as any;
      await middleware.renderMiddleware(identityContext, async () => {
        await identityContext.render('auth/oidc/login.njk');
      });
      const identityLocals = mocks.render.mock.calls[1]?.[1];
      expect(identityLocals.t('untranslated.key')).toBe('untranslated.key');
    });

    it('rejects rendering failures without mutating the response', async () => {
      const { logger, middleware } = createHarness();
      const renderError = new Error('template syntax error');
      mocks.render.mockImplementation((_template, _locals, callback) =>
        callback(renderError)
      );
      const ctx = {
        cookies: { get: vi.fn() },
        locals: {},
        path: '/interaction/123',
        query: {},
        req: {},
        state: {},
        url: '/interaction/123',
      } as any;

      await expect(
        middleware.renderMiddleware(ctx, async () => {
          await ctx.render('auth/oidc/broken.njk');
        })
      ).rejects.toBe(renderError);
      expect(logger.error).toHaveBeenCalledWith('Template render error', {
        error: 'Error: template syntax error',
      });
      expect(ctx).not.toHaveProperty('type');
      expect(ctx).not.toHaveProperty('body');
    });
  });
});
