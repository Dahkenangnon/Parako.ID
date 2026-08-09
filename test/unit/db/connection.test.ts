import mongoose from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DatabaseConnectionManager from '../../../src/db/connection.js';
import type { ILogger } from '../../../src/di/interfaces/logger.interface.js';

// Minimal stub logger
const stubLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as ILogger;

function makeManager(prisma: any = null): DatabaseConnectionManager {
  return new DatabaseConnectionManager(stubLogger, prisma);
}

function setMongooseReadyState(readyState: number): void {
  // Mongoose mutates this value internally; its public declaration is readonly.
  (mongoose.connection as unknown as { readyState: number }).readyState =
    readyState;
}

describe('DatabaseConnectionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('connect() no-op for non-mongodb adapters', () => {
    it('returns without connecting when adapter=sqlite', async () => {
      const mgr = makeManager();
      mgr.initializeWithBootstrapConfig({
        deployment: { environment: 'development', server: { port: 9007 } },
        storage: {
          adapter: 'sqlite',
          sqlite: { path: './data/test.db' },
        },
      } as any);

      // Should not throw (no MongoDB URI needed)
      await expect(mgr.connect()).resolves.toBeUndefined();
    });

    it('returns without connecting when adapter=postgresql', async () => {
      const mgr = makeManager();
      mgr.initializeWithBootstrapConfig({
        deployment: { environment: 'development', server: { port: 9007 } },
        storage: {
          adapter: 'postgresql',
          postgresql: { url: 'postgresql://localhost/test' },
        },
      } as any);

      await expect(mgr.connect()).resolves.toBeUndefined();
    });

    it('isConnected() returns true for non-mongodb adapters (no connection needed)', async () => {
      const mgr = makeManager();
      mgr.initializeWithBootstrapConfig({
        deployment: { environment: 'development', server: { port: 9007 } },
        storage: { adapter: 'sqlite' },
      } as any);

      await mgr.connect();
      expect(mgr.isConnected()).toBe(true);
    });

    it('ping() executes a real query for sqlite and postgresql adapters', async () => {
      const prisma = {
        $queryRawUnsafe: vi.fn().mockResolvedValue([{ '1': 1 }]),
      };
      const mgr = makeManager(prisma);
      mgr.initializeWithBootstrapConfig({
        deployment: { environment: 'development', server: { port: 9007 } },
        storage: { adapter: 'sqlite', sqlite: { path: './data/test.db' } },
      } as any);

      await mgr.connect();

      await expect(mgr.ping()).resolves.toBe(true);
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith('SELECT 1');
    });

    it('ping() returns false when the database query fails', async () => {
      const prisma = {
        $queryRawUnsafe: vi.fn().mockRejectedValue(new Error('offline')),
      };
      const mgr = makeManager(prisma);
      mgr.initializeWithBootstrapConfig({
        deployment: { environment: 'development', server: { port: 9007 } },
        storage: {
          adapter: 'postgresql',
          postgresql: { url: 'postgresql://localhost/test' },
        },
      } as any);

      await mgr.connect();

      await expect(mgr.ping()).resolves.toBe(false);
      expect(stubLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Database health check failed')
      );
    });

    it('ping() returns false before connect and without a Prisma client', async () => {
      const mgr = makeManager();
      mgr.initializeWithBootstrapConfig({
        deployment: { environment: 'development', server: { port: 9007 } },
        storage: { adapter: 'sqlite' },
      } as any);

      await expect(mgr.ping()).resolves.toBe(false);
      await mgr.connect();
      await expect(mgr.ping()).resolves.toBe(false);
    });

    it('disconnects Prisma instead of Mongoose for SQL adapters', async () => {
      const prisma = {
        $disconnect: vi.fn().mockResolvedValue(undefined),
      };
      const closeMongo = vi
        .spyOn(mongoose.connection, 'close')
        .mockResolvedValue(undefined);
      const mgr = makeManager(prisma);
      mgr.initializeWithBootstrapConfig({
        deployment: { environment: 'development', server: { port: 9007 } },
        storage: { adapter: 'sqlite' },
      } as any);
      await mgr.connect();

      await mgr.disconnect();

      expect(prisma.$disconnect).toHaveBeenCalledOnce();
      expect(closeMongo).not.toHaveBeenCalled();
      expect(mgr.isConnected()).toBe(false);
      expect(stubLogger.info).toHaveBeenCalledWith(
        'Database connection closed'
      );
    });

    it('logs a Prisma disconnect failure and preserves connected state', async () => {
      const failure = new Error('pool close failed');
      const prisma = {
        $disconnect: vi.fn().mockRejectedValue(failure),
      };
      const mgr = makeManager(prisma);
      mgr.initializeWithBootstrapConfig({
        deployment: { environment: 'development', server: { port: 9007 } },
        storage: { adapter: 'postgresql' },
      } as any);
      await mgr.connect();

      await expect(mgr.disconnect()).resolves.toBeUndefined();

      expect(stubLogger.error).toHaveBeenCalledWith(failure, {
        context: 'database_disconnect_error',
      });
      expect(stubLogger.info).not.toHaveBeenCalledWith(
        'Database connection closed'
      );
      expect(mgr.isConnected()).toBe(true);
    });

    it('disconnects cleanly when a SQL adapter has no client', async () => {
      const mgr = makeManager();
      mgr.initializeWithBootstrapConfig({
        deployment: { environment: 'development', server: { port: 9007 } },
        storage: { adapter: 'sqlite' },
      } as any);
      await mgr.connect();

      await expect(mgr.disconnect()).resolves.toBeUndefined();

      expect(mgr.isConnected()).toBe(false);
      expect(stubLogger.info).toHaveBeenCalledWith(
        'Database connection closed'
      );
    });
  });

  describe('connect() for mongodb adapter', () => {
    it('throws when adapter=mongodb but mongodb.uri is missing', async () => {
      const mgr = makeManager();
      mgr.initializeWithBootstrapConfig({
        deployment: { environment: 'development', server: { port: 9007 } },
        storage: { adapter: 'mongodb' },
      } as any);

      await expect(mgr.connect()).rejects.toThrow(
        /STORAGE_MONGODB_URI|MongoDB URI not configured/i
      );
    });

    it('connects with hardened options and registers lifecycle hooks once', async () => {
      const hooks = new Map<string, (...args: any[]) => void>();
      const on = vi.fn((event: string, handler: (...args: any[]) => void) => {
        hooks.set(event, handler);
      });
      const connectMongo = vi.spyOn(mongoose, 'connect').mockResolvedValue({
        connection: { on },
      } as any);
      const registerPlugin = vi
        .spyOn(mongoose, 'plugin')
        .mockReturnValue(mongoose as any);
      const mgr = makeManager();
      mgr.initializeWithBootstrapConfig({
        deployment: { environment: 'development', server: { port: 9007 } },
        storage: {
          adapter: 'mongodb',
          mongodb: { uri: 'mongodb://localhost:27017/parako' },
        },
      } as any);

      await mgr.connect();
      const connectionError = new Error('connection interrupted');
      hooks.get('error')!(connectionError);
      hooks.get('disconnected')!();
      await mgr.connect();

      expect(connectMongo).toHaveBeenCalledOnce();
      expect(connectMongo).toHaveBeenCalledWith(
        'mongodb://localhost:27017/parako',
        {
          serverSelectionTimeoutMS: 30_000,
          socketTimeoutMS: 45_000,
          connectTimeoutMS: 30_000,
          maxPoolSize: 10,
          minPoolSize: 2,
          retryWrites: true,
          retryReads: true,
          bufferCommands: true,
        }
      );
      expect(on).toHaveBeenCalledTimes(2);
      expect(registerPlugin).toHaveBeenCalledOnce();
      expect(stubLogger.info).toHaveBeenNthCalledWith(
        1,
        'Connecting to database...'
      );
      expect(stubLogger.info).toHaveBeenNthCalledWith(
        2,
        'Database connected successfully'
      );
      expect(stubLogger.error).toHaveBeenCalledWith(connectionError, {
        context: 'database_connection_error',
      });
      expect(stubLogger.warn).toHaveBeenCalledWith('Database connection lost');
    });

    it('reports MongoDB connected only while Mongoose is ready', async () => {
      vi.spyOn(mongoose, 'connect').mockResolvedValue({
        connection: { on: vi.fn() },
      } as any);
      vi.spyOn(mongoose, 'plugin').mockReturnValue(mongoose as any);
      const mgr = makeManager();
      mgr.initializeWithBootstrapConfig({
        deployment: { environment: 'development', server: { port: 9007 } },
        storage: {
          adapter: 'mongodb',
          mongodb: { uri: 'mongodb://localhost:27017/parako' },
        },
      } as any);
      const originalReadyState = mongoose.connection.readyState;

      try {
        expect(mgr.isConnected()).toBe(false);
        await mgr.connect();
        setMongooseReadyState(1);
        expect(mgr.isConnected()).toBe(true);
        setMongooseReadyState(0);
        expect(mgr.isConnected()).toBe(false);
      } finally {
        setMongooseReadyState(originalReadyState);
      }
    });

    it('pings MongoDB and requires an explicit ok response', async () => {
      vi.spyOn(mongoose, 'connect').mockResolvedValue({
        connection: { on: vi.fn() },
      } as any);
      vi.spyOn(mongoose, 'plugin').mockReturnValue(mongoose as any);
      const command = vi
        .fn()
        .mockResolvedValueOnce({ ok: 1 })
        .mockResolvedValueOnce({ ok: 0 });
      const mgr = makeManager();
      mgr.initializeWithBootstrapConfig({
        deployment: { environment: 'development', server: { port: 9007 } },
        storage: {
          adapter: 'mongodb',
          mongodb: { uri: 'mongodb://localhost:27017/parako' },
        },
      } as any);
      const originalReadyState = mongoose.connection.readyState;
      const originalDb = mongoose.connection.db;

      try {
        await mgr.connect();
        setMongooseReadyState(1);
        (mongoose.connection as any).db = { command };

        await expect(mgr.ping()).resolves.toBe(true);
        await expect(mgr.ping()).resolves.toBe(false);
        expect(command).toHaveBeenNthCalledWith(1, { ping: 1 });
        expect(command).toHaveBeenNthCalledWith(2, { ping: 1 });
      } finally {
        setMongooseReadyState(originalReadyState);
        (mongoose.connection as any).db = originalDb;
      }
    });

    it('returns false when MongoDB has no database handle or ping throws', async () => {
      vi.spyOn(mongoose, 'connect').mockResolvedValue({
        connection: { on: vi.fn() },
      } as any);
      vi.spyOn(mongoose, 'plugin').mockReturnValue(mongoose as any);
      const mgr = makeManager();
      mgr.initializeWithBootstrapConfig({
        deployment: { environment: 'development', server: { port: 9007 } },
        storage: {
          adapter: 'mongodb',
          mongodb: { uri: 'mongodb://localhost:27017/parako' },
        },
      } as any);
      const originalReadyState = mongoose.connection.readyState;
      const originalDb = mongoose.connection.db;

      try {
        await mgr.connect();
        setMongooseReadyState(1);
        (mongoose.connection as any).db = undefined;
        await expect(mgr.ping()).resolves.toBe(false);

        (mongoose.connection as any).db = {
          command: vi.fn().mockRejectedValue('driver offline'),
        };
        await expect(mgr.ping()).resolves.toBe(false);
        expect(stubLogger.warn).toHaveBeenCalledWith(
          'Database health check failed: driver offline'
        );
      } finally {
        setMongooseReadyState(originalReadyState);
        (mongoose.connection as any).db = originalDb;
      }
    });

    it('closes the Mongoose connection for the MongoDB adapter', async () => {
      vi.spyOn(mongoose, 'connect').mockResolvedValue({
        connection: { on: vi.fn() },
      } as any);
      vi.spyOn(mongoose, 'plugin').mockReturnValue(mongoose as any);
      const closeMongo = vi
        .spyOn(mongoose.connection, 'close')
        .mockResolvedValue(undefined);
      const mgr = makeManager();
      mgr.initializeWithBootstrapConfig({
        deployment: { environment: 'development', server: { port: 9007 } },
        storage: {
          adapter: 'mongodb',
          mongodb: { uri: 'mongodb://localhost:27017/parako' },
        },
      } as any);
      await mgr.connect();

      await mgr.disconnect();

      expect(closeMongo).toHaveBeenCalledOnce();
      expect(stubLogger.info).toHaveBeenCalledWith(
        'Database connection closed'
      );
    });

    it('retries transient MongoDB failures and then connects', async () => {
      vi.useFakeTimers();
      const transientOne = new Error('temporary one');
      const transientTwo = new Error('temporary two');
      const on = vi.fn();
      const connectMongo = vi
        .spyOn(mongoose, 'connect')
        .mockRejectedValueOnce(transientOne)
        .mockRejectedValueOnce(transientTwo)
        .mockResolvedValue({ connection: { on } } as any);
      vi.spyOn(mongoose, 'plugin').mockReturnValue(mongoose as any);
      const mgr = makeManager();
      mgr.initializeWithBootstrapConfig({
        deployment: { environment: 'development', server: { port: 9007 } },
        storage: {
          adapter: 'mongodb',
          mongodb: { uri: 'mongodb://localhost:27017/parako' },
        },
      } as any);

      const connecting = mgr.connect();
      await vi.runAllTimersAsync();

      await expect(connecting).resolves.toBeUndefined();
      expect(connectMongo).toHaveBeenCalledTimes(3);
      expect(stubLogger.warn).toHaveBeenNthCalledWith(
        1,
        'Database connection attempt 1/3 failed: temporary one'
      );
      expect(stubLogger.warn).toHaveBeenNthCalledWith(
        2,
        'Database connection attempt 2/3 failed: temporary two'
      );
    });

    it('reports a terminal error after exhausting MongoDB retries', async () => {
      vi.useFakeTimers();
      vi.spyOn(mongoose, 'connect').mockRejectedValue(
        new Error('database offline')
      );
      const mgr = makeManager();
      mgr.initializeWithBootstrapConfig({
        deployment: { environment: 'development', server: { port: 9007 } },
        storage: {
          adapter: 'mongodb',
          mongodb: { uri: 'mongodb://localhost:27017/parako' },
        },
      } as any);

      const connecting = mgr.connect();
      const assertion = expect(connecting).rejects.toThrow(
        'Failed to connect to database after 3 attempts'
      );
      await vi.runAllTimersAsync();
      await assertion;

      expect(mongoose.connect).toHaveBeenCalledTimes(3);
      expect(stubLogger.warn).toHaveBeenCalledTimes(3);
      expect(stubLogger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'database_connection_failed',
      });
    });

    it('coalesces concurrent MongoDB initialization calls', async () => {
      vi.useFakeTimers();
      let resolveConnection!: (value: any) => void;
      const connectMongo = vi.spyOn(mongoose, 'connect').mockImplementation(
        () =>
          new Promise(resolve => {
            resolveConnection = resolve;
          }) as any
      );
      vi.spyOn(mongoose, 'plugin').mockReturnValue(mongoose as any);
      const mgr = makeManager();
      mgr.initializeWithBootstrapConfig({
        deployment: { environment: 'development', server: { port: 9007 } },
        storage: {
          adapter: 'mongodb',
          mongodb: { uri: 'mongodb://localhost:27017/parako' },
        },
      } as any);

      const first = mgr.connect();
      const second = mgr.connect();
      resolveConnection({ connection: { on: vi.fn() } });
      await vi.runAllTimersAsync();

      await expect(Promise.all([first, second])).resolves.toEqual([
        undefined,
        undefined,
      ]);
      expect(connectMongo).toHaveBeenCalledOnce();
    });

    it('propagates a shared MongoDB initialization failure to waiting callers', async () => {
      vi.useFakeTimers();
      vi.spyOn(mongoose, 'connect').mockRejectedValue(
        new Error('database offline')
      );
      const mgr = makeManager();
      mgr.initializeWithBootstrapConfig({
        deployment: { environment: 'development', server: { port: 9007 } },
        storage: {
          adapter: 'mongodb',
          mongodb: { uri: 'mongodb://localhost:27017/parako' },
        },
      } as any);

      const first = mgr.connect();
      const second = mgr.connect();
      const settled = Promise.allSettled([first, second]);
      await vi.runAllTimersAsync();

      const results = await settled;
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        status: 'rejected',
        reason: expect.objectContaining({
          message: 'Failed to connect to database after 3 attempts',
        }),
      });
      expect(results[1]).toMatchObject({
        status: 'rejected',
        reason:
          results[0].status === 'rejected' ? results[0].reason : undefined,
      });
      expect(mongoose.connect).toHaveBeenCalledTimes(3);
    });
  });

  describe('getDB()', () => {
    it('returns the MongoDB handle and fails when none is available', () => {
      const mgr = makeManager();
      const originalDb = mongoose.connection.db;
      const db = { collection: vi.fn() };

      try {
        (mongoose.connection as any).db = db;
        expect(mgr.getDB()).toBe(db);

        (mongoose.connection as any).db = undefined;
        expect(() => mgr.getDB()).toThrow('Database not connected');
      } finally {
        (mongoose.connection as any).db = originalDb;
      }
    });
  });
});
