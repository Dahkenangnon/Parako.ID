import { injectable } from 'inversify';
import type { ITenantSettingsOverride } from '../../../types/tenant-settings-override.js';
import type { TenantSettingsOverrideModel } from '../../../models/tenant-settings-override/model.js';
import type { ITenantSettingsOverrideRepository } from '../interfaces/tenant-settings-override.repository.js';
import { serializeDocument } from '../../utils.js';

const KEY = 'parako_config';
const SAVE_MAX_ATTEMPTS = 16;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
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

@injectable()
export class MongooseTenantSettingsOverrideRepository implements ITenantSettingsOverrideRepository {
  constructor(private readonly model: TenantSettingsOverrideModel) {}

  async findActive(): Promise<ITenantSettingsOverride | null> {
    const doc = await this.model
      .findOne({ key: KEY, is_active: true })
      .lean()
      .exec();
    return serializeDocument(doc) as ITenantSettingsOverride | null;
  }

  async save(
    value: Partial<ITenantSettingsOverride>,
    meta?: { modifiedBy?: string; reason?: string }
  ): Promise<ITenantSettingsOverride> {
    const raw = value as Record<string, unknown>;
    const content = Object.fromEntries(
      Object.entries(raw).filter(([key]) => !MANAGED_OVERRIDE_FIELDS.has(key))
    );

    for (let attempt = 0; attempt < SAVE_MAX_ATTEMPTS; attempt += 1) {
      const previous = await this.model
        .findOneAndUpdate(
          { key: KEY, is_active: true },
          { $set: { is_active: false } },
          { returnDocument: 'before' }
        )
        .lean()
        .exec();
      const latest =
        previous ??
        (await this.model
          .findOne({ key: KEY })
          .sort({ _version: -1 })
          .lean()
          .exec());

      if (
        previous === null &&
        latest !== null &&
        attempt < SAVE_MAX_ATTEMPTS - 1
      ) {
        continue;
      }

      try {
        const newDoc = await this.model.create({
          ...content,
          key: KEY,
          version: latest
            ? this.incrementPatch((latest as any).version ?? '1.0.0')
            : '1.0.0',
          _version: latest ? ((latest as any)._version ?? 0) + 1 : 0,
          is_active: true,
          metadata: meta
            ? { last_modified_by: meta.modifiedBy, change_reason: meta.reason }
            : (raw['metadata'] ?? {}),
        });

        return serializeDocument(newDoc as any) as ITenantSettingsOverride;
      } catch (error: unknown) {
        if (!isDuplicateKeyError(error)) throw error;
      }
    }

    throw new Error(
      `Unable to save tenant settings after ${SAVE_MAX_ATTEMPTS} attempts`
    );
  }

  private incrementPatch(semver: string): string {
    const parts = semver.split('.').map(Number);
    parts[2] = (parts[2] ?? 0) + 1;
    return parts.join('.');
  }
}
