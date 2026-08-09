import { describe, expect, it } from 'vitest';

import { jwksQuerySchema } from '../../../../../src/api/v1/validators/jwks.validator.js';

describe('jwksQuerySchema', () => {
  it('accepts an omitted status filter', () => {
    expect(jwksQuerySchema.parse({})).toEqual({});
  });

  it.each(['active', 'expiring', 'retired'] as const)(
    'accepts the %s lifecycle status',
    status => {
      expect(jwksQuerySchema.parse({ status })).toEqual({ status });
    }
  );

  it.each(['pending', '', ' active ', 1, true, ['active']])(
    'rejects unsupported status input %j',
    status => {
      expect(jwksQuerySchema.safeParse({ status }).success).toBe(false);
    }
  );

  it('strips query keys owned by other request layers', () => {
    expect(
      jwksQuerySchema.parse({
        status: 'active',
        limit: '20',
        cursor: 'opaque',
        unexpected: 'value',
      })
    ).toEqual({ status: 'active' });
  });

  it('does not mutate the original query object', () => {
    const query = { status: 'active', ignored: 'value' };

    jwksQuerySchema.parse(query);

    expect(query).toEqual({ status: 'active', ignored: 'value' });
  });
});
