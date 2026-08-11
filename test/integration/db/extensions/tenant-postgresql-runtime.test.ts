import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { BootstrapConfig } from '../../../../src/config/schemas/bootstrap-schema.js';
import { createPrismaClient } from '../../../../src/db/prisma.js';
import { tenantContext } from '../../../../src/multi-tenancy/tenant-context.js';
import { PrismaOidcStoreAdapter } from '../../../../src/oidc/adapter/prisma/index.js';
import { PrismaOidcAdminService } from '../../../../src/oidc/adapter/prisma/admin-service.js';
import type { ILogger } from '../../../../src/di/interfaces/logger.interface.js';

describe('PostgreSQL generated client and RLS runtime', () => {
  let client: PrismaClient;
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const tenantA = `ci-a-${suffix}`;
  const tenantB = `ci-b-${suffix}`;
  const email = `shared-${suffix}@example.test`;
  const oidcId = `shared-oidc-${suffix}`;
  const logger = { error: () => {} } as unknown as ILogger;

  beforeAll(() => {
    const url =
      process.env.STORAGE_POSTGRESQL_URL ??
      process.env.PARAKO_E2E_POSTGRESQL_URL;
    if (!url) {
      throw new Error(
        'STORAGE_POSTGRESQL_URL or PARAKO_E2E_POSTGRESQL_URL is required'
      );
    }

    client = createPrismaClient({
      deployment: {
        environment: 'development',
        server: { port: 9007 },
      },
      storage: { adapter: 'postgresql', postgresql: { url } },
      integrations: { file_storage: { provider: 'local' } },
      multiTenancy: {
        enabled: true,
        extraction_priority: ['header', 'subdomain'],
        tenant_header: 'x-tenant-id',
        provider_pool: {
          max_size: 50,
          idle_ttl_ms: 1_800_000,
          cleanup_interval_ms: 60_000,
        },
      },
    } satisfies BootstrapConfig);
  });

  afterAll(async () => {
    if (!client) return;
    await tenantContext.run(
      tenantA,
      async () => await client.user.deleteMany({ where: { email } })
    );
    await tenantContext.run(
      tenantB,
      async () => await client.user.deleteMany({ where: { email } })
    );
    await client.$disconnect();
  });

  it('supports the same unique value in isolated tenants', async () => {
    await tenantContext.run(
      tenantA,
      async () => await client.user.create({ data: { email } })
    );
    await tenantContext.run(
      tenantB,
      async () => await client.user.create({ data: { email } })
    );

    const rowsA = await tenantContext.run(
      tenantA,
      async () =>
        await client.user.findMany({
          where: { email },
          select: { tenant_id: true },
        })
    );
    const rowsB = await tenantContext.run(
      tenantB,
      async () =>
        await client.user.findMany({
          where: { email },
          select: { tenant_id: true },
        })
    );

    expect(rowsA).toEqual([{ tenant_id: tenantA }]);
    expect(rowsB).toEqual([{ tenant_id: tenantB }]);
  });

  it('stores the same OIDC model ID independently for different tenants', async () => {
    const adapter = new PrismaOidcStoreAdapter('AccessToken', client, logger);

    try {
      await tenantContext.run(tenantA, () =>
        adapter.upsert(oidcId, { accountId: 'account-a' }, 60)
      );
      await tenantContext.run(tenantB, () =>
        adapter.upsert(oidcId, { accountId: 'account-b' }, 60)
      );

      await expect(
        tenantContext.run(tenantA, () => adapter.find(oidcId))
      ).resolves.toMatchObject({ accountId: 'account-a' });
      await expect(
        tenantContext.run(tenantB, () => adapter.find(oidcId))
      ).resolves.toMatchObject({ accountId: 'account-b' });
    } finally {
      await tenantContext.run(tenantA, () => adapter.destroy(oidcId));
      await tenantContext.run(tenantB, () => adapter.destroy(oidcId));
    }
  });

  it('isolates OIDC admin reads and deletions between tenants', async () => {
    const adapter = new PrismaOidcStoreAdapter('Session', client, logger);
    const admin = new PrismaOidcAdminService(client, 'Session');
    const sessionId = `${oidcId}-admin`;

    try {
      await tenantContext.run(tenantA, () =>
        adapter.upsert(sessionId, { accountId: 'account-a' }, 60)
      );
      await tenantContext.run(tenantB, () =>
        adapter.upsert(sessionId, { accountId: 'account-b' }, 60)
      );

      await expect(
        tenantContext.run(tenantA, () => admin.findSessionById(sessionId))
      ).resolves.toMatchObject({ payload: { accountId: 'account-a' } });
      await expect(
        tenantContext.run(tenantB, () => admin.findSessionById(sessionId))
      ).resolves.toMatchObject({ payload: { accountId: 'account-b' } });

      await tenantContext.run(tenantA, () => admin.revokeSession(sessionId));

      await expect(
        tenantContext.run(tenantA, () => adapter.find(sessionId))
      ).resolves.toBeUndefined();
      await expect(
        tenantContext.run(tenantB, () => adapter.find(sessionId))
      ).resolves.toMatchObject({ accountId: 'account-b' });
    } finally {
      await tenantContext.run(tenantA, () => adapter.destroy(sessionId));
      await tenantContext.run(tenantB, () => adapter.destroy(sessionId));
    }
  });
});
