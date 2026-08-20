import { readFile } from 'node:fs/promises';

import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  createManagedUser,
  IDP_ORIGIN,
  type ManagedUserFixture,
} from './support/management-api.js';
import {
  expectNoBrowserFailures,
  observeBrowserFailures,
} from './support/browser-failures.js';

const MULTI_TENANT = process.env.PARAKO_E2E_MULTI_TENANCY === 'true';
const DEPLOYMENT_CELL = process.env.PARAKO_E2E_CELL ?? 'sqlite-single';
const RP_ORIGIN = 'http://127.0.0.1:19010';
const APPLICATION_ROUTE = MULTI_TENANT
  ? '/admin/configuration/application'
  : '/admin/settings/application';
const BRANDING_ROUTE = MULTI_TENANT
  ? '/admin/configuration/branding'
  : '/admin/settings/branding';
const FEATURES_ROUTE = MULTI_TENANT
  ? '/admin/configuration/features'
  : '/admin/settings/features';
const EXPECTED_SOCIAL_PROVIDERS = [
  'google',
  'github',
  'microsoft',
  'linkedin',
  'facebook',
] as const;
const OIDC_ROUTE = MULTI_TENANT
  ? '/admin/configuration/oidc'
  : '/admin/settings/oidc';
const SIBLING_TENANT_ID =
  process.env.PARAKO_E2E_SIBLING_TENANT_ID ?? 'browser-e2e-sibling';

const TEST_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" fill="#2457d6"/><circle cx="32" cy="32" r="16" fill="#ffffff"/></svg>',
  'utf8'
);

async function expectStoredAsset(
  page: Page,
  selector: string,
  attribute: 'src' | 'href'
): Promise<string> {
  const element = page.locator(selector);
  await expect(element).toHaveAttribute(attribute, /\/media\/file\//);
  const assetUrl = await element.getAttribute(attribute);
  expect(assetUrl).toBeTruthy();

  const result = await page.evaluate(async url => {
    const response = await fetch(url);
    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
      bodyLength: (await response.arrayBuffer()).byteLength,
    };
  }, assetUrl!);

  expect(result.status).toBe(200);
  expect(result.contentType).toMatch(/^image\//);
  expect(result.bodyLength).toBeGreaterThan(0);
  return assetUrl!;
}

function tenantOrigin(tenantId: string): string {
  const origin = new URL(IDP_ORIGIN);
  const [, ...baseLabels] = origin.hostname.split('.');
  origin.hostname = `${tenantId}.${baseLabels.join('.')}`;
  return origin.origin;
}

function assetPath(assetUrl: string): string {
  return new URL(assetUrl, IDP_ORIGIN).pathname;
}

async function readRenderedBrandingAssets(page: Page) {
  const assets = await page.evaluate(() => ({
    logos: Array.from(
      document.querySelectorAll<HTMLImageElement>('img[alt$=" Logo"]')
    ).map(image => image.getAttribute('src')),
    favicon:
      document
        .querySelector<HTMLLinkElement>('link[rel="icon"]')
        ?.getAttribute('href') ?? null,
  }));

  return {
    logos: assets.logos.map(url => (url ? assetPath(url) : null)),
    favicon: assets.favicon ? assetPath(assets.favicon) : null,
  };
}

function titleEndingWith(applicationTitle: string): RegExp {
  const escaped = applicationTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\| ${escaped}$`);
}

async function loginAsAdmin(
  page: Page,
  admin: ManagedUserFixture,
  origin = IDP_ORIGIN
) {
  await page.goto(`${origin}/auth/login?continue=%2Fadmin`);
  await page.locator('#login').fill(admin.email);
  await page.locator('#password').fill(admin.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${origin}/admin`);
}

async function submitOidcSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save Changes' }).click();

  if (!MULTI_TENANT) {
    const confirmation = page.getByRole('dialog', {
      name: 'Confirm OIDC Configuration Changes',
    });
    await expect(confirmation).toBeVisible();
    await expect(
      confirmation.getByRole('button', { name: 'Cancel' })
    ).toBeFocused();
    await confirmation
      .getByRole('button', { name: 'Yes, Save Changes' })
      .click();
  }
}

async function submitOidcSettingsWithoutClientValidation(
  page: Page
): Promise<void> {
  const form = page.locator(
    MULTI_TENANT ? 'form#config-form' : 'form[action="/admin/settings/oidc"]'
  );
  const postResponse = page.waitForResponse(response => {
    const request = response.request();
    return (
      request.method() === 'POST' &&
      new URL(response.url()).pathname === OIDC_ROUTE
    );
  });

  await Promise.all([
    postResponse,
    form.evaluate(element => (element as HTMLFormElement).submit()),
  ]);
  await page.waitForLoadState('domcontentloaded');
}

test('all social-provider controls reveal only their matching credentials', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-features-configuration', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);

  const response = await page.goto(`${IDP_ORIGIN}${FEATURES_ROUTE}`);
  expect(response?.status()).toBe(200);
  await expect(
    page.locator('[onclick], [onsubmit], [onchange], [oninput]')
  ).toHaveCount(0);
  const providerToggles = page.locator(
    'input[type="checkbox"][name="social_providers[enabled][]"]'
  );
  await expect(providerToggles).toHaveCount(EXPECTED_SOCIAL_PROVIDERS.length);
  expect(
    await providerToggles.evaluateAll(inputs =>
      inputs.map(input => (input as HTMLInputElement).value)
    )
  ).toEqual(EXPECTED_SOCIAL_PROVIDERS);

  for (const providerId of EXPECTED_SOCIAL_PROVIDERS) {
    const checkbox = MULTI_TENANT
      ? page.locator(`[data-provider-toggle="${providerId}"]`)
      : page.locator(`#social_${providerId}`);
    const credentials = page.locator(
      MULTI_TENANT ? `#creds-${providerId}` : `#${providerId}-config`
    );
    const initiallyChecked = await checkbox.isChecked();

    if (initiallyChecked) {
      await expect(credentials).toBeVisible();
    } else {
      await expect(credentials).toBeHidden();
    }

    await checkbox.click();
    if (initiallyChecked) {
      await expect(credentials).toBeHidden();
    } else {
      await expect(credentials).toBeVisible();
    }
  }

  expectNoBrowserFailures(failures);
});

test('an unconfigured social provider cannot be enabled', async ({ page }) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-social-provider-validation', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);

  const response = await page.goto(`${IDP_ORIGIN}${FEATURES_ROUTE}`);
  expect(response?.status()).toBe(200);

  const googleToggle = MULTI_TENANT
    ? page.locator('[data-provider-toggle="google"]')
    : page.locator('#social_google');
  await expect(googleToggle).not.toBeChecked();

  await googleToggle.check();
  await page.getByRole('button', { name: 'Save Changes' }).click();

  await expect(page).toHaveURL(`${IDP_ORIGIN}${FEATURES_ROUTE}`);
  const errorDialog = page.getByRole('dialog', { name: 'Error' });
  await expect(errorDialog).toContainText(
    MULTI_TENANT
      ? 'Failed to update configuration. Please try again.'
      : 'Failed to update features settings'
  );
  await errorDialog.getByRole('button', { name: 'OK' }).click();
  await expect(googleToggle).not.toBeChecked();

  await page.reload();
  await expect(googleToggle).not.toBeChecked();
  expectNoBrowserFailures(failures);
});

test('feature behavior changes persist and can be restored', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-features-persistence', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);

  const response = await page.goto(`${IDP_ORIGIN}${FEATURES_ROUTE}`);
  expect(response?.status()).toBe(200);

  const helpfulErrors = page.getByLabel(
    MULTI_TENANT
      ? 'Show detailed error messages to users'
      : 'Show Helpful Errors'
  );
  const originallyChecked = await helpfulErrors.isChecked();
  let saved = false;

  try {
    await helpfulErrors.setChecked(!originallyChecked);
    await page.getByRole('button', { name: 'Save Changes' }).click();
    saved = true;

    await expect(page).toHaveURL(`${IDP_ORIGIN}${FEATURES_ROUTE}`);
    await expect(
      page.locator('.toast[data-toast-type="success"]')
    ).toContainText(
      MULTI_TENANT
        ? 'Features configuration updated successfully'
        : 'Features settings updated successfully'
    );
    await expect(helpfulErrors).toBeChecked({ checked: !originallyChecked });

    await page.reload();
    await expect(helpfulErrors).toBeChecked({ checked: !originallyChecked });

    if (!MULTI_TENANT) {
      const exportedFeatures = await page.evaluate(async () => {
        const exportResponse = await fetch('/admin/settings/export');
        if (!exportResponse.ok) {
          throw new Error('Unable to export feature configuration');
        }
        const config = (await exportResponse.json()) as {
          features?: Record<string, unknown>;
        };
        return config.features;
      });

      expect(exportedFeatures).not.toHaveProperty('_csrf');
      expect(exportedFeatures).not.toHaveProperty('_deviceInfo');
      expect(exportedFeatures).toMatchObject({
        social_providers: {
          behavior: {
            options: { show_helpful_errors: !originallyChecked },
          },
        },
      });
    }
  } finally {
    if (saved) {
      await page.goto(`${IDP_ORIGIN}${FEATURES_ROUTE}`);
      if (MULTI_TENANT) {
        page.once('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: 'Reset to Defaults' }).click();
        await expect(page).toHaveURL(`${IDP_ORIGIN}${FEATURES_ROUTE}`);
      } else {
        await helpfulErrors.setChecked(originallyChecked);
        await page.getByRole('button', { name: 'Save Changes' }).click();
        await expect(page).toHaveURL(`${IDP_ORIGIN}${FEATURES_ROUTE}`);
      }

      await expect(helpfulErrors).toBeChecked({ checked: originallyChecked });
    }
  }

  expectNoBrowserFailures(failures);
});

test('OIDC feature dependencies fail closed at the platform boundary', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-feature-dependencies', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);

  const response = await page.goto(`${IDP_ORIGIN}${FEATURES_ROUTE}`);
  expect(response?.status()).toBe(200);

  if (MULTI_TENANT) {
    await expect(
      page.getByRole('heading', { name: 'OIDC Features' })
    ).toHaveCount(0);
    await expect(page.locator('input[name^="oidc["]')).toHaveCount(0);
    expectNoBrowserFailures(failures);
    return;
  }

  const dependencies = [
    {
      dependent: 'JWT Introspection',
      prerequisite: 'Token Introspection',
    },
    {
      dependent: 'JWT UserInfo',
      prerequisite: 'UserInfo Endpoint',
    },
    {
      dependent: 'Enable Client Registration Management',
      prerequisite: 'Enable Dynamic Client Registration',
    },
  ] as const;

  for (const {
    dependent: dependentLabel,
    prerequisite: prerequisiteLabel,
  } of dependencies) {
    const dependent = page.getByLabel(dependentLabel, { exact: true });
    const prerequisite = page.getByLabel(prerequisiteLabel, { exact: true });
    const originalDependent = await dependent.isChecked();
    const originalPrerequisite = await prerequisite.isChecked();

    await dependent.setChecked(true);
    await prerequisite.setChecked(false);
    await page.getByRole('button', { name: 'Save Changes' }).click();

    await expect(page).toHaveURL(`${IDP_ORIGIN}${FEATURES_ROUTE}`);
    const errorDialog = page.getByRole('dialog', { name: 'Error' });
    await expect(errorDialog).toContainText(
      'Failed to update features settings'
    );
    await errorDialog.getByRole('button', { name: 'OK' }).click();
    await expect(dependent).toBeChecked({ checked: originalDependent });
    await expect(prerequisite).toBeChecked({
      checked: originalPrerequisite,
    });

    await page.reload();
    await expect(dependent).toBeChecked({ checked: originalDependent });
    await expect(prerequisite).toBeChecked({
      checked: originalPrerequisite,
    });
  }

  const deviceMask = page.getByLabel('Display Mask', { exact: true });
  const originalDeviceMask = await deviceMask.inputValue();
  await deviceMask.fill('ABC-123');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  let errorDialog = page.getByRole('dialog', { name: 'Error' });
  await expect(errorDialog).toContainText('Failed to update features settings');
  await errorDialog.getByRole('button', { name: 'OK' }).click();
  await expect(deviceMask).toHaveValue(originalDeviceMask);

  const publicSubject = page.getByLabel('Public', { exact: true });
  const pairwiseSubject = page.getByLabel('Pairwise', { exact: true });
  const originalPublicSubject = await publicSubject.isChecked();
  const originalPairwiseSubject = await pairwiseSubject.isChecked();
  await publicSubject.uncheck();
  await pairwiseSubject.uncheck();
  await page.getByRole('button', { name: 'Save Changes' }).click();
  errorDialog = page.getByRole('dialog', { name: 'Error' });
  await expect(errorDialog).toContainText('Failed to update features settings');
  await errorDialog.getByRole('button', { name: 'OK' }).click();
  await expect(publicSubject).toBeChecked({ checked: originalPublicSubject });
  await expect(pairwiseSubject).toBeChecked({
    checked: originalPairwiseSubject,
  });

  expectNoBrowserFailures(failures);
});

test('feature numeric controls accept every schema-valid value', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-feature-numeric-boundary', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);

  const response = await page.goto(`${IDP_ORIGIN}${FEATURES_ROUTE}`);
  expect(response?.status()).toBe(200);

  if (MULTI_TENANT) {
    await expect(page.getByLabel('Clock Tolerance (seconds)')).toHaveCount(0);
    expectNoBrowserFailures(failures);
    return;
  }

  const clockTolerance = page.getByLabel('Clock Tolerance (seconds)');
  const originalValue = await clockTolerance.inputValue();
  const schemaValidValue = '301';
  let saved = false;

  try {
    await clockTolerance.fill(schemaValidValue);
    expect(
      await clockTolerance.evaluate(input =>
        (input as HTMLInputElement).checkValidity()
      )
    ).toBe(true);
    await page.getByRole('button', { name: 'Save Changes' }).click();
    saved = true;

    await expect(page).toHaveURL(`${IDP_ORIGIN}${FEATURES_ROUTE}`);
    await expect(
      page.locator('.toast[data-toast-type="success"]')
    ).toContainText('Features settings updated successfully');
    await expect(clockTolerance).toHaveValue(schemaValidValue);
    await page.reload();
    await expect(clockTolerance).toHaveValue(schemaValidValue);
  } finally {
    if (saved) {
      await clockTolerance.fill(originalValue);
      await page.getByRole('button', { name: 'Save Changes' }).click();
      await expect(page).toHaveURL(`${IDP_ORIGIN}${FEATURES_ROUTE}`);
      await expect(clockTolerance).toHaveValue(originalValue);
    }
  }

  expectNoBrowserFailures(failures);
});

test('OIDC token lifetime changes persist and can be restored', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-oidc-configuration', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);

  const response = await page.goto(`${IDP_ORIGIN}${OIDC_ROUTE}`);
  expect(response?.status()).toBe(200);
  await expect(
    page.locator('[onclick], [onsubmit], [onchange], [oninput]')
  ).toHaveCount(0);

  const accessTokenTtl = page.getByLabel('Access Token');
  const originalValue = await accessTokenTtl.inputValue();
  const limit = Number(
    (await accessTokenTtl.getAttribute('max')) || originalValue || '3600'
  );
  const updatedValue = String(Math.max(1, Math.min(1800, limit - 1)));
  let saved = false;

  try {
    await accessTokenTtl.fill(updatedValue);
    await submitOidcSettings(page);

    await expect(page).toHaveURL(`${IDP_ORIGIN}${OIDC_ROUTE}`);
    saved = true;
    await expect(
      page.locator('.toast[data-toast-type="success"]')
    ).toContainText(
      MULTI_TENANT
        ? 'OIDC configuration updated successfully'
        : 'OIDC settings updated successfully'
    );
    await expect(accessTokenTtl).toHaveValue(updatedValue);

    await page.reload();
    await expect(accessTokenTtl).toHaveValue(updatedValue);

    if (!MULTI_TENANT) {
      const exportedOidc = await page.evaluate(async () => {
        const exportResponse = await fetch('/admin/settings/export');
        if (!exportResponse.ok) {
          throw new Error('Unable to export OIDC configuration');
        }
        const config = (await exportResponse.json()) as {
          oidc?: Record<string, unknown>;
        };
        return config.oidc;
      });

      expect(exportedOidc).not.toHaveProperty('_csrf');
      expect(exportedOidc).not.toHaveProperty('_deviceInfo');
      expect(exportedOidc).toMatchObject({
        token_ttl: { access_token: Number(updatedValue) },
      });
    }
  } finally {
    if (saved) {
      await page.goto(`${IDP_ORIGIN}${OIDC_ROUTE}`);
      if (MULTI_TENANT) {
        page.once('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: 'Reset to Defaults' }).click();
        await expect(page).toHaveURL(`${IDP_ORIGIN}${OIDC_ROUTE}`);
      } else {
        await accessTokenTtl.fill(originalValue);
        await submitOidcSettings(page);
        await expect(page).toHaveURL(`${IDP_ORIGIN}${OIDC_ROUTE}`);
      }

      await expect(accessTokenTtl).toHaveValue(originalValue);
    }
  }

  expectNoBrowserFailures(failures);
});

test('invalid OIDC values fail closed at the server boundary', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-oidc-invalid-boundary', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);

  const response = await page.goto(`${IDP_ORIGIN}${OIDC_ROUTE}`);
  expect(response?.status()).toBe(200);

  const accessTokenTtl = page.getByLabel('Access Token');
  const originalTtl = await accessTokenTtl.inputValue();
  await accessTokenTtl.evaluate(input => input.removeAttribute('min'));
  await accessTokenTtl.fill('0');
  await submitOidcSettingsWithoutClientValidation(page);

  await expect(page).toHaveURL(`${IDP_ORIGIN}${OIDC_ROUTE}`);
  let errorDialog = page.getByRole('dialog', { name: 'Error' });
  await expect(errorDialog).toContainText(
    MULTI_TENANT
      ? 'Failed to update configuration. Please try again.'
      : 'Access token TTL must be a positive integer'
  );
  await errorDialog.getByRole('button', { name: 'OK' }).click();
  await expect(accessTokenTtl).toHaveValue(originalTtl);

  const serviceDocumentation = page.getByLabel('Service Documentation URI');
  const originalServiceDocumentation = await serviceDocumentation.inputValue();
  await serviceDocumentation.evaluate(input => {
    input.setAttribute('type', 'text');
    input.removeAttribute('pattern');
  });
  await serviceDocumentation.fill('ftp://docs.example.test');
  await submitOidcSettingsWithoutClientValidation(page);

  await expect(page).toHaveURL(`${IDP_ORIGIN}${OIDC_ROUTE}`);
  errorDialog = page.getByRole('dialog', { name: 'Error' });
  await expect(errorDialog).toContainText(
    MULTI_TENANT
      ? 'Failed to update configuration. Please try again.'
      : 'Service documentation URI must use HTTP or HTTPS'
  );
  await errorDialog.getByRole('button', { name: 'OK' }).click();
  await expect(serviceDocumentation).toHaveValue(originalServiceDocumentation);

  expectNoBrowserFailures(failures);
});

test('OIDC discovery metadata persists normalized standard values', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-oidc-discovery-metadata', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);

  const response = await page.goto(`${IDP_ORIGIN}${OIDC_ROUTE}`);
  expect(response?.status()).toBe(200);
  await expect(
    page.locator(
      'input[name="oidc[discovery][ui_locales_supported]"], input[name="discovery[ui_locales_supported]"]'
    )
  ).toHaveCount(0);

  const displayValues = page.getByLabel('Display Values Supported');
  const originalValue = await displayValues.inputValue();
  let saved = false;

  try {
    await displayValues.fill('page, popup, page');
    await submitOidcSettings(page);
    await expect(page).toHaveURL(`${IDP_ORIGIN}${OIDC_ROUTE}`);
    saved = true;
    await expect(
      page.locator('.toast[data-toast-type="success"]')
    ).toContainText(
      MULTI_TENANT
        ? 'OIDC configuration updated successfully'
        : 'OIDC settings updated successfully'
    );
    await expect(displayValues).toHaveValue(
      MULTI_TENANT ? 'page, popup' : 'page,popup'
    );

    await page.reload();
    await expect(displayValues).toHaveValue(
      MULTI_TENANT ? 'page, popup' : 'page,popup'
    );
  } finally {
    if (saved) {
      await page.goto(`${IDP_ORIGIN}${OIDC_ROUTE}`);
      if (MULTI_TENANT) {
        page.once('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: 'Reset to Defaults' }).click();
      } else {
        await displayValues.fill(originalValue);
        await submitOidcSettings(page);
      }
      await expect(page).toHaveURL(`${IDP_ORIGIN}${OIDC_ROUTE}`);
      await expect(displayValues).toHaveValue(originalValue);
    }
  }

  expectNoBrowserFailures(failures);
});

if (MULTI_TENANT) {
  test('feature and OIDC overrides remain isolated from a sibling tenant', async ({
    browser,
    page,
  }) => {
    const failures = observeBrowserFailures(page);
    const siblingOrigin = tenantOrigin(SIBLING_TENANT_ID);
    const [admin, siblingAdmin] = await Promise.all([
      createManagedUser('admin-config-isolation', { role: 'admin' }),
      createManagedUser('admin-config-sibling', {
        origin: siblingOrigin,
        role: 'admin',
      }),
    ]);
    await loginAsAdmin(page, admin);

    const siblingContext = await browser.newContext();
    const siblingPage = await siblingContext.newPage();
    const siblingFailures = observeBrowserFailures(siblingPage);
    let featuresSaved = false;
    let oidcSaved = false;

    try {
      await loginAsAdmin(siblingPage, siblingAdmin, siblingOrigin);

      await page.goto(`${IDP_ORIGIN}${FEATURES_ROUTE}`);
      await siblingPage.goto(`${siblingOrigin}${FEATURES_ROUTE}`);
      const helpfulErrors = page.getByLabel(
        'Show detailed error messages to users'
      );
      const siblingHelpfulErrors = siblingPage.getByLabel(
        'Show detailed error messages to users'
      );
      const originalHelpfulErrors = await helpfulErrors.isChecked();
      const siblingOriginalHelpfulErrors =
        await siblingHelpfulErrors.isChecked();

      await helpfulErrors.setChecked(!originalHelpfulErrors);
      await page.getByRole('button', { name: 'Save Changes' }).click();
      await expect(page).toHaveURL(`${IDP_ORIGIN}${FEATURES_ROUTE}`);
      featuresSaved = true;
      await expect(helpfulErrors).toBeChecked({
        checked: !originalHelpfulErrors,
      });

      await siblingPage.reload();
      await expect(siblingHelpfulErrors).toBeChecked({
        checked: siblingOriginalHelpfulErrors,
      });

      await page.goto(`${IDP_ORIGIN}${OIDC_ROUTE}`);
      await siblingPage.goto(`${siblingOrigin}${OIDC_ROUTE}`);
      const accessTokenTtl = page.getByLabel('Access Token');
      const siblingAccessTokenTtl = siblingPage.getByLabel('Access Token');
      const originalAccessTokenTtl = await accessTokenTtl.inputValue();
      const siblingOriginalAccessTokenTtl =
        await siblingAccessTokenTtl.inputValue();
      const updatedAccessTokenTtl =
        originalAccessTokenTtl === '1801' ? '1802' : '1801';

      await accessTokenTtl.fill(updatedAccessTokenTtl);
      await submitOidcSettings(page);
      await expect(page).toHaveURL(`${IDP_ORIGIN}${OIDC_ROUTE}`);
      oidcSaved = true;
      await expect(accessTokenTtl).toHaveValue(updatedAccessTokenTtl);

      await siblingPage.reload();
      await expect(siblingAccessTokenTtl).toHaveValue(
        siblingOriginalAccessTokenTtl
      );
    } finally {
      if (oidcSaved) {
        await page.goto(`${IDP_ORIGIN}${OIDC_ROUTE}`);
        page.once('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: 'Reset to Defaults' }).click();
        await expect(page).toHaveURL(`${IDP_ORIGIN}${OIDC_ROUTE}`);
      }
      if (featuresSaved) {
        await page.goto(`${IDP_ORIGIN}${FEATURES_ROUTE}`);
        page.once('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: 'Reset to Defaults' }).click();
        await expect(page).toHaveURL(`${IDP_ORIGIN}${FEATURES_ROUTE}`);
      }
      await siblingContext.close();
    }

    expectNoBrowserFailures(failures);
    expectNoBrowserFailures(siblingFailures);
  });

  test('security, integration, and notification overrides remain isolated from a sibling tenant', async ({
    browser,
    page,
  }) => {
    const failures = observeBrowserFailures(page);
    const siblingOrigin = tenantOrigin(SIBLING_TENANT_ID);
    const [admin, siblingAdmin] = await Promise.all([
      createManagedUser('admin-config-section-isolation', { role: 'admin' }),
      createManagedUser('admin-config-section-sibling', {
        origin: siblingOrigin,
        role: 'admin',
      }),
    ]);
    await loginAsAdmin(page, admin);

    const siblingContext = await browser.newContext();
    const siblingPage = await siblingContext.newPage();
    const siblingFailures = observeBrowserFailures(siblingPage);
    const savedRoutes: string[] = [];

    const saveOverride = async (route: string): Promise<void> => {
      await page.getByRole('button', { name: 'Save Changes' }).click();
      await expect(page).toHaveURL(`${IDP_ORIGIN}${route}`);
      savedRoutes.push(route);
    };

    try {
      await loginAsAdmin(siblingPage, siblingAdmin, siblingOrigin);

      const securityRoute = '/admin/configuration/security';
      await page.goto(`${IDP_ORIGIN}${securityRoute}`);
      await siblingPage.goto(`${siblingOrigin}${securityRoute}`);
      const idleTimeout = page.getByLabel(/Idle Timeout \(minutes\)/i);
      const siblingIdleTimeout = siblingPage.getByLabel(
        /Idle Timeout \(minutes\)/i
      );
      const originalIdleTimeout = await idleTimeout.inputValue();
      const siblingOriginalIdleTimeout = await siblingIdleTimeout.inputValue();
      const minimumIdleTimeout = Number(
        (await idleTimeout.getAttribute('min')) ?? '1'
      );
      const maximumIdleTimeout = Number(
        (await idleTimeout.getAttribute('max')) ?? '1440'
      );
      const currentIdleTimeout = Number(originalIdleTimeout);
      const updatedIdleTimeout = String(
        currentIdleTimeout < maximumIdleTimeout
          ? currentIdleTimeout + 1
          : Math.max(minimumIdleTimeout, currentIdleTimeout - 1)
      );

      await idleTimeout.fill(updatedIdleTimeout);
      await saveOverride(securityRoute);
      await expect(idleTimeout).toHaveValue(updatedIdleTimeout);
      await siblingPage.reload();
      await expect(siblingIdleTimeout).toHaveValue(siblingOriginalIdleTimeout);

      const integrationsRoute = '/admin/configuration/integrations';
      await page.goto(`${IDP_ORIGIN}${integrationsRoute}`);
      await siblingPage.goto(`${siblingOrigin}${integrationsRoute}`);
      const website = page.getByLabel('Website URL');
      const siblingWebsite = siblingPage.getByLabel('Website URL');
      const siblingOriginalWebsite = await siblingWebsite.inputValue();
      const updatedWebsite = `https://isolation-${DEPLOYMENT_CELL}.parako.test`;

      await website.fill(updatedWebsite);
      await saveOverride(integrationsRoute);
      await expect(website).toHaveValue(updatedWebsite);
      await siblingPage.reload();
      await expect(siblingWebsite).toHaveValue(siblingOriginalWebsite);

      const notificationsRoute = '/admin/configuration/notifications';
      await page.goto(`${IDP_ORIGIN}${notificationsRoute}`);
      await siblingPage.goto(`${siblingOrigin}${notificationsRoute}`);
      const allowUserPreferences = page.locator('#defaults_allow_user_prefs');
      const siblingAllowUserPreferences = siblingPage.locator(
        '#defaults_allow_user_prefs'
      );
      const originallyAllowed = await allowUserPreferences.isChecked();
      const siblingOriginallyAllowed =
        await siblingAllowUserPreferences.isChecked();

      await allowUserPreferences.setChecked(!originallyAllowed);
      await saveOverride(notificationsRoute);
      await expect(allowUserPreferences).toBeChecked({
        checked: !originallyAllowed,
      });
      await siblingPage.reload();
      await expect(siblingAllowUserPreferences).toBeChecked({
        checked: siblingOriginallyAllowed,
      });
    } finally {
      for (const route of savedRoutes.reverse()) {
        await page.goto(`${IDP_ORIGIN}${route}`);
        page.once('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: 'Reset to Defaults' }).click();
        await expect(page).toHaveURL(`${IDP_ORIGIN}${route}`);
      }
      await siblingContext.close();
    }

    expectNoBrowserFailures(failures);
    expectNoBrowserFailures(siblingFailures);
  });
}

test('deployment settings validate and persist without an editable application URL', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-deployment-configuration', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);

  const route = '/admin/settings/deployment';
  const response = await page.goto(`${IDP_ORIGIN}${route}`);
  expect(response?.status()).toBe(200);

  if (MULTI_TENANT) {
    await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/configuration`);
    await expect(
      page.getByRole('heading', { name: 'Deployment Settings' })
    ).toHaveCount(0);
  } else {
    await expect(
      page.locator('[onclick], [onsubmit], [onchange], [oninput]')
    ).toHaveCount(0);
    await expect(page.locator('#url')).toHaveCount(0);

    const allowedOrigins = page.getByLabel('Allowed Origins (production)');
    const devAllowedOrigins = page.getByLabel(
      'Allowed Origins (non-production)'
    );
    const trustProxyHops = page.getByLabel('Trust Proxy Hops');
    const original = {
      allowedOrigins: await allowedOrigins.inputValue(),
      devAllowedOrigins: await devAllowedOrigins.inputValue(),
      trustProxyHops: await trustProxyHops.inputValue(),
    };
    const updated = {
      allowedOrigins: 'https://phase2-rp.example.test',
      trustProxyHops: original.trustProxyHops === '2' ? '1' : '2',
    };
    let saved = false;

    try {
      await allowedOrigins.fill('not an origin');
      await page.getByRole('button', { name: 'Save Changes' }).click();

      const invalidDialog = page.getByRole('dialog', {
        name: 'Invalid Allowed Origin',
      });
      await expect(invalidDialog).toContainText(
        '"not an origin" is not a valid origin URL.'
      );
      await invalidDialog.getByRole('button', { name: 'OK' }).click();
      await expect(page).toHaveURL(`${IDP_ORIGIN}${route}`);

      await allowedOrigins.fill(updated.allowedOrigins);
      await trustProxyHops.fill(updated.trustProxyHops);
      await page.getByRole('button', { name: 'Save Changes' }).click();
      await expect(page).toHaveURL(`${IDP_ORIGIN}${route}`);
      saved = true;
      await expect(
        page.locator('.toast[data-toast-type="success"]')
      ).toContainText('Deployment settings updated successfully');

      await page.reload();
      await expect(allowedOrigins).toHaveValue(updated.allowedOrigins);
      await expect(trustProxyHops).toHaveValue(updated.trustProxyHops);
    } finally {
      if (saved) {
        await page.goto(`${IDP_ORIGIN}${route}`);
        await allowedOrigins.fill(original.allowedOrigins);
        await devAllowedOrigins.fill(original.devAllowedOrigins);
        await trustProxyHops.fill(original.trustProxyHops);
        await page.getByRole('button', { name: 'Save Changes' }).click();
        await expect(page).toHaveURL(`${IDP_ORIGIN}${route}`);
        await expect(allowedOrigins).toHaveValue(original.allowedOrigins);
        await expect(devAllowedOrigins).toHaveValue(original.devAllowedOrigins);
        await expect(trustProxyHops).toHaveValue(original.trustProxyHops);
      }
    }
  }

  expectNoBrowserFailures(failures);
});

test('global settings overview exposes a safe operational lifecycle', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-settings-overview', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);

  const overviewRoute = '/admin/settings';
  const response = await page.goto(IDP_ORIGIN + overviewRoute);
  expect(response?.status()).toBe(200);

  if (MULTI_TENANT) {
    await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/configuration`);
    await expect(page.getByRole('heading', { name: 'Settings' })).toHaveCount(
      0
    );
  } else {
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByText('Database', { exact: true })).toBeVisible();
    await expect(
      page.locator('[onclick], [onsubmit], [onchange], [oninput]')
    ).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Import' })).toHaveAttribute(
      'href',
      '/admin/settings/import'
    );

    const statsResponse = await page.request.get(
      `${IDP_ORIGIN}/admin/settings/stats`
    );
    expect(statsResponse.status()).toBe(200);
    await expect(statsResponse.json()).resolves.toMatchObject({
      isLoaded: true,
      sections: {
        application: true,
        branding: true,
        deployment: true,
        security: true,
        features: true,
        oidc: true,
        integrations: true,
      },
    });

    const healthResponsePromise = page.waitForResponse(response =>
      response.url().endsWith('/admin/settings/health')
    );
    await page.getByRole('button', { name: 'Health Check' }).click();
    const healthResponse = await healthResponsePromise;
    expect(healthResponse.status()).toBe(200);
    await expect(page.locator('#healthStatusBadge')).toContainText('Healthy');
    await expect(page.locator('#healthCheckResults')).toContainText(
      'Configuration'
    );
    await expect(page.locator('#healthCheckResults')).toContainText('Database');
    await page.getByRole('button', { name: 'Hide health check' }).click();
    await expect(page.locator('#healthCheckSection')).toBeHidden();

    const reloadButton = page.getByRole('button', { name: 'Reload' });
    await reloadButton.click();
    const reloadDialog = page.getByRole('dialog', {
      name: 'Reload Configuration',
    });
    await expect(reloadDialog).toBeVisible();
    await expect(
      reloadDialog.getByRole('button', { name: 'Cancel' })
    ).toBeFocused();
    await reloadDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(reloadDialog).toBeHidden();
    await expect(reloadButton).toBeFocused();

    const reloadResponsePromise = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/admin/settings/reload';
    });
    await reloadButton.click();
    await reloadDialog.getByRole('button', { name: 'Reload' }).click();
    expect((await reloadResponsePromise).status()).toBe(302);
    await expect(page).toHaveURL(IDP_ORIGIN + overviewRoute);
    await expect(
      page.locator('.toast[data-toast-type="success"]')
    ).toContainText('Configuration reloaded successfully');

    await page.goto(IDP_ORIGIN + APPLICATION_ROUTE);
    const titleInput = page.getByLabel('Application Title');
    const originalTitle = await titleInput.inputValue();
    const temporaryTitle = `Settings lifecycle ${DEPLOYMENT_CELL}`;
    let rollbackRestored = false;

    try {
      await titleInput.fill(temporaryTitle);
      await page.getByRole('button', { name: 'Save Changes' }).click();
      await expect(page).toHaveURL(IDP_ORIGIN + APPLICATION_ROUTE);
      await expect(titleInput).toHaveValue(temporaryTitle);

      await page.goto(IDP_ORIGIN + overviewRoute);
      await page.getByRole('button', { name: 'History' }).click();
      await expect(page.locator('#versionHistory')).toBeVisible();

      const rollbackButton = page
        .getByRole('button', { name: 'Rollback', exact: true })
        .first();
      await rollbackButton.click();
      const rollbackDialog = page.getByRole('dialog', {
        name: /Rollback to v/,
      });
      await expect(rollbackDialog).toBeVisible();
      await expect(
        rollbackDialog.getByRole('button', { name: 'Cancel' })
      ).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(rollbackDialog).toBeHidden();
      await expect(rollbackButton).toBeFocused();

      const rollbackResponsePromise = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === '/admin/settings/rollback';
      });
      await rollbackButton.click();
      await rollbackDialog
        .getByRole('button', { name: 'Rollback', exact: true })
        .click();
      expect((await rollbackResponsePromise).status()).toBe(302);
      await expect(page).toHaveURL(IDP_ORIGIN + overviewRoute);
      await expect(
        page.locator('.toast[data-toast-type="success"]')
      ).toContainText('Configuration successfully rolled back to version');

      await page.goto(IDP_ORIGIN + APPLICATION_ROUTE);
      await expect(titleInput).toHaveValue(originalTitle);
      rollbackRestored = true;
    } finally {
      if (!rollbackRestored) {
        await page.goto(IDP_ORIGIN + APPLICATION_ROUTE);
        await titleInput.fill(originalTitle);
        await page.getByRole('button', { name: 'Save Changes' }).click();
        await expect(page).toHaveURL(IDP_ORIGIN + APPLICATION_ROUTE);
      }
    }

    const forgedReload = await page.request.post(
      `${IDP_ORIGIN}/admin/settings/reload`,
      { form: {}, maxRedirects: 0 }
    );
    expect(forgedReload.status()).toBe(403);
  }

  expectNoBrowserFailures(failures);
});

test('an application identity change reaches its public tenant without leaking to a sibling', async ({
  browser,
  page,
  request,
}) => {
  const smtpStatusResponse = await request.get(`${RP_ORIGIN}/smtp/status`);
  expect(smtpStatusResponse.ok()).toBe(true);
  const smtpStatus = (await smtpStatusResponse.json()) as {
    successfulAuthentications: number;
  };
  expect(smtpStatus.successfulAuthentications).toBeGreaterThan(0);
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-configuration', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);

  const response = await page.goto(`${IDP_ORIGIN}${APPLICATION_ROUTE}`);
  expect(response?.status()).toBe(200);

  const titleInput = page.getByLabel('Application Title');
  const descriptionInput = page.getByLabel('Description');
  const originalTitle = await titleInput.inputValue();
  const originalDescription = await descriptionInput.inputValue();
  const originalDocumentTitle = await page.title();
  const applicationTitle = `Phase 2 ${DEPLOYMENT_CELL}`;

  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  const publicFailures = observeBrowserFailures(publicPage);
  const siblingContext = MULTI_TENANT ? await browser.newContext() : undefined;
  const siblingPage = siblingContext
    ? await siblingContext.newPage()
    : undefined;
  const siblingFailures = siblingPage
    ? observeBrowserFailures(siblingPage)
    : undefined;

  try {
    const originalPublicResponse = await publicPage.goto(
      `${IDP_ORIGIN}/auth/login`
    );
    expect(originalPublicResponse?.status()).toBe(200);
    const originalPublicDocumentTitle = await publicPage.title();

    let siblingDocumentTitle: string | undefined;
    if (siblingPage) {
      const siblingResponse = await siblingPage.goto(
        `${tenantOrigin(SIBLING_TENANT_ID)}/auth/login`
      );
      expect(siblingResponse?.status()).toBe(200);
      siblingDocumentTitle = await siblingPage.title();
    }

    try {
      await titleInput.fill(applicationTitle);
      await descriptionInput.fill(
        `Application configuration exercised in ${DEPLOYMENT_CELL}`
      );
      await page.getByRole('button', { name: 'Save Changes' }).click();

      await expect(page).toHaveURL(`${IDP_ORIGIN}${APPLICATION_ROUTE}`);
      await expect(
        page.locator('.toast[data-toast-type="success"]')
      ).toContainText(
        MULTI_TENANT
          ? 'Application configuration updated successfully'
          : 'Application settings updated successfully'
      );
      await expect(titleInput).toHaveValue(applicationTitle);
      await expect(page).toHaveTitle(titleEndingWith(applicationTitle));

      const publicResponse = await publicPage.goto(`${IDP_ORIGIN}/auth/login`);
      expect(publicResponse?.status()).toBe(200);
      await expect(publicPage).toHaveTitle(titleEndingWith(applicationTitle));

      if (siblingPage && siblingDocumentTitle) {
        await siblingPage.reload();
        await expect(siblingPage).toHaveTitle(siblingDocumentTitle);
        await expect(siblingPage).not.toHaveTitle(
          titleEndingWith(applicationTitle)
        );
      }

      if (!MULTI_TENANT) {
        await page.goto(`${IDP_ORIGIN}/admin/settings`);
        await page.getByRole('button', { name: 'Export', exact: true }).click();

        const exportHeading = page.getByRole('heading', {
          name: 'Export Configuration',
        });
        await expect(exportHeading).toBeVisible();
        const exportDialog = exportHeading.locator('..').locator('..');

        const responsePromise = page.waitForResponse(response => {
          const url = new URL(response.url());
          return (
            url.pathname === '/admin/settings/export' &&
            response.status() === 200
          );
        });
        const downloadPromise = page.waitForEvent('download');
        await exportDialog
          .getByRole('button', { name: 'Export', exact: true })
          .click();
        const [download, exportResponse] = await Promise.all([
          downloadPromise,
          responsePromise,
        ]);
        expect(exportResponse.headers()['cache-control']).toBe('no-store');

        // Chromium reports a successful navigation download as an aborted
        // document request. Remove only the exact request already proven by the
        // matching 200 response and download event above.
        const expectedAbort = `GET ${exportResponse.url()}`;
        const expectedAbortIndex =
          failures.failedRequests.indexOf(expectedAbort);
        if (expectedAbortIndex >= 0) {
          failures.failedRequests.splice(expectedAbortIndex, 1);
        }

        const exportPath = await download.path();
        expect(exportPath).not.toBeNull();

        const exportedConfig = JSON.parse(
          await readFile(exportPath!, 'utf8')
        ) as {
          application?: Record<string, unknown>;
        };
        expect(exportedConfig.application).toMatchObject({
          title: applicationTitle,
        });
        expect(exportedConfig.application).not.toHaveProperty('_csrf');
        expect(exportedConfig.application).not.toHaveProperty('_deviceInfo');

        await page.goto(`${IDP_ORIGIN}${APPLICATION_ROUTE}`);
      }

      await page.setViewportSize({ width: 390, height: 844 });
      await expect(
        page.locator('header').getByText(`${applicationTitle} Admin`, {
          exact: true,
        })
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      ).toBe(true);
    } finally {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`${IDP_ORIGIN}${APPLICATION_ROUTE}`);

      if (MULTI_TENANT) {
        const resetButton = page.getByRole('button', {
          name: 'Reset to Defaults',
        });
        page.once('dialog', async dialog => {
          expect(dialog.message()).toContain(
            'reset Application configuration to defaults'
          );
          await dialog.dismiss();
        });
        await resetButton.click();
        await expect(titleInput).toHaveValue(applicationTitle);

        page.once('dialog', dialog => dialog.accept());
        await resetButton.click();
        await expect(page).toHaveURL(`${IDP_ORIGIN}${APPLICATION_ROUTE}`);
        await expect(page).toHaveTitle(originalDocumentTitle);
      } else {
        const unsavedTitle = `${applicationTitle} unsaved`;
        const resetButton = page.getByRole('button', { name: 'Reset Form' });
        const resetDialog = page.getByRole('dialog', { name: 'Reset Form' });

        await titleInput.fill(unsavedTitle);
        await resetButton.click();
        await expect(resetDialog).toBeVisible();
        await resetDialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(titleInput).toHaveValue(unsavedTitle);

        await resetButton.click();
        await expect(resetDialog).toBeVisible();
        await resetDialog
          .getByRole('button', { name: 'Reset', exact: true })
          .click();
        await expect(titleInput).toHaveValue(applicationTitle);

        await titleInput.fill(originalTitle);
        await descriptionInput.fill(originalDescription);
        await page.getByRole('button', { name: 'Save Changes' }).click();
        await expect(page).toHaveURL(`${IDP_ORIGIN}${APPLICATION_ROUTE}`);
        await expect(titleInput).toHaveValue(originalTitle);
      }
    }

    await publicPage.goto(`${IDP_ORIGIN}/auth/login`);
    await expect(publicPage).toHaveTitle(originalPublicDocumentTitle);
  } finally {
    await publicContext.close();
    await siblingContext?.close();
  }

  expectNoBrowserFailures(failures);
  expectNoBrowserFailures(publicFailures);
  if (siblingFailures) expectNoBrowserFailures(siblingFailures);
});

test('application settings reject a default locale that is not available', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-application-validation', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);

  const response = await page.goto(`${IDP_ORIGIN}${APPLICATION_ROUTE}`);
  expect(response?.status()).toBe(200);

  const titleInput = page.getByLabel('Application Title');
  const originalTitle = await titleInput.inputValue();
  const defaultLocale = page.locator('select[name="locales[default]"]');
  const availableLocales = page.locator(
    'input[type="checkbox"][name="locales[available][]"]'
  );
  const originalDefault = await defaultLocale.inputValue();
  const originalAvailable = await availableLocales.evaluateAll(inputs =>
    inputs
      .filter(input => (input as HTMLInputElement).checked)
      .map(input => (input as HTMLInputElement).value)
  );

  await titleInput.fill(`${originalTitle} must not persist`);
  await defaultLocale.selectOption('en');
  for (const locale of await availableLocales.all()) {
    const value = await locale.getAttribute('value');
    await locale.setChecked(value === 'fr');
  }

  const saveResponsePromise = page.waitForResponse(saveResponse => {
    const url = new URL(saveResponse.url());
    return (
      saveResponse.request().method() === 'POST' &&
      url.pathname === APPLICATION_ROUTE
    );
  });
  const form = titleInput.locator('xpath=ancestor::form');
  await form.evaluate(applicationForm => {
    HTMLFormElement.prototype.submit.call(applicationForm);
  });

  expect((await saveResponsePromise).status()).toBe(302);
  await expect(page).toHaveURL(`${IDP_ORIGIN}${APPLICATION_ROUTE}`);
  const errorDialog = page.getByRole('dialog', { name: 'Error' });
  await expect(errorDialog).toContainText(
    MULTI_TENANT
      ? 'Failed to update configuration. Please try again.'
      : 'Failed to update application settings'
  );
  await errorDialog.getByRole('button', { name: 'OK' }).click();
  await expect(titleInput).toHaveValue(originalTitle);
  await expect(defaultLocale).toHaveValue(originalDefault);
  expect(
    await availableLocales.evaluateAll(inputs =>
      inputs
        .filter(input => (input as HTMLInputElement).checked)
        .map(input => (input as HTMLInputElement).value)
    )
  ).toEqual(originalAvailable);

  expectNoBrowserFailures(failures);
});

if (!MULTI_TENANT) {
  test('a stale global application form cannot overwrite a newer save', async ({
    browser,
  }) => {
    const admin = await createManagedUser('admin-application-conflict', {
      role: 'admin',
    });
    const firstContext = await browser.newContext();
    const secondContext = await browser.newContext();
    const firstPage = await firstContext.newPage();
    const secondPage = await secondContext.newPage();
    const firstFailures = observeBrowserFailures(firstPage);
    const secondFailures = observeBrowserFailures(secondPage);
    let firstSaveCompleted = false;
    let originalTitle = '';
    let originalDescription = '';

    try {
      await loginAsAdmin(firstPage, admin);
      await loginAsAdmin(secondPage, admin);
      await firstPage.goto(`${IDP_ORIGIN}${APPLICATION_ROUTE}`);
      await secondPage.goto(`${IDP_ORIGIN}${APPLICATION_ROUTE}`);

      const firstVersion = firstPage.locator('input[name="_configVersion"]');
      const secondVersion = secondPage.locator('input[name="_configVersion"]');
      await expect(firstVersion).toHaveValue(/\d+/);
      await expect(secondVersion).toHaveValue(await firstVersion.inputValue());

      const firstTitle = firstPage.getByLabel('Application Title');
      const firstDescription = firstPage.getByLabel('Description');
      const secondTitle = secondPage.getByLabel('Application Title');
      originalTitle = await firstTitle.inputValue();
      originalDescription = await firstDescription.inputValue();
      const winningTitle = `${originalTitle} first ${DEPLOYMENT_CELL}`;
      const staleTitle = `${originalTitle} stale ${DEPLOYMENT_CELL}`;

      await firstTitle.fill(winningTitle);
      await firstPage.getByRole('button', { name: 'Save Changes' }).click();
      firstSaveCompleted = true;
      await expect(firstPage).toHaveURL(`${IDP_ORIGIN}${APPLICATION_ROUTE}`);
      await expect(firstTitle).toHaveValue(winningTitle);

      await secondTitle.fill(staleTitle);
      await secondPage.getByRole('button', { name: 'Save Changes' }).click();
      await expect(secondPage).toHaveURL(`${IDP_ORIGIN}${APPLICATION_ROUTE}`);
      const conflictDialog = secondPage.getByRole('dialog', { name: 'Error' });
      await expect(conflictDialog).toContainText(
        'Configuration was modified by another administrator'
      );
      await conflictDialog.getByRole('button', { name: 'OK' }).click();
      await expect(secondTitle).toHaveValue(winningTitle);

      await secondPage.reload();
      await expect(secondTitle).toHaveValue(winningTitle);
    } finally {
      if (firstSaveCompleted) {
        await firstPage.goto(`${IDP_ORIGIN}${APPLICATION_ROUTE}`);
        await firstPage.getByLabel('Application Title').fill(originalTitle);
        await firstPage.getByLabel('Description').fill(originalDescription);
        await firstPage.getByRole('button', { name: 'Save Changes' }).click();
        await expect(firstPage.getByLabel('Application Title')).toHaveValue(
          originalTitle
        );
      }

      await firstContext.close();
      await secondContext.close();
    }

    expectNoBrowserFailures(firstFailures);
    expectNoBrowserFailures(secondFailures);
  });
}

test('security settings reject invalid values, persist valid changes, and remain CSP-safe', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-security-configuration', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);

  const securityRoute = MULTI_TENANT
    ? '/admin/configuration/security'
    : '/admin/settings/security';
  const securityResponse = await page.goto(`${IDP_ORIGIN}${securityRoute}`);
  expect(securityResponse?.status()).toBe(200);
  await expect(
    page.locator('[onclick], [onsubmit], [onchange], [oninput]')
  ).toHaveCount(0);

  const minimumLength = page.getByLabel(
    MULTI_TENANT ? 'Minimum Password Length' : 'Minimum Length'
  );
  const originalMinimumLength = await minimumLength.inputValue();
  const minimum = Number((await minimumLength.getAttribute('min')) || '8');
  const maximum = Number(
    (await minimumLength.getAttribute('max')) || String(minimum + 120)
  );
  const current = Number(originalMinimumLength || minimum);
  const updatedMinimumLength = String(
    current < maximum ? current + 1 : Math.max(minimum, current - 1)
  );
  let saved = false;

  try {
    if (!MULTI_TENANT) {
      await page.getByRole('button', { name: 'Save Changes' }).click();
      const cancellation = page.getByRole('dialog', {
        name: 'Confirm Authentication Configuration Changes',
      });
      await expect(cancellation).toBeVisible();
      await cancellation.getByRole('button', { name: 'Cancel' }).click();
      await expect(page).toHaveURL(`${IDP_ORIGIN}${securityRoute}`);
    }

    await minimumLength.fill(String(minimum - 1));
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page).toHaveURL(`${IDP_ORIGIN}${securityRoute}`);
    expect(
      await minimumLength.evaluate(
        (input: HTMLInputElement) => input.validity.rangeUnderflow
      )
    ).toBe(true);

    await minimumLength.fill(updatedMinimumLength);
    await page.getByRole('button', { name: 'Save Changes' }).click();

    if (!MULTI_TENANT) {
      const confirmation = page.getByRole('dialog', {
        name: 'Confirm Authentication Configuration Changes',
      });
      await expect(confirmation).toBeVisible();
      await confirmation
        .getByRole('button', { name: 'Yes, Save Changes' })
        .click();
    }

    await expect(page).toHaveURL(`${IDP_ORIGIN}${securityRoute}`);
    saved = true;
    await expect(
      page.locator('.toast[data-toast-type="success"]')
    ).toContainText(
      MULTI_TENANT
        ? 'Security configuration updated successfully'
        : 'Security settings updated successfully'
    );
    await expect(minimumLength).toHaveValue(updatedMinimumLength);
    await page.reload();
    await expect(minimumLength).toHaveValue(updatedMinimumLength);

    if (!MULTI_TENANT) {
      const exportedSecurity = await page.evaluate(async () => {
        const exportResponse = await fetch('/admin/settings/export');
        if (!exportResponse.ok) {
          throw new Error('Unable to export security configuration');
        }
        const config = (await exportResponse.json()) as {
          security?: Record<string, unknown>;
        };
        return config.security;
      });

      expect(exportedSecurity).not.toHaveProperty('_csrf');
      expect(exportedSecurity).not.toHaveProperty('_deviceInfo');
      expect(exportedSecurity).toMatchObject({
        authentication: {
          login: {
            password_policy: {
              min_length: Number(updatedMinimumLength),
            },
          },
        },
      });

      const secretsRoute = '/admin/settings/security/secrets';
      const secretsResponse = await page.goto(`${IDP_ORIGIN}${secretsRoute}`);
      expect(secretsResponse?.status()).toBe(200);
      await expect(
        page.locator('[onclick], [onsubmit], [onchange], [oninput]')
      ).toHaveCount(0);

      const jwtSecret = page.getByLabel('JWT Secret');
      await expect(jwtSecret).toHaveAttribute('readonly', '');

      await page.getByRole('button', { name: 'Reveal' }).first().click();
      const revealConfirmation = page.getByRole('dialog', {
        name: 'Reveal Secret - Security Warning',
      });
      await expect(revealConfirmation).toBeVisible();
      await revealConfirmation.getByRole('button', { name: 'Cancel' }).click();
      await expect(jwtSecret).toHaveAttribute('readonly', '');
    }
  } finally {
    if (saved) {
      await page.goto(`${IDP_ORIGIN}${securityRoute}`);
      if (MULTI_TENANT) {
        page.once('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: 'Reset to Defaults' }).click();
        await expect(page).toHaveURL(`${IDP_ORIGIN}${securityRoute}`);
      } else {
        await minimumLength.fill(originalMinimumLength);
        await page.getByRole('button', { name: 'Save Changes' }).click();
        const confirmation = page.getByRole('dialog', {
          name: 'Confirm Authentication Configuration Changes',
        });
        await confirmation
          .getByRole('button', { name: 'Yes, Save Changes' })
          .click();
        await expect(page).toHaveURL(`${IDP_ORIGIN}${securityRoute}`);
      }

      await expect(minimumLength).toHaveValue(originalMinimumLength);
    }
  }

  expectNoBrowserFailures(failures);
});

test('MFA settings validate identifiers and expose platform floors accurately', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-mfa-configuration', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);

  const mfaRoute = MULTI_TENANT
    ? '/admin/configuration/security'
    : '/admin/settings/security/mfa';
  const response = await page.goto(`${IDP_ORIGIN}${mfaRoute}`);
  expect(response?.status()).toBe(200);
  await expect(
    page.locator('[onclick], [onsubmit], [onchange], [oninput]')
  ).toHaveCount(0);

  if (MULTI_TENANT) {
    for (const label of [
      'Enable Multi-Factor Authentication',
      'TOTP (Authenticator App)',
      'Email OTP',
    ]) {
      const requiredControl = page.getByLabel(label);
      await expect(requiredControl).toBeChecked();
      await expect(requiredControl).toBeDisabled();
    }

    for (const label of ['SMS OTP', 'WebAuthn / Passkeys']) {
      await expect(page.getByLabel(label)).toBeEnabled();
    }

    await expect(
      page.getByText('Required by the platform and cannot be disabled.')
    ).toBeVisible();
  } else {
    const totpEnabled = page.locator(
      '[id="authentication.multi_factor.totp.enabled"]'
    );
    const issuerName = page.getByLabel('Issuer Name');
    const originalEnabled = await totpEnabled.isChecked();
    const originalIssuer = await issuerName.inputValue();
    const updatedIssuer = `Parako E2E ${DEPLOYMENT_CELL}`;
    let saved = false;

    const saveAndConfirm = async () => {
      await page.getByRole('button', { name: 'Save Changes' }).click();
      const confirmation = page.getByRole('dialog', {
        name: 'Confirm MFA Configuration Changes',
      });
      await expect(confirmation).toBeVisible();
      await confirmation
        .getByRole('button', { name: 'Yes, Save Changes' })
        .click();
      await expect(page).toHaveURL(`${IDP_ORIGIN}${mfaRoute}`);
    };

    try {
      await totpEnabled.check();
      await issuerName.fill('   ');
      await saveAndConfirm();

      const validationError = page.getByRole('dialog', { name: 'Error' });
      await expect(validationError).toContainText(
        'TOTP issuer name is required when TOTP is enabled'
      );
      await validationError.getByRole('button', { name: 'OK' }).click();
      await expect(issuerName).toHaveValue(originalIssuer);

      await totpEnabled.check();
      await issuerName.fill(`  ${updatedIssuer}  `);
      await saveAndConfirm();
      saved = true;

      await expect(
        page.locator('.toast[data-toast-type="success"]')
      ).toContainText('Security settings updated successfully');
      await expect(issuerName).toHaveValue(updatedIssuer);
      await page.reload();
      await expect(issuerName).toHaveValue(updatedIssuer);
    } finally {
      if (saved) {
        await page.goto(`${IDP_ORIGIN}${mfaRoute}`);
        await totpEnabled.setChecked(originalEnabled);
        await issuerName.fill(originalIssuer);
        await saveAndConfirm();
        await expect(totpEnabled).toBeChecked({ checked: originalEnabled });
        await expect(issuerName).toHaveValue(originalIssuer);
      }
    }
  }

  expectNoBrowserFailures(failures);
});

test('session, protection, and secret settings round-trip safely', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-security-partitions', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);

  const boundedUpdate = async (field: Locator): Promise<string> => {
    const minimum = Number((await field.getAttribute('min')) ?? '0');
    const maximum = Number((await field.getAttribute('max')) ?? '1000');
    const current = Number(await field.inputValue());
    if (Number.isFinite(current) && current >= minimum && current < maximum) {
      return String(current + 1);
    }
    return String(Math.min(maximum, minimum + 1));
  };

  if (MULTI_TENANT) {
    const route = '/admin/configuration/security';
    await page.goto(`${IDP_ORIGIN}${route}`);
    const idleTimeout = page.getByLabel(/Idle Timeout \(minutes\)/i);
    const travelSpeed = page.getByLabel(/Impossible Travel Max Speed/i);
    const originalIdleTimeout = await idleTimeout.inputValue();
    const originalTravelSpeed = await travelSpeed.inputValue();
    const updatedIdleTimeout = await boundedUpdate(idleTimeout);
    const updatedTravelSpeed = await boundedUpdate(travelSpeed);
    let saved = false;

    try {
      await idleTimeout.fill(updatedIdleTimeout);
      await travelSpeed.fill(updatedTravelSpeed);
      await page.getByRole('button', { name: 'Save Changes' }).click();
      await expect(page).toHaveURL(`${IDP_ORIGIN}${route}`);
      saved = true;
      await expect(
        page.locator('.toast[data-toast-type="success"]')
      ).toContainText('Security configuration updated successfully');
      await expect(idleTimeout).toHaveValue(updatedIdleTimeout);
      await expect(travelSpeed).toHaveValue(updatedTravelSpeed);
      await page.reload();
      await expect(idleTimeout).toHaveValue(updatedIdleTimeout);
      await expect(travelSpeed).toHaveValue(updatedTravelSpeed);
    } finally {
      if (saved) {
        page.once('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: 'Reset to Defaults' }).click();
        await expect(page).toHaveURL(`${IDP_ORIGIN}${route}`);
        await expect(idleTimeout).toHaveValue(originalIdleTimeout);
        await expect(travelSpeed).toHaveValue(originalTravelSpeed);
      }
    }
  } else {
    const saveAndConfirm = async (
      route: string,
      confirmationName: string
    ): Promise<void> => {
      await page.getByRole('button', { name: 'Save Changes' }).click();
      const confirmation = page.getByRole('dialog', {
        name: confirmationName,
      });
      await expect(confirmation).toBeVisible();
      await confirmation
        .getByRole('button', { name: 'Yes, Save Changes' })
        .click();
      await expect(page).toHaveURL(`${IDP_ORIGIN}${route}`);
      await expect(
        page.locator('.toast[data-toast-type="success"]')
      ).toContainText('Security settings updated successfully');
    };

    const sessionsRoute = '/admin/settings/security/sessions';
    const protectionRoute = '/admin/settings/security/protection';
    const secretsRoute = '/admin/settings/security/secrets';
    let sessionsSaved = false;
    let protectionSaved = false;
    let secretsSaved = false;
    let originalIdleTimeout = '';
    let updatedIdleTimeout = '';
    let originalTravelSpeed = '';
    let updatedTravelSpeed = '';
    let originalImpossibleTravel = false;
    let originalJwtExpiration = '';
    let updatedJwtExpiration = '';

    try {
      await page.goto(`${IDP_ORIGIN}${sessionsRoute}`);
      const idleTimeout = page.getByLabel(/Idle Timeout \(Minutes\)/i);
      originalIdleTimeout = await idleTimeout.inputValue();
      updatedIdleTimeout = await boundedUpdate(idleTimeout);
      await idleTimeout.fill(updatedIdleTimeout);
      await saveAndConfirm(
        sessionsRoute,
        'Confirm Session Configuration Changes'
      );
      sessionsSaved = true;
      await expect(idleTimeout).toHaveValue(updatedIdleTimeout);
      await page.reload();
      await expect(idleTimeout).toHaveValue(updatedIdleTimeout);

      await page.goto(`${IDP_ORIGIN}${protectionRoute}`);
      const impossibleTravel = page.getByLabel(
        'Enable Impossible Travel Detection'
      );
      const travelSpeed = page.getByLabel('Max Travel Speed (km/h)');
      originalImpossibleTravel = await impossibleTravel.isChecked();
      originalTravelSpeed = await travelSpeed.inputValue();
      updatedTravelSpeed = await boundedUpdate(travelSpeed);
      await impossibleTravel.check();
      await travelSpeed.fill(updatedTravelSpeed);
      await saveAndConfirm(
        protectionRoute,
        'Confirm Protection Configuration Changes'
      );
      protectionSaved = true;
      await expect(impossibleTravel).toBeChecked();
      await expect(travelSpeed).toHaveValue(updatedTravelSpeed);
      await page.reload();
      await expect(impossibleTravel).toBeChecked();
      await expect(travelSpeed).toHaveValue(updatedTravelSpeed);

      await page.goto(`${IDP_ORIGIN}${secretsRoute}`);
      const jwtExpiration = page.getByLabel('JWT Expiration');
      originalJwtExpiration = await jwtExpiration.inputValue();
      updatedJwtExpiration = originalJwtExpiration === '2h' ? '3h' : '2h';
      await jwtExpiration.fill(updatedJwtExpiration);
      await saveAndConfirm(secretsRoute, 'Confirm Security Secrets Changes');
      secretsSaved = true;
      await expect(jwtExpiration).toHaveValue(updatedJwtExpiration);
      await page.reload();
      await expect(jwtExpiration).toHaveValue(updatedJwtExpiration);
      await expect(page.getByLabel('JWT Secret')).toHaveAttribute(
        'readonly',
        ''
      );
    } finally {
      if (secretsSaved) {
        await page.goto(`${IDP_ORIGIN}${secretsRoute}`);
        await page.getByLabel('JWT Expiration').fill(originalJwtExpiration);
        await saveAndConfirm(secretsRoute, 'Confirm Security Secrets Changes');
        await expect(page.getByLabel('JWT Expiration')).toHaveValue(
          originalJwtExpiration
        );
      }

      if (protectionSaved) {
        await page.goto(`${IDP_ORIGIN}${protectionRoute}`);
        await page
          .getByLabel('Enable Impossible Travel Detection')
          .setChecked(originalImpossibleTravel);
        await page
          .getByLabel('Max Travel Speed (km/h)')
          .fill(originalTravelSpeed);
        await saveAndConfirm(
          protectionRoute,
          'Confirm Protection Configuration Changes'
        );
        await expect(
          page.getByLabel('Enable Impossible Travel Detection')
        ).toBeChecked({ checked: originalImpossibleTravel });
      }

      if (sessionsSaved) {
        await page.goto(`${IDP_ORIGIN}${sessionsRoute}`);
        await page
          .getByLabel(/Idle Timeout \(Minutes\)/i)
          .fill(originalIdleTimeout);
        await saveAndConfirm(
          sessionsRoute,
          'Confirm Session Configuration Changes'
        );
        await expect(page.getByLabel(/Idle Timeout \(Minutes\)/i)).toHaveValue(
          originalIdleTimeout
        );
      }
    }
  }

  expectNoBrowserFailures(failures);
});

test('integration settings deliver email, persist safely, and remain tenant-scoped', async ({
  page,
  request,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-integrations-configuration', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);

  const integrationsRoute = MULTI_TENANT
    ? '/admin/configuration/integrations'
    : '/admin/settings/integrations';

  if (MULTI_TENANT) {
    const platformResponse = await page.goto(
      `${IDP_ORIGIN}/admin/settings/integrations`
    );
    expect(platformResponse?.status()).toBe(200);
    await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/configuration`);
  }

  const response = await page.goto(`${IDP_ORIGIN}${integrationsRoute}`);
  expect(response?.status()).toBe(200);
  await expect(
    page.locator('[onclick], [onsubmit], [onchange], [oninput]')
  ).toHaveCount(0);

  const testEmail = page.getByLabel('Test Email Address');
  await page.getByRole('button', { name: 'Send Test' }).click();
  const emptyEmailFeedback = MULTI_TENANT
    ? page.locator('#test-email-result')
    : page.getByRole('alert');
  await expect(emptyEmailFeedback).toContainText(
    MULTI_TENANT
      ? 'Please enter an email address.'
      : 'Please enter a test email address.'
  );
  if (!MULTI_TENANT) {
    await expect(testEmail).toBeFocused();
  }

  const resetCapture = await request.post(`${RP_ORIGIN}/smtp/reset`);
  expect(resetCapture.status()).toBe(204);
  const recipient = `phase2-integration-${DEPLOYMENT_CELL}@parako.test`;
  await testEmail.fill(recipient);

  const sendTestEmail = async () => {
    const responsePromise = page.waitForResponse(deliveryResponse => {
      const path = new URL(deliveryResponse.url()).pathname;
      return (
        path ===
        (MULTI_TENANT
          ? '/admin/configuration/integrations/test-email'
          : '/admin/settings/integrations/test-email')
      );
    });
    await page.getByRole('button', { name: 'Send Test' }).click();

    if (!MULTI_TENANT) {
      const testEmailDialog = page.getByRole('dialog', {
        name: 'Send Test Email',
      });
      await expect(testEmailDialog).toBeVisible();
      await testEmailDialog
        .getByRole('button', { name: 'Yes, Send Test' })
        .click();
    }

    return responsePromise;
  };

  const rejectDelivery = await request.post(`${RP_ORIGIN}/smtp/reject-next`);
  expect(rejectDelivery.status()).toBe(204);
  expect((await sendTestEmail()).status()).toBe(500);
  const failureFeedback = MULTI_TENANT
    ? page.locator('#test-email-result')
    : page.getByRole('alert').filter({ hasText: 'Failed to send test email' });
  await expect(failureFeedback).toContainText('Failed to send test email');
  await expect(page.getByRole('button', { name: 'Send Test' })).toBeEnabled();
  await expect.poll(() => failures.consoleErrors.length).toBe(1);
  expect(failures.consoleErrors).toEqual([
    expect.stringContaining(
      'Failed to load resource: the server responded with a status of 500'
    ),
  ]);
  failures.consoleErrors.length = 0;
  const rejectedMessages = await request.get(`${RP_ORIGIN}/smtp/messages`);
  expect(rejectedMessages.status()).toBe(200);
  expect(
    ((await rejectedMessages.json()) as { messages: unknown[] }).messages
  ).toHaveLength(0);

  expect((await sendTestEmail()).status()).toBe(200);
  const deliveryFeedback = MULTI_TENANT
    ? page.locator('#test-email-result')
    : page.getByRole('status');
  await expect(deliveryFeedback).toContainText('Test email sent successfully');

  await expect
    .poll(async () => {
      const messagesResponse = await request.get(`${RP_ORIGIN}/smtp/messages`);
      expect(messagesResponse.ok()).toBe(true);
      const payload = (await messagesResponse.json()) as {
        messages: Array<{ rcptTo: string[]; source: string }>;
      };
      return payload.messages.filter(message =>
        message.rcptTo.includes(recipient)
      ).length;
    })
    .toBe(1);

  const messagesResponse = await request.get(`${RP_ORIGIN}/smtp/messages`);
  const payload = (await messagesResponse.json()) as {
    messages: Array<{ rcptTo: string[]; source: string }>;
  };
  const delivered = payload.messages.find(message =>
    message.rcptTo.includes(recipient)
  );
  expect(delivered?.source).toContain('Test Email');

  const website = page.getByLabel('Website URL');
  const originalWebsite = await website.inputValue();
  const updatedWebsite = `https://integrations-${DEPLOYMENT_CELL}.parako.test`;
  let saved = false;

  try {
    await website.fill(updatedWebsite);

    if (!MULTI_TENANT) {
      const smtpHost = page.getByLabel('SMTP Host');
      const resetButton = page.getByRole('button', { name: 'Reset Form' });
      const unsavedSmtpHost = 'smtp.unsaved.parako.test';
      const originalSmtpHost = await smtpHost.inputValue();

      await smtpHost.fill(unsavedSmtpHost);
      await resetButton.click();
      const resetDialog = page.getByRole('dialog', { name: 'Reset Form' });
      await expect(resetDialog).toBeVisible();
      await resetDialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(smtpHost).toHaveValue(unsavedSmtpHost);

      await resetButton.click();
      await resetDialog
        .getByRole('button', { name: 'Yes, Reset Form' })
        .click();
      await expect(smtpHost).toHaveValue(originalSmtpHost);

      await website.fill(updatedWebsite);
      await page
        .getByLabel('Contact URL')
        .fill('https://integrations.parako.test/contact');
      await page
        .getByLabel('Privacy Policy URL')
        .fill('https://integrations.parako.test/privacy');
      await page
        .getByLabel('Terms of Service URL')
        .fill('https://integrations.parako.test/terms');
    }

    await page.getByRole('button', { name: 'Save Changes' }).click();

    if (!MULTI_TENANT) {
      const saveDialog = page.getByRole('dialog', {
        name: 'Confirm Integrations Configuration Changes',
      });
      await expect(saveDialog).toBeVisible();
      await saveDialog
        .getByRole('button', { name: 'Yes, Save Changes' })
        .click();
    }

    await expect(page).toHaveURL(`${IDP_ORIGIN}${integrationsRoute}`);
    saved = true;
    await expect(
      page.locator('.toast[data-toast-type="success"]')
    ).toContainText(
      MULTI_TENANT
        ? 'Integrations configuration updated successfully'
        : 'Integrations settings updated successfully'
    );
    await expect(website).toHaveValue(updatedWebsite);
    await page.reload();
    await expect(website).toHaveValue(updatedWebsite);
  } finally {
    if (saved) {
      if (MULTI_TENANT) {
        page.once('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: 'Reset to Defaults' }).click();
        await expect(page).toHaveURL(`${IDP_ORIGIN}${integrationsRoute}`);
      } else {
        await page.goto(`${IDP_ORIGIN}/admin/settings`);
        await page.getByRole('button', { name: 'History' }).click();
        const rollbackButton = page
          .getByRole('button', { name: 'Rollback', exact: true })
          .first();
        await rollbackButton.click();
        const rollbackDialog = page.getByRole('dialog', {
          name: /Rollback to v/,
        });
        await rollbackDialog
          .getByRole('button', { name: 'Rollback', exact: true })
          .click();
        await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/settings`);
        await page.goto(`${IDP_ORIGIN}${integrationsRoute}`);
      }

      await expect(website).toHaveValue(originalWebsite);
    }
  }

  expectNoBrowserFailures(failures);
});

test('notification defaults persist safely and expose only supported providers', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-notifications-configuration', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);

  const route = MULTI_TENANT
    ? '/admin/configuration/notifications'
    : '/admin/settings/integrations';
  const response = await page.goto(`${IDP_ORIGIN}${route}`);
  expect(response?.status()).toBe(200);

  const provider = page.locator(
    MULTI_TENANT
      ? '#sms_provider'
      : '[id="notifications.channels.sms.provider"]'
  );
  const supportedProviders = await provider
    .locator('option')
    .evaluateAll(options =>
      options.map(option => (option as HTMLOptionElement).value).filter(Boolean)
    );
  expect(supportedProviders).toEqual(['twilio']);

  const allowUserPreferences = page.locator(
    MULTI_TENANT
      ? '#defaults_allow_user_prefs'
      : '[id="notifications.defaults.allow_user_preferences"]'
  );
  const originallyAllowed = await allowUserPreferences.isChecked();
  let originalRateLimit = '';
  let updatedRateLimit = '';
  let saved = false;

  const save = async (): Promise<void> => {
    await page.getByRole('button', { name: 'Save Changes' }).click();
    if (!MULTI_TENANT) {
      const confirmation = page.getByRole('dialog', {
        name: 'Confirm Integrations Configuration Changes',
      });
      await expect(confirmation).toBeVisible();
      await confirmation
        .getByRole('button', { name: 'Yes, Save Changes' })
        .click();
    }
    await expect(page).toHaveURL(`${IDP_ORIGIN}${route}`);
  };

  try {
    await allowUserPreferences.setChecked(!originallyAllowed);

    if (MULTI_TENANT) {
      const rateLimit = page.getByLabel('Per Phone Per Hour');
      originalRateLimit = await rateLimit.inputValue();
      const minimum = Number((await rateLimit.getAttribute('min')) ?? '1');
      const maximum = Number((await rateLimit.getAttribute('max')) ?? '5');
      const originalNumber = Number(originalRateLimit);
      updatedRateLimit = String(
        Number.isFinite(originalNumber) && originalNumber !== minimum
          ? minimum
          : Math.min(maximum, minimum + 1)
      );
      await rateLimit.fill(updatedRateLimit);
    }

    await save();
    saved = true;
    await expect(
      page.locator('.toast[data-toast-type="success"]')
    ).toContainText(
      MULTI_TENANT
        ? 'Notifications configuration updated successfully'
        : 'Integrations settings updated successfully'
    );
    await expect(allowUserPreferences).toBeChecked({
      checked: !originallyAllowed,
    });
    if (MULTI_TENANT) {
      await expect(page.getByLabel('Per Phone Per Hour')).toHaveValue(
        updatedRateLimit
      );
    }

    await page.reload();
    await expect(allowUserPreferences).toBeChecked({
      checked: !originallyAllowed,
    });
    if (MULTI_TENANT) {
      await expect(page.getByLabel('Per Phone Per Hour')).toHaveValue(
        updatedRateLimit
      );
    } else {
      const exportedNotifications = await page.evaluate(async () => {
        const exportResponse = await fetch('/admin/settings/export');
        if (!exportResponse.ok) {
          throw new Error('Unable to export notification configuration');
        }
        const config = (await exportResponse.json()) as {
          notifications?: Record<string, unknown>;
        };
        return config.notifications;
      });

      expect(exportedNotifications).not.toHaveProperty('_csrf');
      expect(exportedNotifications).not.toHaveProperty('_deviceInfo');
      expect(exportedNotifications).toMatchObject({
        defaults: { allow_user_preferences: !originallyAllowed },
      });
    }
  } finally {
    if (saved) {
      if (MULTI_TENANT) {
        page.once('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: 'Reset to Defaults' }).click();
        await expect(page).toHaveURL(`${IDP_ORIGIN}${route}`);
      } else {
        await allowUserPreferences.setChecked(originallyAllowed);
        await save();
      }

      await expect(allowUserPreferences).toBeChecked({
        checked: originallyAllowed,
      });
      if (MULTI_TENANT) {
        await expect(page.getByLabel('Per Phone Per Hour')).toHaveValue(
          originalRateLimit
        );
      }
    }
  }

  expectNoBrowserFailures(failures);
});

test('configuration import is CSP-safe and remains platform-scoped', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-configuration-import', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);

  const importRoute = '/admin/settings/import';
  const response = await page.goto(`${IDP_ORIGIN}${importRoute}`);

  if (MULTI_TENANT) {
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/configuration`);
    await expect(
      page.getByRole('heading', { name: 'Import Configuration' })
    ).toHaveCount(0);
  } else {
    expect(response?.status()).toBe(200);
    await expect(
      page.locator('[onclick], [onsubmit], [onchange], [oninput]')
    ).toHaveCount(0);

    const json = page.getByLabel('Paste JSON Configuration');
    await page.getByRole('button', { name: 'Preview Changes' }).click();
    await expect(page.getByRole('alert')).toContainText(
      'Please provide a configuration JSON'
    );

    await page.getByLabel('Upload JSON File').setInputFiles({
      name: 'configuration.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        '{"application":{"description":"preview only"}}',
        'utf8'
      ),
    });
    await page.getByRole('button', { name: 'Load File' }).click();
    await expect(json).toHaveValue(/preview only/);

    await page.getByRole('button', { name: 'Preview Changes' }).click();
    await expect(page.locator('#previewSection')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Configuration Changes' })
    ).toBeVisible();

    await page.getByRole('button', { name: 'Apply Configuration' }).click();
    const confirmation = page.getByRole('dialog', {
      name: 'Apply Configuration Import',
    });
    await expect(confirmation).toBeVisible();
    await expect(
      confirmation.getByRole('button', { name: 'Cancel' })
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(confirmation).toBeHidden();
    await expect(page).toHaveURL(`${IDP_ORIGIN}${importRoute}`);

    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(json).toHaveValue('');
    await expect(page.locator('#previewSection')).toBeHidden();
  }

  expectNoBrowserFailures(failures);
});

test('a branding change reaches public metadata only for the addressed tenant', async ({
  browser,
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-branding', { role: 'admin' });
  await loginAsAdmin(page, admin);

  const response = await page.goto(`${IDP_ORIGIN}${BRANDING_ROUTE}`);
  expect(response?.status()).toBe(200);
  const companyNameInput = page.getByLabel('Company Name');
  const originalInputValue = await companyNameInput.inputValue();
  const companyName = `Phase 2 Brand ${DEPLOYMENT_CELL}`;

  const themeColors = page
    .getByRole('heading', { name: 'Theme Colors' })
    .locator('..');
  const colorPanels = themeColors.locator('[x-show]');
  const lightColors = colorPanels.nth(0);
  const darkColors = colorPanels.nth(1);
  await expect(lightColors).toBeVisible();
  await expect(darkColors).toBeHidden();
  await themeColors.getByRole('button', { name: 'Dark Mode' }).click();
  await expect(lightColors).toBeHidden();
  await expect(darkColors).toBeVisible();

  const darkColorPicker = darkColors.locator('input[type="color"]').first();
  const darkColorText = darkColors.locator('input[type="text"]').first();
  const originalDarkColor = await darkColorText.inputValue();
  await darkColorPicker.fill('#123456');
  await expect(darkColorText).toHaveValue('#123456');
  await darkColorText.fill(originalDarkColor);
  await themeColors.getByRole('button', { name: 'Light Mode' }).click();
  await expect(lightColors).toBeVisible();
  await expect(darkColors).toBeHidden();

  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  const publicFailures = observeBrowserFailures(publicPage);
  const siblingContext = MULTI_TENANT ? await browser.newContext() : undefined;
  const siblingPage = siblingContext
    ? await siblingContext.newPage()
    : undefined;
  const siblingFailures = siblingPage
    ? observeBrowserFailures(siblingPage)
    : undefined;

  try {
    await publicPage.goto(`${IDP_ORIGIN}/auth/login`);
    const originalPublicCompanyName = await publicPage
      .locator('meta[name="author"]')
      .getAttribute('content');

    let siblingCompanyName: string | null | undefined;
    if (siblingPage) {
      const siblingResponse = await siblingPage.goto(
        `${tenantOrigin(SIBLING_TENANT_ID)}/auth/login`
      );
      expect(siblingResponse?.status()).toBe(200);
      siblingCompanyName = await siblingPage
        .locator('meta[name="author"]')
        .getAttribute('content');
    }

    try {
      await companyNameInput.fill(companyName);
      await page.getByRole('button', { name: 'Save Changes' }).click();
      await expect(page).toHaveURL(`${IDP_ORIGIN}${BRANDING_ROUTE}`);
      await expect(
        page.locator('.toast[data-toast-type="success"]')
      ).toContainText(
        MULTI_TENANT
          ? 'Branding configuration updated successfully'
          : 'Branding settings updated successfully'
      );

      await publicPage.reload();
      await expect(publicPage.locator('meta[name="author"]')).toHaveAttribute(
        'content',
        companyName
      );

      if (siblingPage && siblingCompanyName !== undefined) {
        await siblingPage.reload();
        await expect(
          siblingPage.locator('meta[name="author"]')
        ).toHaveAttribute('content', siblingCompanyName ?? '');
      }
    } finally {
      await page.goto(`${IDP_ORIGIN}${BRANDING_ROUTE}`);
      if (MULTI_TENANT) {
        page.once('dialog', dialog => dialog.accept());
        await page
          .getByRole('button', { name: 'Reset All to Defaults' })
          .click();
        await expect(page).toHaveURL(`${IDP_ORIGIN}${BRANDING_ROUTE}`);
      } else {
        await companyNameInput.fill(originalInputValue);
        await page.getByRole('button', { name: 'Save Changes' }).click();
        await expect(page).toHaveURL(`${IDP_ORIGIN}${BRANDING_ROUTE}`);
      }
    }

    await publicPage.reload();
    await expect(publicPage.locator('meta[name="author"]')).toHaveAttribute(
      'content',
      originalPublicCompanyName ?? ''
    );
  } finally {
    await publicContext.close();
    await siblingContext?.close();
  }

  expectNoBrowserFailures(failures);
  expectNoBrowserFailures(publicFailures);
  if (siblingFailures) expectNoBrowserFailures(siblingFailures);
});

test('branding media is validated, served, isolated, removable, and restorable', async ({
  browser,
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-branding-media', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);
  await page.goto(`${IDP_ORIGIN}${BRANDING_ROUTE}`);

  const originalBranding = MULTI_TENANT
    ? undefined
    : await page.evaluate(async () => {
        const response = await fetch('/admin/settings/export');
        if (!response.ok) {
          throw new Error('Unable to export the original configuration');
        }
        const config = (await response.json()) as {
          branding: Record<string, unknown>;
        };
        return config.branding;
      });

  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  const publicFailures = observeBrowserFailures(publicPage);
  const siblingContext = MULTI_TENANT ? await browser.newContext() : undefined;
  const siblingPage = siblingContext
    ? await siblingContext.newPage()
    : undefined;
  const siblingFailures = siblingPage
    ? observeBrowserFailures(siblingPage)
    : undefined;

  const uploaded = {
    logo: false,
    logoDark: false,
    logoIcon: false,
    logoIconDark: false,
    favicon: false,
  };

  const removeAjaxAsset = async (
    buttonSelector: string,
    dialogName: string,
    field: keyof typeof uploaded
  ) => {
    await page.locator(buttonSelector).click();
    const dialog = page
      .getByRole('dialog', { name: dialogName, exact: true })
      .filter({ visible: true });
    await expect(dialog).toBeVisible();
    const removalResponse = page.waitForResponse(response => {
      const request = response.request();
      const pathname = new URL(response.url()).pathname;
      return (
        request.method() === 'DELETE' &&
        pathname.startsWith(`${BRANDING_ROUTE}/remove-`)
      );
    });
    await dialog.getByRole('button', { name: 'Remove' }).click();
    expect((await removalResponse).status()).toBe(200);
    await expect(dialog).toBeHidden();
    uploaded[field] = false;
  };

  try {
    await publicPage.goto(`${IDP_ORIGIN}/auth/login`);
    const originalPublicAssets = await readRenderedBrandingAssets(publicPage);

    let siblingAssets:
      Awaited<ReturnType<typeof readRenderedBrandingAssets>> | undefined;
    if (siblingPage) {
      await siblingPage.goto(`${tenantOrigin(SIBLING_TENANT_ID)}/auth/login`);
      siblingAssets = await readRenderedBrandingAssets(siblingPage);
    }

    await page.locator('#logo-dark-upload').setInputFiles({
      name: 'not-an-image.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not an image', 'utf8'),
    });
    const invalidDialog = page.getByRole('dialog', { name: 'Invalid File' });
    await expect(invalidDialog).toContainText(
      'Invalid file type. Allowed types:'
    );
    await invalidDialog.getByRole('button', { name: 'OK' }).click();
    await expect(page.locator('#logo-dark-upload')).toHaveValue('');

    const primaryUploadResponse = page.waitForResponse(response => {
      const request = response.request();
      return (
        request.method() === 'POST' &&
        new URL(response.url()).pathname === BRANDING_ROUTE
      );
    });
    await page.locator('#logo-upload').setInputFiles({
      name: 'phase2-logo.svg',
      mimeType: 'image/svg+xml',
      buffer: TEST_SVG,
    });
    expect((await primaryUploadResponse).status()).toBe(302);
    await expect(page).toHaveURL(`${IDP_ORIGIN}${BRANDING_ROUTE}`);
    uploaded.logo = true;
    await expectStoredAsset(page, '#preview-logo', 'src');

    const ajaxUploads = [
      {
        field: 'logoDark',
        input: '#logo-dark-upload',
        preview: '#preview-logo-dark',
        name: 'phase2-logo-dark.svg',
      },
      {
        field: 'logoIcon',
        input: '#logo-icon-upload',
        preview: '#preview-logo-icon',
        name: 'phase2-logo-icon.svg',
      },
      {
        field: 'logoIconDark',
        input: '#logo-icon-dark-upload',
        preview: '#preview-logo-icon-dark',
        name: 'phase2-logo-icon-dark.svg',
      },
      {
        field: 'favicon',
        input: '#favicon-upload',
        preview: '#preview-favicon',
        name: 'phase2-favicon.svg',
      },
    ] as const;

    for (const asset of ajaxUploads) {
      await page.locator(asset.input).setInputFiles({
        name: asset.name,
        mimeType: 'image/svg+xml',
        buffer: TEST_SVG,
      });
      uploaded[asset.field] = true;
      await expectStoredAsset(page, asset.preview, 'src');
    }

    await page.reload();
    const adminLight = await expectStoredAsset(page, '#preview-logo', 'src');
    const adminDark = await expectStoredAsset(
      page,
      '#preview-logo-dark',
      'src'
    );
    const adminIcon = await expectStoredAsset(
      page,
      '#preview-logo-icon',
      'src'
    );
    const adminIconDark = await expectStoredAsset(
      page,
      '#preview-logo-icon-dark',
      'src'
    );
    const sidebarExpanded = await page
      .locator('#sidebar')
      .evaluate(sidebar => sidebar.classList.contains('sidebar-expanded'));
    await expect(page.locator('#sidebar-logo-light')).toHaveAttribute(
      'src',
      sidebarExpanded ? adminLight : adminIcon
    );
    await expect(page.locator('#sidebar-logo-light')).toHaveAttribute(
      'data-rect',
      adminLight
    );
    await expect(page.locator('#sidebar-logo-light')).toHaveAttribute(
      'data-icon',
      adminIcon
    );
    await expect(page.locator('#sidebar-logo-dark')).toHaveAttribute(
      'src',
      sidebarExpanded ? adminDark : adminIconDark
    );
    await expect(page.locator('#sidebar-logo-dark')).toHaveAttribute(
      'data-rect',
      adminDark
    );
    await expect(page.locator('#sidebar-logo-dark')).toHaveAttribute(
      'data-icon',
      adminIconDark
    );

    await publicPage.reload();
    const publicLogos = publicPage.locator('img[alt$=" Logo"]');
    await expect(publicLogos).toHaveCount(2);
    const publicLight = await expectStoredAsset(
      publicPage,
      'img[alt$=" Logo"]:nth-of-type(1)',
      'src'
    );
    const publicDark = await expectStoredAsset(
      publicPage,
      'img[alt$=" Logo"]:nth-of-type(2)',
      'src'
    );
    const publicFavicon = await expectStoredAsset(
      publicPage,
      'link[rel="icon"]',
      'href'
    );
    expect(assetPath(publicLight)).toBe(assetPath(adminLight));
    expect(assetPath(publicDark)).toBe(assetPath(adminDark));
    expect(publicFavicon).toContain('/media/file/');

    if (siblingPage && siblingAssets) {
      await siblingPage.reload();
      const currentSiblingAssets =
        await readRenderedBrandingAssets(siblingPage);
      expect(currentSiblingAssets).toEqual(siblingAssets);
    }

    await removeAjaxAsset(
      '#remove-logo-dark-button',
      'Remove Dark Logo',
      'logoDark'
    );
    await removeAjaxAsset(
      '#remove-logo-icon-button',
      'Remove Icon Logo',
      'logoIcon'
    );
    await removeAjaxAsset(
      '#remove-logo-icon-dark-button',
      'Remove Dark Icon Logo',
      'logoIconDark'
    );
    await removeAjaxAsset(
      '#remove-favicon-button',
      'Remove Favicon',
      'favicon'
    );

    await page.locator('#remove-logo-button').click();
    const removeLogoDialog = page
      .getByRole('dialog', {
        name: 'Remove Logo',
        exact: true,
      })
      .filter({ visible: true });
    await expect(removeLogoDialog).toBeVisible();
    const primaryRemovalResponse = page.waitForResponse(response => {
      const request = response.request();
      return (
        request.method() === 'DELETE' &&
        new URL(response.url()).pathname === `${BRANDING_ROUTE}/remove-logo`
      );
    });
    await removeLogoDialog.getByRole('button', { name: 'Remove' }).click();
    expect((await primaryRemovalResponse).status()).toBe(200);
    await expect(page.locator('#preview-logo')).toBeHidden();
    uploaded.logo = false;

    await publicPage.reload();
    const removedPublicAssets = await readRenderedBrandingAssets(publicPage);
    if (MULTI_TENANT) {
      expect(removedPublicAssets).toEqual(originalPublicAssets);
    } else {
      expect(removedPublicAssets).toEqual({
        logos: [],
        favicon: '/favicon.png',
      });
    }
  } finally {
    await page.goto(`${IDP_ORIGIN}${BRANDING_ROUTE}`);

    const cleanupAjax = async (
      field: keyof typeof uploaded,
      buttonSelector: string,
      dialogName: string
    ) => {
      if (!uploaded[field]) return;
      await removeAjaxAsset(buttonSelector, dialogName, field);
    };

    await cleanupAjax(
      'logoDark',
      '#remove-logo-dark-button',
      'Remove Dark Logo'
    );
    await cleanupAjax(
      'logoIcon',
      '#remove-logo-icon-button',
      'Remove Icon Logo'
    );
    await cleanupAjax(
      'logoIconDark',
      '#remove-logo-icon-dark-button',
      'Remove Dark Icon Logo'
    );
    await cleanupAjax('favicon', '#remove-favicon-button', 'Remove Favicon');

    if (uploaded.logo) {
      const cleanupRemoval = await page.evaluate(async route => {
        const csrfToken =
          document
            .querySelector<HTMLMetaElement>('meta[name="csrf-token"]')
            ?.getAttribute('content') ?? '';
        const response = await fetch(`${route}/remove-logo`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
        });
        return response.status;
      }, BRANDING_ROUTE);
      expect(cleanupRemoval).toBe(200);
      uploaded.logo = false;
    }

    if (MULTI_TENANT) {
      await page.goto(`${IDP_ORIGIN}${BRANDING_ROUTE}`);
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: 'Reset All to Defaults' }).click();
      await expect(page).toHaveURL(`${IDP_ORIGIN}${BRANDING_ROUTE}`);
    } else if (originalBranding) {
      const restored = await page.evaluate(async branding => {
        const csrfToken =
          document
            .querySelector<HTMLMetaElement>('meta[name="csrf-token"]')
            ?.getAttribute('content') ?? '';
        const response = await fetch('/admin/settings/import/apply', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          body: JSON.stringify({ config: { branding } }),
        });
        return {
          status: response.status,
          body: await response.json(),
        };
      }, originalBranding);
      expect(restored.status).toBe(200);
      expect(restored.body).toMatchObject({ success: true });
    }

    await publicContext.close();
    await siblingContext?.close();
  }

  expectNoBrowserFailures(failures);
  expectNoBrowserFailures(publicFailures);
  if (siblingFailures) expectNoBrowserFailures(siblingFailures);
});
