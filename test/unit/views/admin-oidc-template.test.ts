import { describe, expect, it } from 'vitest';

import {
  adminTemplateEnvironment,
  adminTemplateLocals,
} from './support/admin-template.js';

function renderOidcSettingsPage() {
  return adminTemplateEnvironment.render('admin/settings/oidc.njk', {
    ...adminTemplateLocals(),
    config: {},
    deploymentUrl: 'https://parako.test',
    title: 'OIDC Settings',
  });
}

function renderTenantOidcSettingsPage() {
  return adminTemplateEnvironment.render('admin/configuration/oidc.njk', {
    ...adminTemplateLocals(),
    config: {},
    deploymentUrl: 'https://parako.test',
    issuer: 'https://tenant.parako.test/oidc/v1',
    oidcPath: '/oidc/v1',
    platformDiscovery: { display_values_supported: ['page'] },
    platformTokenTtl: {},
    section: 'oidc',
    title: 'OIDC Configuration',
  });
}

describe('admin OIDC settings template', () => {
  it('submits every JWA group when no algorithm is selected', () => {
    const html = renderOidcSettingsPage();
    const algorithmNames = [
      ...html.matchAll(
        /<input[^>]*type="checkbox"[^>]*name="(oidc\[jwa\][^"]+\[\])"/g
      ),
    ].map(match => match[1]);

    expect(algorithmNames.length).toBeGreaterThan(0);
    for (const name of new Set(algorithmNames)) {
      expect(html).toContain(`<input type="hidden" name="${name}" value="">`);
    }
  });

  it('uses OIDC display modes instead of locales for discovery metadata', () => {
    const html = renderOidcSettingsPage();
    const displayInput = html.match(
      /<input[^>]*id="oidc\.discovery\.display_values_supported"[^>]*>/
    )?.[0];

    expect(displayInput).toContain('value="page"');
    expect(displayInput).toContain('placeholder="page,popup,touch,wap"');
    expect(html).toContain(
      'supported OIDC display modes (page, popup, touch, wap)'
    );
  });

  it('shows UI locales as application-derived metadata', () => {
    const html = renderOidcSettingsPage();

    expect(html).not.toContain('name="oidc[discovery][ui_locales_supported]"');
    expect(html).toContain('UI Locales Supported');
    expect(html).toContain('href="/admin/settings/application"');
    expect(html).toContain('Application Settings</a>');
  });

  it('constrains discovery links to HTTP or HTTPS', () => {
    const html = renderOidcSettingsPage();

    for (const id of [
      'oidc.discovery.service_documentation',
      'oidc.discovery.op_policy_uri',
      'oidc.discovery.op_tos_uri',
    ]) {
      const input = html.match(
        new RegExp(`<input[^>]*id="${id.replaceAll('.', '\\.')}"[^>]*>`)
      )?.[0];
      expect(input).toContain('pattern="https?://.*"');
    }
    expect(html).toContain('HTTP or HTTPS URL to service documentation');
  });
});

describe('tenant OIDC configuration template', () => {
  it('uses standard display modes and does not offer an ignored UI locale override', () => {
    const html = renderTenantOidcSettingsPage();
    const displayInput = html.match(
      /<input[^>]*id="discovery_display_values"[^>]*>/
    )?.[0];

    expect(displayInput).toContain('placeholder="page, popup, touch, wap"');
    expect(html).not.toContain('name="discovery[ui_locales_supported]"');
    expect(html).toContain('UI Locales Supported');
    expect(html).toContain('href="/admin/configuration/application"');
    expect(html).toContain('Application Configuration</a>');
  });

  it('explains the HTTP and HTTPS discovery-link contract', () => {
    const html = renderTenantOidcSettingsPage();

    expect(html).toContain('Must use HTTP or HTTPS.');
    expect(html).not.toContain('Must use HTTPS.');
  });
});
