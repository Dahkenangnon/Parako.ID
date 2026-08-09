import { describe, expect, it, vi } from 'vitest';
import { MongooseTenantSettingsOverrideRepository } from '../../../../src/db/repositories/mongoose/tenant-settings-override.repository.js';
import { PrismaTenantSettingsOverrideRepository } from '../../../../src/db/repositories/prisma/tenant-settings-override.repository.js';

function overrideRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'override-1',
    tenant_id: 'tenant-a',
    key: 'parako_config',
    version: '1.2.3',
    int_version: 7,
    is_active: true,
    value: JSON.stringify({ branding: { companyName: 'Stored' } }),
    metadata: JSON.stringify({ last_modified_by: 'admin-1' }),
    created_at: new Date('2026-08-01T00:00:00.000Z'),
    updated_at: new Date('2026-08-01T01:00:00.000Z'),
    ...overrides,
  };
}

function prismaClient(overrides: Record<string, unknown> = {}) {
  return {
    tenantSettingsOverride: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      ...overrides,
    },
  };
}

function mongooseQuery<T>(result: T) {
  const chain = {
    sort: vi.fn(),
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(result),
  };
  chain.sort.mockReturnValue(chain);
  chain.lean.mockReturnValue(chain);
  return chain;
}

describe('Prisma tenant settings override repository', () => {
  it('returns null when no active override exists', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const repository = new PrismaTenantSettingsOverrideRepository(
      prismaClient({ findFirst }) as never
    );

    await expect(repository.findActive()).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledWith({
      where: { key: 'parako_config', is_active: true },
    });
  });

  it('treats database identity and version columns as authoritative', async () => {
    const row = overrideRow({
      value: JSON.stringify({
        id: 'spoofed',
        _id: 'spoofed',
        tenant_id: 'spoofed',
        key: 'spoofed',
        version: '99.0.0',
        _version: 99,
        is_active: false,
        metadata: { change_reason: 'spoofed' },
        branding: { companyName: 'Trusted content' },
      }),
    });
    const repository = new PrismaTenantSettingsOverrideRepository(
      prismaClient({ findFirst: vi.fn().mockResolvedValue(row) }) as never
    );

    await expect(repository.findActive()).resolves.toEqual({
      id: 'override-1',
      _id: 'override-1',
      tenant_id: 'tenant-a',
      key: 'parako_config',
      version: '1.2.3',
      _version: 7,
      is_active: true,
      metadata: { last_modified_by: 'admin-1' },
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-01T01:00:00.000Z',
      branding: { companyName: 'Trusted content' },
    });
  });

  it('saves only override content and gives explicit metadata precedence', async () => {
    const create = vi.fn().mockResolvedValue(
      overrideRow({
        version: '1.2.4',
        int_version: 8,
        value: JSON.stringify({ branding: { companyName: 'Updated' } }),
        metadata: JSON.stringify({ change_reason: 'explicit' }),
      })
    );
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repository = new PrismaTenantSettingsOverrideRepository(
      prismaClient({
        findFirst: vi.fn().mockResolvedValue(overrideRow()),
        updateMany,
        create,
      }) as never
    );
    const value = JSON.parse(
      '{"id":"old","_id":"old","tenant_id":"other","key":"other","version":"0.0.1","_version":1,"is_active":false,"created_at":"old","updated_at":"old","__v":1,"constructor":{"polluted":true},"prototype":{"polluted":true},"metadata":{"change_reason":"payload"},"branding":{"companyName":"Updated"}}'
    );

    await repository.save(value, {
      modifiedBy: 'admin-2',
      reason: 'explicit',
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: { key: 'parako_config', is_active: true },
      data: { is_active: false },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        key: 'parako_config',
        version: '1.2.4',
        int_version: 8,
        is_active: true,
        value: JSON.stringify({ branding: { companyName: 'Updated' } }),
        metadata: JSON.stringify({
          last_modified_by: 'admin-2',
          change_reason: 'explicit',
        }),
      },
    });
  });

  it('creates the first version consistently with the model defaults', async () => {
    const create = vi
      .fn()
      .mockResolvedValue(
        overrideRow({ version: '1.0.0', int_version: 0, metadata: '{}' })
      );
    const repository = new PrismaTenantSettingsOverrideRepository(
      prismaClient({
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create,
      }) as never
    );

    await repository.save({ branding: { companyName: 'Initial' } } as never);

    expect(create).toHaveBeenCalledWith({
      data: {
        key: 'parako_config',
        version: '1.0.0',
        int_version: 0,
        is_active: true,
        value: JSON.stringify({ branding: { companyName: 'Initial' } }),
        metadata: '{}',
      },
    });
  });

  it('increments legacy rows with missing version values safely', async () => {
    const create = vi
      .fn()
      .mockResolvedValue(overrideRow({ version: '1.0.1', int_version: 1 }));
    const repository = new PrismaTenantSettingsOverrideRepository(
      prismaClient({
        findFirst: vi
          .fn()
          .mockResolvedValue(overrideRow({ version: null, int_version: null })),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create,
      }) as never
    );

    await repository.save({ metadata: { change_reason: 'legacy' } } as never);

    expect(create).toHaveBeenCalledWith({
      data: {
        key: 'parako_config',
        version: '1.0.1',
        int_version: 1,
        is_active: true,
        value: '{}',
        metadata: JSON.stringify({ change_reason: 'legacy' }),
      },
    });
  });

  it('retries Prisma tenant uniqueness races with the latest revision', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockResolvedValueOnce(overrideRow({ version: '1.2.5', int_version: 9 }));
    const repository = new PrismaTenantSettingsOverrideRepository(
      prismaClient({
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(overrideRow())
          .mockResolvedValueOnce(
            overrideRow({ version: '1.2.4', int_version: 8 })
          ),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create,
      }) as never
    );

    await expect(repository.save({})).resolves.toMatchObject({
      version: '1.2.5',
      _version: 9,
    });
    expect(create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ version: '1.2.5', int_version: 9 }),
    });
  });

  it('propagates non-uniqueness Prisma tenant save failures', async () => {
    const failure = new Error('database unavailable');
    const create = vi.fn().mockRejectedValue(failure);
    const repository = new PrismaTenantSettingsOverrideRepository(
      prismaClient({
        findFirst: vi.fn().mockResolvedValue(overrideRow()),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create,
      }) as never
    );

    await expect(repository.save({})).rejects.toBe(failure);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('recovers a Prisma tenant key left inactive after contention', async () => {
    const create = vi
      .fn()
      .mockResolvedValue(overrideRow({ version: '1.2.4', int_version: 8 }));
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const repository = new PrismaTenantSettingsOverrideRepository(
      prismaClient({
        findFirst: vi.fn().mockResolvedValue(overrideRow()),
        updateMany,
        create,
      }) as never
    );

    await expect(repository.save({})).resolves.toMatchObject({
      version: '1.2.4',
    });
    expect(updateMany).toHaveBeenCalledTimes(16);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('fails a Prisma tenant save after its uniqueness retry budget', async () => {
    const create = vi.fn().mockRejectedValue({ code: 'P2002' });
    const repository = new PrismaTenantSettingsOverrideRepository(
      prismaClient({
        findFirst: vi.fn().mockResolvedValue(overrideRow()),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create,
      }) as never
    );

    await expect(repository.save({})).rejects.toThrow(
      'Unable to save tenant settings after 16 attempts'
    );
    expect(create).toHaveBeenCalledTimes(16);
  });
});

describe('Mongoose tenant settings override repository', () => {
  it('returns serialized active overrides and null for missing overrides', async () => {
    const found = mongooseQuery({
      _id: { toString: () => 'override-1' },
      tenant_id: 'tenant-a',
      branding: { companyName: 'Stored' },
    });
    const missing = mongooseQuery(null);
    const model = {
      findOne: vi.fn().mockReturnValueOnce(found).mockReturnValueOnce(missing),
    };
    const repository = new MongooseTenantSettingsOverrideRepository(
      model as never
    );

    await expect(repository.findActive()).resolves.toEqual(
      expect.objectContaining({
        id: 'override-1',
        tenant_id: 'tenant-a',
        branding: { companyName: 'Stored' },
      })
    );
    await expect(repository.findActive()).resolves.toBeNull();
    expect(model.findOne).toHaveBeenNthCalledWith(1, {
      key: 'parako_config',
      is_active: true,
    });
  });

  it('strips managed and unsafe fields while preserving payload metadata', async () => {
    const create = vi.fn().mockResolvedValue({
      _id: { toString: () => 'override-1' },
    });
    const model = {
      findOneAndUpdate: vi.fn().mockReturnValue(mongooseQuery(null)),
      findOne: vi.fn().mockReturnValue(mongooseQuery(null)),
      create,
    };
    const repository = new MongooseTenantSettingsOverrideRepository(
      model as never
    );
    const value = JSON.parse(
      '{"id":"old","_id":"old","tenant_id":"other","key":"other","version":"old","_version":99,"is_active":false,"created_at":"old","updated_at":"old","__v":1,"constructor":{"polluted":true},"prototype":{"polluted":true},"metadata":{"change_reason":"payload"},"branding":{"companyName":"Initial"}}'
    );

    await repository.save(value);

    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { key: 'parako_config', is_active: true },
      { $set: { is_active: false } },
      { returnDocument: 'before' }
    );
    expect(create).toHaveBeenCalledWith({
      branding: { companyName: 'Initial' },
      key: 'parako_config',
      version: '1.0.0',
      _version: 0,
      is_active: true,
      metadata: { change_reason: 'payload' },
    });
  });

  it('increments sparse previous versions and maps explicit metadata', async () => {
    const create = vi.fn().mockResolvedValue({
      _id: { toString: () => 'override-2' },
    });
    const repository = new MongooseTenantSettingsOverrideRepository({
      findOneAndUpdate: vi
        .fn()
        .mockReturnValue(mongooseQuery({ _version: null, version: '2.4' })),
      create,
    } as never);

    await repository.save({ branding: { companyName: 'Updated' } } as never, {
      modifiedBy: 'admin-2',
      reason: 'change',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        version: '2.4.1',
        _version: 1,
        metadata: {
          last_modified_by: 'admin-2',
          change_reason: 'change',
        },
      })
    );
  });

  it('falls back when a previous row has no semantic version', async () => {
    const create = vi.fn().mockResolvedValue({
      _id: { toString: () => 'override-2' },
    });
    const repository = new MongooseTenantSettingsOverrideRepository({
      findOneAndUpdate: vi
        .fn()
        .mockReturnValue(mongooseQuery({ _version: 4, version: null })),
      create,
    } as never);

    await repository.save({} as never);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ version: '1.0.1', _version: 5, metadata: {} })
    );
  });

  it('retries MongoDB tenant duplicate-key races with the next claim', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce({ code: 11000 })
      .mockResolvedValueOnce({
        _id: { toString: () => 'override-2' },
        version: '1.2.5',
        _version: 9,
      });
    const repository = new MongooseTenantSettingsOverrideRepository({
      findOneAndUpdate: vi
        .fn()
        .mockReturnValueOnce(mongooseQuery({ _version: 7, version: '1.2.3' }))
        .mockReturnValueOnce(mongooseQuery({ _version: 8, version: '1.2.4' })),
      create,
    } as never);

    await expect(repository.save({})).resolves.toMatchObject({
      version: '1.2.5',
      _version: 9,
    });
    expect(create).toHaveBeenLastCalledWith(
      expect.objectContaining({ version: '1.2.5', _version: 9 })
    );
  });

  it('propagates non-duplicate MongoDB tenant save failures', async () => {
    const failure = new Error('database unavailable');
    const create = vi.fn().mockRejectedValue(failure);
    const repository = new MongooseTenantSettingsOverrideRepository({
      findOneAndUpdate: vi
        .fn()
        .mockReturnValue(mongooseQuery({ _version: 7, version: '1.2.3' })),
      create,
    } as never);

    await expect(repository.save({})).rejects.toBe(failure);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('recovers a MongoDB tenant key left inactive after contention', async () => {
    const findOneAndUpdate = vi.fn().mockReturnValue(mongooseQuery(null));
    const create = vi.fn().mockResolvedValue({
      _id: { toString: () => 'override-2' },
      version: '1.2.4',
      _version: 8,
    });
    const repository = new MongooseTenantSettingsOverrideRepository({
      findOneAndUpdate,
      findOne: vi
        .fn()
        .mockReturnValue(mongooseQuery({ _version: 7, version: '1.2.3' })),
      create,
    } as never);

    await expect(repository.save({})).resolves.toMatchObject({
      version: '1.2.4',
    });
    expect(findOneAndUpdate).toHaveBeenCalledTimes(16);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('fails a MongoDB tenant save after its duplicate-key retry budget', async () => {
    const create = vi.fn().mockRejectedValue({ code: 11000 });
    const repository = new MongooseTenantSettingsOverrideRepository({
      findOneAndUpdate: vi
        .fn()
        .mockReturnValue(mongooseQuery({ _version: 7, version: '1.2.3' })),
      create,
    } as never);

    await expect(repository.save({})).rejects.toThrow(
      'Unable to save tenant settings after 16 attempts'
    );
    expect(create).toHaveBeenCalledTimes(16);
  });
});
