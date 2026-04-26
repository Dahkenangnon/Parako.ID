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

function makeManager(): DatabaseConnectionManager {
  return new DatabaseConnectionManager(stubLogger);
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
