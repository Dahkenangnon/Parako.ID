#!/usr/bin/env node

import crypto from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { MongoClient, type Document } from 'mongodb';
import { createPrismaClient } from '../../src/db/prisma.js';
import {
  findProjectRoot,
  loadRuntimeEnvironment,
  resolveAdapterEnvironment,
} from './database.js';
import { isMainModule } from './shared/entrypoint.js';
import { getPackageInfo } from './shared/utils.js';

export function hashActivationToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function buildActivationUrl(baseUrl: string, token: string): string {
  const url = new URL('/auth/reset-password', baseUrl);
  url.searchParams.set('token', token);
  return url.toString();
}

function parseRoles(value: unknown): string[] {
  if (Array.isArray(value))
    return value.filter(role => typeof role === 'string');
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter(role => typeof role === 'string')
      : [];
  } catch {
    return [];
  }
}

interface ExistingAdmin extends Document {
  id?: string;
  email?: string | null;
  password?: string | null;
}

export function selectReissuableAdmin<T extends ExistingAdmin>(
  admins: T[],
  email: string
): T | undefined {
  if (admins.some(admin => Boolean(admin.password))) {
    throw new Error(
      'An activated administrator already exists. Manage administrators in the admin panel.'
    );
  }
  if (admins.length > 1 || (admins[0] && admins[0].email !== email)) {
    throw new Error(
      'A pending administrator activation already exists for another account.'
    );
  }
  return admins[0];
}

function bootstrapContext() {
  const root = process.env.PARAKO_ROOT
    ? findProjectRoot(process.env.PARAKO_ROOT)
    : findProjectRoot(path.dirname(fileURLToPath(import.meta.url)));
  loadRuntimeEnvironment(root);
  const resolved = resolveAdapterEnvironment(root);
  const deploymentUrl = process.env.DEPLOYMENT_URL ?? '';
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(deploymentUrl);
    if (parsedUrl.protocol !== 'https:' || !parsedUrl.hostname) {
      throw new Error('invalid HTTPS URL');
    }
  } catch {
    throw new Error(
      'DEPLOYMENT_URL must be configured with HTTPS and be a valid URL.'
    );
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw new Error('DEPLOYMENT_URL must not contain credentials.');
  }
  const serverPort = Number(process.env.DEPLOYMENT_SERVER_PORT ?? 9007);
  if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65_535) {
    throw new Error(
      'DEPLOYMENT_SERVER_PORT must be an integer between 1 and 65535.'
    );
  }
  return { root, deploymentUrl, serverPort, ...resolved };
}

type BootstrapContext = ReturnType<typeof bootstrapContext>;

async function createPrismaActivation(
  adapter: 'sqlite' | 'postgresql',
  email: string,
  tokenHash: string,
  expiresAt: Date,
  context: BootstrapContext
): Promise<void> {
  const sqlitePath = context.env.DATABASE_URL?.replace(/^file:/, '');
  const prisma = createPrismaClient({
    deployment: {
      environment: 'production',
      server: { port: context.serverPort },
    },
    storage: {
      adapter,
      sqlite: adapter === 'sqlite' ? { path: sqlitePath! } : undefined,
      postgresql:
        adapter === 'postgresql'
          ? { url: context.env.DATABASE_URL! }
          : undefined,
    },
    multiTenancy: { enabled: false },
  } as any) as any;

  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        roles: true,
        password: true,
      },
    });
    const admins = users.filter((user: any) =>
      parseRoles(user.roles).some(role =>
        ['admin', 'superadmin', 'platform_admin'].includes(role)
      )
    );
    const existing = selectReissuableAdmin(admins, email);
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          reset_password_token: tokenHash,
          reset_password_expires: expiresAt,
        },
      });
      return;
    }

    const now = new Date();
    await prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        email,
        username: `bootstrap-admin-${crypto.randomBytes(6).toString('hex')}`,
        roles: JSON.stringify(['admin']),
        email_verified: true,
        account_enabled: true,
        register_with: 'email',
        auth_provider: 'local',
        tenant_id: 'default',
        reset_password_token: tokenHash,
        reset_password_expires: expiresAt,
        created_at: now,
        updated_at: now,
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function createMongoActivation(
  email: string,
  tokenHash: string,
  expiresAt: Date
): Promise<void> {
  const uri = process.env.STORAGE_MONGODB_URI!;
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    await client.connect();
    const users = client.db().collection<ExistingAdmin>('users');
    const admins = await users
      .find({ roles: { $in: ['admin', 'superadmin', 'platform_admin'] } })
      .limit(2)
      .toArray();
    const existing = selectReissuableAdmin(admins, email);
    if (existing) {
      await users.updateOne(
        { _id: existing._id },
        {
          $set: {
            reset_password_token: tokenHash,
            reset_password_expires: expiresAt,
            updated_at: new Date(),
          },
        }
      );
      return;
    }
    const now = new Date();
    await users.insertOne({
      email: email.toLowerCase(),
      username: `bootstrap-admin-${crypto.randomBytes(6).toString('hex')}`,
      roles: ['admin'],
      email_verified: true,
      phone_number_verified: false,
      account_enabled: true,
      register_with: 'email',
      auth_provider: 'local',
      tenant_id: 'default',
      blocked_from: [],
      account_is_anonymized: false,
      reset_password_token: tokenHash,
      reset_password_expires: expiresAt,
      created_at: now,
      updated_at: now,
    });
  } finally {
    await client.close();
  }
}

export async function createAdminActivation(
  email: string,
  expiresMinutes: number
): Promise<string> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('A valid administrator email is required.');
  }
  if (
    !Number.isInteger(expiresMinutes) ||
    expiresMinutes < 5 ||
    expiresMinutes > 1440
  ) {
    throw new Error('Activation expiry must be between 5 and 1440 minutes.');
  }

  const context = bootstrapContext();
  const { adapter, deploymentUrl } = context;
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashActivationToken(token);
  const expiresAt = new Date(Date.now() + expiresMinutes * 60_000);

  if (adapter === 'mongodb') {
    await createMongoActivation(email.toLowerCase(), tokenHash, expiresAt);
  } else {
    await createPrismaActivation(
      adapter,
      email.toLowerCase(),
      tokenHash,
      expiresAt,
      context
    );
  }
  return buildActivationUrl(deploymentUrl, token);
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('parako-admin')
    .description('Create the first single-use administrator activation URL')
    .version(getPackageInfo().version);
  program
    .command('bootstrap')
    .requiredOption('--email <address>', 'Email for the first administrator')
    .option(
      '--expires-minutes <minutes>',
      'Activation lifetime in minutes',
      value => Number(value),
      60
    )
    .action(async options => {
      const url = await createAdminActivation(
        options.email,
        options.expiresMinutes
      );
      console.log('Single-use administrator activation URL:');
      console.log(url);
      console.log(
        'The URL expires automatically and is invalidated when the password is set.'
      );
    });
  return program;
}

/** Execute the administrator CLI and translate failures to process status. */
export async function runAdminCli(argv = process.argv): Promise<void> {
  try {
    await buildProgram().parseAsync(argv);
  } catch (error) {
    console.error(
      `Administrator bootstrap failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url)) {
  void runAdminCli();
}
