import { isIP } from 'node:net';

const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;

export class InvalidTenantDomainError extends Error {
  constructor() {
    super('Domain must be a hostname without a scheme, port, or path');
    this.name = 'InvalidTenantDomainError';
  }
}

/**
 * Canonicalize a tenant-owned DNS hostname before uniqueness checks or
 * persistence. DNS names are case-insensitive, and a final root label dot is
 * equivalent to the same hostname without it.
 */
export function normalizeTenantDomain(domain: string): string {
  const normalized = domain.trim().toLowerCase().replace(/\.$/, '');
  if (!HOSTNAME_PATTERN.test(normalized) || isIP(normalized) !== 0) {
    throw new InvalidTenantDomainError();
  }
  return normalized;
}
