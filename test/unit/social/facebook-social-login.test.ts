import type { Request } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IConfigManager } from '../../../src/di/interfaces/config-manager.interface.js';
import type { ILogger } from '../../../src/di/interfaces/logger.interface.js';
import type { ISessionManager } from '../../../src/di/interfaces/session-manager.interface.js';
import type { ISocialIntegrationService } from '../../../src/di/interfaces/social-integration-service.interface.js';
import type { IUserService } from '../../../src/di/interfaces/user-service.interface.js';
import type { SocialLoginResult } from '../../../src/di/interfaces/base-social-login.interface.js';
import { FacebookSocialLogin } from '../../../src/integration/facebook-social-login.js';
import type {
  ProviderUserData,
  TokenData,
} from '../../../src/types/social-integration.js';

const openidClientMocks = vi.hoisted(() => ({
  calculatePKCECodeChallenge: vi.fn(),
  randomPKCECodeVerifier: vi.fn(),
  randomState: vi.fn(),
}));

vi.mock('openid-client', async importOriginal => ({
  ...(await importOriginal<typeof import('openid-client')>()),
  ...openidClientMocks,
}));

class TestFacebookSocialLogin extends FacebookSocialLogin {
  public readonly integrate = vi.fn(
    async (
      _providerData: ProviderUserData,
      _tokens: TokenData,
      _req: Request
    ): Promise<SocialLoginResult> => ({ success: false })
  );

  protected override handleUserIntegration(
    providerData: ProviderUserData,
    tokens: TokenData,
    req: Request
  ): Promise<SocialLoginResult> {
    return this.integrate(providerData, tokens, req);
  }

  public revoke(accessToken: string): Promise<void> {
    return this.revokeToken(accessToken);
  }
}

function createHarness() {
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  const config = {
    deployment: { url: 'https://parako.example.test' },
    features: {
      social_providers: {
        facebook: {
          client_id: 'facebook-client',
          client_secret: 'facebook-secret',
          authorization_endpoint: 'https://facebook.example.test/authorize',
          token_endpoint: 'https://facebook.example.test/token',
          userinfo_endpoint: 'https://facebook.example.test/me',
          scopes: ['public_profile', 'email'],
        },
      },
    },
  };
  const sessions = new Map<string, unknown>();
  const sessionManager = {
    get: vi.fn(
      (_req: Request, key: string, defaultValue?: unknown) =>
        sessions.get(key) ?? defaultValue
    ),
    getAuthenticatedUsers: vi.fn(),
    set: vi.fn((_req: Request, key: string, value: unknown) => {
      sessions.set(key, value);
    }),
  };
  const login = new TestFacebookSocialLogin(
    logger as unknown as ILogger,
    { getConfig: vi.fn().mockReturnValue(config) } as unknown as IConfigManager,
    sessionManager as unknown as ISessionManager,
    {} as IUserService,
    {} as ISocialIntegrationService
  );

  return { logger, login, sessionManager, sessions };
}

describe('FacebookSocialLogin', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('builds a PKCE authorization URL and preserves other provider sessions', async () => {
    const { logger, login, sessionManager, sessions } = createHarness();
    const req = {} as Request;
    sessions.set('socialLogin', { github: { state: 'github-state' } });
    openidClientMocks.randomState.mockReturnValue('facebook-state');
    openidClientMocks.randomPKCECodeVerifier.mockReturnValue('pkce-verifier');
    openidClientMocks.calculatePKCECodeChallenge.mockResolvedValue(
      'pkce-challenge'
    );
    vi.spyOn(Date, 'now').mockReturnValue(123_456);

    const authorizationUrl = new URL(await login.getAuthorizationUrl(req));

    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      'https://facebook.example.test/authorize'
    );
    expect(Object.fromEntries(authorizationUrl.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'facebook-client',
      redirect_uri: 'https://parako.example.test/auth/social/facebook/callback',
      scope: 'public_profile,email',
      state: 'facebook-state',
      code_challenge: 'pkce-challenge',
      code_challenge_method: 'S256',
    });
    expect(sessionManager.set).toHaveBeenCalledWith(req, 'socialLogin', {
      github: { state: 'github-state' },
      facebook: {
        codeVerifier: 'pkce-verifier',
        state: 'facebook-state',
        timestamp: 123_456,
      },
    });
    expect(logger.info).toHaveBeenCalledWith(
      'Generated Facebook OAuth2 authorization URL',
      { provider: 'facebook', scopes: ['public_profile', 'email'] }
    );
  });

  it('rejects a callback without an authorization code and cleans provider state', async () => {
    const { login, sessionManager, sessions } = createHarness();
    const req = {
      params: { provider: 'facebook' },
      query: { state: 'facebook-state' },
    } as unknown as Request;
    sessions.set('socialLogin', {
      github: { state: 'github-state' },
      facebook: { state: 'facebook-state', codeVerifier: 'pkce-verifier' },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(login.handleCallback(req)).resolves.toEqual({
      success: false,
      error:
        'Invalid callback parameters - missing code, state, or session data',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sessionManager.set).toHaveBeenLastCalledWith(req, 'socialLogin', {
      github: { state: 'github-state' },
    });
  });

  it('cleans OAuth state after a successful callback', async () => {
    const { login, sessionManager, sessions } = createHarness();
    const req = {
      params: { provider: 'facebook' },
      query: { code: 'authorization-code', state: 'facebook-state' },
    } as unknown as Request;
    sessions.set('socialLogin', {
      github: { state: 'github-state' },
      facebook: { state: 'facebook-state', codeVerifier: 'pkce-verifier' },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'facebook-token',
            token_type: 'bearer',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'facebook-user-1',
            email: 'alice@example.test',
            name: 'Alice Doe',
            first_name: 'Alice',
            last_name: 'Doe',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    vi.stubGlobal('fetch', fetchMock);
    login.integrate.mockResolvedValue({ success: true });

    await expect(login.handleCallback(req)).resolves.toEqual({ success: true });
    expect(sessionManager.set).toHaveBeenLastCalledWith(req, 'socialLogin', {
      github: { state: 'github-state' },
    });
  });

  it('rejects a token response without an access token before calling Facebook', async () => {
    const { login, sessions } = createHarness();
    const req = {
      params: { provider: 'facebook' },
      query: { code: 'authorization-code', state: 'facebook-state' },
    } as unknown as Request;
    sessions.set('socialLogin', {
      facebook: { state: 'facebook-state', codeVerifier: 'pkce-verifier' },
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ token_type: 'bearer' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(login.handleCallback(req)).resolves.toMatchObject({
      success: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(login.integrate).not.toHaveBeenCalled();
  });

  it('contains a Facebook user-info HTTP failure before integration', async () => {
    const { login, sessions } = createHarness();
    const req = {
      params: { provider: 'facebook' },
      query: { code: 'authorization-code', state: 'facebook-state' },
    } as unknown as Request;
    sessions.set('socialLogin', {
      facebook: { state: 'facebook-state', codeVerifier: 'pkce-verifier' },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'facebook-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 503, statusText: 'Unavailable' })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(login.handleCallback(req)).resolves.toMatchObject({
      success: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(login.integrate).not.toHaveBeenCalled();
  });

  it('does not expose a Facebook token error response in logs', async () => {
    const { logger, login, sessions } = createHarness();
    const req = {
      params: { provider: 'facebook' },
      query: { code: 'authorization-code', state: 'facebook-state' },
    } as unknown as Request;
    sessions.set('socialLogin', {
      facebook: { state: 'facebook-state', codeVerifier: 'pkce-verifier' },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response('client_secret=leaked-secret', {
          status: 400,
          statusText: 'Bad Request',
        })
      )
    );

    await expect(login.handleCallback(req)).resolves.toMatchObject({
      success: false,
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      'leaked-secret'
    );
  });

  it('contains a non-Error integration failure and cleans OAuth state', async () => {
    const { login, sessionManager, sessions } = createHarness();
    const req = {
      params: { provider: 'facebook' },
      query: { code: 'authorization-code', state: 'facebook-state' },
    } as unknown as Request;
    sessions.set('socialLogin', {
      github: { state: 'github-state' },
      facebook: { state: 'facebook-state', codeVerifier: 'pkce-verifier' },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'facebook-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'facebook-user-1',
            email: 'alice@example.test',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    vi.stubGlobal('fetch', fetchMock);
    login.integrate.mockRejectedValue('integration failed');

    await expect(login.handleCallback(req)).resolves.toMatchObject({
      success: false,
    });
    expect(sessionManager.set).toHaveBeenLastCalledWith(req, 'socialLogin', {
      github: { state: 'github-state' },
    });
  });

  it('rejects a Facebook profile without an account identifier', async () => {
    const { login, sessions } = createHarness();
    const req = {
      params: { provider: 'facebook' },
      query: { code: 'authorization-code', state: 'facebook-state' },
    } as unknown as Request;
    sessions.set('socialLogin', {
      facebook: { state: 'facebook-state', codeVerifier: 'pkce-verifier' },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'facebook-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ email: 'alice@example.test' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(login.handleCallback(req)).resolves.toMatchObject({
      success: false,
    });
    expect(login.integrate).not.toHaveBeenCalled();
  });

  it('does not expose a Facebook revocation response body in errors', async () => {
    const { login } = createHarness();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response('access_token=leaked-token', {
          status: 401,
          statusText: 'Unauthorized',
        })
      )
    );

    const result = login.revoke('facebook-token');

    await expect(result).rejects.toThrow('Facebook token revocation failed');
    await expect(result).rejects.not.toThrow('leaked-token');
  });

  it('revokes a Facebook token through the permissions endpoint', async () => {
    const { logger, login } = createHarness();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(login.revoke('facebook-token')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/me/permissions',
      {
        method: 'DELETE',
        headers: { Authorization: 'Bearer facebook-token' },
      }
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Facebook token revoked successfully',
      { provider: 'facebook' }
    );
  });
});
