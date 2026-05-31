import { describe, it, expect } from 'vitest';

import {
  VALID_SOCIAL_PROVIDERS,
  socialProviderParamSchema,
  socialRefQuerySchema,
} from '../../../../src/validators/auth/social.js';

describe('socialProviderParamSchema', () => {
  it('accepts every known provider', () => {
    for (const provider of VALID_SOCIAL_PROVIDERS) {
      expect(socialProviderParamSchema.parse({ provider })).toEqual({
        provider,
      });
    }
  });

  it('rejects an unknown provider', () => {
    expect(
      socialProviderParamSchema.safeParse({ provider: 'myspace' }).success
    ).toBe(false);
  });
});

describe('socialRefQuerySchema', () => {
  it('accepts a v4 UUID', () => {
    expect(
      socialRefQuerySchema.parse({
        ref: '00000000-0000-4000-8000-000000000000',
      })
    ).toEqual({ ref: '00000000-0000-4000-8000-000000000000' });
  });

  it('rejects a non-UUID', () => {
    expect(socialRefQuerySchema.safeParse({ ref: 'not-a-uuid' }).success).toBe(
      false
    );
  });
});
