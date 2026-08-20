import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BootstrapEnvironment,
  readEnvironmentVariable,
} from '../../../src/config/bootstrap-environment.js';

describe('BootstrapEnvironment', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('preserves encryption key bytes exactly', () => {
    vi.stubEnv('ENCRYPTION_KEY', ' 32-byte-key-material-is-not-trimmed ');

    expect(new BootstrapEnvironment().encryptionKey).toBe(
      ' 32-byte-key-material-is-not-trimmed '
    );
  });

  it('normalizes external API credentials', () => {
    vi.stubEnv('IPINFO_API_TOKEN', ' ipinfo-token ');
    vi.stubEnv('IPQUALITYSCORE_API_KEY', '   ');

    const environment = new BootstrapEnvironment();

    expect(environment.ipinfoApiToken).toBe('ipinfo-token');
    expect(environment.ipQualityScoreApiKey).toBeUndefined();
  });

  it('reads arbitrary environment variables through the explicit boundary', () => {
    vi.stubEnv('PARAKO_TEST_BOUNDARY', 'configured');

    expect(readEnvironmentVariable('PARAKO_TEST_BOUNDARY')).toBe('configured');
  });
});
