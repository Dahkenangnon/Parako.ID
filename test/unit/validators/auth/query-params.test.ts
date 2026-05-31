import { describe, it, expect } from 'vitest';

import { authQueryParamsSchema } from '../../../../src/validators/auth/query-params.js';

describe('authQueryParamsSchema', () => {
  it('accepts an empty query (all fields optional)', () => {
    expect(authQueryParamsSchema.parse({})).toEqual({});
  });

  it('lower-cases and trims the email field', () => {
    const result = authQueryParamsSchema.parse({
      email: '  USER@Example.IO  ',
    });
    expect(result.email).toBe('user@example.io');
  });

  it('rejects an invalid email', () => {
    expect(
      authQueryParamsSchema.safeParse({ email: 'not-an-email' }).success
    ).toBe(false);
  });

  it('accepts a structurally-valid continue path (trust check is later)', () => {
    const result = authQueryParamsSchema.parse({
      continue: '/account',
    });
    expect(result.continue).toBe('/account');
  });

  it('accepts an http(s) URL string for continue', () => {
    expect(
      authQueryParamsSchema.parse({
        continue: 'https://example.com/x',
      }).continue
    ).toBe('https://example.com/x');
  });

  it('rejects a continue value over 2048 characters', () => {
    expect(
      authQueryParamsSchema.safeParse({
        continue: `/${'x'.repeat(2048)}`,
      }).success
    ).toBe(false);
  });

  it('rejects a redirect_uri that is not http(s)', () => {
    expect(
      authQueryParamsSchema.safeParse({
        redirect_uri: 'javascript:alert(1)',
      }).success
    ).toBe(false);
  });

  it('rejects a prompt outside the allow-list', () => {
    expect(authQueryParamsSchema.safeParse({ prompt: 'bogus' }).success).toBe(
      false
    );
  });

  it('rejects an intent outside the allow-list', () => {
    expect(authQueryParamsSchema.safeParse({ intent: 'bogus' }).success).toBe(
      false
    );
  });

  it('rejects token / interaction_uid below the minimum length', () => {
    expect(authQueryParamsSchema.safeParse({ token: '123' }).success).toBe(
      false
    );
    expect(
      authQueryParamsSchema.safeParse({ interaction_uid: 'abc' }).success
    ).toBe(false);
  });

  it('preserves additional query parameters (controller is the destructuring boundary)', () => {
    const result = authQueryParamsSchema.parse({
      email: 'a@b.io',
      client_name: 'My App',
      client_logo: 'https://example.com/logo.png',
    } as unknown as Record<string, unknown>);
    expect((result as unknown as { client_name: string }).client_name).toBe(
      'My App'
    );
  });
});
