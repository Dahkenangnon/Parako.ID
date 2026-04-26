import {
  Provider,
  type AdapterConstructor,
  type AdapterFactory,
  type Configuration,
} from 'oidc-provider';
import { injectable, inject, optional } from 'inversify';
import { TYPES } from '../di/types.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { IOIDCConfig } from '../di/interfaces/oidc-config.interface.js';
import type { IOIDCAdapterBridge } from '../di/interfaces/oidc-adapter-bridge.interface.js';
import type { IKeyStore } from '../di/interfaces/key-store.interface.js';
import type { IRedisPubSubService } from '../di/interfaces/redis-pubsub-service.interface.js';
import type { ITenantRepository } from '../db/repositories/interfaces/tenant.repository.js';
import type { ITenant } from '../types/tenant.js';
import { deriveTenantIssuerUrl } from './tenant-issuer.js';
import type {
  ITenantProviderRegistry,
  ProviderConfigurator,
} from '../di/interfaces/tenant-provider-registry.interface.js';
import { updateProviderJWKS } from '../oidc/provider-keystore-updater.js';
import { DEFAULT_TENANT_ID, SYSTEM_TENANTS } from './tenant-context.js';
import { buildRedisKeyForTenant } from './redis-key.js';

/**
 * Factory function signature for creating OIDC Provider instances.
 * Injected to allow testing without real Provider construction.
 */
export type ProviderFactory = (
  issuer: string,
  config: Configuration
) => Provider;

/** Internal pool entry tracking provider and access time. */
interface PoolEntry {
  provider: Provider;
  lastAccessed: number;
  tenantId: string;
}

/**
 * Minimum Redis client interface needed for activity tracking.
 * Avoids hard dependency on ioredis types while remaining type-safe.
 */
export interface IRedisClient {
  set(
    key: string,
    value: string,
    expiryMode: string,
    time: number
  ): Promise<string | null>;
}

/**
 * Manages a pool of OIDC Provider instances, one per tenant.
 *
 * Each tenant gets its own `node-oidc-provider` Provider instance bound to
 * its issuer URL (either from `tenant.issuer_url` or constructed from
 * the base OIDC issuer + tenant slug).
 *
 * Pool management:
 * - **LRU eviction** when pool reaches `max_size`
 * - **TTL-based idle cleanup** via periodic sweep
 * - **Per-tenant mutex** to prevent duplicate creation during concurrent access
 * - **Redis-backed activity tracking** for multi-process coordination
 *
 * The default `ProviderFactory` creates real `Provider` instances.
 * Tests inject a mock factory to avoid spinning up real providers.
 */
@injectable()
export class TenantProviderRegistry implements ITenantProviderRegistry {
  private readonly pool = new Map<string, PoolEntry>();
  private readonly locks = new Map<string, Promise<Provider>>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  private readonly maxSize: number;
  private readonly idleTtlMs: number;
  private readonly redisPrefix: string;

  /** Configurator applied to each new Provider — set by OidcManager.start(). */
  private providerConfigurator: ProviderConfigurator | null = null;

  /** Per-tenant JWKS PubSub handlers — tracked for unsubscribe on eviction. */
  private readonly jwksHandlers = new Map<
    string,
    {
      rotatedHandler: (msg: Record<string, unknown>) => void;
      promotedHandler: (msg: Record<string, unknown>) => void;
      rotatedChannel: string;
      promotedChannel: string;
    }
  >();

  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.OIDCConfig) private readonly oidcConfig: IOIDCConfig,
    @inject(TYPES.OIDCAdapterBridge)
    private readonly adapterBridge: IOIDCAdapterBridge,
    @inject(TYPES.KeyStore) private readonly keyStore: IKeyStore,
    @inject(TYPES.RedisPubSubService)
    private readonly pubsub: IRedisPubSubService,
    @inject(TYPES.TenantRepository)
    private readonly tenantRepo: ITenantRepository,
    // Redis client for activity tracking — injected via DI when available.
    // (RedisPubSubService manages its own connections; this is a separate client)
    @inject(TYPES.TenantActivityRedisClient)
    @optional()
    private readonly redis: IRedisClient | null = null,
    // Replaceable factory for testing without real Provider construction.
    // In production, defaults to creating real Provider instances.
    @inject(TYPES.ProviderFactory)
    @optional()
    private readonly providerFactory: ProviderFactory = defaultProviderFactory
  ) {
    const config = this.configManager.getConfig();
    const mtConfig = config.features.multi_tenancy;
    const poolConfig = mtConfig.provider_pool;

    this.maxSize = poolConfig.max_size;
    this.idleTtlMs = poolConfig.idle_ttl_ms;
    this.redisPrefix = config.deployment.redis_prefix ?? 'parako';

    // Only start periodic idle cleanup when multi-tenancy is actually enabled.
    // Prevents unnecessary timer overhead in single-tenant deployments.
    if (mtConfig.enabled) {
      this.cleanupTimer = setInterval(
        () => this.evictIdle(),
        poolConfig.cleanup_interval_ms
      );
      // Ensure timer doesn't prevent process exit
      if (this.cleanupTimer.unref) {
        this.cleanupTimer.unref();
      }
    }
  }

  setProviderConfigurator(configurator: ProviderConfigurator): void {
    this.providerConfigurator = configurator;
  }

  /**
   * Slug validation pattern: lowercase alphanumeric + hyphens/underscores, 1-63 chars.
   * Prevents Redis channel injection and filesystem path traversal.
   * Unified with middleware pattern to avoid slug-passes-middleware-but-crashes-here bugs.
   */
  private static readonly TENANT_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

  async getProvider(tenantId: string): Promise<Provider> {
    // System tenants bypass regex validation (underscore prefix is reserved)
    if (!SYSTEM_TENANTS.has(tenantId)) {
      // The slug flows into Redis channels, log metadata, and file paths —
      // must be safe for interpolation in all contexts.
      if (!TenantProviderRegistry.TENANT_SLUG_RE.test(tenantId)) {
        throw new Error(
          `[TenantProviderRegistry] Invalid tenant ID format: ${tenantId.substring(0, 64)}`
        );
      }
    }

    // Fast path: cached
    const entry = this.pool.get(tenantId);
    if (entry) {
      entry.lastAccessed = Date.now();
      this.recordActivity(tenantId);
      return entry.provider;
    }

    // Mutex: prevent duplicate creation for the same tenant
    const existingLock = this.locks.get(tenantId);
    if (existingLock) return existingLock;

    const promise = this.createProvider(tenantId);
    this.locks.set(tenantId, promise);
    try {
      return await promise;
    } finally {
      this.locks.delete(tenantId);
    }
  }

  has(tenantId: string): boolean {
    return this.pool.has(tenantId);
  }

  size(): number {
    return this.pool.size;
  }

  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    for (const tenantId of this.jwksHandlers.keys()) {
      this.unsubscribeJwksForTenant(tenantId);
    }
    this.pool.clear();
    this.locks.clear();
  }

  /**
   * Reload JWKS keystore on a specific tenant's cached Provider.
   * No-op if tenant has no cached provider.
   */
  async reloadProviderJWKS(tenantId: string): Promise<void> {
    const entry = this.pool.get(tenantId);
    if (!entry) return;

    try {
      const jwks = await this.keyStore.getJWKS(tenantId);
      updateProviderJWKS(entry.provider, jwks);
      this.logger.info('tenant_provider_jwks_reloaded', {
        tenantId,
        keyCount: jwks.keys.length,
      });
    } catch (error) {
      this.logger.error('tenant_provider_jwks_reload_failed', {
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private async createProvider(tenantId: string): Promise<Provider> {
    let tenant = await this.tenantRepo.findBySlug(tenantId);
    if (!tenant) {
      if (tenantId === DEFAULT_TENANT_ID) {
        throw new Error(
          '[TenantProviderRegistry] No tenant resolved — multi-tenancy is enabled. ' +
            'Use a subdomain (e.g., acme.parako.test) or set the x-tenant-id header.'
        );
      }
      // Fallback for _platforms on first startup before bootstrap seeds the record
      if (SYSTEM_TENANTS.has(tenantId)) {
        tenant = {
          id: tenantId,
          slug: tenantId,
          display_name: 'Platform Administration',
          status: 'active' as const,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as ITenant;
      } else {
        throw new Error(
          `[TenantProviderRegistry] Tenant not found: ${tenantId}`
        );
      }
    }

    // LRU safety valve — evict if at capacity
    if (this.pool.size >= this.maxSize) {
      this.evictLRU();
    }

    const config = this.configManager.getConfig();

    // Priority: 1. explicit issuer_url  2. custom domain  3. subdomain of base domain
    const deploymentUrl = config.deployment.url || '';
    const oidcPath = config.oidc.path || '/oidc/v1';
    const issuer = deriveTenantIssuerUrl(
      tenantId,
      tenant,
      deploymentUrl,
      oidcPath
    );

    await this.keyStore.initialize(tenantId);

    await this.adapterBridge.initialize();

    // Get OIDC configuration (shared across tenants — features, claims, TTLs)
    const oidcConfiguration = this.oidcConfig.getConfig();

    // Get tenant-scoped JWKS — each tenant has its own signing keys.
    // IMPORTANT: Must pass tenantId explicitly. oidcConfig.getJwks() would
    const jwks = await this.keyStore.getJWKS(tenantId);

    const provider = this.providerFactory(issuer, {
      ...oidcConfiguration,
      jwks,
      adapter: this.adapterBridge.adapter as unknown as
        | AdapterConstructor
        | AdapterFactory,
    });

    // Set proxy in production — before pool insertion so no request sees
    // a provider without the proxy flag.
    const isProduction = config.deployment.environment === 'production';
    if (isProduction) {
      provider.proxy = true;
    }

    // storing in pool. This prevents concurrent requests from getting a
    // provider that lacks security middleware (CRIT-1).
    if (this.providerConfigurator) {
      await this.providerConfigurator(provider, tenantId);
    }

    // Store in pool AFTER full configuration — provider is now safe to serve.
    this.pool.set(tenantId, {
      provider,
      lastAccessed: Date.now(),
      tenantId,
    });

    this.recordActivity(tenantId);

    this.subscribeJwksForTenant(tenantId);

    this.logger.info('tenant_provider_created', {
      tenantId,
      issuer,
      poolSize: this.pool.size,
    });

    return provider;
  }

  /**
   * Record tenant activity in Redis (fire-and-forget).
   * Key: {prefix}:{tenantId}:activity (unified format)
   * TTL: idleTtlMs — expires if no access within the idle window.
   * Used by multi-process deployments to coordinate which tenants are active.
   */
  private recordActivity(tenantId: string): void {
    if (!this.redis) return;

    const key = buildRedisKeyForTenant(this.redisPrefix, tenantId, 'activity');
    this.redis
      .set(key, Date.now().toString(), 'PX', this.idleTtlMs)
      .catch(err => {
        this.logger.warn('tenant_activity_record_failed', {
          tenantId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }

  /**
   * Subscribe to JWKS rotation/promotion events for a specific tenant.
   * Channel format: {prefix}:{tenantId}:jwks:{phase} (unified key format)
   * The handler captures tenantId in its closure (Redis callbacks have no ALS context).
   */
  private subscribeJwksForTenant(tenantId: string): void {
    const rotatedChannel = buildRedisKeyForTenant(
      this.redisPrefix,
      tenantId,
      'jwks',
      'rotated'
    );
    const promotedChannel = buildRedisKeyForTenant(
      this.redisPrefix,
      tenantId,
      'jwks',
      'promoted'
    );

    const rotatedHandler = () => {
      this.logger.info('tenant_jwks_rotation_event', {
        tenantId,
        phase: 'rotated',
      });
      this.reloadProviderJWKS(tenantId).catch(err => {
        this.logger.error('tenant_jwks_reload_after_rotation_failed', {
          tenantId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    };

    const promotedHandler = () => {
      this.logger.info('tenant_jwks_promotion_event', {
        tenantId,
        phase: 'promoted',
      });
      this.reloadProviderJWKS(tenantId).catch(err => {
        this.logger.error('tenant_jwks_reload_after_promotion_failed', {
          tenantId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    };

    this.pubsub.subscribe(rotatedChannel, rotatedHandler);
    this.pubsub.subscribe(promotedChannel, promotedHandler);

    this.jwksHandlers.set(tenantId, {
      rotatedHandler,
      promotedHandler,
      rotatedChannel,
      promotedChannel,
    });
  }

  /**
   * Unsubscribe from JWKS events for a tenant being evicted.
   */
  private unsubscribeJwksForTenant(tenantId: string): void {
    const handlers = this.jwksHandlers.get(tenantId);
    if (!handlers) return;

    this.pubsub.unsubscribe(handlers.rotatedChannel, handlers.rotatedHandler);
    this.pubsub.unsubscribe(handlers.promotedChannel, handlers.promotedHandler);
    this.jwksHandlers.delete(tenantId);
  }

  /**
   * Periodic sweep: evict providers not accessed within the idle TTL window.
   */
  private evictIdle(): void {
    const now = Date.now();
    const evicted: string[] = [];

    for (const [tenantId, entry] of this.pool) {
      if (now - entry.lastAccessed > this.idleTtlMs) {
        this.unsubscribeJwksForTenant(tenantId);
        this.pool.delete(tenantId);
        evicted.push(tenantId);
      }
    }

    if (evicted.length > 0) {
      this.logger.info('tenant_providers_evicted_idle', {
        count: evicted.length,
        tenants: evicted,
        poolSize: this.pool.size,
      });
    }
  }

  /**
   * LRU safety valve: when pool is at capacity, remove the least recently accessed entry.
   */
  private evictLRU(): void {
    let lruKey: string | null = null;
    let lruTime = Infinity;

    for (const [tenantId, entry] of this.pool) {
      if (entry.lastAccessed < lruTime) {
        lruTime = entry.lastAccessed;
        lruKey = tenantId;
      }
    }

    if (lruKey) {
      this.unsubscribeJwksForTenant(lruKey);
      this.pool.delete(lruKey);
      this.logger.info('tenant_provider_evicted_lru', {
        tenantId: lruKey,
        poolSize: this.pool.size,
      });
    }
  }
}

/**
 * Default factory: creates a real `node-oidc-provider` Provider instance.
 */
function defaultProviderFactory(
  issuer: string,
  config: Configuration
): Provider {
  return new Provider(issuer, config);
}
