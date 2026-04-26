/**
 * Interface for configuration providers
 * Defines the contract that all configuration providers must implement
 *
 * @template T - The configuration type this provider returns
 */
export interface IConfigProvider<T = any> {
  /**
   * Load configuration from the provider's source
   * @returns Promise that resolves to the configuration object
   */
  loadConfiguration(): Promise<T>;

  /**
   * Reload configuration from the provider's source
   * This method should force a fresh load and update the cache
   * @returns Promise that resolves to the updated configuration object
   */
  reloadConfiguration(): Promise<T>;

  /**
   * Clear the configuration cache
   */
  clearCache(): void;

  /**
   * Check if configuration is currently cached
   * @returns True if configuration is cached, false otherwise
   */
  isCached(): boolean;

  /**
   * Get a specific configuration value by path
   * @param path - Dot-separated path to the configuration value
   * @param defaultValue - Default value if path is not found
   * @returns Configuration value or default value
   */
  getConfigValue<V = any>(path: string, defaultValue?: V): V;

  /**
   * Get the provider name for identification
   * @returns The provider name
   */
  getProviderName(): string;

  /**
   * Check if the provider is available/ready
   * @returns True if provider is available, false otherwise
   */
  isAvailable(): Promise<boolean>;

  /**
   * Update configuration (only for database provider)
   * @param partial - Partial configuration to update
   * @returns Promise that resolves to the updated configuration
   */
  updateConfig?(partial: Partial<T>): Promise<T>;
}
