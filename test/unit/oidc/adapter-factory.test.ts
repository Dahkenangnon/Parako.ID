/**
 * TDD — OIDC adapter factory wiring
 *
 * Verifies that OIDCAdapterBridge.initialize() selects the Prisma adapter
 * factory when bootstrap storage.adapter is 'sqlite' or 'postgresql'.
 *
 * RED: OIDCAdapterBridge doesn't support Prisma yet.
 * GREEN: After wiring createPrismaAdapterFactory into initialize().
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll } from 'vitest';
import { OIDCAdapterBridge } from '../../../src/oidc/adapter/index.js';
import { PrismaOidcStoreAdapter } from '../../../src/oidc/adapter/prisma/index.js';

// ── Minimal mocks ─────────────────────────────────────────────────────────────

const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => mockLogger,
  getLogger: () => null,
  flush: async () => {},
  shutdown: async () => {},
} as any;

const mockConfigManager = {
  subscribe: () => {},
  getConfig: () => ({
    oidc_storage: {
      oidc_adapter: {
        type: 'mongodb',
        mongodb: {
          uri: 'mongodb://localhost:27017',
          database: 'parako-id-dev',
        },
        redis: { host: 'localhost', port: 6379, database: 0 },
      },
    },
  }),
} as any;

function makeBootstrapProvider(adapter: 'sqlite' | 'postgresql') {
  return {
    getConfigValue: (path: string, defaultValue?: unknown) => {
      if (path === 'storage.adapter') return adapter;
      return defaultValue;
    },
  } as any;
}

const mockPrisma = {} as any; // no methods needed for factory creation

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Instantiate OIDCAdapterBridge directly (bypass DI) with the given config.
 * All MongoDB/Redis services are no-op mocks — only the Prisma path is tested.
 */
function makeBridge(adapter: 'sqlite' | 'postgresql') {
  return new OIDCAdapterBridge(
    mockLogger,
    mockConfigManager,
    makeBootstrapProvider(adapter),
    mockPrisma
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OIDCAdapterBridge — Prisma adapter wiring', () => {
  describe('adapter = sqlite', () => {
    let bridge: OIDCAdapterBridge;

    beforeAll(async () => {
      bridge = makeBridge('sqlite');
      await bridge.initialize();
    });

    it('bridge.adapter is a factory function', () => {
      expect(typeof bridge.adapter).toBe('function');
    });

    it('factory creates PrismaOidcStoreAdapter instances', () => {
      const factory = bridge.adapter as (m: string) => unknown;
      const instance = factory('AccessToken');
      expect(instance).toBeInstanceOf(PrismaOidcStoreAdapter);
    });

    it('factory scopes adapter to model name', () => {
      const factory = bridge.adapter as (m: string) => PrismaOidcStoreAdapter;
      const at = factory('AccessToken');
      const rt = factory('RefreshToken');
      expect((at as any).name).toBe('AccessToken');
      expect((rt as any).name).toBe('RefreshToken');
    });
  });

  describe('adapter = postgresql', () => {
    let bridge: OIDCAdapterBridge;

    beforeAll(async () => {
      bridge = makeBridge('postgresql');
      await bridge.initialize();
    });

    it('bridge.adapter is a factory function', () => {
      expect(typeof bridge.adapter).toBe('function');
    });

    it('factory creates PrismaOidcStoreAdapter instances', () => {
      const factory = bridge.adapter as (m: string) => unknown;
      const instance = factory('Session');
      expect(instance).toBeInstanceOf(PrismaOidcStoreAdapter);
    });
  });
});
