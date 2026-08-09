import { afterEach, describe, expect, it, vi } from 'vitest';

import { OIDCSocialLoginHandler } from '../../../src/oidc/flows/handlers/social-login.js';

describe('OIDC social-login handler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createHarness = () => {
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const configManager = {
      getConfig: vi.fn(() => ({ oidc: { path: '/oidc/v1' } })),
    };
    const socialLoginManager = {
      getAuthorizationUrl: vi
        .fn()
        .mockResolvedValue('https://accounts.example.test/authorize'),
      isProviderAvailable: vi.fn(() => true),
    };
    const sessionManager = { set: vi.fn() };
    const handler = new OIDCSocialLoginHandler(
      logger as any,
      configManager as any,
      socialLoginManager as any,
      sessionManager as any
    );
    const request = {
      params: { provider: 'google' },
      query: {
        uid: 'a'.repeat(20),
        client_id: 'demo-rp',
        prompt: 'login',
        acr_values: 'urn:example:loa:2',
        login_hint: 'alice@example.test',
      },
    };
    const response = {
      redirect: vi.fn(),
      render: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };

    return {
      handler,
      logger,
      next: vi.fn(),
      request,
      response,
      sessionManager,
      socialLoginManager,
    };
  };

  it('stores the validated OIDC context and redirects to the provider', async () => {
    const harness = createHarness();
    vi.spyOn(Date, 'now').mockReturnValue(123_456);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next
    );

    expect(harness.sessionManager.set).toHaveBeenCalledWith(
      harness.request,
      'oidcSocialContext',
      {
        uid: 'a'.repeat(20),
        client_id: 'demo-rp',
        prompt: 'login',
        acr_values: 'urn:example:loa:2',
        otherParams: { login_hint: 'alice@example.test' },
        timestamp: 123_456,
      }
    );
    expect(harness.socialLoginManager.getAuthorizationUrl).toHaveBeenCalledWith(
      'google',
      harness.request
    );
    expect(harness.response.redirect).toHaveBeenCalledWith(
      'https://accounts.example.test/authorize'
    );
  });

  it('preserves optional fields as undefined when they are omitted', async () => {
    const harness = createHarness();
    harness.request.query = {
      uid: 'a'.repeat(20),
      client_id: 'demo-rp',
    } as any;

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next
    );

    expect(harness.sessionManager.set).toHaveBeenCalledWith(
      harness.request,
      'oidcSocialContext',
      expect.objectContaining({
        prompt: undefined,
        acr_values: undefined,
        otherParams: {},
      })
    );
  });

  it('uses the login page as the safe recovery target when uid is missing', async () => {
    const harness = createHarness();
    delete (harness.request.query as any).uid;

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next
    );

    expect(harness.response.status).toHaveBeenCalledWith(400);
    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/oidc/error.njk',
      {
        title: 'Invalid Request',
        error: 'Missing required OIDC parameters',
        redirectUrl: '/auth/login',
      }
    );
    expect(harness.sessionManager.set).not.toHaveBeenCalled();
  });

  it('returns to the interaction when client_id is missing', async () => {
    const harness = createHarness();
    delete (harness.request.query as any).client_id;

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next
    );

    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/oidc/error.njk',
      expect.objectContaining({
        redirectUrl: `/oidc/v1/interaction/${'a'.repeat(20)}`,
      })
    );
  });

  it('rejects an unavailable configured provider', async () => {
    const harness = createHarness();
    harness.socialLoginManager.isProviderAvailable.mockReturnValue(false);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next
    );

    expect(harness.response.status).toHaveBeenCalledWith(400);
    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/oidc/error.njk',
      {
        title: 'Provider Not Available',
        error: 'google login is not available',
        redirectUrl: `/oidc/v1/interaction/${'a'.repeat(20)}`,
      }
    );
    expect(
      harness.socialLoginManager.getAuthorizationUrl
    ).not.toHaveBeenCalled();
  });

  it.each([
    { field: 'provider', value: 'unknown-provider' },
    { field: 'uid', value: 'short' },
    { field: 'client_id', value: 'x'.repeat(201) },
    { field: 'prompt', value: 'x'.repeat(101) },
    { field: 'acr_values', value: 'x'.repeat(501) },
  ])(
    'renders a safe 400 page for invalid $field input',
    async ({ field, value }) => {
      const harness = createHarness();
      if (field === 'provider') {
        harness.request.params.provider = value;
      } else {
        (harness.request.query as Record<string, string>)[field] = value;
      }

      await harness.handler.handle(
        harness.request as any,
        harness.response as any,
        harness.next
      );

      expect(harness.response.status).toHaveBeenCalledWith(400);
      expect(harness.response.render).toHaveBeenCalledWith(
        'auth/oidc/error.njk',
        {
          title: 'Invalid Request',
          error:
            'The request could not be processed. Please return to the previous page and try again.',
          redirectUrl: '/auth/login',
        }
      );
    }
  );

  it('renders a recoverable 500 error when provider authorization fails', async () => {
    const harness = createHarness();
    const error = new Error('provider unavailable');
    harness.socialLoginManager.getAuthorizationUrl.mockRejectedValue(error);

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next
    );

    expect(harness.logger.error).toHaveBeenCalledWith(error, {
      context: 'oidc_social_login_initiation_failed',
      provider: 'google',
    });
    expect(harness.response.status).toHaveBeenCalledWith(500);
    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/oidc/error.njk',
      expect.objectContaining({
        title: 'Social Login Error',
        redirectUrl: `/oidc/v1/interaction/${'a'.repeat(20)}`,
      })
    );
  });

  it('falls back to login if an unexpected failure occurs without a uid', async () => {
    const harness = createHarness();
    delete (harness.request.query as any).uid;
    harness.logger.warn.mockImplementation(() => {
      throw new Error('logger unavailable');
    });

    await harness.handler.handle(
      harness.request as any,
      harness.response as any,
      harness.next
    );

    expect(harness.response.status).toHaveBeenCalledWith(500);
    expect(harness.response.render).toHaveBeenCalledWith(
      'auth/oidc/error.njk',
      expect.objectContaining({ redirectUrl: '/auth/login' })
    );
  });
});
