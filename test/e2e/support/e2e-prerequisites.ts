export function validateE2ePostgresqlUrl(value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error(
      'PARAKO_E2E_POSTGRESQL_URL is required for PostgreSQL E2E cells'
    );
  }

  try {
    const url = new URL(value);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      url.pathname.length <= 1
    ) {
      throw new Error('invalid PostgreSQL URL');
    }
  } catch {
    throw new Error(
      'PARAKO_E2E_POSTGRESQL_URL must be a valid PostgreSQL administrator URL'
    );
  }

  return value;
}

export function requireE2ePostgresqlUrl(): string {
  return validateE2ePostgresqlUrl(process.env.PARAKO_E2E_POSTGRESQL_URL);
}
