/**
 * Hot-swaps the OIDC Provider's internal JWKS keystore without recreating
 * the Provider instance.
 *
 * Uses the same `initializeKeyStore` function that the Provider constructor
 * calls internally — it validates keys, computes kids, registers algorithms,
 * and rebuilds the public JWKS cache.
 *
 * WARNING: This relies on an oidc-provider internal module. Pin the version
 * and cover with an integration test to catch breakage on upgrades.
 */
import initializeKeyStore from 'oidc-provider/lib/helpers/initialize_keystore.js';
import type { Provider } from 'oidc-provider';

export function updateProviderJWKS(
  provider: Provider,
  jwks: { keys: JsonWebKey[] }
): void {
  initializeKeyStore.call(provider, jwks);
}
