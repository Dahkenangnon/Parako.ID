import { afterEach, describe, expect, it, vi } from 'vitest';

describe('ViewResolver', () => {
  afterEach(() => {
    vi.doUnmock('node:fs');
    vi.doUnmock('node:url');
    vi.resetModules();
  });

  it('rejects custom view paths that escape the configured root', async () => {
    const readFileSync = vi.fn(() => '<p>outside template</p>');
    vi.doMock('node:fs', () => ({
      default: { readFileSync },
    }));
    const { ViewResolver } =
      await import('../../../src/utils/view-resolver.js');
    const configManager = {
      getConfig: vi.fn(() => ({
        branding: {
          ui: {
            customization: {
              enabled: true,
              rootPath: 'runtime/views',
              views: { auth: { login: '../../secrets/login' } },
            },
          },
        },
        deployment: { environment: 'production' },
      })),
    };
    const logger = { error: vi.fn(), info: vi.fn() };
    const resolver = new ViewResolver(
      configManager as never,
      logger as never,
      { rootDir: '/srv/parako' } as never
    );

    expect(resolver.views.auth.login).toBe('auth/login.njk');
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it('rejects custom view files whose canonical path escapes through a symlink', async () => {
    const readFileSync = vi.fn(() => '<p>outside template</p>');
    const realpathSync = vi.fn((filePath: string) =>
      filePath.endsWith('runtime/views')
        ? '/srv/parako/runtime/views'
        : '/srv/parako/secrets/login.njk'
    );
    vi.doMock('node:fs', () => ({
      default: { readFileSync, realpathSync },
    }));
    const { ViewResolver } =
      await import('../../../src/utils/view-resolver.js');
    const configManager = {
      getConfig: vi.fn(() => ({
        branding: {
          ui: {
            customization: {
              enabled: true,
              rootPath: 'runtime/views',
              views: { auth: { login: 'linked-login.njk' } },
            },
          },
        },
        deployment: { environment: 'production' },
      })),
    };
    const resolver = new ViewResolver(
      configManager as never,
      { error: vi.fn(), info: vi.fn() } as never,
      { rootDir: '/srv/parako' } as never
    );

    expect(resolver.views.auth.login).toBe('auth/login.njk');
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it('applies valid nested custom views while preserving unspecified defaults', async () => {
    const readFileSync = vi.fn(() => '<p>custom template</p>');
    vi.doMock('node:fs', () => ({
      default: { readFileSync, realpathSync: vi.fn((value: string) => value) },
    }));
    const { ViewResolver } =
      await import('../../../src/utils/view-resolver.js');
    const configManager = {
      getConfig: vi.fn(() => ({
        branding: {
          ui: {
            customization: {
              enabled: true,
              rootPath: 'runtime/views',
              views: {
                auth: {
                  login: 'custom/login.njk',
                  register: 'custom/register',
                  oidc: { consent: 'custom/oidc/consent' },
                  ignored: 42,
                },
                accounts: { my_account: 'custom/account' },
                errorpage: { unauthorized: 'custom/error-401' },
                email: { mail: 'custom/mail' },
                home: { index: 'custom/home' },
              },
            },
          },
        },
        deployment: { environment: 'production' },
      })),
    };
    const resolver = new ViewResolver(
      configManager as never,
      { error: vi.fn(), info: vi.fn() } as never,
      { rootDir: '/srv/parako' } as never
    );

    expect(resolver.views.auth.login).toBe('custom/login.njk');
    expect(resolver.views.auth.register).toBe('custom/register.njk');
    expect(resolver.views.auth.oidc.consent).toBe('custom/oidc/consent.njk');
    expect(resolver.views.auth.forgot_password).toBe(
      'auth/forgot-password.njk'
    );
    expect(resolver.views.accounts.my_account).toBe('custom/account.njk');
    expect(resolver.views.errors.unauthorized).toBe('custom/error-401.njk');
    expect(resolver.views.email.mail).toBe('custom/mail.njk');
    expect(resolver.views.home.index).toBe('custom/home.njk');
    expect(readFileSync).toHaveBeenCalledTimes(7);
  });

  it('exposes memoized built-in views and source-tree defaults without customization', async () => {
    const { ViewResolver } =
      await import('../../../src/utils/view-resolver.js');
    const configManager = {
      getConfig: vi.fn(() => ({
        deployment: { environment: 'development' },
      })),
    };
    const resolver = new ViewResolver(
      configManager as never,
      { error: vi.fn(), info: vi.fn() } as never,
      { rootDir: '/srv/parako' } as never
    );

    const views = resolver.views;
    expect(resolver.views).toBe(views);
    expect(views.auth.login).toBe('auth/login.njk');
    expect(views.auth.oidc.newDeviceVerify).toBe(
      'auth/oidc/new-device-verify.njk'
    );
    expect(views.accounts.passkeys).toBe('accounts/passkeys.njk');
    expect(views.errors.rate_limit).toBe('error/rate-limit-inline.njk');
    expect(views.email.mail).toBe('email/mail.njk');
    expect(views.home.index).toBe('home/index.njk');
    expect(resolver.getCurrentConfig()).toEqual({
      enabled: false,
      customViewsRoot: 'runtime/views',
      defaultViewsRoot: 'src/views',
      viewExtension: '.njk',
    });
  });

  it('falls back to built-in views when configuration loading fails', async () => {
    const { ViewResolver } =
      await import('../../../src/utils/view-resolver.js');
    const configError = new Error('configuration unavailable');
    const logger = { error: vi.fn(), info: vi.fn() };
    const resolver = new ViewResolver(
      {
        getConfig: vi.fn(() => {
          throw configError;
        }),
      } as never,
      logger as never,
      { rootDir: '/srv/parako' } as never
    );

    expect(resolver.views.auth.login).toBe('auth/login.njk');
    expect(resolver.getCurrentConfig()).toEqual({
      enabled: false,
      customViewsRoot: 'runtime/views',
      defaultViewsRoot: 'src/views',
      viewExtension: '.njk',
    });
    expect(logger.error).toHaveBeenCalledWith(configError, {
      context: 'view_keys_initialization_failed',
    });
    expect(logger.error).toHaveBeenCalledWith(configError, {
      context: 'view_resolver_config_load_failed',
    });
  });

  it('configures Express with custom views before defaults and development watching', async () => {
    const { ViewResolver } =
      await import('../../../src/utils/view-resolver.js');
    const configManager = {
      getConfig: vi.fn(() => ({
        branding: {
          ui: {
            customization: {
              enabled: true,
              rootPath: 'runtime/custom-views',
            },
          },
        },
        deployment: { environment: 'development' },
      })),
    };
    const logger = { error: vi.fn(), info: vi.fn() };
    const resolver = new ViewResolver(
      configManager as never,
      logger as never,
      { rootDir: '/srv/parako' } as never
    );
    const environment = { configured: true };
    const configure = vi.fn(() => environment);
    const app = { name: 'express-app' };
    void resolver.views;

    expect(
      resolver.configureExpressViews(app as never, { configure } as never)
    ).toBe(environment);
    expect(configure).toHaveBeenCalledWith(
      ['/srv/parako/runtime/custom-views', '/srv/parako/src/views'],
      {
        autoescape: true,
        express: app,
        watch: true,
      }
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining(
        'Express views configured: runtime/custom-views, src/views'
      ),
      { context: 'express_views_configuration' }
    );
  });

  it('logs and rethrows Nunjucks configuration failures in production', async () => {
    const { ViewResolver } =
      await import('../../../src/utils/view-resolver.js');
    const configManager = {
      getConfig: vi.fn(() => ({
        deployment: { environment: 'production' },
      })),
    };
    const logger = { error: vi.fn(), info: vi.fn() };
    const resolver = new ViewResolver(
      configManager as never,
      logger as never,
      { rootDir: '/srv/parako' } as never
    );
    const failure = new Error('Nunjucks unavailable');
    const configure = vi.fn(() => {
      throw failure;
    });
    const app = { name: 'express-app' };

    expect(() =>
      resolver.configureExpressViews(app as never, { configure } as never)
    ).toThrow(failure);
    expect(configure).toHaveBeenCalledWith(['/srv/parako/src/views'], {
      autoescape: true,
      express: app,
      watch: false,
    });
    expect(logger.error).toHaveBeenCalledWith(failure, {
      context: 'express_views_configuration_failed',
    });
  });

  it('rebuilds cached view keys when configuration is reloaded', async () => {
    vi.doMock('node:fs', () => ({
      default: {
        readFileSync: vi.fn(() => '<p>new login</p>'),
        realpathSync: vi.fn((value: string) => value),
      },
    }));
    const { ViewResolver } =
      await import('../../../src/utils/view-resolver.js');
    let currentConfig: any = {
      deployment: { environment: 'production' },
    };
    const logger = { error: vi.fn(), info: vi.fn() };
    const resolver = new ViewResolver(
      { getConfig: vi.fn(() => currentConfig) } as never,
      logger as never,
      { rootDir: '/srv/parako' } as never
    );
    expect(resolver.views.auth.login).toBe('auth/login.njk');

    currentConfig = {
      branding: {
        ui: {
          customization: {
            enabled: true,
            rootPath: 'runtime/views',
            views: { auth: { login: 'custom/reloaded-login' } },
          },
        },
      },
      deployment: { environment: 'production' },
    };
    resolver.reloadConfig();

    expect(resolver.views.auth.login).toBe('custom/reloaded-login.njk');
    expect(logger.info).toHaveBeenCalledWith(
      'View resolver configuration reloaded'
    );
  });

  it('accepts in-root view names that begin with two dots', async () => {
    const readFileSync = vi.fn(() => '<p>dot-prefixed view</p>');
    vi.doMock('node:fs', () => ({
      default: {
        readFileSync,
        realpathSync: vi.fn((value: string) => value),
      },
    }));
    const { ViewResolver } =
      await import('../../../src/utils/view-resolver.js');
    const resolver = new ViewResolver(
      {
        getConfig: vi.fn(() => ({
          branding: {
            ui: {
              customization: {
                enabled: true,
                rootPath: 'runtime/views',
                views: { auth: { login: '..custom/login' } },
              },
            },
          },
          deployment: { environment: 'production' },
        })),
      } as never,
      { error: vi.fn(), info: vi.fn() } as never,
      { rootDir: '/srv/parako' } as never
    );

    expect(resolver.views.auth.login).toBe('..custom/login.njk');
    expect(readFileSync).toHaveBeenCalledOnce();
  });

  it('ignores configured custom paths when customization is disabled', async () => {
    const readFileSync = vi.fn(() => '<p>custom</p>');
    vi.doMock('node:fs', () => ({
      default: {
        readFileSync,
        realpathSync: vi.fn((value: string) => value),
      },
    }));
    const { ViewResolver } =
      await import('../../../src/utils/view-resolver.js');
    const resolver = new ViewResolver(
      {
        getConfig: vi.fn(() => ({
          branding: {
            ui: {
              customization: {
                enabled: false,
                views: { auth: { login: 'custom/login' } },
              },
            },
          },
          deployment: { environment: 'production' },
        })),
      } as never,
      { error: vi.fn(), info: vi.fn() } as never,
      { rootDir: '/srv/parako' } as never
    );

    expect(resolver.views.auth.login).toBe('auth/login.njk');
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it('falls back for missing, empty, and unreadable custom templates', async () => {
    const realpathSync = vi.fn((value: string) => {
      if (value.includes('/missing/')) throw new Error('missing');
      return value;
    });
    const readFileSync = vi.fn((value: string) => {
      if (value.includes('/empty/')) return '   \n';
      throw new Error('unreadable');
    });
    vi.doMock('node:fs', () => ({
      default: { readFileSync, realpathSync },
    }));
    const { ViewResolver } =
      await import('../../../src/utils/view-resolver.js');
    const resolver = new ViewResolver(
      {
        getConfig: vi.fn(() => ({
          branding: {
            ui: {
              customization: {
                enabled: true,
                rootPath: 'runtime/views',
                views: {
                  auth: {
                    login: 'missing/login',
                    register: 'empty/register',
                    oidc: { consent: 'unreadable/consent' },
                  },
                },
              },
            },
          },
          deployment: { environment: 'production' },
        })),
      } as never,
      { error: vi.fn(), info: vi.fn() } as never,
      { rootDir: '/srv/parako' } as never
    );

    expect(resolver.views.auth.login).toBe('auth/login.njk');
    expect(resolver.views.auth.register).toBe('auth/register.njk');
    expect(resolver.views.auth.oidc.consent).toBe('auth/oidc/consent.njk');
  });

  it('ignores malformed sections and gives unknown keys deterministic fallbacks', async () => {
    vi.doMock('node:fs', () => ({
      default: {
        readFileSync: vi.fn(),
        realpathSync: vi.fn((value: string) => {
          if (value.endsWith('runtime/views')) return value;
          throw new Error('missing custom view');
        }),
      },
    }));
    const { ViewResolver } =
      await import('../../../src/utils/view-resolver.js');
    const resolver = new ViewResolver(
      {
        getConfig: vi.fn(() => ({
          branding: {
            ui: {
              customization: {
                enabled: true,
                views: {
                  auth: { unknown: 'missing/unknown', ignored: null },
                  accounts: 'invalid',
                  errorpage: 0,
                  email: null,
                  home: false,
                },
              },
            },
          },
          deployment: { environment: 'production' },
        })),
      } as never,
      { error: vi.fn(), info: vi.fn() } as never,
      { rootDir: '/srv/parako' } as never
    );

    const views = resolver.views;
    expect(views.auth.login).toBe('auth/login.njk');
    expect((views.auth as unknown as Record<string, string>).unknown).toBe(
      'auth.unknown.njk'
    );
    expect(views.accounts.my_account).toBe('accounts/my-account.njk');
    expect(views.errors.unauthorized).toBe('error/401.njk');
    expect(views.email.mail).toBe('email/mail.njk');
    expect(views.home.index).toBe('home/index.njk');
  });

  it('selects the correct default view root for dist deployment layouts', async () => {
    vi.doMock('node:url', () => ({
      fileURLToPath: vi.fn(() => '/srv/parako/dist/src/utils/view-resolver.js'),
    }));
    const { ViewResolver } =
      await import('../../../src/utils/view-resolver.js');
    const configManager = {
      getConfig: vi.fn(() => ({
        deployment: { environment: 'production' },
      })),
    };
    const logger = { error: vi.fn(), info: vi.fn() };

    expect(
      new ViewResolver(
        configManager as never,
        logger as never,
        { rootDir: '/srv/parako' } as never
      ).getCurrentConfig().defaultViewsRoot
    ).toBe('dist/src/views');
    expect(
      new ViewResolver(
        configManager as never,
        logger as never,
        { rootDir: '/srv/parako/dist' } as never
      ).getCurrentConfig().defaultViewsRoot
    ).toBe('src/views');
    expect(
      new ViewResolver(
        configManager as never,
        logger as never,
        { rootDir: 'C:\\parako\\dist' } as never
      ).getCurrentConfig().defaultViewsRoot
    ).toBe('src/views');
  });

  it('preserves dist view-root selection when configuration loading fails', async () => {
    vi.doMock('node:url', () => ({
      fileURLToPath: vi.fn(() => '/srv/parako/dist/src/utils/view-resolver.js'),
    }));
    const { ViewResolver } =
      await import('../../../src/utils/view-resolver.js');
    const configManager = {
      getConfig: vi.fn(() => {
        throw new Error('configuration unavailable');
      }),
    };
    const logger = { error: vi.fn(), info: vi.fn() };

    expect(
      new ViewResolver(
        configManager as never,
        logger as never,
        { rootDir: '/srv/parako' } as never
      ).getCurrentConfig().defaultViewsRoot
    ).toBe('dist/src/views');
    expect(
      new ViewResolver(
        configManager as never,
        logger as never,
        { rootDir: '/srv/parako/dist' } as never
      ).getCurrentConfig().defaultViewsRoot
    ).toBe('src/views');
    expect(
      new ViewResolver(
        configManager as never,
        logger as never,
        { rootDir: 'C:\\parako\\dist' } as never
      ).getCurrentConfig().defaultViewsRoot
    ).toBe('src/views');
  });
});
