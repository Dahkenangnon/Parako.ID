import { describe, expect, it, vi } from 'vitest';
import { executePostgresqlTenantQuery } from '../../../../src/db/extensions/tenant.extension.js';

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
