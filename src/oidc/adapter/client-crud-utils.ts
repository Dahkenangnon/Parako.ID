/**
 * Shared utility functions for client CRUD operations across all adapter backends.
 *
 * These are pure functions — no storage access — so they can be reused by
 * MongodbOidcAdminService, PrismaOidcAdminService, and RedisOidcAdminService.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type {
  OidcClientData,
  ClientFilters,
  ClientStatistics,
  ClientValidationResult,
  ApplicationType,
} from './client.interface.js';
import {
  CLIENT_DEFAULTS,
  clientAuthMethodUsesSecret,
  normalizeClientApplicationType,
  SUPPORTED_GRANT_TYPES,
  SUPPORTED_RESPONSE_TYPES,
} from './client.interface.js';
import { ensureEncrypted, ensureDecrypted } from '../../utils/encryption.js';
import { validateClientKeyMetadata } from '../client-key-metadata.js';

export function generateClientId(): string {
  return randomUUID();
}

/**
 * Generate a cryptographically secure client secret (64 hex chars = 256 bits).
 */
export function generateClientSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Strip empty strings, null, and undefined values from an OIDC client payload.
 *
 * node-oidc-provider rejects empty strings and null for optional metadata
 * fields (e.g. "client_uri must be a non-empty string if provided").
 * MongoDB also converts `undefined` to `null` by default, so we strip
 * those too before storage.
 */
export function sanitizeClientPayload<T extends Record<string, unknown>>(
  payload: T
): T {
  const result = { ...payload };
  for (const [key, value] of Object.entries(result)) {
    if (value === '' || value === null || value === undefined) {
      delete (result as Record<string, unknown>)[key];
    }
  }
  return result;
}

export function applyClientDefaults(
  data: Partial<OidcClientData>
): OidcClientData {
  const normalizedData = normalizeClientApplicationType(data);
  const now = new Date().toISOString();
  const needsSecret = clientAuthMethodUsesSecret(
    normalizedData.token_endpoint_auth_method
  );
  const independentDefaults = structuredClone(CLIENT_DEFAULTS);
  const independentData = structuredClone(normalizedData);

  return sanitizeClientPayload({
    ...independentDefaults,
    ...independentData,
    client_id: normalizedData.client_id || generateClientId(),
    client_name: normalizedData.client_name || 'Unnamed Client',
    application_type: normalizedData.application_type || 'web',
    client_secret:
      normalizedData.client_secret ||
      (needsSecret ? generateClientSecret() : undefined),
    created_at: normalizedData.created_at || now,
    updated_at: normalizedData.updated_at || now,
  }) as OidcClientData;
}

const VALID_APP_TYPES = new Set(['web', 'native', 'spa']);
const VALID_AUTH_METHODS = new Set([
  'none',
  'client_secret_basic',
  'client_secret_post',
  'client_secret_jwt',
  'private_key_jwt',
]);
const VALID_GRANT_TYPES = new Set<string>(SUPPORTED_GRANT_TYPES);
const VALID_RESPONSE_TYPES = new Set<string>(SUPPORTED_RESPONSE_TYPES);
const DANGEROUS_PROTOCOLS = new Set([
  'javascript:',
  'data:',
  'file:',
  'vbscript:',
]);

/**
 * Validate client data before create/update.
 */
export function validateClientData(
  data: Partial<OidcClientData>
): ClientValidationResult {
  const errors: string[] = [];

  if (!data.client_name || data.client_name.trim().length === 0) {
    errors.push('client_name is required');
  }

  if (data.application_type && !VALID_APP_TYPES.has(data.application_type)) {
    errors.push(
      `Invalid application_type: ${data.application_type}. Must be one of: web, native, spa`
    );
  }

  if (
    data.token_endpoint_auth_method &&
    !VALID_AUTH_METHODS.has(data.token_endpoint_auth_method)
  ) {
    errors.push(
      `Invalid token_endpoint_auth_method: ${data.token_endpoint_auth_method}`
    );
  }

  errors.push(
    ...validateClientKeyMetadata(data, { requirePrivateKeyJwtSource: true })
  );

  for (const grantType of data.grant_types ?? []) {
    if (!VALID_GRANT_TYPES.has(grantType)) {
      errors.push(`Invalid grant_types: ${grantType}`);
    }
  }

  for (const responseType of data.response_types ?? []) {
    if (!VALID_RESPONSE_TYPES.has(responseType)) {
      errors.push(`Invalid response_types: ${responseType}`);
    }
  }

  if (
    data.id_token_signed_response_alg !== undefined &&
    data.id_token_signed_response_alg === ''
  ) {
    errors.push(
      'id_token_signed_response_alg must not be an empty string (omit it or provide a valid algorithm)'
    );
  }

  if (data.redirect_uris) {
    for (const uri of data.redirect_uris) {
      try {
        const parsed = new URL(uri);

        if (DANGEROUS_PROTOCOLS.has(parsed.protocol)) {
          errors.push(`Dangerous protocol not allowed in redirect_uri: ${uri}`);
          continue;
        }

        if (parsed.username || parsed.password) {
          errors.push(`Credentials not allowed in redirect_uri: ${uri}`);
          continue;
        }

        if (parsed.hostname.includes('*')) {
          errors.push(`Wildcard hostnames not allowed in redirect_uri: ${uri}`);
          continue;
        }
      } catch {
        errors.push(`Invalid redirect_uri: ${uri}`);
      }
    }
  }

  return { isValid: errors.length === 0, errors };
}

/**
 * Encrypt the client_secret field (if present) for storage at rest.
 * Already-encrypted values are passed through unchanged.
 */
export function encryptClientSecret(
  clientData: OidcClientData
): OidcClientData {
  if (clientData.client_secret) {
    return {
      ...clientData,
      client_secret: ensureEncrypted(clientData.client_secret),
    };
  }
  return clientData;
}

/**
 * Decrypt the client_secret field (if present) when reading from storage.
 * Plaintext values (pre-migration) are passed through unchanged.
 */
export function decryptClientSecret(
  clientData: OidcClientData
): OidcClientData {
  if (clientData.client_secret) {
    return {
      ...clientData,
      client_secret: ensureDecrypted(clientData.client_secret),
    };
  }
  return clientData;
}

export function filterClients(
  clients: OidcClientData[],
  filters?: ClientFilters
): OidcClientData[] {
  if (!filters) return clients;

  return clients.filter(client => {
    if (
      filters.application_type &&
      client.application_type !== filters.application_type
    ) {
      return false;
    }
    if (filters.active !== undefined && client.active !== filters.active) {
      return false;
    }
    if (filters.tags && filters.tags.length > 0) {
      const clientTags = client.tags || [];
      if (!filters.tags.some(tag => clientTags.includes(tag))) {
        return false;
      }
    }
    if (filters.search) {
      return clientMatchesSearch(client, filters.search);
    }
    return true;
  });
}

export function clientMatchesSearch(
  client: OidcClientData,
  query: string
): boolean {
  const lower = query.toLowerCase();
  return (
    client.client_id.toLowerCase().includes(lower) ||
    client.client_name.toLowerCase().includes(lower) ||
    (client.description?.toLowerCase().includes(lower) ?? false)
  );
}

export function computeClientStatistics(
  clients: OidcClientData[]
): ClientStatistics {
  const byType: Record<ApplicationType, number> = {
    web: 0,
    native: 0,
    spa: 0,
  };
  let active = 0;
  let inactive = 0;

  for (const client of clients) {
    if (client.active !== false) {
      active++;
    } else {
      inactive++;
    }
    if (client.application_type in byType) {
      byType[client.application_type as ApplicationType]++;
    }
  }

  return {
    total: clients.length,
    active,
    inactive,
    byType,
  };
}
