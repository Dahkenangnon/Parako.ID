/**
 * Body schema for `POST /webauthn/register/verify`.
 *
 * The `credential` object is the verbatim WebAuthn registration
 * assertion produced by the browser. Structural validation at this
 * layer is intentionally minimal — the substantive cryptographic
 * verification is performed by `@simplewebauthn/server` inside the
 * controller.
 */

import { z } from 'zod';

export const webauthnVerifyRegistrationBodySchema = z.object({
  credential: z.record(z.string(), z.unknown(), {
    error: 'Credential is required',
  }),
  friendly_name: z
    .string()
    .trim()
    .min(1, 'Friendly name must be at least 1 character')
    .max(100, 'Friendly name must be 100 characters or fewer')
    .optional(),
});

export type WebauthnVerifyRegistrationBody = z.infer<
  typeof webauthnVerifyRegistrationBodySchema
>;
