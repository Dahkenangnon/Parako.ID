import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateSecureRandomString: vi.fn(),
  getPackageJson: vi.fn(),
}));

vi.mock('../../../src/utils/misc.js', () => ({
  generateSecureRandomString: mocks.generateSecureRandomString,
}));

vi.mock('../../../src/utils/filesystem.js', () => ({
  FileSystemUtils: class {
    getPackageJson = mocks.getPackageJson;
  },
}));

const SECRET_ENV_VARS = [
  'JWT_SECRET',
  'COOKIE_SECRET_1',
  'COOKIE_SECRET_2',
  'HMAC_SECRET',
  'PAIRWISE_SALT',
] as const;

async function importConstants() {
  vi.resetModules();
  return import('../../../src/config/constants.js');
}

function stubMissingSecrets() {
  for (const envVar of SECRET_ENV_VARS) {
    vi.stubEnv(envVar, '');
  }
  vi.stubEnv('SMTP_PASSWORD', '');
}

describe('default full configuration', () => {
  beforeEach(() => {
    mocks.generateSecureRandomString.mockReset();
    mocks.getPackageJson.mockReset().mockResolvedValue({
      description: 'Self-hosted identity provider',
    });
    let sequence = 0;
    mocks.generateSecureRandomString.mockImplementation(length => {
      sequence += 1;
      return `generated-${length}-${sequence}`;
    });
    stubMissingSecrets();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('generates development secrets once and returns mutation-safe copies', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { getDefaultFullConfig } = await importConstants();

    const first = getDefaultFullConfig();
    const second = getDefaultFullConfig();

    expect(mocks.generateSecureRandomString).toHaveBeenCalledTimes(5);
    expect(mocks.generateSecureRandomString).toHaveBeenCalledWith(32);
    expect(first.security.secrets).toEqual(second.security.secrets);
    expect(first.oidc.secrets).toEqual(second.oidc.secrets);
    expect(first).not.toBe(second);
    expect(first.application).not.toBe(second.application);

    first.application.title = 'Mutated by caller';
    first.security.secrets.cookie_secrets[0] = 'mutated';
    const third = getDefaultFullConfig();

    expect(third.application.title).toBe('Parako.ID');
    expect(third.security.secrets.cookie_secrets[0]).toBe('generated-32-2');
    expect(third.application.description).toBe('Self-hosted identity provider');
    expect(third.integrations.email.smtp_password).toBe('not-configured');
    expect(third.deployment.cookies.defaults.secure).toBe(false);
    expect(third.deployment.cookies.types.session.secure).toBe(false);
    expect(third.deployment.cookies.types.locale.secure).toBe(false);
    expect(third.deployment.cookies.types.theme.secure).toBe(false);
  });

  it('fails closed when a required production secret is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { getDefaultFullConfig } = await importConstants();

    expect(() => getDefaultFullConfig()).toThrow(
      '[FATAL] JWT_SECRET is not set. JWT signing secret must be explicitly configured in production.'
    );
  });

  it('uses configured production secrets and secure cookie defaults', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    SECRET_ENV_VARS.forEach((envVar, index) => {
      vi.stubEnv(envVar, `configured-secret-${index + 1}`);
    });
    vi.stubEnv('SMTP_PASSWORD', 'configured-smtp-password');
    const { getDefaultFullConfig } = await importConstants();

    const config = getDefaultFullConfig();

    expect(config.security.secrets).toMatchObject({
      jwt_secret: 'configured-secret-1',
      cookie_secrets: ['configured-secret-2', 'configured-secret-3'],
      hmac_secret: 'configured-secret-4',
    });
    expect(config.oidc.secrets.pairwise_salt).toBe('configured-secret-5');
    expect(config.integrations.email.smtp_password).toBe(
      'configured-smtp-password'
    );
    expect(config.deployment.cookies.defaults.secure).toBe(true);
    expect(config.deployment.cookies.types.session.secure).toBe(true);
    expect(config.deployment.cookies.types.locale.secure).toBe(true);
    expect(config.deployment.cookies.types.theme.secure).toBe(true);
    expect(mocks.generateSecureRandomString).not.toHaveBeenCalled();
  });

  it('exports stable web-safe font choices', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { WEB_SAFE_FONTS } = await importConstants();

    expect(WEB_SAFE_FONTS.sans).toContainEqual({
      value: 'system-ui, sans-serif',
      label: 'System Default',
    });
    expect(WEB_SAFE_FONTS.mono).toContainEqual({
      value: 'monospace',
      label: 'System Monospace',
    });
    expect(new Set(WEB_SAFE_FONTS.sans.map(font => font.value)).size).toBe(
      WEB_SAFE_FONTS.sans.length
    );
    expect(new Set(WEB_SAFE_FONTS.mono.map(font => font.value)).size).toBe(
      WEB_SAFE_FONTS.mono.length
    );
  });
});
