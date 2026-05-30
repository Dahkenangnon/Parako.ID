/// <reference lib="webworker" />

/**
 * Minimal service worker for content-hashed static assets.
 *
 * The worker intercepts requests for the immutable, hash-bearing asset
 * namespace only. Requests for HTML, OIDC, authentication, admin, and API
 * routes fall through to the network so authentication semantics, session
 * cookies, and CSRF tokens follow their normal lifecycle.
 */

declare const __PARAKO_BUILD_ID__: string;
declare const __PARAKO_PRECACHE__: readonly string[];

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE_NAME = `parako-static-${__PARAKO_BUILD_ID__}`;
const HASHED_PATH = /^\/(?:css|js|images)\/.+-[A-Za-z0-9]{4,32}\.[a-z0-9]+$/;

sw.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(__PARAKO_PRECACHE__ as string[]);
      await sw.skipWaiting();
    })()
  );
});

sw.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            name => name.startsWith('parako-static-') && name !== CACHE_NAME
          )
          .map(name => caches.delete(name))
      );
      await sw.clients.claim();
    })()
  );
});

const handleFetch = async (request: Request): Promise<Response> => {
  const cached = await caches.match(request);
  const networkFetch = fetch(request)
    .then(async response => {
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone()).catch(() => undefined);
      }
      return response;
    })
    .catch(() => cached);

  if (cached) return cached;
  const response = await networkFetch;
  if (response) return response;
  return Response.error();
};

sw.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.origin !== sw.location.origin) return;
  if (!HASHED_PATH.test(url.pathname)) return;

  event.respondWith(handleFetch(request));
});
