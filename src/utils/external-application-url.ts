import type { RuntimeConfig } from '../config/types.js';

type ExternalApplicationConfig = Pick<RuntimeConfig, 'deployment' | 'oidc'>;

/**
 * Build an absolute Parako application URL from trusted runtime configuration.
 * Tenant overlays recompute the OIDC issuer with the tenant subdomain or custom
 * domain, making its origin the authoritative tenant-aware application origin.
 * This deliberately avoids deriving security-sensitive email links from the
 * request Host header.
 */
export function buildExternalApplicationUrl(
  config: ExternalApplicationConfig,
  pathname: string,
  searchParams: Record<string, string> = {}
): string {
  let origin: string;

  try {
    origin = new URL(config.oidc.issuer).origin;
  } catch {
    origin = new URL(config.deployment.url).origin;
  }

  const url = new URL(pathname, `${origin}/`);
  for (const [name, value] of Object.entries(searchParams)) {
    url.searchParams.set(name, value);
  }
  return url.toString();
}
