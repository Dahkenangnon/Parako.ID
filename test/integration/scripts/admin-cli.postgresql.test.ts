import { createHash } from 'node:crypto';
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

import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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

function runPostgresqlAdminCommand(
  temporaryRoot: string,
  databaseUrl: string,
  args: string[]
) {
  return spawnSync(process.execPath, [adminEntrypoint, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DEPLOYMENT_SERVER_PORT: '9007',
      DEPLOYMENT_URL: 'https://id.example.test',
      NODE_ENV: 'test',
      PARAKO_ENV_FILE: join(temporaryRoot, 'missing.env'),
      PARAKO_ROOT: temporaryRoot,
      STORAGE_ADAPTER: 'postgresql',
      STORAGE_POSTGRESQL_URL: databaseUrl,
    },
  });
}

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
    mkdirSync(join(temporaryRoot, 'prisma'));
    writeFileSync(join(temporaryRoot, 'package.json'), '{}\n', { mode: 0o600 });
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

  beforeEach(async () => {
    await database.query('DELETE FROM users');
    rmSync(join(temporaryRoot, 'runtime'), { recursive: true, force: true });
  });

  it('issues a single-use activation through a disposable PostgreSQL database', async () => {
    const result = runPostgresqlAdminCommand(temporaryRoot, databaseUrl, [
      'bootstrap',
      '--email',
      'Admin@Example.test',
      '--expires-minutes',
      '10',
    ]);

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

  it('replaces the pending PostgreSQL administrator through the compiled recovery command', async () => {
    const bootstrap = runPostgresqlAdminCommand(temporaryRoot, databaseUrl, [
      'bootstrap',
      '--email',
      'wrong@example.test',
      '--expires-minutes',
      '10',
    ]);
    expect(bootstrap.status, bootstrap.stderr).toBe(0);

    const reason = 'Correcting the initial PostgreSQL administrator email';
    const replacement = runPostgresqlAdminCommand(temporaryRoot, databaseUrl, [
      'replace-pending',
      '--email',
      'correct@example.test',
      '--reason',
      reason,
      '--expires-minutes',
      '10',
    ]);

    expect(replacement.status, replacement.stderr).toBe(0);
    const activationUrl = replacement.stdout
      .split('\n')
      .find(line => line.startsWith('https://'));
    const token = new URL(activationUrl!).searchParams.get('token')!;
    const persisted = await database.query<{
      email: string;
      password: string | null;
      reset_password_token: string;
    }>(
      'SELECT email, password, reset_password_token FROM users ORDER BY email'
    );
    expect(persisted.rows).toEqual([
      {
        email: 'correct@example.test',
        password: null,
        reset_password_token: createHash('sha256').update(token).digest('hex'),
      },
    ]);
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
    expect(JSON.stringify(audit)).not.toContain(token);
  });

  it('returns a failing status without exposing credentials when PostgreSQL is unavailable', () => {
    // gitleaks:allow -- deterministic credential for an unreachable local test endpoint.
    const unavailableUrl =
      'postgresql://parako_cli:public-test-password@127.0.0.1:1/parako_cli';
    const result = runPostgresqlAdminCommand(temporaryRoot, unavailableUrl, [
      'bootstrap',
      '--email',
      'admin@example.test',
      '--expires-minutes',
      '10',
    ]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Administrator bootstrap failed:');
    expect(result.stderr).not.toContain(unavailableUrl);
    expect(result.stderr).not.toContain('public-test-password');
    expect(result.stderr).not.toContain('https://id.example.test/auth');
  });
});
