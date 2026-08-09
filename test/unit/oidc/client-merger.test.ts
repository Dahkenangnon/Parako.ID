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
    vi.mocked(mockRegistryManager.getOidcProviderClients).mockReset();
    vi.mocked(mockRegistryManager.getOidcProviderClients).mockReturnValue([
      staticClient,
    ]);
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

      expect(result.map(client => client.client_id)).toEqual([
        'extra',
        'static-app',
      ]);
      expect(logger.info).toHaveBeenCalledWith(
        '[OIDC] Total clients: 2 (1 passed + 1 from config)'
      );
    });

    it('keeps the passed client when configuration contains the same client id', () => {
      const passedClient = makeUnifiedClient({
        client_id: 'static-app',
        client_name: 'Passed Client',
      });

      const result = merger.mergeClients([passedClient]);

      expect(result).toEqual([passedClient]);
      expect(logger.warn).toHaveBeenCalledWith(
        '[OIDC] Duplicate client_id "static-app" between passed and config clients — skipping config copy'
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[OIDC] Total clients: 1 (1 passed + 0 from config)'
      );
    });
  });

  describe('getAllClientStatistics', () => {
    it('returns statistics for static clients only', async () => {
      const stats = await merger.getAllClientStatistics();

      expect(stats).toEqual({
        total: 1,
        static: 1,
        adapter: 0,
        byType: { web: 1 },
        bySource: { static: 1, adapter: 0 },
        active: 1,
        inactive: 0,
      });
    });
  });

  describe('getClientStatistics', () => {
    it('returns sync statistics', () => {
      const stats = merger.getClientStatistics();

      expect(stats).toEqual({
        total: 1,
        static: 1,
        adapter: 0,
        byType: { web: 1 },
        active: 1,
        inactive: 0,
      });
    });
  });

  describe('formatClientForTemplate', () => {
    it('formats client data for template rendering', () => {
      const client = makeUnifiedClient({
        client_name: 'My App',
        metadata: {
          client_id: 'test-client',
          client_name: 'My App',
          application_type: 'web',
          policy_uri: 'https://client.example/policy',
          tos_uri: 'https://client.example/terms',
          client_uri: 'https://client.example',
          logo_uri: 'https://client.example/logo.svg',
        },
      });
      const formatted = merger.formatClientForTemplate(client);

      expect(formatted).toEqual({
        clientName: 'My App',
        clientId: 'test-client',
        policyUri: 'https://client.example/policy',
        tosUri: 'https://client.example/terms',
        clientUri: 'https://client.example',
        logoUri: 'https://client.example/logo.svg',
      });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('uses safe display defaults and warns about invalid client data', () => {
      const client = makeUnifiedClient({
        client_id: '',
        client_name: '',
        application_type: '',
        source: '' as never,
        metadata: {
          client_id: '',
          client_name: '',
          application_type: '',
        },
      });

      expect(merger.formatClientForTemplate(client)).toEqual({
        clientName: 'Application',
        clientId: '',
        policyUri: undefined,
        tosUri: undefined,
        clientUri: undefined,
        logoUri: '/images/logo-light.png',
      });
      expect(logger.warn).toHaveBeenCalledWith(
        'Invalid client structure for template formatting',
        {
          client_id: '',
          errors: [
            'client_id is required',
            'client_name is required',
            'application_type is required',
            'source is required',
          ],
        }
      );
    });
  });
});
