import { z } from 'zod';
import { decodePersistedJson } from '../db/persistence/json-decoder.js';

const PersistedSessionDocumentSchema = z
  .object({
    tenantId: z.string().min(1).optional(),
  })
  .passthrough();

export type PersistedSessionDocument = z.infer<
  typeof PersistedSessionDocumentSchema
>;

export function decodePersistedSession(
  serialized: string,
  context: string
): PersistedSessionDocument {
  return decodePersistedJson(
    serialized,
    PersistedSessionDocumentSchema,
    context
  );
}
