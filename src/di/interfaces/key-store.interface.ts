/**
 * Key Store Interface for JWKS Key Management
 *
 * Abstracts JWKS key storage (database or file) with support for:
 * - Key lifecycle management (active → expiring → retired)
 * - Two-phase rotation (generate unpromoted → promote to signing priority)
 * - Encrypted-at-rest private keys (DB store)
 * - Multi-tenancy readiness via tenantId parameter
 */

export type KeyStatus = 'active' | 'expiring' | 'retired';

export interface StoredKey {
  kid: string;
  alg: string;
  use: string;
  status: KeyStatus;
  promoted: boolean;
  privateKey: JsonWebKey; // decrypted at runtime
  publicKey: JsonWebKey; // always plain
  createdAt: Date;
  rotatedAt?: Date;
  tenantId: string; // default: 'default' (future multi-tenancy)
}

export interface IKeyStore {
  /**
   * Initialize key store, loading existing keys or generating initial keyset
   */
  initialize(tenantId?: string): Promise<void>;

  /**
   * Get full JWKS (private + public keys) for token signing.
   * Returns active + expiring keys ordered by promotion status:
   * 1. active + promoted (signing priority)
   * 2. active + unpromoted (verification only)
   * 3. expiring (verification only)
   */
  getJWKS(tenantId?: string): Promise<{ keys: JsonWebKey[] }>;

  /**
   * Get public-only JWKS for the /.well-known/jwks.json endpoint
   */
  getPublicJWKS(tenantId?: string): Promise<{ keys: JsonWebKey[] }>;

  /**
   * Phase 1 of rotation: generate new keys (unpromoted), move current active → expiring.
   * New keys are available for verification but NOT used for signing until promoted.
   */
  rotate(tenantId?: string): Promise<void>;

  /**
   * Phase 2 of rotation: promote unpromoted active keys to signing priority.
   * @returns Number of keys promoted
   */
  promoteKeys(tenantId?: string): Promise<number>;

  /**
   * Retire keys that have been in 'expiring' status past the overlap window.
   * @returns Number of keys retired
   */
  retireExpiredKeys(tenantId?: string): Promise<number>;

  /**
   * List all keys with their metadata
   */
  listKeys(tenantId?: string): Promise<StoredKey[]>;

  /**
   * Check if rotation is needed based on configured interval
   */
  needsRotation(tenantId?: string): Promise<boolean>;
}
