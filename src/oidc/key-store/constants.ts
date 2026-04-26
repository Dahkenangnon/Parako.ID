/**
 * Shared constants for key store implementations.
 */

/** RSA/EC/OKP private-key fields to strip when producing public JWKS. */
export const PRIVATE_KEY_FIELDS = [
  'd',
  'p',
  'q',
  'dp',
  'dq',
  'qi',
  'k',
] as const;

/**
 * JWK extended with the `kid` field that the standard `JsonWebKey`
 * type omits.  Both `alg` and `use` are already on `JsonWebKey`.
 */
export interface JWKWithMetadata extends JsonWebKey {
  kid?: string;
}
