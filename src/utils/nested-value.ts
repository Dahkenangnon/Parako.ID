/**
 * Shared helpers for reading/writing deeply nested object properties via dot-path strings.
 *
 * Used by:
 * - ConfigManager computed fields
 * - TenantSettingsOverrideService (field whitelist, constraint enforcement)
 * - AdminConfigurationController (secret reveal)
 *
 * @module utils/nested-value
 */

/**
 * Safely read a nested property from an object using a dot-path.
 *
 * @param obj - Object to read from
 * @param path - Dot-notation path (e.g. 'security.secrets.jwt_secret')
 * @returns Value at path, or undefined if any segment is missing
 */
export function getNestedValue(obj: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce(
      (current: unknown, key: string) =>
        current != null && typeof current === 'object'
          ? (current as Record<string, unknown>)[key]
          : undefined,
      obj
    );
}

/**
 * Safely set a nested property in an object using a dot-path.
 * Creates intermediate objects as needed.
 *
 * @param obj - Object to modify (mutated in place)
 * @param path - Dot-notation path (e.g. 'security.secrets.jwt_secret')
 * @param value - Value to set
 */
export function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const keys = path.split('.');
  const lastKey = keys.pop()!;
  const target = keys.reduce<Record<string, unknown>>((current, key) => {
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    return current[key] as Record<string, unknown>;
  }, obj);
  target[lastKey] = value;
}
