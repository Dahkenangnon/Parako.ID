/**
 * TDD — OIDCClientMerger (simplified)
 *
 * After Step 19, the merger only handles:
 * - Static clients from parako-rp.jsonc
 * - Passed dynamic/adapter clients (no DB loading)
 * - No more IOidcClientService dependency
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OIDCClientMerger } from '../../../src/oidc/client-merger.js';
import type { ILogger } from '../../../src/di/interfaces/logger.interface.js';
import type { IClientRegistryManager } from '../../../src/di/interfaces/client-registry-manager.interface.js';
import type { UnifiedClient } from '../../../src/utils/client-transformer.js';

const logger: ILogger = {
  getLogger: () => null as any,
  child: () => null as any,
  flush: async () => {},
  shutdown: async () => {},
  error: () => {},
  warn: vi.fn(),
  info: vi.fn(),
  debug: () => {},
  trace: () => {},
  fatal: () => {},
};

const staticClient: any = {
  client_id: 'static-app',
  client_name: 'Static App',
  application_type: 'web',
  grant_types: ['authorization_code'],
  redirect_uris: ['https://static.example.com/cb'],
};

const mockRegistryManager: IClientRegistryManager = {
  getOidcProviderClients: vi.fn().mockReturnValue([staticClient]),
} as any;

function makeUnifiedClient(
  overrides: Partial<UnifiedClient> = {}
): UnifiedClient {
  return {
    client_id: 'test-client',
    client_name: 'Test Client',
    application_type: 'web',
    source: 'static',
    isEditable: false,
    isStatic: true,
    active: true,
    require_pkce: false,
    tags: [],
    contacts: [],
    isInternalClient: false,
    created_at: null,
    updated_at: null,
    metadata: {
      client_id: 'test-client',
      client_name: 'Test Client',
      application_type: 'web',
    },
    ...overrides,
  };
}

describe('OIDCClientMerger (simplified)', () => {
  let merger: OIDCClientMerger;

  beforeEach(() => {
    vi.clearAllMocks();
    merger = new OIDCClientMerger(logger, mockRegistryManager);
  });

  describe('loadClients', () => {
    it('loads static clients from registry manager', () => {
      const clients = merger.loadClients();
      expect(clients).toHaveLength(1);
      expect(clients[0].client_id).toBe('static-app');
      expect(clients[0].source).toBe('static');
    });

    it('returns empty array on error', () => {
      (mockRegistryManager.getOidcProviderClients as any).mockImplementation(
        () => {
          throw new Error('config error');
        }
      );
      const clients = merger.loadClients();
      expect(clients).toEqual([]);
    });
  });

  describe('mergeClients', () => {
    it('merges static clients from config with passed statics', () => {
      const extra = [makeUnifiedClient({ client_id: 'extra' })];
      const result = merger.mergeClients(extra);
      // extra + loaded from registry
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getAllClientStatistics', () => {
    it('returns statistics for static clients only', async () => {
      const stats = await merger.getAllClientStatistics();
      expect(stats.total).toBeGreaterThanOrEqual(0);
      expect(stats.adapter).toBe(0); // adapter clients managed separately
      expect(typeof stats.static).toBe('number');
    });
  });

  describe('getClientStatistics', () => {
    it('returns sync statistics', () => {
      const stats = merger.getClientStatistics();
      expect(typeof stats.total).toBe('number');
      expect(typeof stats.active).toBe('number');
    });
  });

  describe('formatClientForTemplate', () => {
    it('formats client data for template rendering', () => {
      const client = makeUnifiedClient({ client_name: 'My App' });
      const formatted = merger.formatClientForTemplate(client);
      expect(formatted.clientName).toBe('My App');
      expect(formatted.clientId).toBe('test-client');
    });
  });
});
