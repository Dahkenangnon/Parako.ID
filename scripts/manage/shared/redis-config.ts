export interface RedisDiagnosticConfig {
  host: string;
  port: number;
  password?: string;
  database?: number;
}

/** Resolve and validate the Redis settings shared by diagnostics and test prerequisites. */
export function resolveRedisDiagnosticConfig(
  env: NodeJS.ProcessEnv = process.env
): RedisDiagnosticConfig {
  const host = env.REDIS_HOST?.trim();
  if (!host) throw new Error('REDIS_HOST is required.');

  const port = Number(env.REDIS_PORT ?? '6379');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('REDIS_PORT must be an integer between 1 and 65535.');
  }

  const database = Number(env.REDIS_DATABASE ?? '0');
  if (!Number.isSafeInteger(database) || database < 0) {
    throw new Error('REDIS_DATABASE must be a non-negative integer.');
  }

  return {
    host,
    port,
    password: env.REDIS_PASSWORD || undefined,
    database,
  };
}
