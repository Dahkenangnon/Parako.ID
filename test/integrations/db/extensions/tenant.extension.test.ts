/**
 * TDD — Prisma Tenant Extension
 *
 * Uses an isolated SQLite database to verify that the tenant extension
 * correctly injects tenant_id on writes and filters on reads.
 *
 * NOTE: All tenantContext.run() callbacks use `async () => await ...` because
 * Prisma's better-sqlite3 driver adapter (synchronous) can lose ALS context
 * when a sync callback returns a Promise. This is a known Prisma issue
 * (see prisma/prisma#25984). In production with @prisma/adapter-pg, the
 * standard `() => promise` pattern works correctly.
 *
 * NOTE: SET LOCAL for PostgreSQL RLS cannot be tested with SQLite.
 * Those paths are tested via the extension's internal branching and
 * verified separately in PostgreSQL integration tests.
 *
 * NOTE: After the ConfLayer refactor, Settings is GLOBAL (excluded from
 * tenant extension). CRUD isolation tests use TenantSettingsOverride instead.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import {
  createTenantExtension,
  TENANT_EXCLUDED_MODELS,
} from '../../../../src/db/extensions/tenant.extension.js';
import {
  tenantContext,
  DEFAULT_TENANT_ID,
} from '../../../../src/multi-tenancy/tenant-context.js';

// ─── Test DB Setup ───────────────────────────────────────────────────────────

const TEST_DB = join(tmpdir(), `parako-tenant-ext-${Date.now()}.db`);
const PRISMA_BIN = resolve(process.cwd(), 'node_modules', '.bin', 'prisma');

let basePrisma: PrismaClient;
let prisma: ReturnType<typeof applyExtension>;

function applyExtension(client: PrismaClient) {
  return client.$extends(
    createTenantExtension('sqlite')
  ) as unknown as PrismaClient;
}

beforeAll(async () => {
  // Push schema to temp SQLite DB
  execFileSync(
    PRISMA_BIN,
    ['db', 'push', '--config=prisma.config.ts', '--accept-data-loss'],
    {
      env: { ...process.env, DATABASE_URL: `file:${TEST_DB}` },
      stdio: 'pipe',
      cwd: process.cwd(),
    }
  );

  const adapter = new PrismaBetterSqlite3({ url: `file:${TEST_DB}` });
  basePrisma = new PrismaClient({ adapter });
  await basePrisma.$executeRaw`PRAGMA foreign_keys = ON`;

  // Apply tenant extension
  prisma = applyExtension(basePrisma);
});

afterAll(async () => {
  await basePrisma.$disconnect();
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
});

beforeEach(async () => {
  // Clean all tenant-scoped tables
  await basePrisma.tenantSettingsOverride.deleteMany({});
  await basePrisma.jwksKey.deleteMany({});
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Prisma Tenant Extension', () => {
  describe('module exports', () => {
    it('exports createTenantExtension function', () => {
      expect(typeof createTenantExtension).toBe('function');
    });

    it('exports TENANT_EXCLUDED_MODELS containing Tenant and Settings', () => {
      expect(TENANT_EXCLUDED_MODELS).toContain('Tenant');
      expect(TENANT_EXCLUDED_MODELS).toContain('Settings');
      expect(TENANT_EXCLUDED_MODELS.size).toBe(2);
    });
  });

  describe('create operations — tenant_id injection', () => {
    it('injects tenant_id from AsyncLocalStorage context on create', async () => {
      const record = await tenantContext.run(
        'acme',
        async () =>
          await prisma.tenantSettingsOverride.create({
            data: {
              key: 'test-key',
              value: '{}',
              version: '1.0.0',
            },
          })
      );

      // Verify via raw query (bypasses extension) that tenant_id was set
      const raw = await basePrisma.tenantSettingsOverride.findFirst({
        where: { id: record.id },
      });
      expect(raw!.tenant_id).toBe('acme');
    });

    it('uses DEFAULT_TENANT_ID when no context is active', async () => {
      const record = await prisma.tenantSettingsOverride.create({
        data: {
          key: 'default-key',
          value: '{}',
          version: '1.0.0',
        },
      });

      const raw = await basePrisma.tenantSettingsOverride.findFirst({
        where: { id: record.id },
      });
      expect(raw!.tenant_id).toBe(DEFAULT_TENANT_ID);
    });
  });

  describe('read operations — tenant isolation', () => {
    beforeEach(async () => {
      // Seed data for two tenants using raw client (bypasses extension)
      await basePrisma.$executeRaw`
        INSERT INTO tenant_settings_overrides (id, key, version, int_version, is_active, value, metadata, tenant_id, created_at, updated_at)
        VALUES
          ('s1', 'shared-key', '1.0.0', 1, 1, '{"alpha": true}', '{}', 'alpha', datetime('now'), datetime('now')),
          ('s2', 'shared-key', '1.0.0', 1, 1, '{"beta": true}', '{}', 'beta', datetime('now'), datetime('now')),
          ('s3', 'alpha-only', '1.0.0', 1, 1, '{"a": 1}', '{}', 'alpha', datetime('now'), datetime('now'))
      `;
    });

    it('findMany() only returns records for the active tenant', async () => {
      const alphaRecords = await tenantContext.run(
        'alpha',
        async () => await prisma.tenantSettingsOverride.findMany({})
      );
      expect(alphaRecords).toHaveLength(2);
      expect(alphaRecords.every((r: any) => r.tenant_id === 'alpha')).toBe(
        true
      );
    });

    it('findFirst() only matches records for the active tenant', async () => {
      // beta cannot see alpha-only record
      const record = await tenantContext.run(
        'beta',
        async () =>
          await prisma.tenantSettingsOverride.findFirst({
            where: { key: 'alpha-only' },
          })
      );
      expect(record).toBeNull();
    });

    it('count() respects tenant boundary', async () => {
      const alphaCount = await tenantContext.run(
        'alpha',
        async () => await prisma.tenantSettingsOverride.count({})
      );
      const betaCount = await tenantContext.run(
        'beta',
        async () => await prisma.tenantSettingsOverride.count({})
      );
      expect(alphaCount).toBe(2);
      expect(betaCount).toBe(1);
    });
  });

  describe('update operations — tenant isolation', () => {
    beforeEach(async () => {
      await basePrisma.$executeRaw`
        INSERT INTO tenant_settings_overrides (id, key, version, int_version, is_active, value, metadata, tenant_id, created_at, updated_at)
        VALUES
          ('u1', 'update-key', '1.0.0', 1, 1, '{"v": 1}', '{}', 'alpha', datetime('now'), datetime('now')),
          ('u2', 'update-key', '1.0.0', 1, 1, '{"v": 2}', '{}', 'beta', datetime('now'), datetime('now'))
      `;
    });

    it('updateMany() only affects the active tenant', async () => {
      await tenantContext.run(
        'beta',
        async () =>
          await prisma.tenantSettingsOverride.updateMany({
            where: { key: 'update-key' },
            data: { value: '{"updated": true}' },
          })
      );

      // alpha's record should be untouched
      const alphaRaw = await basePrisma.tenantSettingsOverride.findFirst({
        where: { id: 'u1' },
      });
      expect(alphaRaw!.value).toBe('{"v": 1}');

      // beta's record should be updated
      const betaRaw = await basePrisma.tenantSettingsOverride.findFirst({
        where: { id: 'u2' },
      });
      expect(betaRaw!.value).toBe('{"updated": true}');
    });
  });

  describe('delete operations — tenant isolation', () => {
    beforeEach(async () => {
      await basePrisma.$executeRaw`
        INSERT INTO tenant_settings_overrides (id, key, version, int_version, is_active, value, metadata, tenant_id, created_at, updated_at)
        VALUES
          ('d1', 'delete-key', '1.0.0', 1, 1, '{"a": 1}', '{}', 'alpha', datetime('now'), datetime('now')),
          ('d2', 'delete-key', '1.0.0', 1, 1, '{"b": 1}', '{}', 'beta', datetime('now'), datetime('now'))
      `;
    });

    it('deleteMany() only removes records for the active tenant', async () => {
      await tenantContext.run(
        'alpha',
        async () =>
          await prisma.tenantSettingsOverride.deleteMany({
            where: { key: 'delete-key' },
          })
      );

      // alpha's record should be gone
      const alphaRaw = await basePrisma.tenantSettingsOverride.findFirst({
        where: { id: 'd1' },
      });
      expect(alphaRaw).toBeNull();

      // beta's record should remain
      const betaRaw = await basePrisma.tenantSettingsOverride.findFirst({
        where: { id: 'd2' },
      });
      expect(betaRaw).not.toBeNull();
    });
  });

  describe('JwksKey — already has tenant_id', () => {
    it('applies tenant scoping to JwksKey (each tenant has own keys)', async () => {
      // Create JWKS keys for two tenants
      await tenantContext.run(
        'tenant-a',
        async () =>
          await prisma.jwksKey.create({
            data: {
              kid: 'key-a',
              alg: 'RS256',
              use: 'sig',
              status: 'active',
              promoted: true,
              encrypted_private_key: 'enc-a',
              public_key: 'pub-a',
            },
          })
      );
      await tenantContext.run(
        'tenant-b',
        async () =>
          await prisma.jwksKey.create({
            data: {
              kid: 'key-b',
              alg: 'RS256',
              use: 'sig',
              status: 'active',
              promoted: true,
              encrypted_private_key: 'enc-b',
              public_key: 'pub-b',
            },
          })
      );

      // tenant-a can only see its own key
      const aKeys = await tenantContext.run(
        'tenant-a',
        async () => await prisma.jwksKey.findMany({})
      );
      expect(aKeys).toHaveLength(1);
      expect(aKeys[0].kid).toBe('key-a');

      // tenant-b can only see its own key
      const bKeys = await tenantContext.run(
        'tenant-b',
        async () => await prisma.jwksKey.findMany({})
      );
      expect(bKeys).toHaveLength(1);
      expect(bKeys[0].kid).toBe('key-b');
    });
  });

  describe('Tenant model — exclusion', () => {
    it('does NOT scope Tenant model queries (it IS the tenant registry)', async () => {
      // Create tenants from different contexts — both should be visible globally
      await tenantContext.run(
        'acme',
        async () =>
          await prisma.tenant.create({
            data: { slug: 'acme', display_name: 'Acme Corp' },
          })
      );
      await tenantContext.run(
        'globex',
        async () =>
          await prisma.tenant.create({
            data: { slug: 'globex', display_name: 'Globex Corp' },
          })
      );

      // From any context, all tenants should be visible
      const allTenants = await tenantContext.run(
        'acme',
        async () => await prisma.tenant.findMany({})
      );
      expect(allTenants.length).toBeGreaterThanOrEqual(2);
      expect(allTenants.some((t: any) => t.slug === 'acme')).toBe(true);
      expect(allTenants.some((t: any) => t.slug === 'globex')).toBe(true);

      // Cleanup
      await basePrisma.tenant.deleteMany({});
    });
  });

  describe('Settings model — exclusion (global after ConfLayer)', () => {
    it('does NOT scope Settings model queries (Settings is global)', async () => {
      // Create settings from different contexts — both should be visible globally
      await tenantContext.run(
        'tenant-a',
        async () =>
          await prisma.settings.create({
            data: {
              key: 'setting-a',
              value: '{"a": true}',
              version: '1.0.0',
              schema_version: '1.0.0',
            },
          })
      );
      await tenantContext.run(
        'tenant-b',
        async () =>
          await prisma.settings.create({
            data: {
              key: 'setting-b',
              value: '{"b": true}',
              version: '1.0.0',
              schema_version: '1.0.0',
            },
          })
      );

      // From any context, all settings should be visible (no tenant filtering)
      const allSettings = await tenantContext.run(
        'tenant-a',
        async () => await prisma.settings.findMany({})
      );
      expect(allSettings.length).toBeGreaterThanOrEqual(2);
      expect(allSettings.some((s: any) => s.key === 'setting-a')).toBe(true);
      expect(allSettings.some((s: any) => s.key === 'setting-b')).toBe(true);

      // Cleanup
      await basePrisma.settings.deleteMany({});
    });
  });

  describe('cross-tenant isolation (end-to-end)', () => {
    it('tenant A cannot read, update, or delete tenant B data', async () => {
      // Create as tenant-x using TenantSettingsOverride (tenant-scoped)
      await tenantContext.run(
        'tenant-x',
        async () =>
          await prisma.tenantSettingsOverride.create({
            data: {
              key: 'secret-x',
              value: '{"secret": true}',
              version: '1.0.0',
            },
          })
      );

      // tenant-y cannot find it
      const found = await tenantContext.run(
        'tenant-y',
        async () =>
          await prisma.tenantSettingsOverride.findFirst({
            where: { key: 'secret-x' },
          })
      );
      expect(found).toBeNull();

      // tenant-y cannot count it
      const count = await tenantContext.run(
        'tenant-y',
        async () =>
          await prisma.tenantSettingsOverride.count({
            where: { key: 'secret-x' },
          })
      );
      expect(count).toBe(0);

      // tenant-y cannot update it
      const updateResult = await tenantContext.run(
        'tenant-y',
        async () =>
          await prisma.tenantSettingsOverride.updateMany({
            where: { key: 'secret-x' },
            data: { value: '{"pwned": true}' },
          })
      );
      expect(updateResult.count).toBe(0);

      // tenant-y cannot delete it
      const deleteResult = await tenantContext.run(
        'tenant-y',
        async () =>
          await prisma.tenantSettingsOverride.deleteMany({
            where: { key: 'secret-x' },
          })
      );
      expect(deleteResult.count).toBe(0);

      // tenant-x can still find it (untouched)
      const verified = await tenantContext.run(
        'tenant-x',
        async () =>
          await prisma.tenantSettingsOverride.findFirst({
            where: { key: 'secret-x' },
          })
      );
      expect(verified).not.toBeNull();
      expect(verified!.value).toBe('{"secret": true}');
    });
  });
});
