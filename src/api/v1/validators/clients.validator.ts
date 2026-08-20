/**
 * Zod validation schemas for OIDC client create / update request bodies.
 *
 * Normalization happens at the HTTP boundary so MongoDB, SQLite, and
 * PostgreSQL adapters receive the same portable metadata. Update fields use
 * the same field schemas as create fields, but remain optional and do not
 * inject create-only defaults.
 */

import { z } from 'zod';
import {
  normalizeClientApplicationType,
  SUPPORTED_GRANT_TYPES,
  SUPPORTED_RESPONSE_TYPES,
  type TokenEndpointAuthMethod,
} from '../../../oidc/adapter/client.interface.js';
import { validateClientKeyMetadata } from '../../../oidc/client-key-metadata.js';

const MAX_URI_LENGTH = 2048;
const MAX_URI_COUNT = 100;
const MAX_METADATA_VALUE_COUNT = 100;
const MAX_PROTOCOL_VALUE_COUNT = 20;
const DANGEROUS_URI_PROTOCOLS = new Set([
  'javascript:',
  'data:',
  'file:',
  'vbscript:',
]);

const clientNameSchema = z.string().trim().min(1).max(255);
const applicationTypeSchema = z.enum(['web', 'native', 'spa']);
const tokenEndpointAuthMethodSchema = z.enum([
  'none',
  'client_secret_basic',
  'client_secret_post',
  'client_secret_jwt',
  'private_key_jwt',
]);

function isSafeRedirectUri(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      !DANGEROUS_URI_PROTOCOLS.has(parsed.protocol) &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hostname.includes('*') &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}

function isSafeHttpUri(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

const redirectUriSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_URI_LENGTH)
  .refine(isSafeRedirectUri, 'Must be a safe absolute redirect URI');
const resourceIndicatorSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_URI_LENGTH)
  .refine(isSafeRedirectUri, 'Must be a safe absolute resource URI');

const httpUriSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_URI_LENGTH)
  .refine(isSafeHttpUri, 'Must be a safe HTTP(S) URL');

function uniqueStringArray(itemSchema: z.ZodType<string>, maximum: number) {
  return z
    .array(itemSchema)
    .max(maximum)
    .superRefine((values, context) => {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: 'custom',
          message: 'Must not contain duplicate values',
        });
      }
    });
}

const redirectUrisSchema = uniqueStringArray(redirectUriSchema, MAX_URI_COUNT);
function supportedProtocolValueSchema(values: readonly string[]) {
  return z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine(value => values.includes(value), 'Unsupported protocol value');
}

const grantTypesSchema = uniqueStringArray(
  supportedProtocolValueSchema(SUPPORTED_GRANT_TYPES),
  MAX_PROTOCOL_VALUE_COUNT
);
const responseTypesSchema = uniqueStringArray(
  supportedProtocolValueSchema(SUPPORTED_RESPONSE_TYPES),
  MAX_PROTOCOL_VALUE_COUNT
);
const contactsSchema = uniqueStringArray(
  z.string().trim().toLowerCase().email().max(254),
  MAX_METADATA_VALUE_COUNT
);
const tagsSchema = uniqueStringArray(
  z.string().trim().min(1).max(100),
  MAX_METADATA_VALUE_COUNT
);
const scopeSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .transform(value => value.split(/\s+/u).join(' '));
const signingAlgorithmSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,64}$/u);
const defaultMaxAgeSchema = z
  .number()
  .int()
  .positive()
  .refine(Number.isSafeInteger, 'Must be a safe integer');
const jwksSchema = z
  .object({
    keys: z.array(z.record(z.string(), z.unknown())).min(1),
  })
  .passthrough();

const optionalClientFields = {
  redirect_uris: redirectUrisSchema.optional(),
  post_logout_redirect_uris: redirectUrisSchema.optional(),
  grant_types: grantTypesSchema.optional(),
  response_types: responseTypesSchema.optional(),
  scope: scopeSchema.optional(),
  token_endpoint_auth_method: tokenEndpointAuthMethodSchema.optional(),
  token_endpoint_auth_signing_alg: signingAlgorithmSchema.optional(),
  jwks_uri: httpUriSchema.optional(),
  jwks: jwksSchema.optional(),
  allowedResources: uniqueStringArray(
    resourceIndicatorSchema,
    MAX_URI_COUNT
  ).optional(),
  resourcesScopes: scopeSchema.optional(),
  active: z.boolean().optional(),
  client_uri: httpUriSchema.optional(),
  logo_uri: httpUriSchema.optional(),
  policy_uri: httpUriSchema.optional(),
  tos_uri: httpUriSchema.optional(),
  contacts: contactsSchema.optional(),
  description: z.string().trim().max(1000).optional(),
  tags: tagsSchema.optional(),
  require_pkce: z.boolean().optional(),
  id_token_signed_response_alg: signingAlgorithmSchema.optional(),
  subject_type: z.enum(['public', 'pairwise']).optional(),
  default_max_age: defaultMaxAgeSchema.optional(),
};

type PublicClientFields = {
  token_endpoint_auth_method?: TokenEndpointAuthMethod;
  require_pkce?: boolean;
};

function validatePublicClientPkce(
  data: PublicClientFields,
  context: z.RefinementCtx
): void {
  if (
    data.token_endpoint_auth_method === 'none' &&
    data.require_pkce === false
  ) {
    context.addIssue({
      code: 'custom',
      path: ['require_pkce'],
      message: 'PKCE is required when token endpoint authentication is none',
    });
  }
}

function validateClientKeys(
  data: PublicClientFields & {
    jwks_uri?: string;
    jwks?: { keys: Array<Record<string, unknown>> };
  },
  context: z.RefinementCtx,
  requirePrivateKeyJwtSource: boolean
): void {
  for (const message of validateClientKeyMetadata(data, {
    requirePrivateKeyJwtSource,
  })) {
    context.addIssue({ code: 'custom', message });
  }
}

function validateCreateClient(
  data: Parameters<typeof validateClientKeys>[0],
  context: z.RefinementCtx
): void {
  validatePublicClientPkce(data, context);
  validateClientKeys(data, context, true);
}

function validateUpdateClient(
  data: Parameters<typeof validateClientKeys>[0],
  context: z.RefinementCtx
): void {
  validatePublicClientPkce(data, context);
  validateClientKeys(data, context, false);
}

function applyPublicClientPkce<T extends PublicClientFields>(data: T): T {
  if (
    data.token_endpoint_auth_method === 'none' &&
    data.require_pkce === undefined
  ) {
    return { ...data, require_pkce: true };
  }
  return data;
}

export const createClientSchema = z
  .object({
    client_name: clientNameSchema,
    application_type: applicationTypeSchema.default('web'),
    ...optionalClientFields,
  })
  .superRefine(validateCreateClient)
  .transform(applyPublicClientPkce)
  .transform(normalizeClientApplicationType);

export const updateClientSchema = z
  .object({
    client_name: clientNameSchema.optional(),
    application_type: applicationTypeSchema.optional(),
    ...optionalClientFields,
  })
  .superRefine(validateUpdateClient)
  .transform(applyPublicClientPkce)
  .transform(normalizeClientApplicationType);

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
