import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  providerConstructor: vi.fn(),
  updateProviderJWKS: vi.fn(),
}));

vi.mock('oidc-provider', () => ({
  Provider: mocks.providerConstructor,
  default: mocks.providerConstructor,
}));

vi.mock('../../../src/oidc/provider-keystore-updater.js', () => ({
  updateProviderJWKS: mocks.updateProviderJWKS,
}));

import { ProviderService } from '../../../src/oidc/provider.js';

describe('ProviderService', () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const adapter = vi.fn();
  const oidcAdapter = {
    initialize: vi.fn(),
    adapter,
  };
  const oidcConfig = {
    getJwks: vi.fn(),
    getConfig: vi.fn(),
    initializeResourceServers: vi.fn(),
  };
  const keyStore = { initialize: vi.fn() };
  const pubsub = { subscribe: vi.fn() };
  const registry = {
    getProvider: vi.fn(),
    shutdown: vi.fn(),
  };

  let currentConfig: any;
  let subscriber: (config?: unknown) => Promise<void>;
  let subscriptions: Map<string, () => void>;

  function createConfig(overrides: Record<string, unknown> = {}) {
    return {
      oidc: {
        issuer: 'https://issuer.example.test/oidc/v1',
        path: '/oidc/v1',
      },
      deployment: {
        environment: 'development',
        redis_prefix: 'test-prefix',
      },
      features: { multi_tenancy: { enabled: false } },
      ...overrides,
    };
  }

  function createService(options: { withRegistry?: boolean } = {}) {
    const configManager = {
      getConfig: vi.fn(() => currentConfig),
      subscribe: vi.fn(
        (_name: string, callback: (config?: unknown) => Promise<void>) => {
          subscriber = callback;
        }
      ),
    };

    return {
      service: new ProviderService(
        logger as any,
        configManager as any,
        oidcAdapter as any,
        oidcConfig as any,
        keyStore as any,
        pubsub as any,
        options.withRegistry ? (registry as any) : undefined
      ),
      configManager,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    currentConfig = createConfig();
    subscriptions = new Map();
    subscriber = async () => undefined;
    pubsub.subscribe.mockImplementation(
      (channel: string, callback: () => void) => {
        subscriptions.set(channel, callback);
      }
    );
    oidcAdapter.initialize.mockResolvedValue(undefined);
    keyStore.initialize.mockResolvedValue(undefined);
    oidcConfig.getJwks.mockResolvedValue({
      keys: [{ kty: 'RSA', kid: 'key-1' }],
    });
    oidcConfig.getConfig.mockReturnValue({
      features: { devInteractions: false },
    });
    oidcConfig.initializeResourceServers.mockResolvedValue(undefined);
    registry.getProvider.mockResolvedValue({ tenant: 'tenant-a' });
    mocks.updateProviderJWKS.mockReturnValue(undefined);
    mocks.providerConstructor.mockImplementation(function (
      issuer: string,
      configuration: Record<string, unknown>
    ) {
      return {
        issuer,
        configuration,
        proxy: false,
      };
    });
  });

  it('subscribes to tenant-scoped JWKS events in single-tenant mode', () => {
    const { configManager } = createService();

    expect(configManager.subscribe).toHaveBeenCalledWith(
      'ProviderService',
      expect.any(Function)
    );
    expect([...subscriptions.keys()]).toEqual([
      'test-prefix:default:jwks:rotated',
      'test-prefix:default:jwks:promoted',
    ]);
  });

  it('uses the default Redis prefix and skips global JWKS subscriptions in multi-tenant mode', () => {
    currentConfig = createConfig({
      deployment: { environment: 'development', redis_prefix: '' },
      features: { multi_tenancy: { enabled: false } },
    });
    createService();
    expect([...subscriptions.keys()]).toEqual([
      'parako:default:jwks:rotated',
      'parako:default:jwks:promoted',
    ]);

    subscriptions.clear();
    pubsub.subscribe.mockClear();
    currentConfig = createConfig({
      features: { multi_tenancy: { enabled: true } },
    });
    createService({ withRegistry: true });
    expect(pubsub.subscribe).not.toHaveBeenCalled();
  });

  it.each([
    ['development', false],
    ['production', true],
  ])('initializes a provider in %s mode', async (environment, proxy) => {
    currentConfig = createConfig({
      deployment: { environment, redis_prefix: 'test-prefix' },
    });
    const { service } = createService();

    const provider = await service.initProvider();

    expect(oidcAdapter.initialize).toHaveBeenCalledOnce();
    expect(keyStore.initialize).toHaveBeenCalledOnce();
    expect(oidcConfig.getJwks).toHaveBeenCalledOnce();
    expect(oidcConfig.initializeResourceServers).toHaveBeenCalledOnce();
    expect(mocks.providerConstructor).toHaveBeenCalledWith(
      'https://issuer.example.test/oidc/v1',
      {
        features: { devInteractions: false },
        jwks: { keys: [{ kty: 'RSA', kid: 'key-1' }] },
        adapter,
      }
    );
    expect((provider as any).proxy).toBe(proxy);
    expect(service.getProvider()).toBe(provider);
    expect(service.hasProvider()).toBe(true);
    expect(service.getOidcPath()).toBe('/oidc/v1');
    expect(logger.info).toHaveBeenCalledWith(
      'OIDC Provider created successfully',
      {
        issuer: 'https://issuer.example.test/oidc/v1',
        isProduction: proxy,
      }
    );
  });

  it('logs and rethrows provider initialization failures', async () => {
    const failure = new Error('keystore unavailable');
    keyStore.initialize.mockRejectedValueOnce(failure);
    const { service } = createService();

    await expect(service.initProvider()).rejects.toBe(failure);

    expect(logger.error).toHaveBeenCalledWith(failure, {
      context: 'Failed to create OIDC Provider',
    });
    expect(service.hasProvider()).toBe(false);
  });

  it('sets and returns an existing provider without reinitializing', async () => {
    const { service } = createService();
    const provider = { issuer: 'existing' } as any;

    expect(service.getProvider()).toBeNull();
    expect(service.hasProvider()).toBe(false);
    service.setProvider(provider);

    expect(await service.getProviderForTenant('ignored')).toBe(provider);
    expect(oidcAdapter.initialize).not.toHaveBeenCalled();
  });

  it('initializes on demand and delegates tenant providers only when a registry exists', async () => {
    const { service } = createService();
    const initialized = await service.getProviderForTenant('tenant-a');
    expect(initialized).toBe(service.getProvider());

    currentConfig = createConfig({
      features: { multi_tenancy: { enabled: true } },
    });
    const withoutRegistry = createService().service;
    await withoutRegistry.getProviderForTenant('tenant-a');
    expect(registry.getProvider).not.toHaveBeenCalled();

    const withRegistry = createService({ withRegistry: true }).service;
    await expect(
      withRegistry.getProviderForTenant('tenant-a')
    ).resolves.toEqual({ tenant: 'tenant-a' });
    expect(registry.getProvider).toHaveBeenCalledWith('tenant-a');
  });

  it('warns when JWKS reload is requested before a provider exists', async () => {
    const { service } = createService();

    await service.reloadJWKS();

    expect(logger.warn).toHaveBeenCalledWith(
      'Cannot reload JWKS — no provider instance'
    );
    expect(oidcConfig.getJwks).not.toHaveBeenCalled();
  });

  it('hot-reloads JWKS on the existing provider', async () => {
    const { service } = createService();
    const provider = {} as any;
    service.setProvider(provider);

    await service.reloadJWKS();

    expect(mocks.updateProviderJWKS).toHaveBeenCalledWith(provider, {
      keys: [{ kty: 'RSA', kid: 'key-1' }],
    });
    expect(logger.info).toHaveBeenCalledWith(
      'JWKS hot-reloaded on existing provider',
      { keyCount: 1 }
    );
  });

  it.each([
    [new Error('private keystore changed'), 'private keystore changed'],
    ['unexpected failure', 'unexpected failure'],
  ])(
    'keeps the last provider when JWKS update fails',
    async (failure, message) => {
      const { service } = createService();
      service.setProvider({} as any);
      mocks.updateProviderJWKS.mockImplementationOnce(() => {
        throw failure;
      });

      await service.reloadJWKS();

      expect(logger.error).toHaveBeenCalledWith(
        `Failed to hot-reload JWKS on provider: ${message}`,
        { context: 'jwks_hot_reload_failed', keyCount: 1 }
      );
      expect(service.hasProvider()).toBe(true);
    }
  );

  it.each([
    ['rotated', 'rotation'],
    ['promoted', 'promotion'],
  ])('reloads JWKS after the %s event', async (event, phase) => {
    const { service } = createService();
    service.setProvider({} as any);

    subscriptions.get(`test-prefix:default:jwks:${event}`)!();
    await vi.waitFor(() => expect(mocks.updateProviderJWKS).toHaveBeenCalled());

    expect(logger.info).toHaveBeenCalledWith(
      `JWKS ${phase} event received, reloading keystore`
    );
  });

  it.each([
    [new Error('reload failed'), 'reload failed'],
    ['reload failed', 'reload failed'],
  ])('logs asynchronous JWKS event failures', async (failure, message) => {
    const { service } = createService();
    vi.spyOn(service, 'reloadJWKS').mockRejectedValueOnce(failure);

    subscriptions.get('test-prefix:default:jwks:rotated')!();

    await vi.waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith(
        `Failed to reload JWKS after rotation: ${message}`
      )
    );
  });

  it('shuts down the tenant provider pool on multi-tenant config updates', async () => {
    currentConfig = createConfig({
      features: { multi_tenancy: { enabled: true } },
    });
    createService({ withRegistry: true });

    await subscriber();

    expect(registry.shutdown).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith(
      'Configuration updated in multi-tenant mode, shutting down provider pool'
    );
  });

  it('recreates the single provider after config updates', async () => {
    const { service } = createService();
    service.setProvider({ stale: true } as any);

    await subscriber();

    expect(service.getProvider()).toEqual(
      expect.objectContaining({
        issuer: 'https://issuer.example.test/oidc/v1',
      })
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Configuration updated, recreating OIDC provider'
    );
    expect(logger.info).toHaveBeenCalledWith(
      'OIDC provider recreated successfully'
    );
  });

  it('prevents overlapping provider recreation', async () => {
    let releaseInitialization!: () => void;
    oidcAdapter.initialize.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          releaseInitialization = resolve;
        })
    );
    createService();

    const first = subscriber();
    await vi.waitFor(() => expect(oidcAdapter.initialize).toHaveBeenCalled());
    await subscriber();

    expect(logger.warn).toHaveBeenCalledWith(
      'Provider recreation already in progress, skipping'
    );
    releaseInitialization();
    await first;
  });

  it('logs recreation failures and allows a later retry', async () => {
    const failure = new Error('adapter down');
    oidcAdapter.initialize.mockRejectedValueOnce(failure);
    const { service } = createService();

    await subscriber();
    expect(logger.error).toHaveBeenCalledWith(failure, {
      context: 'Failed to recreate OIDC provider',
    });
    expect(service.hasProvider()).toBe(false);

    await subscriber();
    expect(service.hasProvider()).toBe(true);
  });

  it('treats missing optional multi-tenant config as single-tenant', async () => {
    currentConfig = createConfig({ features: undefined });
    createService({ withRegistry: true });

    expect(pubsub.subscribe).toHaveBeenCalledTimes(2);
    await subscriber();
    expect(registry.shutdown).not.toHaveBeenCalled();
  });
});
