/**
 * Params and body schemas for `POST /webauthn/credentials/:credentialId/rename`.
 */

import { z } from 'zod';

export const webauthnRenameCredentialParamsSchema = z.object({
  credentialId: z.string().min(1, 'Credential id is required'),
});

export type WebauthnRenameCredentialParams = z.infer<
  typeof webauthnRenameCredentialParamsSchema
>;

export const webauthnRenameCredentialBodySchema = z.object({
  friendlyName: z
    .string()
    .trim()
    .min(1, 'Friendly name is required')
    .max(100, 'Friendly name must be 100 characters or fewer'),
});

export type WebauthnRenameCredentialBody = z.infer<
  typeof webauthnRenameCredentialBodySchema
>;
