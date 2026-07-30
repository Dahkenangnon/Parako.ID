import { describe, it, expect, vi, beforeEach } from 'vitest';
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

describe('DatabaseConnectionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });
});
