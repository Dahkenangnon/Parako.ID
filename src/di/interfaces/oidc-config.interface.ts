import type { Configuration } from 'oidc-provider';
import type { JWKWithMetadata } from '../../oidc/key-store/constants.js';

export interface IOIDCConfig {
  /**
   * Get the complete OIDC Provider configuration (excludes JWKS)
   * @returns Complete OIDC Provider configuration object
   */
  getConfig(): Configuration;

  /**
   * Get JWKS from the key store (async — call before provider creation)
   * @returns JWKS object with keys array
   */
  getJwks(): Promise<{ keys: JWKWithMetadata[] }>;

  /**
   * Initialize resource servers from DB clients (async).
   * Called after adapter initialization during provider startup.
   */
  initializeResourceServers(): Promise<void>;
}
