/**
 * TDD — Tenant-Scoped OIDC Adapters
 *
 * Verifies that each adapter type includes tenant context in operations:
 *
 * MongoDB adapter:
 *   - upsert() includes tenant_id in the $set
 *   - find() filters by tenant_id
 *   - findByUserCode() filters by tenant_id
 *   - findByUid() filters by tenant_id
 *   - destroy() filters by tenant_id
 *   - consume() filters by tenant_id
 *   - revokeByGrantId() filters by tenant_id
 *
 * Redis adapter:
 *   - key() includes tenant_id in format: {prefix}:{tenantId}:{Model}:{id}
 *   - helper keys include tenant_id
 *
 * Prisma adapter:
 *   - upsert() includes tenant_id in create/update data
 *   - find() filters by tenant_id
 *   - findByUserCode() filters by tenant_id
 *   - findByUid() filters by tenant_id
 *   - consume() filters by tenant_id
 *   - destroy() filters by tenant_id
 *   - revokeByGrantId() filters by tenant_id
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { ILogger } from '../../../src/di/interfaces/logger.interface.js';
import {
  tenantContext,
  DEFAULT_TENANT_ID,
} from '../../../src/multi-tenancy/tenant-context.js';

// ─── Shared Mocks ──────────────────────────────────────────────────────────────

function createMockLogger(): ILogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as ILogger;
}

// ─── MongoDB Adapter Tests ──────────────────────────────────────────────────────

describe('MongoDB OIDC Adapter — tenant scoping', () => {
  let adapter: any;
  let mockCollection: any;
  let logger: ILogger;

  beforeEach(async () => {
    logger = createMockLogger();

    mockCollection = {
      updateOne: vi.fn().mockResolvedValue({ acknowledged: true }),
      findOne: vi.fn().mockResolvedValue(null),
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
      findOneAndUpdate: vi.fn().mockResolvedValue(null),
    };

    const mockDb = {
      collection: vi.fn().mockReturnValue(mockCollection),
    };

    // Dynamic import to pick up tenant context
    const { default: OIDCMongoAdapter } =
      await import('../../../src/oidc/adapter/mongodb/index.js');
    adapter = new OIDCMongoAdapter('AccessToken', mockDb as any, logger);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('upsert()', () => {
    it('includes tenant_id in the $set when inside tenant context', async () => {
      const payload = { accountId: 'user-1', grantId: 'grant-1' };

      await tenantContext.run('acme', () =>
        adapter.upsert('tok-1', payload, 3600)
      );

      expect(mockCollection.updateOne).toHaveBeenCalledTimes(1);
      const [filter, update] = mockCollection.updateOne.mock.calls[0];

      // Filter should include tenant_id
      expect(filter).toHaveProperty('tenant_id', 'acme');
      // $set should include tenant_id
      expect(update.$set).toHaveProperty('tenant_id', 'acme');
    });

    it('uses DEFAULT_TENANT_ID when outside tenant context', async () => {
      const payload = { accountId: 'user-1' };

      await adapter.upsert('tok-2', payload, 3600);

      const [filter, update] = mockCollection.updateOne.mock.calls[0];
      expect(filter).toHaveProperty('tenant_id', DEFAULT_TENANT_ID);
      expect(update.$set).toHaveProperty('tenant_id', DEFAULT_TENANT_ID);
    });
  });

  describe('find()', () => {
    it('filters by tenant_id', async () => {
      await tenantContext.run('globex', () => adapter.find('tok-1'));

      expect(mockCollection.findOne).toHaveBeenCalledTimes(1);
      const [filter] = mockCollection.findOne.mock.calls[0];
      expect(filter).toHaveProperty('tenant_id', 'globex');
    });
  });

  describe('findByUserCode()', () => {
    it('filters by tenant_id for DeviceCode model', async () => {
      // Create a DeviceCode adapter
      const { default: OIDCMongoAdapter } =
        await import('../../../src/oidc/adapter/mongodb/index.js');
      const db = { collection: vi.fn().mockReturnValue(mockCollection) };
      const dcAdapter = new OIDCMongoAdapter('DeviceCode', db as any, logger);

      await tenantContext.run('acme', () =>
        dcAdapter.findByUserCode('USER-CODE-123')
      );

      expect(mockCollection.findOne).toHaveBeenCalledTimes(1);
      const [filter] = mockCollection.findOne.mock.calls[0];
      expect(filter).toHaveProperty('tenant_id', 'acme');
    });
  });

  describe('findByUid()', () => {
    it('filters by tenant_id for Session model', async () => {
      const { default: OIDCMongoAdapter } =
        await import('../../../src/oidc/adapter/mongodb/index.js');
      const db = { collection: vi.fn().mockReturnValue(mockCollection) };
      const sessionAdapter = new OIDCMongoAdapter('Session', db as any, logger);

      await tenantContext.run('acme', () =>
        sessionAdapter.findByUid('uid-abc')
      );

      expect(mockCollection.findOne).toHaveBeenCalledTimes(1);
      const [filter] = mockCollection.findOne.mock.calls[0];
      expect(filter).toHaveProperty('tenant_id', 'acme');
    });
  });

  describe('destroy()', () => {
    it('filters by tenant_id', async () => {
      await tenantContext.run('acme', () => adapter.destroy('tok-1'));

      expect(mockCollection.deleteOne).toHaveBeenCalledTimes(1);
      const [filter] = mockCollection.deleteOne.mock.calls[0];
      expect(filter).toHaveProperty('tenant_id', 'acme');
    });
  });

  describe('consume()', () => {
    it('filters by tenant_id', async () => {
      await tenantContext.run('acme', () => adapter.consume('tok-1'));

      expect(mockCollection.findOneAndUpdate).toHaveBeenCalledTimes(1);
      const [filter] = mockCollection.findOneAndUpdate.mock.calls[0];
      expect(filter).toHaveProperty('tenant_id', 'acme');
    });
  });

  describe('revokeByGrantId()', () => {
    it('filters by tenant_id', async () => {
      await tenantContext.run('acme', () => adapter.revokeByGrantId('grant-1'));

      expect(mockCollection.deleteMany).toHaveBeenCalledTimes(1);
      const [filter] = mockCollection.deleteMany.mock.calls[0];
      expect(filter).toHaveProperty('tenant_id', 'acme');
    });
  });

  describe('countAll()', () => {
    it('filters by tenant_id (not estimatedDocumentCount)', async () => {
      mockCollection.countDocuments = vi.fn().mockResolvedValue(3);

      const count = await tenantContext.run('acme', () => adapter.countAll());

      expect(mockCollection.countDocuments).toHaveBeenCalledWith({
        tenant_id: 'acme',
      });
      expect(count).toBe(3);
    });
  });

  describe('extendModel()', () => {
    it('filters by tenant_id', async () => {
      await tenantContext.run('acme', () =>
        adapter.extendModel('tok-1', { custom: 'data' })
      );

      expect(mockCollection.findOneAndUpdate).toHaveBeenCalledTimes(1);
      const [filter] = mockCollection.findOneAndUpdate.mock.calls[0];
      expect(filter).toHaveProperty('tenant_id', 'acme');
    });
  });

  describe('findByCustomField()', () => {
    it('filters by tenant_id', async () => {
      mockCollection.find = vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      });

      await tenantContext.run('acme', () =>
        adapter.findByCustomField('category', 'premium')
      );

      expect(mockCollection.find).toHaveBeenCalledTimes(1);
      const [filter] = mockCollection.find.mock.calls[0];
      expect(filter).toHaveProperty('tenant_id', 'acme');
    });
  });

  describe('cross-tenant isolation', () => {
    it('different tenants produce different filters on find()', async () => {
      await tenantContext.run('acme', () => adapter.find('tok-shared'));
      await tenantContext.run('globex', () => adapter.find('tok-shared'));

      const [filter1] = mockCollection.findOne.mock.calls[0];
      const [filter2] = mockCollection.findOne.mock.calls[1];

      expect(filter1.tenant_id).toBe('acme');
      expect(filter2.tenant_id).toBe('globex');
      // Same document id, different tenant scoping
      expect(filter1._id).toBe(filter2._id);
    });
  });
});

// ─── Redis Adapter Tests ────────────────────────────────────────────────────────

describe('Redis OIDC Adapter — tenant scoping', () => {
  let adapter: any;
  let mockRedis: any;
  let logger: ILogger;

  beforeEach(async () => {
    logger = createMockLogger();

    mockRedis = {
      set: vi.fn().mockResolvedValue('OK'),
      get: vi.fn().mockResolvedValue(null),
      del: vi.fn().mockResolvedValue(1),
      hmset: vi.fn().mockResolvedValue('OK'),
      hgetall: vi.fn().mockResolvedValue({}),
      hset: vi.fn().mockResolvedValue(1),
      rpush: vi.fn().mockResolvedValue(1),
      lrange: vi.fn().mockResolvedValue([]),
      expire: vi.fn().mockResolvedValue(1),
      ttl: vi.fn().mockResolvedValue(-1),
      multi: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnThis(),
        hmset: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        rpush: vi.fn().mockReturnThis(),
        del: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([]),
      }),
    };

    const { default: OIDCRedisAdapter } =
      await import('../../../src/oidc/adapter/redis/index.js');
    adapter = new OIDCRedisAdapter(
      'AccessToken',
      mockRedis as any,
      logger,
      'parako'
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('key()', () => {
    it('includes tenant_id: {prefix}:{tenantId}:{Model}:{id}', () => {
      const key = tenantContext.run('acme', () => adapter.key('tok-1'));

      expect(key).toBe('parako:acme:oidc:AccessToken:tok-1');
    });

    it('uses DEFAULT_TENANT_ID when outside tenant context', () => {
      const key = adapter.key('tok-1');

      expect(key).toBe(`parako:${DEFAULT_TENANT_ID}:oidc:AccessToken:tok-1`);
    });
  });

  describe('helper keys include tenant_id', () => {
    it('grantKeyFor includes tenant_id', () => {
      const key = tenantContext.run('acme', () =>
        adapter.grantKeyFor('grant-1')
      );
      expect(key).toBe('parako:acme:oidc:grant:grant-1');
    });

    it('userCodeKeyFor includes tenant_id', () => {
      const key = tenantContext.run('acme', () =>
        adapter.userCodeKeyFor('UC-123')
      );
      expect(key).toBe('parako:acme:oidc:userCode:UC-123');
    });

    it('uidKeyFor includes tenant_id', () => {
      const key = tenantContext.run('acme', () => adapter.uidKeyFor('uid-abc'));
      expect(key).toBe('parako:acme:oidc:uid:uid-abc');
    });
  });

  describe('cross-tenant key isolation', () => {
    it('same document id produces different keys for different tenants', () => {
      const acmeKey = tenantContext.run('acme', () => adapter.key('tok-1'));
      const globexKey = tenantContext.run('globex', () => adapter.key('tok-1'));

      expect(acmeKey).toBe('parako:acme:oidc:AccessToken:tok-1');
      expect(globexKey).toBe('parako:globex:oidc:AccessToken:tok-1');
      expect(acmeKey).not.toBe(globexKey);
    });
  });

  describe('operations use tenant-scoped keys', () => {
    it('find() uses tenant-scoped key', async () => {
      await tenantContext.run('acme', () => adapter.find('tok-1'));

      // AccessToken is not consumable, so it uses client.get
      expect(mockRedis.get).toHaveBeenCalledWith(
        'parako:acme:oidc:AccessToken:tok-1'
      );
    });

    it('destroy() uses tenant-scoped key', async () => {
      await tenantContext.run('acme', () => adapter.destroy('tok-1'));

      expect(mockRedis.del).toHaveBeenCalledWith(
        'parako:acme:oidc:AccessToken:tok-1'
      );
    });
  });

  describe('countAll()', () => {
    it('uses tenant-scoped SCAN pattern', async () => {
      mockRedis.scan = vi
        .fn()
        .mockResolvedValue(['0', ['parako:acme:oidc:AccessToken:tok-1']]);

      const count = await tenantContext.run('acme', () => adapter.countAll());

      expect(mockRedis.scan).toHaveBeenCalledWith(
        '0',
        'MATCH',
        'parako:acme:oidc:AccessToken:*',
        'COUNT',
        1000
      );
      expect(count).toBe(1);
    });
  });

  describe('findByCustomField()', () => {
    it('uses tenant-scoped SCAN pattern', async () => {
      mockRedis.scan = vi.fn().mockResolvedValue(['0', []]);
      mockRedis.pipeline = vi.fn().mockReturnValue({
        hgetall: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([]),
      });

      await tenantContext.run('acme', () =>
        adapter.findByCustomField('status', 'active')
      );

      expect(mockRedis.scan).toHaveBeenCalledWith(
        '0',
        'MATCH',
        'parako:acme:oidc:AccessToken:*:custom',
        'COUNT',
        1000
      );
    });
  });
});

// ─── Prisma Adapter Tests ───────────────────────────────────────────────────────

describe('Prisma OIDC Adapter — tenant scoping', () => {
  let adapter: any;
  let mockPrisma: any;
  let logger: ILogger;

  beforeEach(async () => {
    logger = createMockLogger();

    mockPrisma = {
      oidcStore: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const { PrismaOidcStoreAdapter } =
      await import('../../../src/oidc/adapter/prisma/index.js');
    adapter = new PrismaOidcStoreAdapter(
      'AccessToken',
      mockPrisma as any,
      logger
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('upsert()', () => {
    it('creates with tenant_id when record does not exist', async () => {
      const payload = { accountId: 'user-1' };

      await tenantContext.run('acme', () =>
        adapter.upsert('tok-1', payload, 3600)
      );

      // Should findFirst to check existence with tenant filter
      expect(mockPrisma.oidcStore.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenant_id: 'acme' }),
        })
      );
      // Record doesn't exist → create with tenant_id
      expect(mockPrisma.oidcStore.create).toHaveBeenCalledTimes(1);
      const createArgs = mockPrisma.oidcStore.create.mock.calls[0][0];
      expect(createArgs.data).toHaveProperty('tenant_id', 'acme');
    });

    it('updates with tenant_id filter when record exists', async () => {
      // Simulate existing record
      mockPrisma.oidcStore.findFirst.mockResolvedValue({ id: 'tok-1' });

      const payload = { accountId: 'user-1' };

      await tenantContext.run('acme', () =>
        adapter.upsert('tok-1', payload, 3600)
      );

      // Should use updateMany with tenant filter
      expect(mockPrisma.oidcStore.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenant_id: 'acme' }),
        })
      );
      // create should NOT be called
      expect(mockPrisma.oidcStore.create).not.toHaveBeenCalled();
    });

    it('uses DEFAULT_TENANT_ID outside tenant context', async () => {
      const payload = { accountId: 'user-1' };

      await adapter.upsert('tok-2', payload);

      const createArgs = mockPrisma.oidcStore.create.mock.calls[0][0];
      expect(createArgs.data).toHaveProperty('tenant_id', DEFAULT_TENANT_ID);
    });

    it('prevents cross-tenant overwrite: tenant B cannot update tenant A record', async () => {
      // findFirst for tenant-b returns null (record belongs to tenant-a)
      mockPrisma.oidcStore.findFirst.mockResolvedValue(null);

      const payload = { accountId: 'user-1' };

      await tenantContext.run('tenant-b', () =>
        adapter.upsert('tok-1', payload)
      );

      // findFirst checked with tenant-b filter
      expect(mockPrisma.oidcStore.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenant_id: 'tenant-b' }),
        })
      );
      // Since findFirst returned null, it creates a NEW record for tenant-b
      // instead of overwriting tenant-a's record
      expect(mockPrisma.oidcStore.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.oidcStore.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('find()', () => {
    it('filters by tenant_id', async () => {
      await tenantContext.run('acme', () => adapter.find('tok-1'));

      expect(mockPrisma.oidcStore.findFirst).toHaveBeenCalledTimes(1);
      const args = mockPrisma.oidcStore.findFirst.mock.calls[0][0];
      expect(args.where).toHaveProperty('tenant_id', 'acme');
    });
  });

  describe('findByUserCode()', () => {
    it('filters by tenant_id for DeviceCode model', async () => {
      const { PrismaOidcStoreAdapter } =
        await import('../../../src/oidc/adapter/prisma/index.js');
      const dcAdapter = new PrismaOidcStoreAdapter(
        'DeviceCode',
        mockPrisma as any,
        logger
      );

      await tenantContext.run('acme', () => dcAdapter.findByUserCode('UC-123'));

      expect(mockPrisma.oidcStore.findFirst).toHaveBeenCalledTimes(1);
      const args = mockPrisma.oidcStore.findFirst.mock.calls[0][0];
      expect(args.where).toHaveProperty('tenant_id', 'acme');
    });
  });

  describe('findByUid()', () => {
    it('filters by tenant_id for Session model', async () => {
      const { PrismaOidcStoreAdapter } =
        await import('../../../src/oidc/adapter/prisma/index.js');
      const sessionAdapter = new PrismaOidcStoreAdapter(
        'Session',
        mockPrisma as any,
        logger
      );

      await tenantContext.run('acme', () =>
        sessionAdapter.findByUid('uid-abc')
      );

      expect(mockPrisma.oidcStore.findFirst).toHaveBeenCalledTimes(1);
      const args = mockPrisma.oidcStore.findFirst.mock.calls[0][0];
      expect(args.where).toHaveProperty('tenant_id', 'acme');
    });
  });

  describe('consume()', () => {
    it('filters by tenant_id', async () => {
      await tenantContext.run('acme', () => adapter.consume('tok-1'));

      expect(mockPrisma.oidcStore.updateMany).toHaveBeenCalledTimes(1);
      const args = mockPrisma.oidcStore.updateMany.mock.calls[0][0];
      expect(args.where).toHaveProperty('tenant_id', 'acme');
    });
  });

  describe('destroy()', () => {
    it('filters by tenant_id', async () => {
      await tenantContext.run('acme', () => adapter.destroy('tok-1'));

      expect(mockPrisma.oidcStore.deleteMany).toHaveBeenCalledTimes(1);
      const args = mockPrisma.oidcStore.deleteMany.mock.calls[0][0];
      expect(args.where).toHaveProperty('tenant_id', 'acme');
    });
  });

  describe('revokeByGrantId()', () => {
    it('filters by tenant_id', async () => {
      await tenantContext.run('acme', () => adapter.revokeByGrantId('grant-1'));

      expect(mockPrisma.oidcStore.deleteMany).toHaveBeenCalledTimes(1);
      const args = mockPrisma.oidcStore.deleteMany.mock.calls[0][0];
      expect(args.where).toHaveProperty('tenant_id', 'acme');
    });
  });

  describe('cross-tenant isolation', () => {
    it('different tenants produce different filters on find()', async () => {
      await tenantContext.run('acme', () => adapter.find('tok-shared'));
      await tenantContext.run('globex', () => adapter.find('tok-shared'));

      const args1 = mockPrisma.oidcStore.findFirst.mock.calls[0][0];
      const args2 = mockPrisma.oidcStore.findFirst.mock.calls[1][0];

      expect(args1.where.tenant_id).toBe('acme');
      expect(args2.where.tenant_id).toBe('globex');
    });
  });
});
