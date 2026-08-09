import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pinoBoundary = vi.hoisted(() => {
  interface LoggerInstance {
    options: Record<string, any>;
    destination: unknown;
    logger: Record<string, any>;
    records: Record<string, unknown>[];
  }

  const instances: LoggerInstance[] = [];
  const factory = vi.fn(
    (options: Record<string, any>, destination?: unknown) => {
      const records: Record<string, unknown>[] = [];
      const write = (record: Record<string, unknown>) => {
        const serializers = options.serializers as
          Record<string, (value: unknown) => unknown> | undefined;
        const serialized = Object.fromEntries(
          Object.entries(record).map(([key, value]) => [
            key,
            serializers?.[key] ? serializers[key](value) : value,
          ])
        );
        records.push(serialized);
      };
      const childLogger = { kind: 'child-logger' };
      const logger = {
        info: vi.fn(write),
        warn: vi.fn(write),
        debug: vi.fn(write),
        trace: vi.fn(write),
        fatal: vi.fn(write),
        error: vi.fn(write),
        flush: vi.fn((callback?: (error?: Error) => void) => callback?.()),
        child: vi.fn(() => childLogger),
      };

      instances.push({ options, destination, logger, records });
      return logger;
    }
  );

  const transport = vi.fn();
  const destination = vi.fn();
  Object.assign(factory, {
    stdSerializers: { err: vi.fn((error: unknown) => error) },
    stdTimeFunctions: { isoTime: vi.fn() },
    transport,
    destination,
  });

  return { factory, instances, transport, destination };
});

vi.mock('pino', () => ({ default: pinoBoundary.factory }));

import type { IFileSystemUtils } from '../../../src/di/interfaces/file-system-utils.interface.js';
import { AppLogger } from '../../../src/observability/logs/logger.js';

function createLogger(): AppLogger {
  return new AppLogger(
    { ensureDir: vi.fn() } as unknown as IFileSystemUtils,
    'test',
    { prettyPrint: false }
  );
}

describe('AppLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('does not let context replace an explicit info message', () => {
    const logger = createLogger();
    const info = vi
      .spyOn(logger.getLogger(), 'info')
      .mockImplementation(() => undefined);

    logger.info('trusted message', {
      message: 'spoofed message',
      requestId: 1,
    });

    expect(info).toHaveBeenCalledWith({
      message: 'trusted message',
      requestId: 1,
    });
  });

  it.each(['warn', 'debug', 'trace', 'fatal'] as const)(
    'does not let context replace an explicit %s message',
    level => {
      const logger = createLogger();
      const log = vi
        .spyOn(logger.getLogger(), level)
        .mockImplementation(() => undefined);

      logger[level]('trusted message', {
        message: 'spoofed message',
        requestId: 1,
      });

      expect(log).toHaveBeenCalledWith({
        message: 'trusted message',
        requestId: 1,
      });
    }
  );

  it('does not let context replace an explicit error message', () => {
    const logger = createLogger();
    const error = vi
      .spyOn(logger.getLogger(), 'error')
      .mockImplementation(() => undefined);

    logger.error('trusted message', {
      message: 'spoofed message',
      requestId: 1,
    });

    expect(error).toHaveBeenCalledWith({
      message: 'trusted message',
      requestId: 1,
    });
  });

  it('does not let context replace an explicit Error object', () => {
    const logger = createLogger();
    const errorLog = vi
      .spyOn(logger.getLogger(), 'error')
      .mockImplementation(() => undefined);
    const trustedError = new Error('trusted failure');
    const spoofedError = new Error('spoofed failure');

    logger.error(trustedError, { err: spoofedError, requestId: 1 });

    expect(errorLog).toHaveBeenCalledWith({
      err: trustedError,
      requestId: 1,
    });
  });

  it('creates a child logger with the requested bindings', () => {
    const logger = createLogger();
    const backend = pinoBoundary.instances.at(-1)?.logger;

    const child = logger.child({
      requestId: 'request-1',
      tenantId: 'tenant-1',
    });

    expect(child).toEqual({ kind: 'child-logger' });
    expect(backend!.child).toHaveBeenCalledWith({
      requestId: 'request-1',
      tenantId: 'tenant-1',
    });
  });

  it('redacts cyclic configuration context without crashing or mutating it', () => {
    const logger = createLogger();
    const config: Record<string, unknown> = {
      database: { password: 'database-secret', host: 'db.internal' },
    };
    config.self = config;

    expect(() => logger.info('configuration loaded', { config })).not.toThrow();

    const serializedConfig = pinoBoundary.instances.at(-1)?.records.at(-1)
      ?.config as Record<string, any>;
    expect(serializedConfig.database).toEqual({
      password: '[REDACTED]',
      host: 'db.internal',
    });
    expect((config.database as Record<string, unknown>).password).toBe(
      'database-secret'
    );
    expect(config.self).toBe(config);
  });

  it('does not let configuration context spoof the masked marker', () => {
    const logger = createLogger();

    logger.info('configuration loaded', {
      config: { _masked: false, password: 'configuration-secret' },
    });

    expect(pinoBoundary.instances.at(-1)?.records.at(-1)?.config).toEqual({
      _masked: true,
      password: '[REDACTED]',
    });
  });

  it('serializes bigint configuration values without crashing the caller', () => {
    const logger = createLogger();

    expect(() =>
      logger.info('configuration loaded', {
        config: { database: { poolSize: 12n, privateKey: 'private-secret' } },
      })
    ).not.toThrow();

    expect(pinoBoundary.instances.at(-1)?.records.at(-1)?.config).toEqual({
      _masked: true,
      database: { poolSize: '12', privateKey: '[REDACTED]' },
    });
  });

  it('preserves repeated configuration references that are not circular', () => {
    const logger = createLogger();
    const sharedDatabase = { host: 'db.internal' };

    logger.info('configuration loaded', {
      config: { primary: sharedDatabase, replica: sharedDatabase },
    });

    expect(pinoBoundary.instances.at(-1)?.records.at(-1)?.config).toEqual({
      _masked: true,
      primary: { host: 'db.internal' },
      replica: { host: 'db.internal' },
    });
  });

  it('redacts credentials in structured identity contexts', () => {
    const logger = createLogger();

    logger.info('identity context', {
      user: {
        _id: 'user-1',
        username: 'alice',
        email: 'alice@example.com',
        password: 'user-secret',
      },
      session: {
        _id: 'session-1',
        user_id: 'user-1',
        status: 'active',
        secret: 'session-secret',
      },
      client: {
        _id: 'client-1',
        name: 'Demo RP',
        client_secret: 'client-secret',
      },
    });

    expect(pinoBoundary.instances.at(-1)?.records.at(-1)).toEqual({
      message: 'identity context',
      user: {
        id: 'user-1',
        username: 'alice',
        email: 'alice@example.com',
        password: '[REDACTED]',
      },
      session: {
        id: 'session-1',
        user_id: 'user-1',
        status: 'active',
        secret: '[REDACTED]',
      },
      client: {
        id: 'client-1',
        name: 'Demo RP',
        client_secret: '[REDACTED]',
      },
    });
  });

  it('preserves primary identifiers in structured identity contexts', () => {
    const logger = createLogger();

    logger.info('identity context', {
      user: { id: 'user-1' },
      session: { id: 'session-1', userId: 'user-1' },
      client: { id: 'client-1' },
    });

    expect(pinoBoundary.instances.at(-1)?.records.at(-1)).toMatchObject({
      user: { id: 'user-1' },
      session: { id: 'session-1', user_id: 'user-1' },
      client: { id: 'client-1' },
    });
  });

  it('normalizes invalid structured contexts instead of logging raw values', () => {
    const logger = createLogger();

    logger.info('invalid context', {
      user: null,
      session: 'session-secret',
      client: false,
      config: 'configuration-secret',
    });

    expect(pinoBoundary.instances.at(-1)?.records.at(-1)).toEqual({
      message: 'invalid context',
      user: null,
      session: null,
      client: null,
      config: null,
    });
  });

  it('applies explicit logger configuration overrides', () => {
    const redact = { paths: ['request.secret'], remove: false };
    new AppLogger(
      { ensureDir: vi.fn() } as unknown as IFileSystemUtils,
      'staging',
      {
        appName: 'custom-service',
        version: '1.2.3',
        level: 'trace',
        prettyPrint: false,
        fileLogging: { enabled: false, directory: '/unused' },
        redact,
        base: { deployment: 'blue' },
      }
    );

    const options = pinoBoundary.instances.at(-1)?.options;
    expect(options).toMatchObject({
      name: 'custom-service',
      level: 'trace',
      base: { env: 'staging', version: '1.2.3', deployment: 'blue' },
      redact,
    });
    expect(options!.formatters.level('warning')).toEqual({
      level: 'warning',
    });
  });

  it('uses the deployment environment when no environment is provided', () => {
    vi.stubEnv('DEPLOYMENT_ENVIRONMENT', 'staging');
    vi.stubEnv('NODE_ENV', 'development');

    new AppLogger({ ensureDir: vi.fn() } as unknown as IFileSystemUtils);

    expect(pinoBoundary.instances.at(-1)?.options).toMatchObject({
      level: 'info',
      base: { env: 'staging', deployment: 'staging' },
    });
  });

  it('falls back to NODE_ENV when the deployment environment is absent', () => {
    vi.stubEnv('DEPLOYMENT_ENVIRONMENT', undefined);
    vi.stubEnv('NODE_ENV', 'production');

    new AppLogger({ ensureDir: vi.fn() } as unknown as IFileSystemUtils);

    expect(pinoBoundary.instances.at(-1)?.options).toMatchObject({
      level: 'info',
      base: { env: 'production', deployment: 'production' },
    });
  });

  it('uses development defaults and pretty output without environment hints', () => {
    vi.stubEnv('DEPLOYMENT_ENVIRONMENT', undefined);
    vi.stubEnv('NODE_ENV', undefined);

    new AppLogger({ ensureDir: vi.fn() } as unknown as IFileSystemUtils);

    expect(pinoBoundary.instances.at(-1)?.options).toMatchObject({
      level: 'debug',
      base: { env: 'development', deployment: 'development' },
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    });
  });

  it('configures the standalone root logger with safe development defaults', async () => {
    vi.stubEnv('DEPLOYMENT_ENVIRONMENT', undefined);
    vi.stubEnv('NODE_ENV', undefined);
    vi.resetModules();

    const { rootLogger } =
      await import('../../../src/observability/logs/logger.js');
    const rootInstance = pinoBoundary.instances.at(-1);

    expect(rootLogger).toBe(rootInstance?.logger);
    expect(rootInstance?.options).toMatchObject({
      level: 'debug',
      base: { env: 'development' },
    });
    expect(rootInstance?.options.formatters.level('notice')).toEqual({
      level: 'notice',
    });
  });

  it('uses a configured asynchronous file transport in production', () => {
    const ensureDir = vi.fn();
    const destination = { flush: vi.fn(), end: vi.fn() };
    pinoBoundary.transport.mockReturnValue(destination);

    new AppLogger({ ensureDir } as unknown as IFileSystemUtils, 'production', {
      prettyPrint: false,
      fileLogging: { enabled: true, directory: '/logs/parako' },
    });

    expect(ensureDir).toHaveBeenCalledWith('/logs/parako');
    expect(pinoBoundary.transport).toHaveBeenCalledWith({
      target: 'pino/file',
      options: {
        destination: '/logs/parako/app.log',
        mkdir: true,
        append: true,
      },
    });
    expect(pinoBoundary.instances.at(-1)?.destination).toBe(destination);
  });

  it('falls back when the worker-thread file transport cannot start', () => {
    const fallbackDestination = { flush: vi.fn(), end: vi.fn() };
    pinoBoundary.transport.mockImplementation(() => {
      throw new Error('worker threads unavailable');
    });
    pinoBoundary.destination.mockReturnValue(fallbackDestination);

    new AppLogger(
      { ensureDir: vi.fn() } as unknown as IFileSystemUtils,
      'production',
      {
        prettyPrint: false,
        fileLogging: { enabled: true, directory: '/logs/parako' },
      }
    );

    expect(pinoBoundary.destination).toHaveBeenCalledWith({
      dest: '/logs/parako/app.log',
      sync: false,
      mkdir: true,
    });
    expect(pinoBoundary.instances.at(-1)?.destination).toBe(
      fallbackDestination
    );
  });

  it('surfaces flush errors from the default Pino destination', async () => {
    const logger = createLogger();
    const flushError = new Error('stdout flush failed');
    const pinoFlush = pinoBoundary.instances.at(-1)?.logger.flush;
    pinoFlush.mockImplementation((callback: (error?: Error) => void) =>
      callback(flushError)
    );

    await expect(logger.flush()).rejects.toBe(flushError);
  });

  it('resolves after the default Pino destination finishes flushing', async () => {
    const logger = createLogger();

    await expect(logger.flush()).resolves.toBeUndefined();
  });

  it('rejects when the logging destination does not finish flushing', async () => {
    vi.useFakeTimers();
    const logger = createLogger();
    pinoBoundary.instances
      .at(-1)
      ?.logger.flush.mockImplementation(() => undefined);

    const result = expect(logger.flush()).rejects.toThrow(
      'Logger flush timeout'
    );
    await vi.advanceTimersByTimeAsync(2000);

    await result;
  });

  it('closes the file destination when flushing fails during shutdown', async () => {
    const flushError = new Error('flush failed');
    const end = vi.fn();
    pinoBoundary.transport.mockReturnValue({
      flush: vi.fn((callback: (error?: Error) => void) => callback(flushError)),
      end,
    });
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = new AppLogger(
      { ensureDir: vi.fn() } as unknown as IFileSystemUtils,
      'production',
      {
        prettyPrint: false,
        fileLogging: { enabled: true, directory: '/logs/parako' },
      }
    );

    await logger.shutdown();

    expect(end).toHaveBeenCalledOnce();
    expect(stderr).toHaveBeenCalledWith('Logger shutdown error:', flushError);
  });

  it('reports a destination close failure without rejecting shutdown', async () => {
    const closeError = new Error('close failed');
    pinoBoundary.transport.mockReturnValue({
      flush: vi.fn((callback: (error?: Error) => void) => callback()),
      end: vi.fn(() => {
        throw closeError;
      }),
    });
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = new AppLogger(
      { ensureDir: vi.fn() } as unknown as IFileSystemUtils,
      'production',
      {
        prettyPrint: false,
        fileLogging: { enabled: true, directory: '/logs/parako' },
      }
    );

    await expect(logger.shutdown()).resolves.toBeUndefined();
    expect(stderr).toHaveBeenCalledWith('Logger shutdown error:', closeError);
  });
});
