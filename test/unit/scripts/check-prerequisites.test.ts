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

function createInstalledFixture(): { root: string } {
  const root = createTemporaryRoot('parako-prerequisites-');
  const clientDirectory = join(root, 'node_modules/@prisma/client');
  mkdirSync(clientDirectory, { recursive: true });
  writeFileSync(join(clientDirectory, 'default.js'), '');
  return { root };
}

describe('test prerequisites', () => {
  it('accepts the self-contained local prerequisites without PostgreSQL', async () => {
    const fixture = createInstalledFixture();
    const probeBrowser = vi.fn().mockResolvedValue(undefined);
    const probePostgresql = vi.fn();

    await expect(
      collectPrerequisiteFailures({
        ...fixture,
        nodeVersion: '24.1.0',
        pnpmVersion: '11.4.0',
        full: false,
        probeBrowser,
        probePostgresql,
      })
    ).resolves.toEqual([]);
    expect(probeBrowser).toHaveBeenCalledOnce();
    expect(probePostgresql).not.toHaveBeenCalled();
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
    });

    expect(failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Node.js 24'),
        expect.stringContaining('Generated Prisma client'),
        expect.stringContaining('Chrome executable is unavailable'),
      ])
    );
  });

  it('probes the configured PostgreSQL service for full verification', async () => {
    const fixture = createInstalledFixture();
    const probePostgresql = vi.fn().mockResolvedValue(undefined);
    const url = 'postgresql://operator:secret@127.0.0.1:5432/parako_e2e'; // gitleaks:allow -- non-routable test fixture

    await expect(
      collectPrerequisiteFailures({
        ...fixture,
        nodeVersion: '24.1.0',
        pnpmVersion: '11.4.0',
        full: true,
        postgresqlUrl: url,
        probeBrowser: vi.fn().mockResolvedValue(undefined),
        probePostgresql,
      })
    ).resolves.toEqual([]);
    expect(probePostgresql).toHaveBeenCalledWith(url);
  });

  it('fails full verification before tests when PostgreSQL is unavailable', async () => {
    const fixture = createInstalledFixture();

    const failures = await collectPrerequisiteFailures({
      ...fixture,
      nodeVersion: '24.1.0',
      pnpmVersion: '11.4.0',
      full: true,
      postgresqlUrl: 'postgresql://operator@127.0.0.1/parako',
      probeBrowser: vi.fn().mockResolvedValue(undefined),
      probePostgresql: vi
        .fn()
        .mockRejectedValue(new Error('connection refused')),
    });

    expect(failures).toEqual([
      'PostgreSQL prerequisite failed: connection refused',
    ]);
  });
});
