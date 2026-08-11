import { expect, test, type Page } from '@playwright/test';

import {
  createManagedUser,
  IDP_ORIGIN,
  type ManagedUserFixture,
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
    if (
      response.status() >= 400 &&
      ['stylesheet', 'script', 'image', 'font'].includes(
        response.request().resourceType()
      )
    ) {
      failedAssets.push(`${response.status()} ${response.url()}`);
    }
  });

  return { pageErrors, consoleErrors, failedRequests, failedAssets };
}

async function login(page: Page, user: ManagedUserFixture) {
  await page.goto(`${IDP_ORIGIN}/auth/login`);
  await page.locator('#login').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);
}

async function logout(page: Page) {
  await page.goto(`${IDP_ORIGIN}/auth/logout`);
  await page.locator('form[action="/auth/logout"]').getByRole('button').click();
  await expect(
    page.getByRole('heading', { name: /signed out/i })
  ).toBeVisible();
}

async function chooseSecurityQuestionRecovery(page: Page, identifier: string) {
  await page.goto(`${IDP_ORIGIN}/auth/account-recovery`);
  await page.locator('#identifier').fill(identifier);
  await page.locator('#recovery-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/recovery-method-select`);
  await page
    .locator(
      'form:has(input[name="method"][value="security_questions"]) button[type="submit"]'
    )
    .click();
  await expect(page).toHaveURL(
    `${IDP_ORIGIN}/auth/recovery-security-questions`
  );
}

async function submitAnswers(page: Page, answers: readonly string[]) {
  const inputs = page.locator('input[name="answers[]"]');
  await expect(inputs).toHaveCount(answers.length);
  for (const [index, answer] of answers.entries()) {
    await inputs.nth(index).fill(answer);
  }
  await page.locator('#submit-btn').click();
}

test('sets up, uses, and removes distinct questions after rejecting wrong answers', async ({
  page,
}) => {
  const user = await createManagedUser('public-security-question-recovery');
  const failures = observeBrowserFailures(page);
  const answers = ['Porto-Novo', 'Maria', 'Parako'];

  await login(page, user);
  await page.goto(`${IDP_ORIGIN}/accounts/security-questions/setup`);

  // The browser must prevent a duplicate-question setup before any request is
  // sent, while the server remains authoritative for the saved configuration.
  await page.locator('#question_1').selectOption('q1');
  await page.locator('#question_2').selectOption('q1');
  await page.locator('#question_3').selectOption('q1');
  await page.locator('#answer_1').fill(answers[0]!);
  await page.locator('#answer_2').fill(answers[1]!);
  await page.locator('#answer_3').fill(answers[2]!);
  await page.locator('#security-questions-form button[type="submit"]').click();
  await expect(page).toHaveURL(
    `${IDP_ORIGIN}/accounts/security-questions/setup`
  );
  await expect(page.locator('#validation-errors')).toBeVisible();

  await page.locator('#question_2').selectOption('q2');
  await page.locator('#question_3').selectOption('q3');
  await page.locator('#security-questions-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/settings/recovery`);
  await expect(
    page.getByText(/security questions have been set up successfully/i)
  ).toBeVisible();

  await page.goto(`${IDP_ORIGIN}/accounts/security-questions/setup`);
  await expect(page.locator('#question_1')).toHaveValue('q1');
  await expect(page.locator('#question_2')).toHaveValue('q2');
  await expect(page.locator('#question_3')).toHaveValue('q3');

  await logout(page);
  await chooseSecurityQuestionRecovery(page, user.email);
  await submitAnswers(page, [
    'Incorrect one',
    'Incorrect two',
    'Incorrect three',
  ]);
  await expect(page.getByText(/answer\(s\) are incorrect/i)).toBeVisible();
  await expect(page.getByText(/2.*attempts remaining/i)).toBeVisible();

  await submitAnswers(page, answers);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);
  await expect(page.getByText(/account recovered successfully/i)).toBeVisible();

  await logout(page);
  await chooseSecurityQuestionRecovery(page, user.email);
  await submitAnswers(page, answers);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);

  await page.goto(`${IDP_ORIGIN}/accounts/settings/recovery`);
  const removeQuestions = page.locator(
    'form[action="/accounts/disable-recovery?method=security_questions"]'
  );
  await expect(removeQuestions).toBeVisible();
  await removeQuestions.locator('button[type="submit"]').click();
  const removeDialog = page.getByRole('dialog', {
    name: 'Remove Security Questions',
  });
  await expect(removeDialog).toBeVisible();
  await Promise.all([
    page.waitForNavigation(),
    removeDialog.getByRole('button', { name: 'Confirm' }).click(),
  ]);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/settings/recovery`);
  await expect(
    page.locator('a[href="/accounts/security-questions/setup"].inline-flex')
  ).toBeVisible();

  expect(failures).toEqual({
    pageErrors: [],
    consoleErrors: [],
    failedRequests: [],
    failedAssets: [],
  });
});

test('locks security-question recovery after the configured failed attempts', async ({
  page,
}) => {
  const user = await createManagedUser('public-security-question-lockout');
  const failures = observeBrowserFailures(page);

  await login(page, user);
  await page.goto(`${IDP_ORIGIN}/accounts/security-questions/setup`);
  await page.locator('#question_1').selectOption('q1');
  await page.locator('#question_2').selectOption('q2');
  await page.locator('#question_3').selectOption('q3');
  await page.locator('#answer_1').fill('Porto-Novo');
  await page.locator('#answer_2').fill('Maria');
  await page.locator('#answer_3').fill('Parako');
  await page.locator('#security-questions-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/settings/recovery`);

  await logout(page);
  await chooseSecurityQuestionRecovery(page, user.email);

  for (const remainingAttempts of [2, 1]) {
    await submitAnswers(page, [
      `Incorrect ${remainingAttempts}a`,
      `Incorrect ${remainingAttempts}b`,
      `Incorrect ${remainingAttempts}c`,
    ]);
    await expect(
      page.getByText(
        new RegExp(`${remainingAttempts}.*attempts remaining`, 'i')
      )
    ).toBeVisible();
  }

  await submitAnswers(page, ['Incorrect 0a', 'Incorrect 0b', 'Incorrect 0c']);
  await expect(page.getByText(/too many attempts/i).first()).toBeVisible();
  await expect(page.locator('#security-questions-form')).toHaveCount(0);

  await page.reload();
  await expect(page.getByText(/too many attempts/i).first()).toBeVisible();
  await expect(page.locator('#security-questions-form')).toHaveCount(0);

  expect(failures).toEqual({
    pageErrors: [],
    consoleErrors: [],
    failedRequests: [],
    failedAssets: [],
  });
});
