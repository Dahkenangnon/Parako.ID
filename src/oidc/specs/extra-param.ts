import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';

/**
 * Factory function to create extra parameters configuration
 * @param configManager - Configuration manager instance
 * @returns Array of allowed custom parameter names
 */
export default function ExtraParams(configManager: IConfigManager) {
  const config = configManager.getConfig();

  /**
   * Extra Authorization Request Parameters Configuration
   *
   * This configuration allows you to specify additional custom parameters that can be
   * passed through the OIDC authorization endpoints. By default, unknown parameters
   * are rejected by the OIDC provider. Adding parameter names here will allow them
   * to be accepted and made available in the request context.
   *
   * @see {@link https://github.com/panva/node-oidc-provider/blob/main/docs/README.md#extraparams}
   *
   * @example
   * // Suppose you want to support a custom parameter "tenant_id" for multi-tenancy:
   * // GET /authorize?client_id=spa123&scope=openid&tenant_id=acme-corp
   * //
   * // In your interaction logic, you can access ctx.oidc.params.tenant_id to:
   * //   - Load tenant-specific branding (e.g., logo, theme)
   * //   - Pre-select a tenant in a UI drop-down
   * //   - Tailor consent or login text
   * //
   * // If "tenant_id" is not listed here, the provider will reject the request.
   *
   * @type {string[]} Array of allowed custom parameter names
   */

  /**
   * List of extra parameter names allowed in authorization requests.
   * These are loaded from the configuration at 'features.oidc.extra_params.allowed_params'.
   * Defaults to an empty array if not set.
   */
  return config.features.oidc.extra_params.allowed_params;
}
