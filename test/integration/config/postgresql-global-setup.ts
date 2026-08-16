import { resolve } from 'node:path';

import type { TestProject } from 'vitest/node';
import { applyTestingEnvironment } from '../../../scripts/testing/environment.js';

import { resolvePostgresqlTestUrl } from '../../../scripts/testing/postgresql-test-url.js';
import {
  applyPostgresqlMigrations,
  createPostgresqlTestDatabase,
} from '../../e2e/support/parako-instance.mjs';

declare module 'vitest' {
  export interface ProvidedContext {
    postgresqlRuntimeUrl: string;
  }
}

export default async function setup(project: TestProject) {
  applyTestingEnvironment(resolve(import.meta.dirname, '../../..'));
  const administrativeUrl = resolvePostgresqlTestUrl(process.env);
  if (!administrativeUrl) {
    throw new Error(
      'STORAGE_POSTGRESQL_URL or PARAKO_E2E_POSTGRESQL_URL is required'
    );
  }

  const fixture = await createPostgresqlTestDatabase(administrativeUrl);
  try {
    await applyPostgresqlMigrations(fixture.databaseUrl);
    project.provide('postgresqlRuntimeUrl', fixture.databaseUrl);
  } catch (error) {
    await fixture.drop();
    throw error;
  }

  return async () => await fixture.drop();
}
