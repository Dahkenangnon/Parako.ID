import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  apiRequest,
  issueManagementToken,
  machineClient,
} from '../../../e2e/support/deployment-management-api.js';

async function withLoopbackServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  operation: (port: number) => Promise<void>
): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('expected the probe server to use a TCP address');
  }

  try {
    await operation(address.port);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
}

describe('deployment Management API E2E support', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a client-credentials fixture with explicit resource scopes', () => {
    expect(
      machineClient({
        clientId: 'matrix-client',
        clientSecret: 'matrix-secret',
        scopes: 'parako:users:read parako:stats:read',
      })
    ).toEqual({
      client_id: 'matrix-client',
      client_secret: 'matrix-secret',
      client_name: 'matrix-client client',
      application_type: 'web',
      token_endpoint_auth_method: 'client_secret_basic',
      grant_types: ['client_credentials'],
      response_types: [],
      scope: '',
      allowedResources: ['urn:parako:api:v1'],
      resourcesScopes: 'parako:users:read parako:stats:read',
    });
  });

  it('preserves explicit resource and token-lifetime metadata for security fixtures', () => {
    expect(
      machineClient({
        clientId: 'expiring-client',
        clientSecret: 'expiring-secret',
        scopes: 'profile',
        oidcScopes: 'profile',
        resources: ['urn:example:wrong-audience'],
        ttl: { ClientCredentials: 1 },
      })
    ).toMatchObject({
      allowedResources: ['urn:example:wrong-audience'],
      scope: 'profile',
      resourcesScopes: 'profile',
      ttl: { ClientCredentials: 1 },
    });
  });

  it('issues a client-credentials token against the supplied tenant issuer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'matrix-token' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    await expect(
      issueManagementToken({
        issuer: 'http://tenant-a.parako.localhost:19140/oidc/v1',
        clientId: 'matrix-client',
        clientSecret: 'matrix-secret',
        scope: 'parako:users:read',
        fetchImplementation: fetchMock,
      })
    ).resolves.toBe('matrix-token');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://tenant-a.parako.localhost:19140/oidc/v1/token',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: `Basic ${Buffer.from(
            'matrix-client:matrix-secret'
          ).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        }),
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          resource: 'urn:parako:api:v1',
          scope: 'parako:users:read',
        }),
      })
    );
  });

  it('requests an explicit non-management resource for audience-negative tests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'wrong-audience-token' }), {
        status: 200,
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await issueManagementToken({
      issuer: 'http://127.0.0.1:19140/oidc/v1',
      clientId: 'wrong-audience-client',
      clientSecret: 'wrong-audience-secret',
      resource: 'urn:example:wrong-audience',
      scope: 'profile',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          resource: 'urn:example:wrong-audience',
          scope: 'profile',
        }),
      })
    );
  });

  it.each([
    [401, { error: 'invalid_client' }],
    [200, {}],
  ])('rejects an unusable token response (%s)', async (status, body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        })
      )
    );

    await expect(
      issueManagementToken({
        issuer: 'http://127.0.0.1:19140/oidc/v1',
        clientId: 'matrix-client',
        clientSecret: 'matrix-secret',
        scope: 'parako:users:read',
      })
    ).rejects.toThrow(
      status === 401 ? /invalid_client/ : /Management API token/
    );
  });

  it('targets the supplied API origin and composes request headers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));

    await apiRequest('http://tenant-a.parako.localhost:19140', '/users', {
      method: 'POST',
      token: 'matrix-token',
      headers: { 'x-request-marker': 'unit' },
      body: JSON.stringify({ email: 'user@example.test' }),
      fetchImplementation: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://tenant-a.parako.localhost:19140/api/v1/users',
      expect.objectContaining({
        method: 'POST',
        headers: {
          authorization: 'Bearer matrix-token',
          'content-type': 'application/json',
          'x-request-marker': 'unit',
        },
      })
    );
  });
  it('routes default tenant token requests through loopback', async () => {
    const observed: Record<string, string | undefined> = {};
    await withLoopbackServer(
      (request, response) => {
        observed.url = request.url;
        observed.host = request.headers.host;
        observed.tenant = request.headers['x-tenant-id'] as string | undefined;
        observed.authorization = request.headers.authorization;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ access_token: 'tenant-token' }));
      },
      async port => {
        await expect(
          issueManagementToken({
            issuer: `http://tenant-a.parako.localhost:${port}/oidc/v1`,
            clientId: 'matrix-client',
            clientSecret: 'matrix-secret',
            scope: 'parako:users:read',
          })
        ).resolves.toBe('tenant-token');
      }
    );

    expect(observed).toMatchObject({
      url: '/oidc/v1/token',
      tenant: 'tenant-a',
    });
    expect(observed.host).toMatch(/^tenant-a[.]parako[.]localhost:/);
    expect(observed.authorization).toMatch(/^Basic /);
  });

  it('routes default tenant API requests through loopback', async () => {
    const observed: Record<string, string | undefined> = {};
    await withLoopbackServer(
      (request, response) => {
        observed.url = request.url;
        observed.host = request.headers.host;
        observed.tenant = request.headers['x-tenant-id'] as string | undefined;
        observed.authorization = request.headers.authorization;
        response.writeHead(204).end();
      },
      async port => {
        const response = await apiRequest(
          `http://tenant-a.parako.localhost:${port}`,
          '/users',
          { token: 'tenant-token' }
        );
        expect(response.status).toBe(204);
      }
    );

    expect(observed).toMatchObject({
      url: '/api/v1/users',
      tenant: 'tenant-a',
      authorization: 'Bearer tenant-token',
    });
    expect(observed.host).toMatch(/^tenant-a[.]parako[.]localhost:/);
  });
});
