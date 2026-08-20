import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertValidManifest,
  createReleaseManifest,
  hashDirectory,
  main,
  validateManifest,
  writeReleaseManifest,
} from '../../../scripts/create-release-manifest.mjs';

const temporaryDirectories: string[] = [];

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parako-manifest-'));
  temporaryDirectories.push(root);
  fs.mkdirSync(path.join(root, 'prisma/migrations/sqlite'), {
    recursive: true,
  });
  fs.mkdirSync(path.join(root, 'prisma/migrations/postgresql'), {
    recursive: true,
  });
  fs.mkdirSync(path.join(root, 'node_modules/@prisma/client'), {
    recursive: true,
  });
  fs.mkdirSync(path.join(root, 'prisma/generated/postgresql'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ version: '1.2.3' })
  );
  fs.writeFileSync(path.join(root, 'SBOM.spdx.json'), '{}\n');
  fs.writeFileSync(path.join(root, 'node_modules/@prisma/client/index.js'), '');
  fs.writeFileSync(path.join(root, 'prisma/generated/postgresql/index.js'), '');
  fs.writeFileSync(
    path.join(root, 'prisma/migrations/sqlite/migration.sql'),
    'SELECT 1;\n'
  );
  fs.writeFileSync(
    path.join(root, 'prisma/migrations/postgresql/migration.sql'),
    'SELECT 1;\n'
  );
  return root;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('release manifest', () => {
  it('creates an architecture-bound, reproducible compatibility contract', () => {
    const manifest = createReleaseManifest({
      releaseDir: fixture(),
      version: '1.2.3',
      architecture: 'arm64',
      nodeVersion: 'v24.1.0',
      sourceDateEpoch: '1700000000',
    });

    expect(validateManifest(manifest)).toEqual([]);
    expect(manifest.platform.architecture).toBe('arm64');
    expect(manifest.runtime.node).toMatchObject({
      bundled: true,
      version: '24.1.0',
    });
    expect(manifest.runtime.databaseClients).toEqual({
      sqlite: { path: 'node_modules/@prisma/client/index.js' },
      postgresql: { path: 'prisma/generated/postgresql/index.js' },
    });
    expect(manifest.services.redis.required).toBe(true);
    expect(manifest.configuration.applicationAndOidcManagedByAdmin).toBe(true);
    expect(manifest.build.createdAt).toBe('2023-11-14T22:13:20.000Z');
  });

  it('rejects a release version that differs from package.json', () => {
    expect(() =>
      createReleaseManifest({
        releaseDir: fixture(),
        version: '1.2.4',
        architecture: 'x64',
        sourceDateEpoch: '1700000000',
      })
    ).toThrow('does not match package.json');
  });

  it('rejects an artifact without its generated PostgreSQL client', () => {
    const root = fixture();
    fs.rmSync(path.join(root, 'prisma/generated/postgresql/index.js'));

    expect(() =>
      createReleaseManifest({
        releaseDir: root,
        version: '1.2.3',
        architecture: 'x64',
        sourceDateEpoch: '1700000000',
      })
    ).toThrow('postgresql Prisma client is missing');
  });

  it('hashes migration contents and relative paths deterministically', () => {
    const root = fixture();
    const first = hashDirectory(path.join(root, 'prisma/migrations/sqlite'));
    const second = hashDirectory(path.join(root, 'prisma/migrations/sqlite'));
    expect(first).toEqual(second);
    expect(first.fileCount).toBe(1);
  });

  it('hashes nested migration files and accepts a missing directory', () => {
    const root = fixture();
    fs.mkdirSync(path.join(root, 'prisma/migrations/sqlite/nested'));
    fs.writeFileSync(
      path.join(root, 'prisma/migrations/sqlite/nested/second.sql'),
      'SELECT 2;\n'
    );

    expect(hashDirectory(path.join(root, 'missing'))).toMatchObject({
      fileCount: 0,
    });
    expect(
      hashDirectory(path.join(root, 'prisma/migrations/sqlite')).fileCount
    ).toBe(2);
  });

  it('reports every invalid manifest contract and rejects it', () => {
    const errors = validateManifest({});

    expect(errors).toEqual([
      'schemaVersion must be 1',
      'product must be parako.id',
      'version must be semantic',
      'platform.architecture must be x64 or arm64',
      'platform.os must be linux',
      'runtime.node.bundled must be true',
      'SQLite Prisma client path is invalid',
      'PostgreSQL Prisma client path is invalid',
      'SQLite migration checksum is required',
      'PostgreSQL migration checksum is required',
      'Redis must be declared as required',
      'SPDX SBOM checksum is required',
    ]);
    expect(() => assertValidManifest({})).toThrow(
      `Invalid release manifest: ${errors.join('; ')}`
    );
  });

  it.each([
    [{ version: 'not-semver', architecture: 'x64' }, 'Invalid release version'],
    [
      { version: '1.2.3', architecture: 'riscv64' },
      'Unsupported release architecture',
    ],
    [
      { version: '1.2.3', architecture: 'x64', sourceDateEpoch: 'invalid' },
      'SOURCE_DATE_EPOCH must be a positive Unix timestamp',
    ],
    [
      { version: '1.2.3', architecture: 'x64', sourceDateEpoch: '0' },
      'SOURCE_DATE_EPOCH must be a positive Unix timestamp',
    ],
  ] as const)('rejects invalid release input %#', (options, message) => {
    expect(() =>
      createReleaseManifest({ releaseDir: fixture(), ...options })
    ).toThrow(message);
  });

  it.each([
    ['SBOM.spdx.json', 'Release SPDX SBOM is missing'],
    [
      'node_modules/@prisma/client/index.js',
      'Release sqlite Prisma client is missing',
    ],
  ])('rejects a release missing %s', (relativePath, message) => {
    const root = fixture();
    fs.rmSync(path.join(root, relativePath));

    expect(() =>
      createReleaseManifest({
        releaseDir: root,
        version: '1.2.3',
        architecture: 'x64',
        sourceDateEpoch: '1700000000',
      })
    ).toThrow(message);
  });

  it('uses each supported commit environment fallback', () => {
    const originalGithubSha = process.env.GITHUB_SHA;
    const originalParakoSha = process.env.PARAKO_GIT_SHA;

    try {
      process.env.GITHUB_SHA = 'github-sha';
      process.env.PARAKO_GIT_SHA = 'parako-sha';
      expect(
        createReleaseManifest({
          releaseDir: fixture(),
          version: '1.2.3',
          architecture: 'x64',
          sourceDateEpoch: '1700000000',
        }).build.commit
      ).toBe('github-sha');

      delete process.env.GITHUB_SHA;
      expect(
        createReleaseManifest({
          releaseDir: fixture(),
          version: '1.2.3',
          architecture: 'x64',
          sourceDateEpoch: '1700000000',
        }).build.commit
      ).toBe('parako-sha');

      delete process.env.PARAKO_GIT_SHA;
      expect(
        createReleaseManifest({
          releaseDir: fixture(),
          version: '1.2.3',
          architecture: 'x64',
          sourceDateEpoch: '1700000000',
        }).build.commit
      ).toBe('unknown');
    } finally {
      if (originalGithubSha === undefined) delete process.env.GITHUB_SHA;
      else process.env.GITHUB_SHA = originalGithubSha;
      if (originalParakoSha === undefined) delete process.env.PARAKO_GIT_SHA;
      else process.env.PARAKO_GIT_SHA = originalParakoSha;
    }
  });

  it('writes a validated release manifest to disk', () => {
    const root = fixture();
    const target = writeReleaseManifest({
      releaseDir: root,
      version: '1.2.3',
      architecture: 'x64',
      sourceDateEpoch: '1700000000',
    });

    expect(target).toBe(path.join(root, 'release-manifest.json'));
    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toMatchObject({
      schemaVersion: 1,
      version: '1.2.3',
    });
  });

  it.each([
    { argv: [] },
    { argv: ['/release'] },
    { argv: ['/release', '1.2.3'] },
  ])(
    'returns usage exit code 2 for incomplete CLI arguments %#',
    ({ argv }) => {
      const stderr = vi.fn();

      expect(main({ argv, stderr })).toBe(2);
      expect(stderr).toHaveBeenCalledWith(
        'Usage: node scripts/create-release-manifest-cli.mjs <release-dir> <version> <x64|arm64>'
      );
    }
  );

  it('writes the manifest through the CLI and returns zero', () => {
    const root = fixture();
    const stdout = vi.fn();
    const originalEpoch = process.env.SOURCE_DATE_EPOCH;
    process.env.SOURCE_DATE_EPOCH = '1700000000';

    try {
      expect(main({ argv: [root, '1.2.3', 'x64'], stdout })).toBe(0);
      expect(stdout).toHaveBeenCalledWith(
        path.join(root, 'release-manifest.json')
      );
    } finally {
      if (originalEpoch === undefined) delete process.env.SOURCE_DATE_EPOCH;
      else process.env.SOURCE_DATE_EPOCH = originalEpoch;
    }
  });

  it.each([new Error('write failed'), 'write failed'])(
    'reports CLI failures safely for %#',
    error => {
      const stderr = vi.fn();

      expect(
        main({
          argv: ['/release', '1.2.3', 'x64'],
          stderr,
          writeManifest: () => {
            throw error;
          },
        })
      ).toBe(1);
      expect(stderr).toHaveBeenCalledWith('write failed');
    }
  );
});
