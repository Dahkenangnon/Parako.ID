import type { Provider } from 'oidc-provider';

export interface IProviderService {
  initProvider(): Promise<Provider>;
  setProvider(provider: Provider): void;
  getProvider(): Provider | null;
  hasProvider(): boolean;
  getOidcPath(): string;
  reloadJWKS(): Promise<void>;

  /**
   * Get the OIDC Provider for a given tenant.
   * When multi-tenancy is enabled, delegates to TenantProviderRegistry.
   * When disabled, returns the single provider instance.
   */
  getProviderForTenant(tenantId: string): Promise<Provider>;
}
