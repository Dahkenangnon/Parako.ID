import { expect, type Locator, type Page } from '@playwright/test';

export const IDP_ORIGIN =
  process.env.PARAKO_E2E_IDP_ORIGIN ?? 'http://127.0.0.1:19007';
export const RP_ORIGIN = 'http://127.0.0.1:19010';

export type OidcLoginCredentials = {
  identifier: string;
  password: string;
};

type InteractionState = 'complete' | 'consent' | 'login' | 'pending';

async function interactionState(page: Page): Promise<InteractionState> {
  if (!page.url().includes('/oidc/v1/interaction/')) return 'complete';
  if (await page.locator('#login').isVisible()) return 'login';
  if (await page.locator('#consent-submit-btn').isVisible()) return 'consent';
  return 'pending';
}

async function waitForInteractionState(
  page: Page,
  accepted: readonly InteractionState[]
): Promise<InteractionState> {
  let state: InteractionState = 'pending';
  await expect
    .poll(async () => {
      state = await interactionState(page);
      return accepted.includes(state);
    })
    .toBe(true);
  return state;
}

async function submitLogin(
  page: Page,
  credentials: OidcLoginCredentials
): Promise<void> {
  await page.locator('#login').fill(credentials.identifier);
  await page.locator('#password').fill(credentials.password);
  await page
    .locator('#login-form')
    .getByRole('button', { name: /sign in/i })
    .click();

  // A successful login ends this prompt and may immediately create a consent
  // interaction. Wait for that state transition so the next loop iteration
  // cannot observe and resubmit the stale login form during redirect.
  await expect
    .poll(async () => (await interactionState(page)) !== 'login')
    .toBe(true);
}

/**
 * Drive the browser through every interaction prompt until oidc-provider
 * returns control to the relying party. The polling is intentional: one
 * interaction can end and be replaced by the next prompt after navigation.
 */
export async function completeOidcInteraction(
  page: Page,
  credentials: OidcLoginCredentials
): Promise<void> {
  for (let step = 0; step < 4; step += 1) {
    const state = await waitForInteractionState(page, [
      'complete',
      'consent',
      'login',
    ]);
    if (state === 'complete') return;
    if (state === 'login') {
      await submitLogin(page, credentials);
      continue;
    }
    await page.locator('#consent-submit-btn').click();
    // As with login, oidc-provider finishes the current interaction through a
    // redirect. Do not let the loop click a stale consent form a second time.
    await expect
      .poll(async () => (await interactionState(page)) !== 'consent')
      .toBe(true);
  }

  throw new Error(`OIDC interaction did not complete: ${page.url()}`);
}

/** Reach the consent prompt without accepting it, for denial/error journeys. */
export async function reachOidcConsent(
  page: Page,
  credentials: OidcLoginCredentials
): Promise<Locator> {
  for (let step = 0; step < 3; step += 1) {
    const state = await waitForInteractionState(page, ['consent', 'login']);
    if (state === 'consent') return page.locator('#consent-form');
    await submitLogin(page, credentials);
  }

  throw new Error(`OIDC consent prompt was not reached: ${page.url()}`);
}
