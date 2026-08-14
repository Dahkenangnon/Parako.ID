import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { collectPrerequisiteFailures } from '../../../scripts/testing/check-prerequisites.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function createTemporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function availablePseudoTerminal() {
  return vi.fn().mockResolvedValue(undefined);
}

function createInstalledFixture(): { root: string } {
  const root = createTemporaryRoot('parako-prerequisites-');
  const clientDirectory = join(root, 'node_modules/@prisma/client');
  mkdirSync(clientDirectory, { recursive: true });
  writeFileSync(join(clientDirectory, 'default.js'), '');
  return { root };
}

describe('test prerequisites', () => {
  it('accepts the self-contained local prerequisites without infrastructure services', async () => {
    const fixture = createInstalledFixture();
    const probeBrowser = vi.fn().mockResolvedValue(undefined);
    const probePostgresql = vi.fn();
    const probeRedis = vi.fn();

    await expect(
      collectPrerequisiteFailures({
        ...fixture,
        nodeVersion: '24.1.0',
        pnpmVersion: '11.4.0',
        full: false,
        probeBrowser,
        probePseudoTerminal: availablePseudoTerminal(),
        probePostgresql,
        probeRedis,
      })
    ).resolves.toEqual([]);
    expect(probeBrowser).toHaveBeenCalledOnce();
    expect(probePostgresql).not.toHaveBeenCalled();
    expect(probeRedis).not.toHaveBeenCalled();
  });

  it('reports every missing local prerequisite together', async () => {
    const root = createTemporaryRoot('parako-prerequisites-missing-');

    const failures = await collectPrerequisiteFailures({
      root,
      nodeVersion: '23.9.0',
      pnpmVersion: '10.8.0',
      full: false,
      probeBrowser: vi
        .fn()
        .mockRejectedValue(new Error('Chrome executable is unavailable')),
      probePseudoTerminal: availablePseudoTerminal(),
    });

    expect(failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Node.js 24'),
        expect.stringContaining('Generated Prisma client'),
        expect.stringContaining('Chrome executable is unavailable'),
      ])
    );
  });

  it('reports a missing GNU pseudo-terminal utility before process tests', async () => {
    const fixture = createInstalledFixture();

    const failures = await collectPrerequisiteFailures({
      ...fixture,
      nodeVersion: '24.1.0',
      pnpmVersion: '11.4.0',
      full: false,
      probeBrowser: vi.fn().mockResolvedValue(undefined),
      probePseudoTerminal: vi
        .fn()
        .mockRejectedValue(new Error('GNU util-linux script is unavailable')),
    });

    expect(failures).toEqual([
      'Pseudo-terminal prerequisite failed: GNU util-linux script is unavailable. Install util-linux.',
    ]);
  });

  it('probes the configured infrastructure services for full verification', async () => {
    const fixture = createInstalledFixture();
    const probePostgresql = vi.fn().mockResolvedValue(undefined);
    const probeRedis = vi.fn().mockResolvedValue(undefined);
    const url = 'postgresql://operator:secret@127.0.0.1:5432/parako_e2e'; // gitleaks:allow -- non-routable test fixture

    await expect(
      collectPrerequisiteFailures({
        ...fixture,
        nodeVersion: '24.1.0',
        pnpmVersion: '11.4.0',
        full: true,
        postgresqlUrl: url,
        redisEnvironment: {
          REDIS_HOST: '127.0.0.1',
          REDIS_PORT: '6379',
          REDIS_DATABASE: '15',
        },
        probeBrowser: vi.fn().mockResolvedValue(undefined),
        probePseudoTerminal: availablePseudoTerminal(),
        probePostgresql,
        probeRedis,
      })
    ).resolves.toEqual([]);
    expect(probePostgresql).toHaveBeenCalledWith(url);
    expect(probeRedis).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 6379,
      database: 15,
    });
  });

  it('fails full verification before tests when PostgreSQL is unavailable', async () => {
    const fixture = createInstalledFixture();

    const failures = await collectPrerequisiteFailures({
      ...fixture,
      nodeVersion: '24.1.0',
      pnpmVersion: '11.4.0',
      full: true,
      postgresqlUrl: 'postgresql://operator@127.0.0.1/parako',
      redisEnvironment: { REDIS_HOST: '127.0.0.1' },
      probeBrowser: vi.fn().mockResolvedValue(undefined),
      probePseudoTerminal: availablePseudoTerminal(),
      probePostgresql: vi
        .fn()
        .mockRejectedValue(new Error('connection refused')),
      probeRedis: vi.fn().mockResolvedValue(undefined),
    });

    expect(failures).toEqual([
      'PostgreSQL prerequisite failed: connection refused',
    ]);
  });

  it('fails full verification before tests when Redis is not configured', async () => {
    const fixture = createInstalledFixture();

    const failures = await collectPrerequisiteFailures({
      ...fixture,
      nodeVersion: '24.1.0',
      pnpmVersion: '11.4.0',
      full: true,
      postgresqlUrl: 'postgresql://operator@127.0.0.1/parako',
      redisEnvironment: {},
      probeBrowser: vi.fn().mockResolvedValue(undefined),
      probePseudoTerminal: availablePseudoTerminal(),
      probePostgresql: vi.fn().mockResolvedValue(undefined),
      probeRedis: vi.fn(),
    });

    expect(failures).toEqual([
      'Redis prerequisite failed: REDIS_HOST is required.',
    ]);
  });

  it('reports an unreachable Redis service during full verification', async () => {
    const fixture = createInstalledFixture();

    const failures = await collectPrerequisiteFailures({
      ...fixture,
      nodeVersion: '24.1.0',
      pnpmVersion: '11.4.0',
      full: true,
      postgresqlUrl: 'postgresql://operator@127.0.0.1/parako',
      redisEnvironment: { REDIS_HOST: '127.0.0.1' },
      probeBrowser: vi.fn().mockResolvedValue(undefined),
      probePseudoTerminal: availablePseudoTerminal(),
      probePostgresql: vi.fn().mockResolvedValue(undefined),
      probeRedis: vi.fn().mockRejectedValue(new Error('connection refused')),
    });

    expect(failures).toEqual(['Redis prerequisite failed: connection refused']);
  });
});
