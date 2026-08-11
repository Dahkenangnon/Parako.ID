import { expect, test } from '@playwright/test';
import { createLocalJWKSet, jwtVerify } from 'jose';

import {
  completeOidcInteraction,
  IDP_ORIGIN,
  reachOidcConsent,
  RP_ORIGIN,
} from './support/browser-oidc.js';
import { createLoopbackTenantFetch } from './support/loopback-tenant-fetch.js';
const USER_EMAIL = 'browser-e2e@example.test';
const USER_PASSWORD = 'Violet!River7';
const nodeFetch = createLoopbackTenantFetch(IDP_ORIGIN);

test('runs Authorization Code + PKCE and RP-initiated logout end to end', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto(`${IDP_ORIGIN}/auth/register`);
  await expect(page.locator('#fullname')).toBeVisible();
  expect(await page.locator('link[rel="stylesheet"]').count()).toBeGreaterThan(
    0
  );
  await expect(page.locator('#submit-btn')).not.toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)'
  );

  await page.locator('#fullname').fill('Browser E2E User');
  await page.locator('#email').fill(USER_EMAIL);
  await page.locator('#password').fill(USER_PASSWORD);
  await page.locator('#submit-btn').click();
  await expect(page).toHaveURL(/\/accounts(?:\/|\?|$)/);

  await page.goto('/');
  await page.getByTestId('rp-login').click();
  await expect(page).toHaveURL(new RegExp(`^${IDP_ORIGIN}/oidc/v1/`));

  await completeOidcInteraction(page, {
    identifier: USER_EMAIL,
    password: USER_PASSWORD,
  });

  await expect(page).toHaveURL(`${RP_ORIGIN}/`);
  await expect(page.getByTestId('rp-authenticated')).toBeVisible();
  await expect(page.getByTestId('rp-email')).toHaveText(USER_EMAIL);
  await expect(page.getByTestId('rp-subject')).not.toBeEmpty();
  await expect(page.getByTestId('rp-id-token')).toHaveText('present');
  await expect(page.getByTestId('rp-refresh-token')).toHaveText('present');

  await page.getByTestId('rp-refresh').click();
  await expect(page.getByTestId('rp-refresh-rotated')).toHaveText('yes');

  await page.getByTestId('rp-introspect').click();
  await expect(page.getByTestId('rp-token-active')).toHaveText('true');

  await page.getByTestId('rp-replay-refresh').click();
  await expect(page.getByTestId('rp-refresh-replay-rejected')).toHaveText(
    'yes'
  );

  await page.getByTestId('rp-introspect').click();
  await expect(page.getByTestId('rp-token-active')).toHaveText('false');

  await page.getByTestId('rp-revoke').click();
  await expect(page.getByTestId('rp-token-active')).toHaveText('false');

  await page.getByTestId('rp-replay-code').click();
  await expect(page.getByTestId('rp-code-replay-rejected')).toHaveText('yes');

  await page.getByTestId('rp-logout').click();
  await expect(page).toHaveURL(new RegExp(`^${IDP_ORIGIN}/oidc/v1/`));
  await page.getByRole('button', { name: 'Yes, Sign Out' }).click();

  await expect(page).toHaveURL(new RegExp(`^${RP_ORIGIN}/\\?state=`));
  await expect(page.getByTestId('rp-anonymous')).toBeVisible();

  await page.getByTestId('rp-login').click();
  await expect(page.locator('#login')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('delivers a signed back-channel logout token for an active RP session', async ({
  page,
}) => {
  const email = 'backchannel-logout-e2e@example.test';
  await fetch(`${RP_ORIGIN}/backchannel-reset`, {
    method: 'POST',
  });

  const discovery = await nodeFetch(
    `${IDP_ORIGIN}/oidc/v1/.well-known/openid-configuration`
  ).then(response => response.json());
  expect(discovery.backchannel_logout_supported).toBe(true);
  expect(discovery.backchannel_logout_session_supported).toBe(true);

  await page.goto(`${IDP_ORIGIN}/auth/register`);
  await page.locator('#fullname').fill('Back-channel Logout E2E User');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(USER_PASSWORD);
  await page.locator('#submit-btn').click();
  await expect(page).toHaveURL(/\/accounts(?:\/|\?|$)/);

  await page.goto(`${RP_ORIGIN}/login?prompt=consent`);
  await completeOidcInteraction(page, {
    identifier: email,
    password: USER_PASSWORD,
  });

  await expect(page).toHaveURL(`${RP_ORIGIN}/`);
  await expect(page.getByTestId('rp-id-token')).toHaveText('present');
  await page.getByTestId('rp-logout').click();
  await page.getByRole('button', { name: 'Yes, Sign Out' }).click();
  await expect(page).toHaveURL(new RegExp(`^${RP_ORIGIN}/\\?state=`));

  await expect
    .poll(async () =>
      fetch(`${RP_ORIGIN}/backchannel-status`)
        .then(response => response.json())
        .then(status => status.tokens.length)
    )
    .toBe(1);

  const logoutStatus = await fetch(`${RP_ORIGIN}/backchannel-status`).then(
    response => response.json()
  );
  const jwks = await nodeFetch(discovery.jwks_uri).then(response =>
    response.json()
  );
  const { payload: logoutClaims } = await jwtVerify(
    logoutStatus.tokens[0],
    createLocalJWKSet(jwks),
    {
      issuer: `${IDP_ORIGIN}/oidc/v1`,
      audience: 'parako-browser-e2e-rp',
    }
  );
  expect(logoutClaims.events).toEqual({
    'http://schemas.openid.net/event/backchannel-logout': {},
  });
  expect(logoutClaims.sid).toEqual(expect.any(String));
  expect(logoutClaims.jti).toEqual(expect.any(String));
});

test('returns access_denied to the RP when the user rejects consent', async ({
  page,
}) => {
  const email = 'consent-denial-e2e@example.test';

  await page.goto(`${IDP_ORIGIN}/auth/register`);
  await page.locator('#fullname').fill('Consent Denial E2E User');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(USER_PASSWORD);
  await page.locator('#submit-btn').click();
  await expect(page).toHaveURL(/\/accounts(?:\/|\?|$)/);

  await page.goto(`${RP_ORIGIN}/login?prompt=consent`);
  await expect(
    await reachOidcConsent(page, {
      identifier: email,
      password: USER_PASSWORD,
    })
  ).toBeVisible();
  await page.getByRole('link', { name: 'Cancel' }).click();

  await expect(page).toHaveURL(new RegExp(`${RP_ORIGIN}/callback\\?`));
  await expect(page.getByTestId('rp-authorization-error-code')).toHaveText(
    'access_denied'
  );
  await expect(page.getByTestId('rp-authenticated')).toHaveCount(0);
});
