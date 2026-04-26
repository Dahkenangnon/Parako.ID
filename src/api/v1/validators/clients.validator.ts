/**
 * Zod validation schemas for OIDC client create / update request bodies.
 *
 * These schemas enforce the shape and constraints of incoming payloads
 * before they reach the controller logic. The `updateClientSchema` is a
 * `.partial()` derivative of `createClientSchema` so every field becomes
 * optional for PUT and PATCH operations.
 */

import { z } from 'zod';

export const createClientSchema = z.object({
  client_name: z.string().min(1).max(255),

  application_type: z.enum(['web', 'native', 'spa']).default('web'),

  redirect_uris: z.array(z.string().url()).optional(),
  post_logout_redirect_uris: z.array(z.string().url()).optional(),

  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  scope: z.string().optional(),

  token_endpoint_auth_method: z
    .enum([
      'none',
      'client_secret_basic',
      'client_secret_post',
      'client_secret_jwt',
      'private_key_jwt',
    ])
    .optional(),

  client_uri: z.string().url().optional(),
  logo_uri: z.string().url().optional(),
  policy_uri: z.string().url().optional(),
  tos_uri: z.string().url().optional(),

  contacts: z.array(z.string().email()).optional(),
  description: z.string().max(1000).optional(),
  tags: z.array(z.string()).optional(),

  require_pkce: z.boolean().optional(),
  id_token_signed_response_alg: z.string().optional(),
  subject_type: z.enum(['public', 'pairwise']).optional(),
  default_max_age: z.number().int().positive().optional(),
});

// Update schema (all fields optional, no defaults to avoid bleeding)

export const updateClientSchema = createClientSchema
  .extend({
    // doesn't inject 'web' when the field is absent.
    application_type: z.enum(['web', 'native', 'spa']).optional(),
  })
  .partial();

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
