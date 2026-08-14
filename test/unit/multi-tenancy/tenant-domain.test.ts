import { describe, expect, it } from 'vitest';

import {
  InvalidTenantDomainError,
  normalizeTenantDomain,
} from '../../../src/multi-tenancy/tenant-domain.js';

describe('tenant domain normalization', () => {
  it('canonicalizes case, surrounding whitespace, and a final root label', () => {
    expect(normalizeTenantDomain('  Login.Example.COM.  ')).toBe(
      'login.example.com'
    );
  });

  it.each([
    '',
    'https://login.example.com',
    'login.example.com:443',
    'login.example.com/path',
    '.login.example.com',
    'login..example.com',
    '-login.example.com',
    'login-.example.com',
    'login_example.com',
    '127.0.0.1',
    '::1',
  ])('rejects a value that is not a routable DNS hostname: %s', domain => {
    expect(() => normalizeTenantDomain(domain)).toThrow(
      InvalidTenantDomainError
    );
  });
});
