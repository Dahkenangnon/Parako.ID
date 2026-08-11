import {
  errors,
  type ClientMetadata,
  type KoaContextWithOIDC,
} from 'oidc-provider';
import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';

const REQUIRED_EXTRA_CLIENT_METADATA = ['ttl'] as const;
const CLIENT_TTL_KEYS = new Set([
  'AccessToken',
  'BackchannelAuthenticationRequest',
  'ClientCredentials',
  'RefreshToken',
]);

function validateClientTtl(value: unknown): void {
  if (value === undefined) return;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new errors.InvalidClientMetadata(
      'ttl must be an object of positive integer lifetimes'
    );
  }

  const entries = Object.entries(value);
  if (
    entries.length === 0 ||
    entries.some(
      ([key, ttl]) =>
        !CLIENT_TTL_KEYS.has(key) ||
        !Number.isSafeInteger(ttl) ||
        (ttl as number) <= 0
    )
  ) {
    throw new errors.InvalidClientMetadata(
      'ttl contains an unsupported artifact or invalid lifetime'
    );
  }
}

/**
 * Factory function to create extra client metadata configuration
 * @param configManager - Configuration manager instance
 * @returns Configuration object for extra client metadata
 */
export default function ExtraClientMetadata(configManager: IConfigManager) {
  const config = configManager.getConfig();

  /**
   * Extra Client Metadata Configuration
   *
   * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#extraclientmetadata}
   *
   * Allows for custom client metadata to be defined, validated, manipulated as well as for existing
   * property validations to be extended. Existing properties are snakeCased on a Client instance
   * (e.g. client.redirectUris), new properties (defined by this configuration) will be available
   * with their names verbatim (e.g. client['urn:example:client:my-property']).
   *
   * @type {Object} Configuration object for extra client metadata
   */
  return {
    /**
     * List of custom client metadata properties to be added to the client configuration.
     * These properties will be available on the client instance with their original names.
     *
     * Current custom properties:
     * - isInternalClient: Boolean indicating if the client is for Parako.ID or third party
     * - resourcesScopes: String containing resource scopes the client is allowed to request
     * - allowedResources: Array of resource servers the client is allowed to request tokens for
     * - ttl: Positive per-client lifetimes for the supported token artifacts
     *
     * @type {string[]} Array of property names
     */
    properties: [
      ...new Set([
        ...(config.features.oidc.extra_client_metadata?.properties ?? []),
        ...REQUIRED_EXTRA_CLIENT_METADATA,
      ]),
    ],

    /**
     * Validator function for custom client metadata properties.
     * This function is called during client registration or update to validate custom properties.
     *
     * @param {KoaContextWithOIDC} ctx - Koa request context (only provided during Client Registration or Update)
     * @param {string} key - The client metadata property name
     * @param {any} value - The property value to validate
     * @param {ClientMetadata} metadata - The current accumulated client metadata
     *
     * @throws {errors.InvalidClientMetadata} When validation fails
     */
    validator: function extraClientMetadataValidator(
      _ctx: KoaContextWithOIDC,
      key: string,
      value: unknown,
      _metadata: ClientMetadata
    ) {
      if (key === 'ttl') validateClientTtl(value);
    },
  };
}
