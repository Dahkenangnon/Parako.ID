import { describe, expect, it } from 'vitest';
import {
  convertBrandingFormData,
  convertDeploymentFormData,
  convertFeaturesFormData,
  convertIntegrationsFormData,
  convertNotificationsFormData,
  convertOidcFormData,
  convertSecurityFormData,
  getSectionIcon,
  getSectionStatus,
  isValidIP,
} from '../../../src/utils/settings.helper.js';

describe('settings helper form conversion', () => {
  it('accepts standard IPv4 and compressed IPv6 while rejecting invalid input', () => {
    expect(isValidIP('192.168.1.10')).toBe(true);
    expect(isValidIP('2001:db8::1')).toBe(true);
    expect(isValidIP('::1')).toBe(true);
    expect(isValidIP('::ffff:192.168.1.10')).toBe(true);
    expect(isValidIP('256.1.1.1')).toBe(false);
    expect(isValidIP('2001:::1')).toBe(false);
    expect(isValidIP('not-an-ip')).toBe(false);
    expect(isValidIP(null as never)).toBe(false);
  });

  it('sanitizes branding colors, fonts, and customization state', () => {
    const result = convertBrandingFormData({
      colors: {
        dark: null,
        light: {
          accent: ' #AbC ',
          background: '#123456',
          border: 'red',
          foreground: '#123456; background:url(javascript:alert(1))',
          primary: 42,
          unknown: '#ffffff',
        },
      },
      fonts: {
        heading: ' Arial, Helvetica, sans-serif ',
        mono: 'Consolas, monospace',
        sans: 'url(https://attacker.example/font)',
      },
      ui: { customization: { enabled: 'on' } },
    });

    expect(result).toEqual({
      colors: {
        dark: {},
        light: { accent: '#AbC', background: '#123456' },
      },
      fonts: {
        heading: 'Arial, Helvetica, sans-serif',
        mono: 'Consolas, monospace',
        sans: null,
      },
      ui: { customization: { enabled: true } },
    });
  });

  it('handles absent branding sections and false customization values', () => {
    expect(convertBrandingFormData({})).toEqual({});
    expect(
      convertBrandingFormData({
        colors: 'invalid',
        fonts: { heading: '', mono: null, sans: 42 },
        ui: { customization: { enabled: true } },
      })
    ).toEqual({
      colors: { dark: {}, light: {} },
      fonts: { heading: null, mono: null, sans: null },
      ui: { customization: { enabled: true } },
    });
    expect(
      convertBrandingFormData({ ui: { customization: { enabled: 'false' } } })
        .ui.customization.enabled
    ).toBe(false);
  });

  it('normalizes deployment numbers, checkboxes, origins, and legacy proxy settings', () => {
    const result = convertDeploymentFormData({
      cookies: {
        defaults: {
          httpOnly: ['', 'on'],
          maxAge: '3600000',
          secure: [''],
        },
      },
      server: {
        allowed_origins:
          ' https://one.example, https://two.example\n\nhttps://three.example ',
        dev_allowed_origins: '*',
        port: '9007',
        proxy: true,
      },
    });

    expect(result).toEqual({
      cookies: {
        defaults: { httpOnly: true, maxAge: 3600000, secure: false },
      },
      server: {
        allowed_origins: [
          'https://one.example',
          'https://two.example',
          'https://three.example',
        ],
        dev_allowed_origins: [],
        port: 9007,
        trust_proxy_hops: 1,
      },
    });
  });

  it('preserves canonical origin arrays and handles trust-proxy edge cases', () => {
    expect(
      convertDeploymentFormData({
        server: {
          allowed_origins: ['https://one.example'],
          dev_allowed_origins: null,
          proxy: false,
          trust_proxy_hops: 'invalid',
        },
      })
    ).toEqual({
      server: {
        allowed_origins: ['https://one.example'],
        dev_allowed_origins: null,
        trust_proxy_hops: 'invalid',
      },
    });
    expect(
      convertDeploymentFormData({
        server: { allowed_origins: '  ', proxy: false },
      })
    ).toEqual({
      server: { allowed_origins: [], trust_proxy_hops: 0 },
    });
    expect(convertDeploymentFormData({})).toEqual({});
  });

  it('preserves unsupported origin values and parses explicit proxy hops', () => {
    expect(
      convertDeploymentFormData({
        server: {
          allowed_origins: null,
          dev_allowed_origins: 42,
          trust_proxy_hops: '2',
        },
      })
    ).toEqual({
      server: {
        allowed_origins: null,
        dev_allowed_origins: 42,
        trust_proxy_hops: 2,
      },
    });
  });

  it('normalizes OIDC feature lists, numeric values, and booleans', () => {
    const result = convertFeaturesFormData({
      oidc: {
        acr_values: { supported: ' urn:mfa\n\nurn:pwd ' },
        clock_tolerance: '15',
        device_flow: { enabled: ['', 'on'] },
        extra_client_metadata: { properties: ' tenant\n theme ' },
        extra_params: {
          allowed_params: ' audience\n\nresource ',
          enabled: [''],
        },
        pkce: { enabled: 'on', required: ['', 'on'] },
        scopes: ' openid\n profile\n ',
      },
      social_providers: {
        behavior: { options: { max_providers_per_user: '4' } },
        enabled: ['', 'google', undefined, 'github'],
      },
    });

    expect(result).toMatchObject({
      oidc: {
        acr_values: { supported: ['urn:mfa', 'urn:pwd'] },
        clock_tolerance: 15,
        device_flow: { enabled: true },
        extra_client_metadata: { properties: ['tenant', 'theme'] },
        extra_params: {
          allowed_params: ['audience', 'resource'],
          enabled: false,
        },
        pkce: { enabled: true, required: true },
        scopes: ['openid', 'profile'],
      },
      social_providers: {
        behavior: { options: { max_providers_per_user: 4 } },
        enabled: ['google', 'github'],
      },
    });
  });

  it.each([
    ['', []],
    [['', 'public', ''], ['public']],
  ])('normalizes submitted OIDC subject types: %j', (submitted, expected) => {
    const result = convertFeaturesFormData({
      oidc: { subject_types: submitted },
    });

    expect(result.oidc.subject_types).toEqual(expected);
  });

  it('creates empty feature arrays only for present empty sections', () => {
    expect(
      convertFeaturesFormData({
        oidc: {
          acr_values: {},
          extra_client_metadata: {},
          extra_params: {},
          scopes: '',
        },
      })
    ).toEqual({
      oidc: {
        acr_values: { supported: [] },
        extra_client_metadata: { properties: [] },
        extra_params: { allowed_params: [] },
        scopes: [],
      },
    });
    expect(convertFeaturesFormData({})).toEqual({});
    expect(
      convertFeaturesFormData({ social_providers: { enabled: 42 } })
    ).toEqual({ social_providers: { enabled: 42 } });
  });

  it('normalizes selected, existing, and absent JWA algorithm values', () => {
    const result = convertOidcFormData({
      oidc: {
        discovery: {
          claims_locales_supported: ['en'],
          display_values_supported: 42,
        },
        jwa: {
          attest_signing_alg_values: 'RS256',
          authorization_encryption_alg_values: ['', 'RSA-OAEP', ''],
          id_token_signing_alg_values: null,
          userinfo_signing_alg_values: '',
        },
        token_ttl: { access_token: 0, id_token: '3600' },
      },
    });

    expect(result.oidc.discovery).toEqual({
      claims_locales_supported: ['en'],
      display_values_supported: 42,
    });
    expect(result.oidc.token_ttl).toEqual({ access_token: 0, id_token: 3600 });
    expect(result.oidc.jwa.attest_signing_alg_values).toEqual(['RS256']);
    expect(result.oidc.jwa.authorization_encryption_alg_values).toEqual([
      'RSA-OAEP',
    ]);
    expect(result.oidc.jwa.id_token_signing_alg_values).toEqual([]);
    expect(result.oidc.jwa.userinfo_signing_alg_values).toEqual([]);
    expect(result.oidc.jwa.dpop_signing_alg_values).toEqual([]);
  });

  it('normalizes integration false states, numbers, and empty fingerprint fields', () => {
    const result = convertIntegrationsFormData({
      fingerprintjs: {
        api_key: '   ',
        enabled: 'false',
        endpoint: '   ',
      },
      ipinfo: {
        cache_ttl_hours: '0',
        enabled: false,
      },
      ipqualityscore: {
        cache_ttl_hours: '8',
        enabled: 'false',
        fraud_score_threshold: '0',
      },
    });

    expect(result).toEqual({
      fingerprintjs: {
        api_key: undefined,
        enabled: false,
        endpoint: undefined,
      },
      ipinfo: { cache_ttl_hours: 0, enabled: false },
      ipqualityscore: {
        cache_ttl_hours: 8,
        enabled: false,
        fraud_score_threshold: 0,
      },
    });
  });

  it('preserves present integration sections when optional fields are absent', () => {
    expect(
      convertIntegrationsFormData({
        fingerprintjs: {},
        ipinfo: {},
        ipqualityscore: {},
      })
    ).toEqual({ fingerprintjs: {}, ipinfo: {}, ipqualityscore: {} });
  });

  it('normalizes notification scalar checkboxes, optional strings, and partial limits', () => {
    const result = convertNotificationsFormData({
      notifications: {
        channels: {
          email: { enabled: true },
          sms: {
            api_key: 123,
            api_secret: 456,
            enabled: 'true',
            from_number: 789,
            provider: 42,
            rate_limits: {
              cooldown_seconds: '',
              per_ip_per_day: '20',
              per_phone_per_hour: 0,
            },
          },
        },
        defaults: {
          allow_user_preferences: 'on',
          new_session_alerts: 'false',
          security_alerts: true,
        },
      },
    });

    expect(result).toEqual({
      channels: {
        email: { enabled: true },
        sms: {
          api_key: '123',
          api_secret: '456',
          enabled: true,
          from_number: '789',
          provider: '42',
          rate_limits: { per_ip_per_day: 20 },
        },
      },
      defaults: {
        allow_user_preferences: true,
        new_session_alerts: false,
        security_alerts: true,
      },
    });

    expect(
      convertNotificationsFormData({
        channels: { sms: { rate_limits: { per_phone_per_hour: '5' } } },
      }).channels.sms.rate_limits
    ).toEqual({ per_phone_per_hour: 5 });
  });

  it('maps known section icons, defaults unknown icons, and reports section presence', () => {
    expect(getSectionIcon('application')).toBe('cog');
    expect(getSectionIcon('branding')).toBe('palette');
    expect(getSectionIcon('deployment')).toBe('server');
    expect(getSectionIcon('security')).toBe('shield-check');
    expect(getSectionIcon('features')).toBe('sparkles');
    expect(getSectionIcon('oidc')).toBe('key');
    expect(getSectionIcon('integrations')).toBe('plug');
    expect(getSectionIcon('unknown')).toBe('cog');

    expect(getSectionStatus({ oidc: {} }, 'oidc')).toBe(true);
    expect(getSectionStatus({ oidc: null }, 'oidc')).toBe(false);
    expect(getSectionStatus({}, 'oidc')).toBe(false);
    expect(getSectionStatus(null, 'oidc')).toBe(false);
  });

  it('rejects authentication methods that only contain an allowed token as a substring', () => {
    const result = convertSecurityFormData({
      authentication: {
        login: { login_methods: ['notemailattack', 'password-injection'] },
        signup: { signup_methods: ['phone-hack', 'full_name_suffix'] },
      },
    });

    expect(result.authentication.login.login_methods).toEqual([
      'email+password',
    ]);
    expect(result.authentication.signup.signup_methods).toEqual([
      'email+password',
    ]);
  });

  it('normalizes human-entered MFA identifiers before validation and persistence', () => {
    const result = convertSecurityFormData({
      authentication: {
        multi_factor: {
          totp: { issuer_name: '  Parako.ID  ' },
          webauthn: {
            rp_name: '  Parako Passkeys  ',
            rp_id: '  id.example.com  ',
          },
        },
      },
    });

    expect(result.authentication.multi_factor).toMatchObject({
      totp: { issuer_name: 'Parako.ID' },
      webauthn: {
        rp_name: 'Parako Passkeys',
        rp_id: 'id.example.com',
      },
    });
  });

  it('preserves a checked impossible-travel control submitted with its hidden fallback', () => {
    const result = convertSecurityFormData({
      protection: {
        device_matching: {
          enable_impossible_travel: ['', 'on'],
        },
      },
    });

    expect(result.protection.device_matching.enable_impossible_travel).toBe(
      true
    );
  });
});
