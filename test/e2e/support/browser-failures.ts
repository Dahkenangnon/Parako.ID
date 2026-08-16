import { expect, type Page } from '@playwright/test';

export interface BrowserRequestFailure {
  method: string;
  url: string;
  resourceType: string;
  errorText: string;
}

export interface BrowserFailures {
  consoleErrors: string[];
  failedAssets: string[];
  failedRequests: string[];
  pageErrors: string[];
}

const requestFailureDetails = new WeakMap<
  BrowserFailures,
  BrowserRequestFailure[]
>();

export function observeBrowserFailures(page: Page): BrowserFailures {
  const failures: BrowserFailures = {
    consoleErrors: [],
    failedAssets: [],
    failedRequests: [],
    pageErrors: [],
  };
  const failedRequestDetails: BrowserRequestFailure[] = [];
  requestFailureDetails.set(failures, failedRequestDetails);

  page.on('pageerror', error => failures.pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') failures.consoleErrors.push(message.text());
  });
  page.on('requestfailed', request => {
    failures.failedRequests.push(`${request.method()} ${request.url()}`);
    failedRequestDetails.push({
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
      errorText: request.failure()?.errorText ?? 'unknown',
    });
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

export interface BrowserFailureExpectations {
  allowedFailedRequests?: readonly BrowserRequestFailure[];
}

function isSameRequestFailure(
  actual: BrowserRequestFailure,
  expected: BrowserRequestFailure
): boolean {
  return (
    actual.method === expected.method &&
    actual.url === expected.url &&
    actual.resourceType === expected.resourceType &&
    actual.errorText === expected.errorText
  );
}

export function expectNoBrowserFailures(
  failures: BrowserFailures,
  { allowedFailedRequests = [] }: BrowserFailureExpectations = {}
): void {
  const unmatchedAllowedRequests = [...allowedFailedRequests];
  const failedRequestDetails = requestFailureDetails.get(failures) ?? [];
  const unexpectedFailedRequests = failures.failedRequests.filter(
    (_, index) => {
      const failure = failedRequestDetails[index];
      if (!failure) return true;
      const matchIndex = unmatchedAllowedRequests.findIndex(expected =>
        isSameRequestFailure(failure, expected)
      );
      if (matchIndex === -1) return true;

      // Consume each allowance once so repeated transport failures remain visible.
      unmatchedAllowedRequests.splice(matchIndex, 1);
      return false;
    }
  );

  expect({
    ...failures,
    failedRequests: unexpectedFailedRequests,
  }).toEqual({
    consoleErrors: [],
    failedAssets: [],
    failedRequests: [],
    pageErrors: [],
  });
}
