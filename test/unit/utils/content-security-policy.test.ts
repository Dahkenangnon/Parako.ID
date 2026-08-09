import { describe, expect, it } from 'vitest';

import { allowFormActionRedirectOrigin } from '../../../src/utils/content-security-policy.js';

const POLICY = "default-src 'self';form-action 'self';object-src 'none'";

describe('allowFormActionRedirectOrigin', () => {
  it.each([
    undefined,
    null,
    42,
    {},
    '',
    '/relative/callback',
    'javascript:alert(1)',
    'mailto:security@example.test',
  ])('leaves the policy unchanged for an unusable redirect URI: %j', value => {
    expect(allowFormActionRedirectOrigin(POLICY, value)).toBe(POLICY);
  });

  it.each([
    ['https://rp.example.test/callback?code=secret', 'https://rp.example.test'],
    ['http://127.0.0.1:9010/callback', 'http://127.0.0.1:9010'],
  ])('adds only the web origin from %s', (redirectUri, expectedOrigin) => {
    expect(allowFormActionRedirectOrigin(POLICY, redirectUri)).toBe(
      `default-src 'self';form-action 'self' ${expectedOrigin};object-src 'none'`
    );
  });

  it('does not duplicate an origin already present in form-action', () => {
    const policy =
      "default-src 'self';form-action 'self' https://rp.example.test;object-src 'none'";

    expect(
      allowFormActionRedirectOrigin(
        policy,
        'https://rp.example.test/different/path'
      )
    ).toBe(policy);
  });

  it('recognizes form-action when the directive is preceded by whitespace', () => {
    const policy = "default-src 'self'; form-action 'self'";

    expect(
      allowFormActionRedirectOrigin(policy, 'https://rp.example.test/callback')
    ).toBe("default-src 'self'; form-action 'self' https://rp.example.test");
  });

  it('leaves a policy without form-action unchanged', () => {
    const policy = "default-src 'self';object-src 'none'";

    expect(
      allowFormActionRedirectOrigin(policy, 'https://rp.example.test/callback')
    ).toBe(policy);
  });
});
