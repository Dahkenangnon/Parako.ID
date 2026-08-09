import type { Request } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IConfigManager } from '../../../src/di/interfaces/config-manager.interface.js';
import type { ILogger } from '../../../src/di/interfaces/logger.interface.js';
import type { ISessionManager } from '../../../src/di/interfaces/session-manager.interface.js';
import type { ISocialIntegrationService } from '../../../src/di/interfaces/social-integration-service.interface.js';
import type { IUserService } from '../../../src/di/interfaces/user-service.interface.js';
import type { SocialLoginResult } from '../../../src/di/interfaces/base-social-login.interface.js';
import { MicrosoftSocialLogin } from '../../../src/integration/microsoft-social-login.js';
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

class TestMicrosoftSocialLogin extends MicrosoftSocialLogin {
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
        microsoft: {
          client_id: 'microsoft-client',
          client_secret: 'microsoft-secret',
          discovery_url:
            'https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration',
          scopes: ['openid', 'profile', 'email', 'offline_access'],
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
  const login = new TestMicrosoftSocialLogin(
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
      '/auth/social/microsoft/callback?code=authorization-code&state=microsoft-state',
    params: { provider: 'microsoft' },
    protocol: 'http',
    query: { code: 'authorization-code', state: 'microsoft-state' },
    session: {},
  } as unknown as Request;
}

function mockMicrosoftDiscovery() {
  const remoteConfig = {
    serverMetadata: vi.fn().mockReturnValue({
      issuer: 'https://login.microsoftonline.com/common/v2.0',
      scopesSupported: ['openid', 'profile', 'email', 'offline_access'],
      claimsSupported: ['sub', 'email', 'oid', 'tid'],
    }),
  };
  openidClientMocks.discovery.mockResolvedValue(remoteConfig);
  return remoteConfig;
}

describe('MicrosoftSocialLogin', () => {
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
    mockMicrosoftDiscovery();
    openidClientMocks.randomState.mockReturnValue('microsoft-sensitive-state');
    openidClientMocks.randomPKCECodeVerifier.mockReturnValue(
      'microsoft-sensitive-verifier'
    );
    openidClientMocks.calculatePKCECodeChallenge.mockResolvedValue(
      'microsoft-pkce-challenge'
    );
    openidClientMocks.buildAuthorizationUrl.mockImplementation(
      (_configuration, parameters) =>
        new URL(
          `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${new URLSearchParams(
            parameters
          )}`
        )
    );
    vi.spyOn(Date, 'now').mockReturnValue(123_456);

    const authorizationUrl = new URL(await login.getAuthorizationUrl(req));

    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
    );
    expect(Object.fromEntries(authorizationUrl.searchParams)).toEqual({
      redirect_uri:
        'https://parako.example.test/auth/social/microsoft/callback',
      scope: 'openid profile email offline_access',
      code_challenge: 'microsoft-pkce-challenge',
      code_challenge_method: 'S256',
      state: 'microsoft-sensitive-state',
      prompt: 'consent',
      response_mode: 'query',
    });
    expect(sessionManager.set).toHaveBeenCalledWith(req, 'socialLogin', {
      github: { state: 'github-state' },
      microsoft: {
        state: 'microsoft-sensitive-state',
        codeVerifier: 'microsoft-sensitive-verifier',
        timestamp: 123_456,
      },
    });
    expect(openidClientMocks.discovery).toHaveBeenCalledWith(
      new URL('https://login.microsoftonline.com/common/v2.0'),
      'microsoft-client',
      'microsoft-secret'
    );
    const serializedLogs = JSON.stringify(logger.info.mock.calls);
    expect(serializedLogs).not.toContain('microsoft-sensitive-state');
    expect(serializedLogs).not.toContain('microsoft-se');
  });

  it('reuses Microsoft discovery metadata across authorization requests', async () => {
    const { login } = createHarness();
    mockMicrosoftDiscovery();
    openidClientMocks.randomState.mockReturnValue('microsoft-state');
    openidClientMocks.randomPKCECodeVerifier.mockReturnValue('pkce-verifier');
    openidClientMocks.calculatePKCECodeChallenge.mockResolvedValue(
      'pkce-challenge'
    );
    openidClientMocks.buildAuthorizationUrl.mockReturnValue(
      new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize')
    );

    await login.getAuthorizationUrl({} as Request);
    await login.getAuthorizationUrl({} as Request);

    expect(openidClientMocks.discovery).toHaveBeenCalledTimes(1);
  });

  it('accepts a Microsoft issuer URL directly as discovery configuration', async () => {
    const { config, login } = createHarness();
    config.features.social_providers.microsoft.discovery_url =
      'https://login.microsoftonline.com/organizations/v2.0';
    mockMicrosoftDiscovery();
    openidClientMocks.randomState.mockReturnValue('microsoft-state');
    openidClientMocks.randomPKCECodeVerifier.mockReturnValue('pkce-verifier');
    openidClientMocks.calculatePKCECodeChallenge.mockResolvedValue(
      'pkce-challenge'
    );
    openidClientMocks.buildAuthorizationUrl.mockReturnValue(
      new URL('https://login.microsoftonline.com/oauth2/v2.0/authorize')
    );

    await login.getAuthorizationUrl({} as Request);

    expect(openidClientMocks.discovery).toHaveBeenCalledWith(
      new URL('https://login.microsoftonline.com/organizations/v2.0'),
      'microsoft-client',
      'microsoft-secret'
    );
  });

  it('uses the Microsoft common issuer when discovery configuration is empty', async () => {
    const { config, login } = createHarness();
    config.features.social_providers.microsoft.discovery_url = '';
    mockMicrosoftDiscovery();
    openidClientMocks.randomState.mockReturnValue('microsoft-state');
    openidClientMocks.randomPKCECodeVerifier.mockReturnValue('pkce-verifier');
    openidClientMocks.calculatePKCECodeChallenge.mockResolvedValue(
      'pkce-challenge'
    );
    openidClientMocks.buildAuthorizationUrl.mockReturnValue(
      new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize')
    );

    await login.getAuthorizationUrl({} as Request);

    expect(openidClientMocks.discovery).toHaveBeenCalledWith(
      new URL('https://login.microsoftonline.com/common/v2.0'),
      'microsoft-client',
      'microsoft-secret'
    );
  });

  it('normalizes a non-Error Microsoft discovery failure', async () => {
    const { logger, login } = createHarness();
    openidClientMocks.discovery.mockRejectedValue('discovery failed');

    await expect(login.getAuthorizationUrl({} as Request)).rejects.toThrow(
      'Failed to generate Microsoft authorization URL'
    );
    expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
      context: 'microsoft_oidc_client_init_failed',
      provider: 'microsoft',
    });
  });

  it('reports an Error from Microsoft discovery through the public failure', async () => {
    const { logger, login } = createHarness();
    const discoveryError = new Error('discovery failed');
    openidClientMocks.discovery.mockRejectedValue(discoveryError);

    await expect(login.getAuthorizationUrl({} as Request)).rejects.toThrow(
      'Failed to generate Microsoft authorization URL'
    );
    expect(logger.error).toHaveBeenCalledWith(discoveryError, {
      context: 'microsoft_oidc_client_init_failed',
      provider: 'microsoft',
    });
  });

  it('normalizes a non-Error Microsoft authorization URL failure', async () => {
    const { logger, login } = createHarness();
    mockMicrosoftDiscovery();
    openidClientMocks.randomPKCECodeVerifier.mockReturnValue('pkce-verifier');
    openidClientMocks.calculatePKCECodeChallenge.mockRejectedValue(
      'pkce failed'
    );

    await expect(login.getAuthorizationUrl({} as Request)).rejects.toThrow(
      'Failed to generate Microsoft authorization URL'
    );
    expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
      context: 'microsoft_oidc_authorization_url_failed',
      provider: 'microsoft',
    });
  });

  it('rejects a callback without a code and clears only Microsoft state', async () => {
    const { login, sessionManager, sessions } = createHarness();
    const req = createCallbackRequest();
    req.query = { state: 'microsoft-state' };
    req.originalUrl = '/auth/social/microsoft/callback?state=microsoft-state';
    sessions.set('socialLogin', {
      github: { state: 'github-state' },
      microsoft: {
        state: 'microsoft-state',
        codeVerifier: 'pkce-verifier',
      },
    });
    mockMicrosoftDiscovery();

    await expect(login.handleCallback(req)).resolves.toEqual({
      success: false,
      error:
        'Invalid callback parameters - missing code, state, or session data',
    });
    expect(sessionManager.set).toHaveBeenLastCalledWith(req, 'socialLogin', {
      github: { state: 'github-state' },
    });
  });

  it('waits for user integration and clears only Microsoft state after success', async () => {
    const { login, sessionManager, sessions } = createHarness();
    const req = createCallbackRequest();
    sessions.set('socialLogin', {
      github: { state: 'github-state' },
      microsoft: {
        state: 'microsoft-state',
        codeVerifier: 'pkce-verifier',
      },
    });
    mockMicrosoftDiscovery();
    openidClientMocks.authorizationCodeGrant.mockResolvedValue({
      access_token: 'microsoft-access-token',
      token_type: 'bearer',
      expires_at: 123_456,
    });
    openidClientMocks.fetchProtectedResource.mockResolvedValue(
      new Response(
        JSON.stringify({
          sub: 'microsoft-user-1',
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
  });

  it('reuses the Microsoft client and reconstructs callbacks without forwarded headers', async () => {
    const { login } = createHarness();
    const remoteConfig = mockMicrosoftDiscovery();
    openidClientMocks.randomState.mockReturnValue('microsoft-state');
    openidClientMocks.randomPKCECodeVerifier.mockReturnValue('pkce-verifier');
    openidClientMocks.calculatePKCECodeChallenge.mockResolvedValue(
      'pkce-challenge'
    );
    openidClientMocks.buildAuthorizationUrl.mockReturnValue(
      new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize')
    );
    await login.getAuthorizationUrl({} as Request);

    const req = createCallbackRequest();
    Object.defineProperty(req, 'protocol', {
      value: 'https',
      configurable: true,
    });
    Object.defineProperty(req, 'get', {
      value: vi.fn((name: string) =>
        name === 'host' ? 'direct.example.test' : undefined
      ) as unknown as Request['get'],
      configurable: true,
    });
    openidClientMocks.authorizationCodeGrant.mockResolvedValue({
      access_token: 'microsoft-access-token',
      token_type: 'bearer',
    });
    openidClientMocks.fetchProtectedResource.mockResolvedValue(
      new Response(JSON.stringify({ sub: 'microsoft-user-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    login.integrate.mockResolvedValue({ success: true });

    await expect(login.handleCallback(req)).resolves.toEqual({ success: true });
    expect(openidClientMocks.discovery).toHaveBeenCalledTimes(1);
    expect(openidClientMocks.authorizationCodeGrant).toHaveBeenCalledWith(
      remoteConfig,
      new URL(
        'https://direct.example.test/auth/social/microsoft/callback?code=authorization-code&state=microsoft-state'
      ),
      {
        pkceCodeVerifier: 'pkce-verifier',
        expectedState: 'microsoft-state',
      }
    );
  });

  it('does not mark a Microsoft email verified without an explicit claim', () => {
    const { login } = createHarness();

    expect(
      login.mapProviderUserData({
        sub: 'microsoft-user-1',
        email: 'alice@example.test',
      }).email_verified
    ).toBe(false);
  });

  it('rejects Microsoft userinfo without a stable subject identifier', async () => {
    const { login, sessions } = createHarness();
    const req = createCallbackRequest();
    sessions.set('socialLogin', {
      microsoft: {
        state: 'microsoft-state',
        codeVerifier: 'pkce-verifier',
      },
    });
    mockMicrosoftDiscovery();
    openidClientMocks.authorizationCodeGrant.mockResolvedValue({
      access_token: 'microsoft-access-token',
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

  it('rejects a Microsoft token response without an access token before userinfo', async () => {
    const { login, sessions } = createHarness();
    const req = createCallbackRequest();
    sessions.set('socialLogin', {
      microsoft: {
        state: 'microsoft-state',
        codeVerifier: 'pkce-verifier',
      },
    });
    mockMicrosoftDiscovery();
    openidClientMocks.authorizationCodeGrant.mockResolvedValue({
      id_token: 'microsoft-id-token',
      token_type: 'bearer',
    });

    await expect(login.handleCallback(req)).resolves.toMatchObject({
      success: false,
    });
    expect(openidClientMocks.fetchProtectedResource).not.toHaveBeenCalled();
    expect(login.integrate).not.toHaveBeenCalled();
  });

  it('does not integrate an error response from Microsoft userinfo', async () => {
    const { login, sessions } = createHarness();
    const req = createCallbackRequest();
    sessions.set('socialLogin', {
      microsoft: {
        state: 'microsoft-state',
        codeVerifier: 'pkce-verifier',
      },
    });
    mockMicrosoftDiscovery();
    openidClientMocks.authorizationCodeGrant.mockResolvedValue({
      access_token: 'microsoft-access-token',
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

  it('handles a non-Error Microsoft authorization-code exchange rejection', async () => {
    const { logger, login, sessions } = createHarness();
    const req = createCallbackRequest();
    sessions.set('socialLogin', {
      microsoft: {
        state: 'microsoft-state',
        codeVerifier: 'pkce-verifier',
      },
    });
    mockMicrosoftDiscovery();
    openidClientMocks.authorizationCodeGrant.mockRejectedValue(
      'exchange failed'
    );

    await expect(login.handleCallback(req)).resolves.toMatchObject({
      success: false,
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        context: 'microsoft_oidc_callback_exchange_failed',
        technicalError: 'exchange failed',
      })
    );
  });

  it('preserves an Error from the Microsoft authorization-code exchange', async () => {
    const { logger, login, sessions } = createHarness();
    const req = createCallbackRequest();
    sessions.set('socialLogin', {
      microsoft: {
        state: 'microsoft-state',
        codeVerifier: 'pkce-verifier',
      },
    });
    mockMicrosoftDiscovery();
    const exchangeError = new Error('exchange failed');
    openidClientMocks.authorizationCodeGrant.mockRejectedValue(exchangeError);

    await expect(login.handleCallback(req)).resolves.toMatchObject({
      success: false,
    });
    expect(logger.error).toHaveBeenCalledWith(
      exchangeError,
      expect.objectContaining({
        context: 'microsoft_oidc_callback_exchange_failed',
        technicalError: 'exchange failed',
      })
    );
  });

  it('handles a non-Error Microsoft userinfo rejection', async () => {
    const { logger, login, sessions } = createHarness();
    const req = createCallbackRequest();
    sessions.set('socialLogin', {
      microsoft: {
        state: 'microsoft-state',
        codeVerifier: 'pkce-verifier',
      },
    });
    mockMicrosoftDiscovery();
    openidClientMocks.authorizationCodeGrant.mockResolvedValue({
      access_token: 'microsoft-access-token',
      token_type: 'bearer',
    });
    openidClientMocks.fetchProtectedResource.mockRejectedValue(
      'userinfo failed'
    );

    await expect(login.handleCallback(req)).resolves.toMatchObject({
      success: false,
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        context: 'microsoft_oidc_userinfo_failed',
        technicalError: 'userinfo failed',
      })
    );
  });

  it('handles a non-Error Microsoft user-integration rejection', async () => {
    const { logger, login, sessions } = createHarness();
    const req = createCallbackRequest();
    sessions.set('socialLogin', {
      microsoft: {
        state: 'microsoft-state',
        codeVerifier: 'pkce-verifier',
      },
    });
    mockMicrosoftDiscovery();
    openidClientMocks.authorizationCodeGrant.mockResolvedValue({
      access_token: 'microsoft-access-token',
      token_type: 'bearer',
    });
    openidClientMocks.fetchProtectedResource.mockResolvedValue(
      new Response(
        JSON.stringify({
          sub: 'microsoft-user-1',
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
        context: 'microsoft_oidc_callback_failed',
        errorMessage: 'integration failed',
      })
    );
  });

  it('ignores malformed Microsoft token expiry metadata', () => {
    const { login } = createHarness();

    expect(
      login.mapTokenData({
        access_token: 'microsoft-access-token',
        expires_at: 'not-a-number',
      })
    ).toMatchObject({
      access_token: 'microsoft-access-token',
      token_type: 'Bearer',
      expires_at: undefined,
    });
  });

  it('maps Microsoft OIDC profile fields into the provider contract', () => {
    const { login } = createHarness();

    expect(
      login.mapProviderUserData({
        sub: '  microsoft-user-1  ',
        email: 'alice@example.test',
        email_verified: true,
        name: 'Alice Doe',
        given_name: 'Alice',
        family_name: 'Doe',
        picture: 'https://graph.microsoft.test/alice.png',
        locale: 'fr-BJ',
        preferred_username: 'alice@tenant.example',
        oid: 'object-id',
        tid: 'tenant-id',
      })
    ).toEqual({
      sub: 'microsoft-user-1',
      email: 'alice@example.test',
      email_verified: true,
      name: 'Alice Doe',
      given_name: 'Alice',
      family_name: 'Doe',
      picture: 'https://graph.microsoft.test/alice.png',
      locale: 'fr-BJ',
      provider_username: 'alice@tenant.example',
      raw_data: {
        oid: 'object-id',
        tid: 'tenant-id',
        preferred_username: 'alice@tenant.example',
      },
    });
  });

  it('falls back to the Microsoft email prefix for the provider username', () => {
    const { login } = createHarness();

    expect(
      login.mapProviderUserData({
        sub: 'microsoft-user-1',
        email: 'alice@example.test',
      }).provider_username
    ).toBe('alice');
  });

  it('maps complete Microsoft token metadata', () => {
    const { login } = createHarness();

    expect(
      login.mapTokenData({
        access_token: 'microsoft-access-token',
        refresh_token: 'microsoft-refresh-token',
        id_token: 'microsoft-id-token',
        token_type: 'DPoP',
        expires_at: 123_456,
        scope: 'openid profile email offline_access',
      })
    ).toEqual({
      access_token: 'microsoft-access-token',
      refresh_token: 'microsoft-refresh-token',
      id_token: 'microsoft-id-token',
      token_type: 'DPoP',
      expires_at: new Date(123_456_000),
      scope: 'openid profile email offline_access',
    });
  });

  it('returns null when a Microsoft integration has no refresh token', async () => {
    const { logger, login, socialIntegrationService } = createHarness();
    mockMicrosoftDiscovery();
    socialIntegrationService.findById.mockResolvedValue({
      tokens: { access_token: 'existing-access-token' },
    });

    await expect(login.refreshToken('integration-1')).resolves.toBeNull();
    expect(openidClientMocks.refreshTokenGrant).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'No refresh token available for Microsoft integration',
      { integrationId: 'integration-1' }
    );
  });

  it('refreshes and persists Microsoft integration tokens', async () => {
    const { login, socialIntegrationService } = createHarness();
    mockMicrosoftDiscovery();
    socialIntegrationService.findById.mockResolvedValue({
      tokens: { refresh_token: 'existing-refresh-token' },
    });
    openidClientMocks.refreshTokenGrant.mockResolvedValue({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      id_token: 'new-id-token',
      token_type: 'bearer',
      expires_at: 123_456,
      scope: 'openid profile email offline_access',
    });

    await expect(login.refreshToken('integration-1')).resolves.toEqual({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      id_token: 'new-id-token',
      token_type: 'bearer',
      expires_at: new Date(123_456_000),
      scope: 'openid profile email offline_access',
    });
    await expect(login.refreshToken('integration-1')).resolves.toMatchObject({
      access_token: 'new-access-token',
    });
    expect(openidClientMocks.discovery).toHaveBeenCalledTimes(1);
    expect(socialIntegrationService.updateTokens).toHaveBeenCalledWith(
      'integration-1',
      expect.objectContaining({ access_token: 'new-access-token' })
    );
  });

  it('normalizes a non-Error Microsoft refresh failure', async () => {
    const { logger, login, socialIntegrationService } = createHarness();
    mockMicrosoftDiscovery();
    socialIntegrationService.findById.mockResolvedValue({
      tokens: { refresh_token: 'existing-refresh-token' },
    });
    openidClientMocks.refreshTokenGrant.mockRejectedValue('refresh failed');

    await expect(login.refreshToken('integration-1')).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
      context: 'microsoft_token_refresh_failed',
      integrationId: 'integration-1',
    });
  });

  it('preserves an Error from Microsoft token refresh', async () => {
    const { logger, login, socialIntegrationService } = createHarness();
    mockMicrosoftDiscovery();
    socialIntegrationService.findById.mockResolvedValue({
      tokens: { refresh_token: 'existing-refresh-token' },
    });
    const refreshError = new Error('refresh failed');
    openidClientMocks.refreshTokenGrant.mockRejectedValue(refreshError);

    await expect(login.refreshToken('integration-1')).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalledWith(refreshError, {
      context: 'microsoft_token_refresh_failed',
      integrationId: 'integration-1',
    });
  });

  it('documents that Microsoft access must be revoked by the user', async () => {
    const { logger, login } = createHarness();

    await expect(
      login.revoke('microsoft-access-token')
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Microsoft does not support programmatic token revocation'
      ),
      { provider: 'microsoft' }
    );
  });
});
