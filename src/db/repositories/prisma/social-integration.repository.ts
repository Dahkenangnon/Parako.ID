import { injectable } from 'inversify';
import crypto from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { z } from 'zod';
import type { ISocialIntegration } from '../../../types/social-integration.js';
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
import {
  AbstractPrismaRepository,
  normalizeToPrisma,
  toOrderBy,
} from './base.repository.js';
import { decodePersistedJson } from '../../persistence/json-decoder.js';

const ProviderUserDataSchema = z
  .object({
    sub: z.string(),
    email: z.string().optional(),
    email_verified: z.boolean().optional(),
    phone_number: z.string().optional(),
    phone_number_verified: z.boolean().optional(),
    name: z.string().optional(),
    given_name: z.string().optional(),
    family_name: z.string().optional(),
    picture: z.string().optional(),
    locale: z.string().optional(),
    provider_username: z.string().optional(),
    raw_data: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const TokenDataSchema = z
  .object({
    access_token: z.string(),
    refresh_token: z.string().optional(),
    id_token: z.string().optional(),
    token_type: z.string().optional(),
    expires_at: z
      .string()
      .datetime()
      .transform(value => new Date(value))
      .optional(),
    scope: z.string().optional(),
  })
  .passthrough();

const SocialMetadataSchema = z
  .object({
    created_by: z.enum(['user', 'admin', 'system']),
    linked_at: z
      .string()
      .datetime()
      .transform(value => new Date(value)),
    last_sync: z
      .string()
      .datetime()
      .transform(value => new Date(value))
      .optional(),
    sync_errors: z.array(z.string()).optional(),
  })
  .passthrough();

function parseMetadata(
  value: string | null
): ISocialIntegration['metadata'] | undefined {
  if (!value) return undefined;

  return decodePersistedJson(
    value,
    SocialMetadataSchema,
    'social_integration.metadata'
  );
}

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
    provider_data: decodePersistedJson(
      row.provider_data,
      ProviderUserDataSchema,
      'social_integration.provider_data'
    ),
    tokens: row.tokens
      ? decodePersistedJson(
          row.tokens,
          TokenDataSchema,
          'social_integration.tokens'
        )
      : undefined,
    is_active: row.is_active,
    last_used: row.last_used ?? undefined,
    metadata: parseMetadata(row.metadata),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

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
      where: normalizeToPrisma(filter) as Prisma.SocialIntegrationWhereInput,
    });
    return row ? toISocialIntegration(row) : null;
  }

  async findMany(
    filter: Record<string, unknown>,
    opts?: QueryOptions
  ): Promise<ISocialIntegration[]> {
    const rows = await this.prisma.socialIntegration.findMany({
      where: normalizeToPrisma(filter) as Prisma.SocialIntegrationWhereInput,
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
      where: filter
        ? (normalizeToPrisma(filter) as Prisma.SocialIntegrationWhereInput)
        : undefined,
    });
  }
}
