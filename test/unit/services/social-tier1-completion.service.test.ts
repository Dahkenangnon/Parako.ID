import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tier = vi.hoisted(() => ({
  consumeSocialRef: vi.fn(),
  resolveTier1Endpoints: vi.fn(),
  exchangeTier1Code: vi.fn(),
  fetchTier1UserProfile: vi.fn(),
  mapTier1Profile: vi.fn(),
  mapTier1Tokens: vi.fn(),
  extractBaseDomain: vi.fn(),
  getTenantIdSafe: vi.fn(),
}));

vi.mock('../../../src/integration/social-tier-utils.js', () => ({
  consumeSocialRef: tier.consumeSocialRef,
  resolveTier1Endpoints: tier.resolveTier1Endpoints,
  exchangeTier1Code: tier.exchangeTier1Code,
  fetchTier1UserProfile: tier.fetchTier1UserProfile,
  mapTier1Profile: tier.mapTier1Profile,
  mapTier1Tokens: tier.mapTier1Tokens,
  extractBaseDomain: tier.extractBaseDomain,
}));

vi.mock('../../../src/multi-tenancy/tenant-context.js', () => ({
  tenantContext: { getTenantIdSafe: tier.getTenantIdSafe },
}));

import { SocialTier1CompletionService } from '../../../src/services/social-tier1-completion.service.js';

const request = { session: { id: 'session-1' } } as any;
const providerConfig = {
  client_id: 'platform-client',
  client_secret: 'platform-secret',
};

function platformConfig(overrides: Record<string, unknown> = {}) {
  return {
    features: {
      social_providers: { google: providerConfig },
    },
    deployment: { url: 'https://example.com' },
    ...overrides,
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeRedis() {
  return {
    get: vi.fn(),
    getdel: vi.fn(),
    del: vi.fn(),
    set: vi.fn(),
  };
}

function makeService(
  options: {
    config?: unknown;
    redis?: ReturnType<typeof makeRedis> | null;
    managerResult?: unknown;
  } = {}
) {
  const logger = makeLogger();
  const configManager = {
    getConfig: vi.fn(() => options.config ?? platformConfig()),
  };
  const socialLoginManager = {
    completeTier1Flow: vi.fn().mockResolvedValue(
      options.managerResult ?? {
        success: true,
        user: { _id: 'user-1', email: 'alice@example.com' },
      }
    ),
  };
  const redis = options.redis === undefined ? makeRedis() : options.redis;
  const service = new SocialTier1CompletionService(
    logger as any,
    configManager as any,
    socialLoginManager as any,
    redis as any
  );

  return { configManager, logger, redis, service, socialLoginManager };
}

describe('SocialTier1CompletionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tier.getTenantIdSafe.mockReturnValue('tenant-a');
    tier.consumeSocialRef.mockResolvedValue({
      success: true,
      provider: 'google',
      code: 'authorization-code',
      tenant_id: 'tenant-a',
    });
    tier.resolveTier1Endpoints.mockReturnValue({
      token_endpoint: 'https://provider.example/token',
      userinfo_endpoint: 'https://provider.example/userinfo',
    });
    tier.extractBaseDomain.mockReturnValue('example.com');
    tier.exchangeTier1Code.mockResolvedValue({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
    });
    tier.fetchTier1UserProfile.mockResolvedValue({
      sub: 'provider-user-1',
      email: 'alice@example.com',
    });
    tier.mapTier1Profile.mockReturnValue({
      sub: 'provider-user-1',
      email: 'alice@example.com',
    });
    tier.mapTier1Tokens.mockReturnValue({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
    });
  });

  it('fails closed when the optional Redis relay is unavailable', async () => {
    const { service, logger } = makeService({ redis: null });

    await expect(service.complete('ref-1', 'google', request)).resolves.toEqual(
      { success: false, error: 'Service unavailable' }
    );
    expect(logger.error).toHaveBeenCalledWith('tier1_completion_no_redis', {
      message:
        'OpsRedisClient not bound. Tier 1 social completion is disabled.',
    });
    expect(tier.consumeSocialRef).not.toHaveBeenCalled();
  });

  it('returns one-time ref consumption failures without touching configuration', async () => {
    tier.consumeSocialRef.mockResolvedValue({
      success: false,
      error: 'Ref not found or expired',
    });
    const { service, logger, configManager } = makeService();

    await expect(service.complete('ref-1', 'google', request)).resolves.toEqual(
      { success: false, error: 'Ref not found or expired' }
    );
    expect(logger.warn).toHaveBeenCalledWith('tier1_completion_ref_failed', {
      provider: 'google',
      error: 'Ref not found or expired',
    });
    expect(configManager.getConfig).not.toHaveBeenCalled();
  });

  it('rejects a ref issued for a different provider', async () => {
    tier.consumeSocialRef.mockResolvedValue({
      success: true,
      provider: 'github',
      code: 'authorization-code',
      tenant_id: 'tenant-a',
    });
    const { service, logger } = makeService();

    await expect(service.complete('ref-1', 'google', request)).resolves.toEqual(
      { success: false, error: 'Provider mismatch' }
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'tier1_completion_provider_mismatch',
      { expected: 'google', actual: 'github' }
    );
  });

  it('rejects a cross-tenant ref before exchanging its code', async () => {
    tier.getTenantIdSafe.mockReturnValue('tenant-b');
    const { service, logger } = makeService();

    await expect(service.complete('ref-1', 'google', request)).resolves.toEqual(
      { success: false, error: 'Invalid request' }
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'tier1_completion_tenant_mismatch',
      { expected: 'tenant-b', actual: 'tenant-a', provider: 'google' }
    );
    expect(tier.exchangeTier1Code).not.toHaveBeenCalled();
  });

  it('supports single-tenant execution when no async tenant context exists', async () => {
    tier.getTenantIdSafe.mockReturnValue(undefined);
    const { service, socialLoginManager } = makeService();

    await expect(
      service.complete('ref-1', 'google', request)
    ).resolves.toMatchObject({ success: true });
    expect(socialLoginManager.completeTier1Flow).toHaveBeenCalledOnce();
  });

  it('rejects a provider absent from platform configuration', async () => {
    const { service, logger } = makeService({
      config: platformConfig({
        features: { social_providers: {} },
      }),
    });

    await expect(service.complete('ref-1', 'google', request)).resolves.toEqual(
      { success: false, error: 'Social login is not available' }
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'tier1_completion_provider_not_configured',
      { provider: 'google' }
    );
  });

  it('rejects providers whose safe Tier-1 endpoints cannot be resolved', async () => {
    tier.resolveTier1Endpoints.mockReturnValue(null);
    const { service, logger } = makeService();

    await expect(service.complete('ref-1', 'google', request)).resolves.toEqual(
      { success: false, error: 'Social login is not available' }
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'tier1_completion_endpoints_unresolved',
      { provider: 'google' }
    );
  });

  it.each([
    [{ client_id: undefined, client_secret: 'secret' }, 'client_id'],
    [{ client_id: 'client', client_secret: '   ' }, 'client_secret'],
    [{ client_id: 'client', client_secret: undefined }, 'client_secret'],
  ])(
    'fails before token exchange when platform credentials are incomplete: %s',
    async (credentials, missingField) => {
      const { service, logger } = makeService({
        config: platformConfig({
          features: { social_providers: { google: credentials } },
        }),
      });

      await expect(
        service.complete('ref-1', 'google', request)
      ).resolves.toEqual({
        success: false,
        error: 'Social login is not available',
      });
      expect(logger.warn).toHaveBeenCalledWith(
        'tier1_completion_credentials_missing',
        { provider: 'google', missingField }
      );
      expect(tier.exchangeTier1Code).not.toHaveBeenCalled();
    }
  );

  it('exchanges the code with trimmed credentials and the _ops callback URI', async () => {
    const { service } = makeService({
      config: platformConfig({
        features: {
          social_providers: {
            google: {
              client_id: ' platform-client ',
              client_secret: ' platform-secret ',
            },
          },
        },
      }),
    });

    await service.complete('ref-1', 'google', request);

    expect(tier.extractBaseDomain).toHaveBeenCalledWith('https://example.com');
    expect(tier.exchangeTier1Code).toHaveBeenCalledWith('authorization-code', {
      token_endpoint: 'https://provider.example/token',
      client_id: 'platform-client',
      client_secret: 'platform-secret',
      redirect_uri: 'https://_ops.example.com/social/google/callback',
    });
  });

  it('rejects an unresolved deployment base domain before token exchange', async () => {
    tier.extractBaseDomain.mockReturnValue('');
    const { service, logger } = makeService({
      config: platformConfig({ deployment: {} }),
    });

    await expect(service.complete('ref-1', 'google', request)).resolves.toEqual(
      { success: false, error: 'Social login is not available' }
    );
    expect(tier.extractBaseDomain).toHaveBeenCalledWith('');
    expect(logger.warn).toHaveBeenCalledWith(
      'tier1_completion_base_domain_unresolved',
      { provider: 'google' }
    );
    expect(tier.exchangeTier1Code).not.toHaveBeenCalled();
  });

  it('maps token-exchange failures to a stable result and logs context', async () => {
    const failure = new Error('provider timeout');
    tier.exchangeTier1Code.mockRejectedValue(failure);
    const { service, logger } = makeService();

    await expect(service.complete('ref-1', 'google', request)).resolves.toEqual(
      {
        success: false,
        error: 'Failed to exchange authorization code',
      }
    );
    expect(logger.error).toHaveBeenCalledWith(failure, {
      context: 'tier1_completion_token_exchange_failed',
      provider: 'google',
    });
  });

  it('maps profile-fetch failures to a stable result and logs context', async () => {
    const failure = new Error('userinfo unavailable');
    tier.fetchTier1UserProfile.mockRejectedValue(failure);
    const { service, logger } = makeService();

    await expect(service.complete('ref-1', 'google', request)).resolves.toEqual(
      { success: false, error: 'Failed to fetch user profile' }
    );
    expect(logger.error).toHaveBeenCalledWith(failure, {
      context: 'tier1_completion_profile_fetch_failed',
      provider: 'google',
    });
  });

  it('maps provider data and tokens before delegating user integration', async () => {
    const managerResult = {
      success: false,
      error: 'Existing account requires linking',
      requiresLinking: true,
    };
    const { service, logger, socialLoginManager } = makeService({
      managerResult,
    });

    await expect(service.complete('ref-1', 'google', request)).resolves.toBe(
      managerResult
    );
    expect(tier.fetchTier1UserProfile).toHaveBeenCalledWith(
      'access-token',
      'https://provider.example/userinfo',
      'google'
    );
    expect(tier.mapTier1Profile).toHaveBeenCalledWith('google', {
      sub: 'provider-user-1',
      email: 'alice@example.com',
    });
    expect(tier.mapTier1Tokens).toHaveBeenCalledWith({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
    });
    expect(logger.info).toHaveBeenCalledWith(
      'tier1_completion_profile_mapped',
      { provider: 'google', hasSub: true, hasEmail: true }
    );
    expect(socialLoginManager.completeTier1Flow).toHaveBeenCalledWith(
      'google',
      { sub: 'provider-user-1', email: 'alice@example.com' },
      { access_token: 'access-token', refresh_token: 'refresh-token' },
      request
    );
  });

  it('reports absent mapped subject and email without changing delegation', async () => {
    tier.mapTier1Profile.mockReturnValue({ sub: '' });
    const { service, logger, socialLoginManager } = makeService();

    await service.complete('ref-1', 'google', request);

    expect(logger.info).toHaveBeenCalledWith(
      'tier1_completion_profile_mapped',
      { provider: 'google', hasSub: false, hasEmail: false }
    );
    expect(socialLoginManager.completeTier1Flow).toHaveBeenCalledWith(
      'google',
      { sub: '' },
      expect.any(Object),
      request
    );
  });
});
