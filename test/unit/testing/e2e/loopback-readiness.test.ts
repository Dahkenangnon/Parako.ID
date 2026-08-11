import { createServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { probeLoopbackReadiness } from '../../../e2e/support/loopback-readiness.mjs';

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>((resolve, reject) => {
          server.close(error => (error ? reject(error) : resolve()));
        })
    )
  );
});

describe('loopback readiness probe', () => {
  it('preserves an unresolvable tenant Host while connecting to loopback', async () => {
    let observedHost: string | undefined;
    const server = createServer((request, response) => {
      observedHost = request.headers.host;
      response.writeHead(request.url === '/readyz' ? 200 : 404).end();
    });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected an ephemeral TCP address');
    }

    await expect(
      probeLoopbackReadiness(
        `http://browser-e2e.idp.localhost:${address.port}/readyz`
      )
    ).resolves.toBe(true);
    expect(observedHost).toBe(`browser-e2e.idp.localhost:${address.port}`);
  });

  it('returns false for a non-ready status and rejects unsupported protocols', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(503).end();
    });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected an ephemeral TCP address');
    }

    await expect(
      probeLoopbackReadiness(`http://tenant.localhost:${address.port}/readyz`)
    ).resolves.toBe(false);
    await expect(
      probeLoopbackReadiness('https://tenant.localhost/readyz')
    ).rejects.toThrow('Unsupported readiness protocol: https:');
  });
});
