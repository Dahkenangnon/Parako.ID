import { expect, test } from '@playwright/test';

import {
  startMongoMultiTenantParakoInstance,
  startMongoSingleTenantParakoInstance,
  startParakoInstance,
  startPostgresqlParakoInstance,
} from './support/parako-instance.mjs';
import { requireE2ePostgresqlUrl } from './support/e2e-prerequisites.js';
import {
  createLoopbackTenantFetch,
  type E2eFetch,
} from './support/loopback-tenant-fetch.js';

const POSTGRESQL_URL = requireE2ePostgresqlUrl();
const TENANT_ID = 'health-matrix';

interface HealthInstance {
  origin: string;
  logs(): string;
  shutdown(): Promise<number | null>;
  stop(): Promise<void>;
  stopDatabase?: () => Promise<void>;
}

interface HealthCell {
  name: string;
  embedded?: boolean;
  start(): Promise<HealthInstance>;
}

const cells: HealthCell[] = [
  {
    name: 'SQLite single-tenant',
    embedded: true,
    start: () => startParakoInstance({ port: 19408 }),
  },
  {
    name: 'MongoDB single-tenant',
    start: () => startMongoSingleTenantParakoInstance({ port: 19408 }),
  },
  {
    name: 'MongoDB multi-tenant',
    start: async () => {
      const instance = await startMongoMultiTenantParakoInstance({
        port: 19408,
        tenants: [{ slug: TENANT_ID, display_name: 'Health matrix tenant' }],
      });
      return {
        ...instance,
        origin: new URL(instance.issuer(TENANT_ID)).origin,
      };
    },
  },
  {
    name: 'PostgreSQL single-tenant',
    start: async () => {
      const instance = await startPostgresqlParakoInstance({
        port: 19408,
        postgresqlUrl: POSTGRESQL_URL!,
        multiTenancy: false,
      });
      return { ...instance, origin: instance.origin };
    },
  },
  {
    name: 'PostgreSQL multi-tenant',
    start: async () => {
      const instance = await startPostgresqlParakoInstance({
        port: 19408,
        postgresqlUrl: POSTGRESQL_URL!,
        multiTenancy: true,
        tenants: [{ slug: TENANT_ID, display_name: 'Health matrix tenant' }],
      });
      return {
        ...instance,
        origin: new URL(instance.issuer(TENANT_ID)).origin,
      };
    },
  },
];

async function expectHealthy(request: E2eFetch, origin: string) {
  const liveness = await request(`${origin}/health`);
  expect(liveness.status).toBe(200);
  await expect(liveness.json()).resolves.toMatchObject({ status: 'ok' });

  const deepHealth = await request(`${origin}/health?deep=true`);
  expect(deepHealth.status).toBe(200);
  await expect(deepHealth.json()).resolves.toMatchObject({
    status: 'ok',
    checks: { database: 'ok' },
  });

  const readiness = await request(`${origin}/readyz`);
  expect(readiness.status).toBe(200);
  await expect(readiness.json()).resolves.toMatchObject({ status: 'ready' });
}

async function expectGracefulShutdown(instance: HealthInstance) {
  await expect(instance.shutdown()).resolves.toBe(0);
  expect(instance.logs()).toContain('Stopping HTTP server');
  expect(instance.logs()).toContain('HTTP server stopped gracefully');
  expect(instance.logs()).toContain('Server shutdown completed gracefully');
}

for (const cell of cells) {
  test(`${cell.name} separates liveness from storage readiness`, async () => {
    const instance = await cell.start();
    const request = createLoopbackTenantFetch(instance.origin);

    try {
      await expectHealthy(request, instance.origin);

      // SQLite is embedded in the web process, so there is no independent
      // backing service to take offline while keeping liveness observable.
      if (!cell.embedded) {
        await instance.stopDatabase!();

        const liveWithoutDatabase = await request(`${instance.origin}/health`);
        expect(liveWithoutDatabase.status).toBe(200);
        await expect(liveWithoutDatabase.json()).resolves.toMatchObject({
          status: 'ok',
        });

        const deepWithoutDatabase = await request(
          `${instance.origin}/health?deep=true`
        );
        expect(deepWithoutDatabase.status).toBe(503);
        await expect(deepWithoutDatabase.json()).resolves.toMatchObject({
          checks: {
            database: expect.stringMatching(
              /^(disconnected|error|unreachable)$/
            ),
          },
        });

        const notReady = await request(`${instance.origin}/readyz`);
        expect(notReady.status).toBe(503);
        await expect(notReady.json()).resolves.toMatchObject({
          status: 'db_disconnected',
        });
      }

      await expectGracefulShutdown(instance);
    } finally {
      await instance.stop();
    }
  });
}
