import { injectable } from 'inversify';
import type { ITenantSettingsOverride } from '../../../types/tenant-settings-override.js';
import type { TenantSettingsOverrideModel } from '../../../models/tenant-settings-override/model.js';
import type { ITenantSettingsOverrideRepository } from '../interfaces/tenant-settings-override.repository.js';
import { serializeDocument } from '../../utils.js';

const KEY = 'parako_config';

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
    // Phase 1: deactivate current active row
    const previous = await this.model
      .findOneAndUpdate(
        { key: KEY, is_active: true },
        { $set: { is_active: false } },
        { returnDocument: 'before' }
      )
      .lean()
      .exec();

    const nextIntVersion = previous ? ((previous as any)._version ?? 0) + 1 : 0;
    const nextSemver = previous
      ? this.incrementPatch((previous as any).version ?? '1.0.0')
      : '1.0.0';

    // Phase 2: insert new active row
    const MANAGED = new Set([
      '_id',
      'id',
      'key',
      'version',
      '_version',
      'is_active',
      'created_at',
      'updated_at',
      '__v',
      'tenant_id',
    ]);
    const raw = value as Record<string, unknown>;
    const content = Object.fromEntries(
      Object.entries(raw).filter(([k]) => !MANAGED.has(k))
    );

    const newDoc = await this.model.create({
      ...content,
      key: KEY,
      version: nextSemver,
      _version: nextIntVersion,
      is_active: true,
      metadata: meta
        ? { last_modified_by: meta.modifiedBy, change_reason: meta.reason }
        : (raw['metadata'] ?? {}),
    });

    return serializeDocument(newDoc as any) as ITenantSettingsOverride;
  }

  private incrementPatch(semver: string): string {
    const parts = semver.split('.').map(Number);
    parts[2] = (parts[2] ?? 0) + 1;
    return parts.join('.');
  }
}
