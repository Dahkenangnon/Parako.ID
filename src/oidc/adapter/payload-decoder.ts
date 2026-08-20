import type { OIDCPayload } from '../interfaces/interface.js';
import {
  decodePersistedJson,
  PersistedJsonObjectSchema,
  validatePersistedValue,
} from '../../db/persistence/json-decoder.js';

export function decodeOidcPayload(
  serialized: string,
  context: string
): OIDCPayload {
  return decodePersistedJson(serialized, PersistedJsonObjectSchema, context);
}

export function validateOidcPayload(
  value: unknown,
  context: string
): OIDCPayload {
  return validatePersistedValue(value, PersistedJsonObjectSchema, context);
}
