import type { PrismaClient } from '@prisma/client';
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
} from '../client-crud-utils.js';
import { tenantContext } from '../../../multi-tenancy/tenant-context.js';

type OidcStoreRow = {
  id: string;
  model: string;
  payload: string;
  grant_id: string | null;
  user_code: string | null;
  uid: string | null;
  account_id: string | null;
  client_id: string | null;
  consumed: Date | null;
  expires_at: Date | null;
  created_at: Date;
};

/**
 * Prisma-backed admin service for OIDC store management.
 *
 * All methods query the single `oidc_store` table, scoped to one model type.
 * Queries use indexed columns (id, model, grant_id, uid, expires_at,
 * account_id, client_id) — no in-memory filtering of payload JSON.
 *
 * One instance is created per model type in initializePrisma():
 *   Session, Grant, Client, AccessToken, RefreshToken, Interaction
 */
export class PrismaOidcAdminService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly model: string
  ) {}

  // ── internals ────────────────────────────────────────────────────────────────

  private parsePayload(row: OidcStoreRow): any {
    const payload =
      typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    return {
      _id: row.id,
      payload,
      expiresAt: row.expires_at,
      created_at: row.created_at,
    };
  }

  /** Prisma where clause that excludes expired records. */
  private get notExpired() {
    return { OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }] };
  }

  /**
   * Translate MongoDB-style filters (used by session/grant controllers) into
   * Prisma where clauses using denormalized indexed columns.
   *
   * Supported filter keys:
   *   - 'payload.kind'      → ignored (redundant — already scoped by model)
   *   - 'payload.accountId' → account_id column (string or { $regex, $options })
   *   - 'payload.exp'       → expires_at column ({ $gt } or { $lte })
   */
  private buildPrismaWhere(filters: Record<string, any>): any {
    const where: any = { model: this.model };

    for (const [key, value] of Object.entries(filters)) {
      if (key === 'payload.kind') continue;

      if (key === 'payload.accountId') {
        if (typeof value === 'string') {
          where.account_id = value;
        } else if (value && typeof value === 'object' && '$regex' in value) {
          where.account_id = { contains: value.$regex };
        }
      } else if (key === 'payload.exp') {
        if (value && typeof value === 'object') {
          const expFilter: any = {};
          if ('$gt' in value)
            expFilter.gt = new Date((value.$gt as number) * 1000);
          if ('$lte' in value)
            expFilter.lte = new Date((value.$lte as number) * 1000);
          where.expires_at = expFilter;
        }
      }
    }

    return where;
  }

  // ── Session methods (used by session.controller, auth.controller, account.controller) ──

  async findByAccountId(accountId: string): Promise<any[]> {
    if (!accountId) return [];
    const rows = await this.prisma.oidcStore.findMany({
      where: { model: this.model, account_id: accountId, ...this.notExpired },
    });
    return (rows as OidcStoreRow[]).map(r => this.parsePayload(r));
  }

  async countSessions(filters: any = {}): Promise<number> {
    if (Object.keys(filters).length === 0) {
      return this.prisma.oidcStore.count({ where: { model: this.model } });
    }
    return this.prisma.oidcStore.count({
      where: this.buildPrismaWhere(filters),
    });
  }

  async findSessionsWithPagination(
    filters: any = {},
    _sortBy: string = 'created_at',
    sortOrder: number = -1,
    skip: number = 0,
    limit: number = 20
  ): Promise<any[]> {
    const where =
      Object.keys(filters).length === 0
        ? { model: this.model }
        : this.buildPrismaWhere(filters);

    const rows = await this.prisma.oidcStore.findMany({
      where,
      orderBy: { created_at: sortOrder === -1 ? 'desc' : 'asc' },
      skip,
      take: limit,
    });
    return (rows as OidcStoreRow[]).map(r => this.parsePayload(r));
  }

  /**
   * Find a session by its jti.
   * In oidc_store, jti IS the `id` column — direct indexed lookup.
   */
  async findSessionById(sessionId: string): Promise<any | null> {
    const row = await this.prisma.oidcStore.findFirst({
      where: { id: sessionId, model: this.model },
    });
    return row ? this.parsePayload(row as OidcStoreRow) : null;
  }

  /**
   * Revoke (delete) a session by its jti.
   * Direct indexed delete — no full-table scan.
   */
  async revokeSession(sessionId: string): Promise<boolean> {
    const { count } = await this.prisma.oidcStore.deleteMany({
      where: { id: sessionId, model: this.model },
    });
    return count > 0;
  }

  async revokeAllSessionsExcept(
    accountId: string,
    excludeSessionId: string
  ): Promise<number> {
    const { count } = await this.prisma.oidcStore.deleteMany({
      where: {
        model: this.model,
        account_id: accountId,
        id: { not: excludeSessionId },
      },
    });
    return count;
  }

  /**
   * Session statistics using indexed expires_at column.
   */
  async getSessionStatistics(): Promise<{
    total: number;
    active: number;
    expired: number;
  }> {
    const now = new Date();
    const [total, expired] = await Promise.all([
      this.prisma.oidcStore.count({ where: { model: this.model } }),
      this.prisma.oidcStore.count({
        where: {
          model: this.model,
          expires_at: { not: null, lt: now },
        },
      }),
    ]);
    return { total, active: total - expired, expired };
  }

  async getDistinctValues(field: string, filters: any = {}): Promise<any[]> {
    // Optimized path for the common 'payload.accountId' lookup
    if (field === 'payload.accountId') {
      const where =
        Object.keys(filters).length === 0
          ? { model: this.model }
          : this.buildPrismaWhere(filters);

      const rows = await this.prisma.oidcStore.findMany({
        where: { ...where, account_id: { not: null } },
        select: { account_id: true },
        distinct: ['account_id'],
      });
      return rows
        .map((r: { account_id: string | null }) => r.account_id)
        .filter(Boolean);
    }

    // Fallback for other fields — must parse payload
    const rows = await this.prisma.oidcStore.findMany({
      where: { model: this.model },
    });
    const values = new Set<any>();
    for (const r of rows as OidcStoreRow[]) {
      const parsed = this.parsePayload(r);
      const parts = field.split('.');
      let val: any = parsed;
      for (const part of parts) val = val?.[part];
      if (val !== undefined && val !== null) values.add(val);
    }
    return Array.from(values);
  }

  async exportAllSessions(): Promise<any[]> {
    const rows = await this.prisma.oidcStore.findMany({
      where: { model: this.model },
    });
    return (rows as OidcStoreRow[]).map(r => this.parsePayload(r));
  }

  async deleteSessionsByAccountId(
    accountId: string
  ): Promise<{ deletedCount: number }> {
    const { count } = await this.prisma.oidcStore.deleteMany({
      where: { model: this.model, account_id: accountId },
    });
    return { deletedCount: count };
  }

  /**
   * Delete sessions by their jti values.
   * jti IS the id column — single batch deleteMany.
   */
  async deleteSessionsByIds(
    sessionIds: string[]
  ): Promise<{ deletedCount: number }> {
    if (sessionIds.length === 0) return { deletedCount: 0 };

    const { count } = await this.prisma.oidcStore.deleteMany({
      where: { id: { in: sessionIds }, model: this.model },
    });
    return { deletedCount: count };
  }

  // ── Grant methods (grant.controller, auth.controller, account.controller) ────

  async findGrantsByAccountId(accountId: string): Promise<any[]> {
    if (!accountId) return [];
    const rows = await this.prisma.oidcStore.findMany({
      where: { model: this.model, account_id: accountId },
    });
    return (rows as OidcStoreRow[]).map(r => this.parsePayload(r));
  }

  async findGrantsByClientId(clientId: string): Promise<any[]> {
    if (!clientId) return [];
    const rows = await this.prisma.oidcStore.findMany({
      where: { model: this.model, client_id: clientId },
    });
    return (rows as OidcStoreRow[]).map(r => this.parsePayload(r));
  }

  async countGrants(filters: any = {}): Promise<number> {
    return this.countSessions(filters);
  }

  async findGrantsWithPagination(
    filters: any = {},
    sortBy: string = 'created_at',
    sortOrder: number = -1,
    skip: number = 0,
    limit: number = 20
  ): Promise<any[]> {
    return this.findSessionsWithPagination(
      filters,
      sortBy,
      sortOrder,
      skip,
      limit
    );
  }

  async findGrantById(id: string): Promise<any | null> {
    const row = await this.prisma.oidcStore.findFirst({
      where: { id, model: this.model },
    });
    return row ? this.parsePayload(row as OidcStoreRow) : null;
  }

  /** Base OIDC `find` — returns payload (what oidc-provider expects). */
  async find(id: string): Promise<any | undefined> {
    const row = await this.prisma.oidcStore.findFirst({
      where: { id, model: this.model },
    });
    if (!row) return undefined;
    return JSON.parse(row.payload);
  }

  /** Base OIDC `destroy`. */
  async destroy(id: string): Promise<void> {
    await this.prisma.oidcStore.deleteMany({
      where: { id, model: this.model },
    });
  }

  /**
   * Grant statistics using indexed columns.
   * Aggregate counts use indexed expires_at. Group-by uses denormalized
   * account_id / client_id columns via Prisma groupBy.
   */
  async getGrantStatistics(): Promise<{
    total: number;
    recent: number;
    expired: number;
    byClient: Array<{ _id: string; count: number }>;
    byUser: Array<{ _id: string; count: number }>;
  }> {
    const now = new Date();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Use indexed columns for aggregate counts.
    const [total, expired, recent] = await Promise.all([
      this.prisma.oidcStore.count({ where: { model: this.model } }),
      this.prisma.oidcStore.count({
        where: {
          model: this.model,
          expires_at: { not: null, lt: now },
        },
      }),
      this.prisma.oidcStore.count({
        where: {
          model: this.model,
          created_at: { gte: thirtyDaysAgo },
        },
      }),
    ]);

    const [clientGroups, userGroups] = await Promise.all([
      this.prisma.oidcStore.groupBy({
        by: ['client_id'],
        where: { model: this.model, client_id: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
      this.prisma.oidcStore.groupBy({
        by: ['account_id'],
        where: { model: this.model, account_id: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
    ]);

    const byClient = clientGroups.map(g => ({
      _id: g.client_id!,
      count: g._count.id,
    }));
    const byUser = userGroups.map(g => ({
      _id: g.account_id!,
      count: g._count.id,
    }));

    return { total, recent, expired, byClient, byUser };
  }

  async exportAllGrants(): Promise<any[]> {
    return this.exportAllSessions();
  }

  async deleteGrantsByAccountId(
    accountId: string
  ): Promise<{ deletedCount: number }> {
    return this.deleteSessionsByAccountId(accountId);
  }

  // ── Token / interaction methods (auth.controller) ─────────────────────────

  async deleteByAccountId(accountId: string): Promise<void> {
    await this.prisma.oidcStore.deleteMany({
      where: { model: this.model, account_id: accountId },
    });
  }

  // ── Client CRUD (IAdapterClientService) ───────────────────────────────────

  /**
   * Create a new OIDC client in the oidc_store table.
   * Stores as `{ id: client_id, model: 'Client', payload: JSON.stringify({...}) }`.
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

    const existing = await this.prisma.oidcStore.findFirst({
      where: { id: clientData.client_id, model: 'Client', tenant_id },
    });
    if (existing) {
      throw new Error(`Client with ID ${clientData.client_id} already exists`);
    }

    const encrypted = encryptClientSecret(clientData);
    await this.prisma.oidcStore.create({
      data: {
        id: clientData.client_id,
        model: 'Client',
        payload: JSON.stringify(encrypted),
        client_id: clientData.client_id,
        tenant_id,
        created_at: new Date(),
      },
    });

    return clientData;
  }

  async findClientById(clientId: string): Promise<OidcClientData | null> {
    const tenant_id = tenantContext.getTenantId();
    const row = await this.prisma.oidcStore.findFirst({
      where: { id: clientId, model: 'Client', tenant_id },
    });
    if (!row) return null;
    return this.extractClientPayload(row as OidcStoreRow);
  }

  async findAllClients(filters?: ClientFilters): Promise<OidcClientData[]> {
    const tenant_id = tenantContext.getTenantId();
    const rows = await this.prisma.oidcStore.findMany({
      where: { model: 'Client', tenant_id },
    });
    const clients = (rows as OidcStoreRow[]).map(r =>
      this.extractClientPayload(r)
    );
    return filterClients(clients, filters);
  }

  async updateClient(
    clientId: string,
    updates: Partial<OidcClientData>
  ): Promise<OidcClientData | null> {
    const existing = await this.findClientById(clientId);
    if (!existing) return null;

    const merged: OidcClientData = {
      ...existing,
      ...updates,
      client_id: clientId,
      updated_at: new Date().toISOString(),
    };

    const tenant_id = tenantContext.getTenantId();
    const encrypted = encryptClientSecret(merged);
    await this.prisma.oidcStore.updateMany({
      where: { id: clientId, model: 'Client', tenant_id },
      data: { payload: JSON.stringify(encrypted) },
    });

    return merged;
  }

  async deleteClient(clientId: string): Promise<boolean> {
    const tenant_id = tenantContext.getTenantId();
    const { count } = await this.prisma.oidcStore.deleteMany({
      where: { id: clientId, model: 'Client', tenant_id },
    });
    return count > 0;
  }

  async searchClients(query: string): Promise<OidcClientData[]> {
    const all = await this.findAllClients();
    return all.filter(c => clientMatchesSearch(c, query));
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
    const tenant_id = tenantContext.getTenantId();
    return this.prisma.oidcStore.count({
      where: { model: 'Client', tenant_id },
    });
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

  private extractClientPayload(row: OidcStoreRow): OidcClientData {
    const payload =
      typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    const clientData = {
      ...payload,
      client_id: payload.client_id || row.id,
    } as OidcClientData;
    return decryptClientSecret(clientData);
  }
}
