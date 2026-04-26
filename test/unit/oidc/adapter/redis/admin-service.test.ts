/**
 * TDD — RedisOidcAdminService
 * Validates the consolidated Redis OIDC admin service that replaces
 * the 14 per-model per-file adapter classes.
 *
 * Uses `scanKeys` spy to avoid needing a real Redis connection.
 */
import { randomBytes } from 'node:crypto';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  beforeAll,
  afterAll,
} from 'vitest';
import { RedisOidcAdminService } from '../../../../../src/oidc/adapter/redis/admin-service.js';
import type { ILogger } from '../../../../../src/di/interfaces/logger.interface.js';
import type Redis from 'ioredis';

// Set up ENCRYPTION_KEY for client secret encryption tests
const _origEncKey = process.env.ENCRYPTION_KEY;
beforeAll(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
});
afterAll(() => {
  if (_origEncKey) process.env.ENCRYPTION_KEY = _origEncKey;
  else delete process.env.ENCRYPTION_KEY;
});

const logger: ILogger = {
  getLogger: () => null as any,
  child: () => null as any,
  flush: async () => {},
  shutdown: async () => {},
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
};

const mockClient = {} as Redis;
const testPrefix = 'parako';

// ─── Session model ─────────────────────────────────────────────────────────

describe('RedisOidcAdminService — Session model', () => {
  let service: RedisOidcAdminService;

  beforeEach(() => {
    service = new RedisOidcAdminService(
      'Session',
      mockClient,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue([]);
  });

  it('findByAccountId returns empty array when no keys exist', async () => {
    const results = await service.findByAccountId('user-1');
    expect(results).toEqual([]);
  });

  it('deleteSessionsByAccountId returns zero count when no keys exist', async () => {
    const result = await service.deleteSessionsByAccountId('user-1');
    expect(result.deletedCount).toBe(0);
  });

  it('deleteSessionsByIds returns zero count for empty list', async () => {
    const result = await service.deleteSessionsByIds([]);
    expect(result.deletedCount).toBe(0);
  });

  it('getSessionStatistics returns zeros when no keys exist', async () => {
    const stats = await service.getSessionStatistics();
    expect(stats).toEqual({ total: 0, active: 0, expired: 0 });
  });
});

// ─── Grant model ───────────────────────────────────────────────────────────

describe('RedisOidcAdminService — Grant model', () => {
  let service: RedisOidcAdminService;

  beforeEach(() => {
    service = new RedisOidcAdminService(
      'Grant',
      mockClient,
      logger,
      testPrefix
    );
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue([]);
  });

  it('findGrantsByAccountId returns empty array when no keys exist', async () => {
    const results = await service.findGrantsByAccountId('user-1');
    expect(results).toEqual([]);
  });

  it('deleteGrantsByAccountId returns zero count when no keys exist', async () => {
    const result = await service.deleteGrantsByAccountId('user-1');
    expect(result.deletedCount).toBe(0);
  });
});

// ─── AccessToken / RefreshToken / Interaction (deleteByAccountId) ──────────

describe.each(['AccessToken', 'RefreshToken', 'Interaction'] as const)(
  'RedisOidcAdminService — %s model deleteByAccountId',
  model => {
    let service: RedisOidcAdminService;

    beforeEach(() => {
      service = new RedisOidcAdminService(
        model,
        mockClient,
        logger,
        testPrefix
      );
      vi.spyOn(service as any, 'scanKeys').mockResolvedValue([]);
    });

    it('returns zero count when no keys exist', async () => {
      const result = await service.deleteByAccountId('user-1');
      expect(result.deletedCount).toBe(0);
    });
  }
);

// ─── Client CRUD ────────────────────────────────────────────────────────────

describe('RedisOidcAdminService — Client CRUD', () => {
  let service: RedisOidcAdminService;
  let mockSet: ReturnType<typeof vi.fn>;
  let mockGet: ReturnType<typeof vi.fn>;
  let mockDel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSet = vi.fn().mockResolvedValue('OK');
    mockGet = vi.fn().mockResolvedValue(null);
    mockDel = vi.fn().mockResolvedValue(1);
    const client = { set: mockSet, get: mockGet, del: mockDel } as any;
    service = new RedisOidcAdminService('Client', client, logger, testPrefix);
    vi.spyOn(service as any, 'scanKeys').mockResolvedValue([]);
  });

  describe('createClient', () => {
    it('stores client data as JSON in Redis', async () => {
      const result = await service.createClient({
        client_name: 'Test App',
        redirect_uris: ['https://app.example.com/cb'],
      });
      expect(result.client_id).toBeTruthy();
      expect(result.client_name).toBe('Test App');
      expect(result.client_secret).toBeTruthy();
      expect(mockSet).toHaveBeenCalledWith(
        `${testPrefix}:default:oidc:Client:${result.client_id}`,
        expect.any(String)
      );
    });

    it('rejects invalid client data', async () => {
      await expect(
        service.createClient({ application_type: 'invalid' as any })
      ).rejects.toThrow('Client validation failed');
    });
  });

  describe('findClientById', () => {
    it('returns client when found', async () => {
      mockGet.mockResolvedValue(
        JSON.stringify({
          client_id: 'c1',
          client_name: 'App',
          application_type: 'web',
        })
      );
      const result = await service.findClientById('c1');
      expect(result).not.toBeNull();
      expect(result!.client_id).toBe('c1');
    });

    it('returns null when not found', async () => {
      mockGet.mockResolvedValue(null);
      expect(await service.findClientById('nonexistent')).toBeNull();
    });
  });

  describe('findAllClients', () => {
    it('returns empty array when no keys exist', async () => {
      const results = await service.findAllClients();
      expect(results).toEqual([]);
    });
  });

  describe('deleteClient', () => {
    it('deletes and returns true', async () => {
      expect(await service.deleteClient('c1')).toBe(true);
      expect(mockDel).toHaveBeenCalledWith(
        `${testPrefix}:default:oidc:Client:c1`
      );
    });

    it('returns false when nothing deleted', async () => {
      mockDel.mockResolvedValue(0);
      expect(await service.deleteClient('nonexistent')).toBe(false);
    });
  });

  describe('updateClient', () => {
    it('returns null when client not found', async () => {
      mockGet.mockResolvedValue(null);
      expect(
        await service.updateClient('nonexistent', { client_name: 'X' })
      ).toBeNull();
    });

    it('merges updates and stores back', async () => {
      mockGet.mockResolvedValue(
        JSON.stringify({
          client_id: 'c1',
          client_name: 'Old',
          application_type: 'web',
        })
      );
      const result = await service.updateClient('c1', {
        client_name: 'New Name',
      });
      expect(result).not.toBeNull();
      expect(result!.client_name).toBe('New Name');
      expect(mockSet).toHaveBeenCalled();
    });
  });

  describe('utility methods', () => {
    it('generateClientId returns a UUID', () => {
      expect(service.generateClientId()).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it('generateClientSecret returns a 64-char hex string', () => {
      expect(service.generateClientSecret()).toHaveLength(64);
    });
  });
});
