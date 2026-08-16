import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertDevelopmentRuntimeVersions,
  generateDevelopmentEnvironmentFile,
  prepareDevelopmentFiles,
  prepareDevelopmentEnvironment,
  renderDevelopmentEnvironment,
  runDevelopmentSetup,
} from '../../../scripts/setup-development.js';

const environmentTemplate = [
  'ENCRYPTION_KEY=replace-me',
  'JWT_SECRET=',
  'COOKIE_SECRET_1=',
  'COOKIE_SECRET_2=',
  'HMAC_SECRET=',
  'PAIRWISE_SALT=',
  'REDIS_HOST=127.0.0.1',
  'REDIS_PORT=6379',
  'REDIS_DATABASE=0',
  '',
].join('\n');

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function createFixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'parako-development-setup-'));
  temporaryRoots.push(root);
  writeFileSync(join(root, '.env.example'), environmentTemplate);
  writeFileSync(join(root, 'parako.sample.jsonc'), '{"deployment":{}}\n');
  return root;
}

describe('development setup', () => {
  it('rejects unsupported Node.js and pnpm versions', () => {
    expect(() => assertDevelopmentRuntimeVersions('23.9.0', '11.4.0')).toThrow(
      /Node\.js 24/
    );
    expect(() => assertDevelopmentRuntimeVersions('24.0.0', '10.9.0')).toThrow(
      /pnpm 11/
    );
  });

  it('fills every required local secret without changing other settings', () => {
    let sequence = 0;
    const rendered = renderDevelopmentEnvironment(
      `DEPLOYMENT_ENVIRONMENT=development\n${environmentTemplate}`,
      () => String(++sequence).padStart(64, '0')
    );

    expect(rendered).toContain('DEPLOYMENT_ENVIRONMENT=development');
    expect(rendered).not.toContain('replace-me');
    expect(rendered.match(/[0-9]{64}/g)).toHaveLength(6);
  });

  it('generates a private runtime environment from the public example', () => {
    const root = createFixtureRoot();

    expect(generateDevelopmentEnvironmentFile(root, () => 'd'.repeat(64))).toBe(
      'runtime/.env'
    );

    const environmentPath = join(root, 'runtime/.env');
    expect(readFileSync(environmentPath, 'utf8')).not.toContain('replace-me');
    expect(statSync(environmentPath).mode & 0o777).toBe(0o600);
    expect(() => generateDevelopmentEnvironmentFile(root)).toThrow(
      /already exists/
    );
  });

  it('keeps standalone environment generation idempotent', () => {
    const root = createFixtureRoot();

    expect(prepareDevelopmentEnvironment(root, () => 'e'.repeat(64))).toEqual({
      created: ['runtime/.env'],
      preserved: [],
    });
    expect(prepareDevelopmentEnvironment(root, () => 'f'.repeat(64))).toEqual({
      created: [],
      preserved: ['runtime/.env'],
    });
    expect(readFileSync(join(root, 'runtime/.env'), 'utf8')).toContain(
      `ENCRYPTION_KEY=${'e'.repeat(64)}`
    );
  });
  it('creates development files once and preserves operator changes', () => {
    const root = createFixtureRoot();
    const first = prepareDevelopmentFiles(root, () => 'a'.repeat(64));
    const environmentPath = join(root, 'runtime/.env');
    writeFileSync(environmentPath, 'OPERATOR_OWNED=true\n');

    const second = prepareDevelopmentFiles(root, () => 'b'.repeat(64));

    expect(first).toEqual({
      created: ['runtime/.env', 'runtime/parako.jsonc'],
      preserved: [],
    });
    expect(second).toEqual({
      created: [],
      preserved: ['runtime/.env', 'runtime/parako.jsonc'],
    });
    expect(readFileSync(environmentPath, 'utf8')).toBe('OPERATOR_OWNED=true\n');
  });

  it('prepares every dependency needed by the complete local test gate', async () => {
    const root = createFixtureRoot();
    const execute = vi.fn(({ args }: { args: string[]; command: string }) => ({
      status: 0,
      stdout: args[0] === '--version' ? '11.4.0' : undefined,
    }));

    await expect(
      runDevelopmentSetup({
        root,
        nodeVersion: '24.1.0',
        execute,
        environment: {},
        infrastructureAdapter: {
          ensurePostgresql: vi
            .fn()
            .mockResolvedValue(
              'postgresql://parako@127.0.0.1:55432/parako_e2e'
            ),
          ensureRedis: vi.fn().mockResolvedValue(undefined),
        },
        randomSecret: () => 'c'.repeat(64),
      })
    ).resolves.toMatchObject({
      created: ['runtime/.env', 'runtime/parako.jsonc'],
    });
    expect(execute.mock.calls.map(([command]) => command.args)).toEqual([
      ['--version'],
      ['--version'],
      ['exec', 'playwright', 'install', 'chrome'],
      ['exec', 'prisma', 'generate', '--config=prisma.config.ts'],
      ['exec', 'prisma', 'migrate', 'deploy', '--config=prisma.config.ts'],
    ]);
    expect(execute.mock.calls.map(([command]) => command.command)).toEqual([
      'pnpm',
      'script',
      'pnpm',
      'pnpm',
      'pnpm',
    ]);
  });

  it('stops before file creation when the package manager is unavailable', async () => {
    const root = createFixtureRoot();
    const execute = vi.fn(() => ({ status: 1 }));

    await expect(
      runDevelopmentSetup({ root, nodeVersion: '24.1.0', execute })
    ).rejects.toThrow(/pnpm --version/);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('explains how to install a missing system prerequisite', async () => {
    const root = createFixtureRoot();
    const execute = vi.fn(({ command }: { command: string }) =>
      command === 'pnpm' ? { status: 0, stdout: '11.4.0' } : { status: 1 }
    );

    await expect(
      runDevelopmentSetup({
        root,
        nodeVersion: '24.1.0',
        execute,
      })
    ).rejects.toThrow(/Install GNU util-linux/);
  });
});
