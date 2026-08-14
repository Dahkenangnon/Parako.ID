import { inject } from 'vitest';

// Runtime and repository suites share one migrated disposable database. CLI
// migration suites create separate child databases from the administrative URL.
process.env.CONTRACT_DATABASE_URL = inject('postgresqlRuntimeUrl');
