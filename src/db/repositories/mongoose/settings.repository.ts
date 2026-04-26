import { injectable } from 'inversify';
import type { ISettings } from '../../../models/settings/types.js';
import type { SettingsModel } from '../../../models/settings.model.js';
import type {
  ISettingsRepository,
  CreateSettingsDto,
  SettingsMeta,
} from '../interfaces/settings.repository.js';
import { AbstractMongooseRepository } from './base.repository.js';
import { serializeDocument, serializeDocuments } from '../../utils.js';

@injectable()
export class MongooseSettingsRepository
  extends AbstractMongooseRepository<ISettings, CreateSettingsDto>
  implements ISettingsRepository
{
  constructor(private readonly settingsModel: SettingsModel) {
    super(settingsModel);
  }

  async findActive(key: string): Promise<ISettings | null> {
    return this.findOne({ key, is_active: true });
  }

  async findVersion(key: string, version: string): Promise<ISettings | null> {
    return this.findOne({ key, version });
  }

  async findHistory(key: string, limit = 20): Promise<ISettings[]> {
    const docs = await this.settingsModel
      .find({ key })
      .sort({ _version: -1 })
      .limit(limit)
      .lean()
      .exec();
    return serializeDocuments(docs) as ISettings[];
  }

  async save(
    key: string,
    value: Partial<ISettings>,
    meta?: SettingsMeta
  ): Promise<ISettings> {
    // Atomic phase 1: deactivate the current active row and learn its _version.
    // findOneAndUpdate is a single atomic op — no session needed.
    const previous = await this.settingsModel
      .findOneAndUpdate(
        { key, is_active: true },
        { $set: { is_active: false } },
        { returnDocument: 'before' } // return old doc (before update) to read _version
      )
      .lean()
      .exec();

    const nextIntVersion = previous ? ((previous as any)._version ?? 0) + 1 : 0;
    const nextSemver = previous
      ? this.incrementPatch((previous as any).version ?? '1.0.0')
      : '1.0.0';

    // Phase 2: insert the new active row.
    // Strip managed/identity fields before spreading so that:
    //   - _id / id don't cause duplicate key errors (rollback passes a full doc)
    //   - is_active, key, version, _version, schema_version always come from
    //     our computed values, not whatever the caller passed in
    const MANAGED = new Set([
      '_id',
      'id',
      'key',
      'version',
      'schema_version',
      '_version',
      'is_active',
      'created_at',
      'updated_at',
      '__v',
    ]);
    const raw = value as Record<string, unknown>;
    const content = Object.fromEntries(
      Object.entries(raw).filter(([k]) => !MANAGED.has(k))
    );

    const newDoc = await this.settingsModel.create({
      ...content,
      key,
      version: nextSemver,
      schema_version: '1.0.0',
      _version: nextIntVersion,
      is_active: true,
      metadata: meta ?? raw['metadata'] ?? {},
    });

    return serializeDocument(newDoc as any) as ISettings;
  }

  async getLatestVersion(key: string): Promise<string | null> {
    const doc = await this.settingsModel
      .findOne({ key })
      .sort({ _version: -1 })
      .lean()
      .exec();
    return doc ? ((doc as any).version ?? null) : null;
  }

  private incrementPatch(semver: string): string {
    const parts = semver.split('.').map(Number);
    parts[2] = (parts[2] ?? 0) + 1;
    return parts.join('.');
  }
}
