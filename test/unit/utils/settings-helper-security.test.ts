import { describe, expect, it } from 'vitest';
import {
  BOOTSTRAP_ONLY_FIELDS,
  SENSITIVE_FIELDS,
  getNestedValue,
  isBootstrapField,
  isMaskedValue,
  isSensitiveField,
  maskSensitiveValue,
  prepareSensitiveConfigForDisplay,
  restoreMaskedSensitiveFields,
  setNestedValue,
} from '../../../src/utils/settings.helper.js';

describe('settings helper secret masking', () => {
  it('does not mistake a real secret containing an interior asterisk for a UI mask', () => {
    expect(isMaskedValue('smtp*password')).toBe(false);

    const imported = {
      integrations: { email: { smtp_password: 'smtp*password' } },
    };
    const current = {
      integrations: { email: { smtp_password: 'old-password' } },
    };

    expect(restoreMaskedSensitiveFields(imported, current)).toEqual({
      restoredConfig: imported,
      restoredFields: [],
    });
  });

  it('replaces malformed primitive intermediates while setting a nested value', () => {
    const config: Record<string, unknown> = { security: 'invalid' };

    expect(() =>
      setNestedValue(config, 'security.secrets.jwt_secret', 'new-secret')
    ).not.toThrow();
    expect(config).toEqual({
      security: { secrets: { jwt_secret: 'new-secret' } },
    });
  });

  it('exposes unique sensitive and bootstrap field registries', () => {
    expect(new Set(SENSITIVE_FIELDS).size).toBe(SENSITIVE_FIELDS.length);
    expect(new Set(BOOTSTRAP_ONLY_FIELDS).size).toBe(
      BOOTSTRAP_ONLY_FIELDS.length
    );
    expect(isSensitiveField('security.secrets.jwt_secret')).toBe(true);
    expect(isSensitiveField('application.title')).toBe(false);
    expect(isSensitiveField('')).toBe(false);
    expect(isSensitiveField(null as never)).toBe(false);
    expect(isBootstrapField('deployment.environment')).toBe(true);
    expect(isBootstrapField('deployment.url')).toBe(false);
    expect(isBootstrapField('')).toBe(false);
    expect(isBootstrapField(42 as never)).toBe(false);
  });

  it.each([
    { expected: '', value: '' },
    { expected: '', value: null },
    { expected: 'a*', value: 'a' },
    { expected: 'a*', value: 'ab' },
    { expected: 'a**', value: 'abc' },
    { expected: 'abcd****', value: 'abcd' },
    { expected: 'abcd****', value: 'abcde' },
    { expected: 'abcd*****', value: 'abcdefghi' },
  ])('masks $value as $expected', ({ expected, value }) => {
    expect(maskSensitiveValue(value as string)).toBe(expected);
  });

  it.each([
    { expected: true, value: 'a*' },
    { expected: true, value: 'a***' },
    { expected: true, value: 'abcd****' },
    { expected: true, value: 'abcd********' },
    { expected: false, value: '' },
    { expected: false, value: null },
    { expected: false, value: '****' },
    { expected: false, value: 'abc*' },
    { expected: false, value: 'actual-secret' },
    { expected: false, value: 1234 },
  ])('classifies $value masked=$expected', ({ expected, value }) => {
    expect(isMaskedValue(value)).toBe(expected);
  });

  it('restores scalar and indexed array masks without mutating the import', () => {
    const imported = {
      application: { title: 'Imported' },
      integrations: { email: { smtp_password: 'smtp********' } },
      security: {
        secrets: {
          cookie_secrets: ['cook****', 'new-literal', null],
          jwt_secret: null,
        },
      },
    };
    const current = {
      integrations: { email: { smtp_password: 'current-smtp' } },
      security: {
        secrets: {
          cookie_secrets: ['current-cookie', 'second-cookie'],
          jwt_secret: 'current-jwt',
        },
      },
    };

    const result = restoreMaskedSensitiveFields(imported, current);

    expect(result).toEqual({
      restoredConfig: {
        application: { title: 'Imported' },
        integrations: { email: { smtp_password: 'current-smtp' } },
        security: {
          secrets: {
            cookie_secrets: ['current-cookie', 'new-literal', null],
            jwt_secret: null,
          },
        },
      },
      restoredFields: [
        'security.secrets.cookie_secrets',
        'integrations.email.smtp_password',
      ],
    });
    expect(imported.integrations.email.smtp_password).toBe('smtp********');
    expect(imported.security.secrets.cookie_secrets[0]).toBe('cook****');
  });

  it('keeps masks when no corresponding current secret is available', () => {
    const imported = {
      integrations: { email: { smtp_password: 'smtp********' } },
      security: { secrets: { cookie_secrets: ['cook****'] } },
    };

    expect(restoreMaskedSensitiveFields(imported, {})).toEqual({
      restoredConfig: imported,
      restoredFields: [],
    });
  });

  it('gets and sets nested values while blocking prototype pollution', () => {
    const config: Record<string, unknown> = {};

    setNestedValue(config, 'security.secrets.jwt_secret', 'secret');
    expect(getNestedValue(config, 'security.secrets.jwt_secret')).toBe(
      'secret'
    );
    expect(getNestedValue(config, 'security.missing.value')).toBeUndefined();
    expect(getNestedValue(null, 'security.secrets')).toBeUndefined();

    setNestedValue(config, '__proto__.polluted', true);
    setNestedValue(config, 'safe.constructor.polluted', true);
    setNestedValue(config, 'safe.prototype.polluted', true);
    setNestedValue(config, 'safe.__proto__', true);
    expect(
      (Object.prototype as { polluted?: boolean }).polluted
    ).toBeUndefined();
    expect(config).not.toHaveProperty('safe');

    setNestedValue(config, 'toString.polluted', true);
    expect(config).toHaveProperty('toString.polluted', true);
    expect(
      (Object.prototype.toString as { polluted?: boolean }).polluted
    ).toBeUndefined();
  });

  it('returns primitives unchanged and masks sensitive display values on a clone', () => {
    expect(prepareSensitiveConfigForDisplay(null)).toBeNull();
    expect(prepareSensitiveConfigForDisplay('config')).toBe('config');

    const config = {
      application: { title: 'Parako.ID' },
      integrations: {
        email: { smtp_password: 'smtp-password' },
        ipinfo: { api_token: 42 },
      },
      security: {
        secrets: {
          cookie_secrets: ['cookie-one', '', 7, null],
          jwt_secret: 'jwt-secret',
        },
      },
    };

    const masked = prepareSensitiveConfigForDisplay(config);

    expect(masked).toEqual({
      application: { title: 'Parako.ID' },
      integrations: {
        email: { smtp_password: 'smtp*********' },
        ipinfo: { api_token: 42 },
      },
      security: {
        secrets: {
          cookie_secrets: ['cook******', '', 7, null],
          jwt_secret: 'jwt-******',
        },
      },
    });
    expect(config.integrations.email.smtp_password).toBe('smtp-password');
    expect(config.security.secrets.cookie_secrets[0]).toBe('cookie-one');
  });
});
