import { injectable } from 'inversify';
import type { PrismaClient } from '@prisma/client';
import type { ITenantSettingsOverride } from '../../../types/tenant-settings-override.js';
import type { ITenantSettingsOverrideRepository } from '../interfaces/tenant-settings-override.repository.js';
import { AbstractPrismaRepository } from './base.repository.js';

const KEY = 'parako_config';

interface TsoRow {
  id: string;
  tenant_id: string;
  key: string;
  version: string;
  int_version: number;
  is_active: boolean;
  value: string;
  metadata: string;
  created_at: Date;
  updated_at: Date;
}

function toITenantSettingsOverride(row: TsoRow): ITenantSettingsOverride {
  const parsed = JSON.parse(row.value) as Partial<ITenantSettingsOverride>;
  const meta = JSON.parse(row.metadata) as {
    last_modified_by?: string;
    change_reason?: string;
  };
  return {
    id: row.id,
    _id: row.id,
    tenant_id: row.tenant_id,
    key: row.key,
    version: row.version,
    _version: row.int_version,
    is_active: row.is_active,
    metadata: Object.keys(meta).length > 0 ? meta : undefined,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    ...parsed,
  } as ITenantSettingsOverride;
}

@injectable()
export class PrismaTenantSettingsOverrideRepository
  extends AbstractPrismaRepository
  implements ITenantSettingsOverrideRepository
{
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  async findActive(): Promise<ITenantSettingsOverride | null> {
    const row = await this.prisma.tenantSettingsOverride.findFirst({
      where: { key: KEY, is_active: true },
    });
    return row ? toITenantSettingsOverride(row) : null;
  }

  async save(
    value: Partial<ITenantSettingsOverride>,
    meta?: { modifiedBy?: string; reason?: string }
  ): Promise<ITenantSettingsOverride> {
    const latest = await this.prisma.tenantSettingsOverride.findFirst({
      where: { key: KEY },
      orderBy: { int_version: 'desc' },
    });

    await this.prisma.tenantSettingsOverride.updateMany({
      where: { key: KEY, is_active: true },
      data: { is_active: false },
    });

    const nextVersion = this.incrementPatch(latest?.version ?? '0.0.0');
    const nextIntVersion = (latest?.int_version ?? 0) + 1;

    const metadataObj = meta
      ? { last_modified_by: meta.modifiedBy, change_reason: meta.reason }
      : {};

    const created = await this.prisma.tenantSettingsOverride.create({
      data: {
        key: KEY,
        version: nextVersion,
        int_version: nextIntVersion,
        is_active: true,
        value: JSON.stringify(value),
        metadata: JSON.stringify(metadataObj),
      },
    });

    return toITenantSettingsOverride(created);
  }
}
