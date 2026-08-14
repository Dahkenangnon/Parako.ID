import mongoose from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createUserModel,
  type UserModel,
} from '../../../src/models/user.model.js';
import { tenantContext } from '../../../src/multi-tenancy/tenant-context.js';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as any;

const configManager = {
  getConfig: () => ({
    security: {
      authentication: {
        roles: { available: ['user', 'admin'], default: 'user' },
      },
    },
  }),
} as any;

const passwordUtils = {} as any;

describe('User Mongoose model', () => {
  let User: UserModel | undefined;

  const mockInsert = (model: UserModel) =>
    vi
      .spyOn(model.collection, 'insertOne')
      .mockImplementation(async document => ({
        acknowledged: true,
        insertedId: document._id ?? new mongoose.Types.ObjectId(),
      }));

  afterEach(() => {
    if (mongoose.models.User) {
      mongoose.deleteModel('User');
    }
    User = undefined;
  });

  it('is tenant-scoped even when compiled before the global plugin', () => {
    User = createUserModel(logger, configManager, passwordUtils);
    const user = tenantContext.run(
      'tenant-a',
      () => new User!({ username: 'maria' })
    );

    expect((User.schema as any)._tenantPluginApplied).toBe(true);
    expect(User.schema.path('tenant_id')?.options).toMatchObject({
      required: true,
      index: true,
    });
    expect(user.tenant_id).toBe('tenant-a');
  });

  it('assigns the configured default role to a new user', () => {
    User = createUserModel(logger, configManager, passwordUtils);
    const user = new User({ username: 'maria' });

    expect(user.roles).toEqual(['user']);
  });

  it.each(['platform_admin', 'platform_viewer'] as const)(
    'accepts the built-in %s role required by the system tenant',
    async role => {
      User = createUserModel(logger, configManager, passwordUtils);
      const user = tenantContext.run(
        '_platforms',
        () => new User!({ username: role, roles: [role] })
      );

      await expect(user.validate()).resolves.toBeUndefined();
    }
  );

  it('rejects platform roles on an ordinary tenant model', async () => {
    User = createUserModel(logger, configManager, passwordUtils);
    const user = tenantContext.run(
      'tenant-a',
      () =>
        new User!({
          username: 'tenant-platform-admin',
          roles: ['platform_admin'],
        })
    );

    await expect(user.validate()).rejects.toMatchObject({
      errors: { roles: expect.anything() },
    });
  });

  it('applies stable account, locale, MFA, recovery, and notification defaults', () => {
    User = createUserModel(logger, configManager, passwordUtils);
    const user = new User({ username: 'maria' });

    expect(user).toMatchObject({
      gender: 'M',
      locale: 'fr',
      country: 'bj',
      zoneinfo: 'Africa/Porto-Novo',
      phone_number_verified: false,
      email_verified: false,
      theme: 'light',
      sidebar_expanded: true,
      mfa: {
        enabled: false,
        methods: {
          totp: { enabled: false },
          email: { enabled: false },
          webauthn: { enabled: false },
        },
      },
      recovery: {
        enabled: false,
        methods: [],
        secondary_email: { verified: false },
        sms: { verified: false },
        security_questions: { failed_attempts: 0 },
        lockout: { failed_attempts: 0 },
      },
      password_force_reset: false,
      blocked_from: [],
      account_is_anonymized: false,
      register_with: 'email',
      auth_provider: 'local',
      account_enabled: true,
      notification_preferences: {
        preferred_channel: 'auto',
        security_alerts: true,
        new_session_alerts: true,
        marketing: false,
      },
    });
  });

  it('normalizes email, roles, and optional custom identifiers', () => {
    User = createUserModel(logger, configManager, passwordUtils);
    const user = new User({
      username: '  maria  ',
      email: '  MARIA@EXAMPLE.TEST  ',
      roles: [' admin ', 'user'],
      custom_identifier_1: '  employee-1  ',
      custom_identifier_2: '   ',
      custom_identifier_3: null,
    });

    expect(user.username).toBe('maria');
    expect(user.email).toBe('maria@example.test');
    expect(user.roles).toEqual(['admin', 'user']);
    expect(user.custom_identifier_1).toBe('employee-1');
    expect(user.custom_identifier_2).toBeUndefined();
    expect(user.custom_identifier_3).toBeUndefined();

    const complementaryValues = new User({
      username: 'other-user',
      custom_identifier_1: '',
      custom_identifier_2: '  employee-2  ',
      custom_identifier_3: '  employee-3  ',
    });

    expect(complementaryValues.custom_identifier_1).toBeUndefined();
    expect(complementaryValues.custom_identifier_2).toBe('employee-2');
    expect(complementaryValues.custom_identifier_3).toBe('employee-3');
  });

  it('rejects missing or oversized usernames and unsupported enum values', async () => {
    User = createUserModel(logger, configManager, passwordUtils);
    const invalid = new User({
      username: 'x'.repeat(51),
      gender: 'unknown',
      roles: ['owner'],
      theme: 'system',
      register_with: 'saml',
      auth_provider: 'saml',
      mfa: { preferred_method: 'sms' },
      recovery: { methods: ['email'] },
      notification_preferences: { preferred_channel: 'push' },
    });

    const validation = await invalid.validate().catch(error => error);

    expect(validation?.errors).toEqual(
      expect.objectContaining({
        username: expect.anything(),
        gender: expect.anything(),
        'roles.0': expect.anything(),
        theme: expect.anything(),
        register_with: expect.anything(),
        auth_provider: expect.anything(),
        'mfa.preferred_method': expect.anything(),
        'recovery.methods.0': expect.anything(),
        'notification_preferences.preferred_channel': expect.anything(),
      })
    );

    await expect(new User().validate()).rejects.toMatchObject({
      errors: { username: expect.anything() },
    });
  });

  it.each([
    {
      label: 'given and family names',
      input: { given_name: 'Maria', family_name: 'Doe' },
      expected: 'Maria Doe',
    },
    {
      label: 'given name only',
      input: { given_name: 'Maria' },
      expected: 'Maria',
    },
    {
      label: 'family name only',
      input: { family_name: 'Doe' },
      expected: 'Doe',
    },
    {
      label: 'first custom identifier',
      input: { custom_identifier_1: 'employee-1' },
      expected: 'employee-1',
    },
  ])('derives the display name from $label', async ({ input, expected }) => {
    User = createUserModel(logger, configManager, passwordUtils);
    mockInsert(User);
    const user = new User({ username: 'maria', ...input });

    await user.save();

    expect(user.name).toBe(expected);
  });

  it('preserves an explicit display name when no name parts are available', async () => {
    User = createUserModel(logger, configManager, passwordUtils);
    mockInsert(User);
    const user = new User({
      username: 'social-user',
      name: 'Provider Display Name',
    });

    await user.save();

    expect(user.name).toBe('Provider Display Name');
  });

  it('reuses the compiled model and exposes the tenant-safe uniqueness contract', () => {
    User = createUserModel(logger, configManager, passwordUtils);
    const reused = createUserModel(logger, configManager, passwordUtils);
    const indexes = User.schema.indexes();

    expect(reused).toBe(User);
    expect(User.collection.collectionName).toBe('users');
    expect(User.schema.options.timestamps).toEqual({
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    });
    expect(typeof User.paginate).toBe('function');
    expect(indexes).toEqual(
      expect.arrayContaining([
        [{ tenant_id: 1, username: 1 }, { unique: true }],
        [
          { tenant_id: 1, email: 1 },
          {
            unique: true,
            partialFilterExpression: { email: { $type: 'string' } },
          },
        ],
        [
          { tenant_id: 1, custom_identifier_1: 1 },
          {
            unique: true,
            partialFilterExpression: {
              custom_identifier_1: { $type: 'string' },
            },
          },
        ],
      ])
    );
  });

  it('never serializes authentication, MFA, or recovery secrets', () => {
    User = createUserModel(logger, configManager, passwordUtils);
    const user = new User({
      username: 'maria',
      password: 'password-hash',
      reset_password_token: 'reset-token',
      email_verification_token: 'verification-token',
      mfa: {
        enabled: true,
        methods: {
          totp: { enabled: true, secret: 'totp-secret' },
          webauthn: {
            enabled: true,
            credentials: [{ credentialID: 'credential-secret' }],
          },
        },
        email_otp: {
          hash: 'otp-hash',
          expires: new Date('2026-08-02T13:00:00.000Z'),
        },
      },
      recovery: {
        enabled: true,
        methods: [
          'backup_codes',
          'secondary_email',
          'sms',
          'security_questions',
        ],
        backup_codes: {
          codes: ['backup-code-hash'],
          generated_at: new Date('2026-08-01T00:00:00.000Z'),
          expires_at: new Date('2027-08-01T00:00:00.000Z'),
        },
        secondary_email: {
          email: 'recovery@example.test',
          verified: false,
          verification_token: 'secondary-email-token',
        },
        sms: {
          phone_number: '+22901020304',
          verified: false,
          verification_code: '123456',
        },
        security_questions: {
          questions: [
            {
              id: 'q1',
              question_key: 'first_school',
              answer_hash: 'answer-hash',
            },
          ],
        },
      },
    });

    const serialized = user.toJSON() as Record<string, any>;

    expect(serialized).not.toHaveProperty('password');
    expect(serialized).not.toHaveProperty('reset_password_token');
    expect(serialized).not.toHaveProperty('email_verification_token');
    expect(serialized.mfa.methods.totp).not.toHaveProperty('secret');
    expect(serialized.mfa.methods.webauthn).not.toHaveProperty('credentials');
    expect(serialized.mfa.email_otp).not.toHaveProperty('hash');
    expect(serialized.recovery.backup_codes).not.toHaveProperty('codes');
    expect(serialized.recovery.secondary_email).not.toHaveProperty(
      'verification_token'
    );
    expect(serialized.recovery.sms).not.toHaveProperty('verification_code');
    expect(
      serialized.recovery.security_questions.questions[0]
    ).not.toHaveProperty('answer_hash');
  });
});
