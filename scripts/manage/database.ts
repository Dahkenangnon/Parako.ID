#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { MongoClient } from 'mongodb';
import { isMainModule } from './shared/entrypoint.js';
import { getPackageInfo } from './shared/utils.js';

export type DatabaseAdapter = 'sqlite' | 'postgresql' | 'mongodb';

const BASELINE_MIGRATION = '20260714000000_baseline';
const MONGODB_LEDGER = '_parako_migrations';

export function findProjectRoot(start = process.cwd()): string {
  let current = path.resolve(start);
  while (true) {
    if (
      fs.existsSync(path.join(current, 'package.json')) &&
      fs.existsSync(path.join(current, 'prisma'))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(
        'Could not locate a Parako.ID release root. Set PARAKO_ROOT explicitly.'
      );
    }
    current = parent;
  }
}

export function loadRuntimeEnvironment(root: string): void {
  const envFile =
    process.env.PARAKO_ENV_FILE ?? path.join(root, 'runtime', '.env');
  if (fs.existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
}

export function resolveAdapterEnvironment(root: string): {
  adapter: DatabaseAdapter;
  env: NodeJS.ProcessEnv;
  config?: string;
} {
  const adapter = (process.env.STORAGE_ADAPTER ?? 'sqlite') as DatabaseAdapter;
  if (!['sqlite', 'postgresql', 'mongodb'].includes(adapter)) {
    throw new Error(
      `Unsupported STORAGE_ADAPTER "${adapter}". Expected sqlite, postgresql, or mongodb.`
    );
  }

  const env = { ...process.env };
  if (adapter === 'sqlite') {
    const configuredPath =
      process.env.STORAGE_SQLITE_PATH ?? './runtime/data/parako.db';
    const absolutePath = path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(root, configuredPath);
    env.DATABASE_URL = process.env.DATABASE_URL ?? `file:${absolutePath}`;
    return { adapter, env, config: 'prisma.config.ts' };
  }

  if (adapter === 'postgresql') {
    const url =
      process.env.STORAGE_POSTGRESQL_URL ?? process.env.DATABASE_URL ?? '';
    if (!url) {
      throw new Error(
        'STORAGE_POSTGRESQL_URL is required when STORAGE_ADAPTER=postgresql.'
      );
    }
    if (!/^postgres(?:ql)?:\/\//u.test(url)) {
      throw new Error('PostgreSQL URL must use postgres:// or postgresql://.');
    }
    try {
      const parsedUrl = new URL(url);
      if (!parsedUrl.hostname) {
        throw new Error('missing host');
      }
    } catch {
      throw new Error('STORAGE_POSTGRESQL_URL must be a valid URL.');
    }
    env.DATABASE_URL = url;
    return { adapter, env, config: 'prisma.config.pg.ts' };
  }

  const uri = process.env.STORAGE_MONGODB_URI;
  if (!uri) {
    throw new Error(
      'STORAGE_MONGODB_URI is required when STORAGE_ADAPTER=mongodb.'
    );
  }
  if (!/^mongodb(?:\+srv)?:\/\//u.test(uri)) {
    throw new Error('MongoDB URI must use mongodb:// or mongodb+srv://.');
  }
  try {
    new MongoClient(uri);
  } catch {
    throw new Error('STORAGE_MONGODB_URI must be a valid URI.');
  }
  return { adapter, env };
}

function runPrisma(
  root: string,
  config: string,
  env: NodeJS.ProcessEnv,
  args: string[]
): void {
  const prismaEntrypoint = path.join(
    root,
    'node_modules',
    'prisma',
    'build',
    'index.js'
  );
  if (!fs.existsSync(prismaEntrypoint)) {
    throw new Error(
      `Prisma CLI is missing from this release: ${prismaEntrypoint}`
    );
  }

  const result = spawnSync(
    process.execPath,
    [prismaEntrypoint, ...args, '--config', path.join(root, config)],
    {
      cwd: root,
      env,
      stdio: 'inherit',
    }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Prisma exited with status ${result.status ?? 'unknown'}.`);
  }
}

async function withMongo<T>(
  operation: (client: MongoClient) => Promise<T>
): Promise<T> {
  const client = new MongoClient(process.env.STORAGE_MONGODB_URI!, {
    serverSelectionTimeoutMS: 10_000,
  });
  try {
    await client.connect();
    return await operation(client);
  } finally {
    await client.close();
  }
}

async function ensureMongoMigrationLedger(): Promise<void> {
  await withMongo(async client => {
    const db = client.db();
    await db.command({ ping: 1 });
    const ledger = db.collection(MONGODB_LEDGER);
    await ledger.createIndex({ id: 1 }, { unique: true });
  });
}

async function showMongoMigrationStatus(): Promise<void> {
  await withMongo(async client => {
    const db = client.db();
    await db.command({ ping: 1 });
    const collections = await db
      .listCollections({ name: MONGODB_LEDGER }, { nameOnly: true })
      .toArray();
    if (collections.length === 0) {
      console.log('MongoDB is reachable; migration ledger is not initialized.');
      return;
    }
    const applied = await db
      .collection(MONGODB_LEDGER)
      .find({}, { projection: { _id: 0, id: 1, appliedAt: 1 } })
      .sort({ id: 1 })
      .toArray();
    console.log(
      `MongoDB is reachable; ${applied.length} application migration(s) recorded.`
    );
    for (const migration of applied) {
      console.log(`  ${migration.id}  ${migration.appliedAt ?? ''}`);
    }
  });
}

function context(): ReturnType<typeof resolveAdapterEnvironment> & {
  root: string;
} {
  const root = process.env.PARAKO_ROOT
    ? findProjectRoot(process.env.PARAKO_ROOT)
    : findProjectRoot(path.dirname(fileURLToPath(import.meta.url)));
  loadRuntimeEnvironment(root);
  return { root, ...resolveAdapterEnvironment(root) };
}

export async function migrateDatabase(): Promise<void> {
  const { root, adapter, env, config } = context();
  if (adapter === 'mongodb') {
    await ensureMongoMigrationLedger();
    console.log(
      'MongoDB migration ledger is ready; no migrations are pending.'
    );
    return;
  }
  runPrisma(root, config!, env, ['migrate', 'deploy']);
}

export async function databaseStatus(): Promise<void> {
  const { root, adapter, env, config } = context();
  if (adapter === 'mongodb') {
    await showMongoMigrationStatus();
    return;
  }
  runPrisma(root, config!, env, ['migrate', 'status']);
}

export async function baselineExistingDatabase(
  confirm: boolean
): Promise<void> {
  if (!confirm) {
    throw new Error(
      'Refusing to baseline without --confirm-existing-schema. This is only for databases previously created with prisma db push and already matching this release.'
    );
  }
  const { root, adapter, env, config } = context();
  if (adapter === 'mongodb') {
    throw new Error('MongoDB does not use the Prisma baseline command.');
  }
  runPrisma(root, config!, env, [
    'migrate',
    'resolve',
    '--applied',
    BASELINE_MIGRATION,
  ]);
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('parako-database')
    .description('Inspect and apply Parako.ID database migrations')
    .version(getPackageInfo().version);

  program
    .command('status')
    .description('Show database reachability and migration status')
    .action(databaseStatus);

  program
    .command('migrate')
    .description('Apply all pending migrations and stop on the first failure')
    .action(migrateDatabase);

  program
    .command('baseline')
    .description(
      'Record the baseline on an existing schema created by prisma db push'
    )
    .option(
      '--confirm-existing-schema',
      'Confirm the current database already matches the baseline schema'
    )
    .action(options =>
      baselineExistingDatabase(options.confirmExistingSchema === true)
    );

  return program;
}

/** Execute the database CLI and translate failures to process status. */
export async function runDatabaseCli(argv = process.argv): Promise<void> {
  try {
    await buildProgram().parseAsync(argv);
  } catch (error) {
    console.error(
      `Database command failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url)) {
  void runDatabaseCli();
}
