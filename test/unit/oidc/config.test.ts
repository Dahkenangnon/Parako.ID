import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetch as undiciFetch } from 'undici';

import { getDefaultFullConfig } from '../../../src/config/constants.js';
import OIDCConfig from '../../../src/oidc/config.js';

function createLogger() {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

describe('OIDCConfig', () => {
  let findAllDbClients: ReturnType<typeof vi.fn>;
  let keyStore: { getJWKS: ReturnType<typeof vi.fn> };
  let oidcConfig: OIDCConfig;

  beforeEach(() => {
    const config = getDefaultFullConfig();
    const configManager = {
      getConfig: vi.fn(() => config),
    };
    const logger = createLogger();
    const clientRegistryManager = {
      getOidcProviderClients: vi.fn(() => []),
    };
    const clientMerger = {
      mergeClients: vi.fn(() => []),
    };
    keyStore = {
      getJWKS: vi.fn().mockResolvedValue({
        keys: [{ kty: 'RSA', kid: 'tenant-signing-key' }],
      }),
    };
    findAllDbClients = vi.fn().mockResolvedValue([]);
    const oidcAdapterBridge = {
      get isInitialized() {
        return true;
      },
      client: {
        findAllClients: findAllDbClients,
      },
    };

    oidcConfig = new OIDCConfig(
      configManager as any,
      logger as any,
      clientRegistryManager as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      clientMerger as any,
      {} as any,
      keyStore as any,
      oidcAdapterBridge as any
    );
  });

  it('retrieves the active tenant JWKS from the key store', async () => {
    await expect(oidcConfig.getJwks()).resolves.toEqual({
      keys: [{ kty: 'RSA', kid: 'tenant-signing-key' }],
    });
    expect(keyStore.getJWKS).toHaveBeenCalledOnce();
    expect(keyStore.getJWKS).toHaveBeenCalledWith();
  });

  it('assembles the complete provider configuration from runtime config', () => {
    const runtimeConfig = getDefaultFullConfig();
    const configuration = oidcConfig.getConfig() as any;

    expect(configuration).toEqual(
      expect.objectContaining({
        acceptQueryParamAccessTokens:
          runtimeConfig.features.oidc.accept_query_param_access_tokens,
        claims: runtimeConfig.features.oidc.claims,
        clients: [],
        routes: expect.objectContaining({
          authorization: runtimeConfig.oidc.routes.authorization,
          token: runtimeConfig.oidc.routes.token,
        }),
        scopes: runtimeConfig.features.oidc.scopes,
        subjectTypes: runtimeConfig.features.oidc.subject_types,
      })
    );
    expect(configuration.features.resourceIndicators).toEqual(
      expect.objectContaining({
        enabled: runtimeConfig.features.oidc.resource_indicators.enabled,
        getResourceServerInfo: expect.any(Function),
        loadDbClients: expect.any(Function),
      })
    );
    expect(configuration.findAccount).toEqual(expect.any(Function));
    expect(configuration.fetch).toBe(undiciFetch);
    expect(configuration.interactions).toBeDefined();
    expect(configuration.renderError).toEqual(expect.any(Function));
  });

  it('safely ignores resource initialization before configuration assembly', async () => {
    await expect(
      oidcConfig.initializeResourceServers()
    ).resolves.toBeUndefined();
    expect(findAllDbClients).not.toHaveBeenCalled();
  });

  it('exposes dynamically registered DB resource servers after initialization', async () => {
    const resource = 'https://api.example.test';
    findAllDbClients.mockResolvedValue([
      {
        accessTokenFormat: 'opaque',
        audience: resource,
        client_id: 'database-api',
        grant_types: ['client_credentials'],
        scope: 'api:read api:write',
      },
    ]);
    const configuration = oidcConfig.getConfig() as any;

    await oidcConfig.initializeResourceServers();

    expect(findAllDbClients).toHaveBeenCalledOnce();
    expect(
      configuration.features.resourceIndicators.getResourceServerInfo(
        {},
        resource,
        {
          allowedResources: [resource],
          resourcesScopes: 'profile api:write',
        }
      )
    ).toEqual({
      accessTokenFormat: 'opaque',
      audience: resource,
      scope: 'api:write',
    });
  });
});
