import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadTestingEnvironment } from './environment.ts';

import {
  E2E_CELL_IDS,
  E2E_PROFILE_IDS,
  resolveE2eCell,
} from '../../test/e2e/config/matrix.ts';

export interface MatrixEnvironment {
  PARAKO_E2E_POSTGRESQL_URL?: string;
}

export interface MatrixCommand {
  command: string;
  args: string[];
  environment?: Record<string, string>;
}

interface MatrixCommandResult {
  status: number | null;
}

export type MatrixCommandExecutor = (
  command: MatrixCommand
) => MatrixCommandResult;

/**
 * Creates the strict full-matrix plan. Unlike the default local Playwright
 * suite, this plan never turns unavailable PostgreSQL cells into a successful
 * partial run and applies every browser configuration profile to every
 * supported storage/tenancy cell.
 */
export function buildMatrixInfrastructurePlan(
  environment: MatrixEnvironment
): MatrixCommand[] {
  const postgresqlUrl = environment.PARAKO_E2E_POSTGRESQL_URL;
  // Resolving a PostgreSQL cell performs the strict prerequisite validation
  // before any subprocess starts, so a partial matrix can never report green.
  resolveE2eCell('postgresql-single', postgresqlUrl);

  const plan: MatrixCommand[] = [
    { command: 'pnpm', args: ['run', 'db:generate:pg'] },
    { command: 'pnpm', args: ['run', 'build'] },
    {
      command: 'pnpm',
      args: ['exec', 'playwright', 'test', '--config=playwright.config.ts'],
      environment: {
        PARAKO_E2E_PROFILE: 'self-starting',
        PARAKO_E2E_POSTGRESQL_URL: postgresqlUrl!,
      },
    },
  ];

  for (const cellId of E2E_CELL_IDS) {
    const cell = resolveE2eCell(cellId, postgresqlUrl);
    for (const profileId of E2E_PROFILE_IDS) {
      plan.push({
        command: 'pnpm',
        args: ['exec', 'playwright', 'test', '--config=playwright.config.ts'],
        environment: {
          ...cell.environment,
          PARAKO_E2E_CELL: cellId,
          PARAKO_E2E_PROFILE: profileId,
        },
      });
    }
  }

  return plan;
}

export function runMatrixInfrastructurePlan(
  plan: readonly MatrixCommand[],
  execute: MatrixCommandExecutor
): number {
  for (const command of plan) {
    const result = execute(command);
    if (result.status !== 0) {
      return result.status ?? 1;
    }
  }

  return 0;
}

function executeCommand({
  command,
  args,
  environment,
}: MatrixCommand): MatrixCommandResult {
  return spawnSync(command, args, {
    env: { ...process.env, ...environment },
    stdio: 'inherit',
  });
}

export function runMatrixInfrastructureCli(
  environment: MatrixEnvironment = loadTestingEnvironment(
    fileURLToPath(new URL('../../', import.meta.url))
  ),
  execute: MatrixCommandExecutor = executeCommand
): number {
  try {
    return runMatrixInfrastructurePlan(
      buildMatrixInfrastructurePlan(environment),
      execute
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[e2e-matrix] ${message}`);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = runMatrixInfrastructureCli();
}
