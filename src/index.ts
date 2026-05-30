import 'reflect-metadata';
import http from 'node:http';
import process from 'node:process';
import { TYPES } from './di/types.js';
import { containerReady, assertContainerValid } from './di/index.js';
import { IConfigManager } from './di/interfaces/config-manager.interface.js';
import { IApplication } from './di/interfaces/application.interface.js';
import { IEmailService } from './di/interfaces/email-service.interface.js';
import { ILogger } from './di/interfaces/logger.interface.js';
import { IDatabaseConnectionManager } from './di/interfaces/database-connection-manager.interface.js';
import { IActivityService } from './di/interfaces/activity-service.interface.js';
import { ISettingsService } from './di/interfaces/settings-service.interface.js';
import type { IRedisPubSubService } from './di/interfaces/redis-pubsub-service.interface.js';
import type { IOIDCAdapterBridge } from './di/interfaces/oidc-adapter-bridge.interface.js';
import { BootstrapConfig } from './config/schemas/bootstrap-schema.js';
import { AppConfig } from './config/schemas/schema.js';
import {
  initRateLimitRedis,
  getRateLimitRedisClient,
} from './utils/rate-limiter.js';
import {
  SERVER_CLOSE_TIMEOUT_MS,
  SHUTDOWN_TIMEOUT_MS,
  safeShutdownStep,
} from './utils/shutdown.js';
import { HARDENING } from './config/hardening-defaults.js';

// Validate DI container at startup (fail fast if bindings are missing).
const container = await containerReady;
assertContainerValid(container);

const configManager = container.get<IConfigManager>(TYPES.ConfigManager);

const bootstrapConfig =
  (await configManager.getBootstrapConfig()) as unknown as BootstrapConfig &
    AppConfig;
const environment = bootstrapConfig.deployment.environment;
const port = bootstrapConfig.deployment.server.port;

// SQLite single-process safety guard: FATAL if cluster mode is detected.
// SQLite does not support concurrent writes from multiple processes.
// See ecosystem.config.cjs for the PM2_INSTANCES setting.
if (
  bootstrapConfig.storage?.adapter === 'sqlite' &&
  process.env.PM2_INSTANCES &&
  process.env.PM2_INSTANCES !== '1'
) {
  console.error(
    '[FATAL] SQLite storage adapter detected with PM2_INSTANCES > 1. ' +
      'SQLite does not support concurrent writes from multiple processes. ' +
      'Set PM2_INSTANCES=1 or switch to PostgreSQL/MongoDB for cluster mode.'
  );
  process.exit(1);
}

// SQLite + multi-tenancy guard: SQLite has no RLS support.
// Multi-tenancy requires PostgreSQL RLS or MongoDB global plugin.
if (
  bootstrapConfig.storage?.adapter === 'sqlite' &&
  bootstrapConfig.multiTenancy?.enabled === true
) {
  console.error(
    '[FATAL] Multi-tenancy is enabled but storage adapter is SQLite. ' +
      'SQLite does not support Row-Level Security (RLS) required for tenant isolation. ' +
      'Switch to PostgreSQL or MongoDB, or disable multi-tenancy ' +
      '(MULTI_TENANCY_ENABLED=false).'
  );
  process.exit(1);
}

const databaseConnectionManager = container.get<IDatabaseConnectionManager>(
  TYPES.DatabaseConnectionManager
);
const logger = container.get<ILogger>(TYPES.Logger);

class ParakoServer {
  private httpServer: http.Server;

  constructor() {
    this.httpServer = http.createServer();
  }

  private displayBanner(): void {
    const asciiArt = [
      '',
      '  ██████╗  █████╗ ██████╗  █████╗ ██╗  ██╗ ██████╗ ',
      '  ██╔══██╗██╔══██╗██╔══██╗██╔══██╗██║ ██╔╝██╔═══██╗',
      '  ██████╔╝███████║██████╔╝███████║█████╔╝ ██║   ██║',
      '  ██╔═══╝ ██╔══██║██╔══██╗██╔══██║██╔═██╗ ██║   ██║',
      '  ██║     ██║  ██║██║  ██║██║  ██║██║  ██╗╚██████╔╝',
      '  ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ',
      '',
      '  .ID — Your auth server. Self-hosted. Free.',
      '',
    ];

    asciiArt.forEach(line => {
      console.log(line);
    });

    console.log('');
    console.log(`Environment: ${environment}`);
    console.log(`Port: ${port}`);
    console.log('');
  }

  public async initialize(): Promise<ParakoServer> {
    try {
      this.displayBanner();

      databaseConnectionManager.initializeWithBootstrapConfig(bootstrapConfig);

      await databaseConnectionManager.connect();

      // Only proceed if database is connected
      if (!databaseConnectionManager.isConnected()) {
        throw new Error(
          'Cannot initialize application: database connection failed'
        );
      }

      try {
        await configManager.load();

        try {
          await configManager.flushInitial();
          await configManager.load();
        } catch (flushError) {
          logger.warn(
            'Failed to flush initial configuration, continuing with loaded config',
            { error: flushError }
          );
        }

        try {
          const settingsService = container.get<ISettingsService>(
            TYPES.SettingsService
          );
          const validationResult =
            await settingsService.validateAndFixActiveConfigs();

          if (validationResult.multipleActiveFound) {
            logger.warn(
              'Multiple active configurations detected and auto-healed',
              {
                fixedCount: validationResult.fixedCount,
                keptVersion: validationResult.keptVersion,
                details: validationResult.details,
              }
            );
            await configManager.reload();
          } else if (validationResult.isValid) {
            logger.info('Configuration validation passed', {
              details: validationResult.details,
            });
          } else {
            logger.warn('Configuration validation returned issues', {
              details: validationResult.details,
            });
          }
        } catch (validationError) {
          logger.warn(
            'Configuration validation failed, but continuing startup',
            {
              error: validationError,
            }
          );
        }

        // Bootstrap master tenant (multi-tenancy only)
        if (bootstrapConfig.multiTenancy?.enabled) {
          try {
            const { bootstrapMasterTenant } =
              await import('./multi-tenancy/master-tenant-bootstrap.js');
            await bootstrapMasterTenant(container, logger, bootstrapConfig);
          } catch (bootstrapError) {
            logger.warn('Master tenant bootstrap failed, continuing startup', {
              error: bootstrapError,
            });
          }
        }

        logger.info('Full configuration loaded successfully');
      } catch (configError) {
        logger.warn(
          'Failed to load full configuration, continuing with bootstrap config',
          { error: configError }
        );
        // ConfigManager will fall back to bootstrap config internally
      }

      // Connect Redis Pub/Sub event bus for cross-process communication
      try {
        const pubsubService = container.get<IRedisPubSubService>(
          TYPES.RedisPubSubService
        );
        const config = configManager.getConfig();
        const adapterType = (config as any).oidc_storage?.oidc_adapter?.type;
        const redisConfig = (config as any).oidc_storage?.oidc_adapter?.redis;
        const hasExplicitRedis =
          bootstrapConfig.redis?.host || process.env.REDIS_HOST;
        if (redisConfig && (adapterType === 'redis' || hasExplicitRedis)) {
          const redisUrl = redisConfig.password
            ? `redis://:${redisConfig.password}@${redisConfig.host}:${redisConfig.port}/${redisConfig.database}`
            : `redis://${redisConfig.host}:${redisConfig.port}/${redisConfig.database}`;

          const basePrefix = config.deployment?.redis_prefix || 'parako';

          await pubsubService.connect(redisUrl);

          // Wire config invalidation across workers
          configManager.setPubSub(pubsubService);

          // Subscribe to OIDC client invalidation — sync adapter state across workers.
          // Only 'deleted' events need adapter cleanup (remove the document on other
          // workers).  'created' and 'updated' events require no adapter action because
          // node-oidc-provider re-fetches from the adapter on each Client.find(id).
          pubsubService.subscribe(
            `${basePrefix}:oidc:client:invalidated`,
            (msg: Record<string, unknown>) => {
              const clientId = msg.clientId as string;
              const action = msg.action as string;
              if (!clientId) return;

              if (action === 'deleted') {
                try {
                  const oidcAdapter = container.get<IOIDCAdapterBridge>(
                    TYPES.OIDCAdapterBridge
                  );
                  oidcAdapter.client.destroy(clientId).catch(err => {
                    logger.warn('Failed to destroy OIDC client adapter entry', {
                      clientId,
                      error: err instanceof Error ? err.message : String(err),
                    });
                  });
                } catch {
                  // OIDC adapter may not be available yet
                }
              }
            }
          );

          await initRateLimitRedis(redisUrl, basePrefix, logger);

          logger.info('Redis Pub/Sub event bus initialized');
        }
      } catch (err) {
        logger.warn('Redis Pub/Sub init failed, operating in local-only mode', {
          error: err,
        });
      }

      const emailService = container.get<IEmailService>(TYPES.EmailService);

      emailService.initialize();

      try {
        const isEmailConnected = await emailService.connectToEmailServer([
          'test',
        ]);
        if (isEmailConnected) {
          logger.info('Email server initialized successfully.');
        } else {
          logger.warn('Email server initialization failed, but continuing...');
        }
      } catch (emailError) {
        logger.warn('Email server initialization failed, but continuing...', {
          error: emailError,
        });
      }

      logger.debug('Checking if config is accessible...');
      try {
        configManager.getConfig();
        logger.debug(
          'Config is accessible, proceeding with Application resolution'
        );
      } catch (error) {
        logger.error('Config is NOT accessible', { error });
        throw error;
      }

      logger.debug('Resolving Application from DI container...');
      const application = container.get<IApplication>(TYPES.Application);
      const app = await application.initialize();
      app.set('port', port);

      this.httpServer = http.createServer(app);
      return this;
    } catch (error) {
      logger.error(error as Error, {
        step: 'initialization',
        port,
        environment,
      });
      throw error;
    }
  }

  public async start(): Promise<void> {
    if (!databaseConnectionManager.isConnected()) {
      const error = new Error('Cannot start server: database not connected');
      logger.error(error, {
        databaseConnected: databaseConnectionManager.isConnected(),
        port,
        environment,
      });
      throw error;
    }

    return new Promise((resolve, reject) => {
      this.httpServer.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          logger.error(error, {
            port,
            environment,
            error_type: 'port_in_use',
          });
        } else {
          logger.error(error, {
            code: error.code,
            errno: error.errno,
            syscall: error.syscall,
            port,
            environment,
            error_type: 'server_startup',
          });
        }
        reject(error);
      });

      this.httpServer.once('listening', () => {
        const instanceId = process.env.pm_id || 'standalone';
        logger.info(`Server listening on port ${port}`, {
          port,
          environment,
          instanceId,
        });

        // Signal PM2 that the process is ready to accept connections
        if (typeof process.send === 'function') {
          process.send('ready');
        }

        resolve();
      });

      this.httpServer.keepAliveTimeout = HARDENING.timeouts.keepAliveMs;
      this.httpServer.headersTimeout = HARDENING.timeouts.headersMs;
      if (typeof this.httpServer.requestTimeout === 'number') {
        this.httpServer.requestTimeout = HARDENING.timeouts.requestMs;
      }
      if (HARDENING.timeouts.tcpNoDelay) {
        this.httpServer.on('connection', socket => {
          socket.setNoDelay(true);
        });
      }

      this.httpServer.listen(port);
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info('Stopping HTTP server...');

      // Signal keep-alive clients to close so in-flight requests drain
      this.httpServer.on('request', (_req, res) => {
        if (!res.headersSent) {
          res.setHeader('Connection', 'close');
        }
      });

      const closeTimeout = setTimeout(() => {
        const error = new Error('Server close timeout');
        logger.error(error, { timeout: 'server_close' });
        reject(error);
      }, SERVER_CLOSE_TIMEOUT_MS);
      closeTimeout.unref();

      this.httpServer.close(async error => {
        clearTimeout(closeTimeout);

        if (error) {
          logger.error(error, { step: 'server_close' });
          reject(error);
        } else {
          logger.info('HTTP server stopped gracefully');

          try {
            await databaseConnectionManager.disconnect();
          } catch (dbError) {
            logger.error(dbError as Error, { step: 'database_disconnect' });
          }

          resolve();
        }
      });
    });
  }
}

function setupErrorHandlers(): void {
  process.on('uncaughtException', (error: Error) => {
    logger.fatal('Uncaught exception - process will exit', {
      error_type: 'uncaught_exception',
      error: error.message,
      stack: error.stack,
    });

    // Synchronous exit — async cleanup is unsafe in uncaughtException.
    // DB connections will be released by the OS when the process terminates.
    process.exit(1);
  });

  process.on(
    'unhandledRejection',
    async (reason: unknown, promise: Promise<unknown>) => {
      logger.fatal('Unhandled promise rejection - process will exit', {
        error_type: 'unhandled_rejection',
        reason: reason instanceof Error ? reason.message : String(reason),
        promise: promise.toString() as string,
      });

      try {
        await databaseConnectionManager.disconnect();
      } catch (dbError) {
        console.error(
          'Emergency database disconnect failed:',
          dbError instanceof Error ? dbError.message : String(dbError)
        );
      }

      process.exit(1);
    }
  );
}

async function bootstrap(): Promise<void> {
  setupErrorHandlers();

  try {
    const server = new ParakoServer();

    await server.initialize();
    await server.start();

    let isShuttingDown = false;
    const gracefulShutdown = async (signal: string): Promise<void> => {
      if (isShuttingDown) {
        logger.info(
          `${signal} received - shutdown already in progress, ignoring`
        );
        return;
      }
      isShuttingDown = true;

      logger.info(`${signal} received - shutting down server`, {
        signal,
        instanceId: process.env.pm_id || 'standalone',
      });

      try {
        const shutdownTimeout = setTimeout(() => {
          logger.fatal('Shutdown timeout exceeded - forcing exit', {
            timeout: 'shutdown',
          });
          process.exit(1);
        }, SHUTDOWN_TIMEOUT_MS);
        shutdownTimeout.unref();

        await safeShutdownStep(
          'activity-service',
          async () => {
            const activityService = container.get<IActivityService>(
              TYPES.ActivityService
            );
            await activityService.shutdown();
            logger.info('ActivityService shutdown complete');
          },
          logger
        );

        await safeShutdownStep(
          'redis-pubsub',
          async () => {
            const pubsubService = container.get<IRedisPubSubService>(
              TYPES.RedisPubSubService
            );
            await pubsubService.disconnect();
          },
          logger
        );

        await safeShutdownStep(
          'rate-limit-redis',
          async () => {
            const rlClient = getRateLimitRedisClient();
            if (rlClient) await rlClient.quit();
          },
          logger
        );

        await server.stop();
        clearTimeout(shutdownTimeout);

        await safeShutdownStep(
          'config-cleanup',
          async () => {
            configManager.cleanup();
          },
          logger
        );

        logger.info('Server shutdown completed gracefully');

        // Shutdown logger last to ensure all logs are flushed.
        // Any failure here must use console.error: the logger is being torn
        // down, so safeShutdownStep would have nowhere to report.
        try {
          await logger.shutdown();
        } catch (loggerError) {
          console.error(
            'Logger shutdown failed:',
            loggerError instanceof Error
              ? loggerError.message
              : String(loggerError)
          );
        }

        process.exit(0);
      } catch (error) {
        logger.error(error as Error, {
          signal,
          instanceId: process.env.pm_id || 'standalone',
        });
        process.exit(1);
      }
    };

    const onShutdown = (signal: string): void => {
      gracefulShutdown(signal).catch((err: unknown) => {
        logger.fatal('Shutdown handler crashed', {
          signal,
          err: err instanceof Error ? err.message : String(err),
        });
        process.exit(1);
      });
    };

    process.on('SIGTERM', () => onShutdown('SIGTERM'));
    process.on('SIGINT', () => onShutdown('SIGINT'));
    process.on('message', msg => {
      if (msg === 'shutdown') onShutdown('PM2_SHUTDOWN');
    });
  } catch (error) {
    logger.error(error as Error, { step: 'bootstrap' });

    try {
      await databaseConnectionManager.disconnect();
    } catch (dbError) {
      console.error(
        'Bootstrap emergency database disconnect failed:',
        dbError instanceof Error ? dbError.message : String(dbError)
      );
    }

    process.exit(1);
  }
}

bootstrap();
