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

const getTenantId = vi.hoisted(() => vi.fn(() => 'default'));

// Mock tenantContext so client CRUD picks up a deterministic tenant_id
vi.mock('../../../../../src/multi-tenancy/tenant-context.js', () => ({
  tenantContext: { getTenantId },
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
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  getTenantId.mockReturnValue('default');
});

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
        tenant_id: 'default',
      })
    );
    expect(results).toHaveLength(1);
  });

  it('revokeSession deletes the session matching the jti and returns true', async () => {
    mockColl.deleteOne.mockResolvedValue({ deletedCount: 1 });
    const ok = await service.revokeSession('jti-abc');
    expect(mockColl.deleteOne).toHaveBeenCalledWith({
      'payload.jti': 'jti-abc',
      tenant_id: 'default',
    });
    expect(ok).toBe(true);
  });

  it('revokeSession returns false when nothing deleted', async () => {
    mockColl.deleteOne.mockResolvedValue({ deletedCount: 0 });
    expect(await service.revokeSession('jti-nope')).toBe(false);
  });

  it('revokeAllSessionsExcept only deletes current-tenant sessions', async () => {
    mockColl.deleteMany.mockResolvedValue({ deletedCount: 2 });

    await expect(
      service.revokeAllSessionsExcept('u1', 'current-jti')
    ).resolves.toBe(2);
    expect(mockColl.deleteMany).toHaveBeenCalledWith({
      'payload.accountId': 'u1',
      'payload.kind': 'Session',
      'payload.jti': { $ne: 'current-jti' },
      tenant_id: 'default',
    });
  });

  it('deleteSessionsByAccountId removes all sessions for the account', async () => {
    mockColl.deleteMany.mockResolvedValue({ deletedCount: 3 });
    const result = await service.deleteSessionsByAccountId('u1');
    expect(result.deletedCount).toBe(3);
    expect(mockColl.deleteMany).toHaveBeenCalledWith({
      'payload.accountId': 'u1',
      tenant_id: 'default',
    });
  });

  it('computes session statistics within the current tenant', async () => {
    mockColl.countDocuments
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2);

    await expect(service.getSessionStatistics()).resolves.toEqual({
      total: 5,
      active: 3,
      expired: 2,
    });
    expect(mockColl.countDocuments).toHaveBeenCalledTimes(3);
    for (const [filter] of mockColl.countDocuments.mock.calls) {
      expect(filter).toEqual(expect.objectContaining({ tenant_id: 'default' }));
    }
  });

  it('counts filtered sessions within the current tenant', async () => {
    mockColl.countDocuments.mockResolvedValueOnce(4);

    await expect(
      service.countSessions({ 'payload.clientId': 'client-1' })
    ).resolves.toBe(4);
    expect(mockColl.countDocuments).toHaveBeenCalledWith({
      'payload.clientId': 'client-1',
      tenant_id: 'default',
    });
  });

  it('paginates current-tenant sessions with a safe sort field', async () => {
    await service.findSessionsWithPagination({}, '$unsafe', 1, 3, 8);

    expect(mockColl.find).toHaveBeenCalledWith({ tenant_id: 'default' });
    const cursor = mockColl.find.mock.results[0].value;
    expect(cursor.sort).toHaveBeenCalledWith({ createdAt: 1 });
    expect(cursor.skip).toHaveBeenCalledWith(3);
    expect(cursor.limit).toHaveBeenCalledWith(8);
  });

  it('finds a session by JTI within the current tenant', async () => {
    const document = { _id: 'physical-id', payload: { jti: 'jti-1' } };
    mockColl.findOne.mockResolvedValueOnce(document);

    await expect(service.findSessionById('jti-1')).resolves.toBe(document);
    expect(mockColl.findOne).toHaveBeenCalledWith({
      'payload.jti': 'jti-1',
      tenant_id: 'default',
    });
  });

  it('gets distinct current-tenant session values', async () => {
    mockColl.distinct.mockResolvedValueOnce(['client-1']);

    await expect(
      service.getDistinctValues('payload.clientId', {
        'payload.kind': 'Session',
      })
    ).resolves.toEqual(['client-1']);
    expect(mockColl.distinct).toHaveBeenCalledWith('payload.clientId', {
      'payload.kind': 'Session',
      tenant_id: 'default',
    });
  });

  it('exports only current-tenant sessions', async () => {
    await service.exportAllSessions();

    expect(mockColl.find).toHaveBeenCalledWith({
      'payload.kind': 'Session',
      tenant_id: 'default',
    });
    const cursor = mockColl.find.mock.results[0].value;
    expect(cursor.sort).toHaveBeenCalledWith({ 'payload.iat': -1 });
  });

  it('deletes selected current-tenant sessions by logical ID', async () => {
    mockColl.deleteMany.mockResolvedValueOnce({ deletedCount: 2 });

    await expect(
      service.deleteSessionsByIds(['session-1', 'session-2'])
    ).resolves.toEqual({ deletedCount: 2 });
    expect(mockColl.deleteMany).toHaveBeenCalledWith({
      _id: { $in: ['session-1', 'session-2'] },
      tenant_id: 'default',
    });
  });

  it('does not query MongoDB when no session IDs are selected', async () => {
    await expect(service.deleteSessionsByIds([])).resolves.toEqual({
      deletedCount: 0,
    });
    expect(mockColl.deleteMany).not.toHaveBeenCalled();
  });

  it('normalizes null session results and missing deletion counts', async () => {
    mockColl.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(null),
    });
    mockColl.deleteMany.mockResolvedValue({});

    await expect(service.findByAccountId('u1')).resolves.toEqual([]);
    await expect(service.deleteSessionsByAccountId('u1')).resolves.toEqual({
      deletedCount: 0,
    });
    await expect(service.deleteSessionsByIds(['session-1'])).resolves.toEqual({
      deletedCount: 0,
    });
  });

  it('deletes both scoped and legacy physical IDs for a non-default tenant', async () => {
    getTenantId.mockReturnValue('tenant-b');

    await service.deleteSessionsByIds(['session-1']);

    expect(mockColl.deleteMany).toHaveBeenCalledWith({
      _id: { $in: ['8:tenant-b:session-1', 'session-1'] },
      tenant_id: 'tenant-b',
    });
  });

  it.each([
    {
      operation: 'findByAccountId',
      boundary: 'find',
      args: ['u1'],
      fallback: [],
      context: 'Error finding sessions by account ID',
    },
    {
      operation: 'revokeSession',
      boundary: 'deleteOne',
      args: ['jti-1'],
      fallback: false,
      context: 'Error revoking session',
    },
    {
      operation: 'revokeAllSessionsExcept',
      boundary: 'deleteMany',
      args: ['u1', 'jti-1'],
      fallback: 0,
      context: 'Error revoking all sessions except current',
    },
    {
      operation: 'getSessionStatistics',
      boundary: 'countDocuments',
      args: [],
      context: 'Error getting session statistics',
    },
    {
      operation: 'countSessions',
      boundary: 'countDocuments',
      args: [],
      context: 'Error counting sessions',
    },
    {
      operation: 'findSessionsWithPagination',
      boundary: 'find',
      args: [],
      context: 'Error finding sessions with pagination',
    },
    {
      operation: 'findSessionById',
      boundary: 'findOne',
      args: ['jti-1'],
      context: 'Error finding session by ID jti-1',
    },
    {
      operation: 'getDistinctValues',
      boundary: 'distinct',
      args: ['payload.clientId'],
      context: 'Error getting distinct values for field payload.clientId',
    },
    {
      operation: 'exportAllSessions',
      boundary: 'find',
      args: [],
      context: 'Error exporting all sessions',
    },
    {
      operation: 'deleteSessionsByAccountId',
      boundary: 'deleteMany',
      args: ['u1'],
      context: 'Error deleting sessions for account u1',
    },
    {
      operation: 'deleteSessionsByIds',
      boundary: 'deleteMany',
      args: [['session-1']],
      context: 'Error deleting multiple sessions',
    },
  ])(
    'handles $operation MongoDB failures according to its public contract',
    async ({ operation, boundary, args, context, ...expectation }) => {
      const storageError = new Error(`${operation} failed`);
      const boundaryMethod = mockColl[
        boundary as keyof typeof mockColl
      ] as ReturnType<typeof vi.fn>;
      boundaryMethod.mockImplementationOnce(() => {
        throw storageError;
      });
      const operationMethod = service[
        operation as keyof MongodbOidcAdminService
      ] as unknown as (...parameters: unknown[]) => Promise<unknown>;

      if ('fallback' in expectation) {
        await expect(operationMethod.apply(service, args)).resolves.toEqual(
          expectation.fallback
        );
      } else {
        await expect(operationMethod.apply(service, args)).rejects.toBe(
          storageError
        );
      }
      expect(logger.error).toHaveBeenCalledWith(
        storageError,
        expect.objectContaining({ context })
      );
    }
  );

  it('rejects non-string session identifiers before querying MongoDB', async () => {
    await expect(service.findByAccountId(null as never)).rejects.toThrow(
      'accountId must be a string'
    );
    await expect(service.revokeSession(null as never)).rejects.toThrow(
      'sessionId must be a string'
    );
    expect(mockColl.find).not.toHaveBeenCalled();
    expect(mockColl.deleteOne).not.toHaveBeenCalled();
  });
});

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
      expect.objectContaining({
        'payload.accountId': 'u1',
        tenant_id: 'default',
      }),
      expect.anything()
    );
    expect(results).toHaveLength(1);
  });

  it('finds grants by client within the current tenant', async () => {
    mockColl.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: 'g1', payload: { clientId: 'c1' } }]),
    });

    await expect(service.findGrantsByClientId('c1')).resolves.toHaveLength(1);
    expect(mockColl.find).toHaveBeenCalledWith(
      { 'payload.clientId': 'c1', tenant_id: 'default' },
      expect.anything()
    );
  });

  it('finds a grant by account and client within the current tenant', async () => {
    const grant = {
      _id: 'g1',
      payload: { accountId: 'u1', clientId: 'c1' },
    };
    mockColl.findOne.mockResolvedValueOnce(grant);

    await expect(service.findGrantByAccountAndClient('u1', 'c1')).resolves.toBe(
      grant
    );
    expect(mockColl.findOne).toHaveBeenCalledWith(
      {
        'payload.accountId': 'u1',
        'payload.clientId': 'c1',
        tenant_id: 'default',
      },
      expect.anything()
    );
  });

  it('short-circuits empty grant lookup identifiers', async () => {
    await expect(service.findGrantsByAccountId('')).resolves.toEqual([]);
    await expect(service.findGrantsByClientId('')).resolves.toEqual([]);
    await expect(
      service.findGrantByAccountAndClient('', 'c1')
    ).resolves.toBeNull();
    await expect(service.revokeGrantById('')).resolves.toBeUndefined();
    expect(mockColl.find).not.toHaveBeenCalled();
    expect(mockColl.findOne).not.toHaveBeenCalled();
    expect(mockColl.deleteOne).not.toHaveBeenCalled();
  });

  it('revokeGrantById deletes the grant by id', async () => {
    mockColl.deleteOne.mockResolvedValue({ deletedCount: 1 });
    await service.revokeGrantById('grant-xyz');
    expect(mockColl.deleteOne).toHaveBeenCalledWith({
      _id: 'grant-xyz',
      tenant_id: 'default',
    });
  });

  it('deleteGrantsByAccountId removes all grants for the account', async () => {
    mockColl.deleteMany.mockResolvedValue({ deletedCount: 2 });
    const result = await service.deleteGrantsByAccountId('u1');
    expect(result.deletedCount).toBe(2);
    expect(mockColl.deleteMany).toHaveBeenCalledWith({
      'payload.accountId': 'u1',
      tenant_id: 'default',
    });
  });

  it('revokes every current-tenant grant for an account', async () => {
    mockColl.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: 'g1', payload: { jti: 'grant-1' } },
        { _id: 'g2', payload: { jti: 'grant-2' } },
      ]),
    });
    const revoke = vi.spyOn(service, 'revokeByGrantId').mockResolvedValue();

    await expect(service.revokeAllGrantsForAccount('u1')).resolves.toBe(2);
    expect(mockColl.find).toHaveBeenCalledWith({
      'payload.accountId': 'u1',
      tenant_id: 'default',
    });
    expect(revoke).toHaveBeenCalledTimes(2);
  });

  it('revokes every current-tenant grant for a client', async () => {
    mockColl.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: 'g1', payload: { jti: 'grant-1' } }]),
    });
    const revoke = vi.spyOn(service, 'revokeByGrantId').mockResolvedValue();

    await expect(service.revokeAllGrantsForClient('c1')).resolves.toBe(1);
    expect(mockColl.find).toHaveBeenCalledWith({
      'payload.clientId': 'c1',
      tenant_id: 'default',
    });
    expect(revoke).toHaveBeenCalledWith('grant-1');
  });

  it('revokes current-tenant grants for an account and client', async () => {
    mockColl.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: 'g1', payload: { jti: 'grant-1' } }]),
    });
    vi.spyOn(service, 'revokeByGrantId').mockResolvedValue();

    await expect(
      service.revokeGrantByAccountAndClient('u1', 'c1')
    ).resolves.toBe(true);
    expect(mockColl.find).toHaveBeenCalledWith({
      'payload.accountId': 'u1',
      'payload.clientId': 'c1',
      tenant_id: 'default',
    });
  });

  it('finds a grant by logical ID within the current tenant', async () => {
    const grant = { _id: 'g1', payload: { jti: 'grant-1' } };
    mockColl.findOne.mockResolvedValueOnce(grant);

    await expect(service.findGrantById('g1')).resolves.toBe(grant);
    expect(mockColl.findOne).toHaveBeenCalledWith({
      _id: 'g1',
      tenant_id: 'default',
    });
  });

  it('computes grant statistics within the current tenant', async () => {
    mockColl.countDocuments
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2);

    await expect(service.getGrantStatistics()).resolves.toEqual({
      total: 5,
      recent: 3,
      expired: 2,
      byClient: [],
      byUser: [],
    });
    for (const [filter] of mockColl.countDocuments.mock.calls) {
      expect(filter).toEqual(expect.objectContaining({ tenant_id: 'default' }));
    }
    for (const [pipeline] of mockColl.aggregate.mock.calls) {
      expect(pipeline[0]).toEqual({ $match: { tenant_id: 'default' } });
    }
  });

  it('exports only current-tenant grants', async () => {
    await service.exportAllGrants();

    expect(mockColl.find).toHaveBeenCalledWith({ tenant_id: 'default' });
  });

  it('returns safe results when no grant can be selected or revoked', async () => {
    mockColl.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    mockColl.findOne.mockResolvedValueOnce(null);
    mockColl.deleteOne.mockResolvedValueOnce({ deletedCount: 0 });

    await expect(
      service.findGrantByAccountAndClient('u1', 'c1')
    ).resolves.toBeNull();
    await expect(service.revokeGrantById('missing')).resolves.toBeUndefined();
    await expect(service.revokeAllGrantsForAccount('u1')).resolves.toBe(0);
    await expect(service.revokeAllGrantsForClient('c1')).resolves.toBe(0);
    await expect(
      service.revokeGrantByAccountAndClient('u1', 'c1')
    ).resolves.toBe(false);
  });

  it('short-circuits empty bulk-revocation identifiers', async () => {
    await expect(service.revokeAllGrantsForAccount('')).resolves.toBe(0);
    await expect(service.revokeAllGrantsForClient('')).resolves.toBe(0);
    await expect(service.revokeGrantByAccountAndClient('', 'c1')).resolves.toBe(
      false
    );
    expect(mockColl.find).not.toHaveBeenCalled();
  });

  it('continues bulk account revocation after malformed and failed grants', async () => {
    mockColl.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: 'missing-jti', payload: {} },
        { _id: 'failed', payload: { jti: 'grant-failed' } },
      ]),
    });
    vi.spyOn(service, 'revokeByGrantId').mockRejectedValueOnce(
      new Error('revoke failed')
    );

    await expect(service.revokeAllGrantsForAccount('u1')).resolves.toBe(0);
  });

  it('continues bulk client revocation after malformed and failed grants', async () => {
    mockColl.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: 'missing-jti', payload: {} },
        { _id: 'failed', payload: { jti: 'grant-failed' } },
      ]),
    });
    vi.spyOn(service, 'revokeByGrantId').mockRejectedValueOnce(
      new Error('revoke failed')
    );

    await expect(service.revokeAllGrantsForClient('c1')).resolves.toBe(0);
  });

  it('reports false when account-client grants cannot be revoked', async () => {
    mockColl.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: 'missing-jti', payload: {} },
        { _id: 'failed', payload: { jti: 'grant-failed' } },
      ]),
    });
    vi.spyOn(service, 'revokeByGrantId').mockRejectedValueOnce(
      new Error('revoke failed')
    );

    await expect(
      service.revokeGrantByAccountAndClient('u1', 'c1')
    ).resolves.toBe(false);
  });

  it.each([
    {
      operation: 'findGrantsByAccountId',
      boundary: 'find',
      args: ['u1'],
      context: 'Error finding grants for account u1',
    },
    {
      operation: 'findGrantsByClientId',
      boundary: 'find',
      args: ['c1'],
      context: 'Error finding grants for client c1',
    },
    {
      operation: 'findGrantByAccountAndClient',
      boundary: 'findOne',
      args: ['u1', 'c1'],
      context: 'Error finding grant for account u1 and client c1',
    },
    {
      operation: 'revokeGrantById',
      boundary: 'deleteOne',
      args: ['g1'],
      context: 'Error revoking grant g1',
    },
    {
      operation: 'revokeAllGrantsForAccount',
      boundary: 'find',
      args: ['u1'],
      context: 'Error revoking all grants for account u1',
    },
    {
      operation: 'revokeAllGrantsForClient',
      boundary: 'find',
      args: ['c1'],
      context: 'Error revoking all grants for client c1',
    },
    {
      operation: 'revokeGrantByAccountAndClient',
      boundary: 'find',
      args: ['u1', 'c1'],
      context: 'Error revoking grants for account u1 and client c1',
    },
    {
      operation: 'countGrants',
      boundary: 'countDocuments',
      args: [],
      context: 'Error counting grants',
    },
    {
      operation: 'findGrantsWithPagination',
      boundary: 'find',
      args: [],
      context: 'Error finding grants with pagination',
    },
    {
      operation: 'findGrantById',
      boundary: 'findOne',
      args: ['g1'],
      context: 'Error finding grant by ID g1',
    },
    {
      operation: 'getGrantStatistics',
      boundary: 'countDocuments',
      args: [],
      context: 'Error getting grant statistics',
    },
    {
      operation: 'exportAllGrants',
      boundary: 'find',
      args: [],
      context: 'Error exporting all grants',
    },
    {
      operation: 'deleteGrantsByAccountId',
      boundary: 'deleteMany',
      args: ['u1'],
      context: 'Error deleting grants for account u1',
    },
    {
      operation: 'deleteByAccountId',
      boundary: 'deleteMany',
      args: ['u1'],
      context: 'Error deleting Grants for account u1',
    },
  ])(
    'logs and rethrows $operation MongoDB failures',
    async ({ operation, boundary, args, context }) => {
      const storageError = new Error(`${operation} failed`);
      const boundaryMethod = mockColl[
        boundary as keyof typeof mockColl
      ] as ReturnType<typeof vi.fn>;
      boundaryMethod.mockImplementationOnce(() => {
        throw storageError;
      });
      const operationMethod = service[
        operation as keyof MongodbOidcAdminService
      ] as unknown as (...parameters: unknown[]) => Promise<unknown>;

      await expect(operationMethod.apply(service, args)).rejects.toBe(
        storageError
      );
      expect(logger.error).toHaveBeenCalledWith(
        storageError,
        expect.objectContaining({ context })
      );
    }
  );

  it('rejects non-string grant deletion identifiers', async () => {
    await expect(
      service.deleteGrantsByAccountId(null as never)
    ).rejects.toThrow('accountId must be a string');
    await expect(service.deleteByAccountId(null as never)).rejects.toThrow(
      'accountId must be a string'
    );
    expect(mockColl.deleteMany).not.toHaveBeenCalled();
  });

  it('normalizes missing grant deletion counts', async () => {
    mockColl.deleteMany.mockResolvedValue({});

    await expect(service.deleteGrantsByAccountId('u1')).resolves.toEqual({
      deletedCount: 0,
    });
    await expect(service.deleteByAccountId('u1')).resolves.toEqual({
      deletedCount: 0,
    });
  });

  it('passes portable literal-search and exact filters to MongoDB unchanged', async () => {
    const filters = {
      'payload.clientId': 'client-1',
      $or: [
        { 'payload.accountId': { $regex: 'a\\+b', $options: 'i' } },
        { 'payload.clientId': { $regex: 'a\\+b', $options: 'i' } },
      ],
    };

    await service.countGrants(filters);

    expect(mockColl.countDocuments).toHaveBeenCalledWith({
      ...filters,
      tenant_id: 'default',
    });
  });

  it.each([
    ['created_at', 'payload.iat'],
    ['payload.iat', 'payload.iat'],
    ['payload.accountId', 'payload.accountId'],
    ['payload.clientId', 'payload.clientId'],
    ['payload.exp', 'payload.exp'],
    ['unknown', 'payload.iat'],
  ])(
    'maps public grant sort field %s to MongoDB field %s',
    async (sortBy, field) => {
      await service.findGrantsWithPagination({}, sortBy, 1, 4, 10);

      expect(mockColl.find).toHaveBeenCalledWith({ tenant_id: 'default' });
      const cursor = mockColl.find.mock.results[0].value;
      expect(cursor.sort).toHaveBeenCalledWith({ [field]: 1 });
      expect(cursor.skip).toHaveBeenCalledWith(4);
      expect(cursor.limit).toHaveBeenCalledWith(10);
    }
  );
});

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
        expect.objectContaining({
          [expectedField]: 'u1',
          tenant_id: 'default',
        })
      );
    });
  }
);

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
        logical_id: client.client_id,
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
        { upsert: false }
      );
    });

    it('normalizes a legacy SPA update before persisting provider metadata', async () => {
      mockColl.findOne.mockResolvedValueOnce({
        _id: 'c1',
        payload: {
          client_id: 'c1',
          client_name: 'App',
          application_type: 'web',
        },
      });

      const result = await service.updateClient('c1', {
        application_type: 'spa',
      });

      expect(result).toMatchObject({ application_type: 'web', preset: 'spa' });
      expect(mockColl.updateOne).toHaveBeenCalledWith(
        { _id: 'c1', tenant_id: 'default' },
        {
          $set: {
            payload: expect.objectContaining({
              application_type: 'web',
              preset: 'spa',
            }),
            tenant_id: 'default',
          },
        },
        { upsert: false }
      );
    });

    it('returns null when client not found', async () => {
      mockColl.findOne.mockResolvedValue(null);
      expect(
        await service.updateClient('nonexistent', { client_name: 'X' })
      ).toBeNull();
    });

    it('rejects an update whose merged client metadata is invalid', async () => {
      mockColl.findOne.mockResolvedValueOnce({
        _id: 'c1',
        payload: {
          client_id: 'c1',
          client_name: 'App',
          application_type: 'web',
        },
      });

      await expect(
        service.updateClient('c1', {
          token_endpoint_auth_method: 'private_key_jwt',
        })
      ).rejects.toThrow('Client validation failed');
      expect(mockColl.updateOne).not.toHaveBeenCalled();
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

    it.each(['none', 'private_key_jwt'] as const)(
      'refuses secret regeneration for %s clients',
      async tokenEndpointAuthMethod => {
        mockColl.findOne.mockResolvedValue({
          _id: 'c1',
          payload: {
            client_id: 'c1',
            client_name: 'A',
            token_endpoint_auth_method: tokenEndpointAuthMethod,
          },
        });

        await expect(service.regenerateClientSecret('c1')).rejects.toThrow(
          'does not use secret-based authentication'
        );
        expect(mockColl.updateOne).not.toHaveBeenCalled();
      }
    );
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

  it('uses a tenant-scoped physical ID for non-default tenant clients', async () => {
    getTenantId.mockReturnValue('tenant-b');
    mockColl.findOne.mockResolvedValueOnce(null);

    await service.createClient({
      client_id: 'shared-client',
      client_name: 'Shared client',
      redirect_uris: ['https://client.example/callback'],
    });

    expect(mockColl.findOne).toHaveBeenCalledWith({
      _id: { $in: ['8:tenant-b:shared-client', 'shared-client'] },
      tenant_id: 'tenant-b',
    });
    expect(mockColl.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: '8:tenant-b:shared-client',
        logical_id: 'shared-client',
        tenant_id: 'tenant-b',
      })
    );
  });

  it('falls back to the physical document ID when payload metadata is absent', async () => {
    mockColl.findOne.mockResolvedValueOnce({
      _id: 'legacy-client',
      payload: undefined,
    });

    await expect(
      service.findClientById('legacy-client')
    ).resolves.toMatchObject({ client_id: 'legacy-client' });
  });

  it('returns null when secret regeneration cannot persist the update', async () => {
    vi.spyOn(service, 'findClientById').mockResolvedValueOnce({
      client_id: 'c1',
      client_name: 'Client one',
    } as never);
    vi.spyOn(service, 'updateClient').mockResolvedValueOnce(null);

    await expect(service.regenerateClientSecret('c1')).resolves.toBeNull();
  });

  it.each([
    {
      operation: 'findClientById',
      boundary: 'findOne',
      args: ['c1'],
      fallback: null,
      context: 'Error finding client c1',
    },
    {
      operation: 'findAllClients',
      boundary: 'find',
      args: [],
      fallback: [],
      context: 'Error finding all clients',
    },
    {
      operation: 'updateClient',
      boundary: 'updateOne',
      args: ['c1', { client_name: 'Updated' }],
      fallback: null,
      context: 'Error updating client c1',
    },
    {
      operation: 'deleteClient',
      boundary: 'deleteOne',
      args: ['c1'],
      fallback: false,
      context: 'Error deleting client c1',
    },
    {
      operation: 'searchClients',
      boundary: 'find',
      args: ['client'],
      fallback: [],
      context: 'Error searching clients for "client"',
    },
    {
      operation: 'countClients',
      boundary: 'countDocuments',
      args: [],
      fallback: 0,
      context: 'Error counting clients',
    },
  ])(
    'returns the safe fallback when $operation storage fails',
    async ({ operation, boundary, args, fallback, context }) => {
      const storageError = new Error(`${operation} failed`);
      if (operation === 'updateClient') {
        mockColl.findOne.mockResolvedValueOnce({
          _id: 'c1',
          payload: { client_id: 'c1', client_name: 'Client one' },
        });
      }
      const boundaryMethod = mockColl[
        boundary as keyof typeof mockColl
      ] as ReturnType<typeof vi.fn>;
      boundaryMethod.mockImplementationOnce(() => {
        throw storageError;
      });
      const operationMethod = service[
        operation as keyof MongodbOidcAdminService
      ] as unknown as (...parameters: unknown[]) => Promise<unknown>;

      await expect(operationMethod.apply(service, args)).resolves.toEqual(
        fallback
      );
      expect(logger.error).toHaveBeenCalledWith(
        storageError,
        expect.objectContaining({ context })
      );
    }
  );

  describe('utility methods', () => {
    it('validates client data synchronously', () => {
      expect(
        service.validateClientDataSync({
          client_name: 'Client one',
          redirect_uris: ['https://client.example/callback'],
        })
      ).toMatchObject({ isValid: true, errors: [] });
    });

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
