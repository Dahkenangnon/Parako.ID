import { Provider, AdapterConstructor, AdapterFactory } from 'oidc-provider';
import { injectable, inject, optional } from 'inversify';
import { TYPES } from '../di/types.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { IOIDCAdapterBridge } from '../di/interfaces/oidc-adapter-bridge.interface.js';
import type { IOIDCConfig } from '../di/interfaces/oidc-config.interface.js';
import type { IKeyStore } from '../di/interfaces/key-store.interface.js';
import type { IRedisPubSubService } from '../di/interfaces/redis-pubsub-service.interface.js';
import type { ITenantProviderRegistry } from '../di/interfaces/tenant-provider-registry.interface.js';
import { updateProviderJWKS } from './provider-keystore-updater.js';
import { buildRedisKeyForTenant } from '../multi-tenancy/redis-key.js';
import { DEFAULT_TENANT_ID } from '../multi-tenancy/tenant-context.js';

@injectable()
export class ProviderService {
  private provider: Provider | null = null;
  private isRecreating = false;

  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.OIDCAdapterBridge)
    private readonly oidcAdapter: IOIDCAdapterBridge,
    @inject(TYPES.OIDCConfig) private readonly oidcConfig: IOIDCConfig,
    @inject(TYPES.KeyStore) private readonly keyStore: IKeyStore,
    @inject(TYPES.RedisPubSubService)
    private readonly pubsub: IRedisPubSubService,
    @inject(TYPES.TenantProviderRegistry)
    @optional()
    private readonly tenantProviderRegistry?: ITenantProviderRegistry
  ) {
    // Mode-aware: in multi-tenant mode, clear the provider pool so that
    // providers are recreated on-demand with updated config (HIGH-5).
    this.configManager.subscribe('ProviderService', async _updatedConfig => {
      const updatedMtConfig =
        this.configManager.getConfig().features?.multi_tenancy?.enabled ??
        false;

      if (updatedMtConfig && this.tenantProviderRegistry) {
        this.logger.info(
          'Configuration updated in multi-tenant mode, shutting down provider pool'
        );
        this.tenantProviderRegistry.shutdown();
      } else {
        this.logger.info('Configuration updated, recreating OIDC provider');
        await this.recreateProvider();
      }
    });

    // Subscribe to global JWKS events — only in single-tenant mode.
    // In multi-tenant mode, JWKS events are handled per-tenant by TenantProviderRegistry.
    const config = this.configManager.getConfig();
    const isMultiTenant = config.features?.multi_tenancy?.enabled ?? false;

    if (!isMultiTenant) {
      const redisPrefix = config.deployment?.redis_prefix || 'parako';

      const handleJwksUpdate = (phase: string) => () => {
        this.logger.info(`JWKS ${phase} event received, reloading keystore`);
        this.reloadJWKS().catch(err => {
          this.logger.error(
            `Failed to reload JWKS after ${phase}: ${err instanceof Error ? err.message : String(err)}`
          );
        });
      };

      // Unified key format: {prefix}:{tenantId}:jwks:{phase}
      // In single-tenant mode, tenant is always DEFAULT_TENANT_ID.
      this.pubsub.subscribe(
        buildRedisKeyForTenant(
          redisPrefix,
          DEFAULT_TENANT_ID,
          'jwks',
          'rotated'
        ),
        handleJwksUpdate('rotation')
      );
      this.pubsub.subscribe(
        buildRedisKeyForTenant(
          redisPrefix,
          DEFAULT_TENANT_ID,
          'jwks',
          'promoted'
        ),
        handleJwksUpdate('promotion')
      );
    }
  }

  public async initProvider(): Promise<Provider> {
    try {
      const config = this.configManager.getConfig();
      const isProduction = config.deployment.environment === 'production';
      const oidcIssuer = config.oidc.issuer;

      await this.oidcAdapter.initialize();

      await this.keyStore.initialize();
      const jwks = await this.oidcConfig.getJwks();

      const oidcConfiguration = this.oidcConfig.getConfig();

      await this.oidcConfig.initializeResourceServers();

      const provider = new Provider(oidcIssuer, {
        ...oidcConfiguration,
        jwks,
        adapter: this.oidcAdapter.adapter as unknown as
          | AdapterConstructor
          | AdapterFactory,
      });

      if (isProduction) {
        provider.proxy = true;
      }

      this.provider = provider;
      this.logger.info('OIDC Provider created successfully', {
        issuer: oidcIssuer,
        isProduction,
      });

      return provider;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Failed to create OIDC Provider',
      });
      throw error;
    }
  }

  public setProvider(provider: Provider): void {
    this.provider = provider;
  }

  public getProvider(): Provider | null {
    return this.provider;
  }

  public hasProvider(): boolean {
    return this.provider !== null;
  }

  public getOidcPath(): string {
    const config = this.configManager.getConfig();
    return config.oidc.path;
  }

  /**
   * Get the OIDC Provider for a given tenant.
   * When multi-tenancy is enabled, delegates to TenantProviderRegistry.
   * When disabled, returns the single provider instance (creating it if needed).
   */
  public async getProviderForTenant(tenantId: string): Promise<Provider> {
    const config = this.configManager.getConfig();
    if (config.features.multi_tenancy.enabled && this.tenantProviderRegistry) {
      return this.tenantProviderRegistry.getProvider(tenantId);
    }
    // Single-tenant mode: return the existing provider or create one
    return this.provider ?? (await this.initProvider());
  }

  /**
   * Hot-reload the JWKS keystore on the existing Provider instance.
   * This avoids recreating the entire provider (which would invalidate
   * all closures, middleware, and route handlers that capture it).
   */
  public async reloadJWKS(): Promise<void> {
    if (!this.provider) {
      this.logger.warn('Cannot reload JWKS — no provider instance');
      return;
    }

    const jwks = await this.oidcConfig.getJwks();
    try {
      updateProviderJWKS(this.provider, jwks);
      this.logger.info('JWKS hot-reloaded on existing provider', {
        keyCount: jwks.keys.length,
      });
    } catch (err) {
      // Provider remains in its last-good state — log for visibility
      this.logger.error(
        `Failed to hot-reload JWKS on provider: ${err instanceof Error ? err.message : String(err)}`,
        { context: 'jwks_hot_reload_failed', keyCount: jwks.keys.length }
      );
    }
  }

  /**
   * Recreate the provider when configuration changes (non-JWKS)
   */
  private async recreateProvider(): Promise<void> {
    if (this.isRecreating) {
      this.logger.warn('Provider recreation already in progress, skipping');
      return;
    }

    this.isRecreating = true;
    try {
      this.logger.info('Recreating OIDC provider due to configuration change');

      this.provider = null;

      await this.oidcAdapter.initialize();

      await this.initProvider();

      this.logger.info('OIDC provider recreated successfully');
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Failed to recreate OIDC provider',
      });
    } finally {
      this.isRecreating = false;
    }
  }
}
