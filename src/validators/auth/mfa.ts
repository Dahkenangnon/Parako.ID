/**
 * MFA method query-parameter schema for the account-management MFA
 * setup / verify screens.
 */

import { z } from 'zod';

const mfaMethodValues = ['totp', 'sms', 'email', 'backup_codes'] as const;

export const mfaMethodQuerySchema = z
  .object({
    method: z.enum(mfaMethodValues).optional(),
  })
  .passthrough();

export type MfaMethodQuery = z.infer<typeof mfaMethodQuerySchema>;
