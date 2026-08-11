import { describe, expect, it } from 'vitest';

import type { RuntimeConfig } from '../../../src/config/types.js';
import { buildExternalApplicationUrl } from '../../../src/utils/external-application-url.js';

type ExternalApplicationConfig = Pick<RuntimeConfig, 'deployment' | 'oidc'>;

function config(
  issuer: string,
  deploymentUrl = 'https://id.example.test/base'
): ExternalApplicationConfig {
  return {
    deployment: { url: deploymentUrl },
    oidc: { issuer },
  } as ExternalApplicationConfig;
}

describe('buildExternalApplicationUrl', () => {
  it('uses the tenant-aware issuer origin without retaining the issuer path', () => {
    expect(
      buildExternalApplicationUrl(
        config('https://acme.id.example.test/oidc/v1'),
        '/auth/reset-password',
        { token: 'reset-token' }
      )
    ).toBe(
      'https://acme.id.example.test/auth/reset-password?token=reset-token'
    );
  });

  it('falls back to the trusted deployment origin for an invalid issuer', () => {
    expect(
      buildExternalApplicationUrl(
        config('not-a-url', 'https://id.example.test/deployment/path'),
        '/auth/verify-email'
      )
    ).toBe('https://id.example.test/auth/verify-email');
  });

  it('URL-encodes query parameters instead of interpolating untrusted values', () => {
    expect(
      buildExternalApplicationUrl(
        config('https://id.example.test/oidc/v1'),
        '/accounts/verify-recovery-email',
        { token: 'token&next=https://attacker.example' }
      )
    ).toBe(
      'https://id.example.test/accounts/verify-recovery-email?token=token%26next%3Dhttps%3A%2F%2Fattacker.example'
    );
  });
});
