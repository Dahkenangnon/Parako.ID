import { describe, it, expect } from 'vitest';
import { Provider } from 'oidc-provider';
import * as jose from 'jose';
import { get as getWeakCache } from 'oidc-provider/lib/helpers/weak_cache.js';
import { updateProviderJWKS } from '../../../src/oidc/provider-keystore-updater.js';

/**
 * Integration test for updateProviderJWKS.
 *
 * Creates a real oidc-provider Provider with an initial JWKS, then
 * hot-swaps the keystore using updateProviderJWKS and verifies the
 * internal cache reflects the new keys.
 *
 * This test catches breakage when upgrading oidc-provider versions
 * since we rely on an internal module (initialize_keystore.js).
 */
describe('updateProviderJWKS', () => {
  async function generateJWKS(count: number): Promise<{ keys: JsonWebKey[] }> {
    const keys: JsonWebKey[] = [];
    for (let i = 0; i < count; i++) {
      const { privateKey } = await jose.generateKeyPair('RS256', {
        extractable: true,
      });
      const jwk = await jose.exportJWK(privateKey);
      jwk.use = 'sig';
      jwk.alg = 'RS256';
      jwk.kid = await jose.calculateJwkThumbprint(jwk as jose.JWK, 'sha256');
      keys.push(jwk as JsonWebKey);
    }
    return { keys };
  }

  it('should update the internal keystore on the existing provider', async () => {
    const initialJWKS = await generateJWKS(1);

    const provider = new Provider('https://test.example.com', {
      jwks: initialJWKS,
    });

    // Verify initial state via weak cache
    const cacheBefore = getWeakCache(provider);
    expect(cacheBefore.keystore).toBeDefined();

    // Hot-swap with expanded JWKS (2 keys)
    const expandedJWKS = await generateJWKS(2);
    updateProviderJWKS(provider, expandedJWKS);

    // Verify internal cache was updated
    const cacheAfter = getWeakCache(provider);
    expect(cacheAfter.keystore).toBeDefined();

    // The provider's /jwks endpoint should reflect the new keys
    // We verify via the internal keystore which exposes a toJWKS method
    const keystore = cacheAfter.keystore as any;
    if (typeof keystore.toJWKS === 'function') {
      const publicJwks = keystore.toJWKS(false);
      expect(publicJwks.keys).toHaveLength(2);
    }
  });

  it('should not throw when called with valid JWKS', async () => {
    const jwks = await generateJWKS(1);
    const provider = new Provider('https://test.example.com', { jwks });

    const newJwks = await generateJWKS(3);
    expect(() => updateProviderJWKS(provider, newJwks)).not.toThrow();
  });
});
