import type { UnifiedClient } from '../../utils/client-transformer.js';

/**
 * Interface for OIDC Client Merger service.
 *
 * After the client-source unification, the merger only handles:
 * - Static clients from parako-rp.jsonc (via ClientRegistryManager)
 * - Passed adapter clients (no DB loading)
 *
 * Admin-created clients stored in the OIDC adapter are discovered
 * automatically by node-oidc-provider via adapter.find('Client', id).
 */
export interface IOIDCClientMerger {
  /**
   * Load static clients from configuration file
   */
  loadClients(): UnifiedClient[];

  /**
   * Merge static clients from config with passed statics.
   */
  mergeClients(staticClients: UnifiedClient[]): UnifiedClient[];

  /**
   * Get client statistics for static clients.
   */
  getAllClientStatistics(): Promise<{
    total: number;
    static: number;
    adapter: number;
    byType: Record<string, number>;
    bySource: Record<string, number>;
    active: number;
    inactive: number;
  }>;

  /**
   * Get synchronous client statistics (static clients only).
   */
  getClientStatistics(): {
    total: number;
    static: number;
    adapter: number;
    byType: Record<string, number>;
    active: number;
    inactive: number;
  };

  /**
   * Format client data for template rendering.
   */
  formatClientForTemplate(client: UnifiedClient): {
    clientName: string;
    clientId: string;
    policyUri: string | undefined;
    tosUri: string | undefined;
    clientUri: string | undefined;
    logoUri: string;
  };
}
