import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'prisma/migrations/sqlite/20260805003000_oidc_store_tenant_model_primary_key/migration.sql'
);

describe('SQLite OIDC store composite-key migration', () => {
  let database: Database.Database;

  beforeEach(() => {
    database = new Database(':memory:');
    database.exec(`
      CREATE TABLE "oidc_store" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "model" TEXT NOT NULL,
        "payload" TEXT NOT NULL,
        "grant_id" TEXT,
        "user_code" TEXT,
        "uid" TEXT,
        "account_id" TEXT,
        "client_id" TEXT,
        "consumed" DATETIME,
        "expires_at" DATETIME,
        "tenant_id" TEXT NOT NULL DEFAULT 'default',
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    database
      .prepare(
        `INSERT INTO "oidc_store"
          ("id", "model", "payload", "tenant_id")
         VALUES (?, ?, ?, ?)`
      )
      .run('shared-id', 'AccessToken', '{"accountId":"account-a"}', 'tenant-a');
  });

  afterEach(() => {
    database.close();
  });

  it('preserves rows and scopes uniqueness by tenant, model, and id', () => {
    database.exec(readFileSync(migrationPath, 'utf8'));

    const insert = database.prepare(
      `INSERT INTO "oidc_store"
        ("id", "model", "payload", "tenant_id")
       VALUES (?, ?, ?, ?)`
    );
    insert.run(
      'shared-id',
      'AccessToken',
      '{"accountId":"account-b"}',
      'tenant-b'
    );
    insert.run(
      'shared-id',
      'RefreshToken',
      '{"accountId":"account-a"}',
      'tenant-a'
    );

    expect(
      database
        .prepare(
          `SELECT "tenant_id", "model", "id", "payload"
           FROM "oidc_store"
           ORDER BY "tenant_id", "model"`
        )
        .all()
    ).toEqual([
      {
        tenant_id: 'tenant-a',
        model: 'AccessToken',
        id: 'shared-id',
        payload: '{"accountId":"account-a"}',
      },
      {
        tenant_id: 'tenant-a',
        model: 'RefreshToken',
        id: 'shared-id',
        payload: '{"accountId":"account-a"}',
      },
      {
        tenant_id: 'tenant-b',
        model: 'AccessToken',
        id: 'shared-id',
        payload: '{"accountId":"account-b"}',
      },
    ]);

    expect(() =>
      insert.run('shared-id', 'AccessToken', '{}', 'tenant-a')
    ).toThrow(/UNIQUE constraint failed/);

    const tableInfo = database
      .prepare(`PRAGMA table_info("oidc_store")`)
      .all() as Array<{ name: string; pk: number }>;
    const primaryKeyColumns = tableInfo
      .filter(column => column.pk > 0)
      .sort((left, right) => left.pk - right.pk)
      .map(column => column.name);
    expect(primaryKeyColumns).toEqual(['tenant_id', 'model', 'id']);
  });
});
