import { describe, expect, it } from 'vitest';

import {
  adminTemplateEnvironment,
  adminTemplateLocals,
} from './support/admin-template.js';

function renderTenantSecurityPage(platformRequired: boolean) {
  const method = { enabled: platformRequired };

  return adminTemplateEnvironment.render('admin/configuration/security.njk', {
    ...adminTemplateLocals(),
    config: {},
    platformSecurity: {
      authentication: {
        multi_factor: {
          enabled: platformRequired,
          email: method,
          sms: method,
          totp: method,
          webauthn: method,
        },
      },
    },
    section: 'security',
    title: 'Security Configuration',
  });
}

describe('tenant security configuration template', () => {
  it('renders every platform-required MFA control as enabled and immutable', () => {
    const html = renderTenantSecurityPage(true);
    const floors = [
      ['authentication[multi_factor][enabled]', 'mfa_enabled'],
      ['authentication[multi_factor][totp][enabled]', 'mfa_totp'],
      ['authentication[multi_factor][email][enabled]', 'mfa_email'],
      ['authentication[multi_factor][sms][enabled]', 'mfa_sms'],
      ['authentication[multi_factor][webauthn][enabled]', 'mfa_webauthn'],
    ] as const;

    for (const [name, id] of floors) {
      expect(html).toContain(`<input type="hidden" name="${name}" value="on">`);
      expect(html).toMatch(
        new RegExp(`<input type="checkbox" id="${id}" checked disabled`)
      );
    }
  });

  it('keeps MFA controls editable when the platform does not require them', () => {
    const html = renderTenantSecurityPage(false);

    expect(html).toMatch(
      /<input type="checkbox" id="mfa_enabled" name="authentication\[multi_factor\]\[enabled\]"/
    );
    expect(html).not.toMatch(
      /<input type="checkbox" id="mfa_enabled" checked disabled/
    );
  });
});

describe('global security protection template', () => {
  it('accepts schema-valid positive rate-limit values above the former UI ceiling', () => {
    const html = adminTemplateEnvironment.render(
      'admin/settings/security-protection.njk',
      {
        ...adminTemplateLocals(),
        config: {
          protection: {
            rate_limiting: {
              enabled: true,
              requests_per_minute: 10_000,
              window_minutes: 120,
            },
          },
        },
        section: 'security',
        securityTab: 'protection',
        title: 'Protection & Detection',
      }
    );

    const requestsInput = html.match(
      /<input[^>]*id="protection\.rate_limiting\.requests_per_minute"[^>]*>/
    )?.[0];
    const windowInput = html.match(
      /<input[^>]*id="protection\.rate_limiting\.window_minutes"[^>]*>/
    )?.[0];

    expect(requestsInput).toContain('value="10000"');
    expect(requestsInput).toContain('min="1"');
    expect(requestsInput).not.toContain('max=');
    expect(windowInput).toContain('value="120"');
    expect(windowInput).toContain('min="1"');
    expect(windowInput).not.toContain('max=');
  });
});

describe('global security session template', () => {
  it('renders a cookie-name pattern valid under modern HTML regular-expression rules', () => {
    const html = adminTemplateEnvironment.render(
      'admin/settings/security-sessions.njk',
      {
        ...adminTemplateLocals(),
        config: {},
        section: 'security',
        securityTab: 'sessions',
        title: 'Session Management',
      }
    );
    const cookieNameInput = html.match(
      /<input[^>]*id="authentication\.session\.cookie_name"[^>]*>/
    )?.[0];

    expect(cookieNameInput).toContain('pattern="[a-zA-Z0-9_\\-]+"');
  });
});
