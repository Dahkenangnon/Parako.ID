import { Container } from 'inversify';
import { TYPES } from './types.js';

/**
 * Symbols that are not services and should be skipped during validation.
 * These are schemas, constants, or configuration values that don't need DI bindings.
 */
const NON_SERVICE_SYMBOLS = new Set([
  'AppConfigSchema',
  'BootstrapConfigSchema',
  'DefaultFullConfig',
]);

/**
 * Symbols that are optional and depend on configuration.
 * Redis adapter services are only bound when using Redis storage.
 */
const OPTIONAL_SYMBOLS = new Set([
  // Redis Pub/Sub - optional, degrades gracefully when Redis unavailable
  'RedisPubSubService',
  // Repository layer - bound conditionally based on storage.adapter config
  'UserRepository',
  'ActivityRepository',
  'SettingsRepository',
  'SocialIntegrationRepository',
  // PrismaClient - only bound when adapter !== 'mongodb'
  'PrismaClient',
  // Multi-tenancy - optional, only used when features.multi_tenancy.enabled
  'TenantActivityRedisClient',
  'ProviderFactory',
  // _ops infrastructure - optional, only bound when Redis is available
  'OpsRedisClient',
]);

/**
 * Result of container validation
 */
export interface ContainerValidationResult {
  valid: boolean;
  boundCount: number;
  missingCount: number;
  missingSymbols: string[];
  skippedCount: number;
}

/**
 * Validate that all required symbols are bound in the DI container
 *
 * This validation should be run at application startup to catch
 * missing bindings early (fail-fast) rather than at runtime.
 *
 * @param container - The InversifyJS container to validate
 * @returns Validation result with details about bound and missing symbols
 */
export function validateContainer(
  container: Container
): ContainerValidationResult {
  const allSymbols = Object.entries(TYPES);
  const missingSymbols: string[] = [];
  let boundCount = 0;
  let skippedCount = 0;

  for (const [name, symbol] of allSymbols) {
    if (NON_SERVICE_SYMBOLS.has(name)) {
      skippedCount++;
      continue;
    }

    if (OPTIONAL_SYMBOLS.has(name)) {
      skippedCount++;
      continue;
    }

    try {
      if (container.isBound(symbol)) {
        boundCount++;
      } else {
        missingSymbols.push(name);
      }
    } catch {
      // Symbol check failed - treat as missing
      missingSymbols.push(name);
    }
  }

  return {
    valid: missingSymbols.length === 0,
    boundCount,
    missingCount: missingSymbols.length,
    missingSymbols,
    skippedCount,
  };
}

/**
 * Validate container and throw error if validation fails
 *
 * This is a convenience function that throws an error with details
 * about missing bindings if validation fails.
 *
 * @param container - The InversifyJS container to validate
 * @throws Error if any required symbols are not bound
 */
export function assertContainerValid(container: Container): void {
  const result = validateContainer(container);

  if (!result.valid) {
    throw new Error(
      `DI container validation failed: ${result.missingCount} missing bindings.\n` +
        `Missing symbols: ${result.missingSymbols.join(', ')}`
    );
  }
}
