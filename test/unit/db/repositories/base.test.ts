import { describe, expect, it, vi } from 'vitest';
import type {
  PaginationOptions,
  QueryOptions,
} from '../../../../src/db/repositories/interfaces/base.repository.js';
import { AbstractMongooseRepository } from '../../../../src/db/repositories/mongoose/base.repository.js';
import {
  AbstractPrismaRepository,
  toOrderBy,
} from '../../../../src/db/repositories/prisma/base.repository.js';

class PrismaRepositoryHarness extends AbstractPrismaRepository {
  constructor() {
    super({} as never);
  }

  paginate<T>(
    delegate: {
      findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
      count: (args?: Record<string, unknown>) => Promise<number>;
    },
    filter: Record<string, unknown>,
    options?: PaginationOptions,
    mapper?: (row: unknown) => T
  ) {
    return this.paginateDelegate(delegate, filter, options, mapper);
  }

  increment(version: string) {
    return this.incrementPatch(version);
  }
}

interface RecordModel {
  id?: string;
  name?: string;
}

class MongooseRepositoryHarness extends AbstractMongooseRepository<
  RecordModel,
  { name: string }
> {
  findMany(
    filter: Record<string, unknown>,
    options?: QueryOptions
  ): Promise<RecordModel[]> {
    return this.queryMany(filter, options);
  }

  exposePaginate(
    filter: Record<string, unknown>,
    options?: {
      page?: number;
      limit?: number;
      sort?: Record<string, 1 | -1 | 'asc' | 'desc'>;
    }
  ) {
    return this.paginate(filter, options);
  }
}

function query<T>(result: T) {
  const chain = {
    lean: vi.fn(),
    sort: vi.fn(),
    skip: vi.fn(),
    limit: vi.fn(),
    exec: vi.fn().mockResolvedValue(result),
  };
  chain.lean.mockReturnValue(chain);
  chain.sort.mockReturnValue(chain);
  chain.skip.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  return chain;
}

describe('Prisma base repository', () => {
  it('converts camelCase sort keys and all supported directions', () => {
    expect(
      toOrderBy({
        createdAt: -1,
        updatedAt: 'desc',
        displayName: 1,
        userID: 'asc',
      })
    ).toEqual({
      created_at: 'desc',
      updated_at: 'desc',
      display_name: 'asc',
      user_i_d: 'asc',
    });
  });

  it('paginates with defaults and translates cross-database filters', async () => {
    const repository = new PrismaRepositoryHarness();
    const createdAt = new Date('2026-08-01T00:00:00.000Z');
    const delegate = {
      findMany: vi.fn().mockResolvedValue([{ id: 'one' }, { id: 'two' }]),
      count: vi.fn().mockResolvedValue(25),
    };

    const result = await repository.paginate(delegate, {
      _id: 'one',
      createdAt: { $gte: createdAt, $lt: new Date('2026-08-02') },
      score: { $gt: 1, $lte: 10, $ne: 5, $in: [2], $nin: [8] },
      status: { equals: 'active' },
      tags: ['one'],
      nullable: null,
      exactDate: createdAt,
    });

    expect(delegate.findMany).toHaveBeenCalledWith({
      where: {
        id: 'one',
        createdAt: {
          gte: createdAt,
          lt: new Date('2026-08-02'),
        },
        score: {
          gt: 1,
          lte: 10,
          not: 5,
          in: [2],
          notIn: [8],
        },
        status: { equals: 'active' },
        tags: ['one'],
        nullable: null,
        exactDate: createdAt,
      },
      take: 20,
      skip: 0,
      orderBy: { created_at: 'desc' },
    });
    expect(delegate.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.any(Object) })
    );
    expect(result).toEqual({
      results: [{ id: 'one' }, { id: 'two' }],
      totalResults: 25,
      page: 1,
      limit: 20,
      totalPages: 2,
      hasNextPage: true,
      hasPrevPage: false,
    });
  });

  it('supports custom pagination, sort, mapping, and terminal-page flags', async () => {
    const repository = new PrismaRepositoryHarness();
    const delegate = {
      findMany: vi.fn().mockResolvedValue([{ value: 1 }, { value: 2 }]),
      count: vi.fn().mockResolvedValue(6),
    };

    const result = await repository.paginate(
      delegate,
      {},
      { page: 3, limit: 2, sort: { createdAt: 'asc' } },
      row => (row as { value: number }).value * 10
    );

    expect(delegate.findMany).toHaveBeenCalledWith({
      where: {},
      take: 2,
      skip: 4,
      orderBy: { created_at: 'asc' },
    });
    expect(result).toEqual({
      results: [10, 20],
      totalResults: 6,
      page: 3,
      limit: 2,
      totalPages: 3,
      hasNextPage: false,
      hasPrevPage: true,
    });
  });

  it('preserves unknown operators alongside supported Mongo operators', async () => {
    const repository = new PrismaRepositoryHarness();
    const delegate = {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    };

    await repository.paginate(delegate, {
      value: { $gte: 1, equals: 2 },
    });

    expect(delegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { value: { gte: 1, equals: 2 } } })
    );
  });

  it('drops reserved filter and operator keys instead of traversing prototypes', async () => {
    const repository = new PrismaRepositoryHarness();
    const delegate = {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    };
    const filter = JSON.parse(`{
      "safe": {
        "$gte": 1,
        "constructor": { "polluted": true },
        "__proto__": { "polluted": true }
      },
      "constructor": { "prototype": { "polluted": true } },
      "prototype": { "polluted": true },
      "__proto__": { "polluted": true }
    }`);

    await repository.paginate(delegate, filter);

    expect(delegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { safe: { gte: 1 } } })
    );
  });

  it('increments a semantic patch version', () => {
    const repository = new PrismaRepositoryHarness();

    expect(repository.increment('1.2.3')).toBe('1.2.4');
    expect(repository.increment('1.2')).toBe('1.2.1');
  });
});

describe('Mongoose base repository', () => {
  it('finds and serializes records by id and filter', async () => {
    const byIdQuery = query({ _id: { toString: () => 'one' }, name: 'One' });
    const oneQuery = query(null);
    const model = {
      findById: vi.fn().mockReturnValue(byIdQuery),
      findOne: vi.fn().mockReturnValue(oneQuery),
    };
    const repository = new MongooseRepositoryHarness(model as never);

    await expect(repository.findById('one')).resolves.toEqual({
      _id: 'one',
      id: 'one',
      name: 'One',
    });
    await expect(repository.findOne({ name: 'missing' })).resolves.toBeNull();
    expect(model.findById).toHaveBeenCalledWith('one');
    expect(model.findOne).toHaveBeenCalledWith({ name: 'missing' });
  });

  it('treats a malformed document id as a missing record', async () => {
    const castError = Object.assign(new Error('invalid object id'), {
      name: 'CastError',
      path: '_id',
    });
    const invalidQuery = query(null);
    invalidQuery.exec.mockRejectedValue(castError);
    const model = {
      findById: vi.fn().mockReturnValue(invalidQuery),
    };
    const repository = new MongooseRepositoryHarness(model as never);

    await expect(repository.findById('not-an-object-id')).resolves.toBeNull();
  });

  it('propagates query failures unrelated to document-id casting', async () => {
    const databaseError = new Error('database unavailable');
    const failingQuery = query(null);
    failingQuery.exec.mockRejectedValue(databaseError);
    const model = {
      findById: vi.fn().mockReturnValue(failingQuery),
    };
    const repository = new MongooseRepositoryHarness(model as never);

    await expect(repository.findById('valid-id')).rejects.toBe(databaseError);
  });

  it('finds many records with optional sort, skip, and limit', async () => {
    const fullQuery = query([{ _id: { toString: () => 'one' } }]);
    const plainQuery = query([]);
    const model = {
      find: vi
        .fn()
        .mockReturnValueOnce(fullQuery)
        .mockReturnValueOnce(plainQuery),
    };
    const repository = new MongooseRepositoryHarness(model as never);

    await expect(
      repository.findMany(
        { active: true },
        { sort: { createdAt: -1 }, skip: 10, limit: 5 }
      )
    ).resolves.toEqual([{ _id: 'one', id: 'one' }]);
    await expect(repository.findMany({})).resolves.toEqual([]);
    expect(fullQuery.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(fullQuery.skip).toHaveBeenCalledWith(10);
    expect(fullQuery.limit).toHaveBeenCalledWith(5);
    expect(plainQuery.sort).not.toHaveBeenCalled();
    expect(plainQuery.skip).not.toHaveBeenCalled();
    expect(plainQuery.limit).not.toHaveBeenCalled();
  });

  it('creates and serializes a record', async () => {
    const model = {
      create: vi.fn().mockResolvedValue({
        _id: { toString: () => 'created' },
        name: 'Created',
      }),
    };
    const repository = new MongooseRepositoryHarness(model as never);

    await expect(repository.create({ name: 'Created' })).resolves.toEqual({
      _id: 'created',
      id: 'created',
      name: 'Created',
    });
    expect(model.create).toHaveBeenCalledWith({ name: 'Created' });
  });

  it('updates with validators and rejects missing records', async () => {
    const updatedQuery = query({
      _id: { toString: () => 'one' },
      name: 'Updated',
    });
    const missingQuery = query(null);
    const model = {
      findByIdAndUpdate: vi
        .fn()
        .mockReturnValueOnce(updatedQuery)
        .mockReturnValueOnce(missingQuery),
    };
    const repository = new MongooseRepositoryHarness(model as never);

    await expect(
      repository.update('one', { name: 'Updated' })
    ).resolves.toEqual({
      _id: 'one',
      id: 'one',
      name: 'Updated',
    });
    expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
      'one',
      { $set: { name: 'Updated' } },
      { returnDocument: 'after', runValidators: true }
    );
    await expect(
      repository.update('missing', { name: 'Nope' })
    ).rejects.toThrow('Document not found: missing');
  });

  it('deletes records and counts with explicit and default filters', async () => {
    const deleteQuery = query(undefined);
    const countWithFilter = query(3);
    const countAll = query(7);
    const model = {
      findByIdAndDelete: vi.fn().mockReturnValue(deleteQuery),
      countDocuments: vi
        .fn()
        .mockReturnValueOnce(countWithFilter)
        .mockReturnValueOnce(countAll),
    };
    const repository = new MongooseRepositoryHarness(model as never);

    await expect(repository.delete('one')).resolves.toBeUndefined();
    await expect(repository.count({ active: true })).resolves.toBe(3);
    await expect(repository.count()).resolves.toBe(7);
    expect(model.countDocuments).toHaveBeenNthCalledWith(1, { active: true });
    expect(model.countDocuments).toHaveBeenNthCalledWith(2, {});
  });

  it('paginates with defaults and serializes results', async () => {
    const model = {
      paginate: vi.fn().mockResolvedValue({
        results: [{ _id: { toString: () => 'one' } }],
        totalResults: 21,
        page: 1,
        limit: 20,
        totalPages: 2,
        hasNextPage: true,
        hasPrevPage: false,
      }),
    };
    const repository = new MongooseRepositoryHarness(model as never);

    await expect(repository.exposePaginate({ active: true })).resolves.toEqual({
      results: [{ _id: 'one', id: 'one' }],
      totalResults: 21,
      page: 1,
      limit: 20,
      totalPages: 2,
      hasNextPage: true,
      hasPrevPage: false,
    });
    expect(model.paginate).toHaveBeenCalledWith(
      { active: true },
      { page: 1, limit: 20, sortBy: 'created_at:desc' }
    );
  });

  it('serializes every custom pagination sort direction', async () => {
    const model = {
      paginate: vi.fn().mockResolvedValue({
        results: [],
        totalResults: 0,
        page: 2,
        limit: 5,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: true,
      }),
    };
    const repository = new MongooseRepositoryHarness(model as never);

    await repository.exposePaginate(
      {},
      {
        page: 2,
        limit: 5,
        sort: {
          first: -1,
          second: 'desc',
          third: 1,
          fourth: 'asc',
        },
      }
    );

    expect(model.paginate).toHaveBeenCalledWith(
      {},
      {
        page: 2,
        limit: 5,
        sortBy: 'first:desc,second:desc,third:asc,fourth:asc',
      }
    );
  });
});
