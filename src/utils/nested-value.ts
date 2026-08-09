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

const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

function parseSafePath(path: string): string[] {
  const keys = path.split('.');
  if (keys.some(key => key.length === 0)) {
    throw new TypeError(
      'Nested property path must contain only non-empty segments'
    );
  }
  const unsafeKey = keys.find(key => UNSAFE_PATH_SEGMENTS.has(key));
  if (unsafeKey) {
    throw new TypeError(`Unsafe nested property path segment: ${unsafeKey}`);
  }
  return keys;
}

/**
 * Safely read a nested property from an object using a dot-path.
 *
 * @param obj - Object to read from
 * @param path - Dot-notation path (e.g. 'security.secrets.jwt_secret')
 * @returns Value at path, or undefined if any segment is missing
 */
export function getNestedValue(obj: unknown, path: string): unknown {
  return parseSafePath(path).reduce(
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
  const keys = parseSafePath(path);
  const lastKey = keys.pop()!;
  const target = keys.reduce<Record<string, unknown>>((current, key) => {
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    return current[key] as Record<string, unknown>;
  }, obj);
  target[lastKey] = value;
}
