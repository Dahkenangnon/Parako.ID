import { describe, expect, it } from 'vitest';
import { convertSecurityFormData } from '../../../src/utils/settings.helper.js';

describe('convertSecurityFormData', () => {
  it('normalizes numeric security controls, sessions, MFA, logging, and breach checks', () => {
    const result = convertSecurityFormData({
      authentication: {
        login: {
          password_policy: {
            max_age_days: '90',
            min_length: '14',
            require_lowercase: [''],
            require_numbers: ['', 'on'],
            require_symbols: 'on',
            require_uppercase: ['', 'on'],
          },
        },
        multi_factor: {
          email: { code_ttl_seconds: '600', enabled: ['', 'on'] },
          webauthn: {
            authenticator_attachment: 'any',
            enabled: [''],
            max_credentials_per_user: '8',
            timeout: '45000',
          },
        },
        password_breach_detection: {
          api_timeout_ms: '5000',
          check_on_login: [''],
          check_on_password_change: true,
          check_on_password_reset: 'false',
          check_on_registration: ['', 'on'],
          enabled: 'on',
          min_breach_count: '2',
        },
        recovery: {
          backup_codes: { count: '10', enabled: 'on', expiry_days: '30' },
          enabled: ['', 'on'],
        },
        session: {
          absolute_timeout_hours: '24',
          bind_ip: ['', 'on'],
          cookie_name: '  parako.sid  ',
          idle_timeout_minutes: '30',
          max_accounts_per_session: '3',
          max_concurrent_sessions: '5',
          new_device_confidence_threshold: '70',
          same_site: '  lax  ',
        },
      },
      logging: {
        enabled: 'on',
        file_logging: { enabled: ['', 'on'], max_files: '14' },
        pretty_print: [''],
      },
      protection: {
        rate_limiting: {
          enabled: ['', 'on'],
          requests_per_minute: '120',
          window_minutes: '15',
        },
      },
    });

    expect(result).toMatchObject({
      authentication: {
        login: {
          password_policy: {
            max_age_days: 90,
            min_length: 14,
            require_lowercase: false,
            require_numbers: true,
            require_symbols: true,
            require_uppercase: true,
          },
        },
        multi_factor: {
          email: { code_ttl_seconds: 600, enabled: true },
          webauthn: {
            enabled: false,
            max_credentials_per_user: 8,
            timeout: 45000,
          },
        },
        password_breach_detection: {
          api_timeout_ms: 5000,
          check_on_login: false,
          check_on_password_change: true,
          check_on_password_reset: false,
          check_on_registration: true,
          enabled: true,
          min_breach_count: 2,
        },
        recovery: {
          backup_codes: { count: 10, enabled: true, expiry_days: 30 },
          enabled: true,
        },
        session: {
          absolute_timeout_hours: 24,
          bind_ip: true,
          cookie_name: 'parako.sid',
          idle_timeout_minutes: 30,
          max_accounts_per_session: 3,
          max_concurrent_sessions: 5,
          new_device_confidence_threshold: 70,
          same_site: 'lax',
        },
      },
      logging: {
        enabled: true,
        file_logging: { enabled: true, max_files: 14 },
        pretty_print: false,
      },
      protection: {
        rate_limiting: {
          enabled: true,
          requests_per_minute: 120,
          window_minutes: 15,
        },
      },
    });
    expect(result.authentication.multi_factor.webauthn).not.toHaveProperty(
      'authenticator_attachment'
    );
  });

  it('normalizes secret, network, country, and device-matching values', () => {
    const result = convertSecurityFormData({
      protection: {
        device_matching: {
          enable_impossible_travel: 'on',
          impossible_travel_max_speed_kmh: '900',
          ip_similarity_threshold: '0.75',
          min_confidence_score: '60',
          new_device_confidence_threshold: '65',
          similarity_threshold: '80',
          trust_duration_days: '45',
        },
        high_risk_countries: ' us\nFRA\n gb \n1A\n',
        trusted_domains: ' example.com\n\ninternal.example ',
        trusted_proxies: ' 10.0.0.1\n\n2001:db8::1 ',
      },
      secrets: { cookie_secrets: ' first-secret\n\nsecond-secret ' },
    });

    expect(result).toEqual({
      protection: {
        device_matching: {
          enable_impossible_travel: true,
          impossible_travel_max_speed_kmh: 900,
          ip_similarity_threshold: 0.75,
          min_confidence_score: 60,
          new_device_confidence_threshold: 65,
          similarity_threshold: 80,
          trust_duration_days: 45,
        },
        high_risk_countries: ['US', 'GB'],
        trusted_domains: ['example.com', 'internal.example'],
        trusted_proxies: ['10.0.0.1', '2001:db8::1'],
      },
      secrets: { cookie_secrets: ['first-secret', 'second-secret'] },
    });
  });

  it('creates empty list defaults and preserves explicit device false state', () => {
    const result = convertSecurityFormData({
      authentication: {
        custom_identifiers: {},
        roles: {},
        signup: { auto_approval: {} },
      },
      logging: { http_logging: {}, redaction: {} },
      protection: {
        device_matching: { enable_impossible_travel: 'false' },
        high_risk_countries: '',
        trusted_domains: '',
        trusted_proxies: '',
      },
      secrets: { cookie_secrets: '' },
    });

    expect(result).toMatchObject({
      authentication: {
        custom_identifiers: { fields: [] },
        roles: { available: ['user', 'admin', 'superadmin'] },
        signup: { auto_approval: { domains_whitelist: [] } },
      },
      logging: {
        http_logging: { ignore_paths: [] },
        redaction: { paths: [] },
      },
      protection: {
        device_matching: { enable_impossible_travel: false },
        high_risk_countries: [],
        trusted_domains: [],
        trusted_proxies: [],
      },
      secrets: { cookie_secrets: [] },
    });
  });

  it('preserves optional security sections when scalar controls are absent', () => {
    const result = convertSecurityFormData({
      authentication: {
        login: {
          login_methods: ['', 42, 'email+password'],
          password_policy: {},
        },
        multi_factor: { email: {} },
        password_breach_detection: {},
        recovery: { backup_codes: {} },
        signup: { signup_methods: 'email+password' },
      },
      protection: { device_matching: {} },
    });

    expect(result).toMatchObject({
      authentication: {
        login: {
          login_methods: ['email+password'],
          password_policy: {},
        },
        multi_factor: { email: {} },
        password_breach_detection: {
          check_on_login: false,
          check_on_password_change: false,
          check_on_password_reset: false,
          check_on_registration: false,
          enabled: false,
        },
        recovery: { backup_codes: {} },
        signup: { signup_methods: ['email+password'] },
      },
      protection: { device_matching: {} },
    });
  });

  it('normalizes auth methods, roles, allowlists, and logging paths', () => {
    const result = convertSecurityFormData({
      authentication: {
        login: { login_methods: 'custom_identifier+password' },
        roles: {
          admin_roles: ['legacy'],
          available: ' editor\nuser\n ',
          default: ' editor ',
          system_roles: ['legacy'],
        },
        signup: {
          auto_approval: {
            domains_whitelist: ' example.com\n\ncompany.example ',
          },
          signup_methods: ['full_name+email+password', '', 42, 'invalid'],
        },
      },
      logging: {
        http_logging: { ignore_paths: ' /readyz\n\n/healthz ' },
        redaction: { paths: ' req.headers.authorization\n user.password ' },
      },
    });

    expect(result).toEqual({
      authentication: {
        login: { login_methods: ['custom_identifier+password'] },
        roles: {
          available: ['editor', 'user', 'admin', 'superadmin'],
          default: 'editor',
        },
        signup: {
          auto_approval: {
            domains_whitelist: ['example.com', 'company.example'],
          },
          signup_methods: ['full_name+email+password'],
        },
      },
      logging: {
        http_logging: { ignore_paths: ['/readyz', '/healthz'] },
        redaction: {
          paths: ['req.headers.authorization', 'user.password'],
        },
      },
    });
  });

  it('leaves already structured allowlists and invalid custom fields untouched', () => {
    expect(
      convertSecurityFormData({
        authentication: {
          custom_identifiers: { fields: 'invalid' },
          signup: {
            auto_approval: { domains_whitelist: ['example.com'] },
          },
        },
        logging: {
          http_logging: { ignore_paths: ['/readyz'] },
          redaction: { paths: ['user.password'] },
        },
      })
    ).toMatchObject({
      authentication: {
        custom_identifiers: { fields: 'invalid' },
        signup: {
          auto_approval: { domains_whitelist: ['example.com'] },
        },
      },
      logging: {
        http_logging: { ignore_paths: ['/readyz'] },
        redaction: { paths: ['user.password'] },
      },
    });
  });

  it('normalizes custom identifier fields and checkbox variants', () => {
    const result = convertSecurityFormData({
      authentication: {
        custom_identifiers: {
          enabled: 'on',
          fields: [
            null,
            { key: '' },
            {
              case_sensitive: ['', 'on'],
              charset: 'A-Z',
              edit_policy: 'editable',
              hint_for_user: 123,
              key: 'employee_id',
              mask: 'EMP-####',
              max_length: '12',
              min_length: '4',
              name: 'Employee ID',
              pattern: '^EMP-',
              required_for_registration: 'true',
              slot: '2',
              usable_for_login: true,
              validation_type: 'regex',
            },
            {
              case_sensitive: [''],
              key: 'member',
              required_for_registration: 'false',
              usable_for_login: 'on',
            },
          ],
        },
      },
    });

    expect(result.authentication.custom_identifiers).toEqual({
      enabled: true,
      fields: [
        {
          case_sensitive: true,
          charset: 'A-Z',
          edit_policy: 'editable',
          hint_for_user: '123',
          key: 'employee_id',
          mask: 'EMP-####',
          max_length: 12,
          min_length: 4,
          name: 'Employee ID',
          pattern: '^EMP-',
          required_for_registration: true,
          slot: 2,
          usable_for_login: true,
          validation_type: 'regex',
        },
        {
          case_sensitive: false,
          charset: undefined,
          edit_policy: 'set_once',
          hint_for_user: '',
          key: 'member',
          mask: undefined,
          max_length: 100,
          min_length: 1,
          name: '',
          pattern: undefined,
          required_for_registration: false,
          slot: 1,
          usable_for_login: true,
          validation_type: 'none',
        },
      ],
    });
  });

  it('keeps supported WebAuthn attachment and canonical role arrays', () => {
    const result = convertSecurityFormData({
      authentication: {
        multi_factor: {
          webauthn: { authenticator_attachment: 'platform' },
        },
        roles: { available: [' admin ', 'auditor', ''] },
      },
    });

    expect(result.authentication.multi_factor.webauthn).toEqual({
      authenticator_attachment: 'platform',
    });
    expect(result.authentication.roles.available).toEqual([
      'admin',
      'auditor',
      'user',
      'superadmin',
    ]);
  });
});
