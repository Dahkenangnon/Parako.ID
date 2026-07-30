import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { BootstrapConfig } from '../../../../src/config/schemas/bootstrap-schema.js';
import { createPrismaClient } from '../../../../src/db/prisma.js';
import { tenantContext } from '../../../../src/multi-tenancy/tenant-context.js';

const describePostgresql =
  process.env.ADAPTER_NAME === 'postgresql' ? describe : describe.skip;

describePostgresql('PostgreSQL generated client and RLS runtime', () => {
  let client: PrismaClient;
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const tenantA = `ci-a-${suffix}`;
  const tenantB = `ci-b-${suffix}`;
  const email = `shared-${suffix}@example.test`;

  beforeAll(() => {
    const url = process.env.STORAGE_POSTGRESQL_URL;
    if (!url) throw new Error('STORAGE_POSTGRESQL_URL is required');

    client = createPrismaClient({
      deployment: {
        environment: 'development',
        server: { port: 9007 },
      },
      storage: { adapter: 'postgresql', postgresql: { url } },
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
});
