import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CookieManager } from '../../../src/utils/cookies.js';

const cookieTypes = {
  locale: {
    name: 'parako.locale',
    maxAge: 86_400_000,
    httpOnly: false,
    secure: true,
    sameSite: 'lax',
  },
  theme: {
    name: 'parako.theme',
    maxAge: 86_400_000,
    httpOnly: false,
    secure: true,
    sameSite: 'strict',
  },
  session: {
    name: 'parako.session',
    maxAge: 3_600_000,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  },
} as const;

function createManager(environment = 'production') {
  const config = {
    deployment: {
      environment,
      cookies: {
        defaults: { path: '/oidc' },
        types: cookieTypes,
      },
    },
  };
  const configManager = { getConfig: vi.fn().mockReturnValue(config) };

  return {
    config,
    configManager,
    manager: new CookieManager(configManager as never),
  };
}

function createResponse() {
  return { cookie: vi.fn() };
}

describe('CookieManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets a production cookie from its type and default configuration', () => {
    const { manager } = createManager();
    const response = createResponse();

    manager.setCookie(response as never, 'session', 'session-id');

    expect(response.cookie).toHaveBeenCalledWith(
      'parako.session',
      'session-id',
      {
        maxAge: 3_600_000,
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/oidc',
      }
    );
  });

  it('disables configured secure cookies outside production by default', () => {
    const { manager } = createManager('development');
    const response = createResponse();

    manager.setCookie(response as never, 'session', 'session-id');

    expect(response.cookie).toHaveBeenCalledWith(
      'parako.session',
      'session-id',
      expect.objectContaining({ secure: false })
    );
  });

  it('honors every explicit cookie option including falsy values', () => {
    const { manager } = createManager('development');
    const response = createResponse();

    manager.setCookie(response as never, 'session', 'session-id', {
      name: 'custom.session',
      maxAge: 0,
      httpOnly: false,
      secure: true,
      sameSite: 'none',
      path: '/',
    });

    expect(response.cookie).toHaveBeenCalledWith(
      'custom.session',
      'session-id',
      {
        maxAge: 0,
        httpOnly: false,
        secure: true,
        sameSite: 'none',
        path: '/',
      }
    );
  });

  it.each([
    ['locale', 'fr', 'parako.locale'],
    ['theme', 'dark', 'parako.theme'],
    ['session', 'session-id', 'parako.session'],
  ] as const)(
    'sets the %s preference through its convenience method',
    (type, value, expectedName) => {
      const { manager } = createManager();
      const response = createResponse();
      const method = {
        locale: manager.setLocaleCookie,
        theme: manager.setThemeCookie,
        session: manager.setSessionCookie,
      }[type];

      method(response as never, value, { path: '/custom' });

      expect(response.cookie).toHaveBeenCalledWith(
        expectedName,
        value,
        expect.objectContaining({ path: '/custom' })
      );
    }
  );

  it('exposes the configured type and default cookie settings', () => {
    const { config, manager } = createManager();

    expect(manager.getCookieConfig('theme')).toBe(cookieTypes.theme);
    expect(manager.getDefaultConfig()).toBe(config.deployment.cookies.defaults);
  });

  it.each([
    ['locale', true],
    ['theme', true],
    ['session', true],
    ['unknown', false],
    ['', false],
  ])('reports support for cookie type %j as %s', (type, supported) => {
    const { manager } = createManager();

    expect(manager.isCookieTypeSupported(type)).toBe(supported);
  });
});
