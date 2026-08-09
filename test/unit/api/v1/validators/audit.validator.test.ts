import { describe, expect, it } from 'vitest';

import { auditQuerySchema } from '../../../../../src/api/v1/validators/audit.validator.js';

describe('auditQuerySchema', () => {
  it('accepts and normalizes supported audit filters', () => {
    expect(
      auditQuerySchema.parse({
        type: '  api_request  ',
        status: 'info',
        username: '  admin  ',
        client_id: '  management-client  ',
        from: '2026-08-07T10:00:00Z',
        to: '2026-08-07T12:00:00+01:00',
      })
    ).toEqual({
      type: 'api_request',
      status: 'info',
      username: 'admin',
      client_id: 'management-client',
      from: '2026-08-07T10:00:00Z',
      to: '2026-08-07T12:00:00+01:00',
    });
  });

  it('strips pagination and unknown keys parsed by other request layers', () => {
    expect(
      auditQuerySchema.parse({
        type: 'login',
        limit: '20',
        cursor: 'opaque',
        include_count: 'true',
        unexpected: 'value',
      })
    ).toEqual({ type: 'login' });
  });

  it.each(['type', 'username', 'client_id'] as const)(
    'rejects a blank %s filter',
    field => {
      expect(auditQuerySchema.safeParse({ [field]: '   ' }).success).toBe(
        false
      );
    }
  );

  it.each(['type', 'username', 'client_id'] as const)(
    'rejects an oversized %s filter',
    field => {
      expect(
        auditQuerySchema.safeParse({ [field]: 'x'.repeat(256) }).success
      ).toBe(false);
    }
  );

  it.each(['success', 'failed', 'info', 'warning'])(
    'accepts status %s',
    status => {
      expect(auditQuerySchema.parse({ status })).toEqual({ status });
    }
  );

  it('rejects unsupported status values and malformed timestamps', () => {
    const result = auditQuerySchema.safeParse({
      status: 'debug',
      from: 'not-a-date',
      to: '2026-08-07',
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected invalid test input');
    expect(result.error.issues.map(issue => issue.path.join('.'))).toEqual([
      'status',
      'from',
      'to',
    ]);
  });

  it('accepts equal bounds and rejects a reversed date range', () => {
    const instant = '2026-08-07T10:00:00Z';
    expect(
      auditQuerySchema.safeParse({ from: instant, to: instant }).success
    ).toBe(true);

    const reversed = auditQuerySchema.safeParse({
      from: '2026-08-07T12:00:00Z',
      to: '2026-08-07T10:00:00Z',
    });
    expect(reversed.success).toBe(false);
    if (reversed.success) throw new Error('expected reversed range to fail');
    expect(reversed.error.issues).toEqual([
      expect.objectContaining({
        path: ['to'],
        message: 'to must be at or after from',
      }),
    ]);
  });

  it('does not mutate the original query object', () => {
    const query = { type: '  api_request  ' };

    auditQuerySchema.parse(query);

    expect(query).toEqual({ type: '  api_request  ' });
  });
});
