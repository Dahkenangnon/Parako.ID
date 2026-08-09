import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  type Listener = (...args: any[]) => any;
  const serverBehavior = {
    listenError: undefined as NodeJS.ErrnoException | undefined,
    closeError: undefined as Error | undefined,
    closeHangs: false,
    requestTimeoutSupported: true,
  };
  const hardening = {
    timeouts: {
      keepAliveMs: 5_000,
      headersMs: 6_000,
      requestMs: 7_000,
      tcpNoDelay: true,
    },
  };

  class FakeHttpServer {
    public keepAliveTimeout = 0;
    public headersTimeout = 0;
    public requestTimeout: number | undefined =
      serverBehavior.requestTimeoutSupported ? 0 : undefined;
    public readonly onceListeners = new Map<string, Listener>();
    public readonly listeners = new Map<string, Listener[]>();
    public listen = vi.fn((_port: number) => {
      if (serverBehavior.listenError) {
        this.onceListeners.get('error')?.(serverBehavior.listenError);
      } else {
        this.onceListeners.get('listening')?.();
      }
      return this;
    });
    public close = vi.fn((callback: (error?: Error) => void) => {
      if (!serverBehavior.closeHangs) callback(serverBehavior.closeError);
    });

    public once(event: string, listener: Listener): this {
      this.onceListeners.set(event, listener);
      return this;
    }

    public on(event: string, listener: Listener): this {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(listener);
      this.listeners.set(event, listeners);
      return this;
    }
  }

  const processHandlers = new Map<string, Listener>();
  const processMock = {
    env: {} as Record<string, string | undefined>,
    send: vi.fn() as any,
    exit: vi.fn() as any,
    on: vi.fn((event: string, listener: Listener) => {
      processHandlers.set(event, listener);
      return processMock;
    }),
  };

  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    shutdown: vi.fn(),
  };
  const configManager = {
    getBootstrapConfig: vi.fn(),
    load: vi.fn(),
    flushInitial: vi.fn(),
    isUsingFileConfig: vi.fn(),
    reload: vi.fn(),
    getConfig: vi.fn(),
    setPubSub: vi.fn(),
    cleanup: vi.fn(),
  };
  const database = {
    initializeWithBootstrapConfig: vi.fn(),
    connect: vi.fn(),
    isConnected: vi.fn(),
    disconnect: vi.fn(),
  };
  const settingsService = { validateAndFixActiveConfigs: vi.fn() };
  const pubsubService = {
    connect: vi.fn(),
    subscribe: vi.fn(),
    disconnect: vi.fn(),
  };
  const emailService = {
    initialize: vi.fn(),
    connectToEmailServer: vi.fn(),
  };
  const application = { initialize: vi.fn() };
  const activityService = { shutdown: vi.fn() };
  const oidcAdapterBridge = { client: { destroy: vi.fn() } };
  const expressApp = { set: vi.fn() };
  const rateLimitRedisClient = { quit: vi.fn() };

  const TYPES = {
    ConfigManager: 'ConfigManager',
    DatabaseConnectionManager: 'DatabaseConnectionManager',
    Logger: 'Logger',
    SettingsService: 'SettingsService',
    RedisPubSubService: 'RedisPubSubService',
    EmailService: 'EmailService',
    Application: 'Application',
    ActivityService: 'ActivityService',
    OIDCAdapterBridge: 'OIDCAdapterBridge',
  };
  const services = new Map<any, any>([
    [TYPES.ConfigManager, configManager],
    [TYPES.DatabaseConnectionManager, database],
    [TYPES.Logger, logger],
    [TYPES.SettingsService, settingsService],
    [TYPES.RedisPubSubService, pubsubService],
    [TYPES.EmailService, emailService],
    [TYPES.Application, application],
    [TYPES.ActivityService, activityService],
    [TYPES.OIDCAdapterBridge, oidcAdapterBridge],
  ]);

  const servers: FakeHttpServer[] = [];
  const createServer = vi.fn(() => {
    const server = new FakeHttpServer();
    servers.push(server);
    return server;
  });

  return {
    processHandlers,
    processMock,
    logger,
    configManager,
    database,
    settingsService,
    pubsubService,
    emailService,
    application,
    activityService,
    oidcAdapterBridge,
    expressApp,
    rateLimitRedisClient,
    TYPES,
    services,
    servers,
    serverBehavior,
    hardening,
    createServer,
    container: { get: vi.fn((token: any) => services.get(token)) },
    assertContainerValid: vi.fn(),
    initRateLimitRedis: vi.fn(),
    getRateLimitRedisClient: vi.fn(),
    markShuttingDown: vi.fn(),
    safeShutdownStep: vi.fn(
      async (_name: string, step: () => Promise<void> | void) => step()
    ),
    bootstrapMasterTenant: vi.fn(),
  };
});

vi.mock('node:process', () => ({ default: harness.processMock }));
vi.mock('node:http', () => ({
  default: { createServer: harness.createServer },
}));
vi.mock('../../src/di/types.js', () => ({ TYPES: harness.TYPES }));
vi.mock('../../src/di/index.js', () => ({
  containerReady: Promise.resolve(harness.container),
  assertContainerValid: harness.assertContainerValid,
}));
vi.mock('../../src/utils/rate-limiter.js', () => ({
  initRateLimitRedis: harness.initRateLimitRedis,
  getRateLimitRedisClient: harness.getRateLimitRedisClient,
}));
vi.mock('../../src/utils/shutdown.js', () => ({
  SERVER_CLOSE_TIMEOUT_MS: 1_000,
  SHUTDOWN_TIMEOUT_MS: 2_000,
  markShuttingDown: harness.markShuttingDown,
  safeShutdownStep: harness.safeShutdownStep,
}));
vi.mock('../../src/config/hardening-defaults.js', () => ({
  HARDENING: harness.hardening,
}));
vi.mock('../../src/multi-tenancy/master-tenant-bootstrap.js', () => ({
  bootstrapMasterTenant: harness.bootstrapMasterTenant,
}));

const bootstrapConfig = {
  deployment: {
    environment: 'test',
    server: { port: 9007 },
  },
  storage: { adapter: 'postgresql' },
  multiTenancy: { enabled: false },
};
const runtimeConfig = {
  deployment: { redis_prefix: 'test-prefix' },
};

async function importEntrypoint(): Promise<void> {
  await import('../../src/index.js');
  await vi.waitFor(() => {
    expect(harness.logger.info).toHaveBeenCalledWith(
      'Server listening on port 9007',
      expect.any(Object)
    );
    expect(harness.processHandlers.has('message')).toBe(true);
  });
}

async function importUntilExit(code = 1): Promise<void> {
  await import('../../src/index.js');
  await vi.waitFor(() => {
    expect(harness.processMock.exit).toHaveBeenCalledWith(code);
  });
}

describe('server process entrypoint', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    harness.processHandlers.clear();
    harness.servers.splice(0);
    harness.serverBehavior.listenError = undefined;
    harness.serverBehavior.closeError = undefined;
    harness.serverBehavior.closeHangs = false;
    harness.serverBehavior.requestTimeoutSupported = true;
    harness.hardening.timeouts.tcpNoDelay = true;
    harness.processMock.env = {};
    harness.processMock.send = vi.fn();
    harness.configManager.getBootstrapConfig.mockResolvedValue(bootstrapConfig);
    harness.configManager.load.mockResolvedValue(undefined);
    harness.configManager.flushInitial.mockResolvedValue(undefined);
    harness.configManager.isUsingFileConfig.mockReturnValue(false);
    harness.configManager.reload.mockResolvedValue(undefined);
    harness.configManager.getConfig.mockReturnValue(runtimeConfig);
    harness.database.connect.mockResolvedValue(undefined);
    harness.database.isConnected.mockReturnValue(true);
    harness.database.disconnect.mockResolvedValue(undefined);
    harness.settingsService.validateAndFixActiveConfigs.mockResolvedValue({
      multipleActiveFound: false,
      isValid: true,
      details: 'valid',
    });
    harness.pubsubService.connect.mockResolvedValue(undefined);
    harness.pubsubService.disconnect.mockResolvedValue(undefined);
    harness.emailService.connectToEmailServer.mockResolvedValue(true);
    harness.application.initialize.mockResolvedValue(harness.expressApp);
    harness.activityService.shutdown.mockResolvedValue(undefined);
    harness.oidcAdapterBridge.client.destroy.mockResolvedValue(undefined);
    harness.rateLimitRedisClient.quit.mockResolvedValue(undefined);
    harness.getRateLimitRedisClient.mockReturnValue(
      harness.rateLimitRedisClient
    );
    harness.logger.shutdown.mockResolvedValue(undefined);
    harness.safeShutdownStep.mockImplementation(
      async (_name: string, step: () => Promise<void> | void) => step()
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('boots the application and exposes a hardened HTTP server', async () => {
    await importEntrypoint();

    expect(harness.assertContainerValid).toHaveBeenCalledWith(
      harness.container
    );
    expect(harness.database.initializeWithBootstrapConfig).toHaveBeenCalledWith(
      bootstrapConfig
    );
    expect(harness.configManager.load).toHaveBeenCalledTimes(2);
    expect(harness.application.initialize).toHaveBeenCalledOnce();
    expect(harness.expressApp.set).toHaveBeenCalledWith('port', 9007);

    const server = harness.servers.at(-1)!;
    expect(server.listen).toHaveBeenCalledWith(9007);
    expect(server.keepAliveTimeout).toBe(5_000);
    expect(server.headersTimeout).toBe(6_000);
    expect(server.requestTimeout).toBe(7_000);
    expect(server.listeners.has('connection')).toBe(true);
    expect(harness.processMock.send).toHaveBeenCalledWith('ready');
    expect([...harness.processHandlers.keys()]).toEqual([
      'uncaughtException',
      'unhandledRejection',
      'SIGTERM',
      'SIGINT',
      'message',
    ]);
  });

  it('rejects unsafe SQLite cluster mode before initializing services', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    harness.processMock.env = { PM2_INSTANCES: '2' };
    harness.processMock.exit.mockImplementationOnce(() => {
      throw new Error('process exited');
    });
    harness.configManager.getBootstrapConfig.mockResolvedValue({
      ...bootstrapConfig,
      storage: { adapter: 'sqlite' },
    });

    await expect(import('../../src/index.js')).rejects.toThrow(
      'process exited'
    );

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(
        'SQLite storage adapter detected with PM2_INSTANCES > 1'
      )
    );
    expect(harness.database.connect).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('rejects SQLite multi-tenancy before initializing services', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    harness.configManager.getBootstrapConfig.mockResolvedValue({
      ...bootstrapConfig,
      storage: { adapter: 'sqlite' },
      multiTenancy: { enabled: true },
    });
    harness.processMock.exit.mockImplementationOnce(() => {
      throw new Error('process exited');
    });

    await expect(import('../../src/index.js')).rejects.toThrow(
      'process exited'
    );

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(
        'Multi-tenancy is enabled but storage adapter is SQLite'
      )
    );
    expect(harness.database.connect).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('continues with bootstrap configuration when persisted config is unavailable', async () => {
    const failure = new Error('settings unavailable');
    harness.configManager.load.mockRejectedValue(failure);

    await importEntrypoint();

    expect(harness.logger.warn).toHaveBeenCalledWith(
      'Failed to load full configuration, continuing with bootstrap config',
      { error: failure }
    );
    expect(harness.application.initialize).toHaveBeenCalledOnce();
  });

  it('keeps the loaded config when initial persistence fails', async () => {
    const failure = new Error('flush unavailable');
    harness.configManager.flushInitial.mockRejectedValue(failure);

    await importEntrypoint();

    expect(harness.logger.warn).toHaveBeenCalledWith(
      'Failed to flush initial configuration, continuing with loaded config',
      { error: failure }
    );
    expect(harness.configManager.load).toHaveBeenCalledOnce();
  });

  it('does not run database configuration maintenance in file-config mode', async () => {
    harness.configManager.isUsingFileConfig.mockReturnValue(true);

    await importEntrypoint();

    expect(harness.configManager.flushInitial).not.toHaveBeenCalled();
    expect(
      harness.settingsService.validateAndFixActiveConfigs
    ).not.toHaveBeenCalled();
    expect(harness.configManager.load).toHaveBeenCalledOnce();
  });

  it('reloads configuration after healing multiple active versions', async () => {
    harness.settingsService.validateAndFixActiveConfigs.mockResolvedValue({
      multipleActiveFound: true,
      fixedCount: 2,
      keptVersion: '3.0.0',
      details: 'healed',
    });

    await importEntrypoint();

    expect(harness.logger.warn).toHaveBeenCalledWith(
      'Multiple active configurations detected and auto-healed',
      {
        fixedCount: 2,
        keptVersion: '3.0.0',
        details: 'healed',
      }
    );
    expect(harness.configManager.reload).toHaveBeenCalledOnce();
  });

  it('reports invalid configuration without aborting startup', async () => {
    harness.settingsService.validateAndFixActiveConfigs.mockResolvedValue({
      multipleActiveFound: false,
      isValid: false,
      details: 'missing issuer',
    });

    await importEntrypoint();

    expect(harness.logger.warn).toHaveBeenCalledWith(
      'Configuration validation returned issues',
      { details: 'missing issuer' }
    );
  });

  it('isolates configuration validation failures from startup', async () => {
    const failure = new Error('validation offline');
    harness.settingsService.validateAndFixActiveConfigs.mockRejectedValue(
      failure
    );

    await importEntrypoint();

    expect(harness.logger.warn).toHaveBeenCalledWith(
      'Configuration validation failed, but continuing startup',
      { error: failure }
    );
  });

  it('bootstraps the master tenant when multi-tenancy is enabled', async () => {
    const config = {
      ...bootstrapConfig,
      multiTenancy: { enabled: true },
    };
    harness.configManager.getBootstrapConfig.mockResolvedValue(config);

    await importEntrypoint();

    expect(harness.bootstrapMasterTenant).toHaveBeenCalledWith(
      harness.container,
      harness.logger,
      config
    );
  });

  it('isolates master-tenant bootstrap failures from server startup', async () => {
    const failure = new Error('master tenant unavailable');
    harness.configManager.getBootstrapConfig.mockResolvedValue({
      ...bootstrapConfig,
      multiTenancy: { enabled: true },
    });
    harness.bootstrapMasterTenant.mockRejectedValue(failure);

    await importEntrypoint();

    expect(harness.logger.warn).toHaveBeenCalledWith(
      'Master tenant bootstrap failed, continuing startup',
      { error: failure }
    );
  });

  it('fails bootstrap when the database did not connect', async () => {
    harness.database.isConnected.mockReturnValue(false);

    await importUntilExit();

    expect(harness.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Cannot initialize application: database connection failed',
      }),
      expect.objectContaining({ step: 'bootstrap' })
    );
    expect(harness.database.disconnect).toHaveBeenCalledOnce();
  });

  it('connects Redis Pub/Sub and invalidates deleted OIDC clients', async () => {
    harness.configManager.getConfig.mockReturnValue({
      deployment: { redis_prefix: 'tenant-prefix' },
      oidc_storage: {
        oidc_adapter: {
          type: 'redis',
          redis: {
            host: 'redis.local',
            port: 6380,
            database: 4,
            password: 'secret',
          },
        },
      },
    });

    await importEntrypoint();

    const redisUrl = 'redis://:secret@redis.local:6380/4';
    expect(harness.pubsubService.connect).toHaveBeenCalledWith(redisUrl);
    expect(harness.configManager.setPubSub).toHaveBeenCalledWith(
      harness.pubsubService
    );
    expect(harness.initRateLimitRedis).toHaveBeenCalledWith(
      redisUrl,
      'tenant-prefix',
      harness.logger
    );
    expect(harness.pubsubService.subscribe).toHaveBeenCalledWith(
      'tenant-prefix:oidc:client:invalidated',
      expect.any(Function)
    );

    const invalidate = harness.pubsubService.subscribe.mock.calls[0][1];
    invalidate({});
    invalidate({ clientId: 'client-a', action: 'updated' });
    invalidate({ clientId: 'client-a', action: 'deleted' });
    expect(harness.oidcAdapterBridge.client.destroy).toHaveBeenCalledOnce();
    expect(harness.oidcAdapterBridge.client.destroy).toHaveBeenCalledWith(
      'client-a'
    );
  });

  it.each([
    [new Error('adapter unavailable'), 'adapter unavailable'],
    ['adapter offline', 'adapter offline'],
  ])(
    'reports asynchronous OIDC client invalidation failure %#',
    async (failure, message) => {
      harness.configManager.getConfig.mockReturnValue({
        oidc_storage: {
          oidc_adapter: {
            type: 'redis',
            redis: {
              host: 'redis.local',
              port: 6379,
              database: 0,
            },
          },
        },
      });
      harness.oidcAdapterBridge.client.destroy.mockRejectedValue(failure);
      await importEntrypoint();

      harness.pubsubService.subscribe.mock.calls[0][1]({
        clientId: 'client-b',
        action: 'deleted',
      });
      await vi.waitFor(() => {
        expect(harness.logger.warn).toHaveBeenCalledWith(
          'Failed to destroy OIDC client adapter entry',
          { clientId: 'client-b', error: message }
        );
      });
    }
  );

  it('ignores invalidation until the OIDC adapter is available', async () => {
    harness.configManager.getConfig.mockReturnValue({
      oidc_storage: {
        oidc_adapter: {
          type: 'redis',
          redis: { host: 'redis.local', port: 6379, database: 0 },
        },
      },
    });
    await importEntrypoint();
    harness.services.delete(harness.TYPES.OIDCAdapterBridge);

    expect(() =>
      harness.pubsubService.subscribe.mock.calls[0][1]({
        clientId: 'client-c',
        action: 'deleted',
      })
    ).not.toThrow();

    harness.services.set(
      harness.TYPES.OIDCAdapterBridge,
      harness.oidcAdapterBridge
    );
  });

  it('uses explicit Redis configuration even with a non-Redis OIDC adapter', async () => {
    harness.configManager.getBootstrapConfig.mockResolvedValue({
      ...bootstrapConfig,
      redis: { host: 'redis.local' },
    });
    harness.configManager.getConfig.mockReturnValue({
      oidc_storage: {
        oidc_adapter: {
          type: 'database',
          redis: {
            host: 'redis.local',
            port: 6379,
            database: 0,
            password: '',
          },
        },
      },
    });

    await importEntrypoint();

    expect(harness.pubsubService.connect).toHaveBeenCalledWith(
      'redis://redis.local:6379/0'
    );
    expect(harness.initRateLimitRedis).toHaveBeenCalledWith(
      expect.any(String),
      'parako',
      harness.logger
    );
  });

  it('skips Pub/Sub when Redis is not selected or explicitly configured', async () => {
    harness.configManager.getConfig.mockReturnValue({
      oidc_storage: {
        oidc_adapter: {
          type: 'database',
          redis: { host: 'redis.local', port: 6379, database: 0 },
        },
      },
    });

    await importEntrypoint();

    expect(harness.pubsubService.connect).not.toHaveBeenCalled();
    expect(harness.initRateLimitRedis).not.toHaveBeenCalled();
  });

  it('isolates Pub/Sub initialization failures from startup', async () => {
    const failure = new Error('redis unavailable');
    harness.configManager.getConfig.mockReturnValue({
      oidc_storage: {
        oidc_adapter: {
          type: 'redis',
          redis: { host: 'redis.local', port: 6379, database: 0 },
        },
      },
    });
    harness.pubsubService.connect.mockRejectedValue(failure);

    await importEntrypoint();

    expect(harness.logger.warn).toHaveBeenCalledWith(
      'Redis Pub/Sub init failed, operating in local-only mode',
      { error: failure }
    );
    expect(harness.application.initialize).toHaveBeenCalledOnce();
  });

  it('continues when the email server reports itself unavailable', async () => {
    harness.emailService.connectToEmailServer.mockResolvedValue(false);

    await importEntrypoint();

    expect(harness.logger.warn).toHaveBeenCalledWith(
      'Email server initialization failed, but continuing...'
    );
  });

  it('continues when the email connection rejects', async () => {
    const failure = new Error('smtp unavailable');
    harness.emailService.connectToEmailServer.mockRejectedValue(failure);

    await importEntrypoint();

    expect(harness.logger.warn).toHaveBeenCalledWith(
      'Email server initialization failed, but continuing...',
      { error: failure }
    );
  });

  it('fails closed when runtime configuration becomes inaccessible', async () => {
    const failure = new Error('configuration inaccessible');
    harness.configManager.getConfig
      .mockReturnValueOnce(runtimeConfig)
      .mockImplementationOnce(() => {
        throw failure;
      });

    await importUntilExit();

    expect(harness.logger.error).toHaveBeenCalledWith(
      'Config is NOT accessible',
      { error: failure }
    );
    expect(harness.database.disconnect).toHaveBeenCalledOnce();
  });

  it.each([
    [Object.assign(new Error('busy'), { code: 'EADDRINUSE' }), 'port_in_use'],
    [
      Object.assign(new Error('listen failed'), {
        code: 'EACCES',
        errno: -13,
        syscall: 'listen',
      }),
      'server_startup',
    ],
  ])('reports HTTP startup failure %#', async (failure, errorType) => {
    harness.serverBehavior.listenError = failure;

    await importUntilExit();

    expect(harness.logger.error).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({ error_type: errorType })
    );
    expect(harness.database.disconnect).toHaveBeenCalledOnce();
  });

  it('fails start if the database disconnects after initialization', async () => {
    harness.database.isConnected
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false);

    await importUntilExit();

    expect(harness.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Cannot start server: database not connected',
      }),
      expect.objectContaining({ databaseConnected: false })
    );
  });

  it('supports standalone servers without PM2 IPC or requestTimeout', async () => {
    harness.processMock.send = undefined;
    harness.serverBehavior.requestTimeoutSupported = false;
    harness.hardening.timeouts.tcpNoDelay = false;

    await importEntrypoint();

    const server = harness.servers.at(-1)!;
    expect(server.requestTimeout).toBeUndefined();
    expect(server.listeners.has('connection')).toBe(false);
    expect(harness.processMock.send).toBeUndefined();
  });

  it('enables TCP_NODELAY on accepted sockets', async () => {
    await importEntrypoint();
    const setNoDelay = vi.fn();

    harness.servers.at(-1)!.listeners.get('connection')![0]({ setNoDelay });

    expect(setNoDelay).toHaveBeenCalledWith(true);
  });

  it('performs graceful shutdown and drains keep-alive responses', async () => {
    harness.processMock.env = { pm_id: 'api-7' };
    await importEntrypoint();
    const server = harness.servers.at(-1)!;

    harness.processHandlers.get('message')!('ignored');
    harness.processHandlers.get('SIGTERM')!();
    await vi.waitFor(() => {
      expect(harness.processMock.exit).toHaveBeenCalledWith(0);
    });

    expect(harness.safeShutdownStep.mock.calls.map(([name]) => name)).toEqual([
      'activity-service',
      'redis-pubsub',
      'rate-limit-redis',
      'config-cleanup',
    ]);
    expect(harness.activityService.shutdown).toHaveBeenCalledOnce();
    expect(harness.pubsubService.disconnect).toHaveBeenCalledOnce();
    expect(harness.rateLimitRedisClient.quit).toHaveBeenCalledOnce();
    expect(harness.markShuttingDown).toHaveBeenCalledOnce();
    expect(harness.database.disconnect).toHaveBeenCalledOnce();
    expect(harness.configManager.cleanup).toHaveBeenCalledOnce();
    expect(harness.logger.shutdown).toHaveBeenCalledOnce();

    const setHeader = vi.fn();
    const onRequest = server.listeners.get('request')![0];
    onRequest({}, { headersSent: false, setHeader });
    onRequest({}, { headersSent: true, setHeader });
    expect(setHeader).toHaveBeenCalledOnce();
    expect(setHeader).toHaveBeenCalledWith('Connection', 'close');
  });

  it('handles PM2 shutdown messages and ignores duplicate signals', async () => {
    let releaseActivity!: () => void;
    harness.activityService.shutdown.mockImplementation(
      () => new Promise<void>(resolve => (releaseActivity = resolve))
    );
    await importEntrypoint();

    harness.processHandlers.get('message')!('shutdown');
    await vi.waitFor(() => expect(releaseActivity).toBeTypeOf('function'));
    harness.processHandlers.get('SIGINT')!();

    expect(harness.logger.info).toHaveBeenCalledWith(
      'SIGINT received - shutdown already in progress, ignoring'
    );
    releaseActivity();
    await vi.waitFor(() => {
      expect(harness.processMock.exit).toHaveBeenCalledWith(0);
    });
  });

  it('skips rate-limit cleanup when no Redis client exists', async () => {
    harness.getRateLimitRedisClient.mockReturnValue(null);
    await importEntrypoint();

    harness.processHandlers.get('SIGINT')!();
    await vi.waitFor(() => {
      expect(harness.processMock.exit).toHaveBeenCalledWith(0);
    });

    expect(harness.rateLimitRedisClient.quit).not.toHaveBeenCalled();
  });

  it('continues shutdown when database disconnect fails', async () => {
    const failure = new Error('database close failed');
    harness.database.disconnect.mockRejectedValue(failure);
    await importEntrypoint();

    harness.processHandlers.get('SIGTERM')!();
    await vi.waitFor(() => {
      expect(harness.processMock.exit).toHaveBeenCalledWith(0);
    });

    expect(harness.logger.error).toHaveBeenCalledWith(failure, {
      step: 'database_disconnect',
    });
  });

  it.each([
    [new Error('logger close failed'), 'logger close failed'],
    ['logger unavailable', 'logger unavailable'],
  ])(
    'falls back to stderr when logger shutdown fails %#',
    async (failure, message) => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      harness.logger.shutdown.mockRejectedValue(failure);
      await importEntrypoint();

      harness.processHandlers.get('SIGTERM')!();
      await vi.waitFor(() => {
        expect(harness.processMock.exit).toHaveBeenCalledWith(0);
      });

      expect(consoleError).toHaveBeenCalledWith(
        'Logger shutdown failed:',
        message
      );
      consoleError.mockRestore();
    }
  );

  it('fails shutdown when the HTTP server reports a close error', async () => {
    const failure = new Error('close failed');
    harness.serverBehavior.closeError = failure;
    await importEntrypoint();

    harness.processHandlers.get('SIGTERM')!();
    await vi.waitFor(() => {
      expect(harness.processMock.exit).toHaveBeenCalledWith(1);
    });

    expect(harness.logger.error).toHaveBeenCalledWith(failure, {
      step: 'server_close',
    });
    expect(harness.database.disconnect).not.toHaveBeenCalled();
  });

  it.each([
    [new Error('cleanup failed'), 'cleanup failed'],
    ['cleanup unavailable', 'cleanup unavailable'],
  ])('reports shutdown sequence failure %#', async (failure, _message) => {
    harness.safeShutdownStep.mockRejectedValueOnce(failure);
    await importEntrypoint();

    harness.processHandlers.get('SIGINT')!();
    await vi.waitFor(() => {
      expect(harness.processMock.exit).toHaveBeenCalledWith(1);
    });

    expect(harness.logger.error).toHaveBeenCalledWith(failure, {
      signal: 'SIGINT',
      instanceId: 'standalone',
    });
  });

  it.each([
    [new Error('handler failed'), 'handler failed'],
    ['handler unavailable', 'handler unavailable'],
  ])(
    'fails closed when the signal wrapper crashes %#',
    async (failure, message) => {
      await importEntrypoint();
      harness.logger.info.mockImplementationOnce(() => {
        throw failure;
      });

      harness.processHandlers.get('SIGINT')!();
      await vi.waitFor(() => {
        expect(harness.processMock.exit).toHaveBeenCalledWith(1);
      });

      expect(harness.logger.fatal).toHaveBeenCalledWith(
        'Shutdown handler crashed',
        { signal: 'SIGINT', err: message }
      );
    }
  );

  it('forces termination when graceful shutdown exceeds its deadline', async () => {
    let releaseActivity!: () => void;
    harness.activityService.shutdown.mockImplementation(
      () => new Promise<void>(resolve => (releaseActivity = resolve))
    );
    await importEntrypoint();
    vi.useFakeTimers();

    harness.processHandlers.get('SIGTERM')!();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(harness.logger.fatal).toHaveBeenCalledWith(
      'Shutdown timeout exceeded - forcing exit',
      { timeout: 'shutdown' }
    );
    expect(harness.processMock.exit).toHaveBeenCalledWith(1);
    releaseActivity();
    await vi.runAllTimersAsync();
    vi.useRealTimers();
  });

  it('reports a server close timeout', async () => {
    harness.serverBehavior.closeHangs = true;
    await importEntrypoint();
    vi.useFakeTimers();

    harness.processHandlers.get('SIGTERM')!();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(harness.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Server close timeout' }),
      { timeout: 'server_close' }
    );
    expect(harness.processMock.exit).toHaveBeenCalledWith(1);
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('terminates immediately on an uncaught exception', async () => {
    await importEntrypoint();
    const failure = new Error('unexpected crash');

    harness.processHandlers.get('uncaughtException')!(failure);

    expect(harness.logger.fatal).toHaveBeenCalledWith(
      'Uncaught exception - process will exit',
      {
        error_type: 'uncaught_exception',
        error: failure.message,
        stack: failure.stack,
      }
    );
    expect(harness.processMock.exit).toHaveBeenCalledWith(1);
  });

  it.each([
    [new Error('rejected operation'), 'rejected operation'],
    ['rejection value', 'rejection value'],
  ])(
    'disconnects before terminating on unhandled rejection %#',
    async (reason, message) => {
      await importEntrypoint();
      const promise = Promise.resolve();

      await harness.processHandlers.get('unhandledRejection')!(reason, promise);

      expect(harness.logger.fatal).toHaveBeenCalledWith(
        'Unhandled promise rejection - process will exit',
        {
          error_type: 'unhandled_rejection',
          reason: message,
          promise: promise.toString(),
        }
      );
      expect(harness.database.disconnect).toHaveBeenCalledOnce();
      expect(harness.processMock.exit).toHaveBeenCalledWith(1);
    }
  );

  it.each([
    [new Error('disconnect failed'), 'disconnect failed'],
    ['disconnect unavailable', 'disconnect unavailable'],
  ])(
    'falls back to stderr when rejection cleanup fails %#',
    async (failure, message) => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      harness.database.disconnect.mockRejectedValue(failure);
      await importEntrypoint();

      await harness.processHandlers.get('unhandledRejection')!(
        'failure',
        Promise.resolve()
      );

      expect(consoleError).toHaveBeenCalledWith(
        'Emergency database disconnect failed:',
        message
      );
      expect(harness.processMock.exit).toHaveBeenCalledWith(1);
      consoleError.mockRestore();
    }
  );

  it.each([
    [new Error('disconnect failed'), 'disconnect failed'],
    ['disconnect unavailable', 'disconnect unavailable'],
  ])(
    'reports bootstrap emergency disconnect failure %#',
    async (disconnectFailure, message) => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      harness.database.connect.mockRejectedValue(new Error('connect failed'));
      harness.database.disconnect.mockRejectedValue(disconnectFailure);

      await importUntilExit();

      expect(consoleError).toHaveBeenCalledWith(
        'Bootstrap emergency database disconnect failed:',
        message
      );
      consoleError.mockRestore();
    }
  );
});
