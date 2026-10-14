#!/usr/bin/env node

import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { ipKeyGenerator } from 'express-rate-limit';
import { Redis } from 'ioredis';
import { findProjectRoot, loadRuntimeEnvironment } from './database.js';
import { isMainModule } from './shared/entrypoint.js';
import { writeOperatorAudit } from './shared/operator-audit.js';
import { resolveRedisDiagnosticConfig } from './shared/redis-config.js';
import { getPackageInfo } from './shared/utils.js';

interface ClearBootstrapRateLimitOptions {
  ip: string;
  email: string;
  reason: string;
  confirmed: boolean;
  prefix?: string;
}

export function buildBootstrapRateLimitKeys(
  prefix: string,
  tenantId: string,
  ip: string,
  email: string
): string[] {
  const normalizedIp = ipKeyGenerator(ip);
  const normalizedEmail = email.trim().toLowerCase();
  const base = `${prefix}:${tenantId}:rl`;
  return [
    `${base}:login:${normalizedIp}`,
    `${base}:login-brute-ip:${normalizedIp}`,
    `${base}:login-brute-identifier:${normalizedIp}:${normalizedEmail}`,
  ];
}

function validateRecoveryInput(
  options: ClearBootstrapRateLimitOptions
): Required<ClearBootstrapRateLimitOptions> {
  if (!options.confirmed) {
    throw new Error(
      'Rate-limit recovery requires --yes because it weakens protection for one IP and account.'
    );
  }
  const ip = options.ip.trim();
  if (net.isIP(ip) === 0) {
    throw new Error('--ip must be a valid IPv4 or IPv6 address.');
  }
  const email = options.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('--email must be a valid email address.');
  }
  const reason = options.reason.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (reason.length < 10 || reason.length > 500) {
    throw new Error('--reason must be between 10 and 500 characters.');
  }
  const prefix = options.prefix?.trim() || 'parako';
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(prefix)) {
    throw new Error(
      '--prefix must contain only letters, numbers, dots, underscores, or hyphens.'
    );
  }
  return { ip, email, reason, confirmed: true, prefix };
}

export async function clearBootstrapRateLimit(
  input: ClearBootstrapRateLimitOptions
): Promise<{ deletedKeys: number; restartRequired: true }> {
  const options = validateRecoveryInput(input);
  const root = process.env.PARAKO_ROOT
    ? findProjectRoot(process.env.PARAKO_ROOT)
    : findProjectRoot(path.dirname(fileURLToPath(import.meta.url)));
  loadRuntimeEnvironment(root);
  const multiTenancy = process.env.MULTI_TENANCY_ENABLED?.toLowerCase();
  if (multiTenancy !== undefined && !['true', 'false'].includes(multiTenancy)) {
    throw new Error('MULTI_TENANCY_ENABLED must be true or false.');
  }
  if (multiTenancy === 'true') {
    throw new Error(
      'Bootstrap rate-limit recovery is limited to single-tenant deployments.'
    );
  }

  const redisConfig = resolveRedisDiagnosticConfig();
  const keys = buildBootstrapRateLimitKeys(
    options.prefix,
    'default',
    options.ip,
    options.email
  );
  await writeOperatorAudit(root, {
    action: 'security.clear_bootstrap_rate_limit',
    status: 'attempt',
    reason: options.reason,
    target: {
      ip: options.ip,
      email: options.email,
      redisPrefix: options.prefix,
    },
  });

  const redis = new Redis({
    host: redisConfig.host,
    port: redisConfig.port,
    password: redisConfig.password,
    db: redisConfig.database,
    connectTimeout: 5_000,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  try {
    await redis.connect();
    const deletedKeys = await redis.unlink(...keys);
    await writeOperatorAudit(root, {
      action: 'security.clear_bootstrap_rate_limit',
      status: 'success',
      reason: options.reason,
      target: {
        ip: options.ip,
        email: options.email,
        redisPrefix: options.prefix,
        deletedKeys,
      },
    });
    return { deletedKeys, restartRequired: true };
  } catch (error) {
    await writeOperatorAudit(root, {
      action: 'security.clear_bootstrap_rate_limit',
      status: 'failed',
      reason: options.reason,
      target: {
        ip: options.ip,
        email: options.email,
        redisPrefix: options.prefix,
      },
    });
    throw error;
  } finally {
    try {
      await redis.quit();
    } catch {
      redis.disconnect();
    }
  }
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('parako-security')
    .description('Perform narrowly scoped Parako.ID security recovery')
    .version(getPackageInfo().version);

  program
    .command('clear-bootstrap-rate-limit')
    .requiredOption('--ip <address>', 'Blocked operator IPv4 or IPv6 address')
    .requiredOption('--email <address>', 'Pending administrator email')
    .requiredOption('--reason <text>', 'Auditable recovery reason')
    .option('--prefix <prefix>', 'Configured Redis prefix', 'parako')
    .option('--yes', 'Confirm the narrowly scoped rate-limit reset', false)
    .action(async options => {
      const result = await clearBootstrapRateLimit({
        ip: options.ip,
        email: options.email,
        reason: options.reason,
        prefix: options.prefix,
        confirmed: options.yes,
      });
      console.log(
        `Removed ${result.deletedKeys} matching Redis rate-limit keys.`
      );
      console.log(
        'The application process must be restarted to clear its in-memory global limiter.'
      );
    });
  return program;
}

export async function runSecurityCli(argv = process.argv): Promise<void> {
  try {
    await buildProgram().parseAsync(argv);
  } catch (error) {
    console.error(
      `Security recovery failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url)) {
  void runSecurityCli();
}
