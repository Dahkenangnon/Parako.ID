import { injectable } from 'inversify';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { ISettings } from '../../../models/settings/types.js';
import type {
  ISettingsRepository,
  CreateSettingsDto,
  SettingsMeta,
} from '../interfaces/settings.repository.js';
import type { QueryOptions } from '../interfaces/base.repository.js';
import { AbstractPrismaRepository } from './base.repository.js';
import { ConfigurationVersionConflictError } from '../../../errors/configuration-version-conflict.error.js';
import {
  decodePersistedJson,
  PersistedJsonObjectSchema,
} from '../../persistence/json-decoder.js';

const SettingsMetadataSchema = z.object({
  last_modified_by: z.string().optional(),
  change_reason: z.string().optional(),
  tags: z.array(z.string()).optional(),
  environment: z.string().optional(),
});

interface SettingsRow {
  id: string;
  key: string;
  version: string;
  schema_version: string;
  int_version: number;
  is_active: boolean;
  value: string;
  metadata: string;
  created_at: Date;
}

function toISettings(row: SettingsRow): ISettings {
  const parsed = decodePersistedJson(
    row.value,
    PersistedJsonObjectSchema,
    `settings.${row.id}.value`
  ) as Partial<ISettings>;
  const meta = decodePersistedJson(
    row.metadata,
    SettingsMetadataSchema,
    `settings.${row.id}.metadata`
  );
  return {
    ...parsed,
    id: row.id,
    _id: row.id,
    key: row.key,
    version: row.version,
    schema_version: row.schema_version,
    _version: row.int_version,
    is_active: row.is_active,
    metadata: Object.keys(meta).length > 0 ? meta : undefined,
    created_at: row.created_at.toISOString(),
  } as ISettings;
}

const FIELD_MAP = new Map<string, string>([
  ['is_active', 'is_active'],
  ['schema_version', 'schema_version'],
  ['_version', 'int_version'],
]);

const MANAGED_SETTINGS_FIELDS = new Set([
  '_id',
  'id',
  'key',
  'version',
  'schema_version',
  '_version',
  'is_active',
  'metadata',
  'created_at',
  'updated_at',
  '__v',
]);

const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SETTINGS_SAVE_MAX_ATTEMPTS = 16;

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

function settingsContent(
  value: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key]) =>
        !MANAGED_SETTINGS_FIELDS.has(key) && !UNSAFE_OBJECT_KEYS.has(key)
    )
  );
}

function toPrismaFilter(
  filter: Record<string, unknown>
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (UNSAFE_OBJECT_KEYS.has(key)) continue;
    mapped[FIELD_MAP.get(key) ?? key] = value;
  }
  return mapped;
}

@injectable()
export class PrismaSettingsRepository
  extends AbstractPrismaRepository
  implements ISettingsRepository
{
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  async findById(id: string): Promise<ISettings | null> {
    const row = await this.prisma.settings.findUnique({ where: { id } });
    return row ? toISettings(row) : null;
  }

  async findOne(filter: Record<string, unknown>): Promise<ISettings | null> {
    const row = await this.prisma.settings.findFirst({
      where: toPrismaFilter(filter),
    });
    return row ? toISettings(row) : null;
  }

  async findMany(
    filter: Record<string, unknown>,
    opts?: QueryOptions
  ): Promise<ISettings[]> {
    const rows = await this.prisma.settings.findMany({
      where: toPrismaFilter(filter),
      take: opts?.limit,
      skip: opts?.skip,
    });
    return rows.map(toISettings);
  }

  async create(data: CreateSettingsDto): Promise<ISettings> {
    const content = settingsContent(data as unknown as Record<string, unknown>);
    const row = await this.prisma.settings.create({
      data: {
        key: data.key,
        version: data.version,
        schema_version: data.schema_version ?? '1.0.0',
        int_version: data._version ?? 0,
        is_active: data.is_active ?? true,
        value: JSON.stringify(content),
        metadata: JSON.stringify(data.metadata ?? {}),
      },
    });
    return toISettings(row);
  }

  async update(
    id: string,
    data: Partial<CreateSettingsDto>
  ): Promise<ISettings> {
    const current = await this.prisma.settings.findUnique({ where: { id } });
    if (!current) throw new Error(`Settings not found: ${id}`);
    const currentContent = settingsContent(
      decodePersistedJson(
        current.value,
        PersistedJsonObjectSchema,
        `settings.${current.id}.value`
      )
    );
    const updateContent = settingsContent(
      data as unknown as Record<string, unknown>
    );
    const merged = { ...currentContent, ...updateContent };
    const managedUpdates: Record<string, unknown> = {};
    if (data.key !== undefined) managedUpdates.key = data.key;
    if (data.version !== undefined) managedUpdates.version = data.version;
    if (data.schema_version !== undefined)
      managedUpdates.schema_version = data.schema_version;
    if (data._version !== undefined) managedUpdates.int_version = data._version;
    if (data.is_active !== undefined) managedUpdates.is_active = data.is_active;
    if (data.metadata !== undefined)
      managedUpdates.metadata = JSON.stringify(data.metadata);
    const row = await this.prisma.settings.update({
      where: { id },
      data: { ...managedUpdates, value: JSON.stringify(merged) },
    });
    return toISettings(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.settings.delete({ where: { id } });
  }

  async count(filter?: Record<string, unknown>): Promise<number> {
    return this.prisma.settings.count({
      where: filter ? toPrismaFilter(filter) : undefined,
    });
  }

  async findActive(key: string): Promise<ISettings | null> {
    const row = await this.prisma.settings.findFirst({
      where: { key, is_active: true },
    });
    return row ? toISettings(row) : null;
  }

  async findVersion(key: string, version: string): Promise<ISettings | null> {
    const row = await this.prisma.settings.findFirst({
      where: { key, version },
    });
    return row ? toISettings(row) : null;
  }

  async findHistory(key: string, limit?: number): Promise<ISettings[]> {
    const rows = await this.prisma.settings.findMany({
      where: { key },
      orderBy: { int_version: 'desc' },
      take: limit,
    });
    return rows.map(toISettings);
  }

  async save(
    key: string,
    value: Partial<ISettings>,
    meta?: SettingsMeta,
    expectedVersion?: number
  ): Promise<ISettings> {
    const content = settingsContent(value as Record<string, unknown>);

    for (let attempt = 0; attempt < SETTINGS_SAVE_MAX_ATTEMPTS; attempt += 1) {
      const deactivated = await this.prisma.settings.updateMany({
        where: {
          key,
          is_active: true,
          ...(expectedVersion === undefined
            ? {}
            : { int_version: expectedVersion }),
        },
        data: { is_active: false },
      });
      const latest = await this.prisma.settings.findFirst({
        where: { key },
        orderBy: { int_version: 'desc' },
      });

      if (expectedVersion !== undefined && deactivated.count === 0) {
        throw new ConfigurationVersionConflictError(
          expectedVersion,
          latest?.int_version
        );
      }

      // Another writer owns the interval between deactivation and insertion.
      // Let it publish its revision, then claim that active row on a retry.
      // The final attempt also recovers a key left inactive by a crashed writer.
      if (
        deactivated.count === 0 &&
        latest !== null &&
        attempt < SETTINGS_SAVE_MAX_ATTEMPTS - 1
      ) {
        continue;
      }

      try {
        const created = await this.prisma.settings.create({
          data: {
            key,
            version: this.incrementPatch(latest?.version ?? '0.0.0'),
            schema_version: '1.0.0',
            int_version: (latest?.int_version ?? 0) + 1,
            is_active: true,
            value: JSON.stringify(content),
            metadata: JSON.stringify(meta ?? {}),
          },
        });

        return toISettings(created);
      } catch (error: unknown) {
        if (!isUniqueConstraintError(error)) throw error;
      }
    }

    throw new Error(
      `Unable to save settings for key "${key}" after ${SETTINGS_SAVE_MAX_ATTEMPTS} attempts`
    );
  }

  async getLatestVersion(key: string): Promise<string | null> {
    const row = await this.prisma.settings.findFirst({
      where: { key },
      orderBy: { int_version: 'desc' },
    });
    return row?.version ?? null;
  }
}
