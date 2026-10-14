import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadTestingEnvironment } from '../../../scripts/testing/environment.js';
import { buildBootstrapRateLimitKeys } from '../../../scripts/manage/security.js';
import { resolveRedisDiagnosticConfig } from '../../../scripts/manage/shared/redis-config.js';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const securityEntrypoint = join(
  repositoryRoot,
  'dist',
  'scripts',
  'manage',
  'security.js'
);

describe.sequential('compiled security recovery CLI with Redis', () => {
  let redis!: Redis;
  let temporaryRoot!: string;
  let testEnvironment!: NodeJS.ProcessEnv;
  let testPrefix: string | undefined;

  beforeAll(async () => {
    if (!existsSync(securityEntrypoint)) {
      throw new Error(
        'The compiled security CLI is missing. Run pnpm build before this integration suite.'
      );
    }

    temporaryRoot = mkdtempSync(join(tmpdir(), 'parako-security-cli-'));
    mkdirSync(join(temporaryRoot, 'prisma'));
    writeFileSync(join(temporaryRoot, 'package.json'), '{}\n', { mode: 0o600 });
    testEnvironment = loadTestingEnvironment(repositoryRoot);
    const redisConfig = resolveRedisDiagnosticConfig(testEnvironment);
    redis = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password,
      db: redisConfig.database,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    await redis.connect();
  });

  afterAll(async () => {
    if (testPrefix) {
      const keys = await redis.keys(`${testPrefix}:*`);
      if (keys.length > 0) await redis.unlink(...keys);
    }
    await redis?.quit();
    if (temporaryRoot) {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('deletes only the requested login buckets and records the recovery', async () => {
    testPrefix = `parako-security-test-${randomBytes(6).toString('hex')}`;
    const ip = '192.0.2.44';
    const email = 'Admin@Example.test';
    const targetKeys = buildBootstrapRateLimitKeys(
      testPrefix,
      'default',
      ip,
      email
    );
    const unrelatedKey = `${testPrefix}:default:rl:login:unrelated`;
    await redis.mset(
      ...targetKeys.flatMap(key => [key, '1']),
      unrelatedKey,
      '1'
    );

    const reason = 'Recovering the first administrator after deployment';
    const result = spawnSync(
      process.execPath,
      [
        securityEntrypoint,
        'clear-bootstrap-rate-limit',
        '--ip',
        ip,
        '--email',
        email,
        '--reason',
        reason,
        '--prefix',
        testPrefix,
        '--yes',
      ],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: {
          ...testEnvironment,
          MULTI_TENANCY_ENABLED: 'false',
          NODE_ENV: 'test',
          PARAKO_ENV_FILE: join(temporaryRoot, 'missing.env'),
          PARAKO_ROOT: temporaryRoot,
        },
      }
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(
      'Removed 3 matching Redis rate-limit keys.'
    );
    await expect(redis.mget(...targetKeys)).resolves.toEqual([
      null,
      null,
      null,
    ]);
    await expect(redis.get(unrelatedKey)).resolves.toBe('1');

    const audit = readFileSync(
      join(temporaryRoot, 'runtime', 'logs', 'operator-audit.jsonl'),
      'utf8'
    )
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as { status: string; reason: string });
    expect(audit.map(entry => [entry.status, entry.reason])).toEqual([
      ['attempt', reason],
      ['success', reason],
    ]);
    expect(JSON.stringify(audit)).not.toContain(
      testEnvironment.REDIS_PASSWORD || 'no-password-configured'
    );
  });
});
