import { injectable } from 'inversify';
import crypto from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import type {
  ISocialIntegration,
  ProviderUserData,
  TokenData,
} from '../../../types/social-integration.js';
import type {
  ISocialIntegrationRepository,
  CreateSocialIntegrationDto,
  UpdateSocialIntegrationDto,
} from '../interfaces/social-integration.repository.js';
import type {
  PaginatedResult,
  PaginationOptions,
  QueryOptions,
} from '../interfaces/base.repository.js';
import { AbstractPrismaRepository, toOrderBy } from './base.repository.js';

// ─── Mapping ──────────────────────────────────────────────────────────────────

function toISocialIntegration(
  row: Prisma.SocialIntegrationGetPayload<object>
): ISocialIntegration {
  return {
    id: row.id,
    _id: row.id,
    user_id: row.user_id,
    method: row.method as ISocialIntegration['method'],
    provider_sub: row.provider_sub,
    provider_username: row.provider_username ?? undefined,
    provider_data: JSON.parse(row.provider_data) as ProviderUserData,
    tokens: row.tokens ? (JSON.parse(row.tokens) as TokenData) : undefined,
    is_active: row.is_active,
    last_used: row.last_used ?? undefined,
    metadata: row.metadata
      ? (JSON.parse(row.metadata) as ISocialIntegration['metadata'])
      : undefined,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

// ─── Repository ───────────────────────────────────────────────────────────────

@injectable()
export class PrismaSocialIntegrationRepository
  extends AbstractPrismaRepository
  implements ISocialIntegrationRepository
{
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  async create(data: CreateSocialIntegrationDto): Promise<ISocialIntegration> {
    const row = await this.prisma.socialIntegration.create({
      data: {
        id: crypto.randomUUID(),
        user_id: data.user_id,
        method: data.method,
        provider_sub: data.provider_sub,
        provider_username: data.provider_username ?? null,
        provider_data: JSON.stringify(data.provider_data),
        tokens: data.tokens ? JSON.stringify(data.tokens) : null,
        is_active: data.is_active ?? true,
        last_used: data.last_used ?? null,
        metadata: data.metadata ? JSON.stringify(data.metadata) : null,
      },
    });
    return toISocialIntegration(row);
  }

  async findById(id: string): Promise<ISocialIntegration | null> {
    const row = await this.prisma.socialIntegration.findUnique({
      where: { id },
    });
    return row ? toISocialIntegration(row) : null;
  }

  async findOne(
    filter: Record<string, unknown>
  ): Promise<ISocialIntegration | null> {
    const row = await this.prisma.socialIntegration.findFirst({
      where: filter as Prisma.SocialIntegrationWhereInput,
    });
    return row ? toISocialIntegration(row) : null;
  }

  async findMany(
    filter: Record<string, unknown>,
    opts?: QueryOptions
  ): Promise<ISocialIntegration[]> {
    const rows = await this.prisma.socialIntegration.findMany({
      where: filter as Prisma.SocialIntegrationWhereInput,
      orderBy: opts?.sort ? toOrderBy(opts.sort) : { created_at: 'desc' },
      take: opts?.limit,
      skip: opts?.skip,
    });
    return rows.map(toISocialIntegration);
  }

  async findByUserId(
    userId: string,
    opts?: PaginationOptions
  ): Promise<PaginatedResult<ISocialIntegration>> {
    return this.paginateDelegate(
      {
        findMany: args =>
          this.prisma.socialIntegration.findMany(
            args as Prisma.SocialIntegrationFindManyArgs
          ),
        count: args =>
          this.prisma.socialIntegration.count(
            args as Prisma.SocialIntegrationCountArgs
          ),
      },
      { user_id: userId },
      opts,
      row =>
        toISocialIntegration(row as Prisma.SocialIntegrationGetPayload<object>)
    );
  }

  async findByUserAndProvider(
    userId: string,
    provider: string
  ): Promise<ISocialIntegration | null> {
    const row = await this.prisma.socialIntegration.findFirst({
      where: { user_id: userId, method: provider },
    });
    return row ? toISocialIntegration(row) : null;
  }

  async findByProvider(provider: string): Promise<ISocialIntegration[]> {
    const rows = await this.prisma.socialIntegration.findMany({
      where: { method: provider },
    });
    return rows.map(toISocialIntegration);
  }

  async update(
    id: string,
    data: UpdateSocialIntegrationDto
  ): Promise<ISocialIntegration> {
    const updateData: Prisma.SocialIntegrationUpdateInput = {};
    if (data.user_id !== undefined) updateData.user_id = data.user_id;
    if (data.method !== undefined) updateData.method = data.method;
    if (data.provider_sub !== undefined)
      updateData.provider_sub = data.provider_sub;
    if (data.provider_username !== undefined)
      updateData.provider_username = data.provider_username ?? null;
    if (data.provider_data !== undefined)
      updateData.provider_data = JSON.stringify(data.provider_data);
    if (data.tokens !== undefined)
      updateData.tokens = data.tokens ? JSON.stringify(data.tokens) : null;
    if (data.is_active !== undefined) updateData.is_active = data.is_active;
    if (data.last_used !== undefined)
      updateData.last_used = data.last_used ?? null;
    if (data.metadata !== undefined)
      updateData.metadata = data.metadata
        ? JSON.stringify(data.metadata)
        : null;

    const row = await this.prisma.socialIntegration.update({
      where: { id },
      data: updateData,
    });
    return toISocialIntegration(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.socialIntegration.delete({ where: { id } });
  }

  async deleteByUserId(userId: string): Promise<number> {
    const result = await this.prisma.socialIntegration.deleteMany({
      where: { user_id: userId },
    });
    return result.count;
  }

  async count(filter?: Record<string, unknown>): Promise<number> {
    return this.prisma.socialIntegration.count({
      where: filter as Prisma.SocialIntegrationWhereInput,
    });
  }
}
