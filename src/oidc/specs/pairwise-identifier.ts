import crypto from 'node:crypto';
import type { Client } from 'oidc-provider';
import type { KoaContextWithOIDC } from 'oidc-provider';
import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';
import type { ILogger } from '../../di/interfaces/logger.interface.js';

/**
 * Factory function to create pairwise identifier generator
 * @param configManager - Configuration manager instance
 * @param logger - Logger instance
 * @returns Pairwise identifier generator function
 */
export default function PairwiseIdentifier(
  configManager: IConfigManager,
  logger: ILogger
) {
  const config = configManager.getConfig();

  // Memoization cache to improve performance when the same accountId/client
  // combination is requested multiple times
  const memoizationCache = new Map();
  const CACHE_MAX_SIZE = 1000; // Limit cache size to prevent memory leaks

  const SALT = config.oidc.secrets.pairwise_salt;

  /**
   * Pairwise Identifier Generator for OpenID Connect
   *
   * This function generates pairwise subject identifiers for ID Tokens and UserInfo responses
   * as specified in OpenID Connect Core 1.0. It creates unique, stable, and non-reversible
   * identifiers for each combination of user and client.
   *
   * The function implements the pairwise identifier algorithm as described in:
   * https://openid.net/specs/openid-connect-core-1_0.html#PairwiseAlg
   *
   * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#pairwiseidentifier}
   *
   * @param {KoaContextWithOIDC} ctx - The Koa request context
   * @param {string} accountId - The account identifier (sub) of the end-user
   * @param {Client} client - The client requesting the identifier
   * @param {string} client.sectorIdentifier - The sector identifier URI of the client
   * @returns {Promise<string>} A promise that resolves to the pairwise subject identifier
   *
   * @example
   * // Example usage in OIDC Provider configuration
   * const provider = new Provider('http://localhost:3000', {
   *   pairwiseIdentifier: pairwiseIdentifier
   * });
   *
   * @note
   * This function may be called multiple times in a single request with the same arguments.
   * Consider implementing memoization or caching based on account and client IDs for better performance. */
  return async function pairwiseIdentifier(
    _ctx: KoaContextWithOIDC,
    accountId: string,
    client: Client
  ) {
    try {
      if (!accountId || typeof accountId !== 'string') {
        throw new Error('Invalid accountId: must be a non-empty string');
      }

      if (!client || !client.sectorIdentifier) {
        throw new Error('Invalid client or missing sectorIdentifier');
      }

      const cacheKey = `${accountId}:${client.sectorIdentifier}`;

      if (memoizationCache.has(cacheKey)) {
        return memoizationCache.get(cacheKey);
      }

      const identifier = crypto
        .createHash('sha256')
        .update(client.sectorIdentifier as string)
        .update(accountId)
        .update(SALT)
        .digest('hex');

      if (memoizationCache.size < CACHE_MAX_SIZE) {
        memoizationCache.set(cacheKey, identifier);
      } else if (memoizationCache.size === CACHE_MAX_SIZE) {
        logger.warn('Pairwise identifier memoization cache reached capacity');
      }

      return identifier;
    } catch (error: any) {
      logger.error(error as Error, {
        context: `Error generating pairwise identifier: ${error.message}`,
      });
      // Fallback to a safe identifier in case of error, but still unique per user and client
      return crypto
        .createHash('sha256')
        .update(accountId || 'unknown')
        .update((client?.sectorIdentifier as string) || 'unknown')
        .update(SALT)
        .digest('hex');
    }
  };
}
