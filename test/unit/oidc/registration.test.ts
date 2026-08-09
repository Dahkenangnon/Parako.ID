import { describe, expect, it, vi } from 'vitest';

import { getDefaultFullConfig } from '../../../src/config/constants.js';
import Registration from '../../../src/oidc/specs/feature/registration.js';

describe('OIDC dynamic client registration', () => {
  const createRegistration = () => {
    const config = getDefaultFullConfig();
    const registration = Registration({
      getConfig: vi.fn(() => config),
    } as any);

    return { config, registration };
  };

  it('persists initial-access-token usage through the raw adapter payload before allowing registration', async () => {
    const { registration } = createRegistration();
    const adapter = {
      find: vi.fn().mockResolvedValue({
        exp: 1_785_934_800,
        iat: 1_785_931_200,
        jti: 'initial-access-token',
        kind: 'InitialAccessToken',
        policies: ['general-policy'],
        policies_metadata: {
          max_usage_count: 2,
          current_usage_count: 0,
        },
      }),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const initialAccessToken = {
      adapter,
      jti: 'initial-access-token',
      remainingTTL: 900,
    };
    const registrationAccessToken: Record<string, unknown> = {};
    const ctx = {
      oidc: {
        entities: {
          InitialAccessToken: initialAccessToken,
          RegistrationAccessToken: registrationAccessToken,
        },
      },
    } as any;

    await registration.policies['general-policy'](ctx, {
      client_name: 'Demo RP',
    } as any);

    expect(adapter.find).toHaveBeenCalledWith('initial-access-token');
    expect(adapter.upsert).toHaveBeenCalledWith(
      'initial-access-token',
      expect.objectContaining({
        policies_metadata: {
          max_usage_count: 2,
          current_usage_count: 1,
        },
      }),
      900
    );
    expect(registrationAccessToken.policies).toEqual(['general-policy']);
  });

  it('maps dynamic-registration feature flags', () => {
    const { config, registration } = createRegistration();

    expect(registration.enabled).toBe(
      config.features.oidc.dynamic_client_registration.enabled
    );
    expect(registration.initialAccessToken).toBe(
      config.features.oidc.dynamic_client_registration
        .require_initial_access_token
    );
    expect(registration.issueRegistrationAccessToken).toBe(
      config.features.oidc.dynamic_client_registration
        .issue_registration_access_token
    );
  });

  it.each([
    { name: 'missing', properties: {} },
    { name: 'empty', properties: { client_name: '' } },
  ])('rejects a $name client name', async ({ properties }) => {
    const { registration } = createRegistration();

    await expect(
      registration.policies['general-policy'](
        { oidc: { entities: {} } } as any,
        properties as any
      )
    ).rejects.toMatchObject({
      error: 'invalid_client_metadata',
      error_description: 'client_name is required for client registration',
    });
  });

  it('rejects the internal-client flag even when its value is false', async () => {
    const { registration } = createRegistration();

    await expect(
      registration.policies['general-policy'](
        { oidc: { entities: {} } } as any,
        { client_name: 'Demo RP', isInternalClient: false } as any
      )
    ).rejects.toMatchObject({
      error: 'invalid_client_metadata',
      error_description: 'isInternalClient is reserved for internal use',
    });
  });

  it('rejects an exhausted initial access token without persisting it', async () => {
    const { registration } = createRegistration();
    const adapter = {
      find: vi.fn().mockResolvedValue({
        policies_metadata: {
          max_usage_count: 2,
          current_usage_count: 2,
        },
      }),
      upsert: vi.fn(),
    };
    const ctx = {
      oidc: {
        entities: {
          InitialAccessToken: {
            adapter,
            jti: 'initial-access-token',
            remainingTTL: 900,
          },
        },
      },
    } as any;

    await expect(
      registration.policies['general-policy'](ctx, {
        client_name: 'Demo RP',
      } as any)
    ).rejects.toMatchObject({
      error: 'invalid_token',
      error_description: 'invalid token provided',
      error_detail: 'Initial access token usage limit exceeded',
    });
    expect(adapter.upsert).not.toHaveBeenCalled();
  });

  it('starts an unbounded token usage counter at one', async () => {
    const { registration } = createRegistration();
    const policiesMetadata: Record<string, number> = {};
    const adapter = {
      find: vi.fn().mockResolvedValue({
        policies_metadata: policiesMetadata,
      }),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const ctx = {
      oidc: {
        entities: {
          InitialAccessToken: {
            adapter,
            jti: 'initial-access-token',
            remainingTTL: 900,
          },
        },
      },
    } as any;

    await registration.policies['general-policy'](ctx, {
      client_name: 'Demo RP',
    } as any);

    expect(adapter.upsert).toHaveBeenCalledWith(
      'initial-access-token',
      { policies_metadata: { current_usage_count: 1 } },
      900
    );
  });

  it('fails closed when usage state cannot be persisted', async () => {
    const { registration } = createRegistration();
    const ctx = {
      oidc: {
        entities: {
          InitialAccessToken: {
            jti: 'initial-access-token',
          },
        },
      },
    } as any;

    await expect(
      registration.policies['general-policy'](ctx, {
        client_name: 'Demo RP',
      } as any)
    ).rejects.toMatchObject({
      error: 'invalid_token',
      error_description: 'invalid token provided',
      error_detail: 'Initial access token usage state cannot be persisted',
    });
  });

  it('fails closed when the validated token disappears from storage', async () => {
    const { registration } = createRegistration();
    const adapter = {
      find: vi.fn().mockResolvedValue(undefined),
      upsert: vi.fn(),
    };

    await expect(
      registration.policies['general-policy'](
        {
          oidc: {
            entities: {
              InitialAccessToken: {
                adapter,
                jti: 'initial-access-token',
                remainingTTL: 900,
              },
            },
          },
        } as any,
        { client_name: 'Demo RP' } as any
      )
    ).rejects.toMatchObject({
      error: 'invalid_token',
      error_detail: 'Initial access token usage state cannot be persisted',
    });

    expect(adapter.upsert).not.toHaveBeenCalled();
  });

  it('allows a legacy provider token without management metadata', async () => {
    const { registration } = createRegistration();
    const adapter = {
      find: vi.fn().mockResolvedValue({
        jti: 'legacy-initial-access-token',
        policies: ['general-policy'],
      }),
      upsert: vi.fn(),
    };

    await expect(
      registration.policies['general-policy'](
        {
          oidc: {
            entities: {
              InitialAccessToken: {
                adapter,
                jti: 'legacy-initial-access-token',
                remainingTTL: 900,
              },
            },
          },
        } as any,
        { client_name: 'Demo RP' } as any
      )
    ).resolves.toBeUndefined();

    expect(adapter.upsert).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'non-object metadata', metadata: 'invalid' },
    {
      name: 'invalid maximum',
      metadata: { max_usage_count: 0, current_usage_count: 0 },
    },
    {
      name: 'invalid current count',
      metadata: { max_usage_count: 2, current_usage_count: -1 },
    },
  ])('fails closed for $name', async ({ metadata }) => {
    const { registration } = createRegistration();
    const adapter = {
      find: vi.fn().mockResolvedValue({ policies_metadata: metadata }),
      upsert: vi.fn(),
    };

    await expect(
      registration.policies['general-policy'](
        {
          oidc: {
            entities: {
              InitialAccessToken: {
                adapter,
                jti: 'initial-access-token',
                remainingTTL: 900,
              },
            },
          },
        } as any,
        { client_name: 'Demo RP' } as any
      )
    ).rejects.toMatchObject({
      error: 'invalid_token',
      error_detail: 'Initial access token usage state cannot be persisted',
    });

    expect(adapter.upsert).not.toHaveBeenCalled();
  });

  it('fails closed when the token expires before usage can be persisted', async () => {
    const { registration } = createRegistration();
    const adapter = {
      find: vi.fn().mockResolvedValue({
        policies_metadata: { current_usage_count: 0 },
      }),
      upsert: vi.fn(),
    };

    await expect(
      registration.policies['general-policy'](
        {
          oidc: {
            entities: {
              InitialAccessToken: {
                adapter,
                jti: 'initial-access-token',
                remainingTTL: 0,
              },
            },
          },
        } as any,
        { client_name: 'Demo RP' } as any
      )
    ).rejects.toMatchObject({
      error: 'invalid_token',
      error_detail: 'Initial access token usage state cannot be persisted',
    });

    expect(adapter.upsert).not.toHaveBeenCalled();
  });

  it('allows registration without token metadata or a registration token', async () => {
    const { registration } = createRegistration();

    await expect(
      registration.policies['general-policy'](
        { oidc: {} } as any,
        { client_name: 'Demo RP' } as any
      )
    ).resolves.toBeUndefined();
  });
});
