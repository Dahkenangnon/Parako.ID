import { describe, expect, it, vi } from 'vitest';

import { createOidcCacheMiddleware } from '../../../src/oidc/middleware/cache-headers.js';

function createContext(overrides: Record<string, unknown> = {}) {
  const responseHeaders = new Map<string, string>();
  const requestHeaders = new Map<string, string>();
  const context = {
    status: 200,
    body: { keys: [{ kid: 'key-1' }] },
    oidc: { route: 'jwks' },
    set: vi.fn((name: string, value: string) => {
      responseHeaders.set(name.toLowerCase(), value);
    }),
    get: vi.fn((name: string) => requestHeaders.get(name.toLowerCase()) ?? ''),
    vary: vi.fn(),
    remove: vi.fn((name: string) => {
      responseHeaders.delete(name.toLowerCase());
    }),
    ...overrides,
  };

  return { context, requestHeaders, responseHeaders };
}

function createMiddleware(overlapWindowSeconds = 7_200) {
  return createOidcCacheMiddleware({
    getConfig: () => ({
      security: {
        key_store: { overlap_window_seconds: overlapWindowSeconds },
      },
    }),
  } as never);
}

describe('OIDC cache headers', () => {
  it.each([
    [500, 'jwks'],
    [200, 'token'],
    [200, undefined],
  ])('leaves status %i route %s uncached', async (status, route) => {
    const { context, responseHeaders } = createContext({
      status,
      oidc: route ? { route } : undefined,
    });

    await createMiddleware()(context as never, vi.fn());

    expect(responseHeaders.size).toBe(0);
    expect(context.vary).not.toHaveBeenCalled();
  });

  it('adds bounded public caching and a strong ETag to JWKS responses', async () => {
    const { context, responseHeaders } = createContext();
    const next = vi.fn();

    await createMiddleware()(context as never, next);

    expect(next).toHaveBeenCalledOnce();
    expect(responseHeaders.get('cache-control')).toBe('public, max-age=3600');
    expect(responseHeaders.get('etag')).toMatch(/^"[a-f0-9]{64}"$/);
    expect(context.vary).toHaveBeenCalledWith('Accept-Encoding');
    expect(context.status).toBe(200);
  });

  it.each([
    [30, 60],
    [1_200, 600],
    [100_000, 3_600],
  ])(
    'clamps a %i-second overlap window to a %i-second JWKS cache lifetime',
    async (overlapWindowSeconds, expectedMaxAge) => {
      const { context, responseHeaders } = createContext();

      await createMiddleware(overlapWindowSeconds)(context as never, vi.fn());

      expect(responseHeaders.get('cache-control')).toBe(
        `public, max-age=${expectedMaxAge}`
      );
    }
  );

  it('uses the hardened default when key overlap configuration is absent', async () => {
    const { context, responseHeaders } = createContext();
    const middleware = createOidcCacheMiddleware({
      getConfig: () => ({}),
    } as never);

    await middleware(context as never, vi.fn());

    expect(responseHeaders.get('cache-control')).toBe('public, max-age=3600');
  });

  it('caches a string discovery document using the hardened lifetime', async () => {
    const { context, responseHeaders } = createContext({
      body: '{"issuer":"https://issuer.example"}',
      oidc: { route: 'discovery' },
    });

    await createMiddleware()(context as never, vi.fn());

    expect(responseHeaders.get('cache-control')).toBe('public, max-age=3600');
    expect(responseHeaders.get('etag')).toMatch(/^"[a-f0-9]{64}"$/);
  });

  it('returns 304 when a weak matching ETag appears in If-None-Match', async () => {
    const middleware = createMiddleware();
    const first = createContext();
    await middleware(first.context as never, vi.fn());
    const etag = first.responseHeaders.get('etag')!;
    const second = createContext();
    second.requestHeaders.set('if-none-match', `"other", W/${etag}`);

    await middleware(second.context as never, vi.fn());

    expect(second.context.status).toBe(304);
    expect(second.context.body).toBeNull();
    expect(second.context.remove).toHaveBeenCalledWith('Content-Length');
    expect(second.context.remove).toHaveBeenCalledWith('Content-Type');
    expect(second.context.remove).toHaveBeenCalledWith('Content-Encoding');
  });

  it.each([
    ['*', 304, true],
    ['"different-tag"', 200, false],
  ])(
    'handles If-None-Match %s with status %i',
    async (ifNoneMatch, expectedStatus, expectedNotModified) => {
      const { context, requestHeaders } = createContext();
      requestHeaders.set('if-none-match', ifNoneMatch);

      await createMiddleware()(context as never, vi.fn());

      expect(context.status).toBe(expectedStatus);
      expect(context.body === null).toBe(expectedNotModified);
    }
  );
});
