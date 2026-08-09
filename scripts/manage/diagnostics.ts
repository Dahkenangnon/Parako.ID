#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { checkRedisAvailability } from '../../src/jobs/redis.js';
import { findProjectRoot, loadRuntimeEnvironment } from './database.js';
import { isMainModule } from './shared/entrypoint.js';
import { getPackageInfo } from './shared/utils.js';

export interface RedisDiagnosticConfig {
  host: string;
  port: number;
  password?: string;
  database?: number;
}

export function resolveRedisDiagnosticConfig(
  env: NodeJS.ProcessEnv = process.env
): RedisDiagnosticConfig {
  const host = env.REDIS_HOST?.trim();
  if (!host) throw new Error('REDIS_HOST is required.');

  const port = Number(env.REDIS_PORT ?? '6379');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('REDIS_PORT must be an integer between 1 and 65535.');
  }

  const database = Number(env.REDIS_DATABASE ?? '0');
  if (!Number.isSafeInteger(database) || database < 0) {
    throw new Error('REDIS_DATABASE must be a non-negative integer.');
  }

  return {
    host,
    port,
    password: env.REDIS_PASSWORD || undefined,
    database,
  };
}

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
