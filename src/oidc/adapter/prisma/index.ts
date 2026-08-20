import type { PrismaClient } from '@prisma/client';
import BaseOIDCAdapter from '../base.js';
import type { OIDCPayload } from '../../interfaces/interface.js';
import type { ILogger } from '../../../di/interfaces/logger.interface.js';
import { ensureDecrypted } from '../../../utils/encryption.js';
import { sanitizeClientPayload } from '../client-crud-utils.js';
import { tenantContext } from '../../../multi-tenancy/tenant-context.js';
import { decodeOidcPayload } from '../payload-decoder.js';

/**
 * Prisma-backed OIDC adapter — stores all 14 oidc-provider model types
 * in the single `oidc_store` table, scoped by `model` column.
 *
 * Usage (factory for node-oidc-provider):
 *   const adapter = createPrismaAdapterFactory(prisma, logger);
 *   new Provider(issuer, { adapter });
 */
export class PrismaOidcStoreAdapter extends BaseOIDCAdapter {
  constructor(
    model: string,
    private readonly prisma: PrismaClient,
    logger: ILogger
  ) {
    super(model, logger);
  }

  private decodePayload(serialized: string): OIDCPayload {
    return decodeOidcPayload(serialized, `prisma_oidc.${this.name}.payload`);
  }

  /** Filter clause that excludes records past their expires_at. */
  private get notExpired() {
    const now = new Date();
    return { OR: [{ expires_at: null }, { expires_at: { gt: now } }] };
  }

  async upsert(
    id: string,
    payload: OIDCPayload,
    expiresIn?: number
  ): Promise<void> {
    try {
      const tenant_id = tenantContext.getTenantId();
      const expiresAt = expiresIn
        ? new Date(Date.now() + expiresIn * 1000)
        : null;

      const data = {
        model: this.name,
        payload: JSON.stringify(payload),
        grant_id: payload.grantId ?? null,
        user_code: payload.userCode ?? null,
        uid: payload.uid ?? null,
        account_id: (payload.accountId as string) ?? null,
        client_id: (payload.clientId as string) ?? null,
        expires_at: expiresAt,
        tenant_id,
      };

      // Defense-in-depth: Use findFirst + create/update instead of upsert.
      // Prisma upsert matches on the @id (primary key) alone, which means
      // a token ID collision between tenants would overwrite another tenant's
      // data. This pattern ensures the tenant_id filter is always in the WHERE.
      const existing = await this.prisma.oidcStore.findFirst({
        where: { id, model: this.name, tenant_id },
        select: { id: true },
      });

      if (existing) {
        await this.prisma.oidcStore.updateMany({
          where: { id, model: this.name, tenant_id },
          data,
        });
      } else {
        await this.prisma.oidcStore.create({
          data: { id, ...data },
        });
      }
    } catch (error) {
      this.logError(error as Error, 'upsert', id);
      throw error;
    }
  }

  async find(id: string): Promise<OIDCPayload | undefined> {
    try {
      const tenant_id = tenantContext.getTenantId();
      const row = await this.prisma.oidcStore.findFirst({
        where: { id, model: this.name, tenant_id, ...this.notExpired },
      });
      if (!row) return undefined;

      const payload = this.decodePayload(row.payload);

      // The spec requires find() to return a truthy `consumed` property after consume().
      if (row.consumed) {
        payload.consumed = Math.floor(row.consumed.getTime() / 1000);
      }

      // Decrypt client_secret for Client model (transparent migration)
      if (this.name === 'Client' && payload.client_secret) {
        payload.client_secret = ensureDecrypted(
          payload.client_secret as string
        );
      }

      // Strip empty strings / nulls so node-oidc-provider doesn't reject them
      if (this.name === 'Client') {
        return sanitizeClientPayload(payload);
      }

      return payload;
    } catch (error) {
      this.logError(error as Error, 'find', id);
      throw error;
    }
  }

  /** Return active records for this model in the current tenant. */
  async findAll(): Promise<OIDCPayload[]> {
    try {
      const tenant_id = tenantContext.getTenantId();
      const rows = await this.prisma.oidcStore.findMany({
        where: {
          model: this.name,
          tenant_id,
          ...this.notExpired,
        },
        orderBy: { created_at: 'desc' },
      });

      return rows.map(row => ({
        ...this.decodePayload(row.payload),
        _id: row.id,
      }));
    } catch (error) {
      this.logError(error as Error, 'findAll');
      throw error;
    }
  }

  async findByUserCode(userCode: string): Promise<OIDCPayload | undefined> {
    try {
      if (this.name !== 'DeviceCode') return undefined;
      const tenant_id = tenantContext.getTenantId();
      const row = await this.prisma.oidcStore.findFirst({
        where: {
          model: this.name,
          user_code: userCode,
          tenant_id,
          ...this.notExpired,
        },
      });
      if (!row) return undefined;
      return this.decodePayload(row.payload);
    } catch (error) {
      this.logError(error as Error, 'findByUserCode');
      throw error;
    }
  }

  async findByUid(uid: string): Promise<OIDCPayload | undefined> {
    try {
      if (this.name !== 'Session') return undefined;
      const tenant_id = tenantContext.getTenantId();
      const row = await this.prisma.oidcStore.findFirst({
        where: { model: this.name, uid, tenant_id, ...this.notExpired },
      });
      if (!row) return undefined;
      return this.decodePayload(row.payload);
    } catch (error) {
      this.logError(error as Error, 'findByUid');
      throw error;
    }
  }

  async consume(id: string): Promise<void> {
    try {
      const tenant_id = tenantContext.getTenantId();
      await this.prisma.oidcStore.updateMany({
        where: { id, model: this.name, tenant_id },
        data: { consumed: new Date() },
      });
    } catch (error) {
      this.logError(error as Error, 'consume', id);
      throw error;
    }
  }

  async destroy(id: string): Promise<void> {
    try {
      const tenant_id = tenantContext.getTenantId();
      await this.prisma.oidcStore.deleteMany({
        where: { id, model: this.name, tenant_id },
      });
    } catch (error) {
      this.logError(error as Error, 'destroy', id);
      throw error;
    }
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    try {
      if (!grantId) return;
      const tenant_id = tenantContext.getTenantId();
      // Scoped to this model + tenant — rows for non-grantable models simply
      // have no grant_id set, so deleteMany finds nothing and is a safe no-op.
      await this.prisma.oidcStore.deleteMany({
        where: { model: this.name, grant_id: grantId, tenant_id },
      });
    } catch (error) {
      this.logError(error as Error, 'revokeByGrantId');
      throw error;
    }
  }
}

/**
 * Factory for node-oidc-provider's `adapter` option.
 *
 * @example
 *   const adapter = createPrismaAdapterFactory(prisma, logger);
 *   new Provider(issuer, { adapter });
 */
export function createPrismaAdapterFactory(
  prisma: PrismaClient,
  logger: ILogger
) {
  return (modelName: string) =>
    new PrismaOidcStoreAdapter(modelName, prisma, logger);
}
