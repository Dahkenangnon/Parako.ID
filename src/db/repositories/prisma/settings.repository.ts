import { injectable } from 'inversify';
import { PrismaClient } from '@prisma/client';
import type { ISettings } from '../../../models/settings/types.js';
import type {
  ISettingsRepository,
  CreateSettingsDto,
  SettingsMeta,
} from '../interfaces/settings.repository.js';
import type { QueryOptions } from '../interfaces/base.repository.js';
import { AbstractPrismaRepository } from './base.repository.js';

// ─── DB row type ──────────────────────────────────────────────────────────────

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
  const parsed = JSON.parse(row.value) as Partial<ISettings>;
  const meta = JSON.parse(row.metadata) as SettingsMeta;
  return {
    id: row.id,
    _id: row.id,
    key: row.key,
    version: row.version,
    schema_version: row.schema_version,
    _version: row.int_version,
    is_active: row.is_active,
    metadata: Object.keys(meta).length > 0 ? meta : undefined,
    created_at: row.created_at.toISOString(),
    ...parsed,
  } as ISettings;
}

// ─── Field mapping (domain → Prisma column) ──────────────────────────────────

const FIELD_MAP: Record<string, string> = {
  is_active: 'is_active',
  schema_version: 'schema_version',
  _version: 'int_version',
};

function toPrismaFilter(
  filter: Record<string, unknown>
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filter)) {
    mapped[FIELD_MAP[key] ?? key] = value;
  }
  return mapped;
}

// ─── Repository ───────────────────────────────────────────────────────────────

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
    const row = await this.prisma.settings.create({
      data: {
        key: data.key,
        version: data.version,
        schema_version: data.schema_version ?? '1.0.0',
        int_version: data._version ?? 0,
        is_active: data.is_active ?? true,
        value: JSON.stringify(data),
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
    const merged = { ...JSON.parse(current.value), ...data };
    const row = await this.prisma.settings.update({
      where: { id },
      data: { value: JSON.stringify(merged) },
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

  // ── ISettingsRepository ────────────────────────────────────────────────────

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
    meta?: SettingsMeta
  ): Promise<ISettings> {
    // Get latest for version increment (outside transaction — SQLite is file-locked)
    const latest = await this.prisma.settings.findFirst({
      where: { key },
      orderBy: { int_version: 'desc' },
    });

    await this.prisma.settings.updateMany({
      where: { key, is_active: true },
      data: { is_active: false },
    });

    const nextVersion = this.incrementPatch(latest?.version ?? '0.0.0');
    const nextIntVersion = (latest?.int_version ?? 0) + 1;

    const created = await this.prisma.settings.create({
      data: {
        key,
        version: nextVersion,
        schema_version: '1.0.0',
        int_version: nextIntVersion,
        is_active: true,
        value: JSON.stringify(value),
        metadata: JSON.stringify(meta ?? {}),
      },
    });

    return toISettings(created);
  }

  async getLatestVersion(key: string): Promise<string | null> {
    const row = await this.prisma.settings.findFirst({
      where: { key },
      orderBy: { int_version: 'desc' },
    });
    return row?.version ?? null;
  }
}
