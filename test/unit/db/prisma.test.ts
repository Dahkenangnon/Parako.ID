import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findPostgresqlPrismaClient } from '../../../src/db/prisma.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('PostgreSQL Prisma client discovery', () => {
  it('finds the generated client from a nested release directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parako-prisma-'));
    temporaryDirectories.push(root);
    const client = path.join(root, 'prisma/generated/postgresql/index.js');
    const nested = path.join(root, 'dist/src/db');
    fs.mkdirSync(path.dirname(client), { recursive: true });
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(client, '');

    expect(findPostgresqlPrismaClient(nested)).toBe(client);
  });

  it('fails clearly when the generated client is absent', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parako-prisma-'));
    temporaryDirectories.push(root);

    expect(() => findPostgresqlPrismaClient(root)).toThrow(
      'Generated PostgreSQL Prisma client is missing'
    );
  });
});
