import { UAParser } from 'ua-parser-js';

/**
 * Isolate the third-party parser so callers share one stable, locally owned
 * interface and dependency upgrades do not leak throughout the application.
 */
export function parseUserAgent(userAgent: string) {
  return new UAParser(userAgent).getResult();
}
