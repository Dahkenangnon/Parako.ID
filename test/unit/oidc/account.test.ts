import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDefaultFullConfig } from '../../../src/config/constants.js';
import {
  Account,
  createAccountFactory,
} from '../../../src/oidc/specs/account.js';

describe('OIDC Account', () => {
  let config: ReturnType<typeof getDefaultFullConfig>;
  let logger: Record<string, ReturnType<typeof vi.fn>>;
  let userService: Record<string, ReturnType<typeof vi.fn>>;
  let configManager: Record<string, ReturnType<typeof vi.fn>>;

  const user = (overrides: Record<string, unknown> = {}) => ({
    username: 'alice',
    email: 'alice@example.test',
    email_verified: true,
    given_name: 'Alice',
    family_name: 'Doe',
    ...overrides,
  });

  const createAccount = (id = 'alice') =>
    new Account(logger as any, userService as any, configManager as any, id);

  beforeEach(() => {
    config = getDefaultFullConfig();
    logger = {
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    userService = { findByUsername: vi.fn().mockResolvedValue(user()) };
    configManager = { getConfig: vi.fn(() => config) };
  });

  it('honors the flat requested-claims mask passed by oidc-provider', async () => {
    const result = await createAccount().claims(
      'userinfo',
      'openid',
      { email: null } as any,
      []
    );

    expect(result).toEqual({
      sub: 'alice',
      email: 'alice@example.test',
    });
  });

  it('never exposes arbitrary internal user fields requested by a client', async () => {
    userService.findByUsername.mockResolvedValue(
      user({
        password: 'password-hash',
        reset_password_token: 'reset-secret',
        dynamic_metadata: { internal: true },
      })
    );

    const result = await createAccount().claims(
      'userinfo',
      'openid',
      {
        password: null,
        reset_password_token: null,
        dynamic_metadata: null,
      } as any,
      []
    );

    expect(result).toEqual({ sub: 'alice' });
  });

  it('requires an account ID', () => {
    expect(() => createAccount('')).toThrow('Account id is required');
    expect(logger.error).toHaveBeenCalledWith('Account id is required');
  });

  it('fails closed when the account no longer exists', async () => {
    userService.findByUsername.mockResolvedValue(null);

    await expect(
      createAccount().claims('userinfo', 'openid', {} as any, [])
    ).rejects.toThrow('User not found: alice');
    expect(logger.error).toHaveBeenCalledWith(
      'User not found at claims Account method: alice'
    );
  });

  it('maps all configured scopes into userinfo claims', async () => {
    config.features.oidc.scopes = [
      'openid',
      'profile',
      'email',
      'address',
      'phone',
      'roles',
      'preferences',
      'professional',
      'account',
      'mfa',
      'recovery',
      'custom_identifiers',
    ];
    config.features.oidc.claims = {
      ...config.features.oidc.claims,
      profile: [
        ...(config.features.oidc.claims?.profile ?? []),
        'birthdate',
        'updated_at',
      ],
      address: ['address', 'locality'],
    } as any;
    config.security.authentication.custom_identifiers = {
      enabled: true,
      fields: [
        { slot: 1, key: 'employee_id' },
        { slot: 2, key: 'member_id' },
      ],
    } as any;
    const updatedAt = new Date('2026-01-02T03:04:05.000Z');
    userService.findByUsername.mockResolvedValue(
      user({
        name: 'Alice Doe',
        middle_name: 'M',
        nickname: 'Ali',
        preferred_username: 'alice',
        profile: 'https://example.test/alice',
        picture: 'alice.png',
        website: 'https://alice.example.test',
        gender: 'female',
        birthdate: new Date('2000-02-03T00:00:00.000Z'),
        zoneinfo: 'Africa/Porto-Novo',
        locale: 'fr',
        updated_at: updatedAt,
        street_address: '1 Main Street',
        city: 'Cotonou',
        region: 'Littoral',
        postal_code: '0000',
        country: 'BJ',
        phone_number: '+22900000000',
        phone_number_verified: true,
        roles: ['admin'],
        prefered_contact: 'email',
        prefered_dark_theme: true,
        theme: 'dark',
        auth_provider: 'local',
        account_enabled: true,
        account_is_anonymized: false,
        register_with: 'email',
        last_login: updatedAt,
        blocked_from: null,
        mfa: {
          enabled: true,
          preferred_method: 'email',
          methods: { email: { enabled: true } },
        },
        recovery: {
          enabled: true,
          methods: ['secondary_email'],
          secondary_email: { email: 'recovery@example.test' },
        },
        custom_identifier_1: 'EMP-1',
        custom_identifier_2: null,
      })
    );

    const result = await createAccount().claims(
      'userinfo',
      config.features.oidc.scopes.join(' '),
      {} as any,
      []
    );

    expect(result).toEqual(
      expect.objectContaining({
        sub: 'alice',
        name: 'Alice Doe',
        email: 'alice@example.test',
        updated_at: updatedAt,
        address: {
          street_address: '1 Main Street',
          locality: 'Cotonou',
          region: 'Littoral',
          postal_code: '0000',
          country: 'BJ',
        },
        locality: 'Cotonou',
        birthdate: '2000-02-03',
        phone_number: '+22900000000',
        roles: ['admin'],
        mfa_enabled: true,
        mfa_method: 'email',
        recovery_enabled: true,
        recovery_methods: ['secondary_email'],
        recovery_secondary_email: 'recovery@example.test',
        employee_id: 'EMP-1',
      })
    );
    expect(result).not.toHaveProperty('member_id');
    expect(result).not.toHaveProperty('custom_identifier_1');
    expect(logger.debug).toHaveBeenCalledWith(
      'Claims returned for user alice:',
      expect.objectContaining({ use: 'userinfo' })
    );
  });

  it('honors rejected claims and ignores unconfigured scopes', async () => {
    config.features.oidc.scopes = ['openid', 'email'];

    const result = await createAccount().claims(
      'userinfo',
      'openid email roles unknown',
      {} as any,
      ['email']
    );

    expect(result).toEqual({ sub: 'alice', email_verified: true });
    expect(logger.warn).toHaveBeenCalledWith(
      "Scope 'roles' is not configured and will be ignored",
      expect.objectContaining({ requestedScope: 'roles' })
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "Scope 'unknown' is not configured and will be ignored",
      expect.objectContaining({ requestedScope: 'unknown' })
    );
  });

  it('uses configured claim mappings and handles an empty scope', async () => {
    config.features.oidc.scopes = undefined as any;
    config.features.oidc.claims = { openid: ['sub', 'email'] } as any;

    await expect(
      createAccount().claims('userinfo', '', undefined as any, [])
    ).resolves.toEqual({ sub: 'alice' });
    await expect(
      createAccount().claims('userinfo', 'openid', {} as any, [])
    ).resolves.toEqual({ sub: 'alice', email: 'alice@example.test' });
  });

  it('falls back to built-in claim mappings when custom mappings are absent', async () => {
    config.features.oidc.claims = undefined as any;

    await expect(
      createAccount().claims('userinfo', 'openid email', {} as any, [])
    ).resolves.toEqual({
      sub: 'alice',
      email: 'alice@example.test',
      email_verified: true,
    });
  });

  it('allows configured scopes that intentionally have no claim mapping', async () => {
    config.features.oidc.scopes = ['openid', 'empty'];
    config.features.oidc.claims = {} as any;

    await expect(
      createAccount().claims('userinfo', 'openid empty', {} as any, [])
    ).resolves.toEqual({ sub: 'alice' });
  });

  it('never exposes legacy raw custom-identifier slots', async () => {
    config.features.oidc.claims = {
      openid: [
        'sub',
        'custom_identifier_1',
        'custom_identifier_2',
        'custom_identifier_3',
      ],
    } as any;
    userService.findByUsername.mockResolvedValue(
      user({
        custom_identifier_1: 'private-1',
        custom_identifier_2: 'private-2',
        custom_identifier_3: 'private-3',
      })
    );

    await expect(
      createAccount().claims('userinfo', 'openid', {} as any, [])
    ).resolves.toEqual({ sub: 'alice' });
  });

  it('omits empty structured claims and uses safe claim defaults', async () => {
    config.features.oidc.scopes = [
      'openid',
      'profile',
      'address',
      'mfa',
      'recovery',
    ];
    config.features.oidc.claims = {
      ...config.features.oidc.claims,
      profile: [
        ...(config.features.oidc.claims?.profile ?? []),
        'birthdate',
        'updated_at',
      ],
      address: ['address', 'locality'],
    } as any;
    userService.findByUsername.mockResolvedValue(
      user({
        updated_at: undefined,
        birthdate: undefined,
        street_address: undefined,
        city: undefined,
        region: undefined,
        postal_code: undefined,
        country: undefined,
        mfa: undefined,
        recovery: undefined,
      })
    );

    const result = await createAccount().claims(
      'userinfo',
      'openid profile address mfa recovery',
      {} as any,
      []
    );

    expect(result.updated_at).toBeInstanceOf(Date);
    expect(result).not.toHaveProperty('address');
    expect(result).not.toHaveProperty('birthdate');
    expect(result.mfa_enabled).toBe(false);
    expect(result.recovery_enabled).toBe(false);
    expect(result.recovery_methods).toEqual([]);
    expect(result).not.toHaveProperty('recovery_secondary_email');
  });

  it.each([
    [{ methods: { totp: { enabled: true } } }, 'totp'],
    [{ methods: { webauthn: { enabled: true } } }, 'webauthn'],
    [{ methods: { email: { enabled: true } } }, 'email'],
    [{ methods: {} }, undefined],
  ])('derives an MFA method from enabled methods %#', async (mfa, expected) => {
    config.features.oidc.scopes = ['openid', 'mfa'];
    userService.findByUsername.mockResolvedValue(user({ mfa }));

    const result = await createAccount().claims(
      'userinfo',
      'openid mfa',
      {} as any,
      []
    );

    if (expected) expect(result.mfa_method).toBe(expected);
    else expect(result).not.toHaveProperty('mfa_method');
    expect(result).not.toHaveProperty('mfa_phone_number');
  });

  it('strips sensitive and account-management claims from ID tokens', async () => {
    config.features.oidc.scopes = [
      'openid',
      'phone',
      'account',
      'mfa',
      'recovery',
    ];
    userService.findByUsername.mockResolvedValue(
      user({
        phone_number: '+22900000000',
        phone_number_verified: true,
        username: 'alice',
        blocked_from: new Date(),
        mfa: { enabled: true, preferred_method: 'email' },
        recovery: { enabled: true, methods: ['email'] },
      })
    );

    const result = await createAccount().claims(
      'id_token',
      'openid phone account mfa recovery',
      {} as any,
      []
    );

    expect(result).toEqual({ sub: 'alice' });
  });

  it('filters userinfo claims whose scopes were not granted', async () => {
    config.features.oidc.scopes = [
      'openid',
      'phone',
      'address',
      'roles',
      'preferences',
      'professional',
      'account',
      'mfa',
      'recovery',
      'custom_identifiers',
    ];
    config.security.authentication.custom_identifiers = {
      enabled: true,
      fields: [{ slot: 1, key: 'employee_id' }],
    } as any;
    userService.findByUsername.mockResolvedValue(
      user({
        phone_number: '+22900000000',
        address: { country: 'BJ' },
        roles: ['admin'],
        prefered_contact: 'email',
        auth_provider: 'local',
        account_enabled: true,
        mfa: { enabled: true },
        recovery: { enabled: true },
        custom_identifier_1: 'EMP-1',
      })
    );

    const result = await createAccount().claims(
      'userinfo',
      'openid',
      {
        phone_number: null,
        address: null,
        roles: null,
        prefered_contact: null,
        auth_provider: null,
        account_enabled: null,
        mfa_enabled: null,
        recovery_enabled: null,
        employee_id: null,
      } as any,
      []
    );

    expect(result).toEqual({ sub: 'alice' });
  });

  it('finds accounts through the instance and factory lookup contracts', async () => {
    const instanceResult = await createAccount().findAccount(
      {} as any,
      'alice'
    );
    const factory = createAccountFactory(
      logger as any,
      userService as any,
      configManager as any
    );
    const factoryResult = await factory({} as any, 'alice');

    expect(instanceResult).toBeInstanceOf(Account);
    expect(instanceResult?.accountId).toBe('alice');
    expect(factoryResult).toBeInstanceOf(Account);
    expect(factoryResult?.accountId).toBe('alice');
  });

  it('returns undefined when instance and factory lookups miss', async () => {
    userService.findByUsername.mockResolvedValue(null);
    const accountInstance = createAccount();
    const factory = createAccountFactory(
      logger as any,
      userService as any,
      configManager as any
    );

    await expect(
      accountInstance.findAccount({} as any, 'missing')
    ).resolves.toBe(undefined);
    await expect(factory({} as any, 'missing')).resolves.toBe(undefined);
    expect(logger.error).toHaveBeenCalledTimes(2);
  });
});
