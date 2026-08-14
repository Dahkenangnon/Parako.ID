#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { checkRedisAvailability } from '../../src/jobs/redis.js';
import { findProjectRoot, loadRuntimeEnvironment } from './database.js';
import { isMainModule } from './shared/entrypoint.js';
import {
  resolveRedisDiagnosticConfig,
  type RedisDiagnosticConfig,
} from './shared/redis-config.js';
import { getPackageInfo } from './shared/utils.js';

export { resolveRedisDiagnosticConfig };
export type { RedisDiagnosticConfig };

export async function checkRedis(): Promise<void> {
  const root = process.env.PARAKO_ROOT
    ? findProjectRoot(process.env.PARAKO_ROOT)
    : findProjectRoot(path.dirname(fileURLToPath(import.meta.url)));
  loadRuntimeEnvironment(root);

  const config = resolveRedisDiagnosticConfig();
  const result = await checkRedisAvailability(config);
  if (!result.available) throw new Error(result.reason);
  console.log(`Redis is reachable at ${config.host}:${config.port}.`);
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('parako-diagnostics')
    .description('Check required Parako.ID production dependencies')
    .version(getPackageInfo().version);

  program
    .command('redis')
    .description('Connect to Redis and require a successful PING')
    .action(checkRedis);

  return program;
}

/** Execute diagnostics and translate failures to process status. */
export async function runDiagnosticsCli(argv = process.argv): Promise<void> {
  try {
    await buildProgram().parseAsync(argv);
  } catch (error) {
    console.error(
      `Diagnostic failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url)) {
  void runDiagnosticsCli();
}
