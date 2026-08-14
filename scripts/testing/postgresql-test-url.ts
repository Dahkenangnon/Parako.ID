export interface PostgresqlTestEnvironment {
  CONTRACT_DATABASE_URL?: string;
  STORAGE_POSTGRESQL_URL?: string;
  PARAKO_E2E_POSTGRESQL_URL?: string;
  DATABASE_URL?: string;
}

/**
 * Resolve the PostgreSQL URL shared by repository contracts, integration
 * suites, and the full browser matrix. Purpose-specific overrides win, while
 * the matrix URL makes `verify:all` self-contained after its prerequisite
 * check has validated the database connection.
 */
export function resolvePostgresqlTestUrl(
  environment: PostgresqlTestEnvironment
): string | undefined {
  for (const value of [
    environment.CONTRACT_DATABASE_URL,
    environment.STORAGE_POSTGRESQL_URL,
    environment.PARAKO_E2E_POSTGRESQL_URL,
    environment.DATABASE_URL,
  ]) {
    if (value?.trim()) return value.trim();
  }

  return undefined;
}
