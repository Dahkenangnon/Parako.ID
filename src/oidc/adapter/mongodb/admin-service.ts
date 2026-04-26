import type { Db } from 'mongodb';
import type { ILogger } from '../../../di/interfaces/logger.interface.js';
import OIDCMongoAdapter from './index.js';
import type { OIDCDocument } from '../../interfaces/interface.js';
import type {
  OidcClientData,
  ClientFilters,
  ClientStatistics,
  ClientValidationResult,
  RegenerateSecretResult,
} from '../client.interface.js';
import {
  generateClientId,
  generateClientSecret,
  applyClientDefaults,
  validateClientData,
  filterClients,
  clientMatchesSearch,
  computeClientStatistics,
  encryptClientSecret,
  decryptClientSecret,
  sanitizeClientPayload,
} from '../client-crud-utils.js';
import { tenantContext } from '../../../multi-tenancy/tenant-context.js';

/**
 * MongodbOidcAdminService
 *
 * Consolidated admin service for MongoDB-backed OIDC models.
 * Replaces the 14 per-model per-file adapter classes (session.ts, grant.ts, …).
 * One instance per model type is constructed inline by OIDCAdapterBridge.
 */
export class MongodbOidcAdminService extends OIDCMongoAdapter {
  constructor(model: string, db: Db, logger: ILogger) {
    super(model, db, logger);
  }

  // ─── Session ───────────────────────────────────────────────────────────

  async findByAccountId(accountId: string): Promise<any[]> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const sessions = await this.coll()
        .find({
          'payload.accountId': accountId,
          'payload.exp': { $gt: now },
          'payload.kind': 'Session',
        })
        .toArray();
      return sessions || [];
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Error finding sessions by account ID',
      });
      return [];
    }
  }

  async revokeSession(sessionId: string): Promise<boolean> {
    try {
      const result = await this.coll().deleteOne({
        'payload.jti': sessionId,
      });
      return result.deletedCount > 0;
    } catch (error) {
      this.logger.error(error as Error, { context: 'Error revoking session' });
      return false;
    }
  }

  async revokeAllSessionsExcept(
    accountId: string,
    excludeSessionId: string
  ): Promise<number> {
    try {
      const result = await this.coll().deleteMany({
        'payload.accountId': accountId,
        'payload.kind': 'Session',
        'payload.jti': { $ne: excludeSessionId as any },
      });
      return result.deletedCount;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Error revoking all sessions except current',
      });
      return 0;
    }
  }

  async getSessionStatistics(): Promise<{
    total: number;
    active: number;
    expired: number;
  }> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const total = await this.coll().countDocuments({
        'payload.kind': 'Session',
      });
      const active = await this.coll().countDocuments({
        'payload.kind': 'Session',
        'payload.exp': { $gt: now },
      });
      const expired = await this.coll().countDocuments({
        'payload.kind': 'Session',
        'payload.exp': { $lte: now },
      });
      return { total, active, expired };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Error getting session statistics',
      });
      throw error;
    }
  }

  async countSessions(filters: any = {}): Promise<number> {
    try {
      return await this.coll().countDocuments(filters);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Error counting sessions',
      });
      throw error;
    }
  }

  async findSessionsWithPagination(
    filters: any = {},
    sortBy: string = 'createdAt',
    sortOrder: number = -1,
    skip: number = 0,
    limit: number = 20
  ): Promise<any[]> {
    try {
      return (await this.coll()
        .find(filters)
        .sort({ [sortBy]: sortOrder as 1 | -1 })
        .skip(skip)
        .limit(limit)
        .toArray()) as any[];
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Error finding sessions with pagination',
      });
      throw error;
    }
  }

  async findSessionById(sessionId: string): Promise<any | null> {
    try {
      const result = await this.coll().findOne({ 'payload.jti': sessionId });
      return result as any | null;
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error finding session by ID ${sessionId}`,
      });
      throw error;
    }
  }

  async getDistinctValues(field: string, filters: any = {}): Promise<any[]> {
    try {
      const results = await this.coll().distinct(field, filters);
      return results as any[];
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error getting distinct values for field ${field}`,
      });
      throw error;
    }
  }

  async exportAllSessions(): Promise<any[]> {
    try {
      const results = await this.coll()
        .find({ 'payload.kind': 'Session' })
        .sort({ 'payload.iat': -1 as 1 | -1 })
        .toArray();
      return results as any[];
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Error exporting all sessions',
      });
      throw error;
    }
  }

  async deleteSessionsByAccountId(
    accountId: string
  ): Promise<{ deletedCount: number }> {
    try {
      const result = await this.coll().deleteMany({
        'payload.accountId': accountId,
      });
      return { deletedCount: result.deletedCount || 0 };
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error deleting sessions for account ${accountId}`,
      });
      throw error;
    }
  }

  async deleteSessionsByIds(
    sessionIds: string[]
  ): Promise<{ deletedCount: number }> {
    try {
      if (sessionIds.length === 0) return { deletedCount: 0 };
      const result = await this.coll().deleteMany({
        _id: { $in: sessionIds as any },
      });
      return { deletedCount: result.deletedCount || 0 };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Error deleting multiple sessions',
      });
      throw error;
    }
  }

  // ─── Grant ─────────────────────────────────────────────────────────────

  async findGrantsByAccountId(accountId: string): Promise<OIDCDocument[]> {
    try {
      if (!accountId) {
        this.logger.warn('findGrantsByAccountId called with empty accountId');
        return [];
      }
      const results = await this.coll()
        .find<OIDCDocument>(
          { 'payload.accountId': accountId },
          { projection: { payload: 1, expiresAt: 1, _id: 1 } }
        )
        .toArray();
      this.logger.info(
        `Found ${results.length} grants for account ${accountId}`
      );
      return results;
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error finding grants for account ${accountId}`,
      });
      throw error;
    }
  }

  async findGrantsByClientId(clientId: string): Promise<OIDCDocument[]> {
    try {
      if (!clientId) {
        this.logger.warn('findGrantsByClientId called with empty clientId');
        return [];
      }
      const results = await this.coll()
        .find<OIDCDocument>(
          { 'payload.clientId': clientId },
          { projection: { payload: 1, expiresAt: 1, _id: 1 } }
        )
        .toArray();
      this.logger.info(`Found ${results.length} grants for client ${clientId}`);
      return results;
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error finding grants for client ${clientId}`,
      });
      throw error;
    }
  }

  async findGrantByAccountAndClient(
    accountId: string,
    clientId: string
  ): Promise<OIDCDocument | null> {
    try {
      if (!accountId || !clientId) {
        this.logger.warn(
          'findGrantByAccountAndClient called with empty accountId or clientId'
        );
        return null;
      }
      const result = await this.coll().findOne<OIDCDocument>(
        { 'payload.accountId': accountId, 'payload.clientId': clientId },
        { projection: { payload: 1, expiresAt: 1, _id: 1 } }
      );
      this.logger.info(
        result
          ? `Found grant for account ${accountId} and client ${clientId}`
          : `No grant found for account ${accountId} and client ${clientId}`
      );
      return result;
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error finding grant for account ${accountId} and client ${clientId}`,
      });
      throw error;
    }
  }

  async revokeGrantById(grantId: string): Promise<void> {
    try {
      if (!grantId) {
        this.logger.warn('revokeGrantById called with empty grantId');
        return;
      }
      const result = await this.coll().deleteOne({ _id: grantId } as any);
      if (result.deletedCount > 0) {
        this.logger.info(`Successfully revoked grant ${grantId}`);
      } else {
        this.logger.warn(`No grant found with ID ${grantId} to revoke`);
      }
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error revoking grant ${grantId}`,
      });
      throw error;
    }
  }

  async revokeAllGrantsForAccount(accountId: string): Promise<number> {
    try {
      if (!accountId) {
        this.logger.warn(
          'revokeAllGrantsForAccount called with empty accountId'
        );
        return 0;
      }
      const grants = await this.coll()
        .find<OIDCDocument>({ 'payload.accountId': accountId })
        .toArray();
      this.logger.info(
        `Found ${grants.length} grants for account ${accountId} before deletion`
      );
      if (grants.length === 0) return 0;
      let revokedCount = 0;
      for (const grant of grants) {
        try {
          const grantId = grant.payload.jti as string;
          if (!grantId) {
            this.logger.warn(
              `Grant ${grant._id} has no jti, skipping revocation`
            );
            continue;
          }
          await this.revokeByGrantId(grantId);
          revokedCount++;
        } catch (err) {
          this.logger.error(err as Error, {
            context: `Error revoking grant ${grant.payload.jti}`,
          });
        }
      }
      this.logger.info(
        `Successfully revoked ${revokedCount} grants for account ${accountId}`
      );
      return revokedCount;
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error revoking all grants for account ${accountId}`,
      });
      throw error;
    }
  }

  async revokeAllGrantsForClient(clientId: string): Promise<number> {
    try {
      if (!clientId) {
        this.logger.warn('revokeAllGrantsForClient called with empty clientId');
        return 0;
      }
      const grants = await this.coll()
        .find<OIDCDocument>({ 'payload.clientId': clientId })
        .toArray();
      this.logger.info(
        `Found ${grants.length} grants for client ${clientId} before deletion`
      );
      if (grants.length === 0) return 0;
      let revokedCount = 0;
      for (const grant of grants) {
        try {
          const grantId = grant.payload.jti as string;
          if (!grantId) continue;
          await this.revokeByGrantId(grantId);
          revokedCount++;
        } catch (err) {
          this.logger.error(err as Error, {
            context: `Error revoking grant ${grant.payload.jti}`,
          });
        }
      }
      this.logger.info(
        `Successfully revoked ${revokedCount} grants for client ${clientId}`
      );
      return revokedCount;
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error revoking all grants for client ${clientId}`,
      });
      throw error;
    }
  }

  async revokeGrantByAccountAndClient(
    accountId: string,
    clientId: string
  ): Promise<boolean> {
    try {
      if (!accountId || !clientId) {
        this.logger.warn(
          'revokeGrantByAccountAndClient called with empty accountId or clientId'
        );
        return false;
      }
      const grants = await this.coll()
        .find<OIDCDocument>({
          'payload.accountId': accountId,
          'payload.clientId': clientId,
        })
        .toArray();
      this.logger.info(
        `Found ${grants.length} grants for account ${accountId} and client ${clientId} before deletion`
      );
      if (grants.length === 0) return false;
      let revokedCount = 0;
      for (const grant of grants) {
        try {
          const grantId = grant.payload.jti as string;
          if (!grantId) continue;
          await this.revokeByGrantId(grantId);
          revokedCount++;
        } catch (err) {
          this.logger.error(err as Error, {
            context: `Error revoking grant ${grant.payload.jti}`,
          });
        }
      }
      if (revokedCount > 0) {
        this.logger.info(
          `Successfully revoked ${revokedCount} grant(s) for account ${accountId} and client ${clientId}`
        );
        return true;
      }
      this.logger.warn(
        `Failed to revoke any grants for account ${accountId} and client ${clientId}`
      );
      return false;
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error revoking grants for account ${accountId} and client ${clientId}`,
      });
      throw error;
    }
  }

  async countGrants(filters: any = {}): Promise<number> {
    try {
      return await this.coll().countDocuments(filters);
    } catch (error) {
      this.logger.error(error as Error, { context: 'Error counting grants' });
      throw error;
    }
  }

  async findGrantsWithPagination(
    filters: any = {},
    sortBy: string = 'createdAt',
    sortOrder: number = -1,
    skip: number = 0,
    limit: number = 20
  ): Promise<OIDCDocument[]> {
    try {
      return (await this.coll()
        .find(filters)
        .sort({ [sortBy]: sortOrder as 1 | -1 })
        .skip(skip)
        .limit(limit)
        .toArray()) as unknown as OIDCDocument[];
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Error finding grants with pagination',
      });
      throw error;
    }
  }

  async findGrantById(id: string): Promise<OIDCDocument | null> {
    try {
      const result = await this.coll().findOne({ _id: id } as any);
      return result as OIDCDocument | null;
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error finding grant by ID ${id}`,
      });
      throw error;
    }
  }

  async getGrantStatistics(): Promise<{
    total: number;
    recent: number;
    expired: number;
    byClient: Array<{ _id: string; count: number }>;
    byUser: Array<{ _id: string; count: number }>;
  }> {
    try {
      const total = await this.coll().countDocuments();
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const recent = await this.coll().countDocuments({
        'payload.iat': { $gte: Math.floor(thirtyDaysAgo.getTime() / 1000) },
      });
      const now = Math.floor(Date.now() / 1000);
      const expired = await this.coll().countDocuments({
        'payload.exp': { $lt: now },
      });
      const byClient = (await this.coll()
        .aggregate([
          { $group: { _id: '$payload.clientId', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ])
        .toArray()) as Array<{ _id: string; count: number }>;
      const byUser = (await this.coll()
        .aggregate([
          { $group: { _id: '$payload.accountId', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ])
        .toArray()) as Array<{ _id: string; count: number }>;
      return { total, recent, expired, byClient, byUser };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Error getting grant statistics',
      });
      throw error;
    }
  }

  async exportAllGrants(): Promise<OIDCDocument[]> {
    try {
      const results = await this.coll().find({}).toArray();
      return results as any[];
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Error exporting all grants',
      });
      throw error;
    }
  }

  async deleteGrantsByAccountId(
    accountId: string
  ): Promise<{ deletedCount: number }> {
    try {
      const result = await this.coll().deleteMany({
        'payload.accountId': accountId,
      });
      return { deletedCount: result.deletedCount || 0 };
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error deleting grants for account ${accountId}`,
      });
      throw error;
    }
  }

  // ─── AccessToken / RefreshToken / Interaction (deleteByAccountId) ──────

  /**
   * Delete all tokens/interactions for an account.
   * Works for AccessToken, RefreshToken, and Interaction models.
   * - AccessToken / RefreshToken: filter on `payload.accountId`
   * - Interaction: filter on `payload.session.accountId`
   */
  async deleteByAccountId(
    accountId: string
  ): Promise<{ deletedCount: number }> {
    try {
      const filter =
        this.name === 'Interaction'
          ? { 'payload.session.accountId': accountId }
          : { 'payload.accountId': accountId };
      const result = await this.coll().deleteMany(filter);
      return { deletedCount: result.deletedCount || 0 };
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error deleting ${this.name}s for account ${accountId}`,
      });
      throw error;
    }
  }

  // ─── Client CRUD (IAdapterClientService) ─────────────────────────────────

  /**
   * Create a new OIDC client in the adapter's Client collection.
   * Stores in adapter format: `{ _id: client_id, payload: { ...clientData } }`
   * so `node-oidc-provider` can discover it via `adapter.find('Client', id)`.
   */
  async createClient(data: Partial<OidcClientData>): Promise<OidcClientData> {
    const validation = validateClientData(data);
    if (!validation.isValid) {
      throw new Error(
        `Client validation failed: ${validation.errors.join(', ')}`
      );
    }

    const clientData = applyClientDefaults(data);
    const tenant_id = tenantContext.getTenantId();

    const existing = await this.coll().findOne({
      _id: clientData.client_id,
      tenant_id,
    } as any);
    if (existing) {
      throw new Error(`Client with ID ${clientData.client_id} already exists`);
    }

    const encrypted = encryptClientSecret(clientData);
    const result = await this.coll().insertOne({
      _id: clientData.client_id,
      payload: encrypted,
      tenant_id,
    } as any);

    this.logger.info(`Created client ${clientData.client_id}`, {
      context: 'ClientCRUD',
      collection: this.name,
      database: this.coll().dbName,
      acknowledged: result.acknowledged,
    });
    return clientData;
  }

  /**
   * Find a client by its client_id.
   */
  async findClientById(clientId: string): Promise<OidcClientData | null> {
    try {
      const tenant_id = tenantContext.getTenantId();
      const doc = await this.coll().findOne({
        _id: clientId,
        tenant_id,
      } as any);
      if (!doc) {
        this.logger.debug(`Client ${clientId} not found`, {
          context: 'ClientCRUD',
          collection: this.name,
          database: this.coll().dbName,
        });
        return null;
      }
      return this.extractClientPayload(doc);
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error finding client ${clientId}`,
        collection: this.name,
        database: this.coll().dbName,
      });
      return null;
    }
  }

  /**
   * Find all clients, optionally filtered.
   */
  async findAllClients(filters?: ClientFilters): Promise<OidcClientData[]> {
    try {
      const tenant_id = tenantContext.getTenantId();
      const docs = await this.coll().find({ tenant_id }).toArray();
      this.logger.debug(`Found ${docs.length} client documents`, {
        context: 'ClientCRUD',
        collection: this.name,
        database: this.coll().dbName,
      });
      const clients = docs.map(doc => this.extractClientPayload(doc));
      return filterClients(clients, filters);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Error finding all clients',
        collection: this.name,
        database: this.coll().dbName,
      });
      return [];
    }
  }

  /**
   * Update a client by its client_id.
   */
  async updateClient(
    clientId: string,
    updates: Partial<OidcClientData>
  ): Promise<OidcClientData | null> {
    try {
      const existing = await this.findClientById(clientId);
      if (!existing) return null;

      const merged = {
        ...existing,
        ...updates,
        client_id: clientId, // immutable
        updated_at: new Date().toISOString(),
      };

      const encrypted = encryptClientSecret(merged as OidcClientData);
      const tenant_id = tenantContext.getTenantId();
      await this.coll().updateOne(
        { _id: clientId, tenant_id } as any,
        { $set: { payload: encrypted, tenant_id } },
        { upsert: true }
      );

      return merged as OidcClientData;
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error updating client ${clientId}`,
      });
      return null;
    }
  }

  /**
   * Delete a client by its client_id.
   */
  async deleteClient(clientId: string): Promise<boolean> {
    try {
      const tenant_id = tenantContext.getTenantId();
      const result = await this.coll().deleteOne({
        _id: clientId,
        tenant_id,
      } as any);
      return result.deletedCount > 0;
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error deleting client ${clientId}`,
      });
      return false;
    }
  }

  /**
   * Search clients by name, ID, or description.
   */
  async searchClients(query: string): Promise<OidcClientData[]> {
    try {
      const tenant_id = tenantContext.getTenantId();
      const docs = await this.coll().find({ tenant_id }).toArray();
      const clients = docs.map(doc => this.extractClientPayload(doc));
      return clients.filter(c => clientMatchesSearch(c, query));
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error searching clients for "${query}"`,
      });
      return [];
    }
  }

  async activateClient(clientId: string): Promise<OidcClientData | null> {
    return this.updateClient(clientId, { active: true });
  }

  async deactivateClient(clientId: string): Promise<OidcClientData | null> {
    return this.updateClient(clientId, { active: false });
  }

  async regenerateClientSecret(
    clientId: string
  ): Promise<RegenerateSecretResult | null> {
    const existing = await this.findClientById(clientId);
    if (!existing) return null;

    const newSecret = generateClientSecret();
    const updated = await this.updateClient(clientId, {
      client_secret: newSecret,
    });

    return updated ? { client: updated, newSecret } : null;
  }

  async getClientStatistics(): Promise<ClientStatistics> {
    const clients = await this.findAllClients();
    return computeClientStatistics(clients);
  }

  async countClients(): Promise<number> {
    try {
      const tenant_id = tenantContext.getTenantId();
      return await this.coll().countDocuments({ tenant_id });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Error counting clients',
      });
      return 0;
    }
  }

  validateClientDataSync(
    data: Partial<OidcClientData>
  ): ClientValidationResult {
    return validateClientData(data);
  }

  generateClientId(): string {
    return generateClientId();
  }

  generateClientSecret(): string {
    return generateClientSecret();
  }

  // ─── Private: payload extraction ─────────────────────────────────────────

  private extractClientPayload(doc: any): OidcClientData {
    const payload = doc.payload || {};
    const clientData = sanitizeClientPayload({
      ...payload,
      client_id: payload.client_id || doc._id,
    }) as OidcClientData;
    return decryptClientSecret(clientData);
  }
}
