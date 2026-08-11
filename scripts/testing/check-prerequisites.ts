import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';
import { Client } from 'pg';

import { assertDevelopmentRuntimeVersions } from '../setup-development.ts';

export interface PrerequisiteInputs {
  root: string;
  nodeVersion: string;
  pnpmVersion: string;
  full: boolean;
  postgresqlUrl?: string;
  probeBrowser?: () => Promise<void>;
  probePostgresql?: (url: string) => Promise<void>;
}

function validatePostgresqlUrl(value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error(
      'PARAKO_E2E_POSTGRESQL_URL is required for full verification'
    );
  }
  try {
    const url = new URL(value);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      url.pathname.length <= 1
    ) {
      throw new Error('invalid PostgreSQL URL');
    }
  } catch {
    throw new Error(
      'PARAKO_E2E_POSTGRESQL_URL must be a valid PostgreSQL administrator URL'
    );
  }
  return value;
}

async function connectToPostgresql(url: string): Promise<void> {
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    await client.query('SELECT 1');
  } finally {
    await client.end();
  }
}

async function launchChrome(): Promise<void> {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  await browser.close();
}

export async function collectPrerequisiteFailures({
  root,
  nodeVersion,
  pnpmVersion,
  full,
  postgresqlUrl,
  probeBrowser = launchChrome,
  probePostgresql = connectToPostgresql,
}: PrerequisiteInputs): Promise<string[]> {
  const failures: string[] = [];

  try {
    assertDevelopmentRuntimeVersions(nodeVersion, pnpmVersion);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  if (!existsSync(resolve(root, 'node_modules/@prisma/client/default.js'))) {
    failures.push(
      'Generated Prisma client is missing; run pnpm install or pnpm setup:dev'
    );
  }

  try {
    await probeBrowser();
  } catch (error) {
    failures.push(
      `Playwright Chrome prerequisite failed: ${error instanceof Error ? error.message : String(error)}. Run pnpm exec playwright install chrome`
    );
  }

  if (full) {
    try {
      await probePostgresql(validatePostgresqlUrl(postgresqlUrl));
    } catch (error) {
      failures.push(
        `PostgreSQL prerequisite failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return failures;
}

function installedPnpmVersion(): string {
  const result = spawnSync('pnpm', ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) return '';
  return result.stdout.trim();
}

export async function runPrerequisiteCli(
  argv = process.argv.slice(2)
): Promise<number> {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const failures = await collectPrerequisiteFailures({
    root,
    nodeVersion: process.versions.node,
    pnpmVersion: installedPnpmVersion(),
    full: argv.includes('--full'),
    postgresqlUrl: process.env.PARAKO_E2E_POSTGRESQL_URL,
  });

  if (failures.length > 0) {
    for (const failure of failures) console.error(`- ${failure}`);
    return 1;
  }
  console.log('All requested test prerequisites are available.');
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runPrerequisiteCli();
}
