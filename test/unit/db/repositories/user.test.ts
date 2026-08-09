import { describe, expect, it, vi } from 'vitest';
import { MongooseUserRepository } from '../../../../src/db/repositories/mongoose/user.repository.js';
import { PrismaUserRepository } from '../../../../src/db/repositories/prisma/user.repository.js';

function mongooseQuery<T>(result: T) {
  const chain = {
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(result),
  };
  chain.lean.mockReturnValue(chain);
  return chain;
}

function prismaUserRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: null,
    username: null,
    custom_identifier_1: null,
    custom_identifier_2: null,
    custom_identifier_3: null,
    sub: null,
    given_name: null,
    family_name: null,
    name: null,
    nickname: null,
    middle_name: null,
    gender: null,
    birthdate: null,
    phone_number: null,
    profile: null,
    website: null,
    picture: null,
    locale: null,
    country: null,
    zoneinfo: null,
    city: null,
    address: null,
    street_address: null,
    region: null,
    postal_code: null,
    roles: '[]',
    phone_number_verified: false,
    email_verified: false,
    theme: null,
    sidebar_expanded: false,
    last_login: null,
    password: null,
    password_hash_algo: null,
    password_updated_at: null,
    password_force_reset: false,
    reset_password_token: null,
    reset_password_expires: null,
    email_verification_token: null,
    email_verification_expires: null,
    blocked_from: '[]',
    account_is_anonymized: false,
    register_with: 'email',
    auth_provider: null,
    account_enabled: true,
    tenant_id: 'tenant-a',
    created_at: new Date('2026-08-01T00:00:00.000Z'),
    updated_at: new Date('2026-08-01T01:00:00.000Z'),
    mfa: null,
    mfa_totp: null,
    mfa_email_otp: null,
    webauthn_credentials: [],
    recovery: null,
    backup_codes: [],
    security_questions: [],
    notification_prefs: null,
    ...overrides,
  };
}

function prismaUserClient(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
      ...overrides,
    },
    userMfa: { upsert: vi.fn() },
    userMfaTotp: { upsert: vi.fn() },
    userRecovery: { upsert: vi.fn() },
    userWebauthnCredential: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    userBackupCode: {
      createMany: vi.fn(),
      updateMany: vi.fn(),
    },
    userSecurityQuestion: { create: vi.fn() },
    userMfaEmailOtp: { upsert: vi.fn(), deleteMany: vi.fn() },
  };
}

describe('Prisma user repository', () => {
  it('maps a minimal relational user and missing unique lookup', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(prismaUserRow())
      .mockResolvedValueOnce(null);
    const repository = new PrismaUserRepository(
      prismaUserClient({ findUnique }) as never
    );

    await expect(repository.findById('user-1')).resolves.toEqual({
      id: 'user-1',
      _id: 'user-1',
      email: undefined,
      username: '',
      custom_identifier_1: undefined,
      custom_identifier_2: undefined,
      custom_identifier_3: undefined,
      sub: undefined,
      given_name: undefined,
      family_name: undefined,
      name: undefined,
      nickname: undefined,
      middle_name: undefined,
      gender: 'M',
      birthdate: undefined,
      phone_number: undefined,
      profile: undefined,
      website: undefined,
      picture: undefined,
      locale: undefined,
      country: undefined,
      zoneinfo: undefined,
      city: undefined,
      address: undefined,
      street_address: undefined,
      region: undefined,
      postal_code: undefined,
      roles: [],
      phone_number_verified: false,
      email_verified: false,
      theme: undefined,
      sidebar_expanded: false,
      last_login: undefined,
      password: undefined,
      password_hash_algo: undefined,
      password_updated_at: undefined,
      password_force_reset: false,
      reset_password_token: undefined,
      reset_password_expires: undefined,
      email_verification_token: undefined,
      email_verification_expires: undefined,
      blocked_from: [],
      account_is_anonymized: false,
      register_with: 'email',
      auth_provider: undefined,
      account_enabled: true,
      mfa: undefined,
      recovery: undefined,
      notification_preferences: undefined,
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-01T01:00:00.000Z',
    });
    await expect(repository.findById('missing')).resolves.toBeNull();
    expect(findUnique).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { id: 'user-1' } })
    );
  });

  it('maps complete MFA, recovery, notification, and profile data', async () => {
    const credentialCreated = new Date('2026-07-01T00:00:00.000Z');
    const verifiedAt = new Date('2026-07-02T00:00:00.000Z');
    const expiresAt = new Date('2026-09-01T00:00:00.000Z');
    const row = prismaUserRow({
      email: 'alice@example.com',
      username: 'alice',
      custom_identifier_1: 'employee-1',
      custom_identifier_2: 'member-2',
      custom_identifier_3: 'external-3',
      sub: 'subject-1',
      given_name: ' Alice ',
      family_name: ' Smith ',
      name: 'stale',
      nickname: 'ally',
      middle_name: 'Q',
      gender: 'F',
      birthdate: new Date('1990-01-01T00:00:00.000Z'),
      phone_number: '+22900000000',
      profile: 'https://example.com/profile',
      website: 'https://example.com',
      picture: 'https://example.com/photo.png',
      locale: 'en',
      country: 'bj',
      zoneinfo: 'Africa/Porto-Novo',
      city: 'Cotonou',
      address: 'Address',
      street_address: 'Street',
      region: 'Littoral',
      postal_code: '0000',
      roles: '["user","admin"]',
      phone_number_verified: true,
      email_verified: true,
      theme: 'dark',
      sidebar_expanded: true,
      last_login: verifiedAt,
      password: 'password-hash',
      password_hash_algo: 'argon2id',
      password_updated_at: verifiedAt,
      password_force_reset: true,
      reset_password_token: 'reset-token',
      reset_password_expires: expiresAt,
      email_verification_token: 'verify-token',
      email_verification_expires: expiresAt,
      blocked_from: '["1.2.3.4"]',
      account_is_anonymized: true,
      register_with: 'google',
      auth_provider: 'google',
      account_enabled: false,
      mfa: { enabled: true, preferred_method: 'webauthn' },
      mfa_totp: {
        enabled: true,
        secret: 'totp-secret',
        verified_at: verifiedAt,
      },
      mfa_email_otp: { otp_hash: 'otp-hash', expires_at: expiresAt },
      webauthn_credentials: [
        {
          credential_id: 'credential-1',
          public_key: 'public-key',
          counter: 4,
          device_type: null,
          backed_up: true,
          transports: '["internal","usb"]',
          created_at: credentialCreated,
        },
      ],
      recovery: {
        enabled: true,
        methods: '["backup_codes","secondary_email"]',
        secondary_email: 'recovery@example.com',
        secondary_email_verified: true,
        secondary_email_token: 'secondary-token',
        secondary_email_token_exp: expiresAt,
        sms_phone_number: '+22911111111',
        sms_verified: true,
        sms_code: 'sms-code',
        sms_code_exp: expiresAt,
        backup_codes_generated_at: verifiedAt,
        backup_codes_expires_at: expiresAt,
        sq_setup_at: verifiedAt,
        sq_last_used_at: verifiedAt,
        sq_failed_attempts: 2,
        sq_last_failed_at: verifiedAt,
        sq_locked_until: expiresAt,
      },
      backup_codes: [
        { code_hash: 'unused', used: false },
        { code_hash: 'used', used: true },
      ],
      security_questions: [
        { id: 'question-1', question_key: 'pet', answer_hash: 'hash' },
      ],
      notification_prefs: {
        preferred_channel: 'sms',
        security_alerts: true,
        new_session_alerts: false,
        marketing: true,
      },
    });
    const repository = new PrismaUserRepository(
      prismaUserClient({ findFirst: vi.fn().mockResolvedValue(row) }) as never
    );

    const user = await repository.findOne({ email: 'alice@example.com' });

    expect(user).toEqual(
      expect.objectContaining({
        name: 'Alice Smith',
        roles: ['user', 'admin'],
        blocked_from: ['1.2.3.4'],
        mfa: {
          enabled: true,
          preferred_method: 'webauthn',
          methods: {
            totp: {
              enabled: true,
              secret: 'totp-secret',
              verified_at: verifiedAt,
            },
            email: { enabled: true },
            webauthn: {
              enabled: true,
              credentials: [
                {
                  credential_id: 'credential-1',
                  credential_public_key: 'public-key',
                  counter: 4,
                  device_type: 'singleDevice',
                  backed_up: true,
                  transports: ['internal', 'usb'],
                  created_at: credentialCreated,
                  friendly_name: 'credential-1',
                },
              ],
            },
          },
          email_otp: { hash: 'otp-hash', expires: expiresAt },
        },
        recovery: {
          enabled: true,
          methods: ['backup_codes', 'secondary_email'],
          secondary_email: {
            email: 'recovery@example.com',
            verified: true,
            verification_token: 'secondary-token',
            verification_expires: expiresAt,
          },
          sms: {
            phone_number: '+22911111111',
            verified: true,
            verification_code: 'sms-code',
            verification_expires: expiresAt,
          },
          backup_codes: {
            codes: ['unused'],
            generated_at: verifiedAt,
            expires_at: expiresAt,
          },
          security_questions: {
            questions: [
              { id: 'question-1', question_key: 'pet', answer_hash: 'hash' },
            ],
            setup_at: verifiedAt,
            last_used_at: verifiedAt,
            failed_attempts: 2,
            last_failed_at: verifiedAt,
            locked_until: expiresAt,
          },
        },
        notification_preferences: {
          preferred_channel: 'sms',
          security_alerts: true,
          new_session_alerts: false,
          marketing: true,
        },
      })
    );
  });

  it('maps sparse relation rows without requiring their parent records', async () => {
    const rows = [
      prismaUserRow({
        mfa_totp: { enabled: false, secret: null, verified_at: null },
      }),
      prismaUserRow({
        mfa_email_otp: { otp_hash: null, expires_at: null },
      }),
      prismaUserRow({
        webauthn_credentials: [
          {
            credential_id: 'credential-2',
            public_key: 'public-key-2',
            counter: 0,
            device_type: 'multiDevice',
            backed_up: false,
            transports: '[]',
            created_at: new Date('2026-08-01T00:00:00.000Z'),
          },
        ],
      }),
      prismaUserRow({ backup_codes: [{ code_hash: 'orphan', used: false }] }),
      prismaUserRow({
        security_questions: [
          { id: 'question-2', question_key: 'city', answer_hash: 'hash-2' },
        ],
      }),
      prismaUserRow({
        recovery: {
          enabled: false,
          methods: '[]',
          secondary_email: 'recovery@example.com',
          secondary_email_verified: false,
          secondary_email_token: null,
          secondary_email_token_exp: null,
          sms_phone_number: '+2290100000000',
          sms_verified: false,
          sms_code: null,
          sms_code_exp: null,
          backup_codes_generated_at: null,
          backup_codes_expires_at: null,
          sq_setup_at: null,
          sq_last_used_at: null,
          sq_failed_attempts: 0,
          sq_last_failed_at: null,
          sq_locked_until: null,
        },
      }),
    ];
    const findFirst = vi.fn();
    for (const row of rows) findFirst.mockResolvedValueOnce(row);
    const repository = new PrismaUserRepository(
      prismaUserClient({ findFirst }) as never
    );

    const totp = await repository.findOne({ case: 'totp' });
    const email = await repository.findOne({ case: 'email' });
    const webauthn = await repository.findOne({ case: 'webauthn' });
    const backup = await repository.findOne({ case: 'backup' });
    const questions = await repository.findOne({ case: 'questions' });
    const recovery = await repository.findOne({ case: 'recovery' });

    expect(totp?.mfa).toEqual(
      expect.objectContaining({
        enabled: false,
        preferred_method: undefined,
        methods: {
          totp: { enabled: false, secret: undefined, verified_at: undefined },
          email: undefined,
          webauthn: undefined,
        },
      })
    );
    expect(email?.mfa).toEqual(
      expect.objectContaining({
        methods: expect.objectContaining({ email: { enabled: true } }),
        email_otp: undefined,
      })
    );
    expect(webauthn?.mfa?.methods.webauthn?.credentials?.[0]).toEqual(
      expect.objectContaining({ device_type: 'multiDevice' })
    );
    expect(backup?.recovery).toEqual(
      expect.objectContaining({ enabled: false, methods: [] })
    );
    expect(questions?.recovery?.security_questions).toEqual({
      questions: [
        { id: 'question-2', question_key: 'city', answer_hash: 'hash-2' },
      ],
      setup_at: undefined,
      last_used_at: undefined,
      failed_attempts: 0,
      last_failed_at: undefined,
      locked_until: undefined,
    });
    expect(recovery?.recovery).toEqual({
      enabled: false,
      methods: [],
      secondary_email: {
        email: 'recovery@example.com',
        verified: false,
        verification_token: undefined,
        verification_expires: undefined,
      },
      sms: {
        phone_number: '+2290100000000',
        verified: false,
        verification_code: undefined,
        verification_expires: undefined,
      },
      backup_codes: undefined,
      security_questions: undefined,
    });
  });

  it.each([
    { given_name: 'Given', family_name: null, name: 'Given' },
    { given_name: null, family_name: 'Family', name: 'Family' },
    { given_name: null, family_name: null, stored: 'Stored', name: 'Stored' },
    {
      given_name: null,
      family_name: null,
      stored: null,
      custom_identifier_1: 'Custom',
      name: 'Custom',
    },
  ])('computes display-name fallback $name', async testCase => {
    const repository = new PrismaUserRepository(
      prismaUserClient({
        findFirst: vi.fn().mockResolvedValue(
          prismaUserRow({
            given_name: testCase.given_name,
            family_name: testCase.family_name,
            name: testCase.stored ?? null,
            custom_identifier_1: testCase.custom_identifier_1 ?? null,
          })
        ),
      }) as never
    );

    await expect(repository.findOne({})).resolves.toEqual(
      expect.objectContaining({ name: testCase.name })
    );
  });

  it('treats whitespace-only display-name components as absent', async () => {
    const repository = new PrismaUserRepository(
      prismaUserClient({
        findFirst: vi.fn().mockResolvedValue(
          prismaUserRow({
            given_name: '   ',
            family_name: '\t',
            name: '   ',
            custom_identifier_1: '\n',
          })
        ),
      }) as never
    );

    await expect(repository.findOne({})).resolves.toEqual(
      expect.objectContaining({ name: undefined })
    );
  });

  it('handles missing first-row lookups for all supported identifiers', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const repository = new PrismaUserRepository(
      prismaUserClient({ findFirst }) as never
    );

    await expect(repository.findByEmail('a@example.com')).resolves.toBeNull();
    await expect(repository.findByUsername('alice')).resolves.toBeNull();
    await expect(repository.findBySub('subject')).resolves.toBeNull();
    await expect(
      repository.findBySecondaryEmail('recovery@example.com')
    ).resolves.toBeNull();
    await expect(
      repository.findByRecoveryTokenHash('token-hash')
    ).resolves.toBeNull();
    expect(findFirst.mock.calls.map(call => call[0].where)).toEqual([
      { email: 'a@example.com' },
      { username: 'alice' },
      { sub: 'subject' },
      { recovery: { secondary_email: 'recovery@example.com' } },
      { recovery: { secondary_email_token: 'token-hash' } },
    ]);
  });

  it('maps a user found through secondary recovery email', async () => {
    const findFirst = vi.fn().mockResolvedValue(prismaUserRow());
    const repository = new PrismaUserRepository(
      prismaUserClient({ findFirst }) as never
    );

    await expect(
      repository.findBySecondaryEmail('recovery@example.com')
    ).resolves.toEqual(expect.objectContaining({ id: 'user-1' }));
  });

  it('maps a user found through a recovery token hash', async () => {
    const findFirst = vi.fn().mockResolvedValue(prismaUserRow());
    const repository = new PrismaUserRepository(
      prismaUserClient({ findFirst }) as never
    );

    await expect(
      repository.findByRecoveryTokenHash('token-hash')
    ).resolves.toEqual(expect.objectContaining({ id: 'user-1' }));
    expect(findFirst).toHaveBeenCalledWith({
      where: { recovery: { secondary_email_token: 'token-hash' } },
      include: expect.any(Object),
    });
  });

  it('paginates and maps relational user rows', async () => {
    const findMany = vi.fn().mockResolvedValue([prismaUserRow()]);
    const count = vi.fn().mockResolvedValue(1);
    const repository = new PrismaUserRepository(
      prismaUserClient({ findMany, count }) as never
    );

    await expect(
      repository.findMany(
        { account_enabled: true },
        { page: 2, limit: 5, sort: { username: 'asc' } }
      )
    ).resolves.toEqual({
      results: [expect.objectContaining({ id: 'user-1' })],
      totalResults: 1,
      page: 2,
      limit: 5,
      totalPages: 1,
      hasNextPage: false,
      hasPrevPage: true,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { account_enabled: true },
        take: 5,
        skip: 5,
        orderBy: { username: 'asc' },
      })
    );
  });

  it('queries serialized role membership when paginating users', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const repository = new PrismaUserRepository(
      prismaUserClient({ findMany, count }) as never
    );

    await repository.findMany(
      { roles: ['platform_admin'] },
      { page: 1, limit: 1 }
    );

    const where = {
      OR: [{ roles: { contains: '"platform_admin"' } }],
    };
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
    expect(count).toHaveBeenCalledWith({ where });
  });

  it('creates a minimal user with repository defaults', async () => {
    const create = vi.fn().mockResolvedValue(prismaUserRow());
    const repository = new PrismaUserRepository(
      prismaUserClient({ create }) as never
    );

    await repository.create({} as never);

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.any(String),
        email: null,
        username: null,
        name: null,
        gender: 'M',
        locale: 'fr',
        country: 'bj',
        zoneinfo: 'Africa/Porto-Novo',
        roles: '["user"]',
        phone_number_verified: false,
        email_verified: false,
        sidebar_expanded: false,
        password_force_reset: false,
        blocked_from: '[]',
        account_is_anonymized: false,
        register_with: 'email',
        account_enabled: true,
        mfa: undefined,
        mfa_totp: undefined,
        mfa_email_otp: undefined,
        webauthn_credentials: undefined,
        recovery: undefined,
        backup_codes: undefined,
        security_questions: undefined,
        notification_prefs: undefined,
      }),
      include: expect.any(Object),
    });
  });

  it('creates all relational user subrecords from a complete payload', async () => {
    const now = new Date('2026-08-01T00:00:00.000Z');
    const expires = new Date('2026-09-01T00:00:00.000Z');
    const create = vi.fn().mockResolvedValue(prismaUserRow());
    const repository = new PrismaUserRepository(
      prismaUserClient({ create }) as never
    );

    await repository.create({
      email: 'alice@example.com',
      username: 'alice',
      custom_identifier_1: 'one',
      custom_identifier_2: 'two',
      custom_identifier_3: 'three',
      sub: 'subject',
      given_name: 'Alice',
      family_name: 'Smith',
      name: 'ignored-stored-name',
      nickname: 'ally',
      middle_name: 'Q',
      gender: 'F',
      birthdate: now,
      phone_number: '+22900000000',
      profile: 'profile',
      website: 'website',
      picture: 'picture',
      locale: 'en',
      country: 'us',
      zoneinfo: 'UTC',
      city: 'City',
      address: 'Address',
      street_address: 'Street',
      region: 'Region',
      postal_code: 'Postal',
      roles: ['admin'],
      phone_number_verified: true,
      email_verified: true,
      theme: 'dark',
      sidebar_expanded: true,
      last_login: now,
      password: 'hash',
      password_hash_algo: 'argon2id',
      password_updated_at: now,
      password_force_reset: true,
      reset_password_token: 'reset',
      reset_password_expires: expires,
      email_verification_token: 'verify',
      email_verification_expires: expires,
      blocked_from: ['1.2.3.4'],
      account_is_anonymized: true,
      register_with: 'google',
      auth_provider: 'google',
      account_enabled: false,
      mfa: {
        enabled: true,
        preferred_method: 'webauthn',
        methods: {
          totp: { enabled: true, secret: 'secret', verified_at: now },
          webauthn: {
            enabled: true,
            credentials: [
              {
                credential_id: 'credential',
                credential_public_key: 'public-key',
                counter: 2,
                device_type: 'multiDevice',
                backed_up: true,
                transports: ['internal'],
                created_at: now,
              },
            ],
          },
        },
        email_otp: { hash: 'otp', expires },
      },
      recovery: {
        enabled: true,
        methods: [
          'backup_codes',
          'secondary_email',
          'sms',
          'security_questions',
        ],
        secondary_email: {
          email: 'recovery@example.com',
          verified: true,
          verification_token: 'secondary-token',
          verification_expires: expires,
        },
        sms: {
          phone_number: '+22911111111',
          verified: true,
          verification_code: 'sms-code',
          verification_expires: expires,
        },
        backup_codes: {
          codes: ['backup'],
          generated_at: now,
          expires_at: expires,
        },
        security_questions: {
          questions: [
            { id: 'question-id', question_key: 'pet', answer_hash: 'answer' },
          ],
          setup_at: now,
          last_used_at: now,
          failed_attempts: 2,
          last_failed_at: now,
          locked_until: expires,
        },
      },
      notification_preferences: {
        preferred_channel: 'sms',
        security_alerts: true,
        new_session_alerts: false,
        marketing: true,
      },
    } as never);

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Alice Smith',
        roles: '["admin"]',
        blocked_from: '["1.2.3.4"]',
        mfa: {
          create: { enabled: true, preferred_method: 'webauthn' },
        },
        mfa_totp: {
          create: { enabled: true, secret: 'secret', verified_at: now },
        },
        mfa_email_otp: {
          create: { otp_hash: 'otp', expires_at: expires },
        },
        webauthn_credentials: {
          create: [
            {
              credential_id: 'credential',
              public_key: 'public-key',
              counter: 2,
              device_type: 'multiDevice',
              backed_up: true,
              transports: '["internal"]',
            },
          ],
        },
        recovery: {
          create: expect.objectContaining({
            enabled: true,
            methods:
              '["backup_codes","secondary_email","sms","security_questions"]',
            secondary_email: 'recovery@example.com',
            sms_phone_number: '+22911111111',
            sq_failed_attempts: 2,
          }),
        },
        backup_codes: {
          create: [{ code_hash: 'backup', used: false }],
        },
        security_questions: {
          create: [{ question_key: 'pet', answer_hash: 'answer' }],
        },
        notification_prefs: {
          create: {
            preferred_channel: 'sms',
            security_alerts: true,
            new_session_alerts: false,
            marketing: true,
          },
        },
      }),
      include: expect.any(Object),
    });
  });

  it('creates sparse nested records with safe relational defaults', async () => {
    const create = vi.fn().mockResolvedValue(prismaUserRow());
    const repository = new PrismaUserRepository(
      prismaUserClient({ create }) as never
    );

    await repository.create({
      mfa: {
        enabled: false,
        methods: {
          totp: { enabled: false },
          webauthn: {
            enabled: true,
            credentials: [
              {
                credential_id: 'credential',
                credential_public_key: 'public-key',
                counter: 0,
                backed_up: false,
                created_at: new Date('2026-08-01T00:00:00.000Z'),
              },
            ],
          },
        },
      },
      recovery: {
        enabled: false,
        methods: [],
        backup_codes: {
          codes: [],
          generated_at: undefined,
          expires_at: undefined,
        },
        security_questions: { questions: [] },
      },
    } as never);

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        mfa: { create: { enabled: false, preferred_method: null } },
        mfa_totp: {
          create: { enabled: false, secret: null, verified_at: null },
        },
        webauthn_credentials: {
          create: [
            {
              credential_id: 'credential',
              public_key: 'public-key',
              counter: 0,
              device_type: null,
              backed_up: false,
              transports: '[]',
            },
          ],
        },
        recovery: {
          create: {
            enabled: false,
            methods: '[]',
            secondary_email: null,
            secondary_email_verified: false,
            secondary_email_token: null,
            secondary_email_token_exp: null,
            sms_phone_number: null,
            sms_verified: false,
            sms_code: null,
            sms_code_exp: null,
            backup_codes_generated_at: null,
            backup_codes_expires_at: null,
            sq_setup_at: null,
            sq_last_used_at: null,
            sq_failed_attempts: 0,
            sq_last_failed_at: null,
            sq_locked_until: null,
          },
        },
        backup_codes: undefined,
        security_questions: undefined,
      }),
      include: expect.any(Object),
    });
  });

  it('updates every supported scalar user field', async () => {
    const now = new Date('2026-08-01T00:00:00.000Z');
    const update = vi
      .fn()
      .mockResolvedValue(
        prismaUserRow({ given_name: 'Updated', family_name: 'User' })
      );
    const repository = new PrismaUserRepository(
      prismaUserClient({ update }) as never
    );
    const data = {
      email: 'updated@example.com',
      username: 'updated',
      custom_identifier_1: 'one',
      custom_identifier_2: 'two',
      custom_identifier_3: 'three',
      sub: 'subject',
      given_name: 'Updated',
      family_name: 'User',
      name: 'ignored',
      nickname: 'nickname',
      middle_name: 'Middle',
      gender: 'F',
      birthdate: now,
      phone_number: '+22900000000',
      profile: 'profile',
      website: 'website',
      picture: 'picture',
      locale: 'en',
      country: 'us',
      zoneinfo: 'UTC',
      city: 'City',
      address: 'Address',
      street_address: 'Street',
      region: 'Region',
      postal_code: 'Postal',
      roles: ['admin'],
      phone_number_verified: true,
      email_verified: true,
      theme: 'dark',
      sidebar_expanded: true,
      last_login: now,
      password: 'hash',
      password_hash_algo: 'argon2id',
      password_updated_at: now,
      password_force_reset: true,
      reset_password_token: 'reset',
      reset_password_expires: now,
      email_verification_token: 'verify',
      email_verification_expires: now,
      blocked_from: ['1.2.3.4'],
      account_is_anonymized: true,
      register_with: 'google',
      auth_provider: 'google',
      account_enabled: false,
    };

    await repository.update('user-1', data as never);

    expect(update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        ...data,
        name: 'Updated User',
        roles: '["admin"]',
        blocked_from: '["1.2.3.4"]',
      },
      include: expect.any(Object),
    });
  });

  it('handles empty updates, deletion, and filtered and unfiltered counts', async () => {
    const update = vi.fn().mockResolvedValue(prismaUserRow());
    const deleteUser = vi.fn().mockResolvedValue(prismaUserRow());
    const count = vi.fn().mockResolvedValue(4);
    const repository = new PrismaUserRepository(
      prismaUserClient({ update, delete: deleteUser, count }) as never
    );

    await expect(repository.update('user-1', {})).resolves.toMatchObject({
      id: 'user-1',
    });
    await repository.delete('user-1');
    await expect(repository.count()).resolves.toBe(4);
    await expect(repository.count({ account_enabled: true })).resolves.toBe(4);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' }, data: {} })
    );
    expect(deleteUser).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    expect(count).toHaveBeenNthCalledWith(1, { where: undefined });
    expect(count).toHaveBeenNthCalledWith(2, {
      where: { account_enabled: true },
    });
  });

  it('normalizes cross-database operators for Prisma counts', async () => {
    const count = vi.fn().mockResolvedValue(4);
    const repository = new PrismaUserRepository(
      prismaUserClient({ count }) as never
    );
    const cutoff = new Date('2026-07-01T00:00:00.000Z');

    await repository.count({
      roles: { $in: ['admin', 'superadmin'] },
      created_at: { $gte: cutoff },
    });

    expect(count).toHaveBeenCalledWith({
      where: {
        created_at: { gte: cutoff },
        OR: [
          { roles: { contains: '"admin"' } },
          { roles: { contains: '"superadmin"' } },
        ],
      },
    });
  });

  it('safely composes serialized role membership with existing Prisma filters', async () => {
    const count = vi.fn().mockResolvedValue(0);
    const repository = new PrismaUserRepository(
      prismaUserClient({ count }) as never
    );

    await repository.count({
      roles: { $in: ['admin', 42] },
      OR: [{ account_enabled: true }],
    });
    await repository.count({ roles: { equals: '["admin"]' } });
    await repository.count({ roles: null });

    expect(count).toHaveBeenNthCalledWith(1, {
      where: {
        AND: [
          { OR: [{ account_enabled: true }] },
          { OR: [{ roles: { contains: '"admin"' } }] },
        ],
      },
    });
    expect(count).toHaveBeenNthCalledWith(2, {
      where: { roles: { equals: '["admin"]' } },
    });
    expect(count).toHaveBeenNthCalledWith(3, { where: { roles: null } });
  });

  it('clears nullable scalar fields when explicitly set to null', async () => {
    const update = vi.fn().mockResolvedValue(prismaUserRow());
    const repository = new PrismaUserRepository(
      prismaUserClient({ update }) as never
    );
    const nullable = {
      email: null,
      username: null,
      given_name: null,
      family_name: null,
      name: null,
      nickname: null,
      middle_name: null,
      gender: null,
      birthdate: null,
      phone_number: null,
      profile: null,
      website: null,
      password: null,
      password_hash_algo: null,
      password_updated_at: null,
      reset_password_token: null,
      reset_password_expires: null,
      email_verification_token: null,
      email_verification_expires: null,
      picture: null,
      locale: null,
      country: null,
      zoneinfo: null,
      city: null,
      address: null,
      street_address: null,
      region: null,
      postal_code: null,
      theme: null,
      last_login: null,
      sub: null,
      auth_provider: null,
      custom_identifier_1: null,
      custom_identifier_2: null,
      custom_identifier_3: null,
    };

    await repository.update('user-1', nullable as never);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: nullable })
    );
  });

  it('upserts master MFA and complete TOTP state, and ignores an empty update', async () => {
    const client = prismaUserClient();
    const repository = new PrismaUserRepository(client as never);
    const verifiedAt = new Date('2026-08-01T00:00:00.000Z');

    await repository.updateMfa('user-1', {
      enabled: true,
      preferred_method: 'totp',
      'methods.totp': {
        enabled: true,
        secret: 'secret',
        verified_at: verifiedAt,
      },
    });
    await repository.updateMfa('user-2', {});

    expect(client.userMfa.upsert).toHaveBeenCalledWith({
      where: { user_id: 'user-1' },
      create: {
        user_id: 'user-1',
        enabled: true,
        preferred_method: 'totp',
      },
      update: { enabled: true, preferred_method: 'totp' },
    });
    expect(client.userMfaTotp.upsert).toHaveBeenCalledWith({
      where: { user_id: 'user-1' },
      create: {
        user_id: 'user-1',
        enabled: true,
        secret: 'secret',
        verified_at: verifiedAt,
      },
      update: { enabled: true, secret: 'secret', verified_at: verifiedAt },
    });
    expect(client.userMfa.upsert).toHaveBeenCalledOnce();
    expect(client.userMfaTotp.upsert).toHaveBeenCalledOnce();
  });

  it('uses safe defaults for partial MFA and TOTP creation', async () => {
    const client = prismaUserClient();
    const repository = new PrismaUserRepository(client as never);

    await repository.updateMfa('user-1', {
      preferred_method: 'email',
      'methods.totp': {},
    });

    expect(client.userMfa.upsert).toHaveBeenCalledWith({
      where: { user_id: 'user-1' },
      create: {
        user_id: 'user-1',
        enabled: false,
        preferred_method: 'email',
      },
      update: { preferred_method: 'email' },
    });
    expect(client.userMfaTotp.upsert).toHaveBeenCalledWith({
      where: { user_id: 'user-1' },
      create: {
        user_id: 'user-1',
        enabled: false,
        secret: null,
        verified_at: null,
      },
      update: {},
    });
  });

  it('defaults the preferred method when only MFA enabled changes', async () => {
    const client = prismaUserClient();
    const repository = new PrismaUserRepository(client as never);

    await repository.updateMfa('user-1', { enabled: false });

    expect(client.userMfa.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: {
          user_id: 'user-1',
          enabled: false,
          preferred_method: null,
        },
        update: { enabled: false },
      })
    );
  });

  it('upserts recovery configuration with defaults and updates', async () => {
    const client = prismaUserClient();
    const repository = new PrismaUserRepository(client as never);

    await repository.updateRecovery('user-1', {
      enabled: true,
      methods: ['backup_codes'],
      secondary_email: 'recovery@example.com',
    });
    await repository.updateRecovery('user-2', {});

    expect(client.userRecovery.upsert).toHaveBeenNthCalledWith(1, {
      where: { user_id: 'user-1' },
      create: {
        user_id: 'user-1',
        enabled: true,
        methods: '["backup_codes"]',
      },
      update: {
        enabled: true,
        methods: ['backup_codes'],
        secondary_email: 'recovery@example.com',
      },
    });
    expect(client.userRecovery.upsert).toHaveBeenNthCalledWith(2, {
      where: { user_id: 'user-2' },
      create: { user_id: 'user-2', enabled: false, methods: '[]' },
      update: {},
    });
  });

  it('adds and removes full and defaulted WebAuthn credentials', async () => {
    const client = prismaUserClient();
    const repository = new PrismaUserRepository(client as never);

    await repository.addWebAuthnCredential('user-1', {
      credential_id: 'credential-1',
      publicKey: 'public-key',
      counter: 3,
      device_type: 'platform',
      backed_up: true,
      transports: ['internal'],
    });
    await repository.addWebAuthnCredential('user-2', {
      credential_id: 'credential-2',
      publicKey: 'public-key-2',
      counter: 0,
    });
    await repository.removeWebAuthnCredential('user-1', 'credential-1');

    expect(client.userWebauthnCredential.create).toHaveBeenNthCalledWith(1, {
      data: {
        user_id: 'user-1',
        credential_id: 'credential-1',
        public_key: 'public-key',
        counter: 3,
        device_type: 'platform',
        backed_up: true,
        transports: '["internal"]',
      },
    });
    expect(client.userWebauthnCredential.create).toHaveBeenNthCalledWith(2, {
      data: {
        user_id: 'user-2',
        credential_id: 'credential-2',
        public_key: 'public-key-2',
        counter: 0,
        device_type: null,
        backed_up: false,
        transports: '[]',
      },
    });
    expect(client.userWebauthnCredential.deleteMany).toHaveBeenCalledWith({
      where: { user_id: 'user-1', credential_id: 'credential-1' },
    });
  });

  it('adds backup codes and security questions', async () => {
    const client = prismaUserClient();
    const repository = new PrismaUserRepository(client as never);

    await repository.addBackupCodes('user-1', ['one', 'two']);
    await repository.addSecurityQuestion('user-1', {
      id: 'question-1',
      question_key: 'pet',
      answer_hash: 'hash',
    });

    expect(client.userBackupCode.createMany).toHaveBeenCalledWith({
      data: [
        { user_id: 'user-1', code_hash: 'one', used: false },
        { user_id: 'user-1', code_hash: 'two', used: false },
      ],
    });
    expect(client.userSecurityQuestion.create).toHaveBeenCalledWith({
      data: {
        id: 'question-1',
        user_id: 'user-1',
        question_key: 'pet',
        answer_hash: 'hash',
      },
    });
  });

  it('upserts complete and defaulted recovery lockout state', async () => {
    const client = prismaUserClient();
    const repository = new PrismaUserRepository(client as never);
    const failedAt = new Date('2026-08-01T00:00:00.000Z');

    await repository.updateRecoveryLockout('user-1', {
      failed_attempts: 3,
      last_failed_at: failedAt,
      locked_until: null,
    });
    await repository.updateRecoveryLockout('user-2', {});

    expect(client.userRecovery.upsert).toHaveBeenNthCalledWith(1, {
      where: { user_id: 'user-1' },
      create: {
        user_id: 'user-1',
        enabled: false,
        methods: '[]',
        sq_failed_attempts: 3,
        sq_last_failed_at: failedAt,
        sq_locked_until: null,
      },
      update: {
        sq_failed_attempts: 3,
        sq_last_failed_at: failedAt,
        sq_locked_until: null,
      },
    });
    expect(client.userRecovery.upsert).toHaveBeenNthCalledWith(2, {
      where: { user_id: 'user-2' },
      create: {
        user_id: 'user-2',
        enabled: false,
        methods: '[]',
        sq_failed_attempts: 0,
        sq_last_failed_at: null,
        sq_locked_until: null,
      },
      update: {
        sq_failed_attempts: undefined,
        sq_last_failed_at: null,
        sq_locked_until: null,
      },
    });
  });

  it('sets and clears email OTP and forces password reset', async () => {
    const client = prismaUserClient();
    const repository = new PrismaUserRepository(client as never);
    const otp = {
      hash: 'otp-hash',
      expires: new Date('2026-08-01T00:10:00.000Z'),
    };

    await repository.setEmailOtp('user-1', otp);
    await repository.clearEmailOtp('user-1');
    await repository.forcePasswordReset('user-1');

    expect(client.userMfaEmailOtp.upsert).toHaveBeenCalledWith({
      where: { user_id: 'user-1' },
      create: {
        user_id: 'user-1',
        otp_hash: 'otp-hash',
        expires_at: otp.expires,
      },
      update: { otp_hash: 'otp-hash', expires_at: otp.expires },
    });
    expect(client.userMfaEmailOtp.deleteMany).toHaveBeenCalledWith({
      where: { user_id: 'user-1' },
    });
    expect(client.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { password_force_reset: true },
    });
  });

  it('anonymizes direct identifiers with unique replacement values', async () => {
    const update = vi.fn().mockResolvedValue(
      prismaUserRow({
        email: 'anon@example.invalid',
        username: 'deleted-user',
        account_is_anonymized: true,
        account_enabled: false,
      })
    );
    const repository = new PrismaUserRepository(
      prismaUserClient({ update }) as never
    );

    await expect(repository.anonymize('user-1')).resolves.toEqual(
      expect.objectContaining({
        account_is_anonymized: true,
        account_enabled: false,
      })
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: expect.objectContaining({
        email: expect.stringMatching(/^anon-[a-f0-9]{12}@deleted\.invalid$/),
        username: expect.stringMatching(/^deleted-[a-f0-9]{12}$/),
        given_name: null,
        family_name: null,
        custom_identifier_1: null,
        custom_identifier_2: null,
        custom_identifier_3: null,
        account_is_anonymized: true,
        account_enabled: false,
      }),
      include: expect.any(Object),
    });
  });

  it('runs raw user queries with absent, ascending, and descending sort options', async () => {
    const findMany = vi.fn().mockResolvedValue([prismaUserRow()]);
    const repository = new PrismaUserRepository(
      prismaUserClient({ findMany }) as never
    );

    await repository.findManyRaw({ account_enabled: true });
    await repository.findManyRaw(
      {},
      { limit: 3, skip: 1, sort: { username: 1, email: 'asc' } }
    );
    await repository.findManyRaw({}, { sort: { created_at: -1 } });

    expect(findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { account_enabled: true },
        take: undefined,
        skip: undefined,
        orderBy: undefined,
      })
    );
    expect(findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        take: 3,
        skip: 1,
        orderBy: { username: 'asc', email: 'asc' },
      })
    );
    expect(findMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ orderBy: { created_at: 'desc' } })
    );
  });

  it('normalizes cross-database operators for Prisma raw queries', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = new PrismaUserRepository(
      prismaUserClient({ findMany }) as never
    );
    const cutoff = new Date('2026-07-01T00:00:00.000Z');

    await repository.findManyRaw({
      roles: { $in: ['admin'] } as unknown as string[],
      created_at: { $gte: cutoff },
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          created_at: { gte: cutoff },
          OR: [{ roles: { contains: '"admin"' } }],
        },
      })
    );
  });

  it.each([
    { count: 1, expected: true },
    { count: 0, expected: false },
  ])(
    'atomically consumes an unused backup code when update count is $count',
    async ({ count, expected }) => {
      const updateMany = vi.fn().mockResolvedValue({ count });
      const repository = new PrismaUserRepository({
        userBackupCode: { updateMany },
      } as never);

      await expect(
        repository.consumeBackupCode('user-1', 'code-hash')
      ).resolves.toBe(expected);
      expect(updateMany).toHaveBeenCalledWith({
        where: {
          user_id: 'user-1',
          code_hash: 'code-hash',
          used: false,
        },
        data: { used: true },
      });
    }
  );
});

describe('Mongoose user repository', () => {
  it('looks users up by each supported identifier', async () => {
    const queries = [
      mongooseQuery({ _id: { toString: () => 'email-user' } }),
      mongooseQuery({ _id: { toString: () => 'username-user' } }),
      mongooseQuery({ _id: { toString: () => 'sub-user' } }),
      mongooseQuery(null),
      mongooseQuery({ _id: { toString: () => 'recovery-token-user' } }),
    ];
    const findOne = vi
      .fn()
      .mockReturnValueOnce(queries[0])
      .mockReturnValueOnce(queries[1])
      .mockReturnValueOnce(queries[2])
      .mockReturnValueOnce(queries[3])
      .mockReturnValueOnce(queries[4]);
    const repository = new MongooseUserRepository({ findOne } as never);

    await expect(
      repository.findByEmail('a@example.com')
    ).resolves.toMatchObject({ id: 'email-user' });
    await expect(repository.findByUsername('alice')).resolves.toMatchObject({
      id: 'username-user',
    });
    await expect(repository.findBySub('subject-1')).resolves.toMatchObject({
      id: 'sub-user',
    });
    await expect(
      repository.findBySecondaryEmail('recovery@example.com')
    ).resolves.toBeNull();
    await expect(
      repository.findByRecoveryTokenHash('token-hash')
    ).resolves.toMatchObject({ id: 'recovery-token-user' });
    expect(findOne.mock.calls).toEqual([
      [{ email: 'a@example.com' }],
      [{ username: 'alice' }],
      [{ sub: 'subject-1' }],
      [{ 'recovery.secondary_email.email': 'recovery@example.com' }],
      [{ 'recovery.secondary_email.verification_token': 'token-hash' }],
    ]);
  });

  it('delegates paginated user searches with caller options', async () => {
    const paginate = vi.fn().mockResolvedValue({
      results: [{ _id: { toString: () => 'user-1' } }],
      totalResults: 1,
      page: 2,
      limit: 5,
      totalPages: 3,
      hasNextPage: true,
      hasPrevPage: true,
    });
    const repository = new MongooseUserRepository({ paginate } as never);

    await expect(
      repository.findMany(
        { account_enabled: true },
        { page: 2, limit: 5, sort: { username: 'asc' } }
      )
    ).resolves.toEqual({
      results: [expect.objectContaining({ id: 'user-1' })],
      totalResults: 1,
      page: 2,
      limit: 5,
      totalPages: 3,
      hasNextPage: true,
      hasPrevPage: true,
    });
    expect(paginate).toHaveBeenCalledWith(
      { account_enabled: true },
      { page: 2, limit: 5, sortBy: 'username:asc' }
    );
  });

  it('runs raw Mongoose user queries with sort, skip, and limit options', async () => {
    const exec = vi
      .fn()
      .mockResolvedValue([
        { _id: { toString: () => 'user-1' }, username: 'alice' },
      ]);
    const query: Record<string, ReturnType<typeof vi.fn>> = {};
    query.lean = vi.fn(() => query);
    query.sort = vi.fn(() => query);
    query.skip = vi.fn(() => query);
    query.limit = vi.fn(() => query);
    query.exec = exec;
    const find = vi.fn(() => query);
    const repository = new MongooseUserRepository({ find } as never);

    await expect(
      repository.findManyRaw(
        { account_enabled: true },
        { sort: { username: 'asc' }, skip: 2, limit: 3 }
      )
    ).resolves.toEqual([
      expect.objectContaining({ id: 'user-1', username: 'alice' }),
    ]);
    expect(find).toHaveBeenCalledWith({ account_enabled: true });
    expect(query.sort).toHaveBeenCalledWith({ username: 'asc' });
    expect(query.skip).toHaveBeenCalledWith(2);
    expect(query.limit).toHaveBeenCalledWith(3);
  });

  it('maps complete and empty MFA updates without inventing fields', async () => {
    const exec = vi.fn().mockResolvedValue(null);
    const findByIdAndUpdate = vi.fn().mockReturnValue({ exec });
    const repository = new MongooseUserRepository({
      findByIdAndUpdate,
    } as never);
    const verifiedAt = new Date('2026-08-01T02:00:00.000Z');

    await repository.updateMfa('user-1', {
      enabled: true,
      preferred_method: 'totp',
      'methods.totp': {
        enabled: true,
        secret: 'secret',
        verified_at: verifiedAt,
      },
      'methods.email': { enabled: true, verified_at: verifiedAt },
      'methods.webauthn': { enabled: true, verified_at: verifiedAt },
      email_otp: null,
    });
    await repository.updateMfa('user-2', {});

    expect(findByIdAndUpdate).toHaveBeenNthCalledWith(1, 'user-1', {
      $set: {
        'mfa.enabled': true,
        'mfa.preferred_method': 'totp',
        'mfa.methods.totp': {
          enabled: true,
          secret: 'secret',
          verified_at: verifiedAt,
        },
        'mfa.methods.email': { enabled: true, verified_at: verifiedAt },
        'mfa.methods.webauthn': { enabled: true, verified_at: verifiedAt },
        'mfa.email_otp': null,
      },
    });
    expect(findByIdAndUpdate).toHaveBeenNthCalledWith(2, 'user-2', {
      $set: {},
    });
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('maps recovery updates beneath the recovery document', async () => {
    const exec = vi.fn().mockResolvedValue(null);
    const findByIdAndUpdate = vi.fn().mockReturnValue({ exec });
    const repository = new MongooseUserRepository({
      findByIdAndUpdate,
    } as never);

    await repository.updateRecovery('user-1', {
      enabled: true,
      methods: ['backup_codes'],
    });
    await repository.updateRecovery('user-2', {});

    expect(findByIdAndUpdate).toHaveBeenNthCalledWith(1, 'user-1', {
      $set: {
        'recovery.enabled': true,
        'recovery.methods': ['backup_codes'],
      },
    });
    expect(findByIdAndUpdate).toHaveBeenNthCalledWith(2, 'user-2', {
      $set: {},
    });
  });

  it('adds and removes WebAuthn credentials', async () => {
    const exec = vi.fn().mockResolvedValue(null);
    const findByIdAndUpdate = vi.fn().mockReturnValue({ exec });
    const repository = new MongooseUserRepository({
      findByIdAndUpdate,
    } as never);
    const credential = {
      credential_id: 'credential-1',
      publicKey: 'public-key',
      counter: 3,
      device_type: 'platform',
      backed_up: true,
      transports: ['internal'],
    };

    await repository.addWebAuthnCredential('user-1', credential);
    await repository.removeWebAuthnCredential('user-1', 'credential-1');

    expect(findByIdAndUpdate).toHaveBeenNthCalledWith(1, 'user-1', {
      $push: { 'mfa.methods.webauthn.credentials': credential },
      $set: { 'mfa.methods.webauthn.enabled': true },
    });
    expect(findByIdAndUpdate).toHaveBeenNthCalledWith(2, 'user-1', {
      $pull: {
        'mfa.methods.webauthn.credentials': {
          credential_id: 'credential-1',
        },
      },
    });
  });

  it('stores backup-code timestamps with a ninety-day lifetime', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
    const exec = vi.fn().mockResolvedValue(null);
    const findByIdAndUpdate = vi.fn().mockReturnValue({ exec });
    const repository = new MongooseUserRepository({
      findByIdAndUpdate,
    } as never);

    try {
      await repository.addBackupCodes('user-1', ['one', 'two']);
    } finally {
      vi.useRealTimers();
    }

    expect(findByIdAndUpdate).toHaveBeenCalledWith('user-1', {
      $set: {
        'recovery.backup_codes': {
          codes: ['one', 'two'],
          generated_at: new Date('2026-08-01T00:00:00.000Z'),
          expires_at: new Date('2026-10-30T00:00:00.000Z'),
        },
      },
    });
  });

  it.each([
    { modifiedCount: 1, expected: true },
    { modifiedCount: 0, expected: false },
  ])(
    'atomically removes a backup code when modified count is $modifiedCount',
    async ({ modifiedCount, expected }) => {
      const exec = vi.fn().mockResolvedValue({ modifiedCount });
      const updateOne = vi.fn().mockReturnValue({ exec });
      const repository = new MongooseUserRepository({ updateOne } as never);

      await expect(
        repository.consumeBackupCode('user-1', 'code-hash')
      ).resolves.toBe(expected);
      expect(updateOne).toHaveBeenCalledWith(
        {
          _id: 'user-1',
          'recovery.backup_codes.codes': 'code-hash',
        },
        {
          $pull: { 'recovery.backup_codes.codes': 'code-hash' },
        }
      );
      expect(exec).toHaveBeenCalledOnce();
    }
  );

  it('adds security questions and tracks their setup time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
    const exec = vi.fn().mockResolvedValue(null);
    const findByIdAndUpdate = vi.fn().mockReturnValue({ exec });
    const repository = new MongooseUserRepository({
      findByIdAndUpdate,
    } as never);
    const question = {
      id: 'question-1',
      question_key: 'pet',
      answer_hash: 'hash',
    };

    try {
      await repository.addSecurityQuestion('user-1', question);
    } finally {
      vi.useRealTimers();
    }

    expect(findByIdAndUpdate).toHaveBeenCalledWith('user-1', {
      $push: { 'recovery.security_questions.questions': question },
      $set: {
        'recovery.security_questions.setup_at': new Date(
          '2026-08-01T00:00:00.000Z'
        ),
      },
    });
  });

  it('maps complete, nullable, and empty recovery lockout updates', async () => {
    const exec = vi.fn().mockResolvedValue(null);
    const findByIdAndUpdate = vi.fn().mockReturnValue({ exec });
    const repository = new MongooseUserRepository({
      findByIdAndUpdate,
    } as never);
    const failedAt = new Date('2026-08-01T00:00:00.000Z');

    await repository.updateRecoveryLockout('user-1', {
      failed_attempts: 3,
      last_failed_at: failedAt,
      locked_until: null,
    });
    await repository.updateRecoveryLockout('user-2', {});

    expect(findByIdAndUpdate).toHaveBeenNthCalledWith(1, 'user-1', {
      $set: {
        'recovery.security_questions.failed_attempts': 3,
        'recovery.security_questions.last_failed_at': failedAt,
        'recovery.security_questions.locked_until': null,
      },
    });
    expect(findByIdAndUpdate).toHaveBeenNthCalledWith(2, 'user-2', {
      $set: {},
    });
  });

  it('sets and clears email OTP state and forces password reset', async () => {
    const exec = vi.fn().mockResolvedValue(null);
    const findByIdAndUpdate = vi.fn().mockReturnValue({ exec });
    const repository = new MongooseUserRepository({
      findByIdAndUpdate,
    } as never);
    const otp = {
      hash: 'otp-hash',
      expires: new Date('2026-08-01T00:10:00.000Z'),
    };

    await repository.setEmailOtp('user-1', otp);
    await repository.clearEmailOtp('user-1');
    await repository.forcePasswordReset('user-1');

    expect(findByIdAndUpdate).toHaveBeenNthCalledWith(1, 'user-1', {
      $set: { 'mfa.email_otp': otp },
    });
    expect(findByIdAndUpdate).toHaveBeenNthCalledWith(2, 'user-1', {
      $unset: { 'mfa.email_otp': '' },
    });
    expect(findByIdAndUpdate).toHaveBeenNthCalledWith(3, 'user-1', {
      $set: { password_force_reset: true },
    });
  });

  it('anonymizes an existing user and rejects a missing user', async () => {
    const found = mongooseQuery({
      _id: { toString: () => 'user-1' },
      account_is_anonymized: true,
    });
    const missing = mongooseQuery(null);
    const findByIdAndUpdate = vi
      .fn()
      .mockReturnValueOnce(found)
      .mockReturnValueOnce(missing);
    const repository = new MongooseUserRepository({
      findByIdAndUpdate,
    } as never);

    await expect(repository.anonymize('user-1')).resolves.toEqual(
      expect.objectContaining({ id: 'user-1', account_is_anonymized: true })
    );
    await expect(repository.anonymize('missing')).rejects.toThrow(
      'User not found: missing'
    );
    for (const call of findByIdAndUpdate.mock.calls) {
      expect(call[1]).toEqual({
        $set: expect.objectContaining({
          account_is_anonymized: true,
          account_enabled: false,
        }),
      });
      expect(call[2]).toEqual({ returnDocument: 'after' });
    }
  });
});
