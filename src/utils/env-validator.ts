/**
 * Environment variable validation utility.
 *
 * Declares required/optional env vars and validates `.env` content at startup,
 * before config file parsing, to ensure all referenced env vars exist.
 */

export interface EnvVarSpec {
  name: string;
  required: boolean;
  description: string;
  validator?: (value: string) => boolean;
}

/**
 * Validates that required environment variables are set.
 * Called after dotenv loads .env into process.env, before config file parsing.
 *
 * @param specs - Array of env var specifications to validate
 * @throws Error listing all missing or invalid variables
 */
export function validateEnvVars(specs: EnvVarSpec[]): void {
  const missing: string[] = [];

  for (const spec of specs) {
    const value = process.env[spec.name];

    if (spec.required && (value === undefined || value === '')) {
      missing.push(`  ${spec.name} — ${spec.description}`);
      continue;
    }

    if (value && spec.validator && !spec.validator(value)) {
      missing.push(`  ${spec.name} — invalid value (${spec.description})`);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing or invalid environment variables:\n${missing.join('\n')}\n` +
        `Set them in .env or .env.local before starting.`
    );
  }
}

/** Standard env vars that Parako.ID expects */
export const PARAKO_ENV_SPECS: EnvVarSpec[] = [
  // Bootstrap (already validated by BootstrapConfigSchema, but declared for documentation)
  {
    name: 'STORAGE_ADAPTER',
    required: false,
    description: 'Storage backend: mongodb|sqlite|postgresql',
  },
  {
    name: 'STORAGE_MONGODB_URI',
    required: false,
    description: 'MongoDB connection URI',
  },
  {
    name: 'STORAGE_SQLITE_PATH',
    required: false,
    description: 'SQLite database file path',
  },
  {
    name: 'STORAGE_POSTGRESQL_URL',
    required: false,
    description: 'PostgreSQL connection URL',
  },
  // Secrets (required when using file config with ${VAR} interpolation)
  {
    name: 'JWT_SECRET',
    required: false,
    description: 'JWT signing secret (min 32 chars)',
    validator: (v: string) => v.length >= 32,
  },
  {
    name: 'COOKIE_SECRET_1',
    required: false,
    description: 'Cookie encryption secret 1 (min 16 chars)',
    validator: (v: string) => v.length >= 16,
  },
  {
    name: 'COOKIE_SECRET_2',
    required: false,
    description: 'Cookie encryption secret 2 (min 16 chars)',
    validator: (v: string) => v.length >= 16,
  },
  {
    name: 'ENCRYPTION_KEY',
    required: false,
    description: 'AES-256 encryption key (64 hex chars)',
    validator: (v: string) => v.length === 64 && /^[0-9a-fA-F]+$/.test(v),
  },
];
