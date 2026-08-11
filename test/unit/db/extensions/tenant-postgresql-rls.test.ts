import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTenantExtension,
  executePostgresqlTenantQuery,
} from '../../../../src/db/extensions/tenant.extension.js';
import { tenantContext } from '../../../../src/multi-tenancy/tenant-context.js';

function captureOperation(
  adapter: 'sqlite' | 'postgresql' = 'sqlite',
  rawClient?: any
) {
  let definition: any;
  const defineExtension = vi.fn((value: any) => {
    definition = value;
    return value;
  });
  createTenantExtension(adapter, rawClient, defineExtension as any);
  return definition.query.$allModels.$allOperations as (input: any) => unknown;
}

afterEach(() => {
  tenantContext.disableStrictMode();
});

describe('Prisma tenant query extension', () => {
  it('fails closed when PostgreSQL RLS has no raw Prisma client', () => {
    const defineExtension = vi.fn((value: any) => value);

    expect(() =>
      createTenantExtension('postgresql', undefined, defineExtension as any)
    ).toThrow(/raw Prisma client is required/i);
    expect(defineExtension).not.toHaveBeenCalled();
  });

  it.each(['Tenant', 'Settings'])(
    'leaves the global %s model outside tenant scoping',
    async model => {
      const operation = captureOperation();
      const args = { where: { id: 'global-record' } };
      const query = vi.fn().mockResolvedValue({ id: 'global-record' });
      tenantContext.enableStrictMode();

      await expect(
        operation({ model, operation: 'findFirst', args, query })
      ).resolves.toEqual({ id: 'global-record' });
      expect(query).toHaveBeenCalledWith(args);
    }
  );

  it('allows the hardcoded system tenant and scopes its queries', async () => {
    const operation = captureOperation();
    const query = vi.fn().mockResolvedValue([]);

    await tenantContext.run('_platforms', () =>
      operation({
        model: 'User',
        operation: 'findMany',
        args: {},
        query,
      })
    );

    expect(query).toHaveBeenCalledWith({ where: { tenant_id: '_platforms' } });
  });

  it('identifies the deferred model operation when tenant context is missing', async () => {
    const operation = captureOperation();
    tenantContext.enableStrictMode();

    await expect(
      operation({
        model: 'User',
        operation: 'findFirst',
        args: {},
        query: vi.fn(),
      })
    ).rejects.toThrow(
      /Tenant context unavailable while executing User\.findFirst/
    );
  });

  it.each([
    ['', 'empty'],
    ['Uppercase', 'uppercase'],
    ['_unregistered', 'unregistered system'],
    ['a'.repeat(64), 'overlong'],
    ["acme'; select 1; --", 'injection-shaped'],
  ])('rejects a %s tenant identifier (%s)', async (tenantId, _caseName) => {
    const operation = captureOperation();
    const query = vi.fn();

    await expect(
      tenantContext.run(tenantId, () =>
        operation({ model: 'User', operation: 'findMany', args: {}, query })
      )
    ).rejects.toThrow(/Invalid tenant ID format/);
    expect(query).not.toHaveBeenCalled();
  });

  it('forces tenant ownership on create data', async () => {
    const operation = captureOperation();
    const query = vi.fn().mockResolvedValue({ id: 'user-1' });

    await tenantContext.run('tenant-a', () =>
      operation({
        model: 'User',
        operation: 'create',
        args: {
          data: { email: 'maria@example.com', tenant_id: 'tenant-b' },
        },
        query,
      })
    );

    expect(query).toHaveBeenCalledWith({
      data: { email: 'maria@example.com', tenant_id: 'tenant-a' },
    });
  });

  it.each(['createMany', 'createManyAndReturn'])(
    'forces tenant ownership on every %s record',
    async operationName => {
      const operation = captureOperation();
      const query = vi.fn().mockResolvedValue({ count: 2 });

      await tenantContext.run('tenant-a', () =>
        operation({
          model: 'User',
          operation: operationName,
          args: {
            data: [
              { email: 'one@example.com', tenant_id: 'tenant-b' },
              { email: 'two@example.com' },
            ],
          },
          query,
        })
      );

      expect(query).toHaveBeenCalledWith({
        data: [
          { email: 'one@example.com', tenant_id: 'tenant-a' },
          { email: 'two@example.com', tenant_id: 'tenant-a' },
        ],
      });
    }
  );

  it('forces tenant ownership on a single createMany record', async () => {
    const operation = captureOperation();
    const query = vi.fn().mockResolvedValue({ count: 1 });

    await tenantContext.run('tenant-a', () =>
      operation({
        model: 'User',
        operation: 'createMany',
        args: { data: { email: 'one@example.com', tenant_id: 'tenant-b' } },
        query,
      })
    );

    expect(query).toHaveBeenCalledWith({
      data: { email: 'one@example.com', tenant_id: 'tenant-a' },
    });
  });

  it('forces tenant ownership on every upsert branch', async () => {
    const operation = captureOperation();
    const query = vi.fn().mockResolvedValue({ id: 'user-1' });

    await tenantContext.run('tenant-a', () =>
      operation({
        model: 'User',
        operation: 'upsert',
        args: {
          where: { id: 'user-1', tenant_id: 'tenant-b' },
          create: { email: 'new@example.com', tenant_id: 'tenant-b' },
          update: { email: 'updated@example.com', tenant_id: 'tenant-b' },
        },
        query,
      })
    );

    expect(query).toHaveBeenCalledWith({
      where: { id: 'user-1', tenant_id: 'tenant-a' },
      create: { email: 'new@example.com', tenant_id: 'tenant-a' },
      update: { email: 'updated@example.com', tenant_id: 'tenant-a' },
    });
  });

  it.each(['create', 'createMany', 'upsert'])(
    'leaves a missing %s payload for Prisma to validate',
    async operationName => {
      const operation = captureOperation();
      const query = vi.fn().mockResolvedValue(null);

      await tenantContext.run('tenant-a', () =>
        operation({
          model: 'User',
          operation: operationName,
          args: {},
          query,
        })
      );

      expect(query).toHaveBeenCalledWith({});
    }
  );

  it.each([
    'findMany',
    'findFirst',
    'findFirstOrThrow',
    'findUnique',
    'findUniqueOrThrow',
    'update',
    'updateMany',
    'updateManyAndReturn',
    'delete',
    'deleteMany',
    'count',
    'aggregate',
    'groupBy',
  ])('forces the active tenant into %s filters', async operationName => {
    const operation = captureOperation();
    const query = vi.fn().mockResolvedValue([]);

    await tenantContext.run('tenant-a', () =>
      operation({
        model: 'User',
        operation: operationName,
        args: { where: { active: true, tenant_id: 'tenant-b' } },
        query,
      })
    );

    expect(query).toHaveBeenCalledWith({
      where: { active: true, tenant_id: 'tenant-a' },
    });
  });

  it('prevents an update from reassigning a record to another tenant', async () => {
    const operation = captureOperation();
    const query = vi.fn().mockResolvedValue({ count: 1 });
    const args = {
      where: { status: 'active', tenant_id: 'tenant-b' },
      data: { display_name: 'Updated', tenant_id: 'tenant-b' },
    };

    await tenantContext.run('tenant-a', () =>
      operation({ model: 'User', operation: 'updateMany', args, query })
    );

    expect(query).toHaveBeenCalledWith({
      where: { status: 'active', tenant_id: 'tenant-a' },
      data: { display_name: 'Updated', tenant_id: 'tenant-a' },
    });
  });

  it('routes PostgreSQL operations through the RLS transaction client', async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const findMany = vi.fn().mockResolvedValue([{ id: 'one' }]);
    const rawClient = {
      $transaction: vi.fn(async callback =>
        callback({
          $executeRaw: executeRaw,
          tenantSettingsOverride: { findMany },
        })
      ),
    };
    const operation = captureOperation('postgresql', rawClient);
    const fallbackQuery = vi.fn();

    await expect(
      tenantContext.run('tenant-a', () =>
        operation({
          model: 'TenantSettingsOverride',
          operation: 'findMany',
          args: { where: { active: true } },
          query: fallbackQuery,
        })
      )
    ).resolves.toEqual([{ id: 'one' }]);

    expect(rawClient.$transaction).toHaveBeenCalledOnce();
    expect(executeRaw).toHaveBeenCalledOnce();
    expect(findMany).toHaveBeenCalledWith({
      where: { active: true, tenant_id: 'tenant-a' },
    });
    expect(fallbackQuery).not.toHaveBeenCalled();
  });
});

describe('PostgreSQL tenant RLS execution', () => {
  it('sets tenant context and runs the operation in one transaction', async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const findMany = vi.fn().mockResolvedValue([{ id: 'one' }]);
    const transaction = {
      $executeRaw: executeRaw,
      tenantSettingsOverride: { findMany },
    };
    const client = {
      $transaction: vi.fn(async callback => callback(transaction)),
    };

    await expect(
      executePostgresqlTenantQuery(
        client as any,
        'TenantSettingsOverride',
        'findMany',
        { where: { tenant_id: 'acme' } },
        'acme'
      )
    ).resolves.toEqual([{ id: 'one' }]);

    expect(client.$transaction).toHaveBeenCalledOnce();
    expect(executeRaw).toHaveBeenCalledOnce();
    expect(findMany).toHaveBeenCalledWith({ where: { tenant_id: 'acme' } });
  });

  it('fails closed when Prisma exposes no matching delegate operation', async () => {
    const client = {
      $transaction: vi.fn(async callback =>
        callback({ $executeRaw: vi.fn(), user: {} })
      ),
    };

    await expect(
      executePostgresqlTenantQuery(
        client as any,
        'User',
        'notAnOperation',
        {},
        'acme'
      )
    ).rejects.toThrow('Unsupported Prisma operation');
  });
});
