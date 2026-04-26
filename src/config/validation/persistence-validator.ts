/**
 * Persistence Validation Utilities
 *
 * Ensures that bootstrap-only fields are never persisted to the database.
 * Bootstrap fields (environment, port, database URI) must only come from .env
 * and should never be stored in or loaded from the database.
 *
 * This separation ensures:
 * - Infrastructure settings remain immutable via UI
 * - Environment-specific config stays with deployment
 * - Critical settings cannot be accidentally changed
 */

import { BOOTSTRAP_ONLY_FIELDS } from '../types.js';

/**
 * Result of bootstrap field validation
 */
export interface BootstrapValidationResult {
  /** Whether the config is valid (contains no bootstrap fields) */
  isValid: boolean;
  /** List of bootstrap field paths found in the config */
  bootstrapFieldsFound: string[];
}

/**
 * Get nested value from object using dot notation path
 *
 * @param obj - The object to traverse
 * @param path - Dot-separated path (e.g., 'deployment.server.port')
 * @returns The value at the path, or undefined if not found
 *
 * @example
 * getNestedValue({ deployment: { server: { port: 3000 } } }, 'deployment.server.port') // 3000
 */
function getNestedValue(obj: any, path: string): any {
  if (!obj || !path) return undefined;

  const keys = path.split('.');
  let current = obj;

  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      current = current[key];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Delete nested value from object using dot notation path
 * Removes the field and cleans up empty parent objects
 *
 * @param obj - The object to modify
 * @param path - Dot-separated path (e.g., 'deployment.server.port')
 *
 * @example
 * const config = { deployment: { server: { port: 3000 } } };
 * deleteNestedValue(config, 'deployment.server.port');
 * // config.deployment.server.port is now undefined
 */
function deleteNestedValue(obj: any, path: string): void {
  if (!obj || !path) return;

  const keys = path.split('.');
  const lastKey = keys.pop();

  if (!lastKey) return;

  let current = obj;
  const parents: any[] = [];

  // Traverse to parent object
  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      parents.push({ obj: current, key });
      current = current[key];
    } else {
      return; // Path doesn't exist
    }
  }

  if (current && typeof current === 'object' && lastKey in current) {
    delete current[lastKey];
  }
}

/**
 * Validate that a config object does not contain bootstrap-only fields
 *
 * Bootstrap fields are infrastructure settings that must come from .env only:
 * - deployment.environment
 * - deployment.server.port
 * - storage.mongodb.uri
 * - storage.adapter
 *
 * These fields should never be persisted to the database.
 *
 * @param config - Configuration object to validate
 * @returns Validation result with list of bootstrap fields found (if any)
 *
 * @example
 * const result = validateNonBootstrapConfig({ deployment: { environment: 'production' } });
 * // result.isValid === false
 * // result.bootstrapFieldsFound === ['deployment.environment']
 */
export function validateNonBootstrapConfig(
  config: any
): BootstrapValidationResult {
  if (!config || typeof config !== 'object') {
    return { isValid: true, bootstrapFieldsFound: [] };
  }

  const bootstrapFieldsFound: string[] = [];

  for (const fieldPath of BOOTSTRAP_ONLY_FIELDS) {
    const value = getNestedValue(config, fieldPath);

    if (value !== undefined) {
      bootstrapFieldsFound.push(fieldPath);
    }
  }

  return {
    isValid: bootstrapFieldsFound.length === 0,
    bootstrapFieldsFound,
  };
}

/**
 * Remove all bootstrap-only fields from a config object
 *
 * Creates a sanitized copy of the config with bootstrap fields removed.
 * This ensures that bootstrap fields are never accidentally persisted
 * to the database.
 *
 * @param config - Configuration object to sanitize
 * @returns Sanitized config object without bootstrap fields
 *
 * @example
 * const config = {
 *   deployment: { environment: 'production', server: { port: 3000 } },
 *   application: { title: 'My App' }
 * };
 *
 * const sanitized = stripBootstrapFields(config);
 * // sanitized.deployment.environment is removed
 * // sanitized.deployment.server.port is removed
 * // sanitized.application.title remains
 */
export function stripBootstrapFields(config: any): any {
  if (!config || typeof config !== 'object') {
    return config;
  }

  // Deep clone to avoid mutating original
  const sanitized = JSON.parse(JSON.stringify(config));

  for (const fieldPath of BOOTSTRAP_ONLY_FIELDS) {
    deleteNestedValue(sanitized, fieldPath);
  }

  return sanitized;
}

/**
 * Check if a specific field path is a bootstrap-only field
 *
 * @param fieldPath - Dot-separated field path to check
 * @returns True if the field is bootstrap-only, false otherwise
 *
 * @example
 * isBootstrapField('deployment.environment') // true
 * isBootstrapField('application.title') // false
 */
export function isBootstrapField(fieldPath: string): boolean {
  return BOOTSTRAP_ONLY_FIELDS.includes(fieldPath as any);
}
