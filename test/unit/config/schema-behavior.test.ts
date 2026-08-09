import { describe, expect, it } from 'vitest';
import { getDefaultFullConfig } from '../../../src/config/constants.js';
import { AppConfigSchema } from '../../../src/config/schemas/schema.js';

function createConfig(): Record<string, any> {
  return structuredClone(getDefaultFullConfig()) as Record<string, any>;
}

function parseConfig(config: Record<string, any>) {
  return AppConfigSchema.parse(config);
}

describe('AppConfigSchema executable behavior', () => {
  describe('HTML boolean coercion', () => {
    it.each([
      [true, true],
      [false, false],
      [null, false],
      ['on', true],
      ['TRUE', true],
      ['1', true],
      ['off', false],
      ['false', false],
      ['0', false],
      ['unexpected', false],
    ])('coerces %j to %s', (input, expected) => {
      const config = createConfig();
      config.notifications.defaults.security_alerts = input;

      expect(parseConfig(config).notifications.defaults.security_alerts).toBe(
        expected
      );
    });
  });

  describe('branding asset locations', () => {
    const fields = [
      'logo',
      'logoDark',
      'logoIcon',
      'logoIconDark',
      'favicon',
    ] as const;

    it.each(fields)('accepts relative and HTTP(S) values for %s', field => {
      for (const value of [
        '/images/brand.svg',
        'https://cdn.example.test/brand.svg',
        'http://cdn.example.test/brand.svg',
      ]) {
        const config = createConfig();
        config.branding[field] = value;

        expect(AppConfigSchema.safeParse(config).success).toBe(true);
      }
    });

    it.each(fields)(
      'rejects malformed, dangerous, and protocol-relative values for %s',
      field => {
        for (const value of [
          'not a URL',
          'javascript:alert(1)',
          'data:image/svg+xml,<svg/>',
          '//attacker.example/brand.svg',
          '/\\attacker.example/brand.svg',
        ]) {
          const config = createConfig();
          config.branding[field] = value;

          expect(AppConfigSchema.safeParse(config).success).toBe(false);
        }
      }
    );
  });

  it('trims configured roles and the default role', () => {
    const config = createConfig();
    config.security.authentication.roles = {
      available: [' user ', ' admin'],
      default: ' user ',
    };

    const parsed = parseConfig(config);

    expect(parsed.security.authentication.roles).toEqual({
      available: ['user', 'admin'],
      default: 'user',
    });
  });

  describe('custom identifier normalization', () => {
    function field(overrides: Record<string, unknown> = {}) {
      return {
        slot: 1,
        key: 'employee_id',
        name: 'Employee ID',
        validation_type: 'none',
        min_length: 1,
        max_length: 20,
        ...overrides,
      };
    }

    function parseFields(fields: Record<string, unknown>[]) {
      const config = createConfig();
      config.security.authentication.custom_identifiers = {
        enabled: true,
        fields,
      };
      return AppConfigSchema.safeParse(config);
    }

    it('keeps safe regex and complete charset-mask validation', () => {
      const result = parseFields([
        field({ validation_type: 'regex', pattern: '^[A-Z]{2}\\d{4}$' }),
        field({
          slot: 2,
          key: 'member_code',
          validation_type: 'charset_mask',
          charset: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
          mask: '****-****',
        }),
      ]);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(
          result.data.security.authentication.custom_identifiers.fields
        ).toMatchObject([
          { validation_type: 'regex', pattern: '^[A-Z]{2}\\d{4}$' },
          {
            validation_type: 'charset_mask',
            charset: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
            mask: '****-****',
          },
        ]);
      }
    });

    it.each([
      [{ validation_type: 'regex' }, { validation_type: 'none' }],
      [
        { validation_type: 'regex', pattern: '(a+)+' },
        { validation_type: 'none', pattern: undefined },
      ],
      [
        { validation_type: 'charset_mask', charset: 'ABC' },
        { validation_type: 'none', charset: undefined, mask: undefined },
      ],
      [
        { validation_type: 'charset_mask', mask: '***' },
        { validation_type: 'none', charset: undefined, mask: undefined },
      ],
    ])('normalizes incomplete or unsafe validation: %j', (input, expected) => {
      const result = parseFields([field(input)]);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(
          result.data.security.authentication.custom_identifiers.fields[0]
        ).toMatchObject(expected);
      }
    });

    it('clamps minimum length to the configured maximum', () => {
      const result = parseFields([field({ min_length: 20, max_length: 5 })]);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(
          result.data.security.authentication.custom_identifiers.fields[0]
            .min_length
        ).toBe(5);
      }
    });

    it.each([
      [
        [field(), field({ key: 'other', slot: 1 })],
        'Each field must use a unique slot number',
      ],
      [
        [field(), field({ key: 'employee_id', slot: 2 })],
        'Each field must have a unique key',
      ],
    ])('rejects duplicate identifier definitions', (fields, message) => {
      const result = parseFields(fields);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map(issue => issue.message)).toContain(
          message
        );
      }
    });
  });

  describe('dynamic client registration', () => {
    it.each([false, 'false'])(
      'forces initial access tokens when registration is enabled and input is %j',
      requireInitialAccessToken => {
        const config = createConfig();
        config.features.oidc.dynamic_client_registration = {
          enabled: true,
          require_initial_access_token: requireInitialAccessToken,
          issue_registration_access_token: true,
        };

        expect(
          parseConfig(config).features.oidc.dynamic_client_registration
            .require_initial_access_token
        ).toBe(true);
      }
    );

    it('preserves a false initial-access-token setting while registration is disabled', () => {
      const config = createConfig();
      config.features.oidc.dynamic_client_registration = {
        enabled: false,
        require_initial_access_token: false,
        issue_registration_access_token: true,
      };

      expect(
        parseConfig(config).features.oidc.dynamic_client_registration
          .require_initial_access_token
      ).toBe(false);
    });
  });

  describe('OIDC provider feature dependencies', () => {
    it.each([
      {
        name: 'JWT introspection without token introspection',
        configure(oidc: Record<string, any>) {
          oidc.jwt_introspection.enabled = true;
          oidc.token_introspection.enabled = false;
        },
        path: ['features', 'oidc', 'jwt_introspection', 'enabled'],
        message:
          'JWT introspection requires the token introspection endpoint to be enabled',
      },
      {
        name: 'JWT UserInfo without the UserInfo endpoint',
        configure(oidc: Record<string, any>) {
          oidc.jwt_userinfo.enabled = true;
          oidc.userinfo_endpoint.enabled = false;
        },
        path: ['features', 'oidc', 'jwt_userinfo', 'enabled'],
        message: 'JWT UserInfo requires the UserInfo endpoint to be enabled',
      },
      {
        name: 'registration management without dynamic registration',
        configure(oidc: Record<string, any>) {
          oidc.client_registration_management.enabled = true;
          oidc.dynamic_client_registration.enabled = false;
        },
        path: ['features', 'oidc', 'client_registration_management', 'enabled'],
        message:
          'Client registration management requires dynamic client registration to be enabled',
      },
    ])(
      'rejects $name before provider construction',
      ({ configure, path, message }) => {
        const config = createConfig();
        configure(config.features.oidc);

        const result = AppConfigSchema.safeParse(config);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues).toContainEqual(
            expect.objectContaining({ path, message })
          );
        }
      }
    );

    it('accepts each dependent OIDC feature with its provider prerequisite', () => {
      const config = createConfig();
      config.features.oidc.jwt_introspection.enabled = true;
      config.features.oidc.token_introspection.enabled = true;
      config.features.oidc.jwt_userinfo.enabled = true;
      config.features.oidc.userinfo_endpoint.enabled = true;
      config.features.oidc.client_registration_management.enabled = true;
      config.features.oidc.dynamic_client_registration.enabled = true;

      expect(AppConfigSchema.safeParse(config).success).toBe(true);
    });
  });

  describe('OIDC device-flow provider configuration', () => {
    it.each(['ABC-123', '***_***', '***.***'])(
      'rejects the provider-unsupported user-code mask %j',
      mask => {
        const config = createConfig();
        config.features.oidc.device_flow.mask = mask;

        const result = AppConfigSchema.safeParse(config);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues).toContainEqual(
            expect.objectContaining({
              path: ['features', 'oidc', 'device_flow', 'mask'],
              message:
                'Device code mask can only contain asterisks, hyphens, and spaces',
            })
          );
        }
      }
    );

    it.each(['***-*-***', '**** ****', '---'])(
      'accepts the provider-supported user-code mask %j',
      mask => {
        const config = createConfig();
        config.features.oidc.device_flow.mask = mask;

        expect(AppConfigSchema.safeParse(config).success).toBe(true);
      }
    );
  });

  it('rejects an empty OIDC subject-type list before provider construction', () => {
    const config = createConfig();
    config.features.oidc.subject_types = [];

    const result = AppConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['features', 'oidc', 'subject_types'],
          message: 'At least one OIDC subject type must be enabled',
        })
      );
    }
  });

  describe('email sender validation', () => {
    it.each(['noreply@example.test', 'Parako Support <noreply@example.test>'])(
      'accepts supported sender form %j',
      from => {
        const config = createConfig();
        config.integrations.email.from = from;

        expect(AppConfigSchema.safeParse(config).success).toBe(true);
      }
    );

    it.each(['invalid', 'Parako <invalid>', '@example.test'])(
      'rejects invalid sender form %j',
      from => {
        const config = createConfig();
        config.integrations.email.from = from;

        expect(AppConfigSchema.safeParse(config).success).toBe(false);
      }
    );
  });
});
