import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertDevelopmentRuntimeVersions,
  prepareDevelopmentFiles,
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

  it('validates tools before generating and migrating SQLite', () => {
    const root = createFixtureRoot();
    const execute = vi.fn(({ args }: { args: string[] }) => ({
      status: 0,
      stdout: args[0] === '--version' ? '11.4.0' : undefined,
    }));

    expect(
      runDevelopmentSetup({
        root,
        nodeVersion: '24.1.0',
        execute,
        randomSecret: () => 'c'.repeat(64),
      })
    ).toMatchObject({
      created: ['runtime/.env', 'runtime/parako.jsonc'],
    });
    expect(execute.mock.calls.map(([command]) => command.args)).toEqual([
      ['--version'],
      ['exec', 'prisma', 'generate', '--config=prisma.config.ts'],
      ['exec', 'prisma', 'migrate', 'deploy', '--config=prisma.config.ts'],
    ]);
  });

  it('stops before file creation when the package manager is unavailable', () => {
    const root = createFixtureRoot();
    const execute = vi.fn(() => ({ status: 1 }));

    expect(() =>
      runDevelopmentSetup({ root, nodeVersion: '24.1.0', execute })
    ).toThrow(/pnpm --version/);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
