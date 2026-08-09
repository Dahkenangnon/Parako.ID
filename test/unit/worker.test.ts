import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const processHandlers = new Map<string, (...args: any[]) => any>();
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    shutdown: vi.fn(),
  };
  const configManager = {
    getBootstrapConfig: vi.fn(),
    load: vi.fn(),
    getConfig: vi.fn(),
    cleanup: vi.fn(),
  };
  const database = {
    initializeWithBootstrapConfig: vi.fn(),
    connect: vi.fn(),
    isConnected: vi.fn(),
    disconnect: vi.fn(),
  };
  const keyStore = { initialize: vi.fn() };
  const activityService = { info: vi.fn() };
  const oidcAdapterBridge = { initialize: vi.fn() };
  const dataTransferService = { marker: 'data-transfer' };
  const userService = { marker: 'users' };
  const passwordUtils = { marker: 'passwords' };
  const notificationService = { marker: 'notifications' };
  const backgroundQueue = { add: vi.fn() };
  const backgroundWorker = { marker: 'worker' };
  const queueManager = {
    registerQueue: vi.fn(),
    getStats: vi.fn(),
    getQueueNames: vi.fn(),
    closeAll: vi.fn(),
  };
  const workerManager = {
    registerWorker: vi.fn(),
    getWorkerNames: vi.fn(),
    closeAll: vi.fn(),
  };
  const redisPublisher = {
    connect: vi.fn(),
    publish: vi.fn(),
    quit: vi.fn(),
  };
  const processMock = {
    pid: 1234,
    version: 'v24.test',
    env: {} as Record<string, string | undefined>,
    send: vi.fn() as any,
    exit: vi.fn() as any,
    on: vi.fn((event: string, listener: (...args: any[]) => any) => {
      processHandlers.set(event, listener);
    }),
  };
  const TYPES = {
    ConfigManager: 'ConfigManager',
    Logger: 'Logger',
    DatabaseConnectionManager: 'DatabaseConnectionManager',
    KeyStore: 'KeyStore',
    ActivityService: 'ActivityService',
    DataTransferService: 'DataTransferService',
    UserService: 'UserService',
    PasswordUtils: 'PasswordUtils',
    OIDCAdapterBridge: 'OIDCAdapterBridge',
    NotificationService: 'NotificationService',
  };
  const services = new Map<any, any>([
    [TYPES.ConfigManager, configManager],
    [TYPES.Logger, logger],
    [TYPES.DatabaseConnectionManager, database],
    [TYPES.KeyStore, keyStore],
    [TYPES.ActivityService, activityService],
    [TYPES.DataTransferService, dataTransferService],
    [TYPES.UserService, userService],
    [TYPES.PasswordUtils, passwordUtils],
    [TYPES.OIDCAdapterBridge, oidcAdapterBridge],
    [TYPES.NotificationService, notificationService],
  ]);

  return {
    handlers,
    processHandlers,
    logger,
    configManager,
    database,
    keyStore,
    activityService,
    oidcAdapterBridge,
    dataTransferService,
    userService,
    passwordUtils,
    notificationService,
    backgroundQueue,
    backgroundWorker,
    queueManager,
    workerManager,
    redisPublisher,
    processMock,
    TYPES,
    services,
    container: { get: vi.fn((token: any) => services.get(token)) },
    assertContainerValid: vi.fn(),
    createBackgroundTaskQueue: vi.fn(),
    createBackgroundTaskWorker: vi.fn(),
    registerTaskHandler: vi.fn(
      (name: string, handler: (...args: any[]) => any) => {
        handlers.set(name, handler);
      }
    ),
    jwksRotationHandler: vi.fn(),
    createDataImportHandler: vi.fn(),
    createPasswordBreachCheckHandler: vi.fn(),
    registerJwksRotationSchedule: vi.fn(),
    checkRedisAvailability: vi.fn(),
    buildRedisKeyForTenant: vi.fn(),
    tenantContext: {
      getStore: vi.fn(),
      getTenantId: vi.fn(),
    },
    Redis: vi.fn(function RedisMock() {
      return redisPublisher;
    }),
    QueueManager: vi.fn(function QueueManagerMock() {
      return queueManager;
    }),
    WorkerManager: vi.fn(function WorkerManagerMock() {
      return workerManager;
    }),
    safeShutdownStep: vi.fn(async (_name: string, step: () => Promise<void>) =>
      step()
    ),
  };
});

vi.mock('node:process', () => ({ default: harness.processMock }));
vi.mock('../../src/di/types.js', () => ({ TYPES: harness.TYPES }));
vi.mock('../../src/di/index.js', () => ({
  containerReady: Promise.resolve(harness.container),
  assertContainerValid: harness.assertContainerValid,
}));
vi.mock('../../src/jobs/processing/queue-manager.js', () => ({
  QueueManager: harness.QueueManager,
}));
vi.mock('../../src/jobs/processing/worker-manager.js', () => ({
  WorkerManager: harness.WorkerManager,
}));
vi.mock('../../src/jobs/domains/background-tasks/queue.js', () => ({
  createBackgroundTaskQueue: harness.createBackgroundTaskQueue,
}));
vi.mock('../../src/jobs/domains/background-tasks/worker.js', () => ({
  createBackgroundTaskWorker: harness.createBackgroundTaskWorker,
  registerTaskHandler: harness.registerTaskHandler,
}));
vi.mock(
  '../../src/jobs/domains/background-tasks/handlers/jwks-rotation.handler.js',
  () => ({ jwksRotationHandler: harness.jwksRotationHandler })
);
vi.mock(
  '../../src/jobs/domains/background-tasks/handlers/data-import.handler.js',
  () => ({ createDataImportHandler: harness.createDataImportHandler })
);
vi.mock(
  '../../src/jobs/domains/background-tasks/handlers/password-breach-check.handler.js',
  () => ({
    createPasswordBreachCheckHandler: harness.createPasswordBreachCheckHandler,
  })
);
vi.mock('../../src/jobs/schedules/jwks-rotation.schedule.js', () => ({
  registerJwksRotationSchedule: harness.registerJwksRotationSchedule,
}));
vi.mock('../../src/jobs/redis.js', () => ({
  checkRedisAvailability: harness.checkRedisAvailability,
}));
vi.mock('ioredis', () => ({ Redis: harness.Redis }));
vi.mock('../../src/multi-tenancy/redis-key.js', () => ({
  buildRedisKeyForTenant: harness.buildRedisKeyForTenant,
}));
vi.mock('../../src/multi-tenancy/tenant-context.js', () => ({
  tenantContext: harness.tenantContext,
  DEFAULT_TENANT_ID: 'default',
}));
vi.mock('../../src/utils/shutdown.js', () => ({
  SHUTDOWN_TIMEOUT_MS: 10_000,
  safeShutdownStep: harness.safeShutdownStep,
}));

const bootstrapConfig = {
  redis: {
    host: 'redis.local',
    port: 6380,
    password: '',
    database: undefined,
  },
};
const runtimeConfig = {
  deployment: { redis_prefix: 'test-prefix' },
  security: {
    key_store: { promotion_delay_ms: 500, rotation_interval_days: 30 },
  },
};

async function importWorker(): Promise<void> {
  await import('../../src/worker.js');
  await vi.waitFor(() => {
    expect(harness.logger.info).toHaveBeenCalledWith(
      'Worker process ready',
      expect.any(Object)
    );
  });
}

async function importWorkerUntilExit(code = 1): Promise<void> {
  await import('../../src/worker.js');
  await vi.waitFor(() => {
    expect(harness.processMock.exit).toHaveBeenCalledWith(code);
  });
}

describe('worker process entrypoint', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    harness.handlers.clear();
    harness.processHandlers.clear();
    harness.processMock.env = {};
    harness.processMock.send = vi.fn();
    harness.configManager.getBootstrapConfig.mockResolvedValue(bootstrapConfig);
    harness.configManager.load.mockResolvedValue(undefined);
    harness.configManager.getConfig.mockReturnValue(runtimeConfig);
    harness.database.connect.mockResolvedValue(undefined);
    harness.database.isConnected.mockReturnValue(true);
    harness.database.disconnect.mockResolvedValue(undefined);
    harness.keyStore.initialize.mockResolvedValue(undefined);
    harness.activityService.info.mockResolvedValue(undefined);
    harness.oidcAdapterBridge.initialize.mockResolvedValue(undefined);
    harness.redisPublisher.connect.mockResolvedValue(undefined);
    harness.redisPublisher.publish.mockResolvedValue(1);
    harness.redisPublisher.quit.mockResolvedValue('OK');
    harness.backgroundQueue.add.mockResolvedValue({ id: 'promotion-job' });
    harness.queueManager.getStats.mockResolvedValue({
      'background-tasks': { waiting: 0 },
    });
    harness.queueManager.getQueueNames.mockReturnValue(['background-tasks']);
    harness.workerManager.getWorkerNames.mockReturnValue(['background-tasks']);
    harness.queueManager.closeAll.mockResolvedValue(undefined);
    harness.workerManager.closeAll.mockResolvedValue(undefined);
    harness.logger.shutdown.mockResolvedValue(undefined);
    harness.createBackgroundTaskQueue.mockResolvedValue(
      harness.backgroundQueue
    );
    harness.createBackgroundTaskWorker.mockReturnValue(
      harness.backgroundWorker
    );
    harness.createDataImportHandler.mockReturnValue(vi.fn());
    harness.createPasswordBreachCheckHandler.mockReturnValue(vi.fn());
    harness.registerJwksRotationSchedule.mockResolvedValue(undefined);
    harness.checkRedisAvailability.mockResolvedValue({ available: true });
    harness.buildRedisKeyForTenant.mockImplementation((...parts: string[]) =>
      parts.join(':')
    );
    harness.tenantContext.getStore.mockReturnValue(undefined);
    harness.tenantContext.getTenantId.mockReturnValue('tenant-a');
    harness.safeShutdownStep.mockImplementation(
      async (_name: string, step: () => Promise<void>) => step()
    );
  });

  it('boots dependencies, registers all handlers and schedule, and signals readiness', async () => {
    await importWorker();

    expect(harness.assertContainerValid).toHaveBeenCalledWith(
      harness.container
    );
    expect(harness.database.initializeWithBootstrapConfig).toHaveBeenCalledWith(
      bootstrapConfig
    );
    expect(harness.keyStore.initialize).toHaveBeenCalledOnce();
    expect(harness.oidcAdapterBridge.initialize).toHaveBeenCalledOnce();
    expect(harness.queueManager.registerQueue).toHaveBeenCalledWith(
      'background-tasks',
      harness.backgroundQueue
    );
    expect(harness.workerManager.registerWorker).toHaveBeenCalledWith(
      'background-tasks',
      harness.backgroundWorker
    );
    expect([...harness.handlers.keys()]).toEqual([
      'jwks-rotation',
      'data-import',
      'password-breach-check',
    ]);
    expect(harness.registerJwksRotationSchedule).toHaveBeenCalledWith(
      harness.backgroundQueue,
      { rotationIntervalDays: 30 }
    );
    expect(harness.processMock.send).toHaveBeenCalledWith('ready');
    expect(harness.processHandlers.has('SIGTERM')).toBe(true);
    expect(harness.processHandlers.has('SIGINT')).toBe(true);
    expect(harness.processHandlers.has('message')).toBe(true);
  });

  it('wires JWKS event publication, audit, and delayed promotion through the registered handler', async () => {
    await importWorker();
    const registered = harness.handlers.get('jwks-rotation')!;
    const reportProgress = vi.fn();

    await registered({ name: 'jwks-rotation' }, reportProgress);
    const call = harness.jwksRotationHandler.mock.calls[0];
    expect(call[6]).toMatchObject({ promotionDelayMs: 500 });

    await call[4]();
    harness.tenantContext.getStore.mockReturnValue({ tenantId: 'tenant-a' });
    await call[5]();
    await call[6].scheduleDelayedPromotion(750);

    expect(harness.redisPublisher.publish).toHaveBeenNthCalledWith(
      1,
      'test-prefix:default:jwks:rotated',
      expect.stringContaining('"tenantId":"default"')
    );
    expect(harness.redisPublisher.publish).toHaveBeenNthCalledWith(
      2,
      'test-prefix:tenant-a:jwks:promoted',
      expect.stringContaining('"tenantId":"tenant-a"')
    );
    expect(harness.activityService.info).toHaveBeenCalledTimes(2);
    expect(harness.backgroundQueue.add).toHaveBeenCalledWith(
      'jwks-rotation',
      { type: 'process', name: 'jwks-rotation', phase: 'promote' },
      { delay: 750 }
    );
  });

  it('preserves the originating tenant in delayed JWKS promotion jobs', async () => {
    await importWorker();
    const registered = harness.handlers.get('jwks-rotation')!;

    await registered(
      {
        type: 'process',
        name: 'jwks-rotation',
        tenantId: 'tenant-acme',
      },
      vi.fn()
    );
    const options = harness.jwksRotationHandler.mock.calls[0][6];
    await options.scheduleDelayedPromotion(750);

    expect(harness.backgroundQueue.add).toHaveBeenCalledWith(
      'jwks-rotation',
      {
        type: 'process',
        name: 'jwks-rotation',
        phase: 'promote',
        tenantId: 'tenant-acme',
      },
      { delay: 750 }
    );
  });

  it('performs graceful shutdown in order when PM2 requests it', async () => {
    harness.processMock.env = { pm_id: 'worker-7' };
    await importWorker();

    harness.processHandlers.get('message')!('ignored');
    harness.processHandlers.get('message')!('shutdown');
    await vi.waitFor(() =>
      expect(harness.processMock.exit).toHaveBeenCalledWith(0)
    );

    expect(harness.safeShutdownStep.mock.calls.map(([name]) => name)).toEqual([
      'worker-manager',
      'queue-manager',
      'redis-publisher',
      'database-disconnect',
      'config-cleanup',
    ]);
    expect(harness.redisPublisher.quit).toHaveBeenCalledOnce();
    expect(harness.logger.shutdown).toHaveBeenCalledOnce();
  });

  it('continues with bootstrap configuration when the full config load fails', async () => {
    const failure = new Error('settings unavailable');
    harness.configManager.load.mockRejectedValue(failure);

    await importWorker();

    expect(harness.logger.warn).toHaveBeenCalledWith(
      'Failed to load full configuration, continuing with bootstrap config',
      { error: failure, component: 'worker' }
    );
  });

  it('uses safe runtime defaults and skips PM2 readiness when IPC is absent', async () => {
    harness.configManager.getConfig.mockReturnValue({});
    harness.processMock.send = undefined;

    await importWorker();

    expect(harness.Redis).toHaveBeenCalledWith(
      expect.objectContaining({ password: undefined, db: 0 })
    );
    expect(harness.registerJwksRotationSchedule).toHaveBeenCalledWith(
      harness.backgroundQueue,
      { rotationIntervalDays: 90 }
    );
    const jwksCall = harness.handlers.get('jwks-rotation')!;
    await jwksCall({}, vi.fn());
    expect(harness.jwksRotationHandler.mock.calls[0][6]).toMatchObject({
      promotionDelayMs: 0,
    });
  });

  it('fails bootstrap when the database did not connect', async () => {
    harness.database.isConnected.mockReturnValue(false);

    await importWorkerUntilExit();

    expect(harness.logger.error).toHaveBeenCalledWith(
      'Worker bootstrap failed: Worker cannot start: database connection failed',
      expect.objectContaining({ component: 'worker' })
    );
    expect(harness.database.disconnect).toHaveBeenCalledOnce();
  });

  it('reports unavailable Redis before requesting process termination', async () => {
    harness.checkRedisAvailability.mockResolvedValue({
      available: false,
      reason: 'connection refused',
    });

    await importWorker();

    expect(harness.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Worker cannot start: connection refused'),
      { component: 'worker' }
    );
    expect(harness.processMock.exit).toHaveBeenCalledWith(1);
  });

  it.each([
    [new Error('publish failed'), 'publish failed'],
    ['publisher closed', 'publisher closed'],
  ])(
    'logs JWKS publication failure %# while preserving the audit trail',
    async (failure, message) => {
      harness.redisPublisher.publish.mockRejectedValue(failure);
      await importWorker();
      await harness.handlers.get('jwks-rotation')!({}, vi.fn());
      const publishRotated = harness.jwksRotationHandler.mock.calls[0][4];

      await expect(publishRotated()).resolves.toBeUndefined();

      expect(harness.logger.warn).toHaveBeenCalledWith(
        'Failed to publish JWKS rotated event',
        { component: 'worker', error: message }
      );
      expect(harness.activityService.info).toHaveBeenCalledOnce();
    }
  );

  it.each([
    [new Error('audit failed'), 'audit failed'],
    ['audit offline', 'audit offline'],
  ])(
    'falls back to stderr when the JWKS audit write fails %#',
    async (failure, message) => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      harness.activityService.info.mockRejectedValue(failure);
      await importWorker();
      await harness.handlers.get('jwks-rotation')!({}, vi.fn());
      const publishPromoted = harness.jwksRotationHandler.mock.calls[0][5];

      await expect(publishPromoted()).resolves.toBeUndefined();

      expect(consoleError).toHaveBeenCalledWith(
        '[AUDIT FALLBACK] jwks_promoted_by_scheduler — failed to write audit trail:',
        message
      );
      consoleError.mockRestore();
    }
  );

  it('ignores duplicate shutdown signals while shutdown is in progress', async () => {
    let releaseClose!: () => void;
    harness.workerManager.closeAll.mockImplementation(
      () => new Promise<void>(resolve => (releaseClose = resolve))
    );
    await importWorker();

    harness.processHandlers.get('SIGTERM')!();
    harness.processHandlers.get('SIGINT')!();

    expect(harness.logger.warn).toHaveBeenCalledWith(
      'Duplicate SIGINT received — shutdown already in progress',
      { component: 'worker' }
    );
    releaseClose();
    await vi.waitFor(() =>
      expect(harness.processMock.exit).toHaveBeenCalledWith(0)
    );
  });

  it('shuts down safely when bootstrap failed before managers were created', async () => {
    harness.database.isConnected.mockReturnValue(false);
    await importWorkerUntilExit();
    vi.clearAllMocks();
    harness.database.disconnect.mockResolvedValue(undefined);
    harness.logger.shutdown.mockResolvedValue(undefined);

    harness.processHandlers.get('SIGTERM')!();
    await vi.waitFor(() =>
      expect(harness.processMock.exit).toHaveBeenCalledWith(0)
    );

    expect(harness.safeShutdownStep.mock.calls.map(([name]) => name)).toEqual([
      'database-disconnect',
      'config-cleanup',
    ]);
  });

  it.each([
    [new Error('logger close failed'), 'logger close failed'],
    ['logger unavailable', 'logger unavailable'],
  ])(
    'falls back to stderr when logger shutdown fails %#',
    async (failure, message) => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      harness.logger.shutdown.mockRejectedValue(failure);
      await importWorker();

      harness.processHandlers.get('SIGTERM')!();
      await vi.waitFor(() =>
        expect(harness.processMock.exit).toHaveBeenCalledWith(0)
      );

      expect(consoleError).toHaveBeenCalledWith(
        'Worker logger shutdown failed:',
        message
      );
      consoleError.mockRestore();
    }
  );

  it.each([
    [new Error('shutdown failed'), 'shutdown failed'],
    ['shutdown offline', 'shutdown offline'],
  ])(
    'reports an unexpected shutdown-sequence failure %#',
    async (failure, message) => {
      harness.safeShutdownStep.mockRejectedValue(failure);
      await importWorker();

      harness.processHandlers.get('SIGTERM')!();
      await vi.waitFor(() =>
        expect(harness.processMock.exit).toHaveBeenCalledWith(1)
      );

      expect(harness.logger.error).toHaveBeenCalledWith(
        `Worker shutdown error: ${message}`,
        { component: 'worker' }
      );
    }
  );

  it.each([
    [new Error('signal handler failed'), 'signal handler failed'],
    ['signal handler offline', 'signal handler offline'],
  ])(
    'fails closed when the shutdown signal wrapper crashes %#',
    async (failure, message) => {
      await importWorker();
      harness.logger.info.mockImplementationOnce(() => {
        throw failure;
      });

      harness.processHandlers.get('SIGINT')!();
      await vi.waitFor(() =>
        expect(harness.processMock.exit).toHaveBeenCalledWith(1)
      );

      expect(harness.logger.fatal).toHaveBeenCalledWith(
        'Worker shutdown handler crashed',
        {
          component: 'worker',
          signal: 'SIGINT',
          err: message,
        }
      );
    }
  );

  it('forces exit if graceful shutdown exceeds its deadline', async () => {
    vi.useFakeTimers();
    harness.workerManager.closeAll.mockImplementation(
      () => new Promise(() => {})
    );
    await importWorker();

    harness.processHandlers.get('SIGTERM')!();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(harness.logger.fatal).toHaveBeenCalledWith(
      'Worker shutdown timeout exceeded — forcing exit',
      { component: 'worker' }
    );
    expect(harness.processMock.exit).toHaveBeenCalledWith(1);
    vi.useRealTimers();
  });

  it('logs uncaught exceptions and exits synchronously', async () => {
    await importWorker();
    const failure = new Error('unexpected crash');

    harness.processHandlers.get('uncaughtException')!(failure);

    expect(harness.logger.fatal).toHaveBeenCalledWith(
      'Worker uncaught exception: unexpected crash',
      { component: 'worker', stack: failure.stack }
    );
    expect(harness.processMock.exit).toHaveBeenCalledWith(1);
  });

  it.each([
    [new Error('promise failed'), 'promise failed'],
    ['promise offline', 'promise offline'],
  ])(
    'handles unhandled rejection reasons and disconnects the database %#',
    async (reason, message) => {
      await importWorker();

      await harness.processHandlers.get('unhandledRejection')!(reason);

      expect(harness.logger.fatal).toHaveBeenCalledWith(
        `Worker unhandled rejection: ${message}`,
        { component: 'worker' }
      );
      expect(harness.database.disconnect).toHaveBeenCalledOnce();
      expect(harness.processMock.exit).toHaveBeenCalledWith(1);
    }
  );

  it.each([
    [new Error('disconnect failed'), 'disconnect failed'],
    ['database offline', 'database offline'],
  ])(
    'reports emergency disconnect failures after unhandled rejection %#',
    async (failure, message) => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      harness.database.disconnect.mockRejectedValue(failure);
      await importWorker();

      await harness.processHandlers.get('unhandledRejection')!('rejected');

      expect(consoleError).toHaveBeenCalledWith(
        'Emergency worker database disconnect failed:',
        message
      );
      consoleError.mockRestore();
    }
  );

  it.each([
    [
      new Error('bootstrap failed'),
      new Error('disconnect failed'),
      'bootstrap failed',
      'disconnect failed',
    ],
    [
      'bootstrap offline',
      'database offline',
      'bootstrap offline',
      'database offline',
    ],
  ])(
    'reports bootstrap and emergency disconnect failures %#',
    async (
      bootstrapFailure,
      disconnectFailure,
      bootstrapMessage,
      disconnectMessage
    ) => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      harness.configManager.getBootstrapConfig.mockRejectedValue(
        bootstrapFailure
      );
      harness.database.disconnect.mockRejectedValue(disconnectFailure);

      await importWorkerUntilExit();

      expect(harness.logger.error).toHaveBeenCalledWith(
        `Worker bootstrap failed: ${bootstrapMessage}`,
        {
          component: 'worker',
          stack:
            bootstrapFailure instanceof Error
              ? bootstrapFailure.stack
              : undefined,
        }
      );
      expect(consoleError).toHaveBeenCalledWith(
        'Worker bootstrap emergency database disconnect failed:',
        disconnectMessage
      );
      consoleError.mockRestore();
    }
  );
});
