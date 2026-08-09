import { describe, it, expect } from 'vitest';
import { Provider } from 'oidc-provider';
import * as jose from 'jose';
import { get as getWeakCache } from 'oidc-provider/lib/helpers/weak_cache.js';
import { updateProviderJWKS } from '../../../src/oidc/provider-keystore-updater.js';
import type { JWKWithMetadata } from '../../../src/oidc/key-store/constants.js';

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
  async function generateJWKS(
    count: number
  ): Promise<{ keys: JWKWithMetadata[] }> {
    const keys: JWKWithMetadata[] = [];
    for (let i = 0; i < count; i++) {
      const { privateKey } = await jose.generateKeyPair('RS256', {
        extractable: true,
      });
      const jwk = await jose.exportJWK(privateKey);
      jwk.use = 'sig';
      jwk.alg = 'RS256';
      jwk.kid = await jose.calculateJwkThumbprint(jwk as jose.JWK, 'sha256');
      keys.push(jwk as JWKWithMetadata);
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
    const initialKeystore = cacheBefore.keystore;
    const initialKids = (
      cacheBefore.jwks as { keys: JWKWithMetadata[] }
    ).keys.map(key => key.kid);

    // Hot-swap with expanded JWKS (2 keys)
    const expandedJWKS = await generateJWKS(2);
    updateProviderJWKS(provider, expandedJWKS);

    // Verify internal cache was updated
    const cacheAfter = getWeakCache(provider);
    expect(cacheAfter.keystore).toBeDefined();

    // initializeKeyStore replaces both the signing store and the public JWKS
    // cache consumed by the provider's /jwks endpoint.
    expect(cacheAfter.keystore).not.toBe(initialKeystore);
    expect(
      Array.from(cacheAfter.keystore as Iterable<JWKWithMetadata>)
    ).toHaveLength(2);
    const publicJwks = cacheAfter.jwks as { keys: JWKWithMetadata[] };
    expect(publicJwks.keys.map(key => key.kid)).toEqual(
      expandedJWKS.keys.map(key => key.kid)
    );
    expect(publicJwks.keys.map(key => key.kid)).not.toEqual(initialKids);
    expect(publicJwks.keys.every(key => key.d === undefined)).toBe(true);
  });

  it('should not throw when called with valid JWKS', async () => {
    const jwks = await generateJWKS(1);
    const provider = new Provider('https://test.example.com', { jwks });

    const newJwks = await generateJWKS(3);
    expect(() => updateProviderJWKS(provider, newJwks)).not.toThrow();
  });
});
