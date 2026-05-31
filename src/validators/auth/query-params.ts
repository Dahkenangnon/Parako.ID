/**
 * Auth query-parameter schema (shared across /auth/login,
 * /auth/register, /auth/forgot_password, /auth/reset_password,
 * /auth/email_verification, /auth/verify_email, /auth/account_select,
 * /auth/continue, /auth/multi_factor, /auth/mfa_verify,
 * /auth/mfa_select, /auth/mfa_webauthn, /auth/social/login,
 * /auth/social/register and related GET routes).
 *
 * Every field is optional — the auth routes accept the union of all
 * supported parameters and let the controller pick the ones it
 * needs. The schema only enforces structural rules (type, length,
 * enum). URL-trust policy for `continue`, `redirectTo`, and
 * `redirect_uri` is the responsibility of
 * `RedirectAuthority.validateUrl()` at the controller boundary.
 */

import { z } from 'zod';

import { redirectStringSchema, urlSchema } from '../base-schemas.js';

const promptValues = ['login', 'consent', 'none', 'select_account'] as const;
const intentValues = ['login', 'register', 'add-account'] as const;
const mfaMethodValues = ['totp', 'sms', 'email', 'backup_codes'] as const;
const accountStatusValues = ['pending', 'active', 'disabled', 'all'] as const;
const activityTypeValues = [
  'login',
  'logout',
  'register',
  'mfa',
  'password_reset',
] as const;

/**
 * Email field for auth query routes. Trims and lower-cases the
 * local-part before the format check so the value matches what is
 * stored in the database (login compares case-insensitively).
 * Subaddressing (`user+tag@host`) is preserved — stripping the `+tag`
 * suffix would corrupt legitimate addresses on non-Gmail providers.
 */
const authQueryEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Email is required')
  .max(254, 'Email must be 254 characters or fewer')
  .pipe(z.email('Email must be a valid address'));

/**
 * Auth GET routes accept additional query parameters beyond the
 * declared subset (e.g. `client_name`, `client_logo`, `account_id`
 * read by the controller, and arbitrary OIDC interaction parameters
 * forwarded by the provider). `.passthrough()` preserves them so the
 * controller layer keeps consuming what it expects. The declared
 * fields are still structurally validated.
 */
export const authQueryParamsSchema = z
  .object({
    step_message: z
      .string()
      .max(200, 'step_message must be 200 characters or fewer')
      .optional(),
    continue: redirectStringSchema,
    redirectTo: redirectStringSchema,
    redirect_uri: urlSchema.optional(),
    prompt: z.enum(promptValues).optional(),
    intent: z.enum(intentValues).optional(),
    email: authQueryEmailSchema.optional(),
    token: z
      .string()
      .min(10, 'Token must be at least 10 characters')
      .max(500, 'Token must be 500 characters or fewer')
      .optional(),
    interaction_uid: z
      .string()
      .min(10, 'Interaction id must be at least 10 characters')
      .max(100, 'Interaction id must be 100 characters or fewer')
      .optional(),
    method: z.enum(mfaMethodValues).optional(),
    status: z.enum(accountStatusValues).optional(),
    type: z.enum(activityTypeValues).optional(),
  })
  .passthrough();

export type AuthQueryParams = z.infer<typeof authQueryParamsSchema>;
