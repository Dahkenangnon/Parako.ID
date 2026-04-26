/**
 * Type declarations for oidc-provider internal modules.
 *
 * These are NOT part of the public API — they may break on major upgrades.
 * Pin oidc-provider version and cover with integration tests.
 */

declare module 'oidc-provider/lib/helpers/initialize_keystore.js' {
  /**
   * Re-initializes the Provider's internal keystore from a JWKS object.
   * Must be called with `this` bound to the Provider instance.
   */
  export default function initializeKeyStore(
    this: import('oidc-provider').Provider,
    jwks: { keys: JsonWebKey[] }
  ): void;
}

declare module 'oidc-provider/lib/helpers/weak_cache.js' {
  /**
   * WeakMap-backed cache keyed by Provider instance.
   * Used to access internal provider state (keystore, configuration, etc.).
   */
  export function get(ctx: import('oidc-provider').Provider): {
    keystore: unknown;
    [key: string]: unknown;
  };
  export function set(
    ctx: import('oidc-provider').Provider,
    value: unknown
  ): void;
}
