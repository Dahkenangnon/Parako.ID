/**
 * TDD — MongodbOidcAdminService
 * Validates the consolidated MongoDB OIDC admin service that replaces
 * the 14 per-model per-file adapter classes.
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
import { MongodbOidcAdminService } from '../../../../../src/oidc/adapter/mongodb/admin-service.js';
import type { ILogger } from '../../../../../src/di/interfaces/logger.interface.js';
import type { Db } from 'mongodb';

// Mock tenantContext so client CRUD picks up a deterministic tenant_id
vi.mock('../../../../../src/multi-tenancy/tenant-context.js', () => ({
  tenantContext: { getTenantId: () => 'default' },
}));

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

const mockDb = {} as Db;

function makeMockColl() {
  return {
    find: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    }),
    findOne: vi.fn().mockResolvedValue(null),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    countDocuments: vi.fn().mockResolvedValue(0),
    distinct: vi.fn().mockResolvedValue([]),
    aggregate: vi
      .fn()
      .mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    insertOne: vi.fn().mockResolvedValue({}),
    updateOne: vi.fn().mockResolvedValue({}),
    findOneAndUpdate: vi.fn().mockResolvedValue(null),
    estimatedDocumentCount: vi.fn().mockResolvedValue(0),
    createIndexes: vi.fn().mockResolvedValue([]),
  };
}

// ─── Session model ─────────────────────────────────────────────────────────

describe('MongodbOidcAdminService — Session model', () => {
  let service: MongodbOidcAdminService;
  let mockColl: ReturnType<typeof makeMockColl>;

  beforeEach(() => {
    mockColl = makeMockColl();
    service = new MongodbOidcAdminService('Session', mockDb, logger);
    vi.spyOn(service, 'coll').mockReturnValue(mockColl as any);
  });

  it('findByAccountId queries active sessions for the account', async () => {
    mockColl.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: 's1', payload: { accountId: 'u1' } }]),
    });
    const results = await service.findByAccountId('u1');
    expect(mockColl.find).toHaveBeenCalledWith(
      expect.objectContaining({
        'payload.accountId': 'u1',
        'payload.kind': 'Session',
      })
    );
    expect(results).toHaveLength(1);
  });

  it('revokeSession deletes the session matching the jti and returns true', async () => {
    mockColl.deleteOne.mockResolvedValue({ deletedCount: 1 });
    const ok = await service.revokeSession('jti-abc');
    expect(mockColl.deleteOne).toHaveBeenCalledWith({
      'payload.jti': 'jti-abc',
    });
    expect(ok).toBe(true);
  });

  it('revokeSession returns false when nothing deleted', async () => {
    mockColl.deleteOne.mockResolvedValue({ deletedCount: 0 });
    expect(await service.revokeSession('jti-nope')).toBe(false);
  });

  it('deleteSessionsByAccountId removes all sessions for the account', async () => {
    mockColl.deleteMany.mockResolvedValue({ deletedCount: 3 });
    const result = await service.deleteSessionsByAccountId('u1');
    expect(result.deletedCount).toBe(3);
    expect(mockColl.deleteMany).toHaveBeenCalledWith({
      'payload.accountId': 'u1',
    });
  });
});

// ─── Grant model ───────────────────────────────────────────────────────────

describe('MongodbOidcAdminService — Grant model', () => {
  let service: MongodbOidcAdminService;
  let mockColl: ReturnType<typeof makeMockColl>;

  beforeEach(() => {
    mockColl = makeMockColl();
    service = new MongodbOidcAdminService('Grant', mockDb, logger);
    vi.spyOn(service, 'coll').mockReturnValue(mockColl as any);
  });

  it('findGrantsByAccountId returns grants for the account', async () => {
    mockColl.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: 'g1', payload: { accountId: 'u1' } }]),
    });
    const results = await service.findGrantsByAccountId('u1');
    expect(mockColl.find).toHaveBeenCalledWith(
      expect.objectContaining({ 'payload.accountId': 'u1' }),
      expect.anything()
    );
    expect(results).toHaveLength(1);
  });

  it('revokeGrantById deletes the grant by id', async () => {
    mockColl.deleteOne.mockResolvedValue({ deletedCount: 1 });
    await service.revokeGrantById('grant-xyz');
    expect(mockColl.deleteOne).toHaveBeenCalledWith({ _id: 'grant-xyz' });
  });

  it('deleteGrantsByAccountId removes all grants for the account', async () => {
    mockColl.deleteMany.mockResolvedValue({ deletedCount: 2 });
    const result = await service.deleteGrantsByAccountId('u1');
    expect(result.deletedCount).toBe(2);
  });
});

// ─── AccessToken / RefreshToken / Interaction (deleteByAccountId) ──────────

describe.each([
  ['AccessToken', 'payload.accountId'],
  ['RefreshToken', 'payload.accountId'],
  ['Interaction', 'payload.session.accountId'],
] as const)(
  'MongodbOidcAdminService — %s model deleteByAccountId',
  (model, expectedField) => {
    let service: MongodbOidcAdminService;
    let mockColl: ReturnType<typeof makeMockColl>;

    beforeEach(() => {
      mockColl = makeMockColl();
      service = new MongodbOidcAdminService(model, mockDb, logger);
      vi.spyOn(service, 'coll').mockReturnValue(mockColl as any);
    });

    it(`deleteByAccountId deletes ${model}s for the account`, async () => {
      mockColl.deleteMany.mockResolvedValue({ deletedCount: 2 });
      const result = await service.deleteByAccountId('u1');
      expect(result.deletedCount).toBe(2);
      expect(mockColl.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ [expectedField]: 'u1' })
      );
    });
  }
);

// ─── Client CRUD (IAdapterClientService) ──────────────────────────────────

describe('MongodbOidcAdminService — Client CRUD', () => {
  let service: MongodbOidcAdminService;
  let mockColl: ReturnType<typeof makeMockColl>;

  beforeEach(() => {
    mockColl = makeMockColl();
    service = new MongodbOidcAdminService('Client', mockDb, logger);
    vi.spyOn(service, 'coll').mockReturnValue(mockColl as any);
  });

  describe('createClient', () => {
    it('checks existence then inserts new client', async () => {
      mockColl.findOne.mockResolvedValue(null);
      mockColl.insertOne = vi.fn().mockResolvedValue({});

      const client = await service.createClient({
        client_name: 'Test App',
        redirect_uris: ['https://app.example.com/cb'],
      });
      expect(client.client_id).toBeTruthy();
      expect(client.client_name).toBe('Test App');
      expect(client.client_secret).toBeTruthy();
      expect(client.active).toBe(true);
      expect(mockColl.findOne).toHaveBeenCalledWith({
        _id: client.client_id,
        tenant_id: 'default',
      });
      expect(mockColl.insertOne).toHaveBeenCalledWith({
        _id: client.client_id,
        payload: expect.objectContaining({ client_name: 'Test App' }),
        tenant_id: 'default',
      });
    });

    it('throws when client already exists', async () => {
      mockColl.findOne.mockResolvedValue({
        _id: 'existing-id',
        payload: { client_id: 'existing-id' },
      });

      await expect(
        service.createClient({
          client_id: 'existing-id',
          client_name: 'Duplicate',
          redirect_uris: ['https://app.example.com/cb'],
        })
      ).rejects.toThrow('already exists');
    });

    it('rejects invalid client data', async () => {
      await expect(
        service.createClient({ application_type: 'invalid' as any })
      ).rejects.toThrow('Client validation failed');
    });
  });

  describe('findClientById', () => {
    it('returns OidcClientData when found', async () => {
      mockColl.findOne.mockResolvedValue({
        _id: 'c1',
        payload: {
          client_id: 'c1',
          client_name: 'App',
          application_type: 'web',
        },
      });
      const result = await service.findClientById('c1');
      expect(result).not.toBeNull();
      expect(result!.client_id).toBe('c1');
      expect(result!.client_name).toBe('App');
    });

    it('returns null when not found', async () => {
      mockColl.findOne.mockResolvedValue(null);
      expect(await service.findClientById('nonexistent')).toBeNull();
    });
  });

  describe('findAllClients', () => {
    it('returns all clients as OidcClientData[]', async () => {
      mockColl.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: 'c1',
            payload: {
              client_id: 'c1',
              client_name: 'A',
              application_type: 'web',
              active: true,
            },
          },
          {
            _id: 'c2',
            payload: {
              client_id: 'c2',
              client_name: 'B',
              application_type: 'spa',
              active: false,
            },
          },
        ]),
      });
      const results = await service.findAllClients();
      expect(results).toHaveLength(2);
      expect(results[0].client_id).toBe('c1');
      expect(results[1].client_id).toBe('c2');
    });

    it('applies filters', async () => {
      mockColl.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: 'c1',
            payload: {
              client_id: 'c1',
              client_name: 'A',
              application_type: 'web',
              active: true,
            },
          },
          {
            _id: 'c2',
            payload: {
              client_id: 'c2',
              client_name: 'B',
              application_type: 'spa',
              active: false,
            },
          },
        ]),
      });
      const results = await service.findAllClients({ active: true });
      expect(results).toHaveLength(1);
      expect(results[0].client_id).toBe('c1');
    });
  });

  describe('updateClient', () => {
    it('updates and returns the merged client directly', async () => {
      mockColl.findOne.mockResolvedValueOnce({
        _id: 'c1',
        payload: {
          client_id: 'c1',
          client_name: 'Old Name',
          application_type: 'web',
          active: true,
        },
      });

      const result = await service.updateClient('c1', {
        client_name: 'New Name',
      });
      expect(result).not.toBeNull();
      expect(result!.client_name).toBe('New Name');
      expect(result!.client_id).toBe('c1');
      expect(result!.application_type).toBe('web');
      expect(mockColl.updateOne).toHaveBeenCalledWith(
        { _id: 'c1', tenant_id: 'default' },
        {
          $set: {
            payload: expect.objectContaining({ client_name: 'New Name' }),
            tenant_id: 'default',
          },
        },
        { upsert: true }
      );
    });

    it('returns null when client not found', async () => {
      mockColl.findOne.mockResolvedValue(null);
      expect(
        await service.updateClient('nonexistent', { client_name: 'X' })
      ).toBeNull();
    });
  });

  describe('deleteClient', () => {
    it('deletes and returns true', async () => {
      mockColl.deleteOne.mockResolvedValue({ deletedCount: 1 });
      expect(await service.deleteClient('c1')).toBe(true);
      expect(mockColl.deleteOne).toHaveBeenCalledWith({
        _id: 'c1',
        tenant_id: 'default',
      });
    });

    it('returns false when nothing deleted', async () => {
      mockColl.deleteOne.mockResolvedValue({ deletedCount: 0 });
      expect(await service.deleteClient('nonexistent')).toBe(false);
    });
  });

  describe('searchClients', () => {
    it('searches by name and ID', async () => {
      mockColl.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: 'my-app',
            payload: {
              client_id: 'my-app',
              client_name: 'Dashboard',
              application_type: 'web',
            },
          },
          {
            _id: 'other',
            payload: {
              client_id: 'other',
              client_name: 'API',
              application_type: 'web',
            },
          },
        ]),
      });
      const results = await service.searchClients('dash');
      expect(results).toHaveLength(1);
      expect(results[0].client_name).toBe('Dashboard');
    });
  });

  describe('activateClient / deactivateClient', () => {
    it('activateClient sets active=true', async () => {
      mockColl.findOne.mockResolvedValueOnce({
        _id: 'c1',
        payload: { client_id: 'c1', client_name: 'A', active: false },
      });

      const result = await service.activateClient('c1');
      expect(result).not.toBeNull();
      expect(result!.active).toBe(true);
    });

    it('deactivateClient sets active=false', async () => {
      mockColl.findOne.mockResolvedValueOnce({
        _id: 'c1',
        payload: { client_id: 'c1', client_name: 'A', active: true },
      });

      const result = await service.deactivateClient('c1');
      expect(result).not.toBeNull();
      expect(result!.active).toBe(false);
    });
  });

  describe('regenerateClientSecret', () => {
    it('returns new secret and updated client', async () => {
      const clientPayload = {
        client_id: 'c1',
        client_name: 'A',
        client_secret: 'old-secret',
      };
      // 1st: regenerateClientSecret → findClientById
      // 2nd: updateClient → findClientById (check exists)
      mockColl.findOne
        .mockResolvedValueOnce({ _id: 'c1', payload: clientPayload })
        .mockResolvedValueOnce({ _id: 'c1', payload: clientPayload });

      const result = await service.regenerateClientSecret('c1');
      expect(result).not.toBeNull();
      expect(result!.newSecret).toBeTruthy();
      expect(result!.newSecret).toHaveLength(64);
    });

    it('returns null when client not found', async () => {
      mockColl.findOne.mockResolvedValue(null);
      expect(await service.regenerateClientSecret('x')).toBeNull();
    });
  });

  describe('getClientStatistics', () => {
    it('computes statistics from all clients', async () => {
      mockColl.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: 'c1',
            payload: {
              client_id: 'c1',
              client_name: 'A',
              application_type: 'web',
              active: true,
            },
          },
          {
            _id: 'c2',
            payload: {
              client_id: 'c2',
              client_name: 'B',
              application_type: 'spa',
              active: false,
            },
          },
        ]),
      });
      const stats = await service.getClientStatistics();
      expect(stats.total).toBe(2);
      expect(stats.active).toBe(1);
      expect(stats.inactive).toBe(1);
      expect(stats.byType.web).toBe(1);
      expect(stats.byType.spa).toBe(1);
    });
  });

  describe('countClients', () => {
    it('returns count of all client documents', async () => {
      mockColl.countDocuments.mockResolvedValue(5);
      expect(await service.countClients()).toBe(5);
    });
  });

  describe('utility methods', () => {
    it('generateClientId returns a UUID', () => {
      const id = service.generateClientId();
      expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it('generateClientSecret returns a 64-char hex string', () => {
      const secret = service.generateClientSecret();
      expect(secret).toHaveLength(64);
    });
  });
});
