import { z } from 'zod';

export const PersistedJsonObjectSchema = z.record(z.string(), z.unknown());

export class PersistenceDecodingError extends Error {
  constructor(
    readonly context: string,
    reason: string,
    options?: ErrorOptions
  ) {
    super(`Invalid persisted data at ${context}: ${reason}`, options);
    this.name = 'PersistenceDecodingError';
  }
}

function summarizeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map(issue => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      return `${path} (${issue.code})`;
    })
    .join(', ');
}

export function validatePersistedValue<T>(
  value: unknown,
  schema: z.ZodType<T>,
  context: string
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new PersistenceDecodingError(
      context,
      `schema validation failed at ${summarizeIssues(result.error)}`,
      { cause: result.error }
    );
  }

  return result.data;
}

export function decodePersistedJson<T>(
  serialized: string,
  schema: z.ZodType<T>,
  context: string
): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch (cause) {
    throw new PersistenceDecodingError(context, 'invalid JSON', { cause });
  }

  return validatePersistedValue(parsed, schema, context);
}
