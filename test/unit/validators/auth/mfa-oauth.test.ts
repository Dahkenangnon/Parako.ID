import { describe, it, expect } from 'vitest';

import { mfaMethodQuerySchema } from '../../../../src/validators/auth/mfa.js';
import { oauthCallbackQuerySchema } from '../../../../src/validators/auth/oauth-callback.js';

describe('mfaMethodQuerySchema', () => {
  it.each(['totp', 'sms', 'email', 'backup_codes'])(
    'accepts %s as a valid method',
    method => {
      expect(mfaMethodQuerySchema.parse({ method })).toEqual({ method });
    }
  );

  it('accepts an empty query', () => {
    expect(mfaMethodQuerySchema.parse({})).toEqual({});
  });

  it('rejects an unknown method', () => {
    expect(mfaMethodQuerySchema.safeParse({ method: 'face' }).success).toBe(
      false
    );
  });
});

describe('oauthCallbackQuerySchema', () => {
  it('accepts the canonical authorization-code shape', () => {
    expect(
      oauthCallbackQuerySchema.parse({
        code: 'auth-code',
        state: 'state-token',
      })
    ).toEqual({ code: 'auth-code', state: 'state-token' });
  });

  it('accepts the canonical error shape', () => {
    expect(
      oauthCallbackQuerySchema.parse({
        error: 'access_denied',
        error_description: 'The user denied the request',
      })
    ).toEqual({
      error: 'access_denied',
      error_description: 'The user denied the request',
    });
  });

  it('rejects a code over 2000 characters', () => {
    expect(
      oauthCallbackQuerySchema.safeParse({ code: 'x'.repeat(2001) }).success
    ).toBe(false);
  });

  it('rejects a state over 500 characters', () => {
    expect(
      oauthCallbackQuerySchema.safeParse({ state: 'x'.repeat(501) }).success
    ).toBe(false);
  });
});
