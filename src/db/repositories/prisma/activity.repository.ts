import { injectable } from 'inversify';
import crypto from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import type { IActivity } from '../../../models/activity.model.js';
import type {
  IActivityRepository,
  ActivityFilter,
  CreateActivityDto,
} from '../interfaces/activity.repository.js';
import type {
  PaginatedResult,
  PaginationOptions,
} from '../interfaces/base.repository.js';
import { AbstractPrismaRepository } from './base.repository.js';

// ─── Include clause ────────────────────────────────────────────────────────────

const ACTIVITY_INCLUDE = {
  actor: true,
  target: true,
  device: true,
} as const;

type ActivityFull = Prisma.ActivityGetPayload<{
  include: typeof ACTIVITY_INCLUDE;
}>;

// ─── Mapping ──────────────────────────────────────────────────────────────────

function toIActivity(row: ActivityFull): IActivity {
  return {
    id: row.id,
    _id: row.id,
    type: row.type,
    description: row.description,
    timestamp: row.timestamp,
    status: row.status as IActivity['status'],
    ip_address: row.ip_address ?? '',
    user_agent: row.user_agent ?? undefined,
    client_id: row.client_id ?? undefined,
    is_private: row.is_private,
    related_activity_id: row.related_activity_id ?? undefined,
    actor: row.actor
      ? {
          actor_type: row.actor.actor_type as NonNullable<
            IActivity['actor']
          >['actor_type'],
          user_id: row.actor.user_id as any,
          username: row.actor.username ?? undefined,
          email: row.actor.email ?? undefined,
          full_name: row.actor.full_name ?? undefined,
          given_name: row.actor.given_name ?? undefined,
          family_name: row.actor.family_name ?? undefined,
        }
      : undefined,
    target: row.target
      ? {
          target_type: row.target.target_type as NonNullable<
            IActivity['target']
          >['target_type'],
          user_id: row.target.user_id as any,
          username: row.target.username ?? undefined,
          email: row.target.email ?? undefined,
          full_name: row.target.full_name ?? undefined,
          entity_id: row.target.entity_id ?? undefined,
          entity_name: row.target.entity_name ?? undefined,
          entity_data: row.target.entity_data
            ? (JSON.parse(row.target.entity_data) as Record<string, unknown>)
            : undefined,
        }
      : undefined,
    device_infos: row.device
      ? {
          fingerprint: row.device.fingerprint ?? undefined,
          fingerprint_js_id: row.device.fingerprint_js_id ?? undefined,
          browser:
            row.device.browser_name || row.device.browser_version
              ? {
                  name: row.device.browser_name ?? undefined,
                  version: row.device.browser_version ?? undefined,
                }
              : undefined,
          os:
            row.device.os_name || row.device.os_version
              ? {
                  name: row.device.os_name ?? undefined,
                  version: row.device.os_version ?? undefined,
                }
              : undefined,
          device:
            row.device.device_type || row.device.device_vendor
              ? {
                  type: row.device.device_type ?? undefined,
                  vendor: row.device.device_vendor ?? undefined,
                  model: row.device.device_model ?? undefined,
                }
              : undefined,
          language: row.device.language ?? undefined,
          platform: row.device.platform ?? undefined,
          screen:
            row.device.screen_width != null || row.device.screen_height != null
              ? {
                  width: row.device.screen_width ?? undefined,
                  height: row.device.screen_height ?? undefined,
                  pixel_ratio: row.device.screen_pixel_ratio ?? undefined,
                }
              : undefined,
          hardware_concurrency: row.device.hardware_concurrency ?? undefined,
          memory: row.device.memory ?? undefined,
          is_new_device: row.device.is_new_device ?? undefined,
          is_suspicious: row.device.is_suspicious ?? undefined,
          confidence_score: row.device.confidence_score ?? undefined,
          risk_level:
            (row.device.risk_level as NonNullable<
              IActivity['device_infos']
            >['risk_level']) ?? undefined,
          matched_device_id: row.device.matched_device_id ?? undefined,
          reason: row.device.reason ?? undefined,
          geo_location:
            row.device.geo_country || row.device.geo_city
              ? {
                  country: row.device.geo_country ?? undefined,
                  region: row.device.geo_region ?? undefined,
                  city: row.device.geo_city ?? undefined,
                  latitude: row.device.geo_lat ?? undefined,
                  longitude: row.device.geo_lon ?? undefined,
                  timezone: row.device.geo_timezone ?? undefined,
                }
              : undefined,
          device_trust:
            row.device.device_trust_trusted != null
              ? {
                  trusted: row.device.device_trust_trusted,
                  trusted_at: row.device.device_trust_trusted_at ?? new Date(),
                  trusted_until: row.device.device_trust_until ?? new Date(),
                  fingerprint: row.device.fingerprint ?? '',
                }
              : undefined,
        }
      : undefined,
    created_at: row.created_at.toISOString(),
  };
}

// ─── Repository ───────────────────────────────────────────────────────────────

@injectable()
export class PrismaActivityRepository
  extends AbstractPrismaRepository
  implements IActivityRepository
{
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  async create(data: CreateActivityDto): Promise<IActivity> {
    const row = await this.prisma.activity.create({
      data: {
        id: crypto.randomUUID(),
        type: data.type,
        description: data.description,
        timestamp: data.timestamp ?? new Date(),
        status: data.status,
        ip_address: data.ip_address ?? null,
        user_agent: data.user_agent ?? null,
        client_id: data.client_id ?? null,
        is_private: data.is_private ?? false,
        related_activity_id: data.related_activity_id ?? null,
        actor: data.actor
          ? {
              create: {
                actor_type: data.actor.actor_type,
                user_id: data.actor.user_id?.toString() ?? null,
                username: data.actor.username ?? null,
                email: data.actor.email ?? null,
                full_name: data.actor.full_name ?? null,
                given_name: data.actor.given_name ?? null,
                family_name: data.actor.family_name ?? null,
              },
            }
          : undefined,
        target: data.target
          ? {
              create: {
                target_type: data.target.target_type,
                user_id: data.target.user_id?.toString() ?? null,
                username: data.target.username ?? null,
                email: data.target.email ?? null,
                full_name: data.target.full_name ?? null,
                entity_id: data.target.entity_id ?? null,
                entity_name: data.target.entity_name ?? null,
                entity_data: data.target.entity_data
                  ? JSON.stringify(data.target.entity_data)
                  : null,
              },
            }
          : undefined,
        device: data.device_infos
          ? {
              create: {
                fingerprint: data.device_infos.fingerprint ?? null,
                fingerprint_js_id: data.device_infos.fingerprint_js_id ?? null,
                browser_name: data.device_infos.browser?.name ?? null,
                browser_version: data.device_infos.browser?.version ?? null,
                os_name: data.device_infos.os?.name ?? null,
                os_version: data.device_infos.os?.version ?? null,
                device_type: data.device_infos.device?.type ?? null,
                device_vendor: data.device_infos.device?.vendor ?? null,
                device_model: data.device_infos.device?.model ?? null,
                language: data.device_infos.language ?? null,
                platform: data.device_infos.platform ?? null,
                screen_width: data.device_infos.screen?.width ?? null,
                screen_height: data.device_infos.screen?.height ?? null,
                screen_pixel_ratio:
                  data.device_infos.screen?.pixel_ratio ?? null,
                hardware_concurrency:
                  data.device_infos.hardware_concurrency ?? null,
                memory: data.device_infos.memory ?? null,
                is_new_device: data.device_infos.is_new_device ?? null,
                is_suspicious: data.device_infos.is_suspicious ?? null,
                confidence_score: data.device_infos.confidence_score ?? null,
                risk_level: data.device_infos.risk_level ?? null,
                matched_device_id: data.device_infos.matched_device_id ?? null,
                reason: data.device_infos.reason ?? null,
                geo_country: data.device_infos.geo_location?.country ?? null,
                geo_region: data.device_infos.geo_location?.region ?? null,
                geo_city: data.device_infos.geo_location?.city ?? null,
                geo_lat: data.device_infos.geo_location?.latitude ?? null,
                geo_lon: data.device_infos.geo_location?.longitude ?? null,
                geo_timezone: data.device_infos.geo_location?.timezone ?? null,
              },
            }
          : undefined,
      },
      include: ACTIVITY_INCLUDE,
    });
    return toIActivity(row);
  }

  async findById(id: string): Promise<IActivity | null> {
    const row = await this.prisma.activity.findUnique({
      where: { id },
      include: ACTIVITY_INCLUDE,
    });
    return row ? toIActivity(row) : null;
  }

  async findMany(
    filter: ActivityFilter | Record<string, unknown>,
    opts?: PaginationOptions
  ): Promise<PaginatedResult<IActivity>> {
    const where = this.buildWhere(filter as ActivityFilter);
    return this.paginateDelegate(
      {
        findMany: args =>
          this.prisma.activity.findMany({ ...args, include: ACTIVITY_INCLUDE }),
        count: args => this.prisma.activity.count(args as any),
      },
      where,
      opts,
      row => toIActivity(row as ActivityFull)
    );
  }

  async findByUser(
    userId: string,
    opts?: PaginationOptions
  ): Promise<PaginatedResult<IActivity>> {
    return this.findMany({ 'actor.user_id': userId }, opts);
  }

  async findByDevice(fingerprint: string): Promise<IActivity[]> {
    const rows = await this.prisma.activity.findMany({
      where: { device: { fingerprint } },
      include: ACTIVITY_INCLUDE,
    });
    return rows.map(toIActivity);
  }

  async count(filter?: ActivityFilter): Promise<number> {
    const where = filter ? this.buildWhere(filter) : {};
    return this.prisma.activity.count({ where });
  }

  async deleteOlderThan(date: Date): Promise<number> {
    const result = await this.prisma.activity.deleteMany({
      where: { created_at: { lt: date } },
    });
    return result.count;
  }

  async getDistinctTypes(filter?: ActivityFilter): Promise<string[]> {
    const where: Record<string, unknown> = {};
    if (filter?.status) where.status = filter.status;
    if (filter?.['actor.user_id']) {
      where.actor = { user_id: String(filter['actor.user_id']) };
    }
    const groups = await this.prisma.activity.groupBy({
      by: ['type'],
      where: where as Prisma.ActivityWhereInput,
    });
    return groups.map((g: { type: string }) => g.type);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.activity.delete({ where: { id } });
  }

  // ── Unsupported base methods (activity is append-only) ───────────────────

  async findOne(filter: Record<string, unknown>): Promise<IActivity | null> {
    const row = await this.prisma.activity.findFirst({
      where: filter as Prisma.ActivityWhereInput,
      include: ACTIVITY_INCLUDE,
    });
    return row ? toIActivity(row) : null;
  }

  private buildWhere(filter: ActivityFilter): Record<string, unknown> {
    const where: Record<string, unknown> = {};
    if (filter.type) {
      where.type = Array.isArray(filter.type)
        ? { in: filter.type }
        : filter.type;
    }
    if (filter.status) where.status = filter.status;
    if (filter.client_id) where.client_id = filter.client_id;
    if (filter.is_private !== undefined) where.is_private = filter.is_private;
    if (filter.ip_address) where.ip_address = filter.ip_address;
    if (filter.timestamp) {
      where.timestamp = {};
      if (filter.timestamp.$gte)
        (where.timestamp as Record<string, unknown>).gte =
          filter.timestamp.$gte;
      if (filter.timestamp.$lte)
        (where.timestamp as Record<string, unknown>).lte =
          filter.timestamp.$lte;
    }
    if (filter['actor.user_id']) {
      where.actor = { user_id: String(filter['actor.user_id']) };
    }
    if (filter['actor.actor_type']) {
      where.actor = {
        ...(where.actor as object),
        actor_type: filter['actor.actor_type'],
      };
    }
    if (filter['actor.username']) {
      where.actor = {
        ...(where.actor as object),
        username: filter['actor.username'],
      };
    }
    if (filter['device_infos.fingerprint']) {
      where.device = { fingerprint: filter['device_infos.fingerprint'] };
    }
    return where;
  }
}
