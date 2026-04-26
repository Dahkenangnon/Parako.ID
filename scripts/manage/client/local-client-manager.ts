/**
 * Local client management utilities
 * Extracted from client-registry-config.ts to avoid external dependencies
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { OidcClient, ClientRegistryConfig } from './local-types.js';
import { log } from '../shared/utils.js';
import rootDir from '../shared/file.js';

/**
 * Generate a secure random string for client secrets and IDs
 */
function generateSecureRandom(length: number = 64): string {
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
 */
export function generateClientId(prefix: string = 'client'): string {
  const timestamp = Date.now().toString(36);
  const random = generateSecureRandom(8);
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Generate a secure client secret
 */
export function generateClientSecret(length: number = 64): string {
  return generateSecureRandom(length);
}

/**
 * Get the config file path
 */
function getConfigPath(): string {
  return path.join(rootDir, 'parako-rp.jsonc');
}

/**
 * Parse JSONC content (simple implementation)
 */
function parseJsonc(content: string): any {
  const cleaned = content
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove /* */ comments
    .replace(/\/\/.*$/gm, '') // Remove // comments
    .replace(/,(\s*[}\]])/g, '$1'); // Remove trailing commas

  return JSON.parse(cleaned);
}

/**
 * Load the parako-rp.jsonc configuration
 */
export function loadClientRegistryConfig(): ClientRegistryConfig {
  const configPath = getConfigPath();

  try {
    if (!fs.existsSync(configPath)) {
      const emptyConfig: ClientRegistryConfig = {
        version: '1.0.0',
        created_at: Date.now(),
        updated_at: Date.now(),
        clients: [],
      };
      return emptyConfig;
    }

    const fileContent = fs.readFileSync(configPath, 'utf8');
    const rawConfig = parseJsonc(fileContent);

    if (!rawConfig || typeof rawConfig !== 'object') {
      throw new Error('Invalid configuration format');
    }

    const config: ClientRegistryConfig = {
      version: rawConfig.version || '1.0.0',
      created_at: rawConfig.created_at || Date.now(),
      updated_at: rawConfig.updated_at || Date.now(),
      clients: Array.isArray(rawConfig.clients) ? rawConfig.clients : [],
    };

    return config;
  } catch (error) {
    log.error(
      `Failed to load client configuration: ${error instanceof Error ? error.message : String(error)}`
    );
    return {
      version: '1.0.0',
      created_at: Date.now(),
      updated_at: Date.now(),
      clients: [],
    };
  }
}

/**
 * Save the parako-rp.jsonc configuration to disk
 */
export function saveClientRegistryConfig(config: ClientRegistryConfig): void {
  try {
    const configPath = getConfigPath();

    config.updated_at = Date.now();

    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const jsonContent = JSON.stringify(config, null, 2);
    const contentWithComments = `// =============================================================================
// Parako.ID OIDC Client Registry
// This file contains all registered OIDC clients for your identity provider.
// Generated and managed by parako-client script.

${jsonContent}`;

    fs.writeFileSync(configPath, contentWithComments, 'utf8');
  } catch (error) {
    throw new Error(
      `Failed to save client configuration: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Find a client by ID
 */
export function findClientById(clientId: string): OidcClient | null {
  const config = loadClientRegistryConfig();
  return config.clients.find(client => client.client_id === clientId) || null;
}

/**
 * Add a new client
 */
export function addClient(client: Partial<OidcClient>): OidcClient {
  const config = loadClientRegistryConfig();

  if (!client.client_id) {
    client.client_id = generateClientId();
  }

  if (findClientById(client.client_id)) {
    throw new Error(`Client with ID '${client.client_id}' already exists`);
  }

  if (!client.client_secret && client.token_endpoint_auth_method !== 'none') {
    client.client_secret = generateClientSecret();
  }

  client.created_at = Date.now();
  client.updated_at = Date.now();

  const fullClient: OidcClient = {
    client_id: client.client_id,
    application_type: client.application_type || 'web',
    token_endpoint_auth_method:
      client.token_endpoint_auth_method || 'client_secret_basic',
    grant_types: client.grant_types || ['authorization_code'],
    response_types: client.response_types || ['code'],
    redirect_uris: client.redirect_uris || [],
    post_logout_redirect_uris: client.post_logout_redirect_uris || [],
    scope: client.scope || 'openid',
    accessTokenFormat: client.accessTokenFormat || 'jwt',
    require_pkce: client.require_pkce || false,
    allowedResources: client.allowedResources || [],
    resourcesScopes: client.resourcesScopes || '',
    isInternalClient: client.isInternalClient || false,
    contacts: client.contacts || [],
    created_at: client.created_at,
    updated_at: client.updated_at,
    tags: client.tags || [],
    active: client.active !== undefined ? client.active : true,
    preset: client.preset,
    ...client, // Override with provided values
  };

  config.clients.push(fullClient);

  saveClientRegistryConfig(config);

  return fullClient;
}
