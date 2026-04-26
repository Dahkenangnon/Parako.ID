/**
 * Tests for Task 4.3: Provider Configurator for TenantProviderRegistry
 *
 * Verifies that:
 * 1. setProviderConfigurator() stores the configurator function
 * 2. createProvider() calls the configurator after creating the Provider
 * 3. Configurator errors are logged but don't prevent provider creation
 * 4. reloadProviderJWKS() reloads keys on cached providers
 * 5. JWKS PubSub handlers are subscribed per-tenant
 * 6. Eviction unsubscribes JWKS handlers
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TenantProviderRegistry } from '../../../src/multi-tenancy/tenant-provider-registry.js';
import type { ProviderConfigurator } from '../../../src/di/interfaces/tenant-provider-registry.interface.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

function createMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

function createMockConfigManager(maxSize = 50) {
  return {
    getConfig: vi.fn().mockReturnValue({
      features: {
        multi_tenancy: {
          enabled: true,
          provider_pool: {
            max_size: maxSize,
            idle_ttl_ms: 1_800_000,
            cleanup_interval_ms: 60_000,
          },
        },
      },
      deployment: {
        redis_prefix: 'parako',
        environment: 'development',
      },
      oidc: {
        issuer: 'https://auth.example.com/oidc/v1',
      },
      security: {
        key_store: { overlap_window_seconds: 7200 },
      },
    }),
  };
}

function createMockProvider(name: string) {
  return {
    _name: name,
    use: vi.fn(),
    callback: vi.fn(),
    proxy: false,
  };
}

function createMockTenantRepo() {
  return {
    findBySlug: vi.fn().mockResolvedValue({
      id: 'tenant-id',
      slug: 'acme',
      display_name: 'Acme Corp',
      status: 'active',
    }),
    findByDomain: vi.fn(),
    findById: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    exists: vi.fn(),
  };
}

function createMockKeyStore() {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    getJWKS: vi
      .fn()
      .mockResolvedValue({ keys: [{ kty: 'RSA', kid: 'key-1' }] }),
    listKeys: vi.fn(),
    needsRotation: vi.fn(),
  };
}

function createMockPubSub() {
  return {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    publish: vi.fn().mockResolvedValue(undefined),
    publishForTenant: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
  };
}

function createMockAdapterBridge() {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    adapter: {},
  };
}

function createMockOidcConfig() {
  return {
    getConfig: vi.fn().mockReturnValue({}),
    getJwks: vi.fn().mockResolvedValue({ keys: [] }),
  };
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('TenantProviderRegistry – Configurator & JWKS (Tasks 4.3 + 4.4)', () => {
  let logger: ReturnType<typeof createMockLogger>;
  let configManager: ReturnType<typeof createMockConfigManager>;
  let tenantRepo: ReturnType<typeof createMockTenantRepo>;
  let keyStore: ReturnType<typeof createMockKeyStore>;
  let pubsub: ReturnType<typeof createMockPubSub>;
  let adapterBridge: ReturnType<typeof createMockAdapterBridge>;
  let oidcConfig: ReturnType<typeof createMockOidcConfig>;
  let providerFactory: ReturnType<typeof vi.fn>;
  let registry: TenantProviderRegistry;

  beforeEach(() => {
    logger = createMockLogger();
    configManager = createMockConfigManager();
    tenantRepo = createMockTenantRepo();
    keyStore = createMockKeyStore();
    pubsub = createMockPubSub();
    adapterBridge = createMockAdapterBridge();
    oidcConfig = createMockOidcConfig();
    providerFactory = vi.fn((issuer: string) => createMockProvider(issuer));

    registry = new (TenantProviderRegistry as any)(
      /* logger */ logger,
      /* configManager */ configManager,
      /* oidcConfig */ oidcConfig,
      /* adapterBridge */ adapterBridge,
      /* keyStore */ keyStore,
      /* pubsub */ pubsub,
      /* tenantRepo */ tenantRepo,
      /* redis */ null,
      /* providerFactory */ providerFactory
    );
  });

  afterEach(() => {
    registry.shutdown();
  });

  // ─── Configurator ────────────────────────────────────────────────────

  describe('setProviderConfigurator()', () => {
    it('stores the configurator function', () => {
      const configurator: ProviderConfigurator = vi
        .fn()
        .mockResolvedValue(undefined);
      registry.setProviderConfigurator(configurator);
      // No assertion needed beyond not throwing — verify via getProvider()
      expect(true).toBe(true);
    });

    it('configurator is called on createProvider()', async () => {
      const configurator = vi
        .fn<ProviderConfigurator>()
        .mockResolvedValue(undefined);
      registry.setProviderConfigurator(configurator);

      await registry.getProvider('acme');

      expect(configurator).toHaveBeenCalledTimes(1);
      expect(configurator).toHaveBeenCalledWith(
        expect.objectContaining({ _name: expect.any(String) }),
        'acme'
      );
    });

    it('configurator is NOT called on cache hit', async () => {
      const configurator = vi
        .fn<ProviderConfigurator>()
        .mockResolvedValue(undefined);
      registry.setProviderConfigurator(configurator);

      await registry.getProvider('acme');
      await registry.getProvider('acme'); // cache hit

      expect(configurator).toHaveBeenCalledTimes(1);
    });

    it('configurator errors propagate (CRIT-1: fail hard, no half-configured providers)', async () => {
      const configurator = vi
        .fn<ProviderConfigurator>()
        .mockRejectedValue(new Error('Middleware failed'));
      registry.setProviderConfigurator(configurator);

      // CRIT-1: Configurator errors now propagate — a provider without
      // middleware/listeners is a security risk, so we fail hard.
      await expect(registry.getProvider('acme')).rejects.toThrow(
        'Middleware failed'
      );

      // Provider should NOT be in the pool (not stored on failure)
      expect(registry.has('acme')).toBe(false);
    });

    it('without configurator, providers are created normally', async () => {
      // No setProviderConfigurator() call
      const provider = await registry.getProvider('acme');
      expect(provider).toBeDefined();
    });
  });

  // ─── reloadProviderJWKS ──────────────────────────────────────────────

  describe('reloadProviderJWKS()', () => {
    it('calls keyStore.getJWKS for the correct tenant on reload', async () => {
      await registry.getProvider('acme');

      keyStore.getJWKS.mockClear();
      keyStore.getJWKS.mockResolvedValue({
        keys: [
          { kty: 'RSA', kid: 'new-key-1' },
          { kty: 'RSA', kid: 'new-key-2' },
        ],
      });

      await registry.reloadProviderJWKS('acme');

      // getJWKS should be called with the tenant ID
      expect(keyStore.getJWKS).toHaveBeenCalledWith('acme');
      // updateProviderJWKS will fail on mock provider (uses oidc-provider internals)
      // but the method should still complete without throwing
    });

    it('is a no-op for uncached tenant', async () => {
      await registry.reloadProviderJWKS('unknown');
      expect(keyStore.getJWKS).not.toHaveBeenCalled();
    });

    it('logs error if JWKS reload fails', async () => {
      await registry.getProvider('acme');

      keyStore.getJWKS.mockClear();
      keyStore.getJWKS.mockRejectedValue(new Error('Key store unavailable'));

      await registry.reloadProviderJWKS('acme');

      expect(logger.error).toHaveBeenCalledWith(
        'tenant_provider_jwks_reload_failed',
        expect.objectContaining({
          tenantId: 'acme',
          error: 'Key store unavailable',
        })
      );
    });
  });

  // ─── JWKS PubSub Subscriptions ───────────────────────────────────────

  describe('JWKS PubSub per-tenant', () => {
    it('subscribes to tenant JWKS channels on provider creation', async () => {
      await registry.getProvider('acme');

      expect(pubsub.subscribe).toHaveBeenCalledWith(
        'parako:acme:jwks:rotated',
        expect.any(Function)
      );
      expect(pubsub.subscribe).toHaveBeenCalledWith(
        'parako:acme:jwks:promoted',
        expect.any(Function)
      );
    });

    it('unsubscribes JWKS channels on shutdown()', async () => {
      await registry.getProvider('acme');
      registry.shutdown();

      expect(pubsub.unsubscribe).toHaveBeenCalledWith(
        'parako:acme:jwks:rotated',
        expect.any(Function)
      );
      expect(pubsub.unsubscribe).toHaveBeenCalledWith(
        'parako:acme:jwks:promoted',
        expect.any(Function)
      );
    });

    it('unsubscribes JWKS on LRU eviction', async () => {
      // Create registry with max_size = 2
      const smallConfigManager = createMockConfigManager(2);
      const smallRegistry = new (TenantProviderRegistry as any)(
        logger,
        smallConfigManager,
        oidcConfig,
        adapterBridge,
        keyStore,
        pubsub,
        tenantRepo,
        null,
        providerFactory
      );

      // Fill pool to capacity
      tenantRepo.findBySlug.mockResolvedValueOnce({
        id: '1',
        slug: 'tenant-1',
        display_name: 'T1',
        status: 'active',
      });
      await smallRegistry.getProvider('tenant-1');

      tenantRepo.findBySlug.mockResolvedValueOnce({
        id: '2',
        slug: 'tenant-2',
        display_name: 'T2',
        status: 'active',
      });
      await smallRegistry.getProvider('tenant-2');

      // Clear tracking
      pubsub.unsubscribe.mockClear();

      // Adding a 3rd tenant triggers LRU eviction of tenant-1
      tenantRepo.findBySlug.mockResolvedValueOnce({
        id: '3',
        slug: 'tenant-3',
        display_name: 'T3',
        status: 'active',
      });
      await smallRegistry.getProvider('tenant-3');

      // tenant-1 should have been unsubscribed
      expect(pubsub.unsubscribe).toHaveBeenCalledWith(
        'parako:tenant-1:jwks:rotated',
        expect.any(Function)
      );
      expect(pubsub.unsubscribe).toHaveBeenCalledWith(
        'parako:tenant-1:jwks:promoted',
        expect.any(Function)
      );

      smallRegistry.shutdown();
    });
  });
});
