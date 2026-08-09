import { describe, expect, it } from 'vitest';

import { sessionQuerySchema } from '../../../../../src/api/v1/validators/sessions.validator.js';

describe('sessionQuerySchema', () => {
  it('accepts and normalizes supported session filters', () => {
    expect(
      sessionQuerySchema.parse({
        username: '  account-123  ',
        client_id: '  client-456  ',
        active: 'true',
      })
    ).toEqual({
      username: 'account-123',
      client_id: 'client-456',
      active: 'true',
    });
  });

  it('accepts an empty filter object', () => {
    expect(sessionQuerySchema.parse({})).toEqual({});
  });

  it.each(['username', 'client_id'] as const)(
    'rejects a blank %s filter',
    field => {
      expect(sessionQuerySchema.safeParse({ [field]: '   ' }).success).toBe(
        false
      );
    }
  );

  it.each(['username', 'client_id'] as const)(
    'rejects an oversized %s filter after normalization',
    field => {
      expect(
        sessionQuerySchema.safeParse({
          [field]: `  ${'x'.repeat(256)}  `,
        }).success
      ).toBe(false);
    }
  );

  it.each(['true', 'false'] as const)('accepts active=%s', active => {
    expect(sessionQuerySchema.parse({ active })).toEqual({ active });
  });

  it.each(['yes', '', true, 1, ['true']])(
    'rejects unsupported active input %j',
    active => {
      expect(sessionQuerySchema.safeParse({ active }).success).toBe(false);
    }
  );

  it('strips pagination and unknown query keys', () => {
    expect(
      sessionQuerySchema.parse({
        username: 'account-123',
        limit: '50',
        cursor: 'opaque',
        unexpected: 'value',
      })
    ).toEqual({ username: 'account-123' });
  });

  it('does not mutate the original query object', () => {
    const query = { username: '  account-123  ' };

    sessionQuerySchema.parse(query);

    expect(query).toEqual({ username: '  account-123  ' });
  });
});
