import type { SubjectTypes } from 'oidc-provider';
import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';

/**
 * Factory function to create subject types configuration
 * @param configManager - Configuration manager instance
 * @returns Subject types configuration array
 */
export default function SubjectTypes(configManager: IConfigManager) {
  const config = configManager.getConfig();

  /**
   * Subject Identifier Types Configuration
   *
   * This configuration defines the types of subject identifiers that the OpenID Provider
   * supports. The subject identifier is the unique identifier for the end-user at the
   * OpenID Provider.
   *
   * Two types are supported:
   * - 'public': The same subject identifier is used for all clients
   * - 'pairwise': A different subject identifier is used for each client
   *
   * When only 'pairwise' is supported, it becomes the default subject_type client
   * metadata value.
   *
   * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#subjecttypes}
   * @see {@link https://openid.net/specs/openid-connect-core-1_0.html#SubjectIDTypes}
   *
   * @type {string[]}
   *
   * @example
   * // Example usage in OIDC Provider configuration
   * const provider = new Provider('http://localhost:3000', {
   *   subjectTypes: ['public', 'pairwise']
   * });
   */
  return config.features.oidc.subject_types as SubjectTypes[];
}
