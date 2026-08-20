import { z } from 'zod';

import {
  normalizeClientApplicationType,
  SUPPORTED_GRANT_TYPES,
  SUPPORTED_RESPONSE_TYPES,
} from './adapter/client.interface.js';
import type { OidcClientData } from './adapter/client.interface.js';
import { validateClientKeyMetadata } from './client-key-metadata.js';

const JsonWebKeySchema = z
  .object({
    kty: z.string().min(1, 'JWK key type cannot be empty'),
  })
  .passthrough();

const JsonWebKeySetSchema = z
  .object({
    keys: z.array(JsonWebKeySchema),
  })
  .passthrough();

/**
 * Zod schema for OIDC Client configuration validation
 *
 * Based on OpenID Connect Core 1.0 specification and OAuth 2.0 Dynamic Client Registration
 * @see https://openid.net/specs/openid-connect-registration-1_0.html
 */
export const OidcClientSchema = z
  .object({
    client_id: z.string().trim().min(1, 'Client ID cannot be empty'),
    client_secret: z
      .string()
      .min(32, 'Client secret should be at least 32 characters for security')
      .optional(),

    client_name: z
      .string()
      .trim()
      .min(1, 'Client name cannot be empty')
      .optional(),
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
    preset: z
      .enum(['web', 'spa', 'native', 'm2m', 'device', 'api_management'])
      .optional(),
    token_endpoint_auth_method: z
      .enum([
        'client_secret_basic',
        'client_secret_post',
        'client_secret_jwt',
        'private_key_jwt',
        'none',
      ])
      .default('client_secret_basic'),
    token_endpoint_auth_signing_alg: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{1,64}$/u)
      .optional(),

    grant_types: z
      .array(z.enum(SUPPORTED_GRANT_TYPES))
      .default(['authorization_code']),

    response_types: z.array(z.enum(SUPPORTED_RESPONSE_TYPES)).default(['code']),

    // URIs
    redirect_uris: z
      .array(z.url('Redirect URI must be a valid URL'))
      .default([]),
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
    jwks: JsonWebKeySetSchema.optional(),

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
  })
  .superRefine((client, context) => {
    for (const message of validateClientKeyMetadata(
      client as unknown as Partial<OidcClientData>,
      { requirePrivateKeyJwtSource: true }
    )) {
      context.addIssue({ code: 'custom', message });
    }
  })
  .transform(client => normalizeClientApplicationType(client));

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
