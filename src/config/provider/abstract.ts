import { IConfigProvider } from '../../di/interfaces/config-provider.interface.js';

/**
 * Abstract base class for configuration providers
 * Defines the common interface that all configuration providers must implement
 * Note: Abstract classes are not injectable - only concrete implementations are
 *
 * @template T - The configuration type this provider returns
 */
export abstract class AbstractConfigProvider<
  T = any,
> implements IConfigProvider {
  /**
   * Load configuration from the provider's source
   * @returns Promise that resolves to the configuration object
   */
  abstract loadConfiguration(): Promise<T>;

  /**
   * Reload configuration from the provider's source
   * This method should force a fresh load and update the cache
   * @returns Promise that resolves to the updated configuration object
   */
  abstract reloadConfiguration(): Promise<T>;

  /**
   * Clear the configuration cache
   */
  abstract clearCache(): void;

  /**
   * Check if configuration is currently cached
   * @returns True if configuration is cached, false otherwise
   */
  abstract isCached(): boolean;

  /**
   * Get a specific configuration value by path
   * @param path - Dot-separated path to the configuration value
   * @param defaultValue - Default value if path is not found
   * @returns Configuration value or default value
   */
  abstract getConfigValue<V = any>(path: string, defaultValue?: V): V;

  /**
   * Get the provider name for identification
   * @returns The provider name
   */
  abstract getProviderName(): string;

  /**
   * Check if the provider is available/ready
   * @returns True if provider is available, false otherwise
   */
  abstract isAvailable(): Promise<boolean>;

  /**
   * Update configuration (only for database provider)
   * @param partial - Partial configuration to update
   * @returns Promise that resolves to the updated configuration
   */
  abstract updateConfig?(partial: Partial<T>): Promise<T>;
}
