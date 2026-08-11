import type { Request } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IConfigManager } from '../../../src/di/interfaces/config-manager.interface.js';
import type { ILogger } from '../../../src/di/interfaces/logger.interface.js';
import type { ISessionManager } from '../../../src/di/interfaces/session-manager.interface.js';
import type { ISocialIntegrationService } from '../../../src/di/interfaces/social-integration-service.interface.js';
import type { IUserService } from '../../../src/di/interfaces/user-service.interface.js';
import type { SocialLoginResult } from '../../../src/di/interfaces/base-social-login.interface.js';
import { GoogleSocialLogin } from '../../../src/integration/google-social-login.js';
import type {
  ProviderUserData,
  TokenData,
} from '../../../src/types/social-integration.js';

const openidClientMocks = vi.hoisted(() => ({
  authorizationCodeGrant: vi.fn(),
  buildAuthorizationUrl: vi.fn(),
  calculatePKCECodeChallenge: vi.fn(),
  discovery: vi.fn(),
  fetchProtectedResource: vi.fn(),
  randomPKCECodeVerifier: vi.fn(),
  randomState: vi.fn(),
  refreshTokenGrant: vi.fn(),
}));

vi.mock('openid-client', async importOriginal => ({
  ...(await importOriginal<typeof import('openid-client')>()),
  ...openidClientMocks,
}));

class TestGoogleSocialLogin extends GoogleSocialLogin {
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
        google: {
          client_id: 'google-client',
          client_secret: 'google-secret',
          discovery_url:
            'https://accounts.google.com/.well-known/openid-configuration',
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
  const socialIntegrationService = {
    findById: vi.fn(),
    updateTokens: vi.fn(),
  };
  const login = new TestGoogleSocialLogin(
    logger as unknown as ILogger,
    { getConfig: vi.fn().mockReturnValue(config) } as unknown as IConfigManager,
    sessionManager as unknown as ISessionManager,
    {} as IUserService,
    socialIntegrationService as unknown as ISocialIntegrationService
  );

  return {
    config,
    logger,
    login,
    sessionManager,
    sessions,
    socialIntegrationService,
  };
}

function createCallbackRequest(): Request {
  return {
    get: vi.fn((name: string) => {
      if (name === 'x-forwarded-proto') return 'https';
      if (name === 'x-forwarded-host') return 'parako.example.test';
      if (name === 'host') return 'fallback.example.test';
      return undefined;
    }),
    originalUrl:
      '/auth/social/google/callback?code=authorization-code&state=google-state',
    params: { provider: 'google' },
    protocol: 'http',
    query: { code: 'authorization-code', state: 'google-state' },
    session: {},
  } as unknown as Request;
}

function mockGoogleDiscovery() {
  const remoteConfig = {
    serverMetadata: vi.fn().mockReturnValue({
      issuer: 'https://accounts.google.com',
      scopesSupported: ['openid', 'profile', 'email'],
      claimsSupported: ['sub', 'email'],
    }),
  };
  openidClientMocks.discovery.mockResolvedValue(remoteConfig);
  return remoteConfig;
}

describe('GoogleSocialLogin', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  it('builds a PKCE authorization URL without logging transient secrets', async () => {
    const { logger, login, sessionManager, sessions } = createHarness();
    const req = {} as Request;
    sessions.set('socialLogin', {
      github: { state: 'github-state' },
    });
    mockGoogleDiscovery();
    openidClientMocks.randomState.mockReturnValue('google-sensitive-state');
    openidClientMocks.randomPKCECodeVerifier.mockReturnValue(
      'google-sensitive-verifier'
    );
    openidClientMocks.calculatePKCECodeChallenge.mockResolvedValue(
      'google-pkce-challenge'
    );
    openidClientMocks.buildAuthorizationUrl.mockImplementation(
      (_configuration, parameters) =>
        new URL(
          `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams(
            parameters
          )}`
        )
    );
    vi.spyOn(Date, 'now').mockReturnValue(123_456);

    const authorizationUrl = new URL(await login.getAuthorizationUrl(req));
    await login.getAuthorizationUrl(req);

    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth'
    );
    expect(Object.fromEntries(authorizationUrl.searchParams)).toEqual({
      redirect_uri: 'https://parako.example.test/auth/social/google/callback',
      scope: 'openid profile email',
      code_challenge: 'google-pkce-challenge',
      code_challenge_method: 'S256',
      state: 'google-sensitive-state',
      prompt: 'consent',
      access_type: 'offline',
    });
    expect(sessionManager.set).toHaveBeenCalledWith(req, 'socialLogin', {
      github: { state: 'github-state' },
      google: {
        state: 'google-sensitive-state',
        codeVerifier: 'google-sensitive-verifier',
        timestamp: 123_456,
      },
    });
    expect(openidClientMocks.discovery).toHaveBeenCalledTimes(1);
    const serializedLogs = JSON.stringify(logger.info.mock.calls);
    expect(serializedLogs).not.toContain('google-sensitive-state');
    expect(serializedLogs).not.toContain('google-se');
  });

  it('normalizes a non-Error Google discovery failure', async () => {
    const { logger, login } = createHarness();
    openidClientMocks.discovery.mockRejectedValue('discovery failed');

    await expect(login.getAuthorizationUrl({} as Request)).rejects.toThrow(
      'Failed to generate Google authorization URL'
    );
    expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
      context: 'google_oidc_client_init_failed',
      provider: 'google',
    });
  });

  it('preserves an Error from Google discovery when logging it', async () => {
    const { logger, login } = createHarness();
    const discoveryError = new Error('discovery failed');
    openidClientMocks.discovery.mockRejectedValue(discoveryError);

    await expect(login.getAuthorizationUrl({} as Request)).rejects.toThrow(
      'Failed to generate Google authorization URL'
    );
    expect(logger.error).toHaveBeenCalledWith(discoveryError, {
      context: 'google_oidc_client_init_failed',
      provider: 'google',
    });
  });

  it('normalizes a non-Error Google authorization URL failure', async () => {
    const { logger, login } = createHarness();
    mockGoogleDiscovery();
    openidClientMocks.randomPKCECodeVerifier.mockReturnValue('pkce-verifier');
    openidClientMocks.calculatePKCECodeChallenge.mockRejectedValue(
      'pkce failed'
    );

    await expect(login.getAuthorizationUrl({} as Request)).rejects.toThrow(
      'Failed to generate Google authorization URL'
    );
    expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
      context: 'google_oidc_authorization_url_failed',
      provider: 'google',
    });
  });

  it('rejects a callback without a code and clears only Google state', async () => {
    const { login, sessionManager, sessions } = createHarness();
    const req = createCallbackRequest();
    req.query = { state: 'google-state' };
    req.originalUrl = '/auth/social/google/callback?state=google-state';
    sessions.set('socialLogin', {
      github: { state: 'github-state' },
      google: { state: 'google-state', codeVerifier: 'pkce-verifier' },
    });
    mockGoogleDiscovery();

    await expect(login.handleCallback(req)).resolves.toEqual({
      success: false,
      error:
        'Invalid callback parameters - missing code, state, or session data',
    });
    expect(sessionManager.set).toHaveBeenLastCalledWith(req, 'socialLogin', {
      github: { state: 'github-state' },
    });
  });

  it('returns a valid-state provider denial before Google discovery', async () => {
    const { login, sessionManager, sessions } = createHarness();
    const req = createCallbackRequest();
    req.query = {
      error: 'access_denied',
      error_description: 'The user denied access',
      state: 'google-state',
    };
    req.originalUrl =
      '/auth/social/google/callback?error=access_denied&state=google-state';
    sessions.set('socialLogin', {
      github: { state: 'github-state' },
      google: { state: 'google-state', codeVerifier: 'pkce-verifier' },
    });

    await expect(login.handleCallback(req)).resolves.toEqual({
      success: false,
      error: 'You denied access to your Google account. Please try again.',
    });
    expect(openidClientMocks.discovery).not.toHaveBeenCalled();
    expect(openidClientMocks.authorizationCodeGrant).not.toHaveBeenCalled();
    expect(login.integrate).not.toHaveBeenCalled();
    expect(sessionManager.set).toHaveBeenLastCalledWith(req, 'socialLogin', {
      github: { state: 'github-state' },
    });
  });

  it('waits for user integration and clears only Google state after success', async () => {
    const { login, sessionManager, sessions } = createHarness();
    const req = createCallbackRequest();
    sessions.set('socialLogin', {
      github: { state: 'github-state' },
      google: { state: 'google-state', codeVerifier: 'pkce-verifier' },
    });
    mockGoogleDiscovery();
    openidClientMocks.authorizationCodeGrant.mockResolvedValue({
      access_token: 'google-access-token',
      token_type: 'bearer',
      expires_at: 123_456,
    });
    openidClientMocks.fetchProtectedResource.mockResolvedValue(
      new Response(
        JSON.stringify({
          sub: 'google-user-1',
          email: 'alice@example.test',
          email_verified: true,
          name: 'Alice Doe',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    login.integrate.mockResolvedValue({ success: true });

    await expect(login.handleCallback(req)).resolves.toEqual({ success: true });
    expect(sessionManager.set).toHaveBeenLastCalledWith(req, 'socialLogin', {
      github: { state: 'github-state' },
    });

    const directReq = createCallbackRequest();
    Object.defineProperty(directReq, 'get', {
      value: vi.fn((name: string) =>
        name === 'host' ? 'direct.example.test' : undefined
      ) as unknown as Request['get'],
      configurable: true,
    });
    Object.defineProperty(directReq, 'protocol', {
      value: 'https',
      configurable: true,
    });
    sessions.set('socialLogin', {
      google: { state: 'google-state', codeVerifier: 'pkce-verifier' },
    });
    openidClientMocks.fetchProtectedResource.mockResolvedValue(
      new Response(
        JSON.stringify({
          sub: 'google-user-1',
          email: 'alice@example.test',
          email_verified: true,
          name: 'Alice Doe',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await expect(login.handleCallback(directReq)).resolves.toEqual({
      success: true,
    });
    expect(openidClientMocks.authorizationCodeGrant).toHaveBeenLastCalledWith(
      expect.anything(),
      new URL(
        'https://direct.example.test/auth/social/google/callback?code=authorization-code&state=google-state'
      ),
      {
        pkceCodeVerifier: 'pkce-verifier',
        expectedState: 'google-state',
      }
    );
    expect(openidClientMocks.discovery).toHaveBeenCalledTimes(1);
  });

  it('rejects a token response without an access token before userinfo', async () => {
    const { login, sessions } = createHarness();
    const req = createCallbackRequest();
    sessions.set('socialLogin', {
      google: { state: 'google-state', codeVerifier: 'pkce-verifier' },
    });
    mockGoogleDiscovery();
    openidClientMocks.authorizationCodeGrant.mockResolvedValue({
      id_token: 'google-id-token',
      token_type: 'bearer',
    });

    await expect(login.handleCallback(req)).resolves.toMatchObject({
      success: false,
    });
    expect(openidClientMocks.fetchProtectedResource).not.toHaveBeenCalled();
    expect(login.integrate).not.toHaveBeenCalled();
  });

  it('handles a non-Error authorization-code exchange rejection', async () => {
    const { logger, login, sessions } = createHarness();
    const req = createCallbackRequest();
    sessions.set('socialLogin', {
      google: { state: 'google-state', codeVerifier: 'pkce-verifier' },
    });
    mockGoogleDiscovery();
    openidClientMocks.authorizationCodeGrant.mockRejectedValue(
      'exchange failed'
    );

    await expect(login.handleCallback(req)).resolves.toMatchObject({
      success: false,
    });
    expect(openidClientMocks.fetchProtectedResource).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        context: 'google_oidc_callback_exchange_failed',
        technicalError: 'exchange failed',
      })
    );
  });

  it('preserves an Error from Google authorization-code exchange', async () => {
    const { logger, login, sessions } = createHarness();
    const req = createCallbackRequest();
    const exchangeError = new Error('exchange failed');
    sessions.set('socialLogin', {
      google: { state: 'google-state', codeVerifier: 'pkce-verifier' },
    });
    mockGoogleDiscovery();
    openidClientMocks.authorizationCodeGrant.mockRejectedValue(exchangeError);

    await expect(login.handleCallback(req)).resolves.toMatchObject({
      success: false,
    });
    expect(logger.error).toHaveBeenCalledWith(
      exchangeError,
      expect.objectContaining({
        context: 'google_oidc_callback_exchange_failed',
        technicalError: 'exchange failed',
      })
    );
  });

  it('handles a non-Error Google userinfo rejection', async () => {
    const { logger, login, sessions } = createHarness();
    const req = createCallbackRequest();
    sessions.set('socialLogin', {
      google: { state: 'google-state', codeVerifier: 'pkce-verifier' },
    });
    mockGoogleDiscovery();
    openidClientMocks.authorizationCodeGrant.mockResolvedValue({
      access_token: 'google-access-token',
      token_type: 'bearer',
    });
    openidClientMocks.fetchProtectedResource.mockRejectedValue(
      'userinfo failed'
    );

    await expect(login.handleCallback(req)).resolves.toMatchObject({
      success: false,
    });
    expect(login.integrate).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        context: 'google_oidc_userinfo_failed',
        technicalError: 'userinfo failed',
      })
    );
  });

  it('does not integrate an error response from Google userinfo', async () => {
    const { login, sessions } = createHarness();
    const req = createCallbackRequest();
    sessions.set('socialLogin', {
      google: { state: 'google-state', codeVerifier: 'pkce-verifier' },
    });
    mockGoogleDiscovery();
    openidClientMocks.authorizationCodeGrant.mockResolvedValue({
      access_token: 'google-access-token',
      token_type: 'bearer',
    });
    openidClientMocks.fetchProtectedResource.mockResolvedValue(
      new Response(
        JSON.stringify({
          sub: 'untrusted-error-subject',
          error: 'invalid_token',
        }),
        {
          status: 401,
          statusText: 'Unauthorized',
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    await expect(login.handleCallback(req)).resolves.toMatchObject({
      success: false,
    });
    expect(login.integrate).not.toHaveBeenCalled();
  });

  it('handles a non-Error Google user-integration rejection', async () => {
    const { logger, login, sessions } = createHarness();
    const req = createCallbackRequest();
    sessions.set('socialLogin', {
      google: { state: 'google-state', codeVerifier: 'pkce-verifier' },
    });
    mockGoogleDiscovery();
    openidClientMocks.authorizationCodeGrant.mockResolvedValue({
      access_token: 'google-access-token',
      token_type: 'bearer',
    });
    openidClientMocks.fetchProtectedResource.mockResolvedValue(
      new Response(
        JSON.stringify({
          sub: 'google-user-1',
          email: 'alice@example.test',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    login.integrate.mockRejectedValue('integration failed');

    await expect(login.handleCallback(req)).resolves.toMatchObject({
      success: false,
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        context: 'google_oidc_callback_failed',
        errorMessage: 'integration failed',
      })
    );
  });

  it('rejects Google userinfo without a stable subject identifier', async () => {
    const { login, sessions } = createHarness();
    const req = createCallbackRequest();
    sessions.set('socialLogin', {
      google: { state: 'google-state', codeVerifier: 'pkce-verifier' },
    });
    mockGoogleDiscovery();
    openidClientMocks.authorizationCodeGrant.mockResolvedValue({
      access_token: 'google-access-token',
      token_type: 'bearer',
    });
    openidClientMocks.fetchProtectedResource.mockResolvedValue(
      new Response(JSON.stringify({ email: 'alice@example.test' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(login.handleCallback(req)).resolves.toMatchObject({
      success: false,
    });
    expect(login.integrate).not.toHaveBeenCalled();
  });

  it('does not trust truthy non-boolean Google verification claims', () => {
    const { login } = createHarness();

    expect(
      login.mapProviderUserData({
        sub: 'google-user-1',
        email_verified: 'false',
        verified_email: 'true',
      }).email_verified
    ).toBe(false);
  });

  it('ignores malformed Google token expiry metadata', () => {
    const { login } = createHarness();

    expect(
      login.mapTokenData({
        access_token: 'google-access-token',
        expires_at: 'not-a-number',
      })
    ).toMatchObject({
      access_token: 'google-access-token',
      token_type: 'Bearer',
      expires_at: undefined,
    });
  });

  it('returns null when a Google integration has no refresh token', async () => {
    const { logger, login, socialIntegrationService } = createHarness();
    mockGoogleDiscovery();
    socialIntegrationService.findById.mockResolvedValue({
      tokens: { access_token: 'existing-access-token' },
    });

    await expect(login.refreshToken('integration-1')).resolves.toBeNull();
    expect(openidClientMocks.refreshTokenGrant).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'No refresh token available for Google integration',
      { integrationId: 'integration-1' }
    );
  });

  it('refreshes and persists Google integration tokens', async () => {
    const { login, socialIntegrationService } = createHarness();
    mockGoogleDiscovery();
    socialIntegrationService.findById.mockResolvedValue({
      tokens: { refresh_token: 'existing-refresh-token' },
    });
    openidClientMocks.refreshTokenGrant.mockResolvedValue({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      id_token: 'new-id-token',
      token_type: 'bearer',
      expires_at: 123_456,
      scope: 'openid profile email',
    });

    await expect(login.refreshToken('integration-1')).resolves.toEqual({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      id_token: 'new-id-token',
      token_type: 'bearer',
      expires_at: new Date(123_456_000),
      scope: 'openid profile email',
    });
    expect(openidClientMocks.refreshTokenGrant).toHaveBeenCalledWith(
      expect.anything(),
      'existing-refresh-token'
    );
    expect(socialIntegrationService.updateTokens).toHaveBeenCalledWith(
      'integration-1',
      expect.objectContaining({ access_token: 'new-access-token' })
    );
    await expect(login.refreshToken('integration-1')).resolves.toMatchObject({
      access_token: 'new-access-token',
    });
    expect(openidClientMocks.discovery).toHaveBeenCalledTimes(1);
  });

  it('normalizes a non-Error Google refresh failure', async () => {
    const { logger, login, socialIntegrationService } = createHarness();
    mockGoogleDiscovery();
    socialIntegrationService.findById.mockResolvedValue({
      tokens: { refresh_token: 'existing-refresh-token' },
    });
    openidClientMocks.refreshTokenGrant.mockRejectedValue('refresh failed');

    await expect(login.refreshToken('integration-1')).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
      context: 'google_token_refresh_failed',
      integrationId: 'integration-1',
    });
  });

  it('preserves an Error from Google token refresh', async () => {
    const { logger, login, socialIntegrationService } = createHarness();
    const refreshError = new Error('refresh failed');
    mockGoogleDiscovery();
    socialIntegrationService.findById.mockResolvedValue({
      tokens: { refresh_token: 'existing-refresh-token' },
    });
    openidClientMocks.refreshTokenGrant.mockRejectedValue(refreshError);

    await expect(login.refreshToken('integration-1')).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalledWith(refreshError, {
      context: 'google_token_refresh_failed',
      integrationId: 'integration-1',
    });
  });

  it('does not expose a Google revocation error response body', async () => {
    const { login } = createHarness();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('access_token=leaked-token', {
          status: 400,
          statusText: 'Bad Request',
        })
      )
    );

    const error = await login
      .revoke('google-access-token')
      .catch(value => value);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('400');
    expect((error as Error).message).not.toContain('leaked-token');
  });

  it('revokes a Google access token without placing it in headers', async () => {
    const { logger, login } = createHarness();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(login.revoke('google-access-token')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/revoke?token=google-access-token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Google token revoked successfully',
      { provider: 'google' }
    );
  });
});
