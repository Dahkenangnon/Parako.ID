import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const diagnosticsEntrypoint = join(
  repositoryRoot,
  'dist',
  'scripts',
  'manage',
  'diagnostics.js'
);

function runDiagnostics(temporaryRoot: string, environment: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [diagnosticsEntrypoint, 'redis'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NODE_ENV: 'test',
      PARAKO_ENV_FILE: join(temporaryRoot, 'missing.env'),
      PARAKO_ROOT: repositoryRoot,
      REDIS_DATABASE: '15',
      REDIS_HOST: '127.0.0.1',
      REDIS_PASSWORD: '',
      REDIS_PORT: '6379',
      ...environment,
    },
  });
}

describe.sequential('compiled Redis diagnostics CLI', () => {
  let temporaryRoot: string;

  beforeAll(() => {
    if (!existsSync(diagnosticsEntrypoint)) {
      throw new Error(
        'The compiled diagnostics CLI is missing. Run pnpm build before this integration suite.'
      );
    }
    temporaryRoot = mkdtempSync(
      join(tmpdir(), 'parako-diagnostics-cli-redis-')
    );
  });

  afterAll(() => {
    if (temporaryRoot) {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('requires a successful PING from the deterministic local Redis service', () => {
    const result = runDiagnostics(temporaryRoot, {});

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Redis is reachable at 127.0.0.1:6379.');
  });

  it.each([
    [{ REDIS_HOST: '' }, 'REDIS_HOST is required.'],
    [{ REDIS_PORT: '0' }, 'REDIS_PORT must be an integer between 1 and 65535.'],
    [
      { REDIS_DATABASE: '-1' },
      'REDIS_DATABASE must be a non-negative integer.',
    ],
  ])('rejects malformed Redis configuration %#', (environment, message) => {
    const result = runDiagnostics(temporaryRoot, environment);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`Diagnostic failed: ${message}`);
  });

  it('fails safely when Redis is unavailable', () => {
    // gitleaks:allow -- deterministic credential for an unreachable local test endpoint.
    const password = 'public-test-password';
    const result = runDiagnostics(temporaryRoot, {
      REDIS_DATABASE: '0',
      REDIS_HOST: '127.0.0.1',
      REDIS_PASSWORD: password,
      REDIS_PORT: '1',
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Diagnostic failed: Redis at 127.0.0.1:1');
    expect(result.stderr).not.toContain(password);
  }, 10_000);
});
