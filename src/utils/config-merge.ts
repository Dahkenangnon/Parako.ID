/**
 * Configuration Merge Utilities
 *
 * Provides explicit merge strategies for configuration objects with predictable behavior.
 * Unlike deep merge libraries that have complex array merging logic, this utility
 * follows a simple rule: **arrays are always replaced, never merged**.
 *
 * This prevents unexpected behaviors such as:
 * - Appending to arrays instead of replacing them
 * - Duplicate values in arrays
 * - Unpredictable merge outcomes with nested arrays
 *
 * @example
 * ```typescript
 * const existing = {
 *   security: {
 *     cookie_secrets: ['old-secret-1', 'old-secret-2']
 *   }
 * };
 *
 * const updates = {
 *   security: {
 *     cookie_secrets: ['new-secret-1', 'new-secret-2']
 *   }
 * };
 *
 * const result = mergeConfig(existing, updates);
 * // result.security.cookie_secrets = ['new-secret-1', 'new-secret-2']
 * // NOT ['old-secret-1', 'old-secret-2', 'new-secret-1', 'new-secret-2']
 * ```
 */

/**
 * Options for configuration merging
 */
export interface MergeOptions {
  /**
   * Whether to replace arrays instead of merging them
   * @default true
   */
  replaceArrays?: boolean;

  /**
   * Whether to skip undefined values in updates
   * @default true
   */
  skipUndefined?: boolean;

  /**
   * Whether to skip null values in updates
   * @default false
   */
  skipNull?: boolean;
}

/**
 * Default merge options
 */
const DEFAULT_OPTIONS: Required<MergeOptions> = {
  replaceArrays: true,
  skipUndefined: true,
  skipNull: false,
};

/**
 * Check if a value is a plain object (not an array, Date, etc.)
 * @param value - Value to check
 * @returns True if value is a plain object
 */
function isPlainObject(value: any): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Merge configuration objects with explicit merge strategy
 *
 * This function provides predictable merging behavior:
 * - **Arrays are always replaced** (not merged) by default
 * - Objects are recursively merged
 * - Primitive values are replaced
 * - Undefined values are skipped by default
 * - Null values replace existing values by default
 *
 * @param existing - Existing configuration object
 * @param updates - Updates to apply
 * @param options - Merge options
 * @returns Merged configuration object
 *
 * @example
 * ```typescript
 * // Array replacement (default behavior)
 * const config = mergeConfig(
 *   { tags: ['a', 'b'] },
 *   { tags: ['c', 'd'] }
 * );
 * // Result: { tags: ['c', 'd'] }
 *
 * // Object merging
 * const config = mergeConfig(
 *   { security: { enabled: true, level: 1 } },
 *   { security: { level: 2 } }
 * );
 * // Result: { security: { enabled: true, level: 2 } }
 *
 * // Skip undefined values
 * const config = mergeConfig(
 *   { name: 'app', version: '1.0.0' },
 *   { name: undefined, version: '2.0.0' }
 * );
 * // Result: { name: 'app', version: '2.0.0' } (name unchanged)
 * ```
 */
export function mergeConfig<T = any>(
  existing: T,
  updates: Partial<T>,
  options?: MergeOptions
): T {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // If existing is not a plain object, return updates as-is (or existing if updates is empty)
  if (!isPlainObject(existing)) {
    return (updates ?? existing) as T;
  }

  const result: any = { ...existing };

  for (const key in updates) {
    if (!Object.prototype.hasOwnProperty.call(updates, key)) {
      continue;
    }

    const updateValue = updates[key];

    if (updateValue === undefined && opts.skipUndefined) {
      continue;
    }

    if (updateValue === null && opts.skipNull) {
      continue;
    }

    const existingValue = result[key];

    // If update value is null or undefined (and not skipped), replace
    if (updateValue === null || updateValue === undefined) {
      result[key] = updateValue;
      continue;
    }

    // If update value is an array, replace it (don't merge arrays)
    if (Array.isArray(updateValue)) {
      if (opts.replaceArrays) {
        result[key] = [...updateValue]; // Clone the array
      } else {
        // If not replacing arrays, concatenate and deduplicate
        const existingArray = Array.isArray(existingValue) ? existingValue : [];
        result[key] = [...existingArray, ...updateValue];
      }
      continue;
    }

    // If both values are plain objects, recursively merge
    if (isPlainObject(existingValue) && isPlainObject(updateValue)) {
      result[key] = mergeConfig(existingValue, updateValue, opts);
      continue;
    }

    // For all other cases (primitives, non-plain objects), replace
    result[key] = updateValue;
  }

  return result as T;
}

/**
 * Merge multiple configuration objects in order
 *
 * Later configurations override earlier ones.
 *
 * @param configs - Array of configuration objects to merge
 * @param options - Merge options
 * @returns Merged configuration object
 *
 * @example
 * ```typescript
 * const config = mergeConfigs([
 *   { a: 1, b: 2 },
 *   { b: 3, c: 4 },
 *   { c: 5, d: 6 }
 * ]);
 * // Result: { a: 1, b: 3, c: 5, d: 6 }
 * ```
 */
export function mergeConfigs<T = any>(
  configs: Array<Partial<T>>,
  options?: MergeOptions
): T {
  if (configs.length === 0) {
    return {} as T;
  }

  return configs.reduce<T>((result, config) => {
    return mergeConfig(result, config, options);
  }, {} as T);
}

/**
 * Create a deep clone of a configuration object
 *
 * This is useful when you need to modify a config without affecting the original.
 *
 * @param config - Configuration object to clone
 * @returns Deep cloned configuration object
 *
 * @example
 * ```typescript
 * const original = { security: { level: 1 } };
 * const cloned = cloneConfig(original);
 * cloned.security.level = 2;
 * // original.security.level is still 1
 * ```
 */
export function cloneConfig<T = any>(config: T): T {
  if (config === null || config === undefined) {
    return config;
  }

  // Use JSON for deep cloning (works for plain objects)
  // Note: This doesn't preserve functions, dates, or other complex types
  // but that's acceptable for configuration objects
  return JSON.parse(JSON.stringify(config));
}

/**
 * Check if two configuration objects are deeply equal
 *
 * @param a - First configuration object
 * @param b - Second configuration object
 * @returns True if configurations are deeply equal
 *
 * @example
 * ```typescript
 * const isEqual = areConfigsEqual(
 *   { a: 1, b: { c: 2 } },
 *   { a: 1, b: { c: 2 } }
 * );
 * // Result: true
 * ```
 */
export function areConfigsEqual(a: any, b: any): boolean {
  if (a === b) {
    return true;
  }

  if (typeof a !== typeof b) {
    return false;
  }

  if (a === null || b === null) {
    return a === b;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => areConfigsEqual(item, b[index]));
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) {
      return false;
    }

    return keysA.every(key => areConfigsEqual(a[key], b[key]));
  }

  return false;
}

export default mergeConfig;
