import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import {
  decodePersistedJson,
  PersistenceDecodingError,
  validatePersistedValue,
} from '../../../../src/db/persistence/json-decoder.js';

const ExampleSchema = z.object({ enabled: z.boolean() });

describe('decodePersistedJson', () => {
  it('returns schema-validated JSON', () => {
    expect(
      decodePersistedJson(
        JSON.stringify({ enabled: true }),
        ExampleSchema,
        'example.payload'
      )
    ).toEqual({ enabled: true });
  });

  it('validates already-decoded persistence values at the same safe boundary', () => {
    expect(
      validatePersistedValue(
        { enabled: true },
        ExampleSchema,
        'example.payload'
      )
    ).toEqual({ enabled: true });

    expect(() =>
      validatePersistedValue(
        { enabled: 'private-secret-marker' },
        ExampleSchema,
        'example.payload'
      )
    ).toThrow(
      'Invalid persisted data at example.payload: schema validation failed at enabled (invalid_type)'
    );
  });

  it('wraps syntax errors without exposing persisted content', () => {
    const secretMarker = 'private-secret-marker';

    expect(() =>
      decodePersistedJson(
        `{"enabled":true,"secret":"${secretMarker}"`,
        ExampleSchema,
        'example.payload'
      )
    ).toThrow(new PersistenceDecodingError('example.payload', 'invalid JSON'));

    try {
      decodePersistedJson(
        `{"secret":"${secretMarker}"`,
        ExampleSchema,
        'example.payload'
      );
    } catch (error) {
      expect(String(error)).not.toContain(secretMarker);
    }
  });

  it('reports schema paths and codes without exposing rejected values', () => {
    const secretMarker = 'private-secret-marker';

    expect(() =>
      decodePersistedJson(
        JSON.stringify({ enabled: secretMarker }),
        ExampleSchema,
        'example.payload'
      )
    ).toThrow(
      'Invalid persisted data at example.payload: schema validation failed at enabled (invalid_type)'
    );

    try {
      decodePersistedJson(
        JSON.stringify({ enabled: secretMarker }),
        ExampleSchema,
        'example.payload'
      );
    } catch (error) {
      expect(String(error)).not.toContain(secretMarker);
    }
  });
});
