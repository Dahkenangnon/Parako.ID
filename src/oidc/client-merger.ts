import { injectable, inject } from 'inversify';
import { TYPES } from '../di/types.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IClientRegistryManager } from '../di/interfaces/client-registry-manager.interface.js';
import type { IOIDCClientMerger } from '../di/interfaces/oidc-client-merger.interface.js';
import {
  ClientTransformer,
  type UnifiedClient,
} from '../utils/client-transformer.js';

/**
 * Merges static OIDC clients (from parako-rp.jsonc) with passed adapter clients.
 *
 * After Step 19, this service no longer loads clients from the custom
 * OidcClient database model. Admin-created clients stored via the OIDC
 * adapter are automatically discovered by node-oidc-provider through
 * adapter.find('Client', clientId).
 */
@injectable()
export class OIDCClientMerger implements IOIDCClientMerger {
  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.ClientRegistryManager)
    private readonly clientRegistryManager: IClientRegistryManager
  ) {}

  /**
   * Load static clients from configuration file
   */
  public loadClients(): UnifiedClient[] {
    try {
      const rawClients = this.clientRegistryManager.getOidcProviderClients();
      const clients = ClientTransformer.transformClients(rawClients, 'static');

      this.logger.info(`[OIDC] Loaded ${clients.length} static clients`);

      return clients;
    } catch (error) {
      this.logger.error('Failed to load static clients', { error });
      return [];
    }
  }

  /**
   * Merge passed static clients with config-loaded static clients.
   */
  public mergeClients(staticClients: UnifiedClient[]): UnifiedClient[] {
    const configClients = this.loadClients();

    const seen = new Set(staticClients.map(c => c.client_id));
    const unique: UnifiedClient[] = [...staticClients];

    for (const client of configClients) {
      if (seen.has(client.client_id)) {
        this.logger.warn(
          `[OIDC] Duplicate client_id "${client.client_id}" between passed and config clients — skipping config copy`
        );
        continue;
      }
      seen.add(client.client_id);
      unique.push(client);
    }

    this.logger.info(
      `[OIDC] Total clients: ${unique.length} (${staticClients.length} passed + ${unique.length - staticClients.length} from config)`
    );

    return unique;
  }

  /**
   * Get client statistics for all sources.
   * adapter count is always 0 — adapter clients are managed separately.
   */
  public async getAllClientStatistics(): Promise<{
    total: number;
    static: number;
    adapter: number;
    byType: Record<string, number>;
    bySource: Record<string, number>;
    active: number;
    inactive: number;
  }> {
    const staticClients = this.loadClients();
    const transformerStats =
      ClientTransformer.getClientStatistics(staticClients);

    return {
      total: transformerStats.total,
      static: staticClients.length,
      adapter: 0,
      byType: transformerStats.byType,
      bySource: {
        static: staticClients.length,
        adapter: 0,
      },
      active: transformerStats.active,
      inactive: transformerStats.inactive,
    };
  }

  /**
   * Get synchronous client statistics (static clients only).
   */
  public getClientStatistics(): {
    total: number;
    static: number;
    adapter: number;
    byType: Record<string, number>;
    active: number;
    inactive: number;
  } {
    const clients = this.loadClients();
    const transformerStats = ClientTransformer.getClientStatistics(clients);

    return {
      total: transformerStats.total,
      static: clients.length,
      adapter: 0,
      byType: transformerStats.byType,
      active: transformerStats.active,
      inactive: transformerStats.inactive,
    };
  }

  /**
   * Format client data for template rendering.
   */
  public formatClientForTemplate(client: UnifiedClient) {
    const validation = ClientTransformer.validateClient(client);
    if (!validation.isValid) {
      this.logger.warn('Invalid client structure for template formatting', {
        client_id: client.client_id,
        errors: validation.errors,
      });
    }

    return {
      clientName: client.client_name || 'Application',
      clientId: client.client_id,
      policyUri: client.metadata.policy_uri,
      tosUri: client.metadata.tos_uri,
      clientUri: client.metadata.client_uri,
      logoUri: client.metadata.logo_uri || '/images/logo-light.svg',
    };
  }
}
