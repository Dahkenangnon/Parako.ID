import { expect, type Page } from '@playwright/test';

export interface BrowserFailures {
  consoleErrors: string[];
  failedAssets: string[];
  failedRequests: string[];
  pageErrors: string[];
}

export function observeBrowserFailures(page: Page): BrowserFailures {
  const failures: BrowserFailures = {
    consoleErrors: [],
    failedAssets: [],
    failedRequests: [],
    pageErrors: [],
  };

  page.on('pageerror', error => failures.pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') failures.consoleErrors.push(message.text());
  });
  page.on('requestfailed', request => {
    failures.failedRequests.push(`${request.method()} ${request.url()}`);
  });
  page.on('response', response => {
    if (
      response.status() >= 400 &&
      ['stylesheet', 'script', 'image', 'font'].includes(
        response.request().resourceType()
      )
    ) {
      failures.failedAssets.push(`${response.status()} ${response.url()}`);
    }
  });

  return failures;
}

export function expectNoBrowserFailures(failures: BrowserFailures): void {
  expect(failures).toEqual({
    consoleErrors: [],
    failedAssets: [],
    failedRequests: [],
    pageErrors: [],
  });
}
