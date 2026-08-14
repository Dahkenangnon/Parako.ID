import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';
import { Client } from 'pg';

import { checkRedisAvailability } from '../../src/jobs/redis.ts';
import {
  resolveRedisDiagnosticConfig,
  type RedisDiagnosticConfig,
} from '../manage/shared/redis-config.ts';
import { assertDevelopmentRuntimeVersions } from '../setup-development.ts';

export interface PrerequisiteInputs {
  root: string;
  nodeVersion: string;
  pnpmVersion: string;
  full: boolean;
  postgresqlUrl?: string;
  redisEnvironment?: NodeJS.ProcessEnv;
  probeBrowser?: () => Promise<void>;
  probePostgresql?: (url: string) => Promise<void>;
  probePseudoTerminal?: () => Promise<void>;
  probeRedis?: (config: RedisDiagnosticConfig) => Promise<void>;
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

async function verifyPseudoTerminal(): Promise<void> {
  const result = spawnSync('script', ['--version'], { encoding: 'utf8' });
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (result.status !== 0 || !/util-linux/iu.test(output)) {
    throw new Error('GNU util-linux script is unavailable');
  }
}

async function connectToRedis(config: RedisDiagnosticConfig): Promise<void> {
  const result = await checkRedisAvailability(config);
  if (!result.available) throw new Error(result.reason);
}

export async function collectPrerequisiteFailures({
  root,
  nodeVersion,
  pnpmVersion,
  full,
  postgresqlUrl,
  redisEnvironment = process.env,
  probeBrowser = launchChrome,
  probePostgresql = connectToPostgresql,
  probePseudoTerminal = verifyPseudoTerminal,
  probeRedis = connectToRedis,
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

  try {
    await probePseudoTerminal();
  } catch (error) {
    failures.push(
      `Pseudo-terminal prerequisite failed: ${error instanceof Error ? error.message : String(error)}. Install util-linux.`
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

    try {
      await probeRedis(resolveRedisDiagnosticConfig(redisEnvironment));
    } catch (error) {
      failures.push(
        `Redis prerequisite failed: ${error instanceof Error ? error.message : String(error)}`
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
    redisEnvironment: process.env,
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
