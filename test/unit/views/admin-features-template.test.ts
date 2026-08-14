import { describe, expect, it } from 'vitest';

import { CONFIGURABLE_SOCIAL_PROVIDER_IDS } from '../../../src/config/social-providers.js';
import {
  adminTemplateEnvironment,
  adminTemplateLocals,
} from './support/admin-template.js';

function renderedProviderValues(html: string): string[] {
  return [
    ...html.matchAll(
      /<input[^>]*name="social_providers\[enabled\]\[\]"[^>]*value="([^"]+)"/g
    ),
  ]
    .map(match => match[1])
    .filter(Boolean);
}

function renderFeaturesPage() {
  return adminTemplateEnvironment.render('admin/settings/features.njk', {
    ...adminTemplateLocals(),
    config: {},
    title: 'Features Settings',
  });
}

function renderTenantFeaturesPage() {
  return adminTemplateEnvironment.render('admin/configuration/features.njk', {
    ...adminTemplateLocals(),
    config: {},
    platformFeatures: {},
    section: 'features',
    title: 'Features Configuration',
  });
}

describe('admin feature settings template', () => {
  it('submits false values for every scalar checkbox', () => {
    const html = renderFeaturesPage();
    const checkboxNames = [
      ...html.matchAll(/<input[^>]*type="checkbox"[^>]*name="([^"]+)"/g),
    ]
      .map(match => match[1])
      .filter(name => !name.endsWith('[]'));

    expect(checkboxNames.length).toBeGreaterThan(0);
    for (const name of new Set(checkboxNames)) {
      expect(html).toContain(`<input type="hidden" name="${name}" value="">`);
    }
  });

  it('submits an empty social-provider list when no provider is selected', () => {
    const hiddenProviderList =
      '<input type="hidden" name="social_providers[enabled][]" value="">';

    expect(renderFeaturesPage()).toContain(hiddenProviderList);
    expect(renderTenantFeaturesPage()).toContain(hiddenProviderList);
  });

  it('submits an empty subject-type list when no subject type is selected', () => {
    expect(renderFeaturesPage()).toContain(
      '<input type="hidden" name="oidc[subject_types][]" value="">'
    );
  });

  it('does not narrow the schema-valid clock-tolerance range', () => {
    const html = renderFeaturesPage();
    const clockTolerance = html.match(
      /<input[^>]*id="oidc\.clock_tolerance"[^>]*>/
    )?.[0];

    expect(clockTolerance).toBeDefined();
    expect(clockTolerance).not.toMatch(/\smax="[^"]*"/);
  });

  it('renders exactly the providers backed by built-in adapters', () => {
    const expectedProviders = [...CONFIGURABLE_SOCIAL_PROVIDER_IDS];

    expect(renderedProviderValues(renderFeaturesPage())).toEqual(
      expectedProviders
    );
    expect(renderedProviderValues(renderTenantFeaturesPage())).toEqual(
      expectedProviders
    );
  });

  it('uses unique checkbox identifiers', () => {
    const html = renderFeaturesPage();
    const checkboxIds = [
      ...html.matchAll(/<input[^>]*type="checkbox"[^>]*id="([^"]+)"/g),
    ].map(match => match[1]);

    expect(new Set(checkboxIds).size).toBe(checkboxIds.length);
  });
});
