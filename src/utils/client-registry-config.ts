import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { injectable, inject } from 'inversify';
import type { IConfigFileReader } from '../di/interfaces/config-file-reader.interface.js';
import type { IFileSystemUtils } from '../di/interfaces/file-system-utils.interface.js';
import type { IClientRegistryManager } from '../di/interfaces/client-registry-manager.interface.js';
import { TYPES } from '../di/types.js';

/**
 * Zod schema for OIDC Client configuration validation
 *
 * Based on OpenID Connect Core 1.0 specification and OAuth 2.0 Dynamic Client Registration
 * @see https://openid.net/specs/openid-connect-registration-1_0.html
 */
export const OidcClientSchema = z.object({
  client_id: z.string().min(1, 'Client ID cannot be empty'),
  client_secret: z
    .string()
    .min(32, 'Client secret should be at least 32 characters for security')
    .optional(),

  client_name: z.string().min(1, 'Client name cannot be empty').optional(),
  client_uri: z.url('Client URI must be a valid URL').optional(),
  logo_uri: z.url('Logo URI must be a valid URL').optional(),
  tos_uri: z
    .string()
    .url('Terms of Service URI must be a valid URL')
    .optional(),
  policy_uri: z
    .string()
    .url('Privacy Policy URI must be a valid URL')
    .optional(),

  // Application type and authentication
  application_type: z.enum(['web', 'native', 'spa'], {
    error: 'Application type must be one of: web, native, spa',
  }),
  token_endpoint_auth_method: z
    .enum([
      'client_secret_basic',
      'client_secret_post',
      'client_secret_jwt',
      'private_key_jwt',
      'none',
    ])
    .default('client_secret_basic'),

  grant_types: z
    .array(
      z.enum([
        'authorization_code',
        'implicit',
        'refresh_token',
        'client_credentials',
        'password',
        'urn:ietf:params:oauth:grant-type:device_code',
        'urn:ietf:params:oauth:grant-type:jwt-bearer',
      ])
    )
    .default(['authorization_code']),

  response_types: z
    .array(
      z.enum([
        'code',
        'token',
        'id_token',
        'code token',
        'code id_token',
        'token id_token',
        'code token id_token',
      ])
    )
    .default(['code']),

  // URIs
  redirect_uris: z.array(z.url('Redirect URI must be a valid URL')).default([]),
  post_logout_redirect_uris: z
    .array(z.url('Post logout redirect URI must be a valid URL'))
    .default([]),

  scope: z.string().default('openid'),
  audience: z.url('Audience must be a valid URL').optional(),

  // Token format and TTL
  accessTokenFormat: z.enum(['jwt', 'opaque']).default('jwt'),
  id_token_signed_response_alg: z.string().default('RS256'),
  userinfo_signed_response_alg: z.string().optional(),

  // PKCE
  require_pkce: z.boolean().default(false),

  // Custom fields for internal use
  allowedResources: z
    .array(z.url('Allowed resource must be a valid URL'))
    .default([]),
  resourcesScopes: z.string().default(''),
  isInternalClient: z.boolean().default(false),

  contacts: z.array(z.email('Contact must be a valid email')).default([]),
  jwks_uri: z.url('JWKS URI must be a valid URL').optional(),
  jwks: z.object({}).optional(),

  // Creation and modification timestamps
  created_at: z.number().optional(),
  updated_at: z.number().optional(),

  // Client description and tags for management
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),

  active: z.boolean().default(true),

  // Device flow specific properties (RFC 8628)
  device_authorization_endpoint: z.string().optional(),
  device_code_lifetime: z.number().min(60).max(3600).optional(),
  user_code_lifetime: z.number().min(60).max(3600).optional(),
  verification_uri_complete: z.boolean().optional(),
  user_code_challenge_method: z.string().optional(),
});

/**
 * Schema for the client registry configuration (parako-rp.jsonc)
 */
export const ClientRegistrySchema = z.object({
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, 'Version must be in semver format (X.Y.Z)')
    .default('1.0.0'),
  created_at: z.number().default(() => Date.now()),
  updated_at: z.number().default(() => Date.now()),
  clients: z.array(OidcClientSchema).default([]),
});

/**
 * Inferred TypeScript types from Zod schemas
 */
export type OidcClient = z.infer<typeof OidcClientSchema>;
export type ClientRegistryConfig = z.infer<typeof ClientRegistrySchema>;

@injectable()
export default class ClientRegistryManager implements IClientRegistryManager {
  private cachedConfig: ClientRegistryConfig | null = null;
  private configPath: string;

  constructor(
    @inject(TYPES.ConfigFileReader) private configFileReader: IConfigFileReader,
    @inject(TYPES.FileSystemUtils) private fileSystemUtils: IFileSystemUtils
  ) {
    this.configPath = path.join(
      this.fileSystemUtils.rootDir,
      'parako-rp.jsonc'
    );
  }

  /**
   * Remove undefined properties from an object
   *
   * @param obj - Object to clean
   * @returns Object with undefined properties removed
   */
  private removeUndefinedProperties<T extends Record<string, any>>(
    obj: T
  ): Partial<T> {
    const cleaned: Partial<T> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        cleaned[key as keyof T] = value;
      }
    }

    return cleaned;
  }

  /**
   * Generate a secure random string for client secrets and IDs
   *
   * @param length - Length of the random string
   * @returns Secure random string
   */
  generateSecureRandom(length: number = 64): string {
    const charset =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let result = '';

    // Use crypto.getRandomValues for secure random generation
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);

    for (let i = 0; i < length; i++) {
      result += charset[array[i] % charset.length];
    }

    return result;
  }

  /**
   * Generate a unique client ID
   *
   * @param prefix - Optional prefix for the client ID
   * @returns Unique client ID
   */
  generateClientId(prefix: string = 'client'): string {
    const timestamp = Date.now().toString(36);
    const random = this.generateSecureRandom(8);
    return `${prefix}_${timestamp}_${random}`;
  }

  /**
   * Generate a secure client secret
   *
   * @param length - Length of the client secret (default: 64)
   * @returns Secure client secret
   */
  generateClientSecret(length: number = 64): string {
    return this.generateSecureRandom(length);
  }

  /**
   * Load the parako-rp.jsonc configuration synchronously with Zod validation
   *
   * @param useCache - Whether to use cached configuration (default: true)
   * @returns Parsed and validated client configuration object
   * @throws ZodError if validation fails
   */
  loadConfig(useCache: boolean = true): ClientRegistryConfig {
    if (useCache && this.cachedConfig) {
      return this.cachedConfig;
    }

    try {
      if (!fs.existsSync(this.configPath)) {
        const emptyConfig: ClientRegistryConfig = {
          version: '1.0.0',
          created_at: Date.now(),
          updated_at: Date.now(),
          clients: [],
        };

        if (useCache) {
          this.cachedConfig = emptyConfig;
        }

        return emptyConfig;
      }
      const rawConfig = this.configFileReader.readJsoncFile(this.configPath);

      const config = ClientRegistrySchema.parse(rawConfig);

      if (useCache) {
        this.cachedConfig = config;
      }

      return config;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.issues
          .map(
            (err: z.core.$ZodIssue) =>
              `${err.path.join('.')}: ${err.message}`
          )
          .join('\n');
        throw new Error(
          `Client configuration validation failed:\n${errorMessages}`
        );
      }

      throw new Error(
        `Failed to load client configuration: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Load the parako-rp.jsonc configuration asynchronously with Zod validation
   *
   * @param useCache - Whether to use cached configuration (default: true)
   * @returns Promise that resolves to parsed and validated client configuration object
   * @throws ZodError if validation fails
   */
  async loadConfigAsync(
    useCache: boolean = true
  ): Promise<ClientRegistryConfig> {
    if (useCache && this.cachedConfig) {
      return this.cachedConfig;
    }

    try {
      if (!fs.existsSync(this.configPath)) {
        const emptyConfig: ClientRegistryConfig = {
          version: '1.0.0',
          created_at: Date.now(),
          updated_at: Date.now(),
          clients: [],
        };

        if (useCache) {
          this.cachedConfig = emptyConfig;
        }

        return emptyConfig;
      }

      const rawConfig = await this.configFileReader.readJsoncFileAsync(
        this.configPath
      );

      const config = ClientRegistrySchema.parse(rawConfig);

      if (useCache) {
        this.cachedConfig = config;
      }

      return config;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.issues
          .map(
            (err: z.core.$ZodIssue) =>
              `${err.path.join('.')}: ${err.message}`
          )
          .join('\n');
        throw new Error(
          `Client configuration validation failed:\n${errorMessages}`
        );
      }

      throw new Error(
        `Failed to load client configuration: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Save the parako-rp.jsonc configuration to disk
   *
   * @param config - Configuration object to save
   * @throws Error if save fails
   */
  saveConfig(config: ClientRegistryConfig): void {
    try {
      config.updated_at = Date.now();

      const validatedConfig = ClientRegistrySchema.parse(config);

      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const jsonContent = JSON.stringify(validatedConfig, null, 2);
      const contentWithComments = `// =============================================================================
// Parako.ID OIDC Client Registry
// This file contains all registered OIDC clients for your identity provider.
// Generated and managed by parako-client script.

${jsonContent}`;

      fs.writeFileSync(this.configPath, contentWithComments, 'utf8');

      this.cachedConfig = validatedConfig;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.issues
          .map(
            (err: z.core.$ZodIssue) =>
              `${err.path.join('.')}: ${err.message}`
          )
          .join('\n');
        throw new Error(
          `Client configuration validation failed:\n${errorMessages}`
        );
      }

      throw new Error(
        `Failed to save client configuration: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Clear the cached configuration
   */
  clearConfigCache(): void {
    this.cachedConfig = null;
  }

  /**
   * Find a client by ID
   *
   * @param clientId - Client ID to search for
   * @returns Client object or null if not found
   */
  findClientById(clientId: string): OidcClient | null {
    const config = this.loadConfig();
    return (
      config.clients.find(
        (client: OidcClient) => client.client_id === clientId
      ) || null
    );
  }

  /**
   * Find clients by application type
   *
   * @param appType - Application type to filter by
   * @returns Array of matching clients
   */
  findClientsByType(appType: OidcClient['application_type']): OidcClient[] {
    const config = this.loadConfig();
    return config.clients.filter(
      (client: OidcClient) => client.application_type === appType
    );
  }

  /**
   * Find active clients
   *
   * @returns Array of active clients
   */
  findActiveClients(): OidcClient[] {
    const config = this.loadConfig();
    return config.clients.filter((client: OidcClient) => client.active);
  }

  /**
   * Add a new client
   *
   * @param client - Client configuration to add
   * @returns Added client with generated ID and secret if needed
   */
  addClient(client: Partial<OidcClient>): OidcClient {
    const config = this.loadConfig();

    if (!client.client_id) {
      client.client_id = this.generateClientId();
    }

    if (this.findClientById(client.client_id)) {
      throw new Error(`Client with ID '${client.client_id}' already exists`);
    }

    if (!client.client_secret && client.application_type !== 'spa') {
      client.client_secret = this.generateClientSecret();
    }

    client.created_at = Date.now();
    client.updated_at = Date.now();

    const validatedClient = OidcClientSchema.parse(client);

    config.clients.push(validatedClient);

    this.saveConfig(config);

    return validatedClient;
  }

  /**
   * Update an existing client
   *
   * @param clientId - Client ID to update
   * @param updates - Partial client object with updates
   * @returns Updated client
   */
  updateClient(clientId: string, updates: Partial<OidcClient>): OidcClient {
    const config = this.loadConfig();

    const clientIndex = config.clients.findIndex(
      (client: OidcClient) => client.client_id === clientId
    );
    if (clientIndex === -1) {
      throw new Error(`Client with ID '${clientId}' not found`);
    }

    // Don't allow changing client_id
    if (updates.client_id && updates.client_id !== clientId) {
      throw new Error('Cannot change client_id. Use remove and add instead.');
    }

    const updatedClient = {
      ...config.clients[clientIndex],
      ...updates,
      updated_at: Date.now(),
    };

    const validatedClient = OidcClientSchema.parse(updatedClient);

    config.clients[clientIndex] = validatedClient;

    this.saveConfig(config);

    return validatedClient;
  }

  /**
   * Remove a client
   *
   * @param clientId - Client ID to remove
   * @returns True if client was removed, false if not found
   */
  removeClient(clientId: string): boolean {
    const config = this.loadConfig();

    const clientIndex = config.clients.findIndex(
      (client: OidcClient) => client.client_id === clientId
    );
    if (clientIndex === -1) {
      return false;
    }

    config.clients.splice(clientIndex, 1);

    this.saveConfig(config);

    return true;
  }

  /**
   * Get client configuration for node-oidc-provider
   * Transforms our client format to the format expected by node-oidc-provider
   *
   * @returns Array of client configurations for node-oidc-provider
   */
  getOidcProviderClients(): any[] {
    const activeClients = this.findActiveClients();

    return activeClients.map(client => {
      const clientConfig = {
        client_id: client.client_id,
        client_secret: client.client_secret,
        client_name: client.client_name,
        client_uri: client.client_uri,
        logo_uri: client.logo_uri,
        tos_uri: client.tos_uri,
        policy_uri: client.policy_uri,
        application_type: client.application_type,
        token_endpoint_auth_method: client.token_endpoint_auth_method,
        grant_types: client.grant_types,
        response_types: client.response_types,
        redirect_uris: client.redirect_uris,
        post_logout_redirect_uris: client.post_logout_redirect_uris,
        scope: client.scope,
        audience: client.audience,
        accessTokenFormat: client.accessTokenFormat,
        id_token_signed_response_alg: client.id_token_signed_response_alg,
        userinfo_signed_response_alg: client.userinfo_signed_response_alg,
        allowedResources: client.allowedResources,
        resourcesScopes: client.resourcesScopes,
        isInternalClient: client.isInternalClient,
        contacts: client.contacts,
        jwks_uri: client.jwks_uri,
        jwks: client.jwks,
      };

      return this.removeUndefinedProperties(clientConfig);
    });
  }
}
