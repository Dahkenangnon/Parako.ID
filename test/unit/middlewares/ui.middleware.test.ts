import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultFullConfig } from '../../../src/config/constants.js';
import { UIMiddleware } from '../../../src/middlewares/ui.middleware.js';
import { tenantContext } from '../../../src/multi-tenancy/tenant-context.js';

describe('UIMiddleware', () => {
  let config: ReturnType<typeof getDefaultFullConfig>;
  let configManager: { getConfig: ReturnType<typeof vi.fn> };
  let sessionManager: Record<string, ReturnType<typeof vi.fn>>;
  let logger: { error: ReturnType<typeof vi.fn> };
  let userService: Record<string, ReturnType<typeof vi.fn>>;
  let activityService: { success: ReturnType<typeof vi.fn> };
  let cookieManager: Record<string, ReturnType<typeof vi.fn>>;
  let i18nService: Record<string, ReturnType<typeof vi.fn>>;
  let middleware: UIMiddleware;
  let req: Request;
  let res: Response;
  let next: NextFunction;

  beforeEach(() => {
    config = getDefaultFullConfig();
    configManager = { getConfig: vi.fn(() => config) };
    sessionManager = {
      get: vi.fn((_req, key) => {
        if (key === 'userTheme') return 'light';
        if (key === 'sidebar_expanded') return true;
        if (key === 'userLocale') return 'en';
        return undefined;
      }),
      set: vi.fn(),
      isAuthenticated: vi.fn(),
      getActiveUser: vi.fn(),
      updateActiveUserData: vi.fn(),
    };
    logger = { error: vi.fn() };
    userService = {
      findByUsername: vi.fn(),
      updateProfile: vi.fn(),
    };
    activityService = { success: vi.fn() };
    cookieManager = {
      setThemeCookie: vi.fn(),
      setLocaleCookie: vi.fn(),
      getCookieConfig: vi.fn(() => ({ name: 'locale' })),
    };
    i18nService = {
      init: vi.fn(),
      getLocale: vi.fn(() => 'en'),
      getLocales: vi.fn(() => ['en', 'fr']),
      setLocale: vi.fn(),
    };
    middleware = new UIMiddleware(
      sessionManager as any,
      logger as any,
      userService as any,
      activityService as any,
      configManager as any,
      cookieManager as any,
      i18nService as any,
      { getFileUrl: vi.fn((key: string) => `/files/${key}`) } as any
    );
    req = {
      protocol: 'https',
      hostname: 'tenant.example.test',
      originalUrl: '/auth/login?continue=%2Faccounts',
      body: {},
      query: {},
      cookies: {},
      url: '/auth/login?continue=%2Faccounts',
      path: '/auth/login',
      ip: '203.0.113.10',
      socket: { remoteAddress: '203.0.113.11' },
      get: vi.fn((header: string) =>
        header === 'User-Agent' ? 'Example Browser' : undefined
      ),
      t: vi.fn((key: string) => key),
      acceptsLanguages: vi.fn(() => false),
    } as unknown as Request;
    res = {
      locals: { socialProviders: { enabled: ['github', 'google'] } },
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    next = vi.fn();
  });

  it('keeps usable tenant custom identifiers available to login templates', async () => {
    config.features.social_providers.enabled = ['github'];
    config.security.authentication.login.login_methods = [
      'email',
      'custom_identifier_1',
    ];
    config.security.authentication.custom_identifiers = {
      enabled: true,
      fields: [
        {
          slot: 1,
          key: 'member_id',
          name: 'Member ID',
          hint_for_user: 'Your membership number',
          usable_for_login: true,
          required: false,
          validation: {},
        },
        {
          slot: 2,
          key: 'hidden_id',
          name: 'Hidden ID',
          hint_for_user: 'Not available for login',
          usable_for_login: false,
          required: false,
          validation: {},
        },
      ],
    };

    await tenantContext.run('tenant-a', () =>
      middleware.setAllUILocals(req, res, next)
    );

    expect(res.locals.authentication.loginMethods).toMatchObject({
      customIdentifier: true,
      customIdentifiers: [
        {
          slot: 1,
          key: 'member_id',
          name: 'Member ID',
          hint: 'Your membership number',
        },
      ],
    });
    expect(res.locals.authentication.customIdentifiers).toEqual(
      res.locals.authentication.loginMethods.customIdentifiers
    );
    expect(res.locals.socialProviders.enabled).toEqual(['github']);
    expect(next).toHaveBeenCalledOnce();
  });

  it('uses a cached dark theme without querying authentication or storage', async () => {
    sessionManager.get.mockReturnValue('dark');

    await middleware.setThemeLocals(req, res, next);

    expect(res.locals).toMatchObject({ userTheme: 'dark', htmlClass: 'dark' });
    expect(sessionManager.isAuthenticated).not.toHaveBeenCalled();
    expect(userService.findByUsername).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('ignores an unsupported cached theme and uses the safe default', async () => {
    sessionManager.get.mockReturnValue('sepia');
    sessionManager.isAuthenticated.mockResolvedValue(false);

    await middleware.setThemeLocals(req, res, next);

    expect(res.locals).toMatchObject({ userTheme: 'light', htmlClass: '' });
  });

  it('loads and caches an authenticated user theme', async () => {
    sessionManager.get.mockReturnValue(undefined);
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue({ username: 'maria' });
    userService.findByUsername.mockResolvedValue({ theme: 'dark' });

    await middleware.setThemeLocals(req, res, next);

    expect(userService.findByUsername).toHaveBeenCalledWith('maria');
    expect(sessionManager.set).toHaveBeenCalledWith(req, 'userTheme', 'dark');
    expect(res.locals).toMatchObject({ userTheme: 'dark', htmlClass: 'dark' });
    expect(next).toHaveBeenCalledOnce();
  });

  it('replaces an unsupported stored user theme with the safe default', async () => {
    sessionManager.get.mockReturnValue(undefined);
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue({ username: 'maria' });
    userService.findByUsername.mockResolvedValue({ theme: 'sepia' });

    await middleware.setThemeLocals(req, res, next);

    expect(sessionManager.set).toHaveBeenCalledWith(req, 'userTheme', 'light');
    expect(res.locals).toMatchObject({ userTheme: 'light', htmlClass: '' });
  });

  it('uses and caches the light theme when the user has no stored preference', async () => {
    sessionManager.get.mockReturnValue(undefined);
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue({ username: 'maria' });
    userService.findByUsername.mockResolvedValue({});

    await middleware.setThemeLocals(req, res, next);

    expect(sessionManager.set).toHaveBeenCalledWith(req, 'userTheme', 'light');
    expect(res.locals).toMatchObject({ userTheme: 'light', htmlClass: '' });
  });

  it('uses the light theme when no active username is available', async () => {
    sessionManager.get.mockReturnValue(undefined);
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue({});

    await middleware.setThemeLocals(req, res, next);

    expect(userService.findByUsername).not.toHaveBeenCalled();
    expect(res.locals).toMatchObject({ userTheme: 'light', htmlClass: '' });
  });

  it('recovers from theme storage failures and caches the safe default', async () => {
    const error = new Error('database unavailable');
    sessionManager.get.mockReturnValue(undefined);
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue({ username: 'maria' });
    userService.findByUsername.mockRejectedValue(error);

    await middleware.setThemeLocals(req, res, next);

    expect(logger.error).toHaveBeenCalledWith(error, {
      context: 'error_loading_theme_from_database',
    });
    expect(sessionManager.set).toHaveBeenCalledWith(req, 'userTheme', 'light');
    expect(res.locals.userTheme).toBe('light');
    expect(next).toHaveBeenCalledOnce();
  });

  it('recovers from theme session failures', async () => {
    const error = new Error('session unavailable');
    sessionManager.get.mockImplementation(() => {
      throw error;
    });

    await middleware.setThemeLocals(req, res, next);

    expect(logger.error).toHaveBeenCalledWith(error, {
      context: 'error_setting_theme_locals',
    });
    expect(res.locals).toMatchObject({ userTheme: 'light', htmlClass: '' });
    expect(next).toHaveBeenCalledOnce();
  });

  it.each([undefined, 'system'])('rejects invalid theme %s', async theme => {
    req.body = { theme };

    await middleware.updateTheme(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Invalid theme value',
    });
    expect(sessionManager.set).not.toHaveBeenCalled();
  });

  it('updates an authenticated user theme and records the activity', async () => {
    req.body = { theme: 'dark' };
    sessionManager.getActiveUser.mockReturnValue({
      id: 'user-1',
      username: 'maria',
    });

    await middleware.updateTheme(req, res);

    expect(sessionManager.set).toHaveBeenCalledWith(req, 'userTheme', 'dark');
    expect(cookieManager.setThemeCookie).toHaveBeenCalledWith(res, 'dark');
    expect(userService.updateProfile).toHaveBeenCalledWith('user-1', {
      theme: 'dark',
    });
    expect(res.locals).toMatchObject({ userTheme: 'dark', htmlClass: 'dark' });
    expect(activityService.success).toHaveBeenCalledWith(
      'theme_changed',
      'User changed theme',
      null,
      expect.objectContaining({
        ip_address: '203.0.113.10',
        user_agent: 'Example Browser',
        actor: expect.objectContaining({ id: 'user-1', actor_type: 'user' }),
        target: {
          target_type: 'config',
          entity_data: { theme: 'dark' },
        },
      })
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, theme: 'dark' });
  });

  it('updates an anonymous theme locally without writing a user profile', async () => {
    req.body = { theme: 'light' };
    sessionManager.getActiveUser.mockReturnValue(undefined);

    await middleware.updateTheme(req, res);

    expect(userService.updateProfile).not.toHaveBeenCalled();
    expect(activityService.success).not.toHaveBeenCalled();
    expect(res.locals).toMatchObject({ userTheme: 'light', htmlClass: '' });
    expect(res.json).toHaveBeenCalledWith({ success: true, theme: 'light' });
  });

  it('sets light locals for an authenticated light-theme update', async () => {
    req.body = { theme: 'light' };
    sessionManager.getActiveUser.mockReturnValue({ id: 'user-1' });

    await middleware.updateTheme(req, res);

    expect(res.locals.htmlClass).toBe('');
  });

  it('sets dark locals for an anonymous dark-theme update', async () => {
    req.body = { theme: 'dark' };
    sessionManager.getActiveUser.mockReturnValue(undefined);

    await middleware.updateTheme(req, res);

    expect(res.locals.htmlClass).toBe('dark');
  });

  it('returns a server error when a theme update fails', async () => {
    const error = new Error('write failed');
    req.body = { theme: 'dark' };
    sessionManager.set.mockImplementation(() => {
      throw error;
    });

    await middleware.updateTheme(req, res);

    expect(logger.error).toHaveBeenCalledWith(error, {
      context: 'error_updating_theme',
    });
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Failed to update theme',
    });
  });

  it('does not apply an authenticated theme update when profile persistence fails', async () => {
    const error = new Error('database unavailable');
    req.body = { theme: 'dark' };
    sessionManager.getActiveUser.mockReturnValue({ id: 'user-1' });
    userService.updateProfile.mockRejectedValue(error);

    await middleware.updateTheme(req, res);

    expect(sessionManager.set).not.toHaveBeenCalled();
    expect(cookieManager.setThemeCookie).not.toHaveBeenCalled();
    expect(res.locals.userTheme).toBeUndefined();
    expect(activityService.success).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('uses a cached collapsed sidebar without querying authentication', async () => {
    sessionManager.get.mockReturnValue(false);

    await middleware.setSidebarLocals(req, res, next);

    expect(res.locals.sidebar_expanded).toBe(false);
    expect(sessionManager.isAuthenticated).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('ignores a non-boolean cached sidebar value and uses the safe default', async () => {
    sessionManager.get.mockReturnValue('false');
    sessionManager.isAuthenticated.mockResolvedValue(false);

    await middleware.setSidebarLocals(req, res, next);

    expect(res.locals.sidebar_expanded).toBe(true);
  });

  it('loads and caches an authenticated user sidebar preference', async () => {
    sessionManager.get.mockReturnValue(undefined);
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue({ username: 'maria' });
    userService.findByUsername.mockResolvedValue({ sidebar_expanded: false });

    await middleware.setSidebarLocals(req, res, next);

    expect(sessionManager.set).toHaveBeenCalledWith(
      req,
      'sidebar_expanded',
      false
    );
    expect(res.locals.sidebar_expanded).toBe(false);
  });

  it('ignores a non-boolean stored sidebar preference and caches the safe default', async () => {
    sessionManager.get.mockReturnValue(undefined);
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue({ username: 'maria' });
    userService.findByUsername.mockResolvedValue({
      sidebar_expanded: 'false',
    });

    await middleware.setSidebarLocals(req, res, next);

    expect(sessionManager.set).toHaveBeenCalledWith(
      req,
      'sidebar_expanded',
      true
    );
    expect(res.locals.sidebar_expanded).toBe(true);
  });

  it('defaults and caches the sidebar when storage has no preference', async () => {
    sessionManager.get.mockReturnValue(undefined);
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue({ username: 'maria' });
    userService.findByUsername.mockResolvedValue({});

    await middleware.setSidebarLocals(req, res, next);

    expect(sessionManager.set).toHaveBeenCalledWith(
      req,
      'sidebar_expanded',
      true
    );
    expect(res.locals.sidebar_expanded).toBe(true);
  });

  it('uses the sidebar default when no active username is available', async () => {
    sessionManager.get.mockReturnValue(undefined);
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue(null);

    await middleware.setSidebarLocals(req, res, next);

    expect(userService.findByUsername).not.toHaveBeenCalled();
    expect(res.locals.sidebar_expanded).toBe(true);
  });

  it('recovers from sidebar storage failures and caches the default', async () => {
    const error = new Error('database unavailable');
    sessionManager.get.mockReturnValue(undefined);
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue({ username: 'maria' });
    userService.findByUsername.mockRejectedValue(error);

    await middleware.setSidebarLocals(req, res, next);

    expect(logger.error).toHaveBeenCalledWith(error, {
      context: 'error_loading_sidebar_from_database',
    });
    expect(sessionManager.set).toHaveBeenCalledWith(
      req,
      'sidebar_expanded',
      true
    );
    expect(res.locals.sidebar_expanded).toBe(true);
  });

  it('recovers from sidebar session failures', async () => {
    const error = new Error('session unavailable');
    sessionManager.get.mockImplementation(() => {
      throw error;
    });

    await middleware.setSidebarLocals(req, res, next);

    expect(logger.error).toHaveBeenCalledWith(error, {
      context: 'error_setting_sidebar_locals',
    });
    expect(res.locals.sidebar_expanded).toBe(true);
    expect(next).toHaveBeenCalledOnce();
  });

  it.each([undefined, 'true', 1])(
    'rejects invalid sidebar state %s',
    async expanded => {
      req.body = { expanded };

      await middleware.updateSidebar(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid sidebar state value',
      });
    }
  );

  it('updates an authenticated sidebar preference and records the activity', async () => {
    req.body = { expanded: false };
    sessionManager.getActiveUser.mockReturnValue({
      id: 'user-1',
      username: 'maria',
    });

    await middleware.updateSidebar(req, res);

    expect(sessionManager.set).toHaveBeenCalledWith(
      req,
      'sidebar_expanded',
      false
    );
    expect(userService.updateProfile).toHaveBeenCalledWith('user-1', {
      sidebar_expanded: false,
    });
    expect(res.locals.sidebar_expanded).toBe(false);
    expect(activityService.success).toHaveBeenCalledWith(
      'sidebar_state_changed',
      'User changed sidebar state',
      null,
      expect.objectContaining({
        target: {
          target_type: 'config',
          entity_data: { expanded: false },
        },
      })
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, expanded: false });
  });

  it('updates an anonymous sidebar preference locally', async () => {
    req.body = { expanded: true };
    sessionManager.getActiveUser.mockReturnValue(undefined);

    await middleware.updateSidebar(req, res);

    expect(userService.updateProfile).not.toHaveBeenCalled();
    expect(res.locals.sidebar_expanded).toBe(true);
    expect(res.json).toHaveBeenCalledWith({ success: true, expanded: true });
  });

  it('returns a server error when a sidebar update fails', async () => {
    const error = new Error('write failed');
    req.body = { expanded: true };
    sessionManager.set.mockImplementation(() => {
      throw error;
    });

    await middleware.updateSidebar(req, res);

    expect(logger.error).toHaveBeenCalledWith(error, {
      context: 'error_updating_sidebar',
    });
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Failed to update sidebar state',
    });
  });

  it('does not apply an authenticated sidebar update when profile persistence fails', async () => {
    const error = new Error('database unavailable');
    req.body = { expanded: false };
    sessionManager.getActiveUser.mockReturnValue({ id: 'user-1' });
    userService.updateProfile.mockRejectedValue(error);

    await middleware.updateSidebar(req, res);

    expect(sessionManager.set).not.toHaveBeenCalled();
    expect(res.locals.sidebar_expanded).toBeUndefined();
    expect(activityService.success).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('uses a cached locale without querying authentication or storage', async () => {
    sessionManager.get.mockReturnValue('fr');

    await middleware.setLocaleLocals(req, res, next);

    expect(res.locals).toMatchObject({ userLocale: 'fr', currentLocale: 'fr' });
    expect(sessionManager.isAuthenticated).not.toHaveBeenCalled();
    expect(userService.findByUsername).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('ignores an unsupported cached locale and uses the configured default', async () => {
    config.application.locales.default = 'fr';
    config.application.locales.available = ['en', 'fr'];
    sessionManager.get.mockReturnValue('de');
    sessionManager.isAuthenticated.mockResolvedValue(false);

    await middleware.setLocaleLocals(req, res, next);

    expect(res.locals).toMatchObject({ userLocale: 'fr', currentLocale: 'fr' });
  });

  it('loads and caches an authenticated user locale', async () => {
    sessionManager.get.mockReturnValue(undefined);
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue({ username: 'maria' });
    userService.findByUsername.mockResolvedValue({ locale: 'fr' });

    await middleware.setLocaleLocals(req, res, next);

    expect(userService.findByUsername).toHaveBeenCalledWith('maria');
    expect(sessionManager.set).toHaveBeenCalledWith(req, 'userLocale', 'fr');
    expect(res.locals).toMatchObject({ userLocale: 'fr', currentLocale: 'fr' });
  });

  it('replaces a stored user locale that is no longer configured', async () => {
    config.application.locales.default = 'fr';
    config.application.locales.available = ['en', 'fr'];
    sessionManager.get.mockReturnValue(undefined);
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue({ username: 'maria' });
    userService.findByUsername.mockResolvedValue({ locale: 'de' });

    await middleware.setLocaleLocals(req, res, next);

    expect(sessionManager.set).toHaveBeenCalledWith(req, 'userLocale', 'fr');
    expect(res.locals).toMatchObject({ userLocale: 'fr', currentLocale: 'fr' });
  });

  it('caches the configured default when the user has no stored locale', async () => {
    config.application.locales.default = 'fr';
    sessionManager.get.mockReturnValue(undefined);
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue({ username: 'maria' });
    userService.findByUsername.mockResolvedValue({});

    await middleware.setLocaleLocals(req, res, next);

    expect(sessionManager.set).toHaveBeenCalledWith(req, 'userLocale', 'fr');
    expect(res.locals.currentLocale).toBe('fr');
  });

  it('uses the configured locale when no active username is available', async () => {
    config.application.locales.default = 'fr';
    sessionManager.get.mockReturnValue(undefined);
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue(null);

    await middleware.setLocaleLocals(req, res, next);

    expect(userService.findByUsername).not.toHaveBeenCalled();
    expect(res.locals.userLocale).toBe('fr');
  });

  it('recovers from locale storage failures and caches the configured default', async () => {
    const error = new Error('database unavailable');
    config.application.locales.default = 'fr';
    sessionManager.get.mockReturnValue(undefined);
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue({ username: 'maria' });
    userService.findByUsername.mockRejectedValue(error);

    await middleware.setLocaleLocals(req, res, next);

    expect(logger.error).toHaveBeenCalledWith(error, {
      context: 'error_loading_locale_from_database',
    });
    expect(sessionManager.set).toHaveBeenCalledWith(req, 'userLocale', 'fr');
    expect(res.locals.currentLocale).toBe('fr');
  });

  it('recovers from locale session failures', async () => {
    const error = new Error('session unavailable');
    config.application.locales.default = 'fr';
    sessionManager.get.mockImplementation(() => {
      throw error;
    });

    await middleware.setLocaleLocals(req, res, next);

    expect(logger.error).toHaveBeenCalledWith(error, {
      context: 'error_setting_locale_locals',
    });
    expect(res.locals).toMatchObject({ userLocale: 'fr', currentLocale: 'fr' });
    expect(next).toHaveBeenCalledOnce();
  });

  it.each([undefined, 'de'])('rejects unavailable locale %s', async locale => {
    config.application.locales.available = ['en', 'fr'];
    req.body = { locale };

    await middleware.updateLocale(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Invalid locale value',
    });
    expect(sessionManager.set).not.toHaveBeenCalled();
  });

  it('updates and persists an authenticated user locale', async () => {
    config.application.locales.available = ['en', 'fr'];
    req.body = { locale: 'fr' };
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue({
      id: 'user-1',
      username: 'maria',
    });

    await middleware.updateLocale(req, res);

    expect(sessionManager.set).toHaveBeenCalledWith(req, 'userLocale', 'fr');
    expect(cookieManager.setLocaleCookie).toHaveBeenCalledWith(res, 'fr');
    expect(userService.updateProfile).toHaveBeenCalledWith('user-1', {
      locale: 'fr',
    });
    expect(res.locals).toMatchObject({ userLocale: 'fr', currentLocale: 'fr' });
    expect(activityService.success).toHaveBeenCalledWith(
      'locale_changed',
      'User changed locale',
      null,
      expect.objectContaining({
        target: { target_type: 'config', entity_data: { locale: 'fr' } },
      })
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, locale: 'fr' });
  });

  it.each([
    { authenticated: false, user: undefined },
    { authenticated: true, user: {} },
  ])(
    'updates locale locally without a persistable user: $authenticated',
    async scenario => {
      config.application.locales.available = ['en', 'fr'];
      req.body = { locale: 'fr' };
      sessionManager.isAuthenticated.mockResolvedValue(scenario.authenticated);
      sessionManager.getActiveUser.mockReturnValue(scenario.user);

      await middleware.updateLocale(req, res);

      expect(userService.updateProfile).not.toHaveBeenCalled();
      expect(activityService.success).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true, locale: 'fr' });
    }
  );

  it('returns a server error when a locale update fails', async () => {
    const error = new Error('write failed');
    config.application.locales.available = ['en', 'fr'];
    req.body = { locale: 'fr' };
    sessionManager.set.mockImplementation(() => {
      throw error;
    });

    await middleware.updateLocale(req, res);

    expect(logger.error).toHaveBeenCalledWith(error, {
      context: 'error_updating_locale',
    });
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Failed to update locale',
    });
  });

  it('does not apply an authenticated locale update when profile persistence fails', async () => {
    const error = new Error('database unavailable');
    config.application.locales.available = ['en', 'fr'];
    req.body = { locale: 'fr' };
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue({ id: 'user-1' });
    userService.updateProfile.mockRejectedValue(error);

    await middleware.updateLocale(req, res);

    expect(sessionManager.set).not.toHaveBeenCalled();
    expect(cookieManager.setLocaleCookie).not.toHaveBeenCalled();
    expect(res.locals.userLocale).toBeUndefined();
    expect(activityService.success).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it.each([undefined, 42])('rejects malformed timezone %s', async timezone => {
    req.body = { timezone };

    await middleware.updateTimezone(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Invalid timezone value',
    });
  });

  it('rejects an unknown timezone identifier', async () => {
    req.body = { timezone: 'Mars/Olympus_Mons' };

    await middleware.updateTimezone(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Invalid timezone identifier',
    });
  });

  it('requires authentication before updating a timezone', async () => {
    req.body = { timezone: 'Africa/Porto-Novo' };
    sessionManager.isAuthenticated.mockResolvedValue(false);

    await middleware.updateTimezone(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Authentication required',
    });
  });

  it('requires an active user before updating a timezone', async () => {
    req.body = { timezone: 'Africa/Porto-Novo' };
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue({});

    await middleware.updateTimezone(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'User not found',
    });
  });

  it('updates an authenticated user timezone and active session data', async () => {
    req.body = { timezone: 'Africa/Porto-Novo' };
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue({
      id: 'user-1',
      username: 'maria',
    });

    await middleware.updateTimezone(req, res);

    expect(userService.updateProfile).toHaveBeenCalledWith('user-1', {
      zoneinfo: 'Africa/Porto-Novo',
    });
    expect(sessionManager.updateActiveUserData).toHaveBeenCalledWith(req, {
      zoneinfo: 'Africa/Porto-Novo',
    });
    expect(activityService.success).toHaveBeenCalledWith(
      'timezone_changed',
      'User changed timezone',
      null,
      expect.objectContaining({
        target: {
          target_type: 'config',
          entity_data: { timezone: 'Africa/Porto-Novo' },
        },
      })
    );
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      timezone: 'Africa/Porto-Novo',
    });
  });

  it('returns a server error when a timezone update fails', async () => {
    const error = new Error('write failed');
    req.body = { timezone: 'Africa/Porto-Novo' };
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue({ id: 'user-1' });
    userService.updateProfile.mockRejectedValue(error);

    await middleware.updateTimezone(req, res);

    expect(logger.error).toHaveBeenCalledWith(error, {
      context: 'error_updating_timezone',
    });
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Failed to update timezone',
    });
  });

  it('describes configured locales and falls back for unknown locale codes', () => {
    config.application.locales.available = ['en', 'fr', 'yo'];

    expect(middleware.getAvailableLocales()).toEqual([
      { code: 'en', flag: '🇺🇸', label: 'English' },
      { code: 'fr', flag: '🇫🇷', label: 'Français' },
      { code: 'yo', flag: '🌐', label: 'YO' },
    ]);
  });

  it('uses default locales when the configured value is malformed', () => {
    config.application.locales.available = null as any;

    const locales = middleware.getAvailableLocales();

    expect(locales.length).toBeGreaterThan(0);
    expect(locales[0]).toEqual({ code: 'en', flag: '🇺🇸', label: 'English' });
  });

  it('delegates i18n initialization', () => {
    i18nService.init.mockImplementation((_req, _res, done) => done());

    middleware.initI18n(req, res, next);

    expect(i18nService.init).toHaveBeenCalledWith(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('recovers when i18n initialization throws', () => {
    const error = new Error('i18n unavailable');
    i18nService.init.mockImplementation(() => {
      throw error;
    });

    middleware.initI18n(req, res, next);

    expect(logger.error).toHaveBeenCalledWith(error, {
      context: 'error_initializing_i18n',
    });
    expect(next).toHaveBeenCalledOnce();
  });

  it.each([
    ['ui_locales', 'fr'],
    ['locale', 'fr'],
    ['lang', 'fr'],
    ['hl', 'fr'],
    ['l', 'fr'],
  ])(
    'selects a valid %s query locale without persisting it',
    (parameter, locale) => {
      config.application.locales.available = ['en', 'fr'];
      req.query = { [parameter]: locale };

      middleware.handleLanguage(req, res, next);

      expect(i18nService.setLocale).toHaveBeenCalledWith(req, 'fr');
      expect(res.locals).toMatchObject({
        detectedLocale: 'fr',
        currentLocale: 'fr',
        localeSource: 'query',
        localePrefix: '',
      });
      expect(sessionManager.set).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    }
  );

  it('selects the first supported locale from an OIDC ui_locales preference list', () => {
    config.application.locales.available = ['en', 'fr'];
    req.query = { ui_locales: 'de fr en' };

    middleware.handleLanguage(req, res, next);

    expect(i18nService.setLocale).toHaveBeenCalledWith(req, 'fr');
    expect(res.locals.localeSource).toBe('query');
  });

  it('gives the query locale priority while preserving the path prefix', () => {
    config.application.locales.available = ['en', 'fr'];
    req.query = { ui_locales: 'fr' };
    req.originalUrl = '/en/auth/login?ui_locales=fr';

    middleware.handleLanguage(req, res, next);

    expect(i18nService.setLocale).toHaveBeenCalledWith(req, 'fr');
    expect(res.locals.localeSource).toBe('query');
    expect(res.locals.localePrefix).toBe('/en');
  });

  it('uses a locale previously extracted from the path', () => {
    config.application.locales.available = ['en', 'fr'];
    (req as any).extractedLocale = 'fr';

    middleware.handleLanguage(req, res, next);

    expect(i18nService.setLocale).toHaveBeenCalledWith(req, 'fr');
    expect(res.locals).toMatchObject({
      localeSource: 'path',
      localePrefix: '/fr',
    });
  });

  it('parses a path locale when the extractor has not run', () => {
    config.application.locales.available = ['en', 'fr'];
    req.originalUrl = '/fr/accounts?tab=security';

    middleware.handleLanguage(req, res, next);

    expect(i18nService.setLocale).toHaveBeenCalledWith(req, 'fr');
    expect(res.locals).toMatchObject({
      localeSource: 'path',
      localePrefix: '/fr',
    });
  });

  it.each([
    {
      name: 'session',
      session: 'fr',
      cookie: 'en',
      accepted: 'en',
      expected: 'fr',
      source: 'session',
    },
    {
      name: 'cookie',
      session: undefined,
      cookie: 'fr',
      accepted: 'en',
      expected: 'fr',
      source: 'cookie',
    },
    {
      name: 'user-agent',
      session: undefined,
      cookie: undefined,
      accepted: 'fr',
      expected: 'fr',
      source: 'user-agent',
    },
  ])('uses the $name locale source in priority order', scenario => {
    config.application.locales.available = ['en', 'fr'];
    sessionManager.get.mockReturnValue(scenario.session);
    req.cookies = { locale: scenario.cookie };
    vi.mocked(req.acceptsLanguages).mockReturnValue(scenario.accepted as any);

    middleware.handleLanguage(req, res, next);

    expect(i18nService.setLocale).toHaveBeenCalledWith(req, scenario.expected);
    expect(res.locals.localeSource).toBe(scenario.source);
  });

  it('ignores unsupported session and cookie locales before user-agent detection', () => {
    config.application.locales.available = ['en', 'fr'];
    sessionManager.get.mockReturnValue('de');
    req.cookies = { locale: 'it' };
    vi.mocked(req.acceptsLanguages).mockReturnValue('fr');

    middleware.handleLanguage(req, res, next);

    expect(i18nService.setLocale).toHaveBeenCalledWith(req, 'fr');
    expect(res.locals.localeSource).toBe('user-agent');
  });

  it('uses the i18n locale before the configured default', () => {
    config.application.locales.default = 'fr';
    config.application.locales.available = ['en', 'fr'];
    sessionManager.get.mockReturnValue(undefined);
    cookieManager.getCookieConfig.mockReturnValue({ name: '' });
    vi.mocked(req.acceptsLanguages).mockReturnValue(false);
    i18nService.getLocale.mockReturnValue('en');

    middleware.handleLanguage(req, res, next);

    expect(i18nService.setLocale).toHaveBeenCalledWith(req, 'en');
    expect(res.locals.localeSource).toBe('default');
  });

  it('ignores an unsupported i18n locale and uses the configured default', () => {
    config.application.locales.default = 'fr';
    config.application.locales.available = ['en', 'fr'];
    sessionManager.get.mockReturnValue(undefined);
    cookieManager.getCookieConfig.mockReturnValue({ name: '' });
    vi.mocked(req.acceptsLanguages).mockReturnValue(false);
    i18nService.getLocale.mockReturnValue('de');

    middleware.handleLanguage(req, res, next);

    expect(i18nService.setLocale).toHaveBeenCalledWith(req, 'fr');
    expect(res.locals.localeSource).toBe('default');
  });

  it('uses the configured default when no language source resolves', () => {
    config.application.locales.default = 'fr';
    config.application.locales.available = ['en', 'fr'];
    sessionManager.get.mockReturnValue(undefined);
    cookieManager.getCookieConfig.mockReturnValue({ name: '' });
    vi.mocked(req.acceptsLanguages).mockReturnValue(['en'] as any);
    i18nService.getLocale.mockReturnValue(undefined);
    req.originalUrl = '';
    req.url = '';
    Object.defineProperty(req, 'path', { configurable: true, value: '' });

    middleware.handleLanguage(req, res, next);

    expect(i18nService.setLocale).toHaveBeenCalledWith(req, 'fr');
    expect(res.locals).toMatchObject({
      localeSource: 'default',
      localePrefix: '',
    });
  });

  it('ignores invalid query, extracted, and first-path locale candidates', () => {
    config.application.locales.available = ['en', 'fr'];
    req.query = { ui_locales: 'de', locale: 'fr' };
    (req as any).extractedLocale = 'de';
    req.originalUrl = '/de/accounts';

    middleware.handleLanguage(req, res, next);

    expect(i18nService.setLocale).toHaveBeenCalledWith(req, 'fr');
    expect(res.locals.localeSource).toBe('query');
    expect(res.locals.localePrefix).toBe('');
  });

  it('recovers language handling with the configured default', () => {
    const error = new Error('cookie configuration failed');
    config.application.locales.default = 'fr';
    cookieManager.getCookieConfig.mockImplementation(() => {
      throw error;
    });

    middleware.handleLanguage(req, res, next);

    expect(logger.error).toHaveBeenCalledWith(error, {
      context: 'error_handling_language',
    });
    expect(i18nService.setLocale).toHaveBeenCalledWith(req, 'fr');
    expect(res.locals.localePrefix).toBe('');
    expect(next).toHaveBeenCalledOnce();
  });

  it('adds request-bound i18n helpers and normalizes non-string translations', () => {
    const tn = vi.fn(() => 'items');
    (req as any).tn = tn;
    req.t = vi.fn((key: string) =>
      key === 'object' ? { key } : `translated:${key}`
    ) as any;

    middleware.addI18nHelpers(req, res, next);

    expect(res.locals.locale).toBe('en');
    expect(res.locals.locales).toEqual(['en', 'fr']);
    expect(res.locals.currentUrl).toBe('/auth/login');
    expect(res.locals.t('welcome')).toBe('translated:welcome');
    expect(res.locals.t('object')).toBe('object');
    expect(res.locals.tn).toBeTypeOf('function');
    expect(res.locals.tn('item', 'items', 2)).toBe('items');
    expect(res.locals.getAvailableLocales()).toEqual(
      middleware.getAvailableLocales()
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it.each([
    { t: undefined, tn: undefined },
    { t: 'not-a-function', tn: vi.fn() },
  ])(
    'adds safe fallback helpers when request translation is unavailable',
    scenario => {
      (req as any).t = scenario.t;
      (req as any).tn = scenario.tn;

      middleware.addI18nHelpers(req, res, next);

      expect(res.locals.t('welcome')).toBe('welcome');
      expect(res.locals.tn).toBeNull();
      expect(next).toHaveBeenCalledOnce();
    }
  );

  it('sets a null plural helper when only request translation is available', () => {
    (req as any).tn = undefined;

    middleware.addI18nHelpers(req, res, next);

    expect(res.locals.tn).toBeNull();
  });

  it('recovers with configured i18n helper defaults', () => {
    const error = new Error('locale lookup failed');
    config.application.locales.default = 'fr';
    config.application.locales.available = ['en', 'fr'];
    i18nService.getLocale.mockImplementation(() => {
      throw error;
    });

    middleware.addI18nHelpers(req, res, next);

    expect(logger.error).toHaveBeenCalledWith(error, {
      context: 'error_adding_i18n_helpers',
    });
    expect(res.locals.t('welcome')).toBe('welcome');
    expect(res.locals).toMatchObject({
      tn: null,
      locale: 'fr',
      locales: ['en', 'fr'],
      currentUrl: '/auth/login',
    });
    expect(next).toHaveBeenCalledOnce();
  });

  it('loads all missing UI preferences with one authenticated-user query', async () => {
    sessionManager.get.mockReturnValue(undefined);
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue({ username: 'maria' });
    userService.findByUsername.mockResolvedValue({
      theme: 'dark',
      sidebar_expanded: false,
      locale: 'fr',
    });

    await middleware.setAllUILocals(req, res, next);

    expect(userService.findByUsername).toHaveBeenCalledOnce();
    expect(userService.findByUsername).toHaveBeenCalledWith('maria');
    expect(sessionManager.set).toHaveBeenCalledWith(req, 'userTheme', 'dark');
    expect(sessionManager.set).toHaveBeenCalledWith(
      req,
      'sidebar_expanded',
      false
    );
    expect(sessionManager.set).toHaveBeenCalledWith(req, 'userLocale', 'fr');
    expect(res.locals).toMatchObject({
      userTheme: 'dark',
      htmlClass: 'dark',
      sidebar_expanded: false,
      userLocale: 'fr',
      currentLocale: 'fr',
    });
    expect(next).toHaveBeenCalledOnce();
  });

  it('fills missing database preferences with safe configured defaults', async () => {
    config.application.locales.default = 'fr';
    sessionManager.get.mockReturnValue(undefined);
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue({ username: 'maria' });
    userService.findByUsername.mockResolvedValue({});

    await middleware.setAllUILocals(req, res, next);

    expect(sessionManager.set).toHaveBeenCalledWith(req, 'userTheme', 'light');
    expect(sessionManager.set).toHaveBeenCalledWith(
      req,
      'sidebar_expanded',
      true
    );
    expect(sessionManager.set).toHaveBeenCalledWith(req, 'userLocale', 'fr');
    expect(res.locals).toMatchObject({
      userTheme: 'light',
      sidebar_expanded: true,
      userLocale: 'fr',
    });
  });

  it('replaces invalid combined database preferences with safe configured defaults', async () => {
    config.application.locales.default = 'fr';
    config.application.locales.available = ['en', 'fr'];
    sessionManager.get.mockReturnValue(undefined);
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue({ username: 'maria' });
    userService.findByUsername.mockResolvedValue({
      theme: 'sepia',
      sidebar_expanded: 'false',
      locale: 'de',
    });

    await middleware.setAllUILocals(req, res, next);

    expect(sessionManager.set).toHaveBeenCalledWith(req, 'userTheme', 'light');
    expect(sessionManager.set).toHaveBeenCalledWith(
      req,
      'sidebar_expanded',
      true
    );
    expect(sessionManager.set).toHaveBeenCalledWith(req, 'userLocale', 'fr');
    expect(res.locals).toMatchObject({
      userTheme: 'light',
      sidebar_expanded: true,
      userLocale: 'fr',
    });
  });

  it.each([
    { user: null, dbUser: undefined },
    { user: {}, dbUser: undefined },
    { user: { username: 'maria' }, dbUser: null },
  ])(
    'uses safe locals when authenticated preference data is unavailable',
    async scenario => {
      sessionManager.get.mockReturnValue(undefined);
      sessionManager.isAuthenticated.mockResolvedValue(true);
      sessionManager.getActiveUser.mockReturnValue(scenario.user);
      userService.findByUsername.mockResolvedValue(scenario.dbUser);

      await middleware.setAllUILocals(req, res, next);

      expect(res.locals).toMatchObject({
        userTheme: 'light',
        htmlClass: '',
        sidebar_expanded: true,
        userLocale: config.application.locales.default,
      });
      expect(next).toHaveBeenCalledOnce();
    }
  );

  it('keeps rendering safe locals when the optimized database lookup fails', async () => {
    const error = new Error('database unavailable');
    sessionManager.get.mockReturnValue(undefined);
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue({ username: 'maria' });
    userService.findByUsername.mockRejectedValue(error);

    await middleware.setAllUILocals(req, res, next);

    expect(logger.error).toHaveBeenCalledWith(error, {
      context: 'error_loading_ui_prefs_from_database',
    });
    expect(res.locals).toMatchObject({
      userTheme: 'light',
      sidebar_expanded: true,
      userLocale: config.application.locales.default,
    });
    expect(next).toHaveBeenCalledOnce();
  });

  it('does not query authentication when all UI preferences are cached', async () => {
    sessionManager.get.mockImplementation(
      (_request, key) =>
        (
          ({
            userTheme: 'dark',
            sidebar_expanded: false,
            userLocale: 'fr',
          }) as Record<string, unknown>
        )[String(key)]
    );

    await middleware.setAllUILocals(req, res, next);

    expect(sessionManager.isAuthenticated).not.toHaveBeenCalled();
    expect(userService.findByUsername).not.toHaveBeenCalled();
    expect(res.locals).toMatchObject({
      userTheme: 'dark',
      sidebar_expanded: false,
      userLocale: 'fr',
    });
  });

  it('uses safe defaults for invalid combined cached preferences', async () => {
    config.application.locales.default = 'fr';
    config.application.locales.available = ['en', 'fr'];
    sessionManager.get.mockImplementation(
      (_request, key) =>
        (
          ({
            userTheme: 'sepia',
            sidebar_expanded: 'false',
            userLocale: 'de',
          }) as Record<string, unknown>
        )[String(key)]
    );
    sessionManager.isAuthenticated.mockResolvedValue(false);

    await middleware.setAllUILocals(req, res, next);

    expect(res.locals).toMatchObject({
      userTheme: 'light',
      htmlClass: '',
      sidebar_expanded: true,
      userLocale: 'fr',
      currentLocale: 'fr',
    });
  });

  it('does not query storage for missing anonymous UI preferences', async () => {
    sessionManager.get.mockReturnValue(undefined);
    sessionManager.isAuthenticated.mockResolvedValue(false);

    await middleware.setAllUILocals(req, res, next);

    expect(sessionManager.isAuthenticated).toHaveBeenCalledWith(req);
    expect(userService.findByUsername).not.toHaveBeenCalled();
    expect(res.locals).toMatchObject({
      userTheme: 'light',
      sidebar_expanded: true,
      userLocale: config.application.locales.default,
    });
  });

  it('preserves cached theme and sidebar while filling only the missing locale', async () => {
    sessionManager.get.mockImplementation(
      (_request, key) =>
        (
          ({
            userTheme: 'dark',
            sidebar_expanded: false,
            userLocale: undefined,
          }) as Record<string, unknown>
        )[String(key)]
    );
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue({ username: 'maria' });
    userService.findByUsername.mockResolvedValue({
      theme: 'light',
      sidebar_expanded: true,
      locale: 'fr',
    });

    await middleware.setAllUILocals(req, res, next);

    expect(sessionManager.set).toHaveBeenCalledTimes(1);
    expect(sessionManager.set).toHaveBeenCalledWith(req, 'userLocale', 'fr');
    expect(res.locals).toMatchObject({
      userTheme: 'dark',
      sidebar_expanded: false,
      userLocale: 'fr',
    });
  });

  it('preserves cached sidebar and locale while filling only the missing theme', async () => {
    sessionManager.get.mockImplementation(
      (_request, key) =>
        (
          ({
            userTheme: undefined,
            sidebar_expanded: false,
            userLocale: 'fr',
          }) as Record<string, unknown>
        )[String(key)]
    );
    sessionManager.isAuthenticated.mockResolvedValue(true);
    sessionManager.getActiveUser.mockReturnValue({ username: 'maria' });
    userService.findByUsername.mockResolvedValue({ theme: 'dark' });

    await middleware.setAllUILocals(req, res, next);

    expect(sessionManager.set).toHaveBeenCalledTimes(1);
    expect(sessionManager.set).toHaveBeenCalledWith(req, 'userTheme', 'dark');
    expect(res.locals).toMatchObject({
      userTheme: 'dark',
      sidebar_expanded: false,
      userLocale: 'fr',
    });
  });

  it.each([
    {
      label: 'socket address',
      socket: { remoteAddress: '198.51.100.20' },
      expectedIp: '198.51.100.20',
      userAgent: 'unknown',
    },
    {
      label: 'unknown address',
      socket: undefined,
      expectedIp: 'unknown',
      userAgent: 'unknown',
    },
  ])(
    'records activity with $label fallbacks for every UI preference',
    async scenario => {
      config.application.locales.available = ['en', 'fr'];
      Object.defineProperty(req, 'ip', {
        configurable: true,
        value: undefined,
      });
      (req as any).socket = scenario.socket;
      req.get = vi.fn(() => undefined) as any;
      sessionManager.isAuthenticated.mockResolvedValue(true);
      sessionManager.getActiveUser.mockReturnValue({ id: 'user-1' });

      req.body = { theme: 'dark' };
      await middleware.updateTheme(req, res);
      req.body = { expanded: false };
      await middleware.updateSidebar(req, res);
      req.body = { locale: 'fr' };
      await middleware.updateLocale(req, res);
      req.body = { timezone: 'Africa/Porto-Novo' };
      await middleware.updateTimezone(req, res);

      expect(activityService.success).toHaveBeenCalledTimes(4);
      for (const call of activityService.success.mock.calls) {
        expect(call[3]).toMatchObject({
          ip_address: scenario.expectedIp,
          user_agent: scenario.userAgent,
        });
      }
    }
  );

  it('rebuilds complete tenant-aware UI configuration with safe fallbacks', async () => {
    config.integrations.fingerprintjs = {
      enabled: true,
      api_key: 'public-browser-key',
      endpoint: 'https://fingerprint.example.test',
    } as any;
    config.deployment.url = '';
    config.branding.logo = 'tenant/logo.svg';
    config.branding.logoDark = '';
    config.branding.logoIcon = '';
    config.branding.logoIconDark = '';
    config.branding.favicon = '';
    config.branding.colors = undefined as any;
    config.branding.fonts = undefined as any;
    config.features.social_providers.enabled = undefined as any;
    config.features.social_providers.available = undefined as any;
    config.features.multi_tenancy.enabled = true;
    config.security.authentication.login.login_methods = ['phone_number'];
    config.security.authentication.signup.signup_methods = ['phone'];
    config.security.authentication.signup.contact_channels = undefined as any;
    config.security.authentication.custom_identifiers = {
      enabled: true,
      fields: undefined as any,
    };
    res.locals.socialProviders = undefined;

    await tenantContext.run('tenant-a', () =>
      middleware.setAllUILocals(req, res, next)
    );

    expect(res.locals.app.fingerprintJS).toEqual({
      apiKey: 'public-browser-key',
      endpoint: 'https://fingerprint.example.test',
    });
    expect(res.locals.branding).toMatchObject({
      logo: '/files/tenant/logo.svg',
      logoDark: '/files/tenant/logo.svg',
      logoIcon: '/images/logo-icon-light.png',
      logoIconDark: '/images/logo-icon-dark.png',
      favicon: '/favicon.png',
      colors: { light: {}, dark: {} },
      fonts: {},
    });
    expect(res.locals.socialProviders).toEqual({
      enabled: [],
      available: ['google', 'github', 'microsoft', 'linkedin', 'facebook'],
    });
    expect(res.locals.authentication).toMatchObject({
      loginMethods: {
        email: false,
        phone: true,
        customIdentifier: false,
        bothEnabled: false,
        customIdentifiers: [],
      },
      signupMethods: { bothEnabled: false, requireFullName: true },
      customIdentifiers: [],
      emailVerificationRequired: false,
      phoneVerificationRequired: false,
    });
    expect(res.locals.isPlatformTenant).toBe(false);
    expect(res.locals.isMultiTenancyEnabled).toBe(true);
    expect(res.locals.canonical_url).toBe(
      'https://tenant.example.test/auth/login'
    );
  });

  it('preserves already encoded path segments when rebuilding the canonical URL', async () => {
    config.deployment.url = 'https://id.example.test';
    req.originalUrl = '/accounts/Maria%20Doe?tab=profile';

    await middleware.setAllUILocals(req, res, next);

    expect(res.locals.canonical_url).toBe(
      'https://id.example.test/accounts/Maria%20Doe'
    );
  });

  it('uses the deployment root when the request URL cannot be parsed', async () => {
    config.deployment.url = 'https://id.example.test';
    req.originalUrl = '//[';

    await middleware.setAllUILocals(req, res, next);

    expect(res.locals.canonical_url).toBe('https://id.example.test/');
  });

  it.each(['_platforms', 'default'])(
    'shows platform settings for the %s tenant',
    async tenantId => {
      config.features.multi_tenancy.enabled = true;

      await tenantContext.run(tenantId, () =>
        middleware.setAllUILocals(req, res, next)
      );

      expect(res.locals.isPlatformTenant).toBe(true);
    }
  );

  it('recovers when building the combined locals fails', async () => {
    const error = new Error('session unavailable');
    config.application.locales.default = 'fr';
    sessionManager.get.mockImplementation(() => {
      throw error;
    });

    await middleware.setAllUILocals(req, res, next);

    expect(logger.error).toHaveBeenCalledWith(error, {
      context: 'error_setting_all_ui_locals',
    });
    expect(res.locals).toMatchObject({
      userTheme: 'light',
      htmlClass: '',
      sidebar_expanded: true,
      userLocale: 'fr',
      currentLocale: 'fr',
    });
    expect(next).toHaveBeenCalledOnce();
  });
});
