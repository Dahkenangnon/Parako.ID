import type { RuntimeConfig } from '../../config/types.js';

export interface ConfigurationHealthChecks {
  configLoaded: boolean;
  databaseConnectivity?: boolean;
  smtpConnectivity?: boolean | null;
  oidcStorageConnectivity?: boolean;
  oidcIssuerReachable?: boolean | null;
}

export interface ConfigurationHealthResponse {
  status: 'healthy' | 'unhealthy';
  provider?: 'file' | 'database';
  lastLoaded?: string;
  error?: 'Health check failed';
  checks: ConfigurationHealthChecks;
  responseTime: number;
}

interface RedisHealthClient {
  connect(): Promise<unknown>;
  ping(): Promise<string>;
  quit(): Promise<unknown>;
}

interface RedisConnectionOptions {
  lazyConnect: true;
  connectTimeout: number;
  maxRetriesPerRequest: number;
}

interface IssuerResponse {
  ok: boolean;
  status: number;
}

export interface ConfigurationHealthDependencies {
  isConfigLoaded(): boolean;
  getConfig(): RuntimeConfig;
  probeDatabase(): Promise<void>;
  probeSmtp(): Promise<boolean>;
  createRedisClient(
    uri: string,
    options: RedisConnectionOptions
  ): RedisHealthClient;
  fetchIssuer(
    url: string,
    init: { method: 'GET'; signal: AbortSignal }
  ): Promise<IssuerResponse>;
  isUsingFileConfig(): boolean;
  warn(message: string, context?: Record<string, unknown>): void;
  now(): number;
}

export interface ConfigurationHealthResult {
  response: ConfigurationHealthResponse;
  error?: unknown;
}

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    operation.then(
      value => {
        clearTimeout(timeout);
        resolve(value);
      },
      error => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

export class ConfigurationHealthService {
  constructor(private readonly dependencies: ConfigurationHealthDependencies) {}

  async check(): Promise<ConfigurationHealthResult> {
    const startTime = this.dependencies.now();
    const checks: ConfigurationHealthChecks = {
      configLoaded: this.dependencies.isConfigLoaded(),
    };
    let overallHealthy = checks.configLoaded;

    try {
      const config = checks.configLoaded ? this.dependencies.getConfig() : null;

      try {
        await this.dependencies.probeDatabase();
        checks.databaseConnectivity = true;
      } catch (error) {
        this.dependencies.warn('Database connectivity check failed', {
          error,
        });
        checks.databaseConnectivity = false;
        overallHealthy = false;
      }

      await this.checkSmtp(config, checks);
      const oidcStorageHealthy = await this.checkOidcStorage(
        config,
        checks,
        overallHealthy
      );
      overallHealthy = oidcStorageHealthy && overallHealthy;
      await this.checkIssuer(config, checks);

      const response: ConfigurationHealthResponse = {
        status: overallHealthy ? 'healthy' : 'unhealthy',
        provider: this.dependencies.isUsingFileConfig() ? 'file' : 'database',
        lastLoaded: config?._metadata?.loadedAt
          ? new Date(config._metadata.loadedAt).toISOString()
          : new Date(this.dependencies.now()).toISOString(),
        checks,
        responseTime: this.dependencies.now() - startTime,
      };

      return { response };
    } catch (error) {
      return {
        error,
        response: {
          status: 'unhealthy',
          error: 'Health check failed',
          checks,
          responseTime: this.dependencies.now() - startTime,
        },
      };
    }
  }

  private async checkSmtp(
    config: RuntimeConfig | null,
    checks: ConfigurationHealthChecks
  ): Promise<void> {
    if (!config?.integrations?.email?.smtp_host) {
      checks.smtpConnectivity = null;
      return;
    }

    try {
      checks.smtpConnectivity =
        (await withTimeout(
          this.dependencies.probeSmtp(),
          5000,
          'SMTP test timeout'
        )) === true;
    } catch (error) {
      this.dependencies.warn('SMTP connectivity check failed', { error });
      checks.smtpConnectivity = false;
    }
  }

  private async checkOidcStorage(
    config: RuntimeConfig | null,
    checks: ConfigurationHealthChecks,
    overallHealthy: boolean
  ): Promise<boolean> {
    const adapterType = config?.oidc_storage?.oidc_adapter?.type;
    if (
      adapterType === 'mongodb' ||
      adapterType === 'sqlite' ||
      adapterType === 'postgresql'
    ) {
      checks.oidcStorageConnectivity = checks.databaseConnectivity === true;
      return checks.oidcStorageConnectivity && overallHealthy;
    }

    if (adapterType !== 'redis' || !config) {
      checks.oidcStorageConnectivity = false;
      return false;
    }

    return this.checkRedis(config, checks, overallHealthy);
  }

  private async checkRedis(
    config: RuntimeConfig,
    checks: ConfigurationHealthChecks,
    overallHealthy: boolean
  ): Promise<boolean> {
    const redisConfig = config.oidc_storage.oidc_adapter.redis;
    if (!redisConfig?.host || !redisConfig.port) {
      checks.oidcStorageConnectivity = false;
      this.dependencies.warn('Redis config incomplete for health check');
      return false;
    }

    const auth = redisConfig.password
      ? `:${encodeURIComponent(redisConfig.password)}@`
      : '';
    const uri = `redis://${auth}${redisConfig.host}:${redisConfig.port}/${redisConfig.database || 0}`;
    let client: RedisHealthClient | undefined;
    try {
      client = this.dependencies.createRedisClient(uri, {
        lazyConnect: true,
        connectTimeout: 5000,
        maxRetriesPerRequest: 1,
      });
      await client.connect();
      checks.oidcStorageConnectivity = (await client.ping()) === 'PONG';
      return checks.oidcStorageConnectivity && overallHealthy;
    } catch (error) {
      this.dependencies.warn('Redis connectivity check failed', { error });
      checks.oidcStorageConnectivity = false;
      return false;
    } finally {
      if (client) {
        try {
          await client.quit();
        } catch (error) {
          this.dependencies.warn('Redis health client cleanup failed', {
            error,
          });
        }
      }
    }
  }

  private async checkIssuer(
    config: RuntimeConfig | null,
    checks: ConfigurationHealthChecks
  ): Promise<void> {
    if (!config?.oidc?.issuer) {
      checks.oidcIssuerReachable = null;
      return;
    }

    try {
      const issuerUrl = `${config.oidc.issuer}/.well-known/openid-configuration`;
      const response = await this.dependencies.fetchIssuer(issuerUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      checks.oidcIssuerReachable = response.ok;
      if (!response.ok) {
        this.dependencies.warn('OIDC issuer not reachable', {
          issuerUrl,
          status: response.status,
        });
      }
    } catch (error) {
      this.dependencies.warn('OIDC issuer reachability check failed', {
        error,
      });
      checks.oidcIssuerReachable = false;
    }
  }
}
