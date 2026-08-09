import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

import type { IConfigManager } from '../../../src/di/interfaces/config-manager.interface.js';
import type { ILogger } from '../../../src/di/interfaces/logger.interface.js';
import { SocialLoginManager } from '../../../src/integration/social-login-manager.js';
import type {
  ISocialIntegration,
  ProviderUserData,
  SocialProvider,
  TokenData,
} from '../../../src/types/social-integration.js';

const providersInManagerOrder: SocialProvider[] = [
  'google',
  'github',
  'microsoft',
  'linkedin',
  'facebook',
];

function createProvider() {
  return {
    getAuthorizationUrl: vi.fn(),
    handleCallback: vi.fn(),
    linkToUser: vi.fn(),
    unlinkFromUser: vi.fn(),
    getSocialIntegrations: vi.fn(),
    completeExternalAuth: vi.fn(),
    mapProviderUserData: vi.fn(),
    mapTokenData: vi.fn(),
  };
}

function createConfig(enabled: SocialProvider[] = providersInManagerOrder) {
  return {
    features: {
      social_providers: {
        enabled,
        google: { client_id: 'google-id', client_secret: 'google-secret' },
        github: { client_id: 'github-id', client_secret: 'github-secret' },
        microsoft: {
          client_id: 'microsoft-id',
          client_secret: 'microsoft-secret',
        },
        linkedin: {
          client_id: 'linkedin-id',
          client_secret: 'linkedin-secret',
        },
        facebook: {
          client_id: 'facebook-id',
          client_secret: 'facebook-secret',
        },
      },
    },
  };
}

function createManager(
  config = createConfig(),
  getConfig = vi.fn().mockReturnValue(config)
) {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as ILogger;
  const configManager = {
    getConfig,
  } as unknown as IConfigManager;
  const providers = {
    github: createProvider(),
    google: createProvider(),
    microsoft: createProvider(),
    linkedin: createProvider(),
    facebook: createProvider(),
  };
  const manager = new SocialLoginManager(
    logger,
    configManager,
    providers.github,
    providers.google,
    providers.microsoft,
    providers.linkedin,
    providers.facebook
  );

  return { configManager, logger, manager, providers };
}

describe('SocialLoginManager', () => {
  it('does not enable a provider with whitespace-only credentials', () => {
    const config = createConfig(['google']);
    config.features.social_providers.google = {
      client_id: '   ',
      client_secret: '\t',
    };
    const { manager } = createManager(config);

    expect(manager.isProviderAvailable('google')).toBe(false);
    expect(manager.getAvailableProviders()).toEqual([]);
  });

  it('registers each enabled configured provider with its own implementation', () => {
    const { manager, providers } = createManager();

    expect(manager.getAvailableProviders()).toEqual(providersInManagerOrder);
    expect(manager.getProvider('google')).toBe(providers.google);
    expect(manager.getProvider('github')).toBe(providers.github);
    expect(manager.getProvider('microsoft')).toBe(providers.microsoft);
    expect(manager.getProvider('linkedin')).toBe(providers.linkedin);
    expect(manager.getProvider('facebook')).toBe(providers.facebook);
  });

  it('handles unavailable providers according to each public method contract', async () => {
    const { manager } = createManager(createConfig([]));
    const req = {} as Request;
    const providerData = { sub: 'subject-1' } as ProviderUserData;
    const tokens = { access_token: 'access-token' } as TokenData;
    const unavailable = 'Provider google is not available';

    expect(manager.getProvider('google')).toBeUndefined();
    expect(manager.isProviderAvailable('google')).toBe(false);
    await expect(manager.getAuthorizationUrl('google', req)).rejects.toThrow(
      unavailable
    );
    await expect(manager.handleCallback('google', req)).resolves.toEqual({
      success: false,
      error: unavailable,
    });
    await expect(
      manager.linkToUser('google', 'user-1', providerData, tokens)
    ).rejects.toThrow(unavailable);
    await expect(manager.unlinkFromUser('google', 'user-1')).rejects.toThrow(
      unavailable
    );
    await expect(
      manager.getUserIntegrations('google', 'user-1')
    ).rejects.toThrow(unavailable);
    await expect(
      manager.completeTier1Flow('google', providerData, tokens, req)
    ).resolves.toEqual({ success: false, error: unavailable });
  });

  it('delegates available-provider operations with their inputs unchanged', async () => {
    const { manager, providers } = createManager(createConfig(['google']));
    const req = { query: { code: 'authorization-code' } } as unknown as Request;
    const providerData = {
      sub: 'subject-1',
      email: 'user@example.test',
    } as ProviderUserData;
    const tokens = { access_token: 'access-token' } as TokenData;
    const integration = { _id: 'integration-1' } as ISocialIntegration;
    const callbackResult = { success: true, integration };
    const tier1Result = { success: true, integration };

    providers.google.getAuthorizationUrl.mockResolvedValue(
      'https://accounts.example.test/authorize'
    );
    providers.google.handleCallback.mockResolvedValue(callbackResult);
    providers.google.linkToUser.mockResolvedValue(integration);
    providers.google.unlinkFromUser.mockResolvedValue(undefined);
    providers.google.getSocialIntegrations.mockResolvedValue([integration]);
    providers.google.completeExternalAuth.mockResolvedValue(tier1Result);

    await expect(manager.getAuthorizationUrl('google', req)).resolves.toBe(
      'https://accounts.example.test/authorize'
    );
    expect(providers.google.getAuthorizationUrl).toHaveBeenCalledWith(req);
    await expect(manager.handleCallback('google', req)).resolves.toBe(
      callbackResult
    );
    expect(providers.google.handleCallback).toHaveBeenCalledWith(req);
    await expect(
      manager.linkToUser('google', 'user-1', providerData, tokens)
    ).resolves.toBe(integration);
    expect(providers.google.linkToUser).toHaveBeenCalledWith(
      'user-1',
      providerData,
      tokens
    );
    await expect(
      manager.unlinkFromUser('google', 'user-1')
    ).resolves.toBeUndefined();
    expect(providers.google.unlinkFromUser).toHaveBeenCalledWith('user-1');
    await expect(
      manager.getUserIntegrations('google', 'user-1')
    ).resolves.toEqual([integration]);
    expect(providers.google.getSocialIntegrations).toHaveBeenCalledWith(
      'user-1'
    );
    await expect(
      manager.completeTier1Flow('google', providerData, tokens, req)
    ).resolves.toBe(tier1Result);
    expect(providers.google.completeExternalAuth).toHaveBeenCalledWith(
      providerData,
      tokens,
      req
    );
  });

  it('logs and contains a top-level configuration load failure', () => {
    const loadError = new Error('configuration unavailable');
    const getConfig = vi.fn(() => {
      throw loadError;
    });
    const { logger, manager } = createManager(createConfig(), getConfig);

    expect(manager.getAvailableProviders()).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(loadError, {
      context: 'social_login_manager_initialization_failed',
    });
  });

  it('warns and skips a provider when its configuration check fails', () => {
    const config = createConfig(['google']);
    const checkError = new Error('credential source unavailable');
    const getConfig = vi
      .fn()
      .mockReturnValueOnce(config)
      .mockImplementationOnce(() => {
        throw checkError;
      });
    const { logger, manager } = createManager(config, getConfig);

    expect(manager.getAvailableProviders()).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to check configuration for provider google',
      {
        provider: 'google',
        error: checkError.message,
      }
    );
    expect(logger.error).not.toHaveBeenCalled();
  });
});
