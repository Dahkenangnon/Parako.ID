import { describe, expect, it } from 'vitest';

import { PRIVATE_KEY_FIELDS } from '../../../../src/oidc/key-store/constants.js';

describe('OIDC key-store constants', () => {
  it('redacts every private RSA, EC/OKP, and symmetric JWK member', () => {
    expect(PRIVATE_KEY_FIELDS).toEqual(['d', 'p', 'q', 'dp', 'dq', 'qi', 'k']);
    expect(new Set(PRIVATE_KEY_FIELDS).size).toBe(PRIVATE_KEY_FIELDS.length);
  });
});
