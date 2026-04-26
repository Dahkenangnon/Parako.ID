/**
 * TDD — settings.helper utility functions
 *
 * Bug 1: convertBooleanFields() does not handle array values from
 * the hidden+checkbox HTML pattern. Express qs parser converts
 * duplicate field names into arrays: ["", "on"] (checked) or [""] (unchecked).
 *
 * The function must handle:
 * - 'on' → true  (standard checkbox)
 * - undefined → left absent  (field not on this page, mergeConfig skips it)
 * - ["", "on"] → true  (hidden+checkbox, checked)
 * - [""] → false  (hidden+checkbox, unchecked)
 * - '' → left as-is  (for stripEmptyValues to handle)
 */
import { describe, it, expect } from 'vitest';
import {
  convertBooleanFields,
  convertFeaturesFormData,
  convertIntegrationsFormData,
  convertNotificationsFormData,
  convertOidcFormData,
  convertSecurityFormData,
} from '../../../src/utils/settings.helper.js';

describe('convertBooleanFields()', () => {
  it('converts "on" to true', () => {
    const result = convertBooleanFields({ field: 'on' }, ['field']);
    expect(result.field).toBe(true);
  });

  it('leaves undefined fields unchanged (not in form data)', () => {
    const result = convertBooleanFields({}, ['field']);
    expect(result.field).toBeUndefined();
  });

  it('converts ["", "on"] array to true', () => {
    const result = convertBooleanFields({ field: ['', 'on'] }, ['field']);
    expect(result.field).toBe(true);
  });

  it('converts [""] array to false', () => {
    const result = convertBooleanFields({ field: [''] }, ['field']);
    expect(result.field).toBe(false);
  });

  it('converts empty string from hidden input to false', () => {
    const result = convertBooleanFields({ field: '' }, ['field']);
    expect(result.field).toBe(false);
  });

  it('does not create intermediate objects for fields not in form data', () => {
    const formData = {
      authentication: {
        multi_factor: { enabled: ['', 'on'], totp: { enabled: [''] } },
      },
    };
    const result = convertBooleanFields(formData, [
      'authentication.multi_factor.enabled',
      'authentication.multi_factor.totp.enabled',
      'authentication.session.bind_ip',
      'protection.rate_limiting.enabled',
    ]);

    expect(result.authentication.multi_factor.enabled).toBe(true);
    expect(result.authentication.multi_factor.totp.enabled).toBe(false);
    expect(result.authentication.session).toBeUndefined();
    expect(result.protection).toBeUndefined();
  });

  it('handles nested field paths with array values', () => {
    const result = convertBooleanFields(
      { authentication: { session: { bind_ip: ['', 'on'] } } },
      ['authentication.session.bind_ip']
    );
    expect(result.authentication.session.bind_ip).toBe(true);
  });

  it('handles nested field paths with [""] (unchecked)', () => {
    const result = convertBooleanFields(
      { authentication: { session: { bind_ip: [''] } } },
      ['authentication.session.bind_ip']
    );
    expect(result.authentication.session.bind_ip).toBe(false);
  });
});

describe('convertSecurityFormData() - array booleans', () => {
  it('converts hidden+checkbox array values to proper booleans in security form', () => {
    const formData = {
      authentication: {
        session: {
          bind_ip: ['', 'on'],
          bind_user_agent: [''],
          bind_device: ['', 'on'],
          encrypt_session_data: ['', 'on'],
        },
      },
      protection: {
        encrypt_device_data: ['', 'on'],
        rate_limiting: {
          enabled: ['', 'on'],
        },
      },
    };

    const result = convertSecurityFormData(formData);

    expect(result.authentication.session.bind_ip).toBe(true);
    expect(result.authentication.session.bind_user_agent).toBe(false);
    expect(result.authentication.session.bind_device).toBe(true);
    expect(result.authentication.session.encrypt_session_data).toBe(true);
    expect(result.protection.encrypt_device_data).toBe(true);
    expect(result.protection.rate_limiting.enabled).toBe(true);
  });

  it('converts unchecked hidden+checkbox arrays to false', () => {
    const formData = {
      authentication: {
        multi_factor: {
          enabled: [''],
          totp: { enabled: [''] },
        },
      },
    };

    const result = convertSecurityFormData(formData);

    expect(result.authentication.multi_factor.enabled).toBe(false);
    expect(result.authentication.multi_factor.totp.enabled).toBe(false);
  });
});

describe('convertFeaturesFormData()', () => {
  it('filters empty strings from social_providers.enabled array', () => {
    const formData = {
      social_providers: {
        enabled: ['', 'google', 'github'],
      },
    };

    const result = convertFeaturesFormData(formData);
    expect(result.social_providers.enabled).toEqual(['google', 'github']);
  });

  it('handles enabled as a bare empty string (no providers checked)', () => {
    const formData = {
      social_providers: {
        enabled: '',
      },
    };

    const result = convertFeaturesFormData(formData);
    expect(result.social_providers.enabled).toEqual([]);
  });

  it('wraps a single enabled provider string into an array', () => {
    const formData = {
      social_providers: {
        enabled: 'google',
      },
    };

    const result = convertFeaturesFormData(formData);
    expect(result.social_providers.enabled).toEqual(['google']);
  });

  it('converts behavior boolean fields from hidden+checkbox arrays', () => {
    const formData = {
      social_providers: {
        behavior: {
          require_password_on_registration: ['', 'on'],
          options: {
            allow_multiple_providers: ['', 'on'],
            auto_verify_email: [''],
            show_helpful_errors: ['', 'on'],
          },
        },
      },
    };

    const result = convertFeaturesFormData(formData);
    expect(
      result.social_providers.behavior.require_password_on_registration
    ).toBe(true);
    expect(
      result.social_providers.behavior.options.allow_multiple_providers
    ).toBe(true);
    expect(result.social_providers.behavior.options.auto_verify_email).toBe(
      false
    );
    expect(result.social_providers.behavior.options.show_helpful_errors).toBe(
      true
    );
  });

  it('converts max_providers_per_user from string to number', () => {
    const formData = {
      social_providers: {
        behavior: {
          options: {
            max_providers_per_user: '6',
          },
        },
      },
    };

    const result = convertFeaturesFormData(formData);
    expect(
      result.social_providers.behavior.options.max_providers_per_user
    ).toBe(6);
  });
});

describe('convertOidcFormData()', () => {
  it('converts token TTL string values to numbers', () => {
    const data = {
      oidc: {
        token_ttl: {
          access_token: '3600',
          id_token: '3600',
          refresh_token: '86400',
          authorization_code: '600',
          client_credentials: '3600',
          device_code: '600',
          grant: '1209600',
          interaction: '3600',
          session: '1209600',
          backchannel_auth: '600',
        },
      },
    };

    const result = convertOidcFormData(data);

    expect(result.oidc.token_ttl.access_token).toBe(3600);
    expect(result.oidc.token_ttl.id_token).toBe(3600);
    expect(result.oidc.token_ttl.refresh_token).toBe(86400);
    expect(result.oidc.token_ttl.authorization_code).toBe(600);
    expect(result.oidc.token_ttl.client_credentials).toBe(3600);
    expect(result.oidc.token_ttl.device_code).toBe(600);
    expect(result.oidc.token_ttl.grant).toBe(1209600);
    expect(result.oidc.token_ttl.interaction).toBe(3600);
    expect(result.oidc.token_ttl.session).toBe(1209600);
    expect(result.oidc.token_ttl.backchannel_auth).toBe(600);
  });

  it('converts discovery comma-separated strings to arrays', () => {
    const data = {
      oidc: {
        discovery: {
          claims_locales_supported: 'en, fr, de',
          ui_locales_supported: 'en,fr',
          display_values_supported: 'page, popup, touch',
        },
      },
    };

    const result = convertOidcFormData(data);

    expect(result.oidc.discovery.claims_locales_supported).toEqual([
      'en',
      'fr',
      'de',
    ]);
    expect(result.oidc.discovery.ui_locales_supported).toEqual(['en', 'fr']);
    expect(result.oidc.discovery.display_values_supported).toEqual([
      'page',
      'popup',
      'touch',
    ]);
  });

  it('handles missing oidc.token_ttl gracefully', () => {
    const data = { oidc: {} };
    const result = convertOidcFormData(data);
    expect(result.oidc).toBeDefined();
  });

  it('handles missing oidc.discovery gracefully', () => {
    const data = { oidc: {} };
    const result = convertOidcFormData(data);
    expect(result.oidc).toBeDefined();
  });

  it('handles empty string token TTL values (leaves them falsy)', () => {
    const data = {
      oidc: {
        token_ttl: {
          access_token: '',
          id_token: '',
        },
      },
    };

    const result = convertOidcFormData(data);
    // Empty strings are falsy, so parseInt is skipped
    expect(result.oidc.token_ttl.access_token).toBe('');
    expect(result.oidc.token_ttl.id_token).toBe('');
  });

  it('handles empty discovery strings (filters to empty array)', () => {
    const data = {
      oidc: {
        discovery: {
          claims_locales_supported: '',
        },
      },
    };

    const result = convertOidcFormData(data);
    // Empty string is falsy, so the split logic is skipped
    expect(result.oidc.discovery.claims_locales_supported).toBe('');
  });

  it('handles completely empty input', () => {
    const data = {};
    const result = convertOidcFormData(data);
    expect(result).toBeDefined();
  });
});

describe('convertIntegrationsFormData()', () => {
  it('converts smtp_port string to number', () => {
    const data = {
      email: { smtp_host: 'smtp.example.com', smtp_port: '587' },
    };
    const result = convertIntegrationsFormData(data);
    expect(result.email.smtp_port).toBe(587);
  });

  it('handles missing email gracefully', () => {
    const data = { urls: { website: 'https://example.com' } };
    const result = convertIntegrationsFormData(data);
    expect(result.urls.website).toBe('https://example.com');
  });

  it('handles missing urls gracefully', () => {
    const data = { email: { smtp_host: 'smtp.example.com' } };
    const result = convertIntegrationsFormData(data);
    expect(result.email.smtp_host).toBe('smtp.example.com');
  });

  it('converts ipinfo boolean and numeric fields', () => {
    const data = {
      ipinfo: { enabled: 'true', cache_ttl_hours: '24' },
    };
    const result = convertIntegrationsFormData(data);
    expect(result.ipinfo.enabled).toBe(true);
    expect(result.ipinfo.cache_ttl_hours).toBe(24);
  });

  it('converts ipqualityscore boolean and numeric fields', () => {
    const data = {
      ipqualityscore: {
        enabled: 'on',
        fraud_score_threshold: '85',
        cache_ttl_hours: '12',
      },
    };
    const result = convertIntegrationsFormData(data);
    expect(result.ipqualityscore.enabled).toBe(true);
    expect(result.ipqualityscore.fraud_score_threshold).toBe(85);
    expect(result.ipqualityscore.cache_ttl_hours).toBe(12);
  });

  it('converts fingerprintjs boolean and trims strings', () => {
    const data = {
      fingerprintjs: {
        enabled: 'true',
        api_key: '  abc123  ',
        endpoint: '  https://fp.example.com  ',
      },
    };
    const result = convertIntegrationsFormData(data);
    expect(result.fingerprintjs.enabled).toBe(true);
    expect(result.fingerprintjs.api_key).toBe('abc123');
    expect(result.fingerprintjs.endpoint).toBe('https://fp.example.com');
  });

  it('handles completely empty input', () => {
    const result = convertIntegrationsFormData({});
    expect(result).toBeDefined();
  });

  it('unwraps nested integrations wrapper', () => {
    const data = {
      integrations: {
        email: { smtp_port: '465' },
      },
    };
    const result = convertIntegrationsFormData(data);
    expect(result.email.smtp_port).toBe(465);
  });
});

describe('convertNotificationsFormData()', () => {
  it('converts hidden+checkbox array values to proper booleans', () => {
    const data = {
      channels: {
        email: { enabled: ['', 'on'] },
        sms: { enabled: [''] },
      },
      defaults: {
        security_alerts: ['', 'on'],
        new_session_alerts: [''],
        allow_user_preferences: ['', 'on'],
      },
    };

    const result = convertNotificationsFormData(data);

    expect(result.channels.email.enabled).toBe(true);
    expect(result.channels.sms.enabled).toBe(false);
    expect(result.defaults.security_alerts).toBe(true);
    expect(result.defaults.new_session_alerts).toBe(false);
    expect(result.defaults.allow_user_preferences).toBe(true);
  });

  it('converts unchecked hidden+checkbox arrays to false for all checkboxes', () => {
    const data = {
      channels: {
        email: { enabled: [''] },
        sms: { enabled: [''] },
      },
      defaults: {
        security_alerts: [''],
        new_session_alerts: [''],
        allow_user_preferences: [''],
      },
    };

    const result = convertNotificationsFormData(data);

    expect(result.channels.email.enabled).toBe(false);
    expect(result.channels.sms.enabled).toBe(false);
    expect(result.defaults.security_alerts).toBe(false);
    expect(result.defaults.new_session_alerts).toBe(false);
    expect(result.defaults.allow_user_preferences).toBe(false);
  });

  it('trims SMS string fields and sets empty strings to undefined', () => {
    const data = {
      channels: {
        sms: {
          enabled: 'on',
          provider: '  twilio  ',
          api_key: '  key123  ',
          api_secret: '  secret456  ',
          from_number: '  +1234567890  ',
        },
      },
    };

    const result = convertNotificationsFormData(data);

    expect(result.channels.sms.provider).toBe('twilio');
    expect(result.channels.sms.api_key).toBe('key123');
    expect(result.channels.sms.api_secret).toBe('secret456');
    expect(result.channels.sms.from_number).toBe('+1234567890');
  });

  it('sets empty SMS string fields to undefined', () => {
    const data = {
      channels: {
        sms: {
          enabled: [''],
          provider: '   ',
          api_key: '',
          api_secret: '',
          from_number: '',
        },
      },
    };

    const result = convertNotificationsFormData(data);

    expect(result.channels.sms.provider).toBeUndefined();
    expect(result.channels.sms.api_key).toBeUndefined();
    expect(result.channels.sms.api_secret).toBeUndefined();
    expect(result.channels.sms.from_number).toBeUndefined();
  });

  it('converts SMS rate limit strings to numbers', () => {
    const data = {
      channels: {
        sms: {
          enabled: 'on',
          rate_limits: {
            per_phone_per_hour: '5',
            per_ip_per_day: '20',
            cooldown_seconds: '60',
          },
        },
      },
    };

    const result = convertNotificationsFormData(data);

    expect(result.channels.sms.rate_limits.per_phone_per_hour).toBe(5);
    expect(result.channels.sms.rate_limits.per_ip_per_day).toBe(20);
    expect(result.channels.sms.rate_limits.cooldown_seconds).toBe(60);
  });

  it('handles missing rate_limits gracefully', () => {
    const data = {
      channels: {
        sms: { enabled: 'on', provider: 'twilio' },
      },
    };

    const result = convertNotificationsFormData(data);

    expect(result.channels.sms.enabled).toBe(true);
    expect(result.channels.sms.rate_limits).toBeUndefined();
  });

  it('handles completely empty input without crashing', () => {
    const result = convertNotificationsFormData({});
    expect(result).toBeDefined();
    expect(result.channels.email.enabled).toBe(false);
    expect(result.channels.sms.enabled).toBe(false);
    expect(result.defaults.security_alerts).toBe(false);
    expect(result.defaults.new_session_alerts).toBe(false);
    expect(result.defaults.allow_user_preferences).toBe(false);
  });

  it('unwraps nested notifications wrapper', () => {
    const data = {
      notifications: {
        channels: {
          email: { enabled: ['', 'on'] },
        },
        defaults: {
          security_alerts: ['', 'on'],
        },
      },
    };

    const result = convertNotificationsFormData(data);

    expect(result.channels.email.enabled).toBe(true);
    expect(result.defaults.security_alerts).toBe(true);
  });
});
