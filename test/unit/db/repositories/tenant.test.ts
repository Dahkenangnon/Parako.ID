import { afterEach, describe, expect, it, vi } from 'vitest';
import { MongooseTenantRepository } from '../../../../src/db/repositories/mongoose/tenant.repository.js';
import { PrismaTenantRepository } from '../../../../src/db/repositories/prisma/tenant.repository.js';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tenant-1',
    slug: 'default',
    display_name: 'Default tenant',
    domain: null,
    status: 'active',
    issuer_url: null,
    created_at: new Date('2026-08-01T00:00:00.000Z'),
    updated_at: new Date('2026-08-01T00:01:00.000Z'),
    ...overrides,
  };
}

function prismaClient(overrides: Record<string, unknown> = {}) {
  return {
    tenant: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
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

afterEach(() => {
  vi.useRealTimers();
});

describe('Prisma tenant repository', () => {
  it('handles found and missing slug, domain, and id lookups', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(null);
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(null);
    const repository = new PrismaTenantRepository(
      prismaClient({ findUnique, findFirst }) as never
    );

    await expect(repository.findBySlug('default')).resolves.toMatchObject({
      id: 'tenant-1',
    });
    await expect(repository.findBySlug('missing')).resolves.toBeNull();
    await expect(repository.findByDomain('id.example')).resolves.toMatchObject({
      id: 'tenant-1',
    });
    await expect(repository.findByDomain('missing')).resolves.toBeNull();
    await expect(repository.findById('tenant-1')).resolves.toMatchObject({
      id: 'tenant-1',
    });
    await expect(repository.findById('missing')).resolves.toBeNull();
  });

  it('maps nullable fields, date objects, and legacy string dates', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([
        row({
          domain: 'id.example',
          issuer_url: 'https://id.example/oidc',
        }),
      ])
      .mockResolvedValueOnce([
        row({
          created_at: 'legacy-created',
          updated_at: 'legacy-updated',
        }),
      ]);
    const repository = new PrismaTenantRepository(
      prismaClient({ findMany }) as never
    );

    await expect(repository.findAll({ status: 'active' })).resolves.toEqual([
      expect.objectContaining({
        domain: 'id.example',
        issuer_url: 'https://id.example/oidc',
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:01:00.000Z',
      }),
    ]);
    expect(findMany).toHaveBeenNthCalledWith(1, {
      where: { status: 'active' },
    });
    await expect(repository.findAll()).resolves.toEqual([
      expect.objectContaining({
        domain: undefined,
        issuer_url: undefined,
        created_at: 'legacy-created',
        updated_at: 'legacy-updated',
      }),
    ]);
    expect(findMany).toHaveBeenNthCalledWith(2, { where: {} });
  });

  it('creates tenants and preserves immutable identity during updates', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'));
    const create = vi.fn().mockResolvedValue(row());
    const update = vi
      .fn()
      .mockResolvedValue(
        row({ display_name: 'Renamed', updated_at: new Date() })
      );
    const repository = new PrismaTenantRepository(
      prismaClient({ create, update }) as never
    );
    const data = { slug: 'default', display_name: 'Default tenant' };

    await expect(repository.create(data)).resolves.toMatchObject({
      id: 'tenant-1',
    });
    expect(create).toHaveBeenCalledWith({ data });

    await repository.update('tenant-1', {
      id: 'attacker-controlled-id',
      created_at: 'attacker-controlled-date',
      updated_at: 'attacker-controlled-date',
      display_name: 'Renamed',
    } as never);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
      data: {
        display_name: 'Renamed',
        updated_at: new Date('2026-08-01T12:00:00.000Z'),
      },
    });
  });

  it('persists null to remove nullable tenant fields', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'));
    const update = vi.fn().mockResolvedValue(row());
    const repository = new PrismaTenantRepository(
      prismaClient({ update }) as never
    );

    await repository.update('tenant-1', {
      domain: null,
      issuer_url: null,
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
      data: {
        domain: null,
        issuer_url: null,
        updated_at: new Date('2026-08-01T12:00:00.000Z'),
      },
    });
  });

  it('checks tenant existence for zero and multiple matches', async () => {
    const count = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(2);
    const repository = new PrismaTenantRepository(
      prismaClient({ count }) as never
    );

    await expect(repository.exists('missing')).resolves.toBe(false);
    await expect(repository.exists('default')).resolves.toBe(true);
  });
});

describe('Mongoose tenant repository', () => {
  it('handles slug, domain, id, and filtered/unfiltered list queries', async () => {
    const queries = [
      query({ _id: { toString: () => 'one' } }),
      query(null),
      query({ _id: { toString: () => 'one' } }),
      query([{ _id: { toString: () => 'one' } }]),
      query([]),
    ];
    const model = {
      findOne: vi
        .fn()
        .mockReturnValueOnce(queries[0])
        .mockReturnValueOnce(queries[1]),
      findById: vi.fn().mockReturnValue(queries[2]),
      find: vi
        .fn()
        .mockReturnValueOnce(queries[3])
        .mockReturnValueOnce(queries[4]),
    };
    const repository = new MongooseTenantRepository(model as never);

    await expect(repository.findBySlug('default')).resolves.toMatchObject({
      id: 'one',
    });
    await expect(repository.findByDomain('missing')).resolves.toBeNull();
    await expect(repository.findById('one')).resolves.toMatchObject({
      id: 'one',
    });
    await expect(
      repository.findAll({ status: 'active' })
    ).resolves.toHaveLength(1);
    await expect(repository.findAll()).resolves.toEqual([]);
    expect(model.find).toHaveBeenNthCalledWith(1, { status: 'active' });
    expect(model.find).toHaveBeenNthCalledWith(2, {});
  });

  it('creates tenants and preserves immutable identity during updates', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'));
    const updateQuery = query({
      _id: { toString: () => 'one' },
      display_name: 'Renamed',
    });
    const model = {
      create: vi.fn().mockResolvedValue({ _id: { toString: () => 'one' } }),
      findByIdAndUpdate: vi.fn().mockReturnValue(updateQuery),
    };
    const repository = new MongooseTenantRepository(model as never);

    await expect(
      repository.create({ slug: 'default', display_name: 'Default tenant' })
    ).resolves.toMatchObject({ id: 'one' });
    await repository.update('one', {
      id: 'attacker-controlled-id',
      created_at: 'attacker-controlled-date',
      updated_at: 'attacker-controlled-date',
      display_name: 'Renamed',
    } as never);
    expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
      'one',
      {
        $set: {
          display_name: 'Renamed',
          updated_at: new Date('2026-08-01T12:00:00.000Z'),
        },
      },
      { returnDocument: 'after', runValidators: true }
    );
  });

  it('removes nullable fields instead of persisting null values', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'));
    const updateQuery = query({ _id: { toString: () => 'one' } });
    const model = {
      findByIdAndUpdate: vi.fn().mockReturnValue(updateQuery),
    };
    const repository = new MongooseTenantRepository(model as never);

    await repository.update('one', { domain: null, issuer_url: null });

    expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
      'one',
      {
        $set: { updated_at: new Date('2026-08-01T12:00:00.000Z') },
        $unset: { domain: 1, issuer_url: 1 },
      },
      { returnDocument: 'after', runValidators: true }
    );
  });

  it('rejects missing updates and checks existence', async () => {
    const missingQuery = query(null);
    const countQuery = {
      exec: vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1),
    };
    const model = {
      findByIdAndUpdate: vi.fn().mockReturnValue(missingQuery),
      countDocuments: vi.fn().mockReturnValue(countQuery),
    };
    const repository = new MongooseTenantRepository(model as never);

    await expect(repository.update('missing', {})).rejects.toThrow(
      'Tenant not found: missing'
    );
    await expect(repository.exists('missing')).resolves.toBe(false);
    await expect(repository.exists('default')).resolves.toBe(true);
  });
});
