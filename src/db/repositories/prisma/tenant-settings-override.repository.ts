import { injectable } from 'inversify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { ITenantSettingsOverride } from '../../../types/tenant-settings-override.js';
import type { ITenantSettingsOverrideRepository } from '../interfaces/tenant-settings-override.repository.js';
import { AbstractPrismaRepository } from './base.repository.js';
import {
  decodePersistedJson,
  PersistedJsonObjectSchema,
} from '../../persistence/json-decoder.js';

const KEY = 'parako_config';
const SAVE_MAX_ATTEMPTS = 16;
const TenantOverrideMetadataSchema = z
  .object({
    last_modified_by: z.string().optional(),
    change_reason: z.string().optional(),
  })
  .passthrough();

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

const MANAGED_OVERRIDE_FIELDS = new Set([
  '_id',
  'id',
  'tenant_id',
  'key',
  'version',
  '_version',
  'is_active',
  'metadata',
  'created_at',
  'updated_at',
  '__v',
  '__proto__',
  'constructor',
  'prototype',
]);

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
  const parsed = decodePersistedJson(
    row.value,
    PersistedJsonObjectSchema,
    'tenant_settings_override.value'
  );
  const meta = decodePersistedJson(
    row.metadata,
    TenantOverrideMetadataSchema,
    'tenant_settings_override.metadata'
  );
  return {
    ...parsed,
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
  } as ITenantSettingsOverride;
}

function overrideContent(
  value: Partial<ITenantSettingsOverride>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !MANAGED_OVERRIDE_FIELDS.has(key))
  );
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
    const content = overrideContent(value);
    const metadataObj = meta
      ? { last_modified_by: meta.modifiedBy, change_reason: meta.reason }
      : (value.metadata ?? {});

    for (let attempt = 0; attempt < SAVE_MAX_ATTEMPTS; attempt += 1) {
      const deactivated = await this.prisma.tenantSettingsOverride.updateMany({
        where: { key: KEY, is_active: true },
        data: { is_active: false },
      });
      const latest = await this.prisma.tenantSettingsOverride.findFirst({
        where: { key: KEY },
        orderBy: { int_version: 'desc' },
      });

      if (
        deactivated.count === 0 &&
        latest !== null &&
        attempt < SAVE_MAX_ATTEMPTS - 1
      ) {
        continue;
      }

      try {
        const created = await this.prisma.tenantSettingsOverride.create({
          data: {
            key: KEY,
            version: latest
              ? this.incrementPatch(latest.version ?? '1.0.0')
              : '1.0.0',
            int_version: latest ? (latest.int_version ?? 0) + 1 : 0,
            is_active: true,
            value: JSON.stringify(content),
            metadata: JSON.stringify(metadataObj),
          },
        });

        return toITenantSettingsOverride(created);
      } catch (error: unknown) {
        if (!isUniqueConstraintError(error)) throw error;
      }
    }

    throw new Error(
      `Unable to save tenant settings after ${SAVE_MAX_ATTEMPTS} attempts`
    );
  }
}
