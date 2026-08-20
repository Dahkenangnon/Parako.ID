import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultFullConfig } from '../../../src/config/constants.js';
import {
  buildConfigurationViewLocals,
  type ViewConfiguration,
} from '../../../src/utils/view-locals.js';

function configuration(): ViewConfiguration {
  const config = getDefaultFullConfig();
  return {
    ...config,
    deployment: {
      ...config.deployment,
      environment: 'development',
    },
  };
}

describe('buildConfigurationViewLocals', () => {
  let config: ViewConfiguration;
  const resolveFileUrl = vi.fn((key: string) => `/files/${key}`);

  beforeEach(() => {
    config = configuration();
    resolveFileUrl.mockClear();
  });

  it('builds normalized public locals from configuration and request metadata', async () => {
    config.application.title = 'Example Identity';
    config.application.description = 'Identity for Example';
    config.deployment.url = 'https://id.example.test';
    config.integrations.fingerprintjs = {
      enabled: true,
      api_key: 'public-browser-key',
      endpoint: 'https://metrics.example.test',
    };
    config.branding.logo = 'tenant/logo.svg';
    config.branding.logoDark = '';
    config.security.authentication.login.login_methods = [
      'email',
      'custom_identifier_1',
    ];
    config.security.authentication.custom_identifiers = {
      enabled: true,
      fields: [
        {
          slot: 1,
          key: 'member_id',
          name: 'Member ID',
          hint_for_user: 'Membership number',
          validation_type: 'none',
          min_length: 1,
          max_length: 100,
          case_sensitive: false,
          required_for_registration: false,
          edit_policy: 'set_once',
          usable_for_login: true,
        },
      ],
    };

    const locals = await buildConfigurationViewLocals({
      config,
      request: {
        protocol: 'https',
        hostname: 'fallback.example.test',
        originalUrl: '/auth/login?continue=%2Faccounts',
      },
      resolveFileUrl,
      enabledSocialProviders: ['github'],
    });

    expect(locals.app).toMatchObject({
      title: 'Example Identity',
      description: 'Identity for Example',
      fingerprintJS: {
        apiKey: 'public-browser-key',
        endpoint: 'https://metrics.example.test',
      },
    });
    expect(locals.branding).toMatchObject({
      logo: '/files/tenant/logo.svg',
      logoDark: '/files/tenant/logo.svg',
    });
    expect(locals.authentication.loginMethods.customIdentifiers).toEqual([
      {
        slot: 1,
        key: 'member_id',
        name: 'Member ID',
        hint: 'Membership number',
      },
    ]);
    expect(locals.socialProviders.enabled).toEqual(['github']);
    expect(locals.canonical_url).toBe('https://id.example.test/auth/login');
    expect(locals.og.url).toBe(locals.canonical_url);
  });

  it('awaits object-storage URLs before exposing branding to templates', async () => {
    config.branding.logo = 'tenant/logo.svg';
    config.branding.logoDark = 'tenant/logo-dark.svg';
    const asyncResolver = vi.fn(
      async (key: string) => `https://storage.example.test/${key}`
    );

    const locals = await buildConfigurationViewLocals({
      config,
      request: {
        protocol: 'https',
        hostname: 'tenant.example.test',
        originalUrl: '/auth/login',
      },
      resolveFileUrl: asyncResolver,
      enabledSocialProviders: [],
    });

    expect(locals.branding).toMatchObject({
      logo: 'https://storage.example.test/tenant/logo.svg',
      logoDark: 'https://storage.example.test/tenant/logo-dark.svg',
    });
  });

  it('intersects platform providers with tenant-enabled providers when requested', async () => {
    config.features.social_providers.enabled = ['github'];

    const locals = await buildConfigurationViewLocals({
      config,
      request: {
        protocol: 'https',
        hostname: 'tenant.example.test',
        originalUrl: '/',
      },
      resolveFileUrl,
      enabledSocialProviders: ['github', 'google'],
      restrictSocialProviders: true,
    });

    expect(locals.socialProviders.enabled).toEqual(['github']);
  });

  it('uses request origin, safe branding defaults, and canonical root fallbacks', async () => {
    config.deployment.url = '';
    config.branding.logoIcon = '';
    config.branding.logoIconDark = '';
    config.branding.favicon = '';

    const locals = await buildConfigurationViewLocals({
      config,
      request: {
        protocol: 'https',
        hostname: 'tenant.example.test',
        originalUrl: '//[',
      },
      resolveFileUrl,
      enabledSocialProviders: [],
    });

    expect(locals.branding).toMatchObject({
      logoIcon: '/images/logo-icon-light.png',
      logoIconDark: '/images/logo-icon-dark.png',
      favicon: '/favicon.png',
    });
    expect(locals.socialProviders.available).toEqual([
      'google',
      'github',
      'microsoft',
      'linkedin',
      'facebook',
    ]);
    expect(locals.canonical_url).toBe('https://tenant.example.test/');
  });
});
