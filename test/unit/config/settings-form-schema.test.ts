import { describe, expect, it } from 'vitest';

import {
  parseApplicationSettingsForm,
  parseBrandingSettingsForm,
  parseDeploymentSettingsForm,
  parseFeaturesSettingsForm,
  parseIntegrationsSettingsForm,
  parseOidcSettingsForm,
  parseSecuritySettingsForm,
} from '../../../src/config/schemas/settings-form-schema.js';

type FormParser = (input: unknown) => unknown;

describe('admin settings form schemas', () => {
  it('accepts and sanitizes an application form', () => {
    expect(
      parseApplicationSettingsForm({
        _csrf: 'csrf-token',
        _deviceInfo: '{"visitorId":"browser-fixture"}',
        _configVersion: '12',
        title: 'Parako.ID',
        description: 'Identity provider',
        locales: { default: 'en', available: ['en', 'fr'] },
      })
    ).toEqual({
      configVersion: '12',
      data: {
        title: 'Parako.ID',
        description: 'Identity provider',
        locales: { default: 'en', available: ['en', 'fr'] },
      },
    });
  });

  it.each([
    [
      'branding',
      parseBrandingSettingsForm as FormParser,
      {
        companyName: 'Parako',
        colors: { light: { primary: '#123456' } },
      },
    ],
    [
      'deployment',
      parseDeploymentSettingsForm as FormParser,
      { server: { allowed_origins: 'https://rp.example.com' } },
    ],
    [
      'security',
      parseSecuritySettingsForm as FormParser,
      { authentication: { login: { enabled: 'on' } } },
    ],
    [
      'features',
      parseFeaturesSettingsForm as FormParser,
      { oidc: { scopes: 'openid\nemail' } },
    ],
    [
      'OIDC',
      parseOidcSettingsForm as FormParser,
      { oidc: { token_ttl: { access_token: '3600' } } },
    ],
    [
      'integrations',
      parseIntegrationsSettingsForm as FormParser,
      {
        integrations: { email: { smtp_host: 'smtp.example.com' } },
        notifications: { channels: { email: { enabled: 'on' } } },
      },
    ],
  ])('accepts a scoped %s form', (_name, parse, input) => {
    expect(parse({ _csrf: 'csrf-token', _deviceInfo: '{}', ...input })).toEqual(
      input
    );
  });

  it.each([
    [
      'application',
      parseApplicationSettingsForm as FormParser,
      { integrations: {} },
    ],
    ['branding', parseBrandingSettingsForm as FormParser, { security: {} }],
    [
      'deployment',
      parseDeploymentSettingsForm as FormParser,
      { url: 'https://unexpected.example.com' },
    ],
    ['security', parseSecuritySettingsForm as FormParser, { oidc: {} }],
    ['features', parseFeaturesSettingsForm as FormParser, { integrations: {} }],
    ['OIDC', parseOidcSettingsForm as FormParser, { features: {} }],
    [
      'integrations',
      parseIntegrationsSettingsForm as FormParser,
      { authentication: {} },
    ],
  ])('rejects a cross-section field in a %s form', (_name, parse, input) => {
    expect(() => parse(input)).toThrow();
  });

  it.each([
    ['application', parseApplicationSettingsForm as FormParser],
    ['branding', parseBrandingSettingsForm as FormParser],
    ['deployment', parseDeploymentSettingsForm as FormParser],
    ['security', parseSecuritySettingsForm as FormParser],
    ['features', parseFeaturesSettingsForm as FormParser],
    ['OIDC', parseOidcSettingsForm as FormParser],
    ['integrations', parseIntegrationsSettingsForm as FormParser],
  ])('rejects a non-object %s form', (_name, parse) => {
    expect(() => parse([])).toThrow();
    expect(() => parse(null)).toThrow();
  });

  it.each([
    ['deployment', parseDeploymentSettingsForm as FormParser, { server: [] }],
    ['security', parseSecuritySettingsForm as FormParser, { protection: true }],
    ['features', parseFeaturesSettingsForm as FormParser, { oidc: 'enabled' }],
    ['OIDC', parseOidcSettingsForm as FormParser, { oidc: 1 }],
    [
      'integrations',
      parseIntegrationsSettingsForm as FormParser,
      { integrations: 'smtp' },
    ],
  ])(
    'rejects a malformed nested object in a %s form',
    (_name, parse, input) => {
      expect(() => parse(input)).toThrow();
    }
  );
});
