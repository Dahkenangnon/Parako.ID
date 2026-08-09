import { afterEach, describe, expect, it } from 'vitest';

import {
  buildRedisKey,
  buildRedisKeyForTenant,
} from '../../../src/multi-tenancy/redis-key.js';
import {
  DEFAULT_TENANT_ID,
  tenantContext,
} from '../../../src/multi-tenancy/tenant-context.js';

describe('tenant-aware Redis keys', () => {
  afterEach(() => {
    tenantContext.disableStrictMode();
  });

  it('uses the default tenant outside an explicit context', () => {
    expect(buildRedisKey('parako', 'oidc', 'Session', 'session-1')).toBe(
      `parako:${DEFAULT_TENANT_ID}:oidc:Session:session-1`
    );
  });

  it('isolates the same Redis segments by active tenant context', () => {
    const acme = tenantContext.run('acme', () =>
      buildRedisKey('parako', 'rl', 'login', '127.0.0.1')
    );
    const globex = tenantContext.run('globex', () =>
      buildRedisKey('parako', 'rl', 'login', '127.0.0.1')
    );

    expect(acme).toBe('parako:acme:rl:login:127.0.0.1');
    expect(globex).toBe('parako:globex:rl:login:127.0.0.1');
    expect(acme).not.toBe(globex);
  });

  it('builds a tenant namespace even when there are no trailing segments', () => {
    expect(tenantContext.run('acme', () => buildRedisKey('parako'))).toBe(
      'parako:acme'
    );
  });

  it('uses the explicit tenant without consulting ALS', () => {
    tenantContext.enableStrictMode();

    expect(
      buildRedisKeyForTenant('parako', 'captured-tenant', 'jwks', 'promoted')
    ).toBe('parako:captured-tenant:jwks:promoted');
  });

  it('lets an explicit tenant override an unrelated active context', () => {
    expect(
      tenantContext.run('request-tenant', () =>
        buildRedisKeyForTenant('parako', 'job-tenant', 'activity')
      )
    ).toBe('parako:job-tenant:activity');
  });
});
