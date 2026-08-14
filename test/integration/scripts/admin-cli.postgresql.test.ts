import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  applyPostgresqlMigrations,
  createPostgresqlTestDatabase,
} from '../../e2e/support/parako-instance.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const adminEntrypoint = join(
  repositoryRoot,
  'dist',
  'scripts',
  'manage',
  'admin.js'
);

describe.sequential('compiled administrator CLI with PostgreSQL', () => {
  let database: Client;
  let databaseUrl: string;
  let dropDatabase: (() => Promise<void>) | undefined;
  let temporaryRoot: string;

  beforeAll(async () => {
    if (!existsSync(adminEntrypoint)) {
      throw new Error(
        'The compiled administrator CLI is missing. Run pnpm build before this integration suite.'
      );
    }

    const administrativeUrl =
      process.env.STORAGE_POSTGRESQL_URL ??
      process.env.PARAKO_E2E_POSTGRESQL_URL;
    if (!administrativeUrl) {
      throw new Error(
        'STORAGE_POSTGRESQL_URL or PARAKO_E2E_POSTGRESQL_URL is required'
      );
    }

    temporaryRoot = mkdtempSync(join(tmpdir(), 'parako-admin-cli-postgresql-'));
    const fixture = await createPostgresqlTestDatabase(administrativeUrl);
    databaseUrl = fixture.databaseUrl;
    dropDatabase = fixture.drop;
    await applyPostgresqlMigrations(databaseUrl);
    database = new Client({ connectionString: databaseUrl });
    await database.connect();
  }, 120_000);

  afterAll(async () => {
    await database?.end();
    await dropDatabase?.();
    if (temporaryRoot) {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('issues a single-use activation through a disposable PostgreSQL database', async () => {
    const result = spawnSync(
      process.execPath,
      [
        adminEntrypoint,
        'bootstrap',
        '--email',
        'Admin@Example.test',
        '--expires-minutes',
        '10',
      ],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          DEPLOYMENT_SERVER_PORT: '9007',
          DEPLOYMENT_URL: 'https://id.example.test',
          NODE_ENV: 'test',
          PARAKO_ENV_FILE: join(temporaryRoot, 'missing.env'),
          PARAKO_ROOT: repositoryRoot,
          STORAGE_ADAPTER: 'postgresql',
          STORAGE_POSTGRESQL_URL: databaseUrl,
        },
      }
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    const activationUrl = result.stdout
      .split('\n')
      .find(line => line.startsWith('https://'));
    const token = new URL(activationUrl!).searchParams.get('token')!;
    const persisted = await database.query<{
      email: string;
      reset_password_token: string;
      roles: string;
      tenant_id: string;
    }>(
      `SELECT email, reset_password_token, roles, tenant_id
         FROM users
        WHERE email = $1`,
      ['admin@example.test']
    );

    expect(persisted.rows).toEqual([
      {
        email: 'admin@example.test',
        reset_password_token: createHash('sha256').update(token).digest('hex'),
        roles: JSON.stringify(['admin']),
        tenant_id: 'default',
      },
    ]);
    expect(persisted.rows[0]?.reset_password_token).not.toBe(token);
    expect(result.stdout).not.toContain(databaseUrl);
  });

  it('returns a failing status without exposing credentials when PostgreSQL is unavailable', () => {
    // gitleaks:allow -- deterministic credential for an unreachable local test endpoint.
    const unavailableUrl =
      'postgresql://parako_cli:public-test-password@127.0.0.1:1/parako_cli';
    const result = spawnSync(
      process.execPath,
      [
        adminEntrypoint,
        'bootstrap',
        '--email',
        'admin@example.test',
        '--expires-minutes',
        '10',
      ],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATABASE_URL: unavailableUrl,
          DEPLOYMENT_SERVER_PORT: '9007',
          DEPLOYMENT_URL: 'https://id.example.test',
          NODE_ENV: 'test',
          PARAKO_ENV_FILE: join(temporaryRoot, 'missing.env'),
          PARAKO_ROOT: repositoryRoot,
          STORAGE_ADAPTER: 'postgresql',
          STORAGE_POSTGRESQL_URL: unavailableUrl,
        },
      }
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Administrator bootstrap failed:');
    expect(result.stderr).not.toContain(unavailableUrl);
    expect(result.stderr).not.toContain('public-test-password');
    expect(result.stderr).not.toContain('https://id.example.test/auth');
  });
});
