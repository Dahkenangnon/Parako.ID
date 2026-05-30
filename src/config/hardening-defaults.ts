/**
 * Runtime defaults for HTTP transport, caching, image processing, and the
 * service-worker scope.
 *
 * Values are intentionally kept in code rather than the application config
 * surface (Zod schema, file, database, admin UI) so that operators cannot
 * land an unintended configuration before the values have been proven in
 * production. Five knobs are exposed via environment variables to support
 * emergency tuning without a rebuild:
 *
 *   PARAKO_COMPRESSION_QUALITY    Brotli quality (0-11)
 *   PARAKO_COMPRESSION_THRESHOLD  Minimum compressible response size in bytes
 *   PARAKO_KEEPALIVE_MS           HTTP keep-alive timeout
 *   PARAKO_HEADERS_MS             HTTP headers timeout
 *   PARAKO_REQUEST_MS             Per-request lifetime cap
 */

const envNumber = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

export const HARDENING = {
  compression: {
    threshold: envNumber('PARAKO_COMPRESSION_THRESHOLD', 1024),
    brotliQuality: envNumber('PARAKO_COMPRESSION_QUALITY', 4),
    gzipLevel: 6,
    // Responses with sensitive secrets (CSRF tokens, session cookies) are not
    // compressed: the compression ratio leak is the BREACH side channel
    // described in RFC 7457 section 2.6. Static text assets remain compressed.
    compressHtml: false,
  },
  static: {
    maxAge: '1y',
    immutable: true,
    precompressed: { enabled: true, preferBrotli: true },
  },
  cache: { varyIncludeAcceptLanguage: true },
  timeouts: {
    keepAliveMs: envNumber('PARAKO_KEEPALIVE_MS', 65_000),
    headersMs: envNumber('PARAKO_HEADERS_MS', 70_000),
    requestMs: envNumber('PARAKO_REQUEST_MS', 300_000),
    tcpNoDelay: true,
  },
  oidcCache: {
    // Upper bound on the JWKS Cache-Control max-age. The effective max-age is
    // clamped further by half the key overlap window so a cached JWKS cannot
    // point at a rotated-out key.
    jwksMaxAgeCap: 3_600,
    // OAuth 2.0 Authorization Server Metadata (RFC 8414) cache lifetime. Kept
    // short so policy changes (signing algs, endpoints, auth methods) propagate
    // promptly; ETag plus 304 carries the request-cost optimization.
    discoveryMaxAge: 3_600,
  },
  images: {
    widths: [320, 640, 1024, 1600],
    webp: { quality: 75, effort: 4 },
    avif: { quality: 55, effortBuild: 6, effortUpload: 3 },
    jpeg: { quality: 80, progressive: true },
    // Inputs larger than this are processed asynchronously through BullMQ so
    // upload requests do not block the event loop on AVIF encoding.
    uploadAsyncThresholdBytes: 1_048_576,
  },
  serviceWorker: {
    enabled: true,
    scope: '/',
    cacheStrategy: 'stale-while-revalidate',
  },
  bruteForce: {
    // Failed-login budget keyed on identifier+IP. Counts only requests whose
    // response status is >= 400 so a correct password resets the counter to
    // zero. The narrow key catches password guessing against a single
    // account from one origin.
    perIdentifier: {
      max: 5,
      windowMs: 60 * 60 * 1000,
    },
    // Failed-login budget keyed on IP alone. Catches username spraying that
    // the per-identifier counter would not see, since spraying changes the
    // identifier on every attempt.
    perIp: {
      max: 100,
      windowMs: 24 * 60 * 60 * 1000,
    },
  },
} as const;

// Node http requires headersTimeout to exceed keepAliveTimeout. With the
// inverse, a kept-alive socket can outlive its headers deadline and slow-header
// detection is disabled.
if (HARDENING.timeouts.headersMs <= HARDENING.timeouts.keepAliveMs) {
  throw new Error(
    'HARDENING.timeouts.headersMs must exceed HARDENING.timeouts.keepAliveMs'
  );
}
