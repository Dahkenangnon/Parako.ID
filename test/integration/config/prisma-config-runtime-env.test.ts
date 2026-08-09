import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();
const PRISMA_BIN = path.join(
  PROJECT_ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'prisma.cmd' : 'prisma'
);

describe('Prisma SQLite runtime environment', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('pushes the schema to STORAGE_SQLITE_PATH from runtime/.env', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'parako-prisma-config-'));
    tempRoots.push(root);

    mkdirSync(path.join(root, 'prisma'), { recursive: true });
    mkdirSync(path.join(root, 'runtime'), { recursive: true });
    copyFileSync(
      path.join(PROJECT_ROOT, 'prisma.config.ts'),
      path.join(root, 'prisma.config.ts')
    );
    copyFileSync(
      path.join(PROJECT_ROOT, 'prisma', 'schema.sqlite.prisma'),
      path.join(root, 'prisma', 'schema.sqlite.prisma')
    );
    symlinkSync(
      path.join(PROJECT_ROOT, 'node_modules'),
      path.join(root, 'node_modules')
    );
    writeFileSync(
      path.join(root, 'runtime', '.env'),
      'STORAGE_ADAPTER=sqlite\nSTORAGE_SQLITE_PATH=./data/custom.db\n'
    );

    const env = { ...process.env };
    delete env.DATABASE_URL;
    delete env.STORAGE_SQLITE_PATH;
    delete env.PARAKO_ENV_FILE;
    delete env.PARAKO_ROOT;

    execFileSync(
      PRISMA_BIN,
      ['db', 'push', '--config', path.join(root, 'prisma.config.ts')],
      { cwd: root, env, stdio: 'pipe' }
    );

    expect(existsSync(path.join(root, 'data', 'custom.db'))).toBe(true);
    expect(existsSync(path.join(root, 'runtime', 'data', 'parako.db'))).toBe(
      false
    );
  }, 30_000);
});
