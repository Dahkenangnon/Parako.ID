import { describe, expect, it, vi } from 'vitest';

import { KoaMiddleware } from '../../../src/oidc/flows/middleware/koa.middleware.js';

describe('KoaMiddleware template rendering', () => {
  it('renders the real OIDC error template with shared asset helpers', async () => {
    const configManager = {
      getConfig: vi
        .fn()
        .mockReturnValueOnce({ deployment: { environment: 'production' } })
        .mockImplementation(() => {
          throw new Error('use fallback locals');
        }),
    };
    const viewResolver = {
      getCurrentConfig: vi.fn().mockReturnValue({
        enabled: false,
        defaultViewsRoot: 'src/views',
      }),
    };
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };
    const middleware = new KoaMiddleware(
      configManager as any,
      viewResolver as any,
      { rootDir: process.cwd() } as any,
      {} as any,
      {} as any,
      logger as any,
      { getAvailableProviders: vi.fn().mockReturnValue([]) } as any,
      { getFileUrl: vi.fn((value: string) => value) } as any
    );
    const ctx = {
      cookies: { get: vi.fn() },
      state: {},
      locals: {},
      url: '/oidc/v1/auth',
      path: '/oidc/v1/auth',
      query: {},
      req: {},
    } as any;

    await middleware.renderMiddleware(ctx, async () => {
      await ctx.render('auth/oidc/error.njk', {
        title: 'Authorization Error',
        errorType: 'invalid_request',
        errorMessage: 'The authorization request is invalid.',
        out: { error: 'invalid_request' },
        branding: {
          companyName: 'Parako.ID',
          logo: '/images/logo-light.png',
          logoDark: '/images/logo-dark.png',
          favicon: '/favicon.png',
          colors: { light: {}, dark: {} },
          fonts: {},
        },
      });
    });

    expect(ctx.type).toBe('html');
    expect(ctx.body).toContain('Invalid Request');
    expect(ctx.body).toContain('/css/');
  });
});
