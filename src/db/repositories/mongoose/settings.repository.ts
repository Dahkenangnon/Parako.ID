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

const SETTINGS_SAVE_MAX_ATTEMPTS = 16;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}

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
      '__proto__',
      'constructor',
      'prototype',
    ]);
    const raw = value as Record<string, unknown>;
    const content = Object.fromEntries(
      Object.entries(raw).filter(([k]) => !MANAGED.has(k))
    );

    for (let attempt = 0; attempt < SETTINGS_SAVE_MAX_ATTEMPTS; attempt += 1) {
      // Atomically claim the current active row. A missing row with existing
      // history means another writer currently owns the hand-off interval.
      const previous = await this.settingsModel
        .findOneAndUpdate(
          { key, is_active: true },
          { $set: { is_active: false } },
          { returnDocument: 'before' }
        )
        .lean()
        .exec();
      const latest =
        previous ??
        (await this.settingsModel
          .findOne({ key })
          .sort({ _version: -1 })
          .lean()
          .exec());

      if (
        previous === null &&
        latest !== null &&
        attempt < SETTINGS_SAVE_MAX_ATTEMPTS - 1
      ) {
        continue;
      }

      try {
        const newDoc = await this.settingsModel.create({
          ...content,
          key,
          version: latest
            ? this.incrementPatch((latest as any).version ?? '1.0.0')
            : '1.0.0',
          schema_version: '1.0.0',
          _version: latest ? ((latest as any)._version ?? 0) + 1 : 0,
          is_active: true,
          metadata: meta ?? raw['metadata'] ?? {},
        });

        return serializeDocument(newDoc as any) as ISettings;
      } catch (error: unknown) {
        if (!isDuplicateKeyError(error)) throw error;
      }
    }

    throw new Error(
      `Unable to save settings for key "${key}" after ${SETTINGS_SAVE_MAX_ATTEMPTS} attempts`
    );
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
