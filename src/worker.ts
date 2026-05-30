import 'reflect-metadata';
import process from 'node:process';
import { TYPES } from './di/types.js';
import { container, assertContainerValid } from './di/index.js';
import type { IConfigManager } from './di/interfaces/config-manager.interface.js';
import type { ILogger } from './di/interfaces/logger.interface.js';
import type { IDatabaseConnectionManager } from './di/interfaces/database-connection-manager.interface.js';
import type { IKeyStore } from './di/interfaces/key-store.interface.js';
import type { IActivityService } from './di/interfaces/activity-service.interface.js';
import { QueueManager } from './jobs/processing/queue-manager.js';
import { WorkerManager } from './jobs/processing/worker-manager.js';
import { createBackgroundTaskQueue } from './jobs/domains/background-tasks/queue.js';
import {
  createBackgroundTaskWorker,
  registerTaskHandler,
} from './jobs/domains/background-tasks/worker.js';
import { jwksRotationHandler } from './jobs/domains/background-tasks/handlers/jwks-rotation.handler.js';
import { createDataImportHandler } from './jobs/domains/background-tasks/handlers/data-import.handler.js';
import { createPasswordBreachCheckHandler } from './jobs/domains/background-tasks/handlers/password-breach-check.handler.js';
import type { IDataTransferService } from './di/interfaces/data-transfer-service.interface.js';
import type { IUserService } from './di/interfaces/user-service.interface.js';
import type { IPasswordUtils } from './di/interfaces/password-utils.interface.js';
import type { IOIDCAdapterBridge } from './di/interfaces/oidc-adapter-bridge.interface.js';
import type { INotificationService } from './di/interfaces/notification-service.interface.js';
import { registerJwksRotationSchedule } from './jobs/schedules/jwks-rotation.schedule.js';
import {
  checkRedisAvailability,
  type QueueRedisOptions,
} from './jobs/redis.js';
import { Redis } from 'ioredis';
import { buildRedisKeyForTenant } from './multi-tenancy/redis-key.js';
import {
  tenantContext,
  DEFAULT_TENANT_ID,
} from './multi-tenancy/tenant-context.js';

// Validate DI container at startup (fail fast if bindings are missing)
assertContainerValid(container);

const configManager = container.get<IConfigManager>(TYPES.ConfigManager);
const logger = container.get<ILogger>(TYPES.Logger);
const databaseConnectionManager = container.get<IDatabaseConnectionManager>(
  TYPES.DatabaseConnectionManager
);

let queueManager: QueueManager | null = null;
let workerManager: WorkerManager | null = null;
let redisPublisher: Redis | null = null;
let isShuttingDown = false;

async function bootstrap(): Promise<void> {
  logger.info('Parako.ID worker process starting', {
    component: 'worker',
    pid: process.pid,
    nodeVersion: process.version,
  });

  // ── 1. Load configuration ──────────────────────────────────────────────
  const bootstrapConfig = await configManager.getBootstrapConfig();

  databaseConnectionManager.initializeWithBootstrapConfig(bootstrapConfig);
  await databaseConnectionManager.connect();

  if (!databaseConnectionManager.isConnected()) {
    throw new Error('Worker cannot start: database connection failed');
  }

  try {
    await configManager.load();
  } catch (error) {
    logger.warn(
      'Failed to load full configuration, continuing with bootstrap config',
      { error, component: 'worker' }
    );
  }

  const config = configManager.getConfig();

  // ── Pre-flight: verify Redis is configured AND reachable ──────────────
  // BullMQ requires Redis. If Redis is not available, the worker cannot
  // function — exit early with a clear message instead of crashing later.
  const redisCheck = await checkRedisAvailability(bootstrapConfig.redis);
  if (redisCheck.available === false) {
    logger.error(
      `Worker cannot start: ${redisCheck.reason}. ` +
        'Background jobs require Redis. Set REDIS_HOST in .env or disable the worker process.',
      { component: 'worker' }
    );
    process.exit(1);
  }

  const redisConfig = bootstrapConfig.redis!;
  const redisOpts: QueueRedisOptions = {
    host: redisConfig.host,
    port: redisConfig.port,
    password: redisConfig.password,
    database: redisConfig.database,
  };

  // ── 2. Initialize key store and activity service ──────────────────────
  const keyStore = container.get<IKeyStore>(TYPES.KeyStore);
  await keyStore.initialize();

  const activityService = container.get<IActivityService>(
    TYPES.ActivityService
  );

  // ── 3. Create Redis publisher for cross-process notifications ─────────
  const redisPrefix = config.deployment?.redis_prefix || 'parako';
  redisPublisher = new Redis({
    host: redisConfig.host,
    port: redisConfig.port,
    password: redisConfig.password || undefined,
    db: redisConfig.database ?? 0,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });
  await redisPublisher.connect();

  // ── 4. Create queue and worker managers ────────────────────────────────
  queueManager = new QueueManager(logger);
  workerManager = new WorkerManager(logger);

  // ── 5. Create queue and worker ─────────────────────────────────────────
  // Redis reachability already verified above — queue will never be null here.
  const backgroundQueue = (await createBackgroundTaskQueue(redisOpts))!;
  const backgroundWorker = createBackgroundTaskWorker(redisOpts);

  queueManager.registerQueue('background-tasks', backgroundQueue);
  workerManager.registerWorker('background-tasks', backgroundWorker);

  // ── 6. Register task handlers ──────────────────────────────────────────
  const publishJwksEvent = async (phase: 'rotated' | 'promoted') => {
    try {
      // Unified channel format: {prefix}:{tenantId}:jwks:{phase}
      // Worker JWKS rotation runs within tenantContext.run() for the job's
      // tenant, so getTenantId() returns the correct tenant. For backward
      // compat with single-tenant jobs that have no tenantId, default to
      // DEFAULT_TENANT_ID.
      const tenantId = tenantContext.getStore()
        ? tenantContext.getTenantId()
        : DEFAULT_TENANT_ID;
      const channel = buildRedisKeyForTenant(
        redisPrefix,
        tenantId,
        'jwks',
        phase
      );
      await redisPublisher!.publish(
        channel,
        JSON.stringify({ timestamp: Date.now(), tenantId })
      );
      logger.info(`Published JWKS ${phase} event to web process`, {
        component: 'worker',
        tenantId,
      });
    } catch (err) {
      logger.warn(`Failed to publish JWKS ${phase} event`, {
        component: 'worker',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Audit trail for background JWKS operations — awaited with fallback
    // to ensure critical security events are never silently lost.
    try {
      await activityService.info(
        `jwks_${phase}_by_scheduler`,
        `JWKS keys ${phase} by background scheduler`,
        null,
        {
          actor: { actor_type: 'system' },
          target: { target_type: 'system', entity_name: 'jwks-key-store' },
          metadata: { component: 'worker', pid: process.pid },
        }
      );
    } catch (auditErr) {
      // Fallback: log to stderr so the event is captured in PM2/systemd logs
      console.error(
        `[AUDIT FALLBACK] jwks_${phase}_by_scheduler — failed to write audit trail:`,
        auditErr instanceof Error ? auditErr.message : String(auditErr)
      );
    }
  };

  const promotionDelayMs = config.security?.key_store?.promotion_delay_ms ?? 0;

  registerTaskHandler('jwks-rotation', (data, reportProgress) =>
    jwksRotationHandler(
      data,
      reportProgress,
      keyStore,
      logger,
      () => publishJwksEvent('rotated'),
      () => publishJwksEvent('promoted'),
      {
        promotionDelayMs,
        scheduleDelayedPromotion: async (delayMs: number) => {
          await backgroundQueue.add(
            'jwks-rotation',
            {
              type: 'process',
              name: 'jwks-rotation',
              phase: 'promote',
            },
            { delay: delayMs }
          );
          logger.info('Scheduled delayed JWKS promotion job', {
            component: 'worker',
            delayMs,
          });
        },
      }
    )
  );

  const dataTransferService = container.get<IDataTransferService>(
    TYPES.DataTransferService
  );
  const userService = container.get<IUserService>(TYPES.UserService);
  const passwordUtils = container.get<IPasswordUtils>(TYPES.PasswordUtils);
  const oidcAdapterBridge = container.get<IOIDCAdapterBridge>(
    TYPES.OIDCAdapterBridge
  );
  await oidcAdapterBridge.initialize();

  registerTaskHandler(
    'data-import',
    createDataImportHandler(
      dataTransferService,
      {
        userService,
        activityService,
        oidcAdapterBridge,
        passwordUtils,
        logger,
      },
      logger
    )
  );

  // Password breach check handler
  const notificationService = container.get<INotificationService>(
    TYPES.NotificationService
  );
  registerTaskHandler(
    'password-breach-check',
    createPasswordBreachCheckHandler(
      notificationService,
      activityService,
      logger
    )
  );

  logger.info('Task handlers registered', {
    component: 'worker',
    handlers: ['jwks-rotation', 'data-import', 'password-breach-check'],
  });

  // ── 7. Register scheduled jobs (config-driven) ─────────────────────────
  const rotationIntervalDays =
    config.security?.key_store?.rotation_interval_days ?? 90;

  await registerJwksRotationSchedule(backgroundQueue, {
    rotationIntervalDays,
  });

  logger.info('JWKS rotation schedule registered', {
    component: 'worker',
    rotationIntervalDays,
  });

  // ── 8. Log startup summary ─────────────────────────────────────────────
  const stats = await queueManager.getStats();
  logger.info('Worker process ready', {
    component: 'worker',
    queues: queueManager.getQueueNames(),
    workers: workerManager.getWorkerNames(),
    stats,
    instanceId: process.env.pm_id ?? 'standalone',
  });

  // Signal PM2 readiness
  if (typeof process.send === 'function') {
    process.send('ready');
  }
}

// Graceful shutdown

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    logger.warn(`Duplicate ${signal} received — shutdown already in progress`, {
      component: 'worker',
    });
    return;
  }
  isShuttingDown = true;

  logger.info(`${signal} received — shutting down worker`, {
    component: 'worker',
    signal,
    instanceId: process.env.pm_id ?? 'standalone',
  });

  const shutdownTimeout = setTimeout(() => {
    logger.fatal('Worker shutdown timeout exceeded — forcing exit', {
      component: 'worker',
    });
    process.exit(1);
  }, 10_000);

  try {
    // 1. Stop accepting new jobs
    if (workerManager) {
      await workerManager.closeAll();
    }

    // 2. Close queues
    if (queueManager) {
      await queueManager.closeAll();
    }

    // 3. Close Redis publisher
    if (redisPublisher) {
      try {
        await redisPublisher.quit();
      } catch {
        // best-effort
      }
      redisPublisher = null;
    }

    // 4. Disconnect database
    try {
      await databaseConnectionManager.disconnect();
    } catch (dbError) {
      logger.warn('Database disconnect error during shutdown', {
        component: 'worker',
        error: dbError instanceof Error ? dbError.message : String(dbError),
      });
    }

    // 5. Cleanup config manager
    try {
      configManager.cleanup();
    } catch {
      // best-effort
    }

    clearTimeout(shutdownTimeout);
    logger.info('Worker shutdown completed gracefully', {
      component: 'worker',
    });

    try {
      await logger.shutdown();
    } catch {
      // best-effort
    }

    process.exit(0);
  } catch (error) {
    clearTimeout(shutdownTimeout);
    logger.error(
      `Worker shutdown error: ${error instanceof Error ? error.message : String(error)}`,
      { component: 'worker' }
    );
    process.exit(1);
  }
}

process.on('uncaughtException', (error: Error) => {
  logger.fatal(`Worker uncaught exception: ${error.message}`, {
    component: 'worker',
    stack: error.stack,
  });

  // Synchronous exit — async cleanup is unsafe in uncaughtException.
  // DB connections will be released by the OS when the process terminates.
  process.exit(1);
});

process.on('unhandledRejection', async (reason: unknown) => {
  logger.fatal(
    `Worker unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
    { component: 'worker' }
  );

  try {
    await databaseConnectionManager.disconnect();
  } catch {
    // best-effort
  }

  process.exit(1);
});

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('message', msg => {
  if (msg === 'shutdown') {
    gracefulShutdown('PM2_SHUTDOWN');
  }
});

bootstrap().catch(async error => {
  logger.error(
    `Worker bootstrap failed: ${error instanceof Error ? error.message : String(error)}`,
    {
      component: 'worker',
      stack: error instanceof Error ? error.stack : undefined,
    }
  );

  try {
    await databaseConnectionManager.disconnect();
  } catch {
    // best-effort
  }

  process.exit(1);
});
