import { expect, type Page } from '@playwright/test';

export async function fillOtp(page: Page, code: string): Promise<void> {
  expect(code).toMatch(/^\d{6}$/);

  // OTP controllers attach on DOMContentLoaded. URL assertions can complete
  // before that event, so wait for the component before entering the code.
  await page.waitForLoadState('domcontentloaded');

  const inputs = page.locator('.otp-input');
  await expect(inputs).toHaveCount(6);
  for (const [index, digit] of [...code].entries()) {
    await inputs.nth(index).fill(digit);
  }
  await expect(page.locator('#code')).toHaveValue(code);
}
