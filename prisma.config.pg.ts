/**
 * Prisma 7 config — PostgreSQL adapter (production / cloud)
 */
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.postgresql.prisma',
  migrations: {
    path: 'prisma/migrations/postgresql',
  },
  datasource: {
    url: process.env['DATABASE_URL'] ?? '',
  },
});
