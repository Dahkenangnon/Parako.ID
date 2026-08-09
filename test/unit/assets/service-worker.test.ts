import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type WorkerListener = (event: any) => void;

const worker = {
  listeners: new Map<string, WorkerListener>(),
  addEventListener: vi.fn((name: string, listener: WorkerListener) => {
    worker.listeners.set(name, listener);
  }),
  clients: { claim: vi.fn().mockResolvedValue(undefined) },
  location: { origin: 'https://idp.example.com' },
  skipWaiting: vi.fn().mockResolvedValue(undefined),
};

const cache = {
  addAll: vi.fn().mockResolvedValue(undefined),
  put: vi.fn().mockResolvedValue(undefined),
};

const cacheStorage = {
  delete: vi.fn().mockResolvedValue(true),
  keys: vi.fn().mockResolvedValue([]),
  match: vi.fn().mockResolvedValue(undefined),
  open: vi.fn().mockResolvedValue(cache),
};

const networkFetch = vi.fn();
const responseError = vi.fn(() => ({ ok: false, source: 'error' }));

function listener(name: string): WorkerListener {
  const value = worker.listeners.get(name);
  if (!value) throw new Error(`Missing worker listener: ${name}`);
  return value;
}

function request(url: string, method = 'GET'): { method: string; url: string } {
  return { method, url };
}

async function dispatchFetch(value: { method: string; url: string }) {
  const respondWith = vi.fn();
  listener('fetch')({ request: value, respondWith });
  const promise = respondWith.mock.calls[0]?.[0] as
    Promise<unknown> | undefined;
  return { respondWith, response: promise ? await promise : undefined };
}

describe('immutable-asset service worker', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    networkFetch.mockReset();
    worker.clients.claim.mockResolvedValue(undefined);
    worker.skipWaiting.mockResolvedValue(undefined);
    cache.addAll.mockResolvedValue(undefined);
    cache.put.mockResolvedValue(undefined);
    cacheStorage.delete.mockResolvedValue(true);
    cacheStorage.keys.mockResolvedValue([]);
    cacheStorage.match.mockResolvedValue(undefined);
    cacheStorage.open.mockResolvedValue(cache);
    vi.stubGlobal('self', worker);
    vi.stubGlobal('caches', cacheStorage);
    vi.stubGlobal('fetch', networkFetch);
    vi.stubGlobal('Response', { error: responseError });
    vi.stubGlobal('__PARAKO_BUILD_ID__', 'build-42');
    vi.stubGlobal('__PARAKO_PRECACHE__', ['/js/app-Ab12.js']);

    await import('../../../src/assets/js/sw/service-worker.js');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('precaches the current build and activates it immediately', async () => {
    const waitUntil = vi.fn();
    listener('install')({ waitUntil });

    await waitUntil.mock.calls[0]?.[0];

    expect(cacheStorage.open).toHaveBeenCalledWith('parako-static-build-42');
    expect(cache.addAll).toHaveBeenCalledWith(['/js/app-Ab12.js']);
    expect(worker.skipWaiting).toHaveBeenCalledOnce();
  });

  it('deletes only obsolete Parako caches before claiming clients', async () => {
    cacheStorage.keys.mockResolvedValue([
      'parako-static-old',
      'parako-static-build-42',
      'another-app-cache',
    ]);
    const waitUntil = vi.fn();
    listener('activate')({ waitUntil });

    await waitUntil.mock.calls[0]?.[0];

    expect(cacheStorage.delete).toHaveBeenCalledTimes(1);
    expect(cacheStorage.delete).toHaveBeenCalledWith('parako-static-old');
    expect(worker.clients.claim).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'non-GET requests',
      request('https://idp.example.com/js/app-Ab12.js', 'POST'),
    ],
    ['invalid URLs', request('not a URL')],
    ['cross-origin assets', request('https://cdn.example.com/js/app-Ab12.js')],
    ['non-hashed paths', request('https://idp.example.com/js/app.js')],
  ])('ignores %s', async (_name, value) => {
    const result = await dispatchFetch(value);

    expect(result.respondWith).not.toHaveBeenCalled();
    expect(cacheStorage.match).not.toHaveBeenCalled();
  });

  it('returns a cached asset immediately and refreshes it in the background', async () => {
    const cached = { ok: true, source: 'cache' };
    const fresh = {
      ok: true,
      source: 'network',
      clone: vi.fn(() => ({ source: 'clone' })),
    };
    cacheStorage.match.mockResolvedValue(cached);
    networkFetch.mockResolvedValue(fresh);

    const result = await dispatchFetch(
      request('https://idp.example.com/js/app-Ab12.js')
    );
    await vi.waitFor(() => expect(cache.put).toHaveBeenCalledOnce());

    expect(result.response).toBe(cached);
    expect(cache.put).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringContaining('app-Ab12.js') }),
      { source: 'clone' }
    );
  });

  it('returns a non-cacheable network response without writing it', async () => {
    const response = { ok: false, source: 'network' };
    networkFetch.mockResolvedValue(response);

    const result = await dispatchFetch(
      request('https://idp.example.com/css/app-Ab12.css')
    );

    expect(result.response).toBe(response);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('keeps a successful network response when the cache write fails', async () => {
    const response = {
      ok: true,
      source: 'network',
      clone: vi.fn(() => ({ source: 'clone' })),
    };
    networkFetch.mockResolvedValue(response);
    cache.put.mockRejectedValue(new Error('quota exceeded'));

    const result = await dispatchFetch(
      request('https://idp.example.com/images/logo-Ab12.svg')
    );
    await Promise.resolve();

    expect(result.response).toBe(response);
  });

  it('returns an error response when both cache and network are unavailable', async () => {
    networkFetch.mockRejectedValue(new Error('offline'));

    const result = await dispatchFetch(
      request('https://idp.example.com/js/app-Ab12.js')
    );

    expect(responseError).toHaveBeenCalledOnce();
    expect(result.response).toEqual({ ok: false, source: 'error' });
  });
});
