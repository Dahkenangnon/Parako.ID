/**
 * Environment variable interpolation for configuration files.
 *
 * Recursively walks a parsed config object and resolves `${VAR}` references
 * from `process.env`.
 *
 * Supported syntax:
 *   ${VAR}            — required, throws if not set or empty
 *   ${VAR:-default}   — uses `default` when VAR is not set or empty
 */

/** Keys that must never be traversed — prevents prototype pollution. */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Valid env var name: starts with a letter or underscore, followed by
 * letters, digits, or underscores. Matches POSIX and most shell conventions.
 */
const VALID_VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Recursively resolve ${ENV_VAR} references in config values.
 * Supports: ${VAR} (required — throws if not set), ${VAR:-default} (with fallback)
 *
 * @param obj   - The value to resolve (string, object, array, or primitive)
 * @param path  - Dotted path for error messages (e.g. "security.secrets.jwt")
 * @returns The resolved value with all ${VAR} references replaced
 */
export function resolveEnvVars(obj: unknown, path = ''): unknown {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
      const colonIdx = expr.indexOf(':-');
      if (colonIdx !== -1) {
        const varName = expr.slice(0, colonIdx).trim();
        validateVarName(varName, path);
        const defaultVal = expr.slice(colonIdx + 2);
        const envValue = process.env[varName];
        // Treat empty string the same as unset — use default
        return envValue !== undefined && envValue !== ''
          ? envValue
          : defaultVal;
      }
      const varName = expr.trim();
      validateVarName(varName, path);
      const value = process.env[varName];
      // Treat empty string the same as unset — fail fast
      if (value === undefined || value === '') {
        throw new Error(
          `Config error at "${path}": environment variable \${${varName}} is not set. ` +
            `Set it in .env or use \${${varName}:-default} for a fallback.`
        );
      }
      return value;
    });
  }

  if (Array.isArray(obj)) {
    return obj.map((v, i) => resolveEnvVars(v, `${path}[${i}]`));
  }

  if (obj && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([k]) => !DANGEROUS_KEYS.has(k))
        .map(([k, v]) => [k, resolveEnvVars(v, path ? `${path}.${k}` : k)])
    );
  }

  return obj;
}

/**
 * Validate that a variable name follows POSIX naming conventions.
 * Throws if the name is invalid — prevents injection via crafted config values.
 */
function validateVarName(name: string, path: string): void {
  if (!VALID_VAR_NAME.test(name)) {
    throw new Error(
      `Config error at "${path}": invalid variable name "${name}". ` +
        `Variable names must start with a letter or underscore, ` +
        `followed by letters, digits, or underscores.`
    );
  }
}
