#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ALLOWED_ARCHITECTURES = new Set(['x64', 'arm64']);
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;

function filesRecursively(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? filesRecursively(target) : [target];
    })
    .sort();
}

export function hashDirectory(directory) {
  const digest = createHash('sha256');
  const files = filesRecursively(directory);
  for (const file of files) {
    digest.update(path.relative(directory, file));
    digest.update('\0');
    digest.update(fs.readFileSync(file));
    digest.update('\0');
  }
  return { sha256: digest.digest('hex'), fileCount: files.length };
}

function hashFile(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function validateManifest(manifest) {
  const errors = [];
  if (manifest?.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (manifest?.product !== 'parako.id')
    errors.push('product must be parako.id');
  if (!VERSION_PATTERN.test(manifest?.version ?? '')) {
    errors.push('version must be semantic');
  }
  if (!ALLOWED_ARCHITECTURES.has(manifest?.platform?.architecture)) {
    errors.push('platform.architecture must be x64 or arm64');
  }
  if (manifest?.platform?.os !== 'linux')
    errors.push('platform.os must be linux');
  if (manifest?.runtime?.node?.bundled !== true) {
    errors.push('runtime.node.bundled must be true');
  }
  if (
    manifest?.runtime?.databaseClients?.sqlite?.path !==
    'node_modules/@prisma/client/index.js'
  ) {
    errors.push('SQLite Prisma client path is invalid');
  }
  if (
    manifest?.runtime?.databaseClients?.postgresql?.path !==
    'prisma/generated/postgresql/index.js'
  ) {
    errors.push('PostgreSQL Prisma client path is invalid');
  }
  if (!manifest?.migrations?.sqlite?.sha256) {
    errors.push('SQLite migration checksum is required');
  }
  if (!manifest?.migrations?.postgresql?.sha256) {
    errors.push('PostgreSQL migration checksum is required');
  }
  if (manifest?.services?.redis?.required !== true) {
    errors.push('Redis must be declared as required');
  }
  if (!manifest?.supplyChain?.sbom?.sha256) {
    errors.push('SPDX SBOM checksum is required');
  }
  return errors;
}

export function createReleaseManifest({
  releaseDir,
  version,
  architecture,
  nodeVersion = process.version,
  sourceDateEpoch = process.env.SOURCE_DATE_EPOCH,
}) {
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`Invalid release version: ${version}`);
  }
  if (!ALLOWED_ARCHITECTURES.has(architecture)) {
    throw new Error(`Unsupported release architecture: ${architecture}`);
  }

  const packageJson = JSON.parse(
    fs.readFileSync(path.join(releaseDir, 'package.json'), 'utf8')
  );
  if (packageJson.version !== version) {
    throw new Error(
      `Release version ${version} does not match package.json ${packageJson.version}`
    );
  }

  const sqlite = hashDirectory(
    path.join(releaseDir, 'prisma', 'migrations', 'sqlite')
  );
  const postgresql = hashDirectory(
    path.join(releaseDir, 'prisma', 'migrations', 'postgresql')
  );
  const epoch = Number(sourceDateEpoch);
  if (!Number.isInteger(epoch) || epoch <= 0) {
    throw new Error('SOURCE_DATE_EPOCH must be a positive Unix timestamp');
  }
  const sbomPath = path.join(releaseDir, 'SBOM.spdx.json');
  if (!fs.existsSync(sbomPath)) {
    throw new Error('Release SPDX SBOM is missing');
  }
  const databaseClients = {
    sqlite: { path: 'node_modules/@prisma/client/index.js' },
    postgresql: { path: 'prisma/generated/postgresql/index.js' },
  };
  for (const [adapter, client] of Object.entries(databaseClients)) {
    if (!fs.existsSync(path.join(releaseDir, client.path))) {
      throw new Error(`Release ${adapter} Prisma client is missing`);
    }
  }

  const manifest = {
    schemaVersion: 1,
    product: 'parako.id',
    version,
    tag: `v${version}`,
    artifactFormat: 'parako-id-linux-v1',
    platform: {
      os: 'linux',
      architecture,
      supportedDistributions: ['debian-12', 'ubuntu-24.04'],
    },
    runtime: {
      node: {
        bundled: true,
        version: nodeVersion.replace(/^v/, ''),
        executable: 'node/bin/node',
      },
      applicationEntrypoint: 'dist/src/index.js',
      workerEntrypoint: 'dist/src/worker.js',
      databaseClients,
      tools: {
        age: {
          bundled: true,
          version: '1.3.1',
          executable: 'tools/age/age',
          keygenExecutable: 'tools/age/age-keygen',
        },
      },
    },
    migrations: {
      baseline: '20260714000000_baseline',
      sqlite: {
        path: 'prisma/migrations/sqlite',
        ...sqlite,
      },
      postgresql: {
        path: 'prisma/migrations/postgresql',
        ...postgresql,
      },
      mongodb: {
        ledger: '_parako_migrations',
      },
    },
    services: {
      redis: {
        required: true,
      },
      reverseProxy: {
        managedByParako: false,
      },
      tls: {
        managedByParako: false,
      },
    },
    configuration: {
      applicationAndOidcManagedByAdmin: true,
      bootstrapEnvironment: 'runtime/.env',
    },
    supplyChain: {
      sbom: {
        format: 'SPDX-2.3',
        path: 'SBOM.spdx.json',
        sha256: hashFile(sbomPath),
      },
      thirdPartyLicenses: 'THIRD_PARTY_LICENSES.txt',
    },
    build: {
      sourceDateEpoch: epoch,
      createdAt: new Date(epoch * 1000).toISOString(),
      commit: process.env.GITHUB_SHA ?? process.env.PARAKO_GIT_SHA ?? 'unknown',
    },
  };

  return assertValidManifest(manifest);
}

export function assertValidManifest(manifest) {
  const errors = validateManifest(manifest);
  if (errors.length > 0) {
    throw new Error(`Invalid release manifest: ${errors.join('; ')}`);
  }
  return manifest;
}

export function writeReleaseManifest(options) {
  const manifest = createReleaseManifest(options);
  const target = path.join(options.releaseDir, 'release-manifest.json');
  fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o644,
  });
  return target;
}

export function isMainModule(moduleUrl, argv = process.argv) {
  const scriptPath = argv[1];
  return (
    scriptPath !== undefined &&
    path.resolve(scriptPath) === fileURLToPath(moduleUrl)
  );
}

const isEntrypoint = isMainModule(import.meta.url);
export function main({
  argv = process.argv.slice(2),
  stdout = console.log,
  stderr = console.error,
  writeManifest = writeReleaseManifest,
} = {}) {
  const [releaseDir, version, architecture] = argv;
  if (!releaseDir || !version || !architecture) {
    stderr(
      'Usage: node scripts/create-release-manifest.mjs <release-dir> <version> <x64|arm64>'
    );
    return 2;
  }
  try {
    stdout(
      writeManifest({
        releaseDir: path.resolve(releaseDir),
        version,
        architecture,
      })
    );
    return 0;
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (isEntrypoint) {
  process.exitCode = main();
}
