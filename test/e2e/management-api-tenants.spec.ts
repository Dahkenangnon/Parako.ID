import { expect, test } from '@playwright/test';

import {
  apiRequest,
  issueManagementToken,
  machineClient,
} from './support/deployment-management-api.js';
import {
  startMongoMultiTenantParakoInstance,
  startPostgresqlParakoInstance,
} from './support/parako-instance.mjs';
import { requireE2ePostgresqlUrl } from './support/e2e-prerequisites.js';

const PLATFORM_CLIENT_ID = 'parako-platform-api-e2e';
const TENANT_CLIENT_ID = 'parako-tenant-api-e2e';
// gitleaks:allow -- deterministic credentials for isolated local E2E clients.
const PLATFORM_CLIENT_SECRET = 'platform-management-e2e-secret-long-enough';
// gitleaks:allow -- deterministic credentials for isolated local E2E clients.
const TENANT_CLIENT_SECRET = 'tenant-management-e2e-secret-long-enough';
const PLATFORM_SCOPES = [
  'parako:tenants:read',
  'parako:tenants:write',
  'parako:cross-tenant:read',
  'parako:cross-tenant:write',
].join(' ');
const TENANT_SCOPES = 'parako:stats:read';
const POSTGRESQL_URL = requireE2ePostgresqlUrl();

interface ApiEnvelope<T> {
  data: T;
}

interface ApiList<T> {
  data: T[];
  pagination: {
    has_more: boolean;
    next_cursor: string | null;
    total_count?: number;
  };
}

interface TenantRecord {
  id?: string;
  _id?: string;
  slug: string;
  display_name: string;
  status: string;
}

interface MultiTenantRuntime {
  issuer(tenantId: string): string;
  stop(): Promise<void>;
}

async function runTenantManagementScenario(instance: MultiTenantRuntime) {
  const platformIssuer = instance.issuer('_platforms');
  const tenantIssuer = instance.issuer('tenant-a');
  const platformApiOrigin = new URL(platformIssuer).origin;
  const tenantApiOrigin = new URL(tenantIssuer).origin;
  const [platformToken, tenantToken] = await Promise.all([
    issueManagementToken({
      issuer: platformIssuer,
      clientId: PLATFORM_CLIENT_ID,
      clientSecret: PLATFORM_CLIENT_SECRET,
      scope: PLATFORM_SCOPES,
    }),
    issueManagementToken({
      issuer: tenantIssuer,
      clientId: TENANT_CLIENT_ID,
      clientSecret: TENANT_CLIENT_SECRET,
      scope: TENANT_SCOPES,
    }),
  ]);

  expect((await apiRequest(platformApiOrigin, '/tenants')).status).toBe(401);
  expect(
    (
      await apiRequest(tenantApiOrigin, '/tenants', {
        token: tenantToken,
      })
    ).status
  ).toBe(403);

  const malformed = await apiRequest(platformApiOrigin, '/tenants', {
    method: 'POST',
    token: platformToken,
    body: JSON.stringify({ slug: '-invalid', display_name: '' }),
  });
  expect(malformed.status).toBe(422);

  const create = await apiRequest(platformApiOrigin, '/tenants', {
    method: 'POST',
    token: platformToken,
    body: JSON.stringify({
      slug: 'tenant-created',
      display_name: 'Tenant created by E2E',
      domain: 'tenant-created.example.test',
    }),
  });
  expect(create.status).toBe(201);
  expect(
    ((await create.json()) as ApiEnvelope<TenantRecord>).data
  ).toMatchObject({
    slug: 'tenant-created',
    display_name: 'Tenant created by E2E',
    status: 'active',
  });

  const duplicate = await apiRequest(platformApiOrigin, '/tenants', {
    method: 'POST',
    token: platformToken,
    body: JSON.stringify({
      slug: 'tenant-created',
      display_name: 'Duplicate tenant',
    }),
  });
  expect(duplicate.status).toBe(409);

  const firstPage = await apiRequest(
    platformApiOrigin,
    '/tenants?limit=1&include_count=true',
    { token: platformToken }
  );
  expect(firstPage.status).toBe(200);
  const firstList = (await firstPage.json()) as ApiList<TenantRecord>;
  expect(firstList.data).toHaveLength(1);
  expect(firstList.pagination).toMatchObject({
    has_more: true,
    next_cursor: expect.any(String),
    total_count: expect.any(Number),
  });
  expect(firstList.pagination.total_count).toBeGreaterThanOrEqual(4);

  const secondPage = await apiRequest(
    platformApiOrigin,
    `/tenants?limit=1&after=${encodeURIComponent(firstList.pagination.next_cursor!)}`,
    { token: platformToken }
  );
  expect(secondPage.status).toBe(200);
  const secondList = (await secondPage.json()) as ApiList<TenantRecord>;
  expect(secondList.data).toHaveLength(1);
  expect(secondList.data[0]?.slug).not.toBe(firstList.data[0]?.slug);

  const get = await apiRequest(platformApiOrigin, '/tenants/tenant-created', {
    token: platformToken,
  });
  expect(get.status).toBe(200);
  expect(((await get.json()) as ApiEnvelope<TenantRecord>).data.slug).toBe(
    'tenant-created'
  );
  expect(
    (
      await apiRequest(platformApiOrigin, '/tenants/missing-tenant', {
        token: platformToken,
      })
    ).status
  ).toBe(404);

  const initialConfig = await apiRequest(
    platformApiOrigin,
    '/tenants/tenant-created/config',
    { token: platformToken }
  );
  expect(initialConfig.status).toBe(200);
  expect(
    ((await initialConfig.json()) as ApiEnvelope<unknown>).data
  ).toBeNull();

  const invalidSection = await apiRequest(
    platformApiOrigin,
    '/tenants/tenant-created/config/not-allowed',
    {
      method: 'PUT',
      token: platformToken,
      body: JSON.stringify({ value: true }),
    }
  );
  expect(invalidSection.status).toBe(400);

  const update = await apiRequest(
    platformApiOrigin,
    '/tenants/tenant-created/config/branding',
    {
      method: 'PUT',
      token: platformToken,
      body: JSON.stringify({ companyName: 'Tenant E2E Brand' }),
    }
  );
  expect(update.status).toBe(200);

  const updatedConfig = await apiRequest(
    platformApiOrigin,
    '/tenants/tenant-created/config',
    { token: platformToken }
  );
  expect(updatedConfig.status).toBe(200);
  expect(
    ((await updatedConfig.json()) as ApiEnvelope<Record<string, unknown>>).data
  ).toMatchObject({ branding: { companyName: 'Tenant E2E Brand' } });
}

const tenants = [
  { slug: 'tenant-a', display_name: 'Tenant A' },
  { slug: 'tenant-b', display_name: 'Tenant B' },
];
const clients = [
  {
    tenantId: '_platforms',
    client: machineClient({
      clientId: PLATFORM_CLIENT_ID,
      clientSecret: PLATFORM_CLIENT_SECRET,
      scopes: PLATFORM_SCOPES,
    }),
  },
  {
    tenantId: 'tenant-a',
    client: machineClient({
      clientId: TENANT_CLIENT_ID,
      clientSecret: TENANT_CLIENT_SECRET,
      scopes: TENANT_SCOPES,
    }),
  },
];

test.describe('Management API tenants', () => {
  test('covers platform operations and tenant-local rejection on MongoDB', async () => {
    const instance = await startMongoMultiTenantParakoInstance({
      port: 19130,
      tenants,
      clients,
    });

    try {
      await runTenantManagementScenario(instance);
    } finally {
      await instance.stop();
    }
  });

  test('covers platform operations and tenant-local rejection on PostgreSQL', async () => {
    const instance = await startPostgresqlParakoInstance({
      port: 19131,
      postgresqlUrl: POSTGRESQL_URL!,
      multiTenancy: true,
      tenants,
      clients,
    });

    try {
      await runTenantManagementScenario(instance);
    } finally {
      await instance.stop();
    }
  });
});
