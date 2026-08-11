import type { Request } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IConfigManager } from '../../../src/di/interfaces/config-manager.interface.js';
import type { ILogger } from '../../../src/di/interfaces/logger.interface.js';
import type { ISessionManager } from '../../../src/di/interfaces/session-manager.interface.js';
import type { ISocialIntegrationService } from '../../../src/di/interfaces/social-integration-service.interface.js';
import type { IUserService } from '../../../src/di/interfaces/user-service.interface.js';
import type { SocialLoginResult } from '../../../src/di/interfaces/base-social-login.interface.js';
import { GitHubSocialLogin } from '../../../src/integration/github-social-login.js';
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

class TestGitHubSocialLogin extends GitHubSocialLogin {
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
        github: {
          client_id: 'github-client',
          client_secret: 'github-secret',
          authorization_endpoint: 'https://github.example.test/authorize',
          token_endpoint: 'https://github.example.test/token',
          userinfo_endpoint: 'https://github.example.test/user',
          scopes: ['read:user', 'user:email'],
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
  const login = new TestGitHubSocialLogin(
    logger as unknown as ILogger,
    { getConfig: vi.fn().mockReturnValue(config) } as unknown as IConfigManager,
    sessionManager as unknown as ISessionManager,
    {} as IUserService,
    {} as ISocialIntegrationService
  );

  return { config, logger, login, sessionManager, sessions };
}

describe('GitHubSocialLogin', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('builds a PKCE authorization URL and preserves other provider sessions', async () => {
    const { logger, login, sessionManager, sessions } = createHarness();
    const req = {} as Request;
    sessions.set('socialLogin', {
      google: { state: 'google-state' },
    });
    openidClientMocks.randomState.mockReturnValue('github-state');
    openidClientMocks.randomPKCECodeVerifier.mockReturnValue('pkce-verifier');
    openidClientMocks.calculatePKCECodeChallenge.mockResolvedValue(
      'pkce-challenge'
    );
    vi.spyOn(Date, 'now').mockReturnValue(123_456);

    const authorizationUrl = new URL(await login.getAuthorizationUrl(req));

    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      'https://github.example.test/authorize'
    );
    expect(Object.fromEntries(authorizationUrl.searchParams)).toEqual({
      client_id: 'github-client',
      redirect_uri: 'https://parako.example.test/auth/social/github/callback',
      scope: 'read:user user:email',
      state: 'github-state',
      code_challenge: 'pkce-challenge',
      code_challenge_method: 'S256',
    });
    expect(sessionManager.set).toHaveBeenCalledWith(req, 'socialLogin', {
      google: { state: 'google-state' },
      github: {
        codeVerifier: 'pkce-verifier',
        state: 'github-state',
        timestamp: 123_456,
      },
    });
    expect(logger.info).toHaveBeenCalledWith(
      'Generated GitHub OAuth2 authorization URL',
      { provider: 'github' }
    );
  });

  it('cleans OAuth state after a successful callback', async () => {
    const { login, sessionManager, sessions } = createHarness();
    const req = {
      params: { provider: 'github' },
      query: { code: 'authorization-code', state: 'github-state' },
    } as unknown as Request;
    sessions.set('socialLogin', {
      google: { state: 'google-state' },
      github: { state: 'github-state', codeVerifier: 'pkce-verifier' },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'github-token',
            token_type: 'bearer',
            scope: 'read:user user:email',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 123,
            email: 'alice@example.test',
            email_verified: true,
            name: 'Alice Doe',
            login: 'alice',
            avatar_url: 'https://avatars.example.test/alice.png',
            location: 'BJ',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    vi.stubGlobal('fetch', fetchMock);
    login.integrate.mockResolvedValue({ success: true });

    await expect(login.handleCallback(req)).resolves.toEqual({ success: true });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://github.example.test/user',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer github-token',
        }),
      })
    );
    expect(login.integrate).toHaveBeenCalledWith(
      {
        sub: '123',
        email: 'alice@example.test',
        email_verified: true,
        given_name: 'Alice',
        family_name: 'Doe',
        picture: 'https://avatars.example.test/alice.png',
        locale: 'BJ',
        provider_username: 'alice',
      },
      {
        access_token: 'github-token',
        refresh_token: undefined,
        id_token: undefined,
        token_type: 'bearer',
        expires_at: undefined,
        scope: 'read:user user:email',
      },
      req
    );
    expect(sessionManager.set).toHaveBeenLastCalledWith(req, 'socialLogin', {
      google: { state: 'google-state' },
    });
  });

  it('rejects a token response without an access token before calling GitHub', async () => {
    const { login, sessionManager, sessions } = createHarness();
    const req = {
      params: { provider: 'github' },
      query: { code: 'authorization-code', state: 'github-state' },
    } as unknown as Request;
    sessions.set('socialLogin', {
      google: { state: 'google-state' },
      github: { state: 'github-state', codeVerifier: 'pkce-verifier' },
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
    expect(sessionManager.set).toHaveBeenLastCalledWith(req, 'socialLogin', {
      google: { state: 'google-state' },
    });
  });

  it('rejects a mismatched OAuth state and removes only GitHub state', async () => {
    const { login, sessionManager, sessions } = createHarness();
    const req = {
      params: { provider: 'github' },
      query: { code: 'authorization-code', state: 'attacker-state' },
    } as unknown as Request;
    sessions.set('socialLogin', {
      google: { state: 'google-state' },
      github: { state: 'github-state', codeVerifier: 'pkce-verifier' },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(login.handleCallback(req)).resolves.toEqual({
      success: false,
      error: 'Invalid OAuth state parameter - possible CSRF attack',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(login.integrate).not.toHaveBeenCalled();
    expect(sessionManager.set).toHaveBeenLastCalledWith(req, 'socialLogin', {
      google: { state: 'google-state' },
    });
  });

  it('returns a provider denial only after validating callback state', async () => {
    const { login, sessionManager, sessions } = createHarness();
    const req = {
      params: { provider: 'github' },
      query: {
        error: 'access_denied',
        error_description: 'The user denied access',
        state: 'github-state',
      },
    } as unknown as Request;
    sessions.set('socialLogin', {
      google: { state: 'google-state' },
      github: { state: 'github-state', codeVerifier: 'pkce-verifier' },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(login.handleCallback(req)).resolves.toEqual({
      success: false,
      error: 'You denied access to your GitHub account. Please try again.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(login.integrate).not.toHaveBeenCalled();
    expect(sessionManager.set).toHaveBeenLastCalledWith(req, 'socialLogin', {
      google: { state: 'google-state' },
    });
  });

  it('rejects a provider denial carrying a mismatched callback state', async () => {
    const { login, sessions } = createHarness();
    const req = {
      params: { provider: 'github' },
      query: { error: 'access_denied', state: 'attacker-state' },
    } as unknown as Request;
    sessions.set('socialLogin', {
      github: { state: 'github-state', codeVerifier: 'pkce-verifier' },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(login.handleCallback(req)).resolves.toEqual({
      success: false,
      error: 'Invalid OAuth state parameter - possible CSRF attack',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(login.integrate).not.toHaveBeenCalled();
  });

  it('does not expose a GitHub token error response in logs', async () => {
    const { logger, login, sessions } = createHarness();
    const req = {
      params: { provider: 'github' },
      query: { code: 'authorization-code', state: 'github-state' },
    } as unknown as Request;
    sessions.set('socialLogin', {
      github: { state: 'github-state', codeVerifier: 'pkce-verifier' },
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response('client_secret=leaked-secret&error=bad_verification_code', {
        status: 400,
        statusText: 'Bad Request',
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(login.handleCallback(req)).resolves.toEqual({
      success: false,
      error: 'Unable to complete Github sign-in. Please try again.',
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      'leaked-secret'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(login.integrate).not.toHaveBeenCalled();
  });

  it('contains a non-Error integration failure and cleans OAuth state', async () => {
    const { login, sessionManager, sessions } = createHarness();
    const req = {
      params: { provider: 'github' },
      query: { code: 'authorization-code', state: 'github-state' },
    } as unknown as Request;
    sessions.set('socialLogin', {
      google: { state: 'google-state' },
      github: { state: 'github-state', codeVerifier: 'pkce-verifier' },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'github-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 123, login: 'alice' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    login.integrate.mockRejectedValue('integration failed');

    await expect(login.handleCallback(req)).resolves.toEqual({
      success: false,
      error: 'Unable to complete Github sign-in. Please try again.',
    });
    expect(sessionManager.set).toHaveBeenLastCalledWith(req, 'socialLogin', {
      google: { state: 'google-state' },
    });
  });

  it('rejects a GitHub profile without an account identifier', async () => {
    const { login, sessions } = createHarness();
    const req = {
      params: { provider: 'github' },
      query: { code: 'authorization-code', state: 'github-state' },
    } as unknown as Request;
    sessions.set('socialLogin', {
      github: { state: 'github-state', codeVerifier: 'pkce-verifier' },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'github-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ login: 'alice', email: 'alice@example.test' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(login.handleCallback(req)).resolves.toMatchObject({
      success: false,
    });
    expect(login.integrate).not.toHaveBeenCalled();
  });

  it('trusts only a boolean GitHub email verification claim', () => {
    const { login } = createHarness();

    expect(
      login.mapProviderUserData({
        id: 123,
        login: 'alice',
        email: 'alice@example.test',
        email_verified: 'false',
      }).email_verified
    ).toBe(false);
  });

  it('contains a GitHub user-info HTTP failure before integration', async () => {
    const { login, sessions } = createHarness();
    const req = {
      params: { provider: 'github' },
      query: { code: 'authorization-code', state: 'github-state' },
    } as unknown as Request;
    sessions.set('socialLogin', {
      github: { state: 'github-state', codeVerifier: 'pkce-verifier' },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'github-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
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

  it.each([
    {
      description: 'primary email',
      emails: [
        { email: 'verified@example.test', verified: true },
        { email: 'primary@example.test', primary: true, verified: false },
      ],
      expectedEmail: 'primary@example.test',
      expectedVerified: false,
    },
    {
      description: 'verified email when none is primary',
      emails: [
        { email: 'unverified@example.test', verified: false },
        { email: 'verified@example.test', verified: true },
      ],
      expectedEmail: 'verified@example.test',
      expectedVerified: true,
    },
    {
      description: 'first email when none is primary or verified',
      emails: [
        { email: 'first@example.test', verified: false },
        { email: 'second@example.test', verified: false },
      ],
      expectedEmail: 'first@example.test',
      expectedVerified: false,
    },
  ])(
    'uses the GitHub $description returned by the private-email endpoint',
    async ({ emails, expectedEmail, expectedVerified }) => {
      const { login, sessions } = createHarness();
      const req = {
        params: { provider: 'github' },
        query: { code: 'authorization-code', state: 'github-state' },
      } as unknown as Request;
      sessions.set('socialLogin', {
        github: { state: 'github-state', codeVerifier: 'pkce-verifier' },
      });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ access_token: 'github-token' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 123, login: 'alice' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(emails), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      vi.stubGlobal('fetch', fetchMock);
      login.integrate.mockResolvedValue({ success: true });

      await expect(login.handleCallback(req)).resolves.toEqual({
        success: true,
      });
      expect(login.integrate).toHaveBeenCalledWith(
        expect.objectContaining({
          email: expectedEmail,
          email_verified: expectedVerified,
        }),
        expect.any(Object),
        req
      );
    }
  );

  it.each([
    {
      description: 'returns no addresses',
      emailResult: new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
      warns: false,
    },
    {
      description: 'rejects the request',
      emailResult: new Error('email endpoint unavailable'),
      warns: true,
    },
    {
      description: 'returns an HTTP error',
      emailResult: new Response(null, { status: 503 }),
      warns: false,
    },
  ])(
    'continues without an email when the GitHub private-email endpoint $description',
    async ({ emailResult, warns }) => {
      const { logger, login, sessions } = createHarness();
      const req = {
        params: { provider: 'github' },
        query: { code: 'authorization-code', state: 'github-state' },
      } as unknown as Request;
      sessions.set('socialLogin', {
        github: { state: 'github-state', codeVerifier: 'pkce-verifier' },
      });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ access_token: 'github-token' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 123, login: 'alice' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      if (emailResult instanceof Error) {
        fetchMock.mockRejectedValueOnce(emailResult);
      } else {
        fetchMock.mockResolvedValueOnce(emailResult);
      }
      vi.stubGlobal('fetch', fetchMock);
      login.integrate.mockResolvedValue({ success: true });

      await expect(login.handleCallback(req)).resolves.toEqual({
        success: true,
      });
      expect(login.integrate).toHaveBeenCalledWith(
        expect.objectContaining({ email: '', email_verified: false }),
        expect.any(Object),
        req
      );
      expect(logger.warn).toHaveBeenCalledTimes(warns ? 1 : 0);
    }
  );

  it('does not expose a GitHub revocation response body in errors', async () => {
    const { login } = createHarness();
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response('access_token=leaked-token', {
        status: 401,
        statusText: 'Unauthorized',
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = login.revoke('github-token');

    await expect(result).rejects.toThrow('GitHub token revocation failed');
    await expect(result).rejects.not.toThrow('leaked-token');
  });

  it('revokes a GitHub token with application basic authentication', async () => {
    const { logger, login } = createHarness();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(login.revoke('github-token')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/applications/github-client/token',
      {
        method: 'DELETE',
        headers: {
          Authorization: `Basic ${Buffer.from(
            'github-client:github-secret'
          ).toString('base64')}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'parako-id/1.0.0',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ access_token: 'github-token' }),
      }
    );
    expect(logger.info).toHaveBeenCalledWith(
      'GitHub token revoked successfully',
      { provider: 'github' }
    );
  });

  it('maps an absolute GitHub token expiry and optional refresh token', () => {
    const { login } = createHarness();

    expect(
      login.mapTokenData({
        access_token: 'github-token',
        refresh_token: 'github-refresh-token',
        expires_at: 1_800_000_000,
        scope: 'read:user',
      })
    ).toEqual({
      access_token: 'github-token',
      refresh_token: 'github-refresh-token',
      id_token: undefined,
      token_type: 'Bearer',
      expires_at: new Date(1_800_000_000_000),
      scope: 'read:user',
    });
  });
});
