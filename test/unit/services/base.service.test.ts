import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  serializeDocument: vi.fn((value: unknown) => value),
  serializeDocuments: vi.fn((value: unknown[]) => value),
  merge: vi.fn((target: Record<string, unknown>, source: unknown) =>
    Object.assign(target, source)
  ),
}));

vi.mock('../../../src/db/utils.js', () => dbMocks);

import { BaseService } from '../../../src/services/base.service.js';

function query(result: unknown) {
  const value = {
    populate: vi.fn(),
    select: vi.fn(),
    session: vi.fn(),
    lean: vi.fn(),
    sort: vi.fn(),
    limit: vi.fn(),
    skip: vi.fn(),
    exec: vi.fn().mockResolvedValue(result),
  };
  for (const method of [
    value.populate,
    value.select,
    value.session,
    value.lean,
    value.sort,
    value.limit,
    value.skip,
  ]) {
    method.mockReturnValue(value);
  }
  return value;
}

function makeModel() {
  const documentSave = vi.fn().mockResolvedValue({ id: 'created' });
  const Model = vi.fn(function (this: any, data: unknown) {
    this.data = data;
    this.save = documentSave;
  }) as any;
  Model.insertMany = vi.fn().mockResolvedValue([{ id: 'one' }]);
  Model.findById = vi.fn();
  Model.findOne = vi.fn();
  Model.find = vi.fn();
  Model.updateMany = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  Model.findByIdAndDelete = vi.fn();
  Model.findOneAndDelete = vi.fn();
  Model.deleteMany = vi.fn().mockResolvedValue({ deletedCount: 1 });
  Model.countDocuments = vi.fn().mockResolvedValue(0);
  Model.aggregate = vi.fn();
  return { Model, documentSave };
}

class ConcreteBaseService extends BaseService<any, any, any> {
  public normalize(value: Record<string, unknown>) {
    return this.normalizeFilter(value);
  }
}

function makeService() {
  const model = makeModel();
  return {
    ...model,
    service: new ConcreteBaseService(model.Model),
  };
}

describe('BaseService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes id filters without mutating input or overriding _id', () => {
    const { service } = makeService();
    const input = { id: 'public-id', status: 'active' };

    expect(service.normalize({})).toEqual({});
    expect(service.normalize(input)).toEqual({
      _id: 'public-id',
      status: 'active',
    });
    expect(input).toEqual({ id: 'public-id', status: 'active' });
    expect(service.normalize({ id: 'public-id', _id: 'database-id' })).toEqual({
      id: 'public-id',
      _id: 'database-id',
    });
    expect(service.normalize({ id: '', status: 'active' })).toEqual({
      id: '',
      status: 'active',
    });
  });

  it('creates and serializes one document with save options', async () => {
    const { service, Model, documentSave } = makeService();
    const session = { id: 'session' } as any;

    await expect(
      service.createOne({ name: 'Alice' }, { session })
    ).resolves.toEqual({ id: 'created' });
    expect(Model).toHaveBeenCalledWith({ name: 'Alice' });
    expect(documentSave).toHaveBeenCalledWith({ session });
    expect(dbMocks.serializeDocument).toHaveBeenCalledWith({ id: 'created' });
  });

  it('creates many documents with default and explicit insertion options', async () => {
    const { service, Model } = makeService();

    await expect(service.createMany([{ name: 'One' }])).resolves.toEqual([
      { id: 'one' },
    ]);
    expect(Model.insertMany).toHaveBeenLastCalledWith([{ name: 'One' }], {
      session: undefined,
      ordered: true,
    });

    const session = { id: 'session' } as any;
    await service.createMany([{ name: 'Two' }], { session, ordered: false });
    expect(Model.insertMany).toHaveBeenLastCalledWith([{ name: 'Two' }], {
      session,
      ordered: false,
    });
  });

  it('finds one by id with default lean serialization', async () => {
    const { service, Model } = makeService();
    const q = query({ id: 'found' });
    Model.findById.mockReturnValue(q);

    await expect(service.findOne('found')).resolves.toEqual({ id: 'found' });
    expect(Model.findById).toHaveBeenCalledWith('found');
    expect(q.lean).toHaveBeenCalledOnce();
    expect(q.exec).toHaveBeenCalledOnce();
  });

  it('finds one by normalized filter with all query options', async () => {
    const { service, Model } = makeService();
    const q = query({ id: 'found' });
    Model.findOne.mockReturnValue(q);
    const session = { id: 'session' } as any;

    await service.findOne(
      { id: 'found' },
      {
        populate: 'owner,tenant',
        select: { name: 1 },
        lean: true,
        session,
      }
    );

    expect(Model.findOne).toHaveBeenCalledWith({ _id: 'found' });
    expect(q.populate).toHaveBeenCalledWith('owner tenant');
    expect(q.select).toHaveBeenCalledWith({ name: 1 });
    expect(q.session).toHaveBeenCalledWith(session);
    expect(q.lean).toHaveBeenCalledOnce();
  });

  it('supports array population and disabled lean for findOne', async () => {
    const { service, Model } = makeService();
    const q = query(null);
    Model.findOne.mockReturnValue(q);

    await expect(
      service.findOne(
        { status: 'missing' },
        { populate: ['owner', 'tenant'], lean: false }
      )
    ).resolves.toBeNull();
    expect(q.populate.mock.calls).toEqual([['owner'], ['tenant']]);
    expect(q.select).not.toHaveBeenCalled();
    expect(q.session).not.toHaveBeenCalled();
    expect(q.lean).not.toHaveBeenCalled();
  });

  it('ignores malformed runtime population values for findOne', async () => {
    const { service, Model } = makeService();
    const q = query({ id: 'found' });
    Model.findOne.mockReturnValue(q);

    await service.findOne({}, { populate: { path: 'owner' } as any });

    expect(q.populate).not.toHaveBeenCalled();
  });

  it('finds many with default options', async () => {
    const { service, Model } = makeService();
    const q = query([{ id: 'one' }]);
    Model.find.mockReturnValue(q);

    await expect(service.findMany()).resolves.toEqual([{ id: 'one' }]);
    expect(Model.find).toHaveBeenCalledWith({});
    expect(q.lean).toHaveBeenCalledOnce();
    expect(q.sort).not.toHaveBeenCalled();
  });

  it('applies every findMany option including zero limit and skip', async () => {
    const { service, Model } = makeService();
    const q = query([]);
    Model.find.mockReturnValue(q);
    const session = { id: 'session' } as any;

    await service.findMany(
      { id: 'one' },
      {
        sort: { created_at: -1 },
        populate: 'owner,tenant',
        select: 'name',
        limit: 0,
        skip: 0,
        lean: true,
        session,
      }
    );

    expect(Model.find).toHaveBeenCalledWith({ _id: 'one' });
    expect(q.sort).toHaveBeenCalledWith({ created_at: -1 });
    expect(q.select).toHaveBeenCalledWith('name');
    expect(q.populate).toHaveBeenCalledWith('owner tenant');
    expect(q.limit).toHaveBeenCalledWith(0);
    expect(q.skip).toHaveBeenCalledWith(0);
    expect(q.session).toHaveBeenCalledWith(session);
    expect(q.lean).toHaveBeenCalledOnce();
  });

  it('supports array population and omitted optional findMany operations', async () => {
    const { service, Model } = makeService();
    const q = query([]);
    Model.find.mockReturnValue(q);

    await service.findMany({}, { populate: ['owner', 'tenant'], lean: false });

    expect(q.populate.mock.calls).toEqual([['owner'], ['tenant']]);
    expect(q.sort).not.toHaveBeenCalled();
    expect(q.select).not.toHaveBeenCalled();
    expect(q.limit).not.toHaveBeenCalled();
    expect(q.skip).not.toHaveBeenCalled();
    expect(q.session).not.toHaveBeenCalled();
    expect(q.lean).not.toHaveBeenCalled();
  });

  it('ignores malformed runtime population values for findMany', async () => {
    const { service, Model } = makeService();
    const q = query([]);
    Model.find.mockReturnValue(q);

    await service.findMany({}, { populate: { path: 'owner' } as any });

    expect(q.populate).not.toHaveBeenCalled();
  });

  it('returns null or upserts when updateById cannot find a document', async () => {
    const { service, Model } = makeService();
    const lookup = { session: vi.fn().mockResolvedValue(null) };
    Model.findById.mockReturnValue(lookup);

    await expect(
      service.updateById('missing', { name: 'None' })
    ).resolves.toBeNull();
    expect(lookup.session).toHaveBeenCalledWith(null);

    const createSpy = vi
      .spyOn(service, 'createOne')
      .mockResolvedValue({ _id: 'missing', name: 'Created' });
    const session = { id: 'session' } as any;
    await expect(
      service.updateById(
        'missing',
        { name: 'Created' },
        { upsert: true, session }
      )
    ).resolves.toEqual({ _id: 'missing', name: 'Created' });
    expect(createSpy).toHaveBeenCalledWith(
      { _id: 'missing', name: 'Created' },
      { session }
    );
  });

  it('merges, populates, validates, saves, and serializes an existing update', async () => {
    const { service, Model } = makeService();
    const existing = {
      name: 'Before',
      populate: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockResolvedValue({ id: 'updated' }),
    };
    Model.findById.mockReturnValue({
      session: vi.fn().mockResolvedValue(existing),
    });
    const session = { id: 'session' } as any;

    await expect(
      service.updateById(
        'existing',
        { name: 'After' },
        {
          populate: ['owner', 'tenant'],
          session,
          runValidators: true,
        }
      )
    ).resolves.toEqual({ id: 'updated' });

    expect(dbMocks.merge).toHaveBeenCalledWith(existing, { name: 'After' });
    expect(existing.populate.mock.calls).toEqual([['owner'], ['tenant']]);
    expect(existing.save).toHaveBeenCalledWith({
      session,
      runValidators: true,
    });
  });

  it('supports string population and empty save options for updates', async () => {
    const { service, Model } = makeService();
    const existing = {
      populate: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockResolvedValue({ id: 'updated' }),
    };
    Model.findById.mockReturnValue({
      session: vi.fn().mockResolvedValue(existing),
    });

    await service.updateById('existing', {}, { populate: 'owner,tenant' });

    expect(existing.populate).toHaveBeenCalledWith('owner tenant');
    expect(existing.save).toHaveBeenCalledWith({});
  });

  it('ignores absent and malformed runtime population values for updates', async () => {
    const { service, Model } = makeService();
    const existing = {
      populate: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockResolvedValue({ id: 'updated' }),
    };
    Model.findById.mockReturnValue({
      session: vi.fn().mockResolvedValue(existing),
    });

    await service.updateById('existing', {});
    await service.updateById(
      'existing',
      {},
      { populate: { path: 'owner' } as any }
    );

    expect(existing.populate).not.toHaveBeenCalled();
  });

  it('updates many with normalized filters and explicit options', async () => {
    const { service, Model } = makeService();
    const session = { id: 'session' } as any;

    await expect(
      service.updateMany(
        { id: 'one' },
        { status: 'active' },
        { session, upsert: false, runValidators: true }
      )
    ).resolves.toEqual({ modifiedCount: 1 });
    expect(Model.updateMany).toHaveBeenCalledWith(
      { _id: 'one' },
      { status: 'active' },
      { session, upsert: false, runValidators: true }
    );
  });

  it('updates many with no optional update options', async () => {
    const { service, Model } = makeService();

    await service.updateMany({}, {});

    expect(Model.updateMany).toHaveBeenCalledWith({}, {}, {});
  });

  it('deletes one by id or normalized filter', async () => {
    const { service, Model } = makeService();
    const session = { id: 'session' } as any;
    Model.findByIdAndDelete.mockResolvedValue({ id: 'one' });
    Model.findOneAndDelete.mockResolvedValue({ id: 'two' });

    await expect(service.deleteOne('one', { session })).resolves.toEqual({
      id: 'one',
    });
    expect(Model.findByIdAndDelete).toHaveBeenCalledWith('one', { session });
    await expect(service.deleteOne({ id: 'two' })).resolves.toEqual({
      id: 'two',
    });
    expect(Model.findOneAndDelete).toHaveBeenCalledWith(
      { _id: 'two' },
      { session: undefined }
    );
  });

  it('deletes many with a normalized filter and session', async () => {
    const { service, Model } = makeService();
    const session = { id: 'session' } as any;

    await expect(
      service.deleteMany({ id: 'one' }, { session })
    ).resolves.toEqual({
      deletedCount: 1,
    });
    expect(Model.deleteMany).toHaveBeenCalledWith({ _id: 'one' }, { session });
  });

  it('returns a fully configured paginated result', async () => {
    const { service, Model } = makeService();
    Model.countDocuments.mockResolvedValue(21);
    const q = query([{ id: 'row' }]);
    Model.find.mockReturnValue(q);
    const session = { id: 'session' } as any;

    await expect(
      service.findWithPagination(
        { id: 'one' },
        {
          page: 2,
          limit: 10,
          sort: { created_at: -1 },
          populate: 'owner,tenant',
          select: 'name',
          lean: true,
          session,
        }
      )
    ).resolves.toEqual({
      results: [{ id: 'row' }],
      page: 2,
      limit: 10,
      totalResults: 21,
      totalPages: 3,
    });
    expect(Model.countDocuments).toHaveBeenCalledWith({ _id: 'one' });
    expect(q.sort).toHaveBeenCalledWith({ created_at: -1 });
    expect(q.select).toHaveBeenCalledWith('name');
    expect(q.populate).toHaveBeenCalledWith('owner tenant');
    expect(q.skip).toHaveBeenCalledWith(10);
    expect(q.limit).toHaveBeenCalledWith(10);
    expect(q.session).toHaveBeenCalledWith(session);
    expect(q.lean).toHaveBeenCalledOnce();
  });

  it('supports array population and disabled lean in pagination', async () => {
    const { service, Model } = makeService();
    const q = query([]);
    Model.find.mockReturnValue(q);

    await service.findWithPagination(
      {},
      { page: 1, limit: 20, populate: ['owner', 'tenant'], lean: false }
    );

    expect(q.populate.mock.calls).toEqual([['owner'], ['tenant']]);
    expect(q.sort).not.toHaveBeenCalled();
    expect(q.select).not.toHaveBeenCalled();
    expect(q.session).not.toHaveBeenCalled();
    expect(q.lean).not.toHaveBeenCalled();
  });

  it('ignores absent and malformed runtime population values in pagination', async () => {
    const { service, Model } = makeService();
    const q = query([]);
    Model.find.mockReturnValue(q);

    await service.findWithPagination({}, { page: 1, limit: 20 });
    await service.findWithPagination(
      {},
      { page: 1, limit: 20, populate: { path: 'owner' } as any }
    );

    expect(q.populate).not.toHaveBeenCalled();
  });

  it('counts normalized documents', async () => {
    const { service, Model } = makeService();
    Model.countDocuments.mockResolvedValue(4);

    await expect(service.countDocuments({ id: 'one' })).resolves.toBe(4);
    expect(Model.countDocuments).toHaveBeenCalledWith({ _id: 'one' });
  });

  it('aggregates with and without a session', async () => {
    const { service, Model } = makeService();
    const first = {
      session: vi.fn(),
      exec: vi.fn().mockResolvedValue([{ count: 1 }]),
    };
    first.session.mockReturnValue(first);
    Model.aggregate.mockReturnValue(first);

    await expect(service.aggregate([{ $match: {} }])).resolves.toEqual([
      { count: 1 },
    ]);
    expect(first.session).not.toHaveBeenCalled();

    const session = { id: 'session' } as any;
    await service.aggregate([{ $match: {} }], { session });
    expect(first.session).toHaveBeenCalledWith(session);
  });
});
