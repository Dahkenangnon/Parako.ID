import { expect, type Page } from '@playwright/test';

import { IDP_ORIGIN } from './management-api.js';

/**
 * Reads the opaque Express session identifier from Parako's signed browser
 * cookie. Test controls use the identifier only to advance persisted expiry;
 * browser journeys still exercise Parako's real authentication middleware.
 */
export async function currentSessionId(page: Page): Promise<string> {
  const sessionCookie = (await page.context().cookies(IDP_ORIGIN)).find(
    cookie => cookie.name === 'application_session'
  );
  expect(sessionCookie, 'Parako browser session cookie').toBeDefined();

  const signedValue = decodeURIComponent(sessionCookie!.value);
  const unsignedValue = signedValue.startsWith('s:')
    ? signedValue.slice(2)
    : signedValue;
  const signatureSeparator = unsignedValue.lastIndexOf('.');
  expect(signatureSeparator, 'signed session cookie separator').toBeGreaterThan(
    0
  );
  return unsignedValue.slice(0, signatureSeparator);
}
