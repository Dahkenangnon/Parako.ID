import { describe, expect, it, vi } from 'vitest';
import { MongooseSettingsRepository } from '../../../../src/db/repositories/mongoose/settings.repository.js';
import { PrismaSettingsRepository } from '../../../../src/db/repositories/prisma/settings.repository.js';
import { ConfigurationVersionConflictError } from '../../../../src/errors/configuration-version-conflict.error.js';

function settingsRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'settings-1',
    key: 'parako_config',
    version: '1.2.3',
    schema_version: '1.0.0',
    int_version: 7,
    is_active: true,
    value: JSON.stringify({ feature: 'stored' }),
    metadata: JSON.stringify({ environment: 'production' }),
    created_at: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

function prismaClient(settingsOverrides: Record<string, unknown> = {}) {
  return {
    settings: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
      ...settingsOverrides,
    },
  };
}

function mongooseQuery<T>(result: T) {
  const chain = {
    sort: vi.fn(),
    limit: vi.fn(),
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(result),
  };
  chain.sort.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.lean.mockReturnValue(chain);
  return chain;
}

describe('Prisma settings repository', () => {
  it('treats normalized database columns as authoritative over serialized content', async () => {
    const row = settingsRow({
      value: JSON.stringify({
        id: 'spoofed-id',
        _id: 'spoofed-id',
        key: 'spoofed-key',
        version: '99.99.99',
        schema_version: '99.0.0',
        _version: 999,
        is_active: false,
        metadata: { environment: 'spoofed' },
        feature: 'enabled',
      }),
    });
    const prisma = prismaClient({
      findUnique: vi.fn().mockResolvedValue(row),
    });
    const repository = new PrismaSettingsRepository(prisma as never);

    await expect(repository.findById('settings-1')).resolves.toEqual(
      expect.objectContaining({
        id: 'settings-1',
        _id: 'settings-1',
        key: 'parako_config',
        version: '1.2.3',
        schema_version: '1.0.0',
        _version: 7,
        is_active: true,
        metadata: { environment: 'production' },
        feature: 'enabled',
      })
    );
  });

  it('synchronizes managed columns while merging only configuration content', async () => {
    const current = settingsRow();
    const updated = settingsRow({
      key: 'renamed',
      version: '2.0.0',
      schema_version: '2.0.0',
      int_version: 8,
      is_active: false,
      value: JSON.stringify({ feature: 'updated', added: true }),
      metadata: JSON.stringify({ change_reason: 'test' }),
    });
    const update = vi.fn().mockResolvedValue(updated);
    const prisma = prismaClient({
      findUnique: vi.fn().mockResolvedValue(current),
      update,
    });
    const repository = new PrismaSettingsRepository(prisma as never);

    const result = await repository.update('settings-1', {
      key: 'renamed',
      version: '2.0.0',
      schema_version: '2.0.0',
      _version: 8,
      is_active: false,
      metadata: { change_reason: 'test' },
      feature: 'updated',
      added: true,
      id: 'must-not-be-persisted',
      _id: 'must-not-be-persisted',
    } as never);

    expect(update).toHaveBeenCalledWith({
      where: { id: 'settings-1' },
      data: {
        key: 'renamed',
        version: '2.0.0',
        schema_version: '2.0.0',
        int_version: 8,
        is_active: false,
        value: JSON.stringify({ feature: 'updated', added: true }),
        metadata: JSON.stringify({ change_reason: 'test' }),
      },
    });
    expect(result).toEqual(
      expect.objectContaining({
        key: 'renamed',
        is_active: false,
        feature: 'updated',
        added: true,
      })
    );

    await repository.update('settings-1', { feature: 'content-only' } as never);
    expect(update).toHaveBeenLastCalledWith({
      where: { id: 'settings-1' },
      data: {
        value: JSON.stringify({ feature: 'content-only' }),
      },
    });
  });

  it('persists deactivation in the queryable column used by active-row lookup', async () => {
    const current = settingsRow();
    const updated = settingsRow({ is_active: false });
    const update = vi.fn().mockResolvedValue(updated);
    const prisma = prismaClient({
      findUnique: vi.fn().mockResolvedValue(current),
      update,
    });
    const repository = new PrismaSettingsRepository(prisma as never);

    await expect(
      repository.update('settings-1', { is_active: false })
    ).resolves.toEqual(expect.objectContaining({ is_active: false }));
    expect(update).toHaveBeenCalledWith({
      where: { id: 'settings-1' },
      data: {
        is_active: false,
        value: JSON.stringify({ feature: 'stored' }),
      },
    });
  });

  it('rejects updates for a missing settings row', async () => {
    const repository = new PrismaSettingsRepository(
      prismaClient({ findUnique: vi.fn().mockResolvedValue(null) }) as never
    );

    await expect(
      repository.update('missing', { is_active: false })
    ).rejects.toThrow('Settings not found: missing');
  });

  it('strips identity and managed fields when saving a previous row as content', async () => {
    const create = vi.fn().mockResolvedValue(
      settingsRow({
        version: '1.2.4',
        int_version: 8,
        value: JSON.stringify({ feature: 'rollback' }),
      })
    );
    const prisma = prismaClient({
      findFirst: vi.fn().mockResolvedValue(settingsRow()),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create,
    });
    const repository = new PrismaSettingsRepository(prisma as never);

    await repository.save(
      'parako_config',
      {
        id: 'old-id',
        _id: 'old-id',
        key: 'old-key',
        version: '0.0.1',
        schema_version: '0.1.0',
        _version: 1,
        is_active: false,
        created_at: 'old-date',
        updated_at: 'old-date',
        metadata: { environment: 'old' },
        feature: 'rollback',
      } as never,
      { change_reason: 'rollback' }
    );

    expect(create).toHaveBeenCalledWith({
      data: {
        key: 'parako_config',
        version: '1.2.4',
        schema_version: '1.0.0',
        int_version: 8,
        is_active: true,
        value: JSON.stringify({ feature: 'rollback' }),
        metadata: JSON.stringify({ change_reason: 'rollback' }),
      },
    });
  });

  it('maps filters safely and handles found and missing single-row lookups', async () => {
    const row = settingsRow();
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(row);
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce(null);
    const prisma = prismaClient({ findUnique, findFirst });
    const repository = new PrismaSettingsRepository(prisma as never);

    await expect(repository.findById('missing')).resolves.toBeNull();
    await expect(repository.findById('settings-1')).resolves.toMatchObject({
      id: 'settings-1',
    });
    const filter = JSON.parse(
      '{"_version":7,"schema_version":"1.0.0","is_active":true,"key":"parako_config","constructor":{},"__proto__":{},"prototype":{}}'
    );
    await expect(repository.findOne(filter)).resolves.toMatchObject({
      key: 'parako_config',
    });
    await expect(repository.findOne({ key: 'missing' })).resolves.toBeNull();
    expect(findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        int_version: 7,
        schema_version: '1.0.0',
        is_active: true,
        key: 'parako_config',
      },
    });
  });

  it('finds many with optional limits, creates with defaults, deletes, and counts', async () => {
    const row = settingsRow({ metadata: '{}' });
    const findMany = vi.fn().mockResolvedValue([row]);
    const create = vi.fn().mockResolvedValue(row);
    const deleteOne = vi.fn().mockResolvedValue(row);
    const count = vi.fn().mockResolvedValue(1);
    const prisma = prismaClient({ findMany, create, delete: deleteOne, count });
    const repository = new PrismaSettingsRepository(prisma as never);

    await expect(
      repository.findMany({ _version: 7 }, { limit: 5, skip: 2 })
    ).resolves.toEqual([
      expect.objectContaining({ metadata: undefined, feature: 'stored' }),
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { int_version: 7 },
      take: 5,
      skip: 2,
    });
    await repository.findMany({});
    expect(findMany).toHaveBeenLastCalledWith({
      where: {},
      take: undefined,
      skip: undefined,
    });

    await repository.create({
      key: 'parako_config',
      version: '1.0.0',
      schema_version: undefined,
      _version: undefined,
      is_active: undefined,
      metadata: undefined,
      feature: 'stored',
    } as never);
    expect(create).toHaveBeenCalledWith({
      data: {
        key: 'parako_config',
        version: '1.0.0',
        schema_version: '1.0.0',
        int_version: 0,
        is_active: true,
        value: JSON.stringify({ feature: 'stored' }),
        metadata: '{}',
      },
    });

    await repository.delete('settings-1');
    expect(deleteOne).toHaveBeenCalledWith({ where: { id: 'settings-1' } });
    await expect(repository.count()).resolves.toBe(1);
    expect(count).toHaveBeenCalledWith({ where: undefined });
    await expect(repository.count({ _version: 7 })).resolves.toBe(1);
    expect(count).toHaveBeenLastCalledWith({ where: { int_version: 7 } });
  });

  it('queries active, specific, historical, and latest versions in both result states', async () => {
    const row = settingsRow();
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce(null);
    const findMany = vi.fn().mockResolvedValue([row]);
    const repository = new PrismaSettingsRepository(
      prismaClient({ findFirst, findMany }) as never
    );

    await expect(repository.findActive('parako_config')).resolves.toMatchObject(
      {
        id: 'settings-1',
      }
    );
    await expect(repository.findActive('missing')).resolves.toBeNull();
    await expect(
      repository.findVersion('parako_config', '1.2.3')
    ).resolves.toMatchObject({ id: 'settings-1' });
    await expect(
      repository.findVersion('missing', '1.0.0')
    ).resolves.toBeNull();
    await expect(
      repository.findHistory('parako_config', 3)
    ).resolves.toHaveLength(1);
    expect(findMany).toHaveBeenCalledWith({
      where: { key: 'parako_config' },
      orderBy: { int_version: 'desc' },
      take: 3,
    });
    await repository.findHistory('parako_config');
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: undefined })
    );
    await expect(repository.getLatestVersion('parako_config')).resolves.toBe(
      '1.2.3'
    );
    await expect(repository.getLatestVersion('missing')).resolves.toBeNull();
  });

  it('creates the initial saved version with empty metadata', async () => {
    const created = settingsRow({
      version: '0.0.1',
      int_version: 1,
      metadata: '{}',
    });
    const create = vi.fn().mockResolvedValue(created);
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const repository = new PrismaSettingsRepository(
      prismaClient({
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany,
        create,
      }) as never
    );

    await repository.save('parako_config', { feature: 'initial' } as never);

    expect(updateMany).toHaveBeenCalledWith({
      where: { key: 'parako_config', is_active: true },
      data: { is_active: false },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        key: 'parako_config',
        version: '0.0.1',
        schema_version: '1.0.0',
        int_version: 1,
        is_active: true,
        value: JSON.stringify({ feature: 'initial' }),
        metadata: '{}',
      },
    });
  });

  it('deactivates only the submitted Prisma revision', async () => {
    const create = vi
      .fn()
      .mockResolvedValue(
        settingsRow({ version: '1.2.4', int_version: 8, value: '{}' })
      );
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repository = new PrismaSettingsRepository(
      prismaClient({
        findFirst: vi.fn().mockResolvedValue(settingsRow()),
        updateMany,
        create,
      }) as never
    );

    await repository.save('parako_config', {}, undefined, 7);

    expect(updateMany).toHaveBeenCalledWith({
      where: { key: 'parako_config', is_active: true, int_version: 7 },
      data: { is_active: false },
    });
  });

  it('rejects a stale Prisma revision without creating a replacement row', async () => {
    const create = vi.fn();
    const repository = new PrismaSettingsRepository(
      prismaClient({
        findFirst: vi
          .fn()
          .mockResolvedValue(settingsRow({ version: '1.2.4', int_version: 8 })),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create,
      }) as never
    );

    const rejection = repository.save('parako_config', {}, undefined, 7);
    await expect(rejection).rejects.toBeInstanceOf(
      ConfigurationVersionConflictError
    );
    await expect(rejection).rejects.toMatchObject({
      expectedVersion: 7,
      actualVersion: 8,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('retries Prisma uniqueness races using the latest committed revision', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockResolvedValueOnce(
        settingsRow({ version: '1.2.5', int_version: 9, value: '{}' })
      );
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(settingsRow())
      .mockResolvedValueOnce(settingsRow({ version: '1.2.4', int_version: 8 }));
    const repository = new PrismaSettingsRepository(
      prismaClient({
        findFirst,
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create,
      }) as never
    );

    await expect(repository.save('parako_config', {})).resolves.toMatchObject({
      version: '1.2.5',
      _version: 9,
    });
    expect(create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ version: '1.2.5', int_version: 9 }),
    });
  });

  it('propagates non-uniqueness Prisma save failures without retrying', async () => {
    const failure = new Error('database unavailable');
    const create = vi.fn().mockRejectedValue(failure);
    const repository = new PrismaSettingsRepository(
      prismaClient({
        findFirst: vi.fn().mockResolvedValue(settingsRow()),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create,
      }) as never
    );

    await expect(repository.save('parako_config', {})).rejects.toBe(failure);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('recovers a Prisma key left inactive after bounded contention', async () => {
    const create = vi
      .fn()
      .mockResolvedValue(
        settingsRow({ version: '1.2.4', int_version: 8, value: '{}' })
      );
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const repository = new PrismaSettingsRepository(
      prismaClient({
        findFirst: vi.fn().mockResolvedValue(settingsRow()),
        updateMany,
        create,
      }) as never
    );

    await expect(repository.save('parako_config', {})).resolves.toMatchObject({
      version: '1.2.4',
    });
    expect(updateMany).toHaveBeenCalledTimes(16);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('fails a Prisma save after the bounded uniqueness retry budget', async () => {
    const create = vi.fn().mockRejectedValue({ code: 'P2002' });
    const repository = new PrismaSettingsRepository(
      prismaClient({
        findFirst: vi.fn().mockResolvedValue(settingsRow()),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create,
      }) as never
    );

    await expect(repository.save('parako_config', {})).rejects.toThrow(
      'Unable to save settings for key "parako_config" after 16 attempts'
    );
    expect(create).toHaveBeenCalledTimes(16);
  });
});

describe('Mongoose settings repository', () => {
  it('finds active and specific versions through lean model queries', async () => {
    const activeQuery = mongooseQuery({ _id: { toString: () => 'one' } });
    const versionQuery = mongooseQuery(null);
    const model = {
      findOne: vi
        .fn()
        .mockReturnValueOnce(activeQuery)
        .mockReturnValueOnce(versionQuery),
    };
    const repository = new MongooseSettingsRepository(model as never);

    await expect(repository.findActive('parako_config')).resolves.toMatchObject(
      {
        id: 'one',
      }
    );
    await expect(
      repository.findVersion('parako_config', '1.0.0')
    ).resolves.toBeNull();
    expect(model.findOne).toHaveBeenNthCalledWith(1, {
      key: 'parako_config',
      is_active: true,
    });
    expect(model.findOne).toHaveBeenNthCalledWith(2, {
      key: 'parako_config',
      version: '1.0.0',
    });
  });

  it('returns serialized history with default and explicit limits', async () => {
    const firstQuery = mongooseQuery([{ _id: { toString: () => 'one' } }]);
    const secondQuery = mongooseQuery([]);
    const model = {
      find: vi
        .fn()
        .mockReturnValueOnce(firstQuery)
        .mockReturnValueOnce(secondQuery),
    };
    const repository = new MongooseSettingsRepository(model as never);

    await expect(repository.findHistory('parako_config')).resolves.toEqual([
      expect.objectContaining({ id: 'one' }),
    ]);
    expect(firstQuery.limit).toHaveBeenCalledWith(20);
    await expect(repository.findHistory('parako_config', 5)).resolves.toEqual(
      []
    );
    expect(secondQuery.limit).toHaveBeenCalledWith(5);
  });

  it('saves an initial row while stripping managed fields and using value metadata', async () => {
    const previousQuery = mongooseQuery(null);
    const create = vi.fn().mockResolvedValue({
      _id: { toString: () => 'new' },
      key: 'parako_config',
    });
    const model = {
      findOneAndUpdate: vi.fn().mockReturnValue(previousQuery),
      findOne: vi.fn().mockReturnValue(mongooseQuery(null)),
      create,
    };
    const repository = new MongooseSettingsRepository(model as never);

    await repository.save('parako_config', {
      id: 'old',
      _id: 'old',
      key: 'old',
      version: 'old',
      schema_version: 'old',
      _version: 99,
      is_active: false,
      created_at: 'old',
      updated_at: 'old',
      __v: 1,
      metadata: { environment: 'test' },
      feature: true,
    } as never);

    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { key: 'parako_config', is_active: true },
      { $set: { is_active: false } },
      { returnDocument: 'before' }
    );
    expect(create).toHaveBeenCalledWith({
      feature: true,
      metadata: { environment: 'test' },
      key: 'parako_config',
      version: '1.0.0',
      schema_version: '1.0.0',
      _version: 0,
      is_active: true,
    });
  });

  it('strips prototype-pollution keys from saved MongoDB content', async () => {
    const create = vi.fn().mockResolvedValue({
      _id: { toString: () => 'new' },
      key: 'parako_config',
    });
    const repository = new MongooseSettingsRepository({
      findOneAndUpdate: vi.fn().mockReturnValue(mongooseQuery(null)),
      findOne: vi.fn().mockReturnValue(mongooseQuery(null)),
      create,
    } as never);
    const content = JSON.parse(`{
      "feature": true,
      "constructor": { "polluted": true },
      "prototype": { "polluted": true },
      "__proto__": { "polluted": true }
    }`);

    await repository.save('parako_config', content);

    expect(create).toHaveBeenCalledWith({
      feature: true,
      key: 'parako_config',
      version: '1.0.0',
      schema_version: '1.0.0',
      _version: 0,
      is_active: true,
      metadata: {},
    });
  });

  it('increments sparse previous versions and gives explicit metadata precedence', async () => {
    const previousQuery = mongooseQuery({ _version: null, version: '1.2' });
    const create = vi.fn().mockResolvedValue({
      _id: { toString: () => 'new' },
    });
    const repository = new MongooseSettingsRepository({
      findOneAndUpdate: vi.fn().mockReturnValue(previousQuery),
      create,
    } as never);

    await repository.save('parako_config', { feature: true } as never, {
      change_reason: 'explicit',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        version: '1.2.1',
        _version: 1,
        metadata: { change_reason: 'explicit' },
      })
    );
  });

  it('deactivates only the submitted MongoDB revision', async () => {
    const previousQuery = mongooseQuery({ _version: 7, version: '1.2.3' });
    const findOneAndUpdate = vi.fn().mockReturnValue(previousQuery);
    const repository = new MongooseSettingsRepository({
      findOneAndUpdate,
      create: vi.fn().mockResolvedValue({
        _id: { toString: () => 'new' },
        version: '1.2.4',
        _version: 8,
      }),
    } as never);

    await repository.save('parako_config', {}, undefined, 7);

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { key: 'parako_config', is_active: true, _version: 7 },
      { $set: { is_active: false } },
      { returnDocument: 'before' }
    );
  });

  it('rejects a stale MongoDB revision without creating a replacement row', async () => {
    const create = vi.fn();
    const repository = new MongooseSettingsRepository({
      findOneAndUpdate: vi.fn().mockReturnValue(mongooseQuery(null)),
      findOne: vi
        .fn()
        .mockReturnValue(mongooseQuery({ _version: 8, version: '1.2.4' })),
      create,
    } as never);

    const rejection = repository.save('parako_config', {}, undefined, 7);
    await expect(rejection).rejects.toBeInstanceOf(
      ConfigurationVersionConflictError
    );
    await expect(rejection).rejects.toMatchObject({
      expectedVersion: 7,
      actualVersion: 8,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('reports an unknown current revision when a stale MongoDB key is missing', async () => {
    const create = vi.fn();
    const repository = new MongooseSettingsRepository({
      findOneAndUpdate: vi.fn().mockReturnValue(mongooseQuery(null)),
      findOne: vi.fn().mockReturnValue(mongooseQuery(null)),
      create,
    } as never);

    const rejection = repository.save('parako_config', {}, undefined, 7);

    await expect(rejection).rejects.toMatchObject({
      expectedVersion: 7,
      actualVersion: undefined,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('falls back from a missing previous semver and empty metadata', async () => {
    const previousQuery = mongooseQuery({ _version: 4, version: null });
    const create = vi.fn().mockResolvedValue({
      _id: { toString: () => 'new' },
    });
    const repository = new MongooseSettingsRepository({
      findOneAndUpdate: vi.fn().mockReturnValue(previousQuery),
      create,
    } as never);

    await repository.save('parako_config', { feature: true } as never);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ version: '1.0.1', _version: 5, metadata: {} })
    );
  });

  it('retries MongoDB duplicate-key races using the next claimed revision', async () => {
    const first = mongooseQuery({ _version: 7, version: '1.2.3' });
    const second = mongooseQuery({ _version: 8, version: '1.2.4' });
    const create = vi
      .fn()
      .mockRejectedValueOnce({ code: 11000 })
      .mockResolvedValueOnce({
        _id: { toString: () => 'new' },
        version: '1.2.5',
        _version: 9,
      });
    const repository = new MongooseSettingsRepository({
      findOneAndUpdate: vi
        .fn()
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second),
      create,
    } as never);

    await expect(repository.save('parako_config', {})).resolves.toMatchObject({
      version: '1.2.5',
      _version: 9,
    });
    expect(create).toHaveBeenLastCalledWith(
      expect.objectContaining({ version: '1.2.5', _version: 9 })
    );
  });

  it('propagates non-duplicate MongoDB save failures without retrying', async () => {
    const failure = new Error('database unavailable');
    const create = vi.fn().mockRejectedValue(failure);
    const repository = new MongooseSettingsRepository({
      findOneAndUpdate: vi
        .fn()
        .mockReturnValue(mongooseQuery({ _version: 7, version: '1.2.3' })),
      create,
    } as never);

    await expect(repository.save('parako_config', {})).rejects.toBe(failure);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('recovers a MongoDB key left inactive after bounded contention', async () => {
    const findOneAndUpdate = vi.fn().mockReturnValue(mongooseQuery(null));
    const create = vi.fn().mockResolvedValue({
      _id: { toString: () => 'new' },
      version: '1.2.4',
      _version: 8,
    });
    const repository = new MongooseSettingsRepository({
      findOneAndUpdate,
      findOne: vi
        .fn()
        .mockReturnValue(mongooseQuery({ _version: 7, version: '1.2.3' })),
      create,
    } as never);

    await expect(repository.save('parako_config', {})).resolves.toMatchObject({
      version: '1.2.4',
    });
    expect(findOneAndUpdate).toHaveBeenCalledTimes(16);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('fails a MongoDB save after the bounded duplicate-key retry budget', async () => {
    const create = vi.fn().mockRejectedValue({ code: 11000 });
    const repository = new MongooseSettingsRepository({
      findOneAndUpdate: vi
        .fn()
        .mockReturnValue(mongooseQuery({ _version: 7, version: '1.2.3' })),
      create,
    } as never);

    await expect(repository.save('parako_config', {})).rejects.toThrow(
      'Unable to save settings for key "parako_config" after 16 attempts'
    );
    expect(create).toHaveBeenCalledTimes(16);
  });

  it('returns latest versions, null versions, and missing rows', async () => {
    const queries = [
      mongooseQuery({ version: '1.2.3' }),
      mongooseQuery({ version: null }),
      mongooseQuery(null),
    ];
    const model = {
      findOne: vi
        .fn()
        .mockReturnValueOnce(queries[0])
        .mockReturnValueOnce(queries[1])
        .mockReturnValueOnce(queries[2]),
    };
    const repository = new MongooseSettingsRepository(model as never);

    await expect(repository.getLatestVersion('one')).resolves.toBe('1.2.3');
    await expect(repository.getLatestVersion('two')).resolves.toBeNull();
    await expect(repository.getLatestVersion('three')).resolves.toBeNull();
    for (const query of queries) {
      expect(query.sort).toHaveBeenCalledWith({ _version: -1 });
    }
  });
});
