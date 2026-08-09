import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const mocks = vi.hoisted(() => ({
  dotenvConfig: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock('node:fs', () => ({ existsSync: mocks.existsSync }));
vi.mock('dotenv', () => ({
  default: { config: mocks.dotenvConfig },
}));

import { BootstrapConfigProvider } from '../../../src/config/provider/bootstrap-provider.js';

const ENV_KEYS = [
  'DEPLOYMENT_ENVIRONMENT',
  'DEPLOYMENT_SERVER_PORT',
  'DEPLOYMENT_URL',
  'FILE_STORAGE_PROVIDER',
  'MULTI_TENANCY_ENABLED',
  'MULTI_TENANCY_EXTRACTION_PRIORITY',
  'MULTI_TENANCY_PROVIDER_POOL_CLEANUP_INTERVAL_MS',
  'MULTI_TENANCY_PROVIDER_POOL_IDLE_TTL_MS',
  'MULTI_TENANCY_PROVIDER_POOL_MAX_SIZE',
  'MULTI_TENANCY_TENANT_HEADER',
  'OIDC_STORAGE_ADAPTER',
  'REDIS_DATABASE',
  'REDIS_HOST',
  'REDIS_PASSWORD',
  'REDIS_PORT',
  'STORAGE_ADAPTER',
  'STORAGE_MONGODB_URI',
  'STORAGE_POSTGRESQL_URL',
  'STORAGE_SQLITE_PATH',
] as const;

const originalEnv = new Map(
  ENV_KEYS.map(key => [key, process.env[key]] as const)
);

const validEnvironment = (overrides: Record<string, string> = {}) => ({
  DEPLOYMENT_ENVIRONMENT: 'production',
  DEPLOYMENT_SERVER_PORT: '9007',
  STORAGE_ADAPTER: 'sqlite',
  STORAGE_SQLITE_PATH: './runtime/data/parako.db',
  ...overrides,
});

const setEnvironment = (values: Record<string, string>) => {
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
};

describe.sequential('BootstrapConfigProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    for (const key of ENV_KEYS) delete process.env[key];
    mocks.dotenvConfig.mockReset();
    mocks.existsSync.mockReset();
    mocks.existsSync.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('loads and reports availability from process environment without files', async () => {
    setEnvironment(validEnvironment());
    const provider = new BootstrapConfigProvider();

    expect(await provider.isAvailable()).toBe(true);
    await expect(provider.loadConfiguration()).resolves.toMatchObject({
      deployment: { environment: 'production', server: { port: 9007 } },
      storage: {
        adapter: 'sqlite',
        sqlite: { path: './runtime/data/parako.db' },
      },
    });
    expect(mocks.dotenvConfig).not.toHaveBeenCalled();
  });

  it('applies local-file precedence and converts typed bootstrap values', async () => {
    setEnvironment(validEnvironment({ DEPLOYMENT_SERVER_PORT: '7000' }));
    mocks.existsSync.mockReturnValue(true);
    mocks.dotenvConfig.mockImplementation(({ path }: { path: string }) => ({
      parsed:
        path === 'runtime/.env'
          ? validEnvironment({
              DEPLOYMENT_SERVER_PORT: '8000',
              MULTI_TENANCY_ENABLED: 'false',
            })
          : {
              DEPLOYMENT_SERVER_PORT: '9000',
              MULTI_TENANCY_ENABLED: 'true',
              MULTI_TENANCY_EXTRACTION_PRIORITY: ' subdomain, header ',
              MULTI_TENANCY_PROVIDER_POOL_CLEANUP_INTERVAL_MS: '60000',
              MULTI_TENANCY_PROVIDER_POOL_IDLE_TTL_MS: '1800000',
              MULTI_TENANCY_PROVIDER_POOL_MAX_SIZE: '25',
              REDIS_DATABASE: '2',
              REDIS_HOST: 'redis.internal',
              REDIS_PORT: '6380',
            },
    }));
    const provider = new BootstrapConfigProvider();

    const config = await provider.loadConfiguration();

    expect(config.deployment.server.port).toBe(9000);
    expect(config.redis).toMatchObject({
      database: 2,
      host: 'redis.internal',
      port: 6380,
    });
    expect(config.multiTenancy).toMatchObject({
      enabled: true,
      extraction_priority: ['subdomain', 'header'],
      provider_pool: {
        cleanup_interval_ms: 60_000,
        idle_ttl_ms: 1_800_000,
        max_size: 25,
      },
    });
    expect(mocks.dotenvConfig).toHaveBeenNthCalledWith(1, {
      path: 'runtime/.env',
      quiet: true,
    });
    expect(mocks.dotenvConfig).toHaveBeenNthCalledWith(2, {
      path: 'runtime/.env.local',
      quiet: true,
    });
  });

  it('rejects partially numeric ports instead of silently truncating them', async () => {
    mocks.existsSync.mockReturnValue(true);
    mocks.dotenvConfig.mockReturnValue({
      parsed: validEnvironment({ DEPLOYMENT_SERVER_PORT: '9007junk' }),
    });

    await expect(
      new BootstrapConfigProvider().loadConfiguration()
    ).rejects.toThrow('Bootstrap configuration validation failed');
  });

  it('rejects invalid boolean text instead of silently treating it as false', async () => {
    mocks.existsSync.mockReturnValue(true);
    mocks.dotenvConfig.mockReturnValue({
      parsed: validEnvironment({ MULTI_TENANCY_ENABLED: 'truthy' }),
    });

    await expect(
      new BootstrapConfigProvider().loadConfiguration()
    ).rejects.toThrow(
      'Invalid boolean value for MULTI_TENANCY_ENABLED: "truthy"'
    );
  });

  it('uses process values when existing dotenv files contain no parsed data', async () => {
    setEnvironment(validEnvironment());
    mocks.existsSync.mockReturnValue(true);
    mocks.dotenvConfig.mockReturnValue({});

    await expect(
      new BootstrapConfigProvider().loadConfiguration()
    ).resolves.toMatchObject({
      deployment: { server: { port: 9007 } },
      storage: { adapter: 'sqlite' },
    });
  });

  it('warns on returned and thrown dotenv errors before using process values', async () => {
    setEnvironment(validEnvironment());
    mocks.existsSync.mockReturnValue(true);
    mocks.dotenvConfig
      .mockReturnValueOnce({ error: new Error('base read failed') })
      .mockImplementationOnce(() => {
        throw new String('local read failed');
      });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      new BootstrapConfigProvider().loadConfiguration()
    ).resolves.toMatchObject({ storage: { adapter: 'sqlite' } });
    expect(warning).toHaveBeenNthCalledWith(
      1,
      'Failed to load .env file:',
      'base read failed'
    );
    expect(warning).toHaveBeenNthCalledWith(
      2,
      'Failed to load .env.local file:',
      'local read failed'
    );

    warning.mockRestore();
  });

  it('normalizes opposite dotenv error types for both files', async () => {
    setEnvironment(validEnvironment());
    mocks.existsSync.mockReturnValue(true);
    mocks.dotenvConfig
      .mockImplementationOnce(() => {
        throw new String('base string failure');
      })
      .mockReturnValueOnce({ error: new Error('local error failure') });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      new BootstrapConfigProvider().loadConfiguration()
    ).resolves.toMatchObject({ storage: { adapter: 'sqlite' } });
    expect(warning).toHaveBeenNthCalledWith(
      1,
      'Failed to load .env file:',
      'base string failure'
    );
    expect(warning).toHaveBeenNthCalledWith(
      2,
      'Failed to load .env.local file:',
      'local error failure'
    );
  });

  it('reports the absence of all bootstrap inputs', async () => {
    await expect(
      new BootstrapConfigProvider().loadConfiguration()
    ).rejects.toThrow('No bootstrap configuration found');
  });

  it('normalizes non-Error failures from the load pipeline', async () => {
    setEnvironment(validEnvironment());
    const info = vi.spyOn(console, 'info').mockImplementationOnce(() => {
      throw new String('logging failed');
    });

    await expect(
      new BootstrapConfigProvider().loadConfiguration()
    ).rejects.toThrow('Failed to load bootstrap configuration: logging failed');

    info.mockRestore();
  });

  it('caches loads, supports synchronous lookup, and reloads after clearing', async () => {
    mocks.existsSync.mockReturnValue(true);
    mocks.dotenvConfig.mockReturnValue({ parsed: validEnvironment() });
    const provider = new BootstrapConfigProvider();

    expect(provider.isCached()).toBe(false);
    expect(provider.getConfigValue('deployment.server.port')).toBe(9007);
    expect(provider.isCached()).toBe(true);
    expect(await provider.loadConfiguration()).toBe(
      await provider.loadConfiguration()
    );
    expect(mocks.dotenvConfig).toHaveBeenCalledTimes(2);

    mocks.dotenvConfig.mockReturnValue({
      parsed: validEnvironment({ DEPLOYMENT_SERVER_PORT: '9010' }),
    });
    expect((await provider.reloadConfiguration()).deployment.server.port).toBe(
      9010
    );
    expect(mocks.dotenvConfig).toHaveBeenCalledTimes(4);
  });

  it('returns defaults for missing, dangerous, and inherited lookup paths', async () => {
    mocks.existsSync.mockReturnValue(true);
    mocks.dotenvConfig.mockReturnValue({ parsed: validEnvironment() });
    const provider = new BootstrapConfigProvider();
    await provider.loadConfiguration();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(provider.getConfigValue('deployment.missing', 'fallback')).toBe(
      'fallback'
    );
    expect(provider.getConfigValue('__proto__.polluted', 'safe')).toBe('safe');
    expect(provider.getConfigValue('toString', 'safe')).toBe('safe');
    expect(provider.getConfigValue('deployment.other')).toBeUndefined();
    expect(provider.getConfigValue('missing')).toBeUndefined();
    expect(provider.getConfigValue('storage.mongodb.uri')).toBeUndefined();
    expect(warning).toHaveBeenCalledTimes(4);

    warning.mockRestore();
  });

  it('identifies itself and rejects runtime updates', async () => {
    const provider = new BootstrapConfigProvider();

    expect(provider.getProviderName()).toBe('bootstrap');
    await expect(provider.updateConfig?.({})).rejects.toThrow(
      'Configuration updates not supported for bootstrap provider'
    );
  });
});
