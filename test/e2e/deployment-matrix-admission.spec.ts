import { expect, test } from '@playwright/test';

import {
  startMongoMultiTenantParakoInstance,
  startMongoSingleTenantParakoInstance,
  startParakoInstance,
  startPostgresqlParakoInstance,
} from './support/parako-instance.mjs';
import { requireE2ePostgresqlUrl } from './support/e2e-prerequisites.js';
import { createLoopbackTenantFetch } from './support/loopback-tenant-fetch.js';

const POSTGRESQL_URL = requireE2ePostgresqlUrl();

async function expectAdmission(origin: string, issuer: string) {
  const request = createLoopbackTenantFetch(origin);
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
  expect(readiness.ok).toBe(true);
  await expect(readiness.json()).resolves.toMatchObject({ status: 'ready' });

  const metadata = await request(`${issuer}/.well-known/openid-configuration`);
  expect(metadata.ok).toBe(true);
  await expect(metadata.json()).resolves.toMatchObject({ issuer });
}

test.describe('deployment matrix admission', () => {
  test('SQLite single-tenant starts and publishes issuer metadata', async () => {
    const instance = await startParakoInstance({ port: 19120 });

    try {
      await expectAdmission(instance.origin, instance.issuer);
    } finally {
      await instance.stop();
    }
  });

  test('MongoDB single-tenant starts and publishes issuer metadata', async () => {
    const instance = await startMongoSingleTenantParakoInstance({
      port: 19121,
    });

    try {
      await expectAdmission(instance.origin, instance.issuer);
    } finally {
      await instance.stop();
    }
  });

  test('MongoDB multi-tenant publishes tenant-scoped issuer metadata', async () => {
    const tenantId = 'matrix-mongo';
    const instance = await startMongoMultiTenantParakoInstance({
      port: 19122,
      tenants: [{ slug: tenantId, display_name: 'Matrix Mongo tenant' }],
      clients: [],
    });

    try {
      await expectAdmission(instance.origin, instance.issuer(tenantId));
    } finally {
      await instance.stop();
    }
  });

  test('PostgreSQL single-tenant starts and publishes issuer metadata', async () => {
    const instance = await startPostgresqlParakoInstance({
      port: 19123,
      postgresqlUrl: POSTGRESQL_URL!,
      multiTenancy: false,
    });

    try {
      await expectAdmission(instance.origin, instance.issuer());
    } finally {
      await instance.stop();
    }
  });

  test('PostgreSQL multi-tenant publishes tenant-scoped issuer metadata', async () => {
    const tenantId = 'matrix-postgresql';
    const instance = await startPostgresqlParakoInstance({
      port: 19124,
      postgresqlUrl: POSTGRESQL_URL!,
      multiTenancy: true,
      tenants: [{ slug: tenantId, display_name: 'Matrix PostgreSQL tenant' }],
    });

    try {
      await expectAdmission(instance.origin, instance.issuer(tenantId));
    } finally {
      await instance.stop();
    }
  });
});
