import { createServer } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import { createLoopbackTenantFetch } from '../../../e2e/support/loopback-tenant-fetch.js';

describe('loopback tenant fetch support', () => {
  it('routes a local tenant hostname through loopback with tenant context', async () => {
    const delegate = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const tenantFetch = createLoopbackTenantFetch(
      'http://parako.localhost:19382',
      delegate
    );

    await tenantFetch(
      'http://account-matrix.parako.localhost:19382/oidc/v1/token?mode=test',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-token',
          'x-forwarded-host': 'attacker.example',
          'x-forwarded-proto': 'https',
        },
        body: 'grant_type=client_credentials',
      }
    );

    expect(delegate).toHaveBeenCalledOnce();
    const [target, init] = delegate.mock.calls[0]!;
    expect(String(target)).toBe(
      'http://account-matrix.parako.localhost:19382/oidc/v1/token?mode=test'
    );
    expect(new Headers(init?.headers)).toEqual(expect.objectContaining({}));
    expect(new Headers(init?.headers).get('authorization')).toBe(
      'Bearer test-token'
    );
    expect(new Headers(init?.headers).get('x-tenant-id')).toBe(
      'account-matrix'
    );
    expect(new Headers(init?.headers).has('host')).toBe(false);
    expect(new Headers(init?.headers).has('x-forwarded-host')).toBe(false);
    expect(new Headers(init?.headers).has('x-forwarded-proto')).toBe(false);
  });

  it('routes a tenant hostname beneath a custom localhost deployment domain', async () => {
    const delegate = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const tenantFetch = createLoopbackTenantFetch(
      'http://127.0.0.1:19382',
      delegate
    );

    await tenantFetch('http://browser-e2e.idp.localhost:19382/api/v1/users');

    expect(delegate).toHaveBeenCalledWith(
      'http://browser-e2e.idp.localhost:19382/api/v1/users',
      expect.objectContaining({
        headers: { 'x-tenant-id': 'browser-e2e' },
      })
    );
  });

  it('preserves the tenant Host header over a real loopback connection', async () => {
    let observedHost: string | undefined;
    const server = createServer((request, response) => {
      observedHost = request.headers.host;
      response.writeHead(204).end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('expected the probe server to use a TCP address');
    }
    const tenantFetch = createLoopbackTenantFetch(
      `http://127.0.0.1:${address.port}`
    );

    try {
      const response = await tenantFetch(
        `http://tenant.parako.localhost:${address.port}/probe`
      );
      expect(response.status).toBe(204);
      expect(observedHost).toBe(`tenant.parako.localhost:${address.port}`);
    } finally {
      await tenantFetch.close?.();
      await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      });
    }
  });

  it('accepts a tenant-scoped loopback origin', async () => {
    const delegate = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const tenantFetch = createLoopbackTenantFetch(
      'http://account-matrix.parako.localhost:19382',
      delegate
    );

    await tenantFetch('http://account-matrix.parako.localhost:19382/readyz');

    expect(delegate).toHaveBeenCalledWith(
      'http://account-matrix.parako.localhost:19382/readyz',
      expect.objectContaining({
        headers: { 'x-tenant-id': 'account-matrix' },
      })
    );
  });

  it('routes the base disposable hostname without inferring a tenant', async () => {
    const delegate = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const tenantFetch = createLoopbackTenantFetch(
      'http://127.0.0.1:19382',
      delegate
    );

    await tenantFetch('http://parako.localhost:19382/readyz');

    const [target, init] = delegate.mock.calls[0]!;
    expect(String(target)).toBe('http://parako.localhost:19382/readyz');
    const headers = new Headers(init?.headers);
    expect(headers.has('host')).toBe(false);
    expect(headers.has('x-tenant-id')).toBe(false);
  });

  it('routes reserved system tenant hostnames through loopback', async () => {
    const delegate = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const tenantFetch = createLoopbackTenantFetch(
      'http://127.0.0.1:19382',
      delegate
    );

    await tenantFetch(
      'http://_platforms.parako.localhost:19382/api/v1/tenants'
    );

    const [target, init] = delegate.mock.calls[0]!;
    expect(String(target)).toBe(
      'http://_platforms.parako.localhost:19382/api/v1/tenants'
    );
    expect(new Headers(init?.headers).get('x-tenant-id')).toBe('_platforms');
  });

  it('preserves non-tenant URLs and headers', async () => {
    const delegate = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const tenantFetch = createLoopbackTenantFetch(
      'http://127.0.0.1:19382',
      delegate
    );

    await tenantFetch('http://127.0.0.1:19382/readyz', {
      headers: { 'x-request-marker': 'unit' },
    });

    expect(delegate).toHaveBeenCalledWith(
      'http://127.0.0.1:19382/readyz',
      expect.objectContaining({
        headers: { 'x-request-marker': 'unit' },
      })
    );
  });

  it.each([
    'http://bad_name.parako.localhost:19382/readyz',
    'http://evil.example:19382/readyz',
  ])('does not infer a tenant from %s', async input => {
    const delegate = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const tenantFetch = createLoopbackTenantFetch(
      'http://127.0.0.1:19382',
      delegate
    );

    await tenantFetch(input);

    expect(delegate).toHaveBeenCalledWith(input, undefined);
  });
});
