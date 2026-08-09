import type { Request } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IConfigManager } from '../../../src/di/interfaces/config-manager.interface.js';
import type { ILogger } from '../../../src/di/interfaces/logger.interface.js';
import type { ISessionManager } from '../../../src/di/interfaces/session-manager.interface.js';
import type { ISocialIntegrationService } from '../../../src/di/interfaces/social-integration-service.interface.js';
import type { IUserService } from '../../../src/di/interfaces/user-service.interface.js';
import type { SocialLoginResult } from '../../../src/di/interfaces/base-social-login.interface.js';
import { LinkedInSocialLogin } from '../../../src/integration/linkedin-social-login.js';
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

class TestLinkedInSocialLogin extends LinkedInSocialLogin {
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
        linkedin: {
          client_id: 'linkedin-client',
          client_secret: 'linkedin-secret',
          authorization_endpoint: 'https://linkedin.example.test/authorize',
          token_endpoint: 'https://linkedin.example.test/token',
          userinfo_endpoint: 'https://linkedin.example.test/userinfo',
          scopes: ['openid', 'profile', 'email'],
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
  const login = new TestLinkedInSocialLogin(
    logger as unknown as ILogger,
    { getConfig: vi.fn().mockReturnValue(config) } as unknown as IConfigManager,
    sessionManager as unknown as ISessionManager,
    {} as IUserService,
    {} as ISocialIntegrationService
  );

  return { logger, login, sessionManager, sessions };
}

describe('LinkedInSocialLogin', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('builds a PKCE authorization URL and preserves other provider sessions', async () => {
    const { logger, login, sessionManager, sessions } = createHarness();
    const req = {} as Request;
    sessions.set('socialLogin', {
      github: { state: 'github-state' },
    });
    openidClientMocks.randomState.mockReturnValue('linkedin-state');
    openidClientMocks.randomPKCECodeVerifier.mockReturnValue('pkce-verifier');
    openidClientMocks.calculatePKCECodeChallenge.mockResolvedValue(
      'pkce-challenge'
    );
    vi.spyOn(Date, 'now').mockReturnValue(123_456);

    const authorizationUrl = new URL(await login.getAuthorizationUrl(req));

    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      'https://linkedin.example.test/authorize'
    );
    expect(Object.fromEntries(authorizationUrl.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'linkedin-client',
      redirect_uri: 'https://parako.example.test/auth/social/linkedin/callback',
      scope: 'openid profile email',
      state: 'linkedin-state',
      code_challenge: 'pkce-challenge',
      code_challenge_method: 'S256',
    });
    expect(sessionManager.set).toHaveBeenCalledWith(req, 'socialLogin', {
      github: { state: 'github-state' },
      linkedin: {
        codeVerifier: 'pkce-verifier',
        state: 'linkedin-state',
        timestamp: 123_456,
      },
    });
    expect(logger.info).toHaveBeenCalledWith(
      'Generated LinkedIn OAuth2 authorization URL',
      {
        provider: 'linkedin',
        scopes: ['openid', 'profile', 'email'],
      }
    );
  });

  it('rejects a callback without an authorization code and clears only LinkedIn state', async () => {
    const { login, sessionManager, sessions } = createHarness();
    const req = {
      params: { provider: 'linkedin' },
      query: { state: 'linkedin-state' },
    } as unknown as Request;
    sessions.set('socialLogin', {
      github: { state: 'github-state' },
      linkedin: { state: 'linkedin-state', codeVerifier: 'pkce-verifier' },
    });

    await expect(login.handleCallback(req)).resolves.toEqual({
      success: false,
      error:
        'Invalid callback parameters - missing code, state, or session data',
    });
    expect(sessionManager.set).toHaveBeenLastCalledWith(req, 'socialLogin', {
      github: { state: 'github-state' },
    });
  });

  it('cleans OAuth state after a successful callback', async () => {
    const { login, sessionManager, sessions } = createHarness();
    const req = {
      params: { provider: 'linkedin' },
      query: { code: 'authorization-code', state: 'linkedin-state' },
    } as unknown as Request;
    sessions.set('socialLogin', {
      github: { state: 'github-state' },
      linkedin: { state: 'linkedin-state', codeVerifier: 'pkce-verifier' },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'linkedin-token',
            token_type: 'bearer',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sub: 'linkedin-user-1',
            email: 'alice@example.test',
            email_verified: true,
            name: 'Alice Doe',
            given_name: 'Alice',
            family_name: 'Doe',
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

  it('rejects a token response without an access token before calling LinkedIn', async () => {
    const { login, sessions } = createHarness();
    const req = {
      params: { provider: 'linkedin' },
      query: { code: 'authorization-code', state: 'linkedin-state' },
    } as unknown as Request;
    sessions.set('socialLogin', {
      linkedin: { state: 'linkedin-state', codeVerifier: 'pkce-verifier' },
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

  it('returns a safe failure when LinkedIn userinfo rejects the access token', async () => {
    const { login, sessions } = createHarness();
    const req = {
      params: { provider: 'linkedin' },
      query: { code: 'authorization-code', state: 'linkedin-state' },
    } as unknown as Request;
    sessions.set('socialLogin', {
      linkedin: { state: 'linkedin-state', codeVerifier: 'pkce-verifier' },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'linkedin-access-token' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 401, statusText: 'Unauthorized' })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(login.handleCallback(req)).resolves.toMatchObject({
      success: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(login.integrate).not.toHaveBeenCalled();
  });

  it('does not expose a LinkedIn token error response in logs', async () => {
    const { logger, login, sessions } = createHarness();
    const req = {
      params: { provider: 'linkedin' },
      query: { code: 'authorization-code', state: 'linkedin-state' },
    } as unknown as Request;
    sessions.set('socialLogin', {
      linkedin: { state: 'linkedin-state', codeVerifier: 'pkce-verifier' },
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

  it('handles a non-Error user integration rejection', async () => {
    const { login, sessions } = createHarness();
    const req = {
      params: { provider: 'linkedin' },
      query: { code: 'authorization-code', state: 'linkedin-state' },
    } as unknown as Request;
    sessions.set('socialLogin', {
      linkedin: { state: 'linkedin-state', codeVerifier: 'pkce-verifier' },
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ access_token: 'linkedin-access-token' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              sub: 'linkedin-user-1',
              email: 'alice@example.test',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
    );
    login.integrate.mockRejectedValue('integration failed');

    await expect(login.handleCallback(req)).resolves.toMatchObject({
      success: false,
    });
  });

  it('rejects a LinkedIn profile without a stable subject identifier', async () => {
    const { login, sessions } = createHarness();
    const req = {
      params: { provider: 'linkedin' },
      query: { code: 'authorization-code', state: 'linkedin-state' },
    } as unknown as Request;
    sessions.set('socialLogin', {
      linkedin: { state: 'linkedin-state', codeVerifier: 'pkce-verifier' },
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ access_token: 'linkedin-access-token' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ email: 'alice@example.test' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        )
    );

    await expect(login.handleCallback(req)).resolves.toMatchObject({
      success: false,
    });
    expect(login.integrate).not.toHaveBeenCalled();
  });

  it('does not trust a truthy non-boolean email verification claim', () => {
    const { login } = createHarness();

    expect(
      login.mapProviderUserData({
        sub: 'linkedin-user-1',
        email: 'alice@example.test',
        email_verified: 'false',
      }).email_verified
    ).toBe(false);
  });

  it('maps LinkedIn OIDC profile fields into the provider contract', () => {
    const { login } = createHarness();

    expect(
      login.mapProviderUserData({
        sub: '  linkedin-user-1  ',
        email: 'alice@example.test',
        email_verified: true,
        name: 'Alice Doe',
        given_name: 'Alice',
        family_name: 'Doe',
        picture: 'https://linkedin.example.test/alice.png',
        locale: { language: 'fr', country: 'BJ' },
      })
    ).toEqual({
      sub: 'linkedin-user-1',
      email: 'alice@example.test',
      email_verified: true,
      name: 'Alice Doe',
      given_name: 'Alice',
      family_name: 'Doe',
      picture: 'https://linkedin.example.test/alice.png',
      locale: 'fr',
      provider_username: 'alice',
      raw_data: {
        sub: 'linkedin-user-1',
        locale: { language: 'fr', country: 'BJ' },
      },
    });
  });

  it('preserves a string locale and omits a username when email is absent', () => {
    const { login } = createHarness();

    expect(
      login.mapProviderUserData({
        sub: 'linkedin-user-1',
        locale: 'en-US',
      })
    ).toMatchObject({
      sub: 'linkedin-user-1',
      email_verified: false,
      locale: 'en-US',
      provider_username: undefined,
    });
  });

  it('maps LinkedIn token metadata and computes an absolute expiry', () => {
    const { login } = createHarness();
    vi.spyOn(Date, 'now').mockReturnValue(1_000);

    expect(
      login.mapTokenData({
        access_token: 'linkedin-access-token',
        refresh_token: 'linkedin-refresh-token',
        id_token: 'linkedin-id-token',
        token_type: 'DPoP',
        expires_in: 60,
        scope: 'openid profile email',
      })
    ).toEqual({
      access_token: 'linkedin-access-token',
      refresh_token: 'linkedin-refresh-token',
      id_token: 'linkedin-id-token',
      token_type: 'DPoP',
      expires_at: new Date(61_000),
      scope: 'openid profile email',
    });
  });

  it('ignores malformed token expiry metadata and defaults the token type', () => {
    const { login } = createHarness();

    expect(
      login.mapTokenData({
        access_token: 'linkedin-access-token',
        expires_in: 'not-a-number',
      })
    ).toMatchObject({
      access_token: 'linkedin-access-token',
      token_type: 'Bearer',
      expires_at: undefined,
    });
  });

  it('documents that LinkedIn access must be revoked by the user', async () => {
    const { logger, login } = createHarness();

    await expect(
      login.revoke('linkedin-access-token')
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'LinkedIn does not support programmatic token revocation'
      ),
      { provider: 'linkedin' }
    );
  });
});
