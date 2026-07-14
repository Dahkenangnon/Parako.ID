#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { checkRedisAvailability } from '../../src/jobs/redis.js';
import { findProjectRoot, loadRuntimeEnvironment } from './database.js';
import { isMainModule } from './shared/entrypoint.js';

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
  if (!Number.isInteger(database) || database < 0) {
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
    .version('1');

  program
    .command('redis')
    .description('Connect to Redis and require a successful PING')
    .action(checkRedis);

  return program;
}

if (isMainModule(import.meta.url)) {
  buildProgram()
    .parseAsync(process.argv)
    .catch(error => {
      console.error(
        `Diagnostic failed: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exitCode = 1;
    });
}
