import type { Request, Response, NextFunction } from 'express';
import onHeaders from 'on-headers';
import { HARDENING } from '../config/hardening-defaults.js';

/**
 * Paths whose response body does not vary by locale or whose cache key would
 * otherwise explode by an order of magnitude with no benefit.
 */
const NON_LOCALIZED_PATH_PREFIXES: ReadonlyArray<string> = [
  '/css/',
  '/js/',
  '/images/',
  '/manifest.json',
  '/service-worker.js',
  '/manifest.webmanifest',
];

const isNonLocalizedPath = (path: string): boolean => {
  for (const prefix of NON_LOCALIZED_PATH_PREFIXES) {
    if (path === prefix || path.startsWith(prefix)) return true;
  }
  return false;
};

const isHtmlResponse = (res: Response): boolean => {
  const contentType = res.getHeader('Content-Type');
  return typeof contentType === 'string' && contentType.includes('text/html');
};

/**
 * Set Vary headers correctly for caches in front of the application.
 *
 * Accept-Encoding is always declared because compression is negotiated for
 * every response. Accept-Language is only declared on HTML responses outside
 * the static-asset namespace, so cache cardinality is not multiplied across
 * locales for resources whose bytes never change with the request language.
 */
export const varyHeadersMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  onHeaders(res, () => {
    res.vary('Accept-Encoding');
    if (
      HARDENING.cache.varyIncludeAcceptLanguage &&
      !isNonLocalizedPath(req.path) &&
      isHtmlResponse(res)
    ) {
      res.vary('Accept-Language');
    }
  });
  next();
};
