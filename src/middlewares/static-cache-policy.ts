import { basename } from 'node:path';
import type { Response } from 'express';

const REVALIDATED_STATIC_FILES: ReadonlySet<string> = new Set([
  'manifest.json',
  'manifest.webmanifest',
  'service-worker.js',
]);

/**
 * Keep browser bootstrap metadata and service-worker code on revalidation.
 * The helper is shared by ordinary and precompressed static responses so
 * content negotiation cannot change the cache-safety contract.
 */
export function setStaticAssetCacheHeaders(
  res: Pick<Response, 'setHeader'>,
  filePath: string
): void {
  const fileName = basename(filePath).replace(/\.(?:br|gz)$/u, '');
  if (REVALIDATED_STATIC_FILES.has(fileName)) {
    res.setHeader('Cache-Control', 'public, no-cache');
  }
}
