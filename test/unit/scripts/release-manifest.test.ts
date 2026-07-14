import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createReleaseManifest,
  hashDirectory,
  validateManifest,
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
});
