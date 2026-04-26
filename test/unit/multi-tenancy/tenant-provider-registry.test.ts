/**
 * TDD — TenantProviderRegistry
 *
 * Verifies that the registry:
 * - Creates a Provider for new tenant with correct issuer
 * - Returns cached Provider on subsequent calls (same reference)
 * - Records activity in Redis (redis.set called with key + TTL)
 * - has() returns true for cached, false for unknown
 * - size() reflects pool count
 * - Evicts when pool exceeds max_size (LRU safety valve)
 * - Per-tenant mutex prevents duplicate Provider creation during concurrent getProvider() calls
 * - shutdown() clears pool and timers
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Provider, Configuration } from 'oidc-provider';
import type { ILogger } from '../../../src/di/interfaces/logger.interface.js';
import type { IConfigManager } from '../../../src/di/interfaces/config-manager.interface.js';
import type { IOIDCConfig } from '../../../src/di/interfaces/oidc-config.interface.js';
import type { IOIDCAdapterBridge } from '../../../src/di/interfaces/oidc-adapter-bridge.interface.js';
import type { IKeyStore } from '../../../src/di/interfaces/key-store.interface.js';
import type { IRedisPubSubService } from '../../../src/di/interfaces/redis-pubsub-service.interface.js';
import type { ITenantRepository } from '../../../src/db/repositories/interfaces/tenant.repository.js';
import type { ITenant } from '../../../src/types/tenant.js';
import {
  TenantProviderRegistry,
  type ProviderFactory,
} from '../../../src/multi-tenancy/tenant-provider-registry.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

function createMockLogger(): ILogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as ILogger;
}

function createMockConfigManager(
  overrides: Partial<{
    issuer: string;
    path: string;
    url: string;
    environment: string;
    redis_prefix: string;
    max_size: number;
    idle_ttl_ms: number;
    cleanup_interval_ms: number;
  }> = {}
): IConfigManager {
  const {
    issuer = 'https://parako.id/oidc/v1',
    path = '/oidc/v1',
    url = 'https://parako.id',
    environment = 'development',
    redis_prefix = 'parako',
    max_size = 50,
    idle_ttl_ms = 1_800_000,
    cleanup_interval_ms = 60_000,
  } = overrides;

  return {
    getConfig: vi.fn().mockReturnValue({
      oidc: { issuer, path },
      deployment: { url, environment, redis_prefix },
      features: {
        multi_tenancy: {
          enabled: true,
          provider_pool: { max_size, idle_ttl_ms, cleanup_interval_ms },
        },
      },
    }),
    subscribe: vi.fn(),
  } as unknown as IConfigManager;
}

function createMockOidcConfig(): IOIDCConfig {
  return {
    getConfig: vi.fn().mockReturnValue({
      features: {},
      claims: {},
    } as Configuration),
    getJwks: vi.fn().mockResolvedValue({ keys: [{ kty: 'RSA', kid: 'test' }] }),
  };
}

function createMockAdapterBridge(): IOIDCAdapterBridge {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    get adapter() {
      return vi.fn();
    },
    get adapterType() {
      return 'mongodb' as const;
    },
    get isInitialized() {
      return true;
    },
    effectiveOidcAdapter: vi.fn().mockReturnValue('mongodb'),
    getConnectionInfo: vi.fn(),
  } as unknown as IOIDCAdapterBridge;
}

function createMockKeyStore(): IKeyStore {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    getJWKS: vi.fn().mockResolvedValue({ keys: [{ kty: 'RSA', kid: 'test' }] }),
    getPublicJWKS: vi.fn().mockResolvedValue({ keys: [] }),
    rotate: vi.fn().mockResolvedValue(undefined),
    promoteKeys: vi.fn().mockResolvedValue(0),
    retireExpiredKeys: vi.fn().mockResolvedValue(0),
    listKeys: vi.fn().mockResolvedValue([]),
    needsRotation: vi.fn().mockResolvedValue(false),
  };
}

function createMockPubsub(): IRedisPubSubService {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockRedis() {
  return {
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(1),
  };
}

function createMockTenantRepo(
  tenants: Map<string, ITenant> = new Map()
): ITenantRepository {
  return {
    findBySlug: vi.fn().mockImplementation((slug: string) => {
      return Promise.resolve(tenants.get(slug) ?? null);
    }),
    findByDomain: vi.fn().mockResolvedValue(null),
    findById: vi.fn().mockResolvedValue(null),
    findAll: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    exists: vi
      .fn()
      .mockImplementation((slug: string) => Promise.resolve(tenants.has(slug))),
  } as unknown as ITenantRepository;
}

function makeTenant(
  slug: string,
  opts: { issuer_url?: string; domain?: string } = {}
): ITenant {
  return {
    id: `id-${slug}`,
    slug,
    display_name: `${slug} Corp`,
    status: 'active',
    issuer_url: opts.issuer_url,
    domain: opts.domain,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  } as ITenant;
}

/**
 * Creates a mock ProviderFactory that returns fake Provider objects.
 * Each call creates a new mock with the issuer set.
 */
function createMockProviderFactory(): ProviderFactory {
  return vi
    .fn()
    .mockImplementation((issuer: string, _config: Configuration) => {
      return { issuer, proxy: false } as unknown as Provider;
    });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('TenantProviderRegistry', () => {
  let logger: ILogger;
  let configManager: IConfigManager;
  let oidcConfig: IOIDCConfig;
  let adapterBridge: IOIDCAdapterBridge;
  let keyStore: IKeyStore;
  let pubsub: IRedisPubSubService;
  let redis: ReturnType<typeof createMockRedis>;
  let tenantRepo: ITenantRepository;
  let providerFactory: ProviderFactory;
  let registry: TenantProviderRegistry;

  const tenants = new Map([
    ['acme', makeTenant('acme')],
    ['globex', makeTenant('globex')],
    [
      'initech',
      makeTenant('initech', {
        issuer_url: 'https://initech.example.com/oidc',
      }),
    ],
    ['contoso', makeTenant('contoso', { domain: 'auth.contoso.com' })],
  ]);

  beforeEach(() => {
    logger = createMockLogger();
    configManager = createMockConfigManager();
    oidcConfig = createMockOidcConfig();
    adapterBridge = createMockAdapterBridge();
    keyStore = createMockKeyStore();
    pubsub = createMockPubsub();
    redis = createMockRedis();
    tenantRepo = createMockTenantRepo(tenants);
    providerFactory = createMockProviderFactory();

    registry = new TenantProviderRegistry(
      logger,
      configManager,
      oidcConfig,
      adapterBridge,
      keyStore,
      pubsub,
      tenantRepo,
      redis as any,
      providerFactory
    );
  });

  afterEach(() => {
    registry.shutdown();
  });

  describe('getProvider()', () => {
    it('creates a Provider for a new tenant with subdomain-based issuer', async () => {
      const provider = await registry.getProvider('acme');

      expect(provider).toBeDefined();
      // Phase 1: subdomain-based issuer: https://{tenantId}.{baseDomain}{oidcPath}
      expect((provider as any).issuer).toBe('https://acme.parako.id/oidc/v1');
      expect(providerFactory).toHaveBeenCalledTimes(1);
    });

    it('uses tenant issuer_url verbatim when available', async () => {
      const provider = await registry.getProvider('initech');

      expect((provider as any).issuer).toBe('https://initech.example.com/oidc');
    });

    it('uses custom domain for issuer when tenant has domain set', async () => {
      const provider = await registry.getProvider('contoso');

      expect((provider as any).issuer).toBe('https://auth.contoso.com/oidc/v1');
    });

    it('falls back to subdomain issuer when no issuer_url or domain', async () => {
      const provider = await registry.getProvider('globex');

      expect((provider as any).issuer).toBe('https://globex.parako.id/oidc/v1');
    });

    it('returns cached Provider on subsequent calls (same reference)', async () => {
      const first = await registry.getProvider('acme');
      const second = await registry.getProvider('acme');

      expect(first).toBe(second);
      // Factory should only be called once
      expect(providerFactory).toHaveBeenCalledTimes(1);
    });

    it('initializes key store for the tenant', async () => {
      await registry.getProvider('acme');

      expect(keyStore.initialize).toHaveBeenCalledWith('acme');
    });

    it('initializes adapter bridge for the tenant', async () => {
      await registry.getProvider('acme');

      expect(adapterBridge.initialize).toHaveBeenCalled();
    });

    it('fetches tenant-scoped JWKS (not default tenant keys)', async () => {
      await registry.getProvider('acme');

      // Should call keyStore.getJWKS with the tenant ID directly,
      // NOT oidcConfig.getJwks() which would return default tenant keys
      expect(keyStore.getJWKS).toHaveBeenCalledWith('acme');
    });
  });

  describe('Redis activity tracking', () => {
    it('records activity on getProvider() - first call', async () => {
      await registry.getProvider('acme');

      expect(redis.set).toHaveBeenCalledWith(
        expect.stringContaining('acme:activity'),
        expect.any(String),
        'PX',
        expect.any(Number)
      );
    });

    it('records activity on getProvider() - cache hit', async () => {
      await registry.getProvider('acme');
      redis.set.mockClear();

      await registry.getProvider('acme');

      expect(redis.set).toHaveBeenCalledWith(
        expect.stringContaining('acme:activity'),
        expect.any(String),
        'PX',
        expect.any(Number)
      );
    });
  });

  describe('has()', () => {
    it('returns true for cached tenant', async () => {
      await registry.getProvider('acme');

      expect(registry.has('acme')).toBe(true);
    });

    it('returns false for unknown tenant', () => {
      expect(registry.has('unknown')).toBe(false);
    });
  });

  describe('size()', () => {
    it('reflects pool count', async () => {
      expect(registry.size()).toBe(0);

      await registry.getProvider('acme');
      expect(registry.size()).toBe(1);

      await registry.getProvider('globex');
      expect(registry.size()).toBe(2);
    });

    it('does not increase on cache hit', async () => {
      await registry.getProvider('acme');
      await registry.getProvider('acme');

      expect(registry.size()).toBe(1);
    });
  });

  describe('LRU eviction', () => {
    it('evicts least recently used when pool exceeds max_size', async () => {
      let now = 1000;
      vi.spyOn(Date, 'now').mockImplementation(() => now);

      const smallConfig = createMockConfigManager({ max_size: 2 });
      const smallRegistry = new TenantProviderRegistry(
        logger,
        smallConfig,
        oidcConfig,
        adapterBridge,
        keyStore,
        pubsub,
        tenantRepo,
        redis as any,
        providerFactory
      );

      now = 1000;
      await smallRegistry.getProvider('acme');
      now = 2000;
      await smallRegistry.getProvider('globex');
      expect(smallRegistry.size()).toBe(2);

      // Adding a third should evict the LRU (acme at t=1000)
      now = 3000;
      await smallRegistry.getProvider('initech');
      expect(smallRegistry.size()).toBe(2);
      expect(smallRegistry.has('acme')).toBe(false);
      expect(smallRegistry.has('globex')).toBe(true);
      expect(smallRegistry.has('initech')).toBe(true);

      smallRegistry.shutdown();
      vi.restoreAllMocks();
    });

    it('evicts the correct LRU entry when access order changes', async () => {
      let now = 1000;
      vi.spyOn(Date, 'now').mockImplementation(() => now);

      const smallConfig = createMockConfigManager({ max_size: 2 });
      const smallRegistry = new TenantProviderRegistry(
        logger,
        smallConfig,
        oidcConfig,
        adapterBridge,
        keyStore,
        pubsub,
        tenantRepo,
        redis as any,
        providerFactory
      );

      now = 1000;
      await smallRegistry.getProvider('acme');
      now = 2000;
      await smallRegistry.getProvider('globex');

      // Access acme again at t=3000 — now globex (t=2000) is LRU
      now = 3000;
      await smallRegistry.getProvider('acme');

      // Adding third should evict globex (it's now LRU at t=2000)
      now = 4000;
      await smallRegistry.getProvider('initech');
      expect(smallRegistry.has('globex')).toBe(false);
      expect(smallRegistry.has('acme')).toBe(true);
      expect(smallRegistry.has('initech')).toBe(true);

      smallRegistry.shutdown();
      vi.restoreAllMocks();
    });
  });

  describe('concurrent access mutex', () => {
    it('prevents duplicate Provider creation for the same tenant', async () => {
      // The lock is set synchronously in getProvider() before any await,
      // so two synchronous calls always share the same createProvider promise.
      // All mocked dependencies resolve immediately — the mutex is still
      // exercised because the lock check happens before the first microtask.
      const p1 = registry.getProvider('acme');
      const p2 = registry.getProvider('acme');

      const [provider1, provider2] = await Promise.all([p1, p2]);

      // Both should get the same provider (same reference)
      expect(provider1).toBe(provider2);
      // Factory should only be called once despite two concurrent requests
      expect(providerFactory).toHaveBeenCalledTimes(1);
      expect(registry.size()).toBe(1);
    });
  });

  describe('shutdown()', () => {
    it('clears pool', async () => {
      await registry.getProvider('acme');
      expect(registry.size()).toBe(1);

      registry.shutdown();
      expect(registry.size()).toBe(0);
    });

    it('is idempotent', () => {
      registry.shutdown();
      registry.shutdown(); // no error
    });
  });

  describe('system tenant (_platforms) slug validation', () => {
    it('allows _platforms through slug validation', async () => {
      // _platforms is a system tenant — should bypass regex that rejects underscore prefix
      const provider = await registry.getProvider('_platforms');

      expect(provider).toBeDefined();
      expect((provider as any).issuer).toContain('_platforms');
    });

    it('rejects underscore-prefixed user slugs that are not system tenants', async () => {
      // Only hardcoded system tenants pass — arbitrary underscore slugs still rejected
      await expect(registry.getProvider('_evil')).rejects.toThrow(
        /invalid tenant id format/i
      );
    });

    it('creates _platforms provider even without DB record (fallback)', async () => {
      // Use a fresh repo with no _platforms record
      const emptyRepo = createMockTenantRepo(new Map());
      const freshRegistry = new TenantProviderRegistry(
        logger,
        configManager,
        oidcConfig,
        adapterBridge,
        keyStore,
        pubsub,
        emptyRepo,
        redis as any,
        providerFactory
      );

      const provider = await freshRegistry.getProvider('_platforms');
      expect(provider).toBeDefined();

      freshRegistry.shutdown();
    });
  });

  describe('error handling', () => {
    it('throws when tenant not found in repository', async () => {
      await expect(registry.getProvider('unknown-corp')).rejects.toThrow(
        /tenant.*not found/i
      );
    });

    it('cleans up lock on factory error', async () => {
      const errorFactory = vi.fn().mockImplementation(() => {
        throw new Error('Provider init failed');
      });
      const errorRegistry = new TenantProviderRegistry(
        logger,
        configManager,
        oidcConfig,
        adapterBridge,
        keyStore,
        pubsub,
        tenantRepo,
        redis as any,
        errorFactory
      );

      await expect(errorRegistry.getProvider('acme')).rejects.toThrow(
        'Provider init failed'
      );

      // Lock should be cleaned up — retry should call factory again
      await expect(errorRegistry.getProvider('acme')).rejects.toThrow(
        'Provider init failed'
      );
      expect(errorFactory).toHaveBeenCalledTimes(2);

      errorRegistry.shutdown();
    });

    it('gracefully handles Redis activity recording failure', async () => {
      redis.set.mockRejectedValue(new Error('Redis connection lost'));

      // Should not throw — activity recording is fire-and-forget
      const provider = await registry.getProvider('acme');
      expect(provider).toBeDefined();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('LRU eviction followed by factory failure does not restore evicted provider', async () => {
      let now = 1000;
      vi.spyOn(Date, 'now').mockImplementation(() => now);

      const smallConfig = createMockConfigManager({ max_size: 1 });

      // First call succeeds, second call fails after evicting first
      let callCount = 0;
      const mixedFactory = vi.fn().mockImplementation((issuer: string) => {
        callCount++;
        if (callCount === 2) throw new Error('Factory failed');
        return { issuer, proxy: false } as unknown as Provider;
      });

      const smallRegistry = new TenantProviderRegistry(
        logger,
        smallConfig,
        oidcConfig,
        adapterBridge,
        keyStore,
        pubsub,
        tenantRepo,
        redis as any,
        mixedFactory
      );

      now = 1000;
      await smallRegistry.getProvider('acme');
      expect(smallRegistry.size()).toBe(1);
      expect(smallRegistry.has('acme')).toBe(true);

      // Second call for different tenant: evicts acme, then fails
      now = 2000;
      await expect(smallRegistry.getProvider('globex')).rejects.toThrow(
        'Factory failed'
      );

      // acme was evicted and NOT restored — pool is empty
      expect(smallRegistry.size()).toBe(0);
      expect(smallRegistry.has('acme')).toBe(false);

      smallRegistry.shutdown();
      vi.restoreAllMocks();
    });
  });

  describe('idle eviction timer', () => {
    it('evicts providers that exceed the idle TTL', async () => {
      vi.useFakeTimers();

      const shortConfig = createMockConfigManager({
        idle_ttl_ms: 5000,
        cleanup_interval_ms: 1000,
      });

      const timedRegistry = new TenantProviderRegistry(
        logger,
        shortConfig,
        oidcConfig,
        adapterBridge,
        keyStore,
        pubsub,
        tenantRepo,
        redis as any,
        providerFactory
      );

      await timedRegistry.getProvider('acme');
      expect(timedRegistry.size()).toBe(1);

      // Advance past the idle TTL + cleanup interval
      vi.advanceTimersByTime(6000);

      // Provider should have been evicted by the periodic sweep
      expect(timedRegistry.size()).toBe(0);
      expect(timedRegistry.has('acme')).toBe(false);

      timedRegistry.shutdown();
      vi.useRealTimers();
    });

    it('does not evict recently accessed providers', async () => {
      vi.useFakeTimers();

      const shortConfig = createMockConfigManager({
        idle_ttl_ms: 5000,
        cleanup_interval_ms: 1000,
      });

      const timedRegistry = new TenantProviderRegistry(
        logger,
        shortConfig,
        oidcConfig,
        adapterBridge,
        keyStore,
        pubsub,
        tenantRepo,
        redis as any,
        providerFactory
      );

      await timedRegistry.getProvider('acme');

      // Access at t=3000 — resets lastAccessed
      vi.advanceTimersByTime(3000);
      await timedRegistry.getProvider('acme');

      // At t=6000 — only 3s since last access, should NOT be evicted
      vi.advanceTimersByTime(3000);
      expect(timedRegistry.size()).toBe(1);
      expect(timedRegistry.has('acme')).toBe(true);

      timedRegistry.shutdown();
      vi.useRealTimers();
    });
  });
});
