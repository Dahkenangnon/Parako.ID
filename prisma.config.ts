/**
 * Prisma 7 config — SQLite adapter (default / dev / self-hosted)
 * Connection URL provided at runtime by the adapter factory (src/db/prisma.ts).
 */
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.sqlite.prisma',
  migrations: {
    path: 'prisma/migrations/sqlite',
  },
  datasource: {
    url: process.env['DATABASE_URL'] ?? 'file:./data/parako.db',
  },
});
