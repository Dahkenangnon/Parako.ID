import { describe, expect, it } from 'vitest';

import { createRegistrationTokenSchema } from '../../../../../src/api/v1/validators/registration-tokens.validator.js';

const requiredFields = {
  expires_in: 3_600,
  max_usage_count: 5,
};

describe('createRegistrationTokenSchema', () => {
  it('applies an independent default policy list', () => {
    const first = createRegistrationTokenSchema.parse(requiredFields);
    first.policies.push('mutated-by-caller');

    expect(createRegistrationTokenSchema.parse(requiredFields)).toEqual({
      ...requiredFields,
      policies: ['general-policy'],
    });
  });

  it('normalizes policy names and an optional admin note', () => {
    expect(
      createRegistrationTokenSchema.parse({
        ...requiredFields,
        policies: ['  general-policy  ', '  deployment-policy  '],
        note: '  CI deployment token  ',
      })
    ).toEqual({
      ...requiredFields,
      policies: ['general-policy', 'deployment-policy'],
      note: 'CI deployment token',
    });
  });

  it('omits a whitespace-only optional note', () => {
    expect(
      createRegistrationTokenSchema.parse({
        ...requiredFields,
        note: '   ',
      })
    ).toEqual({
      ...requiredFields,
      policies: ['general-policy'],
      note: undefined,
    });
  });

  it.each([300, 2_592_000])('accepts expires_in boundary %i', expires_in => {
    expect(
      createRegistrationTokenSchema.parse({
        ...requiredFields,
        expires_in,
      }).expires_in
    ).toBe(expires_in);
  });

  it.each([
    299,
    2_592_001,
    300.5,
    '3600',
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects invalid expires_in input %j', expires_in => {
    expect(
      createRegistrationTokenSchema.safeParse({
        ...requiredFields,
        expires_in,
      }).success
    ).toBe(false);
  });

  it.each([1, 1_000])(
    'accepts max_usage_count boundary %i',
    max_usage_count => {
      expect(
        createRegistrationTokenSchema.parse({
          ...requiredFields,
          max_usage_count,
        }).max_usage_count
      ).toBe(max_usage_count);
    }
  );

  it.each([0, 1_001, 1.5, '5', Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid max_usage_count input %j',
    max_usage_count => {
      expect(
        createRegistrationTokenSchema.safeParse({
          ...requiredFields,
          max_usage_count,
        }).success
      ).toBe(false);
    }
  );

  it('rejects duplicate policies after normalization', () => {
    const result = createRegistrationTokenSchema.safeParse({
      ...requiredFields,
      policies: ['general-policy', '  general-policy  '],
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected duplicate policies to fail');
    expect(result.error.issues).toEqual([
      expect.objectContaining({
        path: ['policies', 1],
        message: 'Registration policies must be unique',
      }),
    ]);
  });

  it.each([
    [],
    Array.from({ length: 11 }, (_, index) => `policy-${index}`),
    ['   '],
    ['x'.repeat(129)],
    'general-policy',
  ])('rejects invalid policy collection %j', policies => {
    expect(
      createRegistrationTokenSchema.safeParse({
        ...requiredFields,
        policies,
      }).success
    ).toBe(false);
  });

  it('rejects an oversized normalized note', () => {
    expect(
      createRegistrationTokenSchema.safeParse({
        ...requiredFields,
        note: `  ${'x'.repeat(501)}  `,
      }).success
    ).toBe(false);
  });

  it('strips unknown request-body properties without mutating the input', () => {
    const body = {
      ...requiredFields,
      policies: ['  general-policy  '],
      token: 'caller-controlled-secret',
    };

    expect(createRegistrationTokenSchema.parse(body)).toEqual({
      ...requiredFields,
      policies: ['general-policy'],
    });
    expect(body).toEqual({
      ...requiredFields,
      policies: ['  general-policy  '],
      token: 'caller-controlled-secret',
    });
  });
});
