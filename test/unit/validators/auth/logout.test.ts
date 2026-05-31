import { describe, it, expect } from 'vitest';

import { logoutQuerySchema } from '../../../../src/validators/auth/logout.js';

describe('logoutQuerySchema', () => {
  it('accepts an empty query', () => {
    expect(logoutQuerySchema.parse({})).toEqual({});
  });

  it("preserves info / secondary / confirmed as literal 'true' / 'false' strings", () => {
    const result = logoutQuerySchema.parse({
      info: 'true',
      secondary: 'false',
      confirmed: 'true',
    });
    expect(result.info).toBe('true');
    expect(result.secondary).toBe('false');
    expect(result.confirmed).toBe('true');
  });

  it("rejects 'TRUE' / '1' / actual booleans for info / secondary / confirmed", () => {
    expect(logoutQuerySchema.safeParse({ info: 'TRUE' }).success).toBe(false);
    expect(logoutQuerySchema.safeParse({ info: '1' }).success).toBe(false);
    expect(
      logoutQuerySchema.safeParse({ info: true as unknown as 'true' }).success
    ).toBe(false);
  });

  it('rejects an unknown type value', () => {
    expect(logoutQuerySchema.safeParse({ type: 'partial' }).success).toBe(
      false
    );
  });

  it('rejects an invalid email', () => {
    expect(logoutQuerySchema.safeParse({ email: 'nope' }).success).toBe(false);
  });

  it('rejects an account_id over 100 characters', () => {
    expect(
      logoutQuerySchema.safeParse({ account_id: 'x'.repeat(101) }).success
    ).toBe(false);
  });
});
