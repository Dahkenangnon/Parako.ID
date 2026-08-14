import { expect, test, type Page } from '@playwright/test';

import {
  apiRequest,
  IDP_ORIGIN,
  issueManagementToken,
} from './support/management-api.js';

function observeBrowserFailures(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const failedAssets: string[] = [];

  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', request => {
    failedRequests.push(`${request.method()} ${request.url()}`);
  });
  page.on('response', response => {
    const request = response.request();
    if (
      response.status() >= 400 &&
      ['stylesheet', 'script', 'image', 'font'].includes(request.resourceType())
    ) {
      failedAssets.push(`${response.status()} ${request.url()}`);
    }
  });

  return { pageErrors, consoleErrors, failedRequests, failedAssets };
}

async function expectStyledPage(page: Page) {
  await expect(page.locator('main')).toBeVisible();
  const stylesheets = page.locator('link[rel="stylesheet"]');
  expect(await stylesheets.count()).toBeGreaterThanOrEqual(2);
  await expect
    .poll(
      async () =>
        await page.evaluate(
          () =>
            Array.from(document.styleSheets).filter(sheet => sheet.href).length
        )
    )
    .toBeGreaterThanOrEqual(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
}

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'narrow', width: 390, height: 844 },
]) {
  test(`login and registration are styled and usable at ${viewport.name} width`, async ({
    page,
  }) => {
    const failures = observeBrowserFailures(page);
    await page.setViewportSize(viewport);

    await page.goto(`${IDP_ORIGIN}/auth/login`);
    await expectStyledPage(page);
    await expect(page.locator('#login')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();

    await page.goto(`${IDP_ORIGIN}/auth/register`);
    await expectStyledPage(page);
    await expect(page.locator('#fullname')).toBeVisible();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('#submit-btn')).toBeVisible();
    await expect(page.locator('#submit-btn')).not.toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)'
    );

    expect(failures).toEqual({
      pageErrors: [],
      consoleErrors: [],
      failedRequests: [],
      failedAssets: [],
    });
  });
}

test('the public locale selector works under the strict script policy', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  await page.goto(`${IDP_ORIGIN}/auth/login`);

  const selector = page.getByLabel('Language');
  await expect(selector).toHaveValue('en');
  await expect(page.locator('[onchange]')).toHaveCount(0);

  const localeResponse = page.waitForResponse(response =>
    response.url().endsWith('/auth/update-locale')
  );
  await selector.selectOption('fr');
  expect((await localeResponse).status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.getByLabel('Language')).toHaveValue('fr');

  expect(failures).toEqual({
    pageErrors: [],
    consoleErrors: [],
    failedRequests: [],
    failedAssets: [],
  });
});

test('root, locale, and not-found routes preserve browser rendering contracts', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);

  await page.goto(IDP_ORIGIN);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/login`);

  await page.goto(`${IDP_ORIGIN}/fr`);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/fr/auth/login`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expectStyledPage(page);

  expect(failures).toEqual({
    pageErrors: [],
    consoleErrors: [],
    failedRequests: [],
    failedAssets: [],
  });

  const response = await page.goto(`${IDP_ORIGIN}/route-that-does-not-exist`);
  expect(response?.status()).toBe(404);
  await expectStyledPage(page);
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Page Not Found' })
  ).toBeVisible();

  expect(failures.pageErrors).toEqual([]);
  expect(failures.failedRequests).toEqual([]);
  expect(failures.failedAssets).toEqual([]);
  expect(failures.consoleErrors).toEqual([
    'Failed to load resource: the server responded with a status of 404 (Not Found)',
  ]);

  const unknownApiPath = '/route-that-does-not-exist';
  const anonymousApiResponse = await apiRequest(unknownApiPath);
  expect(anonymousApiResponse.status).toBe(401);
  expect(anonymousApiResponse.headers.get('content-type')).toContain(
    'application/problem+json'
  );

  const managementToken = await issueManagementToken('parako:stats:read');
  for (const method of ['GET', 'POST'] as const) {
    const apiResponse = await apiRequest(unknownApiPath, {
      method,
      token: managementToken,
    });
    expect(apiResponse.status).toBe(404);
    expect(apiResponse.headers.get('content-type')).toContain(
      'application/problem+json'
    );
    await expect(apiResponse.json()).resolves.toMatchObject({
      type: 'urn:parako:error:not-found',
      title: 'Resource Not Found',
      status: 404,
      instance: '/route-that-does-not-exist',
    });
  }
});
