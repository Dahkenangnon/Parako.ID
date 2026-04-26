import type {
  OidcClient,
  ClientRegistryConfig,
} from '../../utils/client-registry-config.js';

/**
 * Interface for client registry manager service
 * Defines the contract for OIDC client configuration management operations
 */
export interface IClientRegistryManager {
  /**
   * Load the client registry configuration synchronously with Zod validation
   * @param useCache - Whether to use cached configuration (default: true)
   * @returns Parsed and validated client configuration object
   */
  loadConfig(useCache?: boolean): ClientRegistryConfig;

  /**
   * Load the client registry configuration asynchronously with Zod validation
   * @param useCache - Whether to use cached configuration (default: true)
   * @returns Promise that resolves to parsed and validated client configuration object
   */
  loadConfigAsync(useCache?: boolean): Promise<ClientRegistryConfig>;

  /**
   * Save the client registry configuration to disk
   * @param config - Configuration object to save
   */
  saveConfig(config: ClientRegistryConfig): void;

  /**
   * Clear the cached configuration
   */
  clearConfigCache(): void;

  /**
   * Find a client by ID
   * @param clientId - Client ID to search for
   * @returns Client object or null if not found
   */
  findClientById(clientId: string): OidcClient | null;

  /**
   * Find clients by application type
   * @param appType - Application type to filter by
   * @returns Array of matching clients
   */
  findClientsByType(appType: OidcClient['application_type']): OidcClient[];

  /**
   * Find active clients
   * @returns Array of active clients
   */
  findActiveClients(): OidcClient[];

  /**
   * Add a new client
   * @param client - Client configuration to add
   * @returns Added client with generated ID and secret if needed
   */
  addClient(client: Partial<OidcClient>): OidcClient;

  /**
   * Update an existing client
   * @param clientId - Client ID to update
   * @param updates - Partial client object with updates
   * @returns Updated client
   */
  updateClient(clientId: string, updates: Partial<OidcClient>): OidcClient;

  /**
   * Remove a client
   * @param clientId - Client ID to remove
   * @returns True if client was removed, false if not found
   */
  removeClient(clientId: string): boolean;

  /**
   * Get client configuration for node-oidc-provider
   * Transforms our client format to the format expected by node-oidc-provider
   * @returns Array of client configurations for node-oidc-provider
   */
  getOidcProviderClients(): any[];

  /**
   * Generate a secure random string for client secrets and IDs
   * @param length - Length of the random string
   * @returns Secure random string
   */
  generateSecureRandom(length?: number): string;

  /**
   * Generate a unique client ID
   * @param prefix - Optional prefix for the client ID
   * @returns Unique client ID
   */
  generateClientId(prefix?: string): string;

  /**
   * Generate a secure client secret
   * @param length - Length of the client secret (default: 64)
   * @returns Secure client secret
   */
  generateClientSecret(length?: number): string;
}
