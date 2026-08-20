import { describe, expect, it } from 'vitest';

import {
  decodeBase64Url,
  encodeBase64Url,
  isSafeSameOriginRedirect,
  isWebAuthnSupported,
} from '../../../src/assets/js/utils/webauthn-browser.js';

describe('WebAuthn browser invariants', () => {
  it('round-trips base64url values without padding', () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
    const encoded = encodeBase64Url(bytes.buffer);

    expect(encoded).toBe('AAECf4D-_w');
    expect(Array.from(new Uint8Array(decodeBase64Url(encoded)))).toEqual(
      Array.from(bytes)
    );
  });

  it('recognizes WebAuthn only when PublicKeyCredential is callable', () => {
    expect(isWebAuthnSupported({ PublicKeyCredential: class {} })).toBe(true);
    expect(isWebAuthnSupported({ PublicKeyCredential: undefined })).toBe(false);
    expect(isWebAuthnSupported({ PublicKeyCredential: {} })).toBe(false);
  });

  it('accepts relative and same-origin HTTP redirects only', () => {
    const origin = 'https://id.example.test';

    expect(isSafeSameOriginRedirect('/accounts', origin)).toBe(true);
    expect(
      isSafeSameOriginRedirect('https://id.example.test/accounts', origin)
    ).toBe(true);
    expect(isSafeSameOriginRedirect('//evil.example/accounts', origin)).toBe(
      false
    );
    expect(isSafeSameOriginRedirect('javascript:alert(1)', origin)).toBe(false);
    expect(isSafeSameOriginRedirect('', origin)).toBe(false);
  });
});
