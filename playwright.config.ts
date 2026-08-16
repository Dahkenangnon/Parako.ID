import { defineConfig } from '@playwright/test';
import { applyTestingEnvironment } from './scripts/testing/environment.js';

import {
  E2E_PROFILES,
  parseE2eCellId,
  parseE2eProfile,
  resolveE2eCell,
  SELF_STARTING_SPECS,
} from './test/e2e/config/matrix.js';

applyTestingEnvironment(import.meta.dirname);

const selectedProfile = parseE2eProfile(process.env.PARAKO_E2E_PROFILE);
const selfStarting = selectedProfile === 'self-starting';
const profile = selfStarting ? undefined : E2E_PROFILES[selectedProfile];

if (!selfStarting) {
  const cell = resolveE2eCell(
    parseE2eCellId(process.env.PARAKO_E2E_CELL),
    process.env.PARAKO_E2E_POSTGRESQL_URL
  );
  Object.assign(process.env, cell.environment, profile?.environment);
}

export default defineConfig({
  testDir: './test/e2e',
  testMatch: selfStarting ? [...SELF_STARTING_SPECS] : profile?.testMatch,
  testIgnore: selfStarting ? undefined : profile?.testIgnore,
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:19010',
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: selfStarting
    ? undefined
    : {
        command: 'node test/e2e/support/start-environment.mjs',
        url: 'http://127.0.0.1:19010/health',
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
});
