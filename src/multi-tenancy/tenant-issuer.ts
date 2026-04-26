import type { ITenant } from '../types/tenant.js';

/**
 * Derive the OIDC issuer URL for a tenant.
 *
 * Priority:
 *  1. Explicit `issuer_url` on the tenant record
 *  2. Custom domain: `https://{tenant.domain}{oidcPath}`
 *  3. Subdomain of base domain: `https://{tenantId}.{baseDomain}{oidcPath}`
 */
export function deriveTenantIssuerUrl(
  tenantId: string,
  tenant: Pick<ITenant, 'issuer_url' | 'domain'>,
  deploymentUrl: string,
  oidcPath: string
): string {
  if (tenant.issuer_url) return tenant.issuer_url;
  const protocol = deploymentUrl.startsWith('https://')
    ? 'https://'
    : 'http://';
  if (tenant.domain) return `${protocol}${tenant.domain}${oidcPath}`;
  const baseDomain = deploymentUrl.replace(/^https?:\/\//, '');
  return `${protocol}${tenantId}.${baseDomain}${oidcPath}`;
}
