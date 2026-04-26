import type { Provider } from 'oidc-provider';

/**
 * Callback that configures a freshly created tenant Provider.
 * Applied once per provider creation (not on cache hit).
 * Receives the Provider instance and the tenant ID.
 */
export type ProviderConfigurator = (
  provider: Provider,
  tenantId: string
) => Promise<void>;

/**
 * Interface for the tenant provider registry.
 *
 * Manages a pool of `node-oidc-provider` Provider instances, one per tenant.
 * Each tenant gets its own Provider bound to its issuer URL, with its own
 * JWKS keys and OIDC configuration.
 */
export interface ITenantProviderRegistry {
  /**
   * Get (or lazily create) the OIDC Provider for the given tenant.
   * On cache hit, updates last-accessed timestamp and records Redis activity.
   * On cache miss, creates a new Provider with the correct issuer URL.
   *
   * @param tenantId - The tenant slug to get a provider for
   * @returns The OIDC Provider instance for the tenant
   * @throws If the tenant does not exist in the repository
   */
  getProvider(tenantId: string): Promise<Provider>;

  /** Check if a Provider is currently cached for the given tenant. */
  has(tenantId: string): boolean;

  /** Return the current number of cached Providers. */
  size(): number;

  /** Tear down the registry: clear pool, cancel timers. */
  shutdown(): void;

  /**
   * Register a configurator function that will be called on each new
   * Provider instance. Used by OidcManager to apply middleware, listeners,
   * and JWKS cache headers without creating circular DI dependencies.
   *
   * Must be called BEFORE any provider is created (typically during OidcManager.start()).
   */
  setProviderConfigurator(configurator: ProviderConfigurator): void;

  /**
   * Reload JWKS keystore on a specific tenant's cached Provider.
   * No-op if tenant has no cached provider.
   */
  reloadProviderJWKS(tenantId: string): Promise<void>;
}
