/**
 * Prisma 7 config — SQLite adapter (default / dev / self-hosted).
 *
 * Direct Prisma commands run before the application bootstrap provider, so
 * they must load the operator-owned runtime environment themselves. Otherwise
 * `pnpm db:push` can migrate the default database while the application opens
 * the custom STORAGE_SQLITE_PATH from runtime/.env.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

type Environment = Record<string, string | undefined>;

function parseEnvironmentFile(filePath: string): Environment {
  return existsSync(filePath)
    ? dotenv.parse(readFileSync(filePath, 'utf8'))
    : {};
}

export function resolveSqliteDatasourceUrl(
  root = process.env.PARAKO_ROOT ?? dirname(fileURLToPath(import.meta.url)),
  environment: Environment = process.env
): string {
  if (environment.DATABASE_URL) return environment.DATABASE_URL;

  const envFile = environment.PARAKO_ENV_FILE;
  const runtimeEnvironment = envFile
    ? parseEnvironmentFile(envFile)
    : {
        ...parseEnvironmentFile(resolve(root, 'runtime/.env')),
        ...parseEnvironmentFile(resolve(root, 'runtime/.env.local')),
      };
  const configuredPath =
    environment.STORAGE_SQLITE_PATH ??
    runtimeEnvironment.STORAGE_SQLITE_PATH ??
    './runtime/data/parako.db';
  const absolutePath = isAbsolute(configuredPath)
    ? configuredPath
    : resolve(root, configuredPath);

  return `file:${absolutePath}`;
}

const projectRoot = resolve(
  process.env.PARAKO_ROOT ?? dirname(fileURLToPath(import.meta.url))
);

export default defineConfig({
  schema: 'prisma/schema.sqlite.prisma',
  migrations: {
    path: 'prisma/migrations/sqlite',
  },
  datasource: {
    url: resolveSqliteDatasourceUrl(projectRoot),
  },
});
