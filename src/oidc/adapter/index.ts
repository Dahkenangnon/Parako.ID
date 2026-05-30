import { injectable, inject } from 'inversify';
import { PrismaClient } from '@prisma/client';
import type { Db } from 'mongodb';
import type { Redis } from 'ioredis';
import { TYPES } from '../../di/types.js';
import type { ILogger } from '../../di/interfaces/logger.interface.js';
import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';
import type { IConfigProvider } from '../../di/interfaces/config-provider.interface.js';
import type { BootstrapConfig } from '../../config/schemas/bootstrap-schema.js';
import type { AdapterFactory } from '../../di/interfaces/oidc-adapter-bridge.interface.js';
import { connectMongoDB, createMongoAdapterFactory } from './mongodb/index.js';
import { connectRedis, createRedisAdapterFactory } from './redis/index.js';
import { createPrismaAdapterFactory } from './prisma/index.js';
import { PrismaOidcAdminService } from './prisma/admin-service.js';
import { MongodbOidcAdminService } from './mongodb/admin-service.js';
import { RedisOidcAdminService } from './redis/admin-service.js';

/**
 * OIDC Adapter Bridge
 *
 * Provides a unified interface to interact with OIDC adapters regardless of the
 * underlying storage implementation (MongoDB, Redis, or Prisma/SQLite/PostgreSQL).
 *
 * All three backends now expose the same factory-function signature:
 *   (modelName: string) => BaseOIDCAdapter
 *
 * Database connections are established by the bridge, then injected into adapter
 * factories and admin services — no global mutable state.
 */
@injectable()
export class OIDCAdapterBridge {
  private _adapterFactory: AdapterFactory | null = null;

  // Admin services — one set for all backends
  private _session:
    | MongodbOidcAdminService
    | RedisOidcAdminService
    | PrismaOidcAdminService
    | null = null;
  private _grant:
    | MongodbOidcAdminService
    | RedisOidcAdminService
    | PrismaOidcAdminService
    | null = null;
  private _client:
    | MongodbOidcAdminService
    | RedisOidcAdminService
    | PrismaOidcAdminService
    | null = null;
  private _accessToken:
    | MongodbOidcAdminService
    | RedisOidcAdminService
    | PrismaOidcAdminService
    | null = null;
  private _refreshToken:
    | MongodbOidcAdminService
    | RedisOidcAdminService
    | PrismaOidcAdminService
    | null = null;
  private _interaction:
    | MongodbOidcAdminService
    | RedisOidcAdminService
    | PrismaOidcAdminService
    | null = null;

  private _isInitialized = false;

  constructor(
    @inject(TYPES.Logger) private logger: ILogger,
    @inject(TYPES.ConfigManager) private configManager: IConfigManager,
    @inject(TYPES.BootstrapConfigProvider)
    private bootstrapProvider: IConfigProvider<BootstrapConfig>,
    @inject(TYPES.PrismaClient)
    private prismaClient: PrismaClient | null
  ) {
    this.configManager.subscribe('OIDCAdapterBridge', _updatedConfig => {
      this.logger.info(
        'Storage configuration updated, reinitializing OIDC adapter'
      );
      this.reinitializeAdapter();
    });
  }

  /**
   * Resolve the effective OIDC adapter type using precedence rules:
   * 1. OIDC_STORAGE_ADAPTER env var (bootstrap-level, always wins)
   * 2. config.oidc_storage.oidc_adapter.type (DB/file config, admin-manageable)
   *    — only honoured when main adapter is also mongodb
   * 3. Inherit from STORAGE_ADAPTER (default)
   */
  effectiveOidcAdapter(): 'mongodb' | 'redis' | 'sqlite' | 'postgresql' {
    const envOverride = this.bootstrapProvider.getConfigValue<
      string | undefined
    >('oidcStorage.adapter', undefined);
    if (envOverride) {
      return envOverride as 'mongodb' | 'redis' | 'sqlite' | 'postgresql';
    }

    const mainAdapter = this.bootstrapProvider.getConfigValue<string>(
      'storage.adapter',
      'mongodb'
    );
    if (mainAdapter !== 'mongodb') {
      return mainAdapter as 'sqlite' | 'postgresql';
    }

    try {
      const dbType =
        this.configManager.getConfig().oidc_storage?.oidc_adapter?.type;
      if (dbType) {
        return dbType as 'mongodb' | 'redis';
      }
    } catch {
      // config not loaded yet — fall through
    }

    return 'mongodb';
  }

  /**
   * Initialize the adapter bridge based on configuration
   */
  async initialize(): Promise<void> {
    if (this._isInitialized) {
      return;
    }

    try {
      const adapterType = this.effectiveOidcAdapter();

      this.logger.info(`Initializing OIDC adapter: ${adapterType}`);

      if (adapterType === 'sqlite' || adapterType === 'postgresql') {
        this.initializePrisma();
      } else if (adapterType === 'redis') {
        await this.initializeRedis();
      } else {
        await this.initializeMongoDB();
      }

      this._isInitialized = true;
      this.logger.info(
        `OIDC adapter bridge initialized successfully with ${adapterType}`
      );
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Failed to initialize OIDC adapter bridge',
      });
      throw error;
    }
  }

  // ── Backend initializers ──────────────────────────────────────────────────

  private async initializeMongoDB(): Promise<void> {
    const config = this.configManager.getConfig();
    const mongoConfig = config.oidc_storage.oidc_adapter.mongodb;

    const db: Db = await connectMongoDB({
      uri: mongoConfig.uri,
      dbName: mongoConfig.database,
    });

    this._adapterFactory = createMongoAdapterFactory(db, this.logger);

    this._session = new MongodbOidcAdminService('Session', db, this.logger);
    this._grant = new MongodbOidcAdminService('Grant', db, this.logger);
    this._client = new MongodbOidcAdminService('Client', db, this.logger);
    this._accessToken = new MongodbOidcAdminService(
      'AccessToken',
      db,
      this.logger
    );
    this._refreshToken = new MongodbOidcAdminService(
      'RefreshToken',
      db,
      this.logger
    );
    this._interaction = new MongodbOidcAdminService(
      'Interaction',
      db,
      this.logger
    );

    this.logger.info('MongoDB OIDC adapter initialized');
  }

  private async initializeRedis(): Promise<void> {
    const config = this.configManager.getConfig();
    const redisConfig = config.oidc_storage.oidc_adapter.redis;
    // Pass basePrefix (not oidcPrefix) — the adapter key() methods embed
    // the 'oidc' subsystem segment in the unified format:
    // {basePrefix}:{tenantId}:oidc:{model}:{id}
    const basePrefix = config.deployment?.redis_prefix || 'parako';

    const auth = redisConfig.password ? `:${redisConfig.password}@` : '';
    const uri = `redis://${auth}${redisConfig.host}:${redisConfig.port}/${redisConfig.database}`;

    const redisClient: Redis = await connectRedis({ uri });

    this._adapterFactory = createRedisAdapterFactory(
      redisClient,
      this.logger,
      basePrefix
    );

    this._session = new RedisOidcAdminService(
      'Session',
      redisClient,
      this.logger,
      basePrefix
    );
    this._grant = new RedisOidcAdminService(
      'Grant',
      redisClient,
      this.logger,
      basePrefix
    );
    this._client = new RedisOidcAdminService(
      'Client',
      redisClient,
      this.logger,
      basePrefix
    );
    this._accessToken = new RedisOidcAdminService(
      'AccessToken',
      redisClient,
      this.logger,
      basePrefix
    );
    this._refreshToken = new RedisOidcAdminService(
      'RefreshToken',
      redisClient,
      this.logger,
      basePrefix
    );
    this._interaction = new RedisOidcAdminService(
      'Interaction',
      redisClient,
      this.logger,
      basePrefix
    );

    this.logger.info('Redis OIDC adapter initialized');
  }

  private initializePrisma(): void {
    if (!this.prismaClient) {
      throw new Error(
        'PrismaClient is not available. Ensure storage.adapter is sqlite or postgresql.'
      );
    }
    this._adapterFactory = createPrismaAdapterFactory(
      this.prismaClient,
      this.logger
    );

    this._session = new PrismaOidcAdminService(this.prismaClient, 'Session');
    this._grant = new PrismaOidcAdminService(this.prismaClient, 'Grant');
    this._client = new PrismaOidcAdminService(this.prismaClient, 'Client');
    this._accessToken = new PrismaOidcAdminService(
      this.prismaClient,
      'AccessToken'
    );
    this._refreshToken = new PrismaOidcAdminService(
      this.prismaClient,
      'RefreshToken'
    );
    this._interaction = new PrismaOidcAdminService(
      this.prismaClient,
      'Interaction'
    );
    this.logger.info('Prisma OIDC adapter initialized');
  }

  // ── Public getters ────────────────────────────────────────────────────────

  /**
   * Get the adapter factory. All three backends now expose the same
   * (modelName: string) => BaseOIDCAdapter signature.
   */
  get adapter(): AdapterFactory {
    if (!this._isInitialized || !this._adapterFactory) {
      throw new Error(
        'OIDC adapter bridge not initialized. Call initialize() first.'
      );
    }
    return this._adapterFactory;
  }

  get session():
    | MongodbOidcAdminService
    | RedisOidcAdminService
    | PrismaOidcAdminService {
    if (!this._isInitialized) {
      throw new Error(
        'OIDC adapter bridge not initialized. Call initialize() first.'
      );
    }
    if (!this._session) {
      throw new Error('Session service not initialized.');
    }
    return this._session;
  }

  get grant():
    | MongodbOidcAdminService
    | RedisOidcAdminService
    | PrismaOidcAdminService {
    if (!this._isInitialized) {
      throw new Error(
        'OIDC adapter bridge not initialized. Call initialize() first.'
      );
    }
    if (!this._grant) {
      throw new Error('Grant service not initialized.');
    }
    return this._grant;
  }

  get client():
    | MongodbOidcAdminService
    | RedisOidcAdminService
    | PrismaOidcAdminService {
    if (!this._isInitialized) {
      throw new Error(
        'OIDC adapter bridge not initialized. Call initialize() first.'
      );
    }
    if (!this._client) {
      throw new Error('Client service not initialized.');
    }
    return this._client;
  }

  get accessToken():
    | MongodbOidcAdminService
    | RedisOidcAdminService
    | PrismaOidcAdminService {
    if (!this._isInitialized) {
      throw new Error(
        'OIDC adapter bridge not initialized. Call initialize() first.'
      );
    }
    if (!this._accessToken) {
      throw new Error('AccessToken service not initialized.');
    }
    return this._accessToken;
  }

  get refreshToken():
    | MongodbOidcAdminService
    | RedisOidcAdminService
    | PrismaOidcAdminService {
    if (!this._isInitialized) {
      throw new Error(
        'OIDC adapter bridge not initialized. Call initialize() first.'
      );
    }
    if (!this._refreshToken) {
      throw new Error('RefreshToken service not initialized.');
    }
    return this._refreshToken;
  }

  get interaction():
    | MongodbOidcAdminService
    | RedisOidcAdminService
    | PrismaOidcAdminService {
    if (!this._isInitialized) {
      throw new Error(
        'OIDC adapter bridge not initialized. Call initialize() first.'
      );
    }
    if (!this._interaction) {
      throw new Error('Interaction service not initialized.');
    }
    return this._interaction;
  }

  get adapterType(): 'mongodb' | 'redis' | 'sqlite' | 'postgresql' {
    return this.effectiveOidcAdapter();
  }

  get isInitialized(): boolean {
    return this._isInitialized;
  }

  /**
   * Get connection information for monitoring
   */
  getConnectionInfo(): { type: string; status: string; config: unknown } {
    if (!this._isInitialized) {
      return {
        type: 'none',
        status: 'not_initialized',
        config: null,
      };
    }

    const adapterType = this.adapterType;
    const config = this.configManager.getConfig();
    const adapterConfig =
      adapterType === 'redis'
        ? config.oidc_storage.oidc_adapter.redis
        : config.oidc_storage.oidc_adapter.mongodb;

    return {
      type: adapterType,
      status: 'connected',
      config:
        adapterType === 'mongodb'
          ? {
              ...adapterConfig,
              uri: (
                adapterConfig as typeof config.oidc_storage.oidc_adapter.mongodb
              ).uri?.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'),
            }
          : adapterConfig,
    };
  }

  /**
   * Reinitialize the adapter when storage configuration changes
   */
  private async reinitializeAdapter(): Promise<void> {
    try {
      this.logger.info(
        'Reinitializing OIDC adapter due to configuration change'
      );

      this._isInitialized = false;
      this._adapterFactory = null;
      this._session = null;
      this._grant = null;
      this._client = null;
      this._accessToken = null;
      this._refreshToken = null;
      this._interaction = null;

      await this.initialize();

      this.logger.info('OIDC adapter reinitialized successfully');
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Failed to reinitialize OIDC adapter',
      });
    }
  }
}
