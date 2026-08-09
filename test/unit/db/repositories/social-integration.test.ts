import { describe, expect, it, vi } from 'vitest';
import type { CreateSocialIntegrationDto } from '../../../../src/db/repositories/interfaces/social-integration.repository.js';
import { MongooseSocialIntegrationRepository } from '../../../../src/db/repositories/mongoose/social-integration.repository.js';
import { PrismaSocialIntegrationRepository } from '../../../../src/db/repositories/prisma/social-integration.repository.js';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'social-1',
    user_id: 'user-1',
    method: 'google',
    provider_sub: 'provider-user-1',
    provider_username: null,
    provider_data: JSON.stringify({
      sub: 'provider-user-1',
      email: 'alice@example.com',
    }),
    tokens: null,
    is_active: true,
    last_used: null,
    metadata: null,
    created_at: new Date('2026-08-01T00:00:00.000Z'),
    updated_at: new Date('2026-08-01T00:01:00.000Z'),
    ...overrides,
  };
}

function fullRow() {
  return row({
    provider_username: 'alice',
    tokens: JSON.stringify({ access_token: 'access' }),
    last_used: new Date('2026-08-01T00:02:00.000Z'),
    metadata: JSON.stringify({
      created_by: 'user',
      linked_at: '2026-08-01T00:02:00.000Z',
      last_sync: '2026-08-01T00:03:00.000Z',
      sync_errors: ['previous transient failure'],
    }),
  });
}

function prismaClient(overrides: Record<string, unknown> = {}) {
  return {
    socialIntegration: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      ...overrides,
    },
  };
}

function query<T>(result: T) {
  const chain = {
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(result),
  };
  chain.lean.mockReturnValue(chain);
  return chain;
}

describe('Prisma social integration repository', () => {
  it('creates and maps minimal optional fields with defaults', async () => {
    const create = vi.fn().mockResolvedValue(row());
    const repository = new PrismaSocialIntegrationRepository(
      prismaClient({ create }) as never
    );
    const data = {
      user_id: 'user-1',
      method: 'google',
      provider_sub: 'provider-user-1',
      provider_data: {
        sub: 'provider-user-1',
        email: 'alice@example.com',
      },
    } as CreateSocialIntegrationDto;

    const result = await repository.create(data);

    expect(create).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        user_id: 'user-1',
        method: 'google',
        provider_sub: 'provider-user-1',
        provider_username: null,
        provider_data: JSON.stringify({
          sub: 'provider-user-1',
          email: 'alice@example.com',
        }),
        tokens: null,
        is_active: true,
        last_used: null,
        metadata: null,
      },
    });
    expect(result).toEqual({
      id: 'social-1',
      _id: 'social-1',
      user_id: 'user-1',
      method: 'google',
      provider_sub: 'provider-user-1',
      provider_username: undefined,
      provider_data: {
        sub: 'provider-user-1',
        email: 'alice@example.com',
      },
      tokens: undefined,
      is_active: true,
      last_used: undefined,
      metadata: undefined,
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-01T00:01:00.000Z',
    });
  });

  it('creates and maps the complete optional shape', async () => {
    const complete = fullRow();
    const create = vi.fn().mockResolvedValue(complete);
    const repository = new PrismaSocialIntegrationRepository(
      prismaClient({ create }) as never
    );
    const lastUsed = new Date('2026-08-01T00:02:00.000Z');

    const result = await repository.create({
      user_id: 'user-1',
      method: 'google',
      provider_sub: 'provider-user-1',
      provider_username: 'alice',
      provider_data: {
        sub: 'provider-user-1',
        email: 'alice@example.com',
      },
      tokens: { access_token: 'access' },
      is_active: false,
      last_used: lastUsed,
      metadata: {
        created_by: 'user',
        linked_at: lastUsed,
        sync_errors: ['previous transient failure'],
      },
    } satisfies CreateSocialIntegrationDto);

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider_username: 'alice',
        tokens: JSON.stringify({ access_token: 'access' }),
        is_active: false,
        last_used: lastUsed,
        metadata: JSON.stringify({
          created_by: 'user',
          linked_at: lastUsed,
          sync_errors: ['previous transient failure'],
        }),
      }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        provider_username: 'alice',
        tokens: { access_token: 'access' },
        last_used: lastUsed,
        metadata: {
          created_by: 'user',
          linked_at: lastUsed,
          last_sync: new Date('2026-08-01T00:03:00.000Z'),
          sync_errors: ['previous transient failure'],
        },
      })
    );
  });

  it('handles found and missing id, filter, and provider lookups', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(null);
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(null);
    const repository = new PrismaSocialIntegrationRepository(
      prismaClient({ findUnique, findFirst }) as never
    );

    await expect(repository.findById('social-1')).resolves.toMatchObject({
      id: 'social-1',
    });
    await expect(repository.findById('missing')).resolves.toBeNull();
    await expect(
      repository.findOne({ method: 'google' })
    ).resolves.toMatchObject({
      id: 'social-1',
    });
    await expect(repository.findOne({ method: 'missing' })).resolves.toBeNull();
    await expect(
      repository.findByUserAndProvider('user-1', 'google')
    ).resolves.toMatchObject({ id: 'social-1' });
    await expect(
      repository.findByUserAndProvider('user-1', 'missing')
    ).resolves.toBeNull();
  });

  it('normalizes adapter-neutral filters for lookups, lists, and counts', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const repository = new PrismaSocialIntegrationRepository(
      prismaClient({ findFirst, findMany, count }) as never
    );
    const start = new Date('2026-08-01T00:00:00.000Z');
    const end = new Date('2026-08-02T00:00:00.000Z');

    await repository.findOne({ _id: 'social-1' });
    await repository.findMany({ created_at: { $gte: start, $lte: end } });
    await repository.count({ last_used: { $gte: start } });

    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'social-1' } });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { created_at: { gte: start, lte: end } },
      })
    );
    expect(count).toHaveBeenCalledWith({
      where: { last_used: { gte: start } },
    });
  });

  it('finds lists with default/custom ordering and paginates by user', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([row()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row()])
      .mockResolvedValueOnce([row()]);
    const count = vi.fn().mockResolvedValue(1);
    const repository = new PrismaSocialIntegrationRepository(
      prismaClient({ findMany, count }) as never
    );

    await expect(
      repository.findMany({ method: 'google' })
    ).resolves.toHaveLength(1);
    expect(findMany).toHaveBeenNthCalledWith(1, {
      where: { method: 'google' },
      orderBy: { created_at: 'desc' },
      take: undefined,
      skip: undefined,
    });
    await repository.findMany(
      {},
      { sort: { updatedAt: 'asc' }, limit: 5, skip: 2 }
    );
    expect(findMany).toHaveBeenNthCalledWith(2, {
      where: {},
      orderBy: { updated_at: 'asc' },
      take: 5,
      skip: 2,
    });
    await expect(
      repository.findByUserId('user-1', { page: 1, limit: 10 })
    ).resolves.toEqual(expect.objectContaining({ totalResults: 1 }));
    expect(findMany).toHaveBeenNthCalledWith(3, {
      where: { user_id: 'user-1' },
      take: 10,
      skip: 0,
      orderBy: { created_at: 'desc' },
    });
    await expect(repository.findByProvider('google')).resolves.toHaveLength(1);
    expect(findMany).toHaveBeenNthCalledWith(4, {
      where: { method: 'google' },
    });
  });

  it('maps every update field, including explicit nullable values', async () => {
    const update = vi
      .fn()
      .mockResolvedValueOnce(fullRow())
      .mockResolvedValueOnce(row());
    const repository = new PrismaSocialIntegrationRepository(
      prismaClient({ update }) as never
    );
    const lastUsed = new Date('2026-08-01T00:02:00.000Z');

    await repository.update('social-1', {
      user_id: 'user-2',
      method: 'github',
      provider_sub: 'sub-2',
      provider_username: 'bob',
      provider_data: { sub: 'sub-2', email: 'bob@example.com' },
      tokens: { access_token: 'new-access' },
      is_active: false,
      last_used: lastUsed,
      metadata: {
        created_by: 'admin',
        linked_at: lastUsed,
      },
    });
    expect(update).toHaveBeenNthCalledWith(1, {
      where: { id: 'social-1' },
      data: {
        user_id: 'user-2',
        method: 'github',
        provider_sub: 'sub-2',
        provider_username: 'bob',
        provider_data: JSON.stringify({
          sub: 'sub-2',
          email: 'bob@example.com',
        }),
        tokens: JSON.stringify({ access_token: 'new-access' }),
        is_active: false,
        last_used: lastUsed,
        metadata: JSON.stringify({
          created_by: 'admin',
          linked_at: lastUsed,
        }),
      },
    });

    await repository.update('social-1', {
      provider_username: null,
      tokens: null,
      last_used: null,
      metadata: null,
    } as never);
    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: 'social-1' },
      data: {
        provider_username: null,
        tokens: null,
        last_used: null,
        metadata: null,
      },
    });
  });

  it('supports empty updates, deletes, bulk deletes, and counts', async () => {
    const update = vi.fn().mockResolvedValue(row());
    const deleteOne = vi.fn().mockResolvedValue(row());
    const deleteMany = vi.fn().mockResolvedValue({ count: 3 });
    const count = vi.fn().mockResolvedValue(4);
    const repository = new PrismaSocialIntegrationRepository(
      prismaClient({ update, delete: deleteOne, deleteMany, count }) as never
    );

    await repository.update('social-1', {});
    expect(update).toHaveBeenCalledWith({
      where: { id: 'social-1' },
      data: {},
    });
    await repository.delete('social-1');
    expect(deleteOne).toHaveBeenCalledWith({ where: { id: 'social-1' } });
    await expect(repository.deleteByUserId('user-1')).resolves.toBe(3);
    expect(deleteMany).toHaveBeenCalledWith({ where: { user_id: 'user-1' } });
    await expect(repository.count()).resolves.toBe(4);
    expect(count).toHaveBeenCalledWith({ where: undefined });
    await expect(repository.count({ method: 'google' })).resolves.toBe(4);
    expect(count).toHaveBeenLastCalledWith({ where: { method: 'google' } });
  });
});

describe('Mongoose social integration repository', () => {
  it('delegates user and provider lookups through base repository contracts', async () => {
    const paginate = vi.fn().mockResolvedValue({
      results: [],
      totalResults: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
      hasNextPage: false,
      hasPrevPage: false,
    });
    const findOneQuery = query(null);
    const findQuery = query([]);
    const model = {
      paginate,
      findOne: vi.fn().mockReturnValue(findOneQuery),
      find: vi.fn().mockReturnValue(findQuery),
    };
    const repository = new MongooseSocialIntegrationRepository(model as never);

    await repository.findByUserId('user-1');
    expect(paginate).toHaveBeenCalledWith(
      { user_id: 'user-1' },
      { page: 1, limit: 20, sortBy: 'created_at:desc' }
    );
    await expect(
      repository.findByUserAndProvider('user-1', 'google')
    ).resolves.toBeNull();
    expect(model.findOne).toHaveBeenCalledWith({
      user_id: 'user-1',
      method: 'google',
    });
    await expect(repository.findByProvider('google')).resolves.toEqual([]);
    expect(model.find).toHaveBeenCalledWith({ method: 'google' });
  });

  it('returns deleted counts and safely defaults missing driver counts', async () => {
    const deleteMany = vi
      .fn()
      .mockReturnValueOnce({
        exec: vi.fn().mockResolvedValue({ deletedCount: 2 }),
      })
      .mockReturnValueOnce({ exec: vi.fn().mockResolvedValue({}) });
    const repository = new MongooseSocialIntegrationRepository({
      deleteMany,
    } as never);

    await expect(repository.deleteByUserId('user-1')).resolves.toBe(2);
    await expect(repository.deleteByUserId('user-2')).resolves.toBe(0);
    expect(deleteMany).toHaveBeenNthCalledWith(1, { user_id: 'user-1' });
    expect(deleteMany).toHaveBeenNthCalledWith(2, { user_id: 'user-2' });
  });
});
