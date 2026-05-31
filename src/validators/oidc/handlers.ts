/**
 * Structural schemas for the direct `req.params` / `req.query` /
 * `req.body` accesses inside `src/oidc/flows/handlers/**`.
 *
 * Each handler parses its inputs inline at the top of the function;
 * a `ZodError` is caught by the handler's existing try/catch block
 * and rendered as a generic 4xx view. The schemas here are
 * deliberately permissive about fields the handler does NOT consume
 * itself — they exist to reject pathological inputs (wrong type,
 * exceeded length) without changing the OIDC interaction semantics.
 *
 * The matching `VALID_SOCIAL_PROVIDERS` enum lives in
 * `src/validators/auth/social.ts` and is re-exported here so OIDC
 * handlers and the HTML auth route share one source of truth.
 */

import { z } from 'zod';

import { stringBoolSchema } from '../base-schemas.js';
import { VALID_SOCIAL_PROVIDERS } from '../auth/social.js';

/**
 * Canonical OIDC interaction id. Matches the existing
 * `oidcInteractionValidators.uid` rule (10..100 chars).
 */
const interactionUidSchema = z
  .string()
  .min(10, 'Interaction id must be at least 10 characters')
  .max(100, 'Interaction id must be 100 characters or fewer');

/** Params: `:uid` only (abort, consent, mfa, new-device-verify, webauthn-mfa). */
export const oidcUidParamsSchema = z.object({
  uid: interactionUidSchema,
});

export type OidcUidParams = z.infer<typeof oidcUidParamsSchema>;

/**
 * Social provider params for `/oidc/social/:provider[/callback]`.
 * The allow-list is shared with the HTML auth route.
 */
export const oidcSocialProviderParamsSchema = z.object({
  provider: z.enum(VALID_SOCIAL_PROVIDERS, {
    error: 'Unknown social provider',
  }),
});

export type OidcSocialProviderParams = z.infer<
  typeof oidcSocialProviderParamsSchema
>;

/**
 * Query schema for the social-login initiation route. The handler
 * forwards any unknown OIDC parameters into the social-login adapter,
 * so the schema must NOT strip them — declared fields are
 * structurally validated and everything else passes through verbatim.
 */
export const oidcSocialLoginQuerySchema = z
  .object({
    uid: interactionUidSchema.optional(),
    client_id: z
      .string()
      .max(200, 'Client id must be 200 characters or fewer')
      .optional(),
    prompt: z
      .string()
      .max(100, 'Prompt must be 100 characters or fewer')
      .optional(),
    acr_values: z
      .string()
      .max(500, 'ACR values must be 500 characters or fewer')
      .optional(),
  })
  .passthrough();

export type OidcSocialLoginQuery = z.infer<typeof oidcSocialLoginQuerySchema>;

/** Body schema for `POST /interaction/:uid/mfa` (method selection). */
export const oidcMfaBodySchema = z
  .object({
    method: z
      .enum(['totp', 'sms', 'email', 'backup_codes'], {
        error: 'Unknown MFA method',
      })
      .optional(),
  })
  .passthrough();

export type OidcMfaBody = z.infer<typeof oidcMfaBodySchema>;

/**
 * Body schema for `POST /interaction/:uid/new-device-verify`.
 *
 * `code` accepts both numeric one-time codes and alphanumeric backup
 * codes; the substantive cryptographic check lives in
 * `AuthService.verifyTotp` and friends.
 */
export const oidcNewDeviceVerifyBodySchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1, 'Code is required')
      .max(64, 'Code must be 64 characters or fewer'),
    trust_this_device: stringBoolSchema.optional(),
  })
  .passthrough();

export type OidcNewDeviceVerifyBody = z.infer<
  typeof oidcNewDeviceVerifyBodySchema
>;

/**
 * Body schema for `POST /interaction/:uid/webauthn/verify`. Mirrors
 * the WebAuthn registration-verify schema — the cryptographic check
 * lives inside `@simplewebauthn/server`.
 */
export const oidcWebauthnMfaVerifyBodySchema = z.object({
  credential: z.record(z.string(), z.unknown(), {
    error: 'Credential is required',
  }),
});

export type OidcWebauthnMfaVerifyBody = z.infer<
  typeof oidcWebauthnMfaVerifyBodySchema
>;
