import path from 'node:path';

import nunjucks from 'nunjucks';
import { describe, expect, it } from 'vitest';

import { configureNunjucks } from '../../../src/utils/views.js';

const environment = new nunjucks.Environment(
  new nunjucks.FileSystemLoader(path.join(process.cwd(), 'src/views')),
  { autoescape: true }
);

configureNunjucks(environment);
environment.addGlobal('getAvailableLocales', () => [
  { code: 'en', name: 'English' },
]);

const accountRoutes = {
  account_switcher_data: '/accounts/switcher',
  add_account: '/accounts/add-account',
  apps: '/accounts/apps',
  change_password: '/accounts/change-password',
  dashboard: '/accounts/',
  disable_mfa: '/accounts/disable-mfa',
  enable_mfa: '/accounts/enable-mfa',
  remove_account: '/accounts/remove-account',
  sessions: '/accounts/sessions',
  settings: '/accounts/settings',
  setup_mfa: '/accounts/setup-mfa',
  switch_account: '/accounts/switch-account',
};

function renderSecurityPage(secret: string) {
  return environment.render('accounts/settings/security.njk', {
    activePage: 'settings',
    app: {
      description: 'Identity server',
      env: 'production',
      fingerprintJS: {},
      locales: { default: 'en', available: ['en'] },
      title: 'Parako.ID',
      url: 'https://parako.test',
    },
    branding: {
      colors: { light: {}, dark: {} },
      companyName: 'Parako.ID',
      favicon: '/favicon.png',
      fonts: {},
      logo: '/images/logo-light.png',
      logoDark: '/images/logo-dark.png',
    },
    canonical_url: 'https://parako.test/accounts/settings/security',
    csrfToken: 'csrf-token',
    flash: {},
    isSpecialPasswordCase: false,
    mfaConfig: {
      enabled: true,
      methods: {
        email: { enabled: true },
        totp: { enabled: true },
        webauthn: { enabled: true },
      },
    },
    pageUser: {
      mfa: {
        methods: {
          email: { enabled: false },
          totp: { enabled: true, secret },
          webauthn: { enabled: false, credentials: [] },
        },
      },
    },
    routes: {
      accountFull: accountRoutes,
      authFull: {
        logout: '/auth/logout',
        update_locale: '/auth/locale',
        update_sidebar: '/auth/sidebar',
        update_theme: '/auth/theme',
        update_timezone: '/auth/timezone',
      },
    },
    sidebar_expanded: true,
    t: (_key: string, fallback?: string) => fallback || 'Translated text',
    user: { given_name: 'Test', family_name: 'User', sidebarName: 'Test User' },
    userLocale: 'en',
    userTheme: 'light',
  });
}

describe('account security template', () => {
  it('serializes MFA state as strict booleans without exposing TOTP secrets', () => {
    const secret = 'ENCRYPTED:fixture-totp-secret';
    const html = renderSecurityPage(secret);
    const state = html.match(
      /<script id="___SETTINGS_STATE___" type="application\/json">([\s\S]*?)<\/script>/
    )?.[1];

    expect(state).toBeDefined();
    expect(state).not.toContain(secret);
    expect(JSON.parse(state!.trim())).toMatchObject({
      isMfaEnabled: true,
      mfaMethodsEnabled: { totp: true, email: false, webauthn: false },
    });
  });
});
