import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeConfig } from '../../../../src/config/types.js';
import { getDefaultFullConfig } from '../../../../src/config/constants.js';
import { ConfigurationHealthService } from '../../../../src/services/admin/configuration-health.service.js';

function runtimeConfig(): RuntimeConfig {
  const config = getDefaultFullConfig();
  return {
    ...config,
    deployment: {
      ...config.deployment,
      environment: 'development',
      server: { ...config.deployment.server, port: 9007 },
    },
    storage: { adapter: 'sqlite', sqlite: { path: 'runtime/test.db' } },
    _metadata: {
      configProvider: 'database',
      isBootstrapMerged: true,
      loadedAt: new Date('2026-08-02T08:30:00.000Z'),
    },
  };
}

describe('ConfigurationHealthService', () => {
  const redisClient = {
    connect: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn().mockResolvedValue('PONG'),
    quit: vi.fn().mockResolvedValue(undefined),
  };
  const config = runtimeConfig();
  const dependencies = {
    isConfigLoaded: vi.fn().mockReturnValue(true),
    getConfig: vi.fn(() => config),
    probeDatabase: vi.fn().mockResolvedValue(undefined),
    probeSmtp: vi.fn().mockResolvedValue(true),
    createRedisClient: vi.fn(() => redisClient),
    fetchIssuer: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    isUsingFileConfig: vi.fn().mockReturnValue(false),
    warn: vi.fn(),
    now: vi.fn().mockReturnValue(1000),
  };
  let service: ConfigurationHealthService;

  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.isConfigLoaded.mockReturnValue(true);
    dependencies.getConfig.mockReturnValue(config);
    dependencies.probeDatabase.mockResolvedValue(undefined);
    dependencies.probeSmtp.mockResolvedValue(true);
    dependencies.createRedisClient.mockReturnValue(redisClient);
    dependencies.fetchIssuer.mockResolvedValue({ ok: true, status: 200 });
    dependencies.isUsingFileConfig.mockReturnValue(false);
    dependencies.now.mockReturnValue(1000);
    redisClient.connect.mockResolvedValue(undefined);
    redisClient.ping.mockResolvedValue('PONG');
    redisClient.quit.mockResolvedValue(undefined);
    service = new ConfigurationHealthService(dependencies);
  });

  it('reports shared-database storage and optional probes independently', async () => {
    const current = runtimeConfig();
    current.oidc_storage.oidc_adapter.type = 'sqlite';
    current.integrations.email.smtp_host = 'smtp.example.test';
    dependencies.getConfig.mockReturnValue(current);

    await expect(service.check()).resolves.toEqual({
      response: {
        status: 'healthy',
        provider: 'database',
        lastLoaded: '2026-08-02T08:30:00.000Z',
        checks: {
          configLoaded: true,
          databaseConnectivity: true,
          smtpConnectivity: true,
          oidcStorageConnectivity: true,
          oidcIssuerReachable: true,
        },
        responseTime: 0,
      },
    });
  });

  it('marks database and shared OIDC storage failures as unhealthy', async () => {
    dependencies.probeDatabase.mockRejectedValue(
      new Error('database unavailable')
    );

    const result = await service.check();

    expect(result.response.status).toBe('unhealthy');
    expect(result.response.checks).toMatchObject({
      databaseConnectivity: false,
      oidcStorageConnectivity: false,
    });
    expect(dependencies.warn).toHaveBeenCalledWith(
      'Database connectivity check failed',
      { error: expect.any(Error) }
    );
  });

  it('encodes Redis credentials and always closes the probe client', async () => {
    const current = runtimeConfig();
    current.oidc_storage.oidc_adapter = {
      ...current.oidc_storage.oidc_adapter,
      type: 'redis',
      redis: {
        host: 'redis.internal',
        port: 6380,
        password: 'p@ss:/word',
        database: 4,
      },
    };
    dependencies.getConfig.mockReturnValue(current);

    const result = await service.check();

    expect(dependencies.createRedisClient).toHaveBeenCalledWith(
      'redis://:p%40ss%3A%2Fword@redis.internal:6380/4',
      {
        lazyConnect: true,
        connectTimeout: 5000,
        maxRetriesPerRequest: 1,
      }
    );
    expect(redisClient.quit).toHaveBeenCalledOnce();
    expect(result.response.status).toBe('healthy');
  });

  it('handles Redis client construction failure as an unhealthy storage probe', async () => {
    const current = runtimeConfig();
    current.oidc_storage.oidc_adapter = {
      ...current.oidc_storage.oidc_adapter,
      type: 'redis',
      redis: { host: 'redis.internal', port: 6379, database: 0 },
    };
    dependencies.getConfig.mockReturnValue(current);
    dependencies.createRedisClient.mockImplementation(() => {
      throw new Error('client construction failed');
    });

    const result = await service.check();

    expect(result.error).toBeUndefined();
    expect(result.response.status).toBe('unhealthy');
    expect(result.response.checks.oidcStorageConnectivity).toBe(false);
    expect(dependencies.warn).toHaveBeenCalledWith(
      'Redis connectivity check failed',
      { error: expect.any(Error) }
    );
    expect(redisClient.quit).not.toHaveBeenCalled();
  });

  it('keeps readiness healthy when optional SMTP and issuer probes fail', async () => {
    const current = runtimeConfig();
    current.integrations.email.smtp_host = 'smtp.example.test';
    dependencies.getConfig.mockReturnValue(current);
    dependencies.probeSmtp.mockRejectedValue(new Error('SMTP unavailable'));
    dependencies.fetchIssuer.mockRejectedValue(new Error('issuer unavailable'));

    const result = await service.check();

    expect(result.response.status).toBe('healthy');
    expect(result.response.checks).toMatchObject({
      smtpConnectivity: false,
      oidcIssuerReachable: false,
    });
  });

  it('does not read config when it is not loaded', async () => {
    dependencies.isConfigLoaded.mockReturnValue(false);

    const result = await service.check();

    expect(dependencies.getConfig).not.toHaveBeenCalled();
    expect(result.response).toMatchObject({
      status: 'unhealthy',
      checks: {
        configLoaded: false,
        databaseConnectivity: true,
        smtpConnectivity: null,
        oidcStorageConnectivity: false,
        oidcIssuerReachable: null,
      },
    });
  });

  it('returns a stable failure envelope with completed checks', async () => {
    const failure = new Error('configuration corrupted');
    dependencies.getConfig.mockImplementation(() => {
      throw failure;
    });

    await expect(service.check()).resolves.toEqual({
      error: failure,
      response: {
        status: 'unhealthy',
        error: 'Health check failed',
        checks: { configLoaded: true },
        responseTime: 0,
      },
    });
  });
});
