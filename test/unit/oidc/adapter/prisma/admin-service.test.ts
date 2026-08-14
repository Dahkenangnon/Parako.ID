/**
 * Prisma OIDC admin adapter behavior shared by SQLite and PostgreSQL.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { PrismaOidcAdminService } from '../../../../../src/oidc/adapter/prisma/admin-service.js';
import { tenantContext } from '../../../../../src/multi-tenancy/tenant-context.js';
import type { OidcClientData } from '../../../../../src/oidc/adapter/client.interface.js';

function makePrisma() {
  return {
    oidcStore: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

const originalEncryptionKey = process.env.ENCRYPTION_KEY;

beforeAll(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
});

afterAll(() => {
  if (originalEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = originalEncryptionKey;
});

function oidcRow(
  id: string,
  payload: Record<string, unknown>,
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    model: 'Session',
    payload: JSON.stringify(payload),
    grant_id: null,
    user_code: null,
    uid: null,
    account_id: null,
    client_id: null,
    consumed: null,
    expires_at: null,
    created_at: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

function expectTenantWhere(calls: any[][], tenantId: string): void {
  for (const [operation] of calls) {
    expect(operation.where).toEqual(
      expect.objectContaining({ tenant_id: tenantId })
    );
  }
}

describe('PrismaOidcAdminService tenant isolation', () => {
  it('scopes session reads, counts, and exports to the active tenant', async () => {
    const prisma = makePrisma();
    const service = new PrismaOidcAdminService(prisma as any, 'Session');

    await tenantContext.run('tenant-b', async () => {
      await service.findByAccountId('account-1');
      await service.countSessions();
      await service.findSessionsWithPagination();
      await service.findSessionById('session-1');
      await service.getDistinctValues('payload.clientId');
      await service.exportAllSessions();
    });

    expectTenantWhere(prisma.oidcStore.findMany.mock.calls, 'tenant-b');
    expectTenantWhere(prisma.oidcStore.findFirst.mock.calls, 'tenant-b');
    expectTenantWhere(prisma.oidcStore.count.mock.calls, 'tenant-b');
  });

  it('scopes session deletion operations to the active tenant', async () => {
    const prisma = makePrisma();
    const service = new PrismaOidcAdminService(prisma as any, 'Session');

    await tenantContext.run('tenant-b', async () => {
      await service.revokeSession('session-1');
      await service.revokeAllSessionsExcept('account-1', 'session-1');
      await service.deleteSessionsByAccountId('account-1');
      await service.deleteSessionsByIds(['session-1', 'session-2']);
      await service.destroy('session-1');
      await service.deleteByAccountId('account-1');
    });

    expectTenantWhere(prisma.oidcStore.deleteMany.mock.calls, 'tenant-b');
  });

  it('scopes grant reads and base adapter lookup to the active tenant', async () => {
    const prisma = makePrisma();
    const service = new PrismaOidcAdminService(prisma as any, 'Grant');

    await tenantContext.run('tenant-b', async () => {
      await service.findGrantsByAccountId('account-1');
      await service.findGrantsByClientId('client-1');
      await service.findGrantById('grant-1');
      await service.find('grant-1');
      await service.exportAllGrants();
    });

    expectTenantWhere(prisma.oidcStore.findMany.mock.calls, 'tenant-b');
    expectTenantWhere(prisma.oidcStore.findFirst.mock.calls, 'tenant-b');
  });

  it('scopes statistics queries and groups to the active tenant', async () => {
    const prisma = makePrisma();
    const sessionService = new PrismaOidcAdminService(prisma as any, 'Session');
    const grantService = new PrismaOidcAdminService(prisma as any, 'Grant');

    await tenantContext.run('tenant-b', async () => {
      await sessionService.getSessionStatistics();
      await grantService.getGrantStatistics();
    });

    expectTenantWhere(prisma.oidcStore.count.mock.calls, 'tenant-b');
    expectTenantWhere(prisma.oidcStore.groupBy.mock.calls, 'tenant-b');
  });
});

describe('PrismaOidcAdminService session and grant behavior', () => {
  it('normalizes session rows and short-circuits empty account lookups', async () => {
    const prisma = makePrisma();
    const row = oidcRow(
      'session-1',
      {},
      { payload: { accountId: 'account-1' } }
    );
    prisma.oidcStore.findMany.mockResolvedValueOnce([row]);
    const service = new PrismaOidcAdminService(prisma as any, 'Session');

    await expect(service.findByAccountId('account-1')).resolves.toEqual([
      {
        _id: 'session-1',
        payload: { accountId: 'account-1' },
        expiresAt: null,
        created_at: row.created_at,
      },
    ]);
    await expect(service.findByAccountId('')).resolves.toEqual([]);
    expect(prisma.oidcStore.findMany).toHaveBeenCalledOnce();
  });

  it('maps paginated and exported session rows', async () => {
    const prisma = makePrisma();
    const row = oidcRow('session-1', { accountId: 'account-1' });
    prisma.oidcStore.findMany
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([row]);
    const service = new PrismaOidcAdminService(prisma as any, 'Session');

    await expect(service.findSessionsWithPagination()).resolves.toEqual([
      expect.objectContaining({ _id: 'session-1' }),
    ]);
    await expect(service.exportAllSessions()).resolves.toEqual([
      expect.objectContaining({ _id: 'session-1' }),
    ]);
  });

  it('translates an anchored portable account filter to an indexed prefix query', async () => {
    const prisma = makePrisma();
    const service = new PrismaOidcAdminService(prisma as any, 'Session');
    const filters = {
      'payload.accountId': {
        $regex: '^alice\\.admin',
        $options: 'i',
      },
    };

    await service.countSessions(filters);
    await service.findSessionsWithPagination(filters);

    const expectedWhere = {
      model: 'Session',
      tenant_id: 'default',
      account_id: { startsWith: 'alice.admin' },
    };
    expect(prisma.oidcStore.count).toHaveBeenCalledWith({
      where: expectedWhere,
    });
    expect(prisma.oidcStore.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere })
    );
  });

  it('returns a normalized session or null from direct lookup', async () => {
    const prisma = makePrisma();
    prisma.oidcStore.findFirst
      .mockResolvedValueOnce(oidcRow('session-1', { accountId: 'account-1' }))
      .mockResolvedValueOnce(null);
    const service = new PrismaOidcAdminService(prisma as any, 'Session');

    await expect(service.findSessionById('session-1')).resolves.toMatchObject({
      _id: 'session-1',
    });
    await expect(service.findSessionById('missing')).resolves.toBeNull();
  });

  it('returns session deletion results and avoids empty batch queries', async () => {
    const prisma = makePrisma();
    prisma.oidcStore.deleteMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 3 })
      .mockResolvedValueOnce({ count: 2 });
    const service = new PrismaOidcAdminService(prisma as any, 'Session');

    await expect(service.revokeSession('session-1')).resolves.toBe(true);
    await expect(service.revokeSession('missing')).resolves.toBe(false);
    await expect(
      service.revokeAllSessionsExcept('account-1', 'session-1')
    ).resolves.toBe(3);
    await expect(
      service.deleteSessionsByAccountId('account-1')
    ).resolves.toEqual({ deletedCount: 2 });
    await expect(service.deleteSessionsByIds([])).resolves.toEqual({
      deletedCount: 0,
    });
    expect(prisma.oidcStore.deleteMany).toHaveBeenCalledTimes(4);
  });

  it('computes session statistics from tenant-scoped counts', async () => {
    const prisma = makePrisma();
    prisma.oidcStore.count.mockResolvedValueOnce(7).mockResolvedValueOnce(2);
    const service = new PrismaOidcAdminService(prisma as any, 'Session');

    await expect(service.getSessionStatistics()).resolves.toEqual({
      total: 7,
      active: 5,
      expired: 2,
    });
  });

  it('uses the indexed account distinct path with optional filters', async () => {
    const prisma = makePrisma();
    prisma.oidcStore.findMany.mockResolvedValueOnce([
      { account_id: 'account-1' },
      { account_id: null },
      { account_id: 'account-2' },
    ]);
    const service = new PrismaOidcAdminService(prisma as any, 'Session');

    await expect(
      service.getDistinctValues('payload.accountId', {
        'payload.clientId': 'client-1',
      })
    ).resolves.toEqual(['account-1', 'account-2']);
    expect(prisma.oidcStore.findMany).toHaveBeenCalledWith({
      where: {
        model: 'Session',
        tenant_id: 'default',
        client_id: 'client-1',
        account_id: { not: null },
      },
      select: { account_id: true },
      distinct: ['account_id'],
    });
  });

  it('uses the tenant model predicate for unfiltered distinct accounts', async () => {
    const prisma = makePrisma();
    prisma.oidcStore.findMany.mockResolvedValueOnce([]);
    const service = new PrismaOidcAdminService(prisma as any, 'Session');

    await expect(
      service.getDistinctValues('payload.accountId')
    ).resolves.toEqual([]);
    expect(prisma.oidcStore.findMany).toHaveBeenCalledWith({
      where: {
        model: 'Session',
        tenant_id: 'default',
        account_id: { not: null },
      },
      select: { account_id: true },
      distinct: ['account_id'],
    });
  });

  it('extracts unique nested distinct values from payloads', async () => {
    const prisma = makePrisma();
    prisma.oidcStore.findMany.mockResolvedValueOnce([
      oidcRow('one', { clientId: 'client-1' }),
      oidcRow('two', { clientId: 'client-1' }),
      oidcRow('three', { clientId: null }),
      oidcRow('four', {}),
    ]);
    const service = new PrismaOidcAdminService(prisma as any, 'Session');

    await expect(
      service.getDistinctValues('payload.clientId')
    ).resolves.toEqual(['client-1']);
  });

  it('returns grant rows, base payloads, and empty lookup fallbacks', async () => {
    const prisma = makePrisma();
    const row = oidcRow(
      'grant-1',
      { accountId: 'account-1', clientId: 'client-1' },
      { model: 'Grant' }
    );
    prisma.oidcStore.findMany
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([row]);
    prisma.oidcStore.findFirst
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce(row);
    const service = new PrismaOidcAdminService(prisma as any, 'Grant');

    await expect(
      service.findGrantsByAccountId('account-1')
    ).resolves.toHaveLength(1);
    await expect(
      service.findGrantsByClientId('client-1')
    ).resolves.toHaveLength(1);
    await expect(service.findGrantById('grant-1')).resolves.toMatchObject({
      _id: 'grant-1',
    });
    await expect(service.find('grant-1')).resolves.toEqual({
      accountId: 'account-1',
      clientId: 'client-1',
    });
    await expect(service.findGrantsByAccountId('')).resolves.toEqual([]);
    await expect(service.findGrantsByClientId('')).resolves.toEqual([]);
  });

  it('maps grant statistics and delegates grant deletion', async () => {
    const prisma = makePrisma();
    prisma.oidcStore.count
      .mockResolvedValueOnce(9)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(4);
    prisma.oidcStore.groupBy
      .mockResolvedValueOnce([{ client_id: 'client-1', _count: { id: 6 } }])
      .mockResolvedValueOnce([{ account_id: 'account-1', _count: { id: 5 } }]);
    prisma.oidcStore.deleteMany.mockResolvedValueOnce({ count: 3 });
    const service = new PrismaOidcAdminService(prisma as any, 'Grant');

    await expect(service.getGrantStatistics()).resolves.toEqual({
      total: 9,
      recent: 4,
      expired: 2,
      byClient: [{ _id: 'client-1', count: 6 }],
      byUser: [{ _id: 'account-1', count: 5 }],
    });
    await expect(service.deleteGrantsByAccountId('account-1')).resolves.toEqual(
      { deletedCount: 3 }
    );
  });

  it('ignores unsupported portable filter values without broadening scope', async () => {
    const prisma = makePrisma();
    const service = new PrismaOidcAdminService(prisma as any, 'Grant');

    await service.countGrants({
      'payload.accountId': 42,
      'payload.clientId': { $regex: 42 },
      'payload.exp': 'invalid',
      $or: [null, { unsupported: 'value' }, { 'payload.accountId': 42 }],
      unsupported: true,
    });

    expect(prisma.oidcStore.count).toHaveBeenCalledWith({
      where: { model: 'Grant', tenant_id: 'default' },
    });
  });

  it.each([
    [{}, {}],
    [{ $gt: 1_700_000_000 }, { gt: new Date(1_700_000_000_000) }],
    [{ $lte: 1_800_000_000 }, { lte: new Date(1_800_000_000_000) }],
  ])('translates partial expiration filter %j', async (filter, expected) => {
    const prisma = makePrisma();
    const service = new PrismaOidcAdminService(prisma as any, 'Grant');

    await service.countGrants({ 'payload.exp': filter });

    expect(prisma.oidcStore.count).toHaveBeenCalledWith({
      where: {
        model: 'Grant',
        tenant_id: 'default',
        expires_at: expected,
      },
    });
  });
});

describe('PrismaOidcAdminService grant listing', () => {
  it('translates portable exact and literal-search filters to indexed columns', async () => {
    const prisma = makePrisma();
    const service = new PrismaOidcAdminService(prisma as any, 'Grant');
    const filters = {
      'payload.kind': 'Grant',
      'payload.accountId': 'alice',
      'payload.clientId': 'client-1',
      $or: [
        {
          'payload.accountId': { $regex: 'a\\+b', $options: 'i' },
        },
        {
          'payload.clientId': { $regex: 'a\\+b', $options: 'i' },
        },
      ],
    };

    await service.countGrants(filters);

    expect(prisma.oidcStore.count).toHaveBeenCalledWith({
      where: {
        model: 'Grant',
        tenant_id: 'default',
        account_id: 'alice',
        client_id: 'client-1',
        OR: [
          { account_id: { contains: 'a+b' } },
          { client_id: { contains: 'a+b' } },
        ],
      },
    });
  });

  it('keeps legacy RegExp filters functional while using literal text', async () => {
    const prisma = makePrisma();
    const service = new PrismaOidcAdminService(prisma as any, 'Grant');

    await service.countGrants({
      'payload.accountId': { $regex: /alice\.admin/i },
    });

    expect(prisma.oidcStore.count).toHaveBeenCalledWith({
      where: {
        model: 'Grant',
        tenant_id: 'default',
        account_id: { contains: 'alice.admin' },
      },
    });
  });

  it.each([
    ['created_at', 'created_at'],
    ['payload.iat', 'created_at'],
    ['payload.accountId', 'account_id'],
    ['payload.clientId', 'client_id'],
    ['payload.exp', 'expires_at'],
    ['unknown', 'created_at'],
  ])('maps public sort field %s to %s', async (sortBy, column) => {
    const prisma = makePrisma();
    const service = new PrismaOidcAdminService(prisma as any, 'Grant');

    await service.findGrantsWithPagination({}, sortBy, 1, 4, 10);

    expect(prisma.oidcStore.findMany).toHaveBeenCalledWith({
      where: { model: 'Grant', tenant_id: 'default' },
      orderBy: { [column]: 'asc' },
      skip: 4,
      take: 10,
    });
  });

  it('maps descending order and filtered expiration comparisons', async () => {
    const prisma = makePrisma();
    const service = new PrismaOidcAdminService(prisma as any, 'Grant');
    const after = 1_700_000_000;
    const before = 1_800_000_000;

    await service.findGrantsWithPagination(
      { 'payload.exp': { $gt: after, $lte: before } },
      'payload.exp',
      -1,
      0,
      20
    );

    expect(prisma.oidcStore.findMany).toHaveBeenCalledWith({
      where: {
        model: 'Grant',
        tenant_id: 'default',
        expires_at: {
          gt: new Date(after * 1000),
          lte: new Date(before * 1000),
        },
      },
      orderBy: { expires_at: 'desc' },
      skip: 0,
      take: 20,
    });
  });
});

describe('PrismaOidcAdminService client CRUD', () => {
  const storedClient = {
    client_id: 'client-1',
    client_name: 'Dashboard',
    application_type: 'web',
    redirect_uris: ['https://client.example/callback'],
    active: true,
  } satisfies Partial<OidcClientData>;

  it('creates a tenant-scoped client and encrypts its generated secret', async () => {
    const prisma = makePrisma();
    const service = new PrismaOidcAdminService(prisma as any, 'Client');

    const client = await tenantContext.run('tenant-b', () =>
      service.createClient({
        client_name: 'Dashboard',
        redirect_uris: ['https://client.example/callback'],
      })
    );

    expect(client.client_id).toBeTruthy();
    expect(client.client_secret).toBeTruthy();
    expect(client.active).toBe(true);
    expect(prisma.oidcStore.findFirst).toHaveBeenCalledWith({
      where: {
        id: client.client_id,
        model: 'Client',
        tenant_id: 'tenant-b',
      },
    });
    const create = prisma.oidcStore.create.mock.calls[0][0];
    const persisted = JSON.parse(create.data.payload);
    expect(create.data).toEqual(
      expect.objectContaining({
        id: client.client_id,
        model: 'Client',
        client_id: client.client_id,
        tenant_id: 'tenant-b',
        created_at: expect.any(Date),
      })
    );
    expect(persisted.client_secret).not.toBe(client.client_secret);
  });

  it('rejects invalid and duplicate clients before insertion', async () => {
    const invalidPrisma = makePrisma();
    const invalidService = new PrismaOidcAdminService(
      invalidPrisma as any,
      'Client'
    );

    await expect(
      invalidService.createClient({ application_type: 'invalid' as never })
    ).rejects.toThrow('Client validation failed');
    expect(invalidPrisma.oidcStore.findFirst).not.toHaveBeenCalled();

    const duplicatePrisma = makePrisma();
    duplicatePrisma.oidcStore.findFirst.mockResolvedValueOnce(
      oidcRow('client-1', storedClient, { model: 'Client' })
    );
    const duplicateService = new PrismaOidcAdminService(
      duplicatePrisma as any,
      'Client'
    );
    await expect(
      duplicateService.createClient({
        ...storedClient,
        client_id: 'client-1',
      })
    ).rejects.toThrow('already exists');
    expect(duplicatePrisma.oidcStore.create).not.toHaveBeenCalled();
  });

  it('finds, decrypts, and normalizes clients while preserving tenant scope', async () => {
    const prisma = makePrisma();
    prisma.oidcStore.findFirst
      .mockResolvedValueOnce(
        oidcRow(
          'legacy-id',
          { ...storedClient, client_id: undefined },
          {
            model: 'Client',
          }
        )
      )
      .mockResolvedValueOnce(null);
    const service = new PrismaOidcAdminService(prisma as any, 'Client');

    await expect(service.findClientById('legacy-id')).resolves.toMatchObject({
      client_id: 'legacy-id',
      client_name: 'Dashboard',
    });
    await expect(service.findClientById('missing')).resolves.toBeNull();
  });

  it('lists and filters tenant clients from string and object payloads', async () => {
    const prisma = makePrisma();
    prisma.oidcStore.findMany.mockResolvedValueOnce([
      oidcRow('client-1', storedClient, { model: 'Client' }),
      oidcRow(
        'client-2',
        {},
        {
          model: 'Client',
          payload: {
            ...storedClient,
            client_id: 'client-2',
            client_name: 'Inactive API',
            active: false,
          },
        }
      ),
    ]);
    const service = new PrismaOidcAdminService(prisma as any, 'Client');

    await expect(service.findAllClients({ active: false })).resolves.toEqual([
      expect.objectContaining({
        client_id: 'client-2',
        client_name: 'Inactive API',
      }),
    ]);
    expect(prisma.oidcStore.findMany).toHaveBeenCalledWith({
      where: { model: 'Client', tenant_id: 'default' },
    });
  });

  it('updates an existing client without allowing its ID to change', async () => {
    const prisma = makePrisma();
    prisma.oidcStore.findFirst.mockResolvedValueOnce(
      oidcRow('client-1', storedClient, { model: 'Client' })
    );
    const service = new PrismaOidcAdminService(prisma as any, 'Client');

    const updated = await service.updateClient('client-1', {
      client_id: 'attacker-selected-id',
      client_name: 'Updated Dashboard',
    });

    expect(updated).toEqual(
      expect.objectContaining({
        client_id: 'client-1',
        client_name: 'Updated Dashboard',
        updated_at: expect.any(String),
      })
    );
    expect(prisma.oidcStore.updateMany).toHaveBeenCalledWith({
      where: { id: 'client-1', model: 'Client', tenant_id: 'default' },
      data: { payload: expect.any(String) },
    });
  });

  it('normalizes a legacy SPA update before persisting provider metadata', async () => {
    const prisma = makePrisma();
    prisma.oidcStore.findFirst.mockResolvedValueOnce(
      oidcRow('client-1', storedClient, { model: 'Client' })
    );
    const service = new PrismaOidcAdminService(prisma as any, 'Client');

    const updated = await service.updateClient('client-1', {
      application_type: 'spa',
    });

    expect(updated).toMatchObject({ application_type: 'web', preset: 'spa' });
    const payload = JSON.parse(
      prisma.oidcStore.updateMany.mock.calls[0][0].data.payload
    );
    expect(payload).toMatchObject({ application_type: 'web', preset: 'spa' });
  });

  it('returns null when updating a missing client', async () => {
    const prisma = makePrisma();
    const service = new PrismaOidcAdminService(prisma as any, 'Client');

    await expect(
      service.updateClient('missing', { client_name: 'Updated' })
    ).resolves.toBeNull();
    expect(prisma.oidcStore.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an update whose merged client metadata is invalid', async () => {
    const prisma = makePrisma();
    prisma.oidcStore.findFirst.mockResolvedValueOnce(
      oidcRow('client-1', storedClient, { model: 'Client' })
    );
    const service = new PrismaOidcAdminService(prisma as any, 'Client');

    await expect(
      service.updateClient('client-1', {
        token_endpoint_auth_method: 'private_key_jwt',
      })
    ).rejects.toThrow('Client validation failed');
    expect(prisma.oidcStore.updateMany).not.toHaveBeenCalled();
  });

  it('deletes clients and reports whether a row was removed', async () => {
    const prisma = makePrisma();
    prisma.oidcStore.deleteMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const service = new PrismaOidcAdminService(prisma as any, 'Client');

    await expect(service.deleteClient('client-1')).resolves.toBe(true);
    await expect(service.deleteClient('missing')).resolves.toBe(false);
    expectTenantWhere(prisma.oidcStore.deleteMany.mock.calls, 'default');
  });

  it('searches, activates, and deactivates clients through public operations', async () => {
    const searchPrisma = makePrisma();
    searchPrisma.oidcStore.findMany.mockResolvedValueOnce([
      oidcRow('client-1', storedClient, { model: 'Client' }),
      oidcRow(
        'client-2',
        { ...storedClient, client_id: 'client-2', client_name: 'Worker API' },
        { model: 'Client' }
      ),
    ]);
    const searchService = new PrismaOidcAdminService(
      searchPrisma as any,
      'Client'
    );
    await expect(searchService.searchClients('dash')).resolves.toEqual([
      expect.objectContaining({ client_id: 'client-1' }),
    ]);

    const activatePrisma = makePrisma();
    activatePrisma.oidcStore.findFirst.mockResolvedValue(
      oidcRow('client-1', storedClient, { model: 'Client' })
    );
    const activateService = new PrismaOidcAdminService(
      activatePrisma as any,
      'Client'
    );
    await expect(activateService.activateClient('client-1')).resolves.toEqual(
      expect.objectContaining({ active: true })
    );
    await expect(activateService.deactivateClient('client-1')).resolves.toEqual(
      expect.objectContaining({ active: false })
    );
  });

  it('regenerates a client secret and handles missing or failed updates', async () => {
    const prisma = makePrisma();
    prisma.oidcStore.findFirst.mockResolvedValue(
      oidcRow('client-1', storedClient, { model: 'Client' })
    );
    const service = new PrismaOidcAdminService(prisma as any, 'Client');

    const result = await service.regenerateClientSecret('client-1');
    expect(result).toEqual({
      client: expect.objectContaining({ client_id: 'client-1' }),
      newSecret: expect.any(String),
    });
    expect(result?.newSecret).toHaveLength(64);

    const missingPrisma = makePrisma();
    const missingService = new PrismaOidcAdminService(
      missingPrisma as any,
      'Client'
    );
    await expect(
      missingService.regenerateClientSecret('missing')
    ).resolves.toBeNull();

    vi.spyOn(service, 'findClientById').mockResolvedValueOnce(
      storedClient as any
    );
    vi.spyOn(service, 'updateClient').mockResolvedValueOnce(null);
    await expect(
      service.regenerateClientSecret('client-1')
    ).resolves.toBeNull();
  });

  it.each(['none', 'private_key_jwt'] as const)(
    'refuses secret regeneration for %s clients',
    async tokenEndpointAuthMethod => {
      const prisma = makePrisma();
      prisma.oidcStore.findFirst.mockResolvedValue(
        oidcRow(
          'client-1',
          {
            ...storedClient,
            token_endpoint_auth_method: tokenEndpointAuthMethod,
          },
          { model: 'Client' }
        )
      );
      const service = new PrismaOidcAdminService(prisma as any, 'Client');

      await expect(service.regenerateClientSecret('client-1')).rejects.toThrow(
        'does not use secret-based authentication'
      );
      expect(prisma.oidcStore.updateMany).not.toHaveBeenCalled();
    }
  );

  it('computes and counts tenant client statistics', async () => {
    const prisma = makePrisma();
    prisma.oidcStore.findMany.mockResolvedValueOnce([
      oidcRow('client-1', storedClient, { model: 'Client' }),
      oidcRow(
        'client-2',
        {
          ...storedClient,
          client_id: 'client-2',
          application_type: 'spa',
          active: false,
        },
        { model: 'Client' }
      ),
    ]);
    prisma.oidcStore.count.mockResolvedValueOnce(2);
    const service = new PrismaOidcAdminService(prisma as any, 'Client');

    await expect(service.getClientStatistics()).resolves.toEqual({
      total: 2,
      active: 1,
      inactive: 1,
      byType: { web: 1, spa: 1, native: 0 },
    });
    await expect(service.countClients()).resolves.toBe(2);
  });

  it('exposes client validation and secure identifier generators', () => {
    const service = new PrismaOidcAdminService(makePrisma() as any, 'Client');

    expect(
      service.validateClientDataSync({
        client_name: 'Dashboard',
        redirect_uris: ['https://client.example/callback'],
      }).isValid
    ).toBe(true);
    expect(service.generateClientId()).toBeTruthy();
    expect(service.generateClientSecret()).toHaveLength(64);
  });
});
