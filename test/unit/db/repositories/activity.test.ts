import { describe, expect, it, vi } from 'vitest';
import type { CreateActivityDto } from '../../../../src/db/repositories/interfaces/activity.repository.js';
import { MongooseActivityRepository } from '../../../../src/db/repositories/mongoose/activity.repository.js';
import { PrismaActivityRepository } from '../../../../src/db/repositories/prisma/activity.repository.js';
import { tenantContext } from '../../../../src/multi-tenancy/tenant-context.js';

const includeRelations = {
  actor: true,
  target: true,
  device: true,
};

function minimalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'activity-1',
    type: 'login',
    description: 'Signed in',
    timestamp: new Date('2026-08-01T00:00:00.000Z'),
    status: 'success',
    ip_address: null,
    user_agent: null,
    client_id: null,
    is_private: false,
    related_activity_id: null,
    actor: null,
    target: null,
    device: null,
    created_at: new Date('2026-08-01T00:00:01.000Z'),
    ...overrides,
  };
}

function fullRow() {
  return minimalRow({
    ip_address: '127.0.0.1',
    user_agent: 'test-agent',
    client_id: 'client-1',
    is_private: true,
    related_activity_id: 'related-1',
    actor: {
      actor_type: 'admin',
      user_id: 'user-1',
      username: 'alice',
      email: 'alice@example.com',
      full_name: 'Alice Example',
      given_name: 'Alice',
      family_name: 'Example',
    },
    target: {
      target_type: 'client',
      user_id: 'user-2',
      username: 'bob',
      email: 'bob@example.com',
      full_name: 'Bob Example',
      entity_id: 'entity-1',
      entity_name: 'Demo client',
      entity_data: JSON.stringify({ enabled: true }),
    },
    device: {
      fingerprint: 'fingerprint-1',
      fingerprint_js_id: 'visitor-1',
      browser_name: 'Firefox',
      browser_version: null,
      os_name: null,
      os_version: 'Linux',
      device_type: null,
      device_vendor: 'Framework',
      device_model: 'Laptop 13',
      language: 'en',
      platform: 'Linux x86_64',
      screen_width: null,
      screen_height: 1080,
      screen_pixel_ratio: 2,
      hardware_concurrency: 16,
      memory: 32,
      is_new_device: false,
      is_suspicious: true,
      confidence_score: 90,
      risk_level: 'medium',
      matched_device_id: 'device-1',
      reason: 'new network',
      geo_country: null,
      geo_region: 'Atlantique',
      geo_city: 'Cotonou',
      geo_lat: 6.37,
      geo_lon: 2.39,
      geo_timezone: 'Africa/Porto-Novo',
      device_trust_trusted: false,
      device_trust_trusted_at: new Date('2026-07-01T00:00:00.000Z'),
      device_trust_until: new Date('2026-09-01T00:00:00.000Z'),
    },
  });
}

function prismaClient(activityOverrides: Record<string, unknown> = {}) {
  return {
    activity: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
      groupBy: vi.fn(),
      delete: vi.fn(),
      findFirst: vi.fn(),
      ...activityOverrides,
    },
  };
}

function execQuery<T>(result: T) {
  return { exec: vi.fn().mockResolvedValue(result) };
}

describe('Prisma activity repository', () => {
  it('creates a minimal activity with stable defaults and maps nullable fields', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'));
    const row = minimalRow();
    const prisma = prismaClient({ create: vi.fn().mockResolvedValue(row) });
    const repository = new PrismaActivityRepository(prisma as never);

    const result = await repository.create({
      type: 'login',
      description: 'Signed in',
      status: 'success',
    });

    expect(prisma.activity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.any(String),
        type: 'login',
        description: 'Signed in',
        timestamp: new Date('2026-08-01T12:00:00.000Z'),
        status: 'success',
        ip_address: null,
        user_agent: null,
        client_id: null,
        is_private: false,
        related_activity_id: null,
        actor: undefined,
        target: undefined,
        device: undefined,
      }),
      include: includeRelations,
    });
    expect(result).toEqual(
      expect.objectContaining({
        id: 'activity-1',
        _id: 'activity-1',
        ip_address: '',
        user_agent: undefined,
        client_id: undefined,
        related_activity_id: undefined,
        actor: undefined,
        target: undefined,
        device_infos: undefined,
        created_at: '2026-08-01T00:00:01.000Z',
      })
    );
    vi.useRealTimers();
  });

  it('persists and maps the complete supported activity shape', async () => {
    const row = fullRow();
    const prisma = prismaClient({ create: vi.fn().mockResolvedValue(row) });
    const repository = new PrismaActivityRepository(prisma as never);
    const trustedAt = new Date('2026-07-01T00:00:00.000Z');
    const trustedUntil = new Date('2026-09-01T00:00:00.000Z');
    const data: CreateActivityDto = {
      type: 'login',
      description: 'Signed in',
      timestamp: new Date('2026-08-01T00:00:00.000Z'),
      status: 'success',
      ip_address: '127.0.0.1',
      user_agent: 'test-agent',
      client_id: 'client-1',
      is_private: true,
      related_activity_id: 'related-1',
      actor: {
        actor_type: 'admin',
        user_id: 'user-1',
        username: 'alice',
        email: 'alice@example.com',
        full_name: 'Alice Example',
        given_name: 'Alice',
        family_name: 'Example',
      },
      target: {
        target_type: 'client',
        user_id: 'user-2',
        username: 'bob',
        email: 'bob@example.com',
        full_name: 'Bob Example',
        entity_id: 'entity-1',
        entity_name: 'Demo client',
        entity_data: { enabled: true },
      },
      device_infos: {
        fingerprint: 'fingerprint-1',
        fingerprint_js_id: 'visitor-1',
        browser: { name: 'Firefox', version: '140' },
        os: { name: 'Linux', version: '6' },
        device: { type: 'desktop', vendor: 'Framework', model: 'Laptop 13' },
        language: 'en',
        platform: 'Linux x86_64',
        screen: { width: 1920, height: 1080, pixel_ratio: 2 },
        hardware_concurrency: 16,
        memory: 32,
        is_new_device: false,
        is_suspicious: true,
        confidence_score: 90,
        risk_level: 'medium',
        matched_device_id: 'device-1',
        reason: 'new network',
        geo_location: {
          country: 'BJ',
          region: 'Atlantique',
          city: 'Cotonou',
          latitude: 6.37,
          longitude: 2.39,
          timezone: 'Africa/Porto-Novo',
        },
        device_trust: {
          trusted: false,
          trusted_at: trustedAt,
          trusted_until: trustedUntil,
          fingerprint: 'fingerprint-1',
        },
      },
    };

    const result = await repository.create(data);

    expect(prisma.activity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actor: { create: expect.objectContaining({ user_id: 'user-1' }) },
        target: {
          create: expect.objectContaining({
            user_id: 'user-2',
            entity_data: JSON.stringify({ enabled: true }),
          }),
        },
        device: {
          create: expect.objectContaining({
            fingerprint: 'fingerprint-1',
            browser_name: 'Firefox',
            geo_country: 'BJ',
            device_trust_trusted: false,
            device_trust_trusted_at: trustedAt,
            device_trust_until: trustedUntil,
          }),
        },
      }),
      include: includeRelations,
    });
    expect(result).toEqual(
      expect.objectContaining({
        actor: expect.objectContaining({
          actor_type: 'admin',
          user_id: 'user-1',
        }),
        target: expect.objectContaining({
          target_type: 'client',
          entity_data: { enabled: true },
        }),
        device_infos: expect.objectContaining({
          browser: { name: 'Firefox', version: undefined },
          os: { name: undefined, version: 'Linux' },
          device: { type: undefined, vendor: 'Framework', model: 'Laptop 13' },
          screen: { width: undefined, height: 1080, pixel_ratio: 2 },
          geo_location: expect.objectContaining({ city: 'Cotonou' }),
          device_trust: {
            trusted: false,
            trusted_at: trustedAt,
            trusted_until: trustedUntil,
            fingerprint: 'fingerprint-1',
          },
        }),
      })
    );
  });

  it('applies the active tenant to every nested activity row', async () => {
    const create = vi.fn().mockResolvedValue(minimalRow());
    const repository = new PrismaActivityRepository(
      prismaClient({ create }) as never
    );

    await tenantContext.run('tenant-a', () =>
      repository.create({
        type: 'admin_enabled_user',
        description: 'Admin enabled user',
        status: 'success',
        actor: { actor_type: 'admin', user_id: 'admin-1' },
        target: { target_type: 'user', user_id: 'user-1' },
        device_infos: { fingerprint: 'fingerprint-1' },
      })
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actor: {
            create: expect.objectContaining({ tenant_id: 'tenant-a' }),
          },
          target: {
            create: expect.objectContaining({ tenant_id: 'tenant-a' }),
          },
          device: {
            create: expect.objectContaining({ tenant_id: 'tenant-a' }),
          },
        }),
      })
    );
  });

  it('normalizes sparse relation rows without leaking database nulls', async () => {
    const row = minimalRow({
      actor: {
        actor_type: 'anonymous',
        user_id: null,
        username: null,
        email: null,
        full_name: null,
        given_name: null,
        family_name: null,
      },
      target: {
        target_type: 'none',
        user_id: null,
        username: null,
        email: null,
        full_name: null,
        entity_id: null,
        entity_name: null,
        entity_data: null,
      },
      device: {
        fingerprint: null,
        fingerprint_js_id: null,
        browser_name: null,
        browser_version: null,
        os_name: null,
        os_version: null,
        device_type: null,
        device_vendor: null,
        device_model: null,
        language: null,
        platform: null,
        screen_width: null,
        screen_height: null,
        screen_pixel_ratio: null,
        hardware_concurrency: null,
        memory: null,
        is_new_device: null,
        is_suspicious: null,
        confidence_score: null,
        risk_level: null,
        matched_device_id: null,
        reason: null,
        geo_country: null,
        geo_region: null,
        geo_city: null,
        geo_lat: null,
        geo_lon: null,
        geo_timezone: null,
        device_trust_trusted: null,
        device_trust_trusted_at: null,
        device_trust_until: null,
      },
    });
    const prisma = prismaClient({ findUnique: vi.fn().mockResolvedValue(row) });
    const repository = new PrismaActivityRepository(prisma as never);

    const result = await repository.findById('activity-1');

    expect(result).toEqual(
      expect.objectContaining({
        actor: {
          actor_type: 'anonymous',
          user_id: null,
          username: undefined,
          email: undefined,
          full_name: undefined,
          given_name: undefined,
          family_name: undefined,
        },
        target: {
          target_type: 'none',
          user_id: null,
          username: undefined,
          email: undefined,
          full_name: undefined,
          entity_id: undefined,
          entity_name: undefined,
          entity_data: undefined,
        },
        device_infos: expect.objectContaining({
          browser: undefined,
          os: undefined,
          device: undefined,
          screen: undefined,
          geo_location: undefined,
          device_trust: undefined,
        }),
      })
    );
  });

  it('maps device sections when only either side of a presence check exists', async () => {
    const row = minimalRow({
      device: {
        fingerprint: null,
        fingerprint_js_id: null,
        browser_name: null,
        browser_version: '140',
        os_name: 'Linux',
        os_version: null,
        device_type: 'desktop',
        device_vendor: null,
        device_model: null,
        language: null,
        platform: null,
        screen_width: 1920,
        screen_height: null,
        screen_pixel_ratio: null,
        hardware_concurrency: null,
        memory: null,
        is_new_device: null,
        is_suspicious: null,
        confidence_score: null,
        risk_level: null,
        matched_device_id: null,
        reason: null,
        geo_country: 'BJ',
        geo_region: null,
        geo_city: null,
        geo_lat: null,
        geo_lon: null,
        geo_timezone: null,
        device_trust_trusted: null,
        device_trust_trusted_at: null,
        device_trust_until: null,
      },
    });
    const repository = new PrismaActivityRepository(
      prismaClient({ findUnique: vi.fn().mockResolvedValue(row) }) as never
    );

    const result = await repository.findById('activity-1');

    expect(result?.device_infos).toEqual(
      expect.objectContaining({
        browser: { name: undefined, version: '140' },
        os: { name: 'Linux', version: undefined },
        device: { type: 'desktop', vendor: undefined, model: undefined },
        screen: { width: 1920, height: undefined, pixel_ratio: undefined },
        geo_location: {
          country: 'BJ',
          region: undefined,
          city: undefined,
          latitude: undefined,
          longitude: undefined,
          timezone: undefined,
        },
      })
    );
  });

  it('persists sparse nested input and uses the trust fingerprint fallback', async () => {
    const create = vi.fn().mockResolvedValue(minimalRow());
    const repository = new PrismaActivityRepository(
      prismaClient({ create }) as never
    );
    const base = {
      type: 'system.event',
      description: 'System event',
      status: 'info' as const,
    };

    await repository.create({
      ...base,
      actor: { actor_type: 'system' },
      target: { target_type: 'none' },
      device_infos: {
        browser: {},
        os: {},
        device: {},
        screen: {},
        geo_location: {},
      },
    });
    expect(create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actor: {
            create: expect.objectContaining({
              user_id: null,
              username: null,
              email: null,
            }),
          },
          target: {
            create: expect.objectContaining({
              user_id: null,
              entity_data: null,
            }),
          },
          device: {
            create: expect.objectContaining({
              fingerprint: null,
              browser_name: null,
              geo_country: null,
              device_trust_trusted: null,
            }),
          },
        }),
      })
    );

    const trustedAt = new Date('2026-07-01');
    const trustedUntil = new Date('2026-09-01');
    await repository.create({
      ...base,
      device_infos: {
        device_trust: {
          trusted: true,
          trusted_at: trustedAt,
          trusted_until: trustedUntil,
          fingerprint: 'trusted-fingerprint',
        },
      },
    });
    expect(create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          device: {
            create: expect.objectContaining({
              fingerprint: 'trusted-fingerprint',
              device_trust_trusted: true,
              device_trust_trusted_at: trustedAt,
              device_trust_until: trustedUntil,
            }),
          },
        }),
      })
    );
  });

  it('uses safe device-trust date fallbacks when legacy rows omit them', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'));
    const row = minimalRow({
      device: {
        fingerprint: null,
        fingerprint_js_id: null,
        browser_name: null,
        browser_version: null,
        os_name: null,
        os_version: null,
        device_type: null,
        device_vendor: null,
        device_model: null,
        language: null,
        platform: null,
        screen_width: null,
        screen_height: null,
        screen_pixel_ratio: null,
        hardware_concurrency: null,
        memory: null,
        is_new_device: null,
        is_suspicious: null,
        confidence_score: null,
        risk_level: null,
        matched_device_id: null,
        reason: null,
        geo_country: null,
        geo_region: null,
        geo_city: null,
        geo_lat: null,
        geo_lon: null,
        geo_timezone: null,
        device_trust_trusted: true,
        device_trust_trusted_at: null,
        device_trust_until: null,
      },
    });
    const prisma = prismaClient({ findUnique: vi.fn().mockResolvedValue(row) });
    const repository = new PrismaActivityRepository(prisma as never);

    const result = await repository.findById('activity-1');

    expect(result?.device_infos).toEqual(
      expect.objectContaining({
        browser: undefined,
        os: undefined,
        device: undefined,
        screen: undefined,
        geo_location: undefined,
        device_trust: {
          trusted: true,
          trusted_at: new Date('2026-08-01T12:00:00.000Z'),
          trusted_until: new Date('2026-08-01T12:00:00.000Z'),
          fingerprint: '',
        },
      })
    );
    vi.useRealTimers();
  });

  it('finds by id and by arbitrary filter, including missing records', async () => {
    const row = minimalRow();
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce(null);
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce(null);
    const prisma = prismaClient({ findUnique, findFirst });
    const repository = new PrismaActivityRepository(prisma as never);

    await expect(repository.findById('activity-1')).resolves.toMatchObject({
      id: 'activity-1',
    });
    await expect(repository.findById('missing')).resolves.toBeNull();
    await expect(repository.findOne({ type: 'login' })).resolves.toMatchObject({
      id: 'activity-1',
    });
    await expect(repository.findOne({ type: 'missing' })).resolves.toBeNull();
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'activity-1' },
      include: includeRelations,
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { type: 'login' },
      include: includeRelations,
    });
  });

  it('builds every supported filter and maps paginated rows', async () => {
    const row = minimalRow();
    const findMany = vi.fn().mockResolvedValue([row]);
    const count = vi.fn().mockResolvedValue(1);
    const prisma = prismaClient({ findMany, count });
    const repository = new PrismaActivityRepository(prisma as never);
    const from = new Date('2026-07-01');
    const to = new Date('2026-08-01');

    const result = await repository.findMany(
      {
        search: 'admin.*',
        type: ['login', 'logout'],
        status: 'success',
        client_id: 'client-1',
        is_private: false,
        ip_address: '127.0.0.1',
        timestamp: { $gte: from, $lte: to },
        'actor.user_id': 'user-1',
        'actor.actor_type': 'admin',
        'actor.username': 'alice',
        'device_infos.fingerprint': 'fingerprint-1',
      },
      { page: 2, limit: 1 }
    );

    expect(findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { description: { contains: 'admin.*' } },
          { actor: { username: { contains: 'admin.*' } } },
        ],
        type: { in: ['login', 'logout'] },
        status: 'success',
        client_id: 'client-1',
        is_private: false,
        ip_address: '127.0.0.1',
        timestamp: { gte: from, lte: to },
        actor: { user_id: 'user-1', actor_type: 'admin', username: 'alice' },
        device: { fingerprint: 'fingerprint-1' },
      },
      take: 1,
      skip: 1,
      orderBy: { created_at: 'desc' },
      include: includeRelations,
    });
    expect(result.results[0]).toMatchObject({ id: 'activity-1' });

    await repository.findMany({ type: 'login', timestamp: {} });
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { type: 'login', timestamp: {} } })
    );
  });

  it('matches activities where the user is either the actor or the target', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const repository = new PrismaActivityRepository(
      prismaClient({ findMany, count }) as never
    );

    await repository.findMany({
      related_user_id: 'user-1',
      type: 'user_enabled_by_admin',
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          type: 'user_enabled_by_admin',
          OR: [
            { actor: { user_id: 'user-1' } },
            { target: { user_id: 'user-1' } },
          ],
        },
      })
    );
  });

  it('combines search and related-user filters without weakening either one', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const repository = new PrismaActivityRepository(
      prismaClient({ findMany, count }) as never
    );

    await repository.findMany({
      search: 'admin.*',
      related_user_id: 'user-1',
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: [
                { description: { contains: 'admin.*' } },
                { actor: { username: { contains: 'admin.*' } } },
              ],
            },
            {
              OR: [
                { actor: { user_id: 'user-1' } },
                { target: { user_id: 'user-1' } },
              ],
            },
          ],
        },
      })
    );
  });

  it('sorts the public username field through the actor relation', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const repository = new PrismaActivityRepository(
      prismaClient({ findMany, count }) as never
    );

    await repository.findMany({}, { sort: { username: 1 } });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { actor: { username: 'asc' } },
      })
    );

    await repository.findMany({}, { sort: {} });
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ orderBy: {} })
    );
  });

  it('delegates user/device queries, counts, deletes, and distinct types', async () => {
    const row = minimalRow();
    const findMany = vi.fn().mockResolvedValue([row]);
    const count = vi.fn().mockResolvedValue(1);
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const groupBy = vi
      .fn()
      .mockResolvedValue([{ type: 'login' }, { type: 'logout' }]);
    const deleteOne = vi.fn().mockResolvedValue(row);
    const prisma = prismaClient({
      findMany,
      count,
      deleteMany,
      groupBy,
      delete: deleteOne,
    });
    const repository = new PrismaActivityRepository(prisma as never);
    const cutoff = new Date('2026-07-01');

    await repository.findByUser('user-1', { limit: 5 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { actor: { user_id: 'user-1' } } })
    );
    const cursor = {
      timestamp: new Date('2026-08-05T12:00:00.000Z'),
      id: 'activity-2',
    };
    await repository.findByUser(
      'user-1',
      { limit: 5, sort: { timestamp: -1, id: -1 } },
      cursor
    );
    expect(findMany).toHaveBeenLastCalledWith({
      where: {
        actor: { user_id: 'user-1' },
        OR: [
          { timestamp: { lt: cursor.timestamp } },
          {
            timestamp: { equals: cursor.timestamp },
            id: { lt: cursor.id },
          },
        ],
      },
      take: 5,
      skip: 0,
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      include: includeRelations,
    });
    await expect(
      repository.findByDevice('fingerprint-1')
    ).resolves.toHaveLength(1);
    expect(findMany).toHaveBeenLastCalledWith({
      where: { device: { fingerprint: 'fingerprint-1' } },
      include: includeRelations,
    });
    await expect(repository.count()).resolves.toBe(1);
    await expect(repository.count({ status: 'failed' })).resolves.toBe(1);
    expect(count).toHaveBeenLastCalledWith({ where: { status: 'failed' } });
    await expect(repository.deleteOlderThan(cutoff)).resolves.toBe(2);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { timestamp: { lt: cutoff } },
    });
    await expect(
      repository.getDistinctTypes({
        status: 'success',
        'actor.user_id': 'user-1',
        'actor.username': 'alice',
      })
    ).resolves.toEqual(['login', 'logout']);
    expect(groupBy).toHaveBeenCalledWith({
      by: ['type'],
      where: {
        status: 'success',
        actor: { user_id: 'user-1', username: 'alice' },
      },
    });
    await repository.getDistinctTypes({ related_user_id: 'user-2' });
    expect(groupBy).toHaveBeenLastCalledWith({
      by: ['type'],
      where: {
        OR: [
          { actor: { user_id: 'user-2' } },
          { target: { user_id: 'user-2' } },
        ],
      },
    });
    await repository.getDistinctTypes();
    expect(groupBy).toHaveBeenLastCalledWith({ by: ['type'], where: {} });
    await repository.delete('activity-1');
    expect(deleteOne).toHaveBeenCalledWith({ where: { id: 'activity-1' } });
  });
});

describe('Mongoose activity repository', () => {
  it('maps the public username sort and preserves ordinary sort fields', async () => {
    const paginate = vi.fn().mockResolvedValue({
      results: [],
      totalResults: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
      hasNextPage: false,
      hasPrevPage: false,
    });
    const repository = new MongooseActivityRepository({ paginate } as never);

    await repository.findMany({}, { sort: { username: -1, timestamp: 'asc' } });

    expect(paginate).toHaveBeenCalledWith(
      {},
      {
        page: 1,
        limit: 20,
        sortBy: 'actor.username:desc,timestamp:asc',
      }
    );
  });

  it('delegates pagination and device queries to the model contract', async () => {
    const paginate = vi.fn().mockResolvedValue({
      results: [],
      totalResults: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
      hasNextPage: false,
      hasPrevPage: false,
    });
    const findQuery = {
      lean: vi.fn(),
      exec: vi.fn().mockResolvedValue([]),
    };
    findQuery.lean.mockReturnValue(findQuery);
    const model = { paginate, find: vi.fn().mockReturnValue(findQuery) };
    const repository = new MongooseActivityRepository(model as never);

    await repository.findMany(
      { status: 'success', search: 'admin.*' },
      { limit: 2 }
    );
    const safeSearch = /admin\.\*/i;
    expect(paginate).toHaveBeenCalledWith(
      {
        status: 'success',
        $or: [
          { description: { $regex: safeSearch } },
          { 'actor.username': { $regex: safeSearch } },
        ],
      },
      { page: 1, limit: 2, sortBy: 'created_at:desc' }
    );
    await repository.findByUser('user-1');
    expect(paginate).toHaveBeenLastCalledWith(
      { 'actor.user_id': 'user-1' },
      { page: 1, limit: 20, sortBy: 'created_at:desc' }
    );
    const cursor = {
      timestamp: new Date('2026-08-05T12:00:00.000Z'),
      id: 'activity-2',
    };
    await repository.findByUser(
      'user-1',
      { limit: 5, sort: { timestamp: -1, id: -1 } },
      cursor
    );
    expect(paginate).toHaveBeenLastCalledWith(
      {
        'actor.user_id': 'user-1',
        $or: [
          { timestamp: { $lt: cursor.timestamp } },
          {
            timestamp: cursor.timestamp,
            _id: { $lt: cursor.id },
          },
        ],
      },
      { page: 1, limit: 5, sortBy: 'timestamp:desc,_id:desc' }
    );
    await expect(repository.findByDevice('fingerprint-1')).resolves.toEqual([]);
    expect(model.find).toHaveBeenCalledWith({
      'device_infos.fingerprint': 'fingerprint-1',
    });
  });

  it('matches activities where the user is either the actor or the target', async () => {
    const paginate = vi.fn().mockResolvedValue({
      results: [],
      totalResults: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
      hasNextPage: false,
      hasPrevPage: false,
    });
    const repository = new MongooseActivityRepository({ paginate } as never);

    await repository.findMany({
      related_user_id: 'user-1',
      type: 'user_enabled_by_admin',
    });

    expect(paginate).toHaveBeenCalledWith(
      {
        type: 'user_enabled_by_admin',
        $or: [{ 'actor.user_id': 'user-1' }, { 'target.user_id': 'user-1' }],
      },
      { page: 1, limit: 20, sortBy: 'created_at:desc' }
    );
  });

  it('combines literal search and related-user filters without weakening either one', async () => {
    const paginate = vi.fn().mockResolvedValue({
      results: [],
      totalResults: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
      hasNextPage: false,
      hasPrevPage: false,
    });
    const repository = new MongooseActivityRepository({ paginate } as never);

    await repository.findMany({
      search: 'admin.*',
      related_user_id: 'user-1',
    });

    expect(paginate).toHaveBeenCalledWith(
      {
        $and: [
          {
            $or: [
              { description: { $regex: /admin\.\*/i } },
              { 'actor.username': { $regex: /admin\.\*/i } },
            ],
          },
          {
            $or: [
              { 'actor.user_id': 'user-1' },
              { 'target.user_id': 'user-1' },
            ],
          },
        ],
      },
      { page: 1, limit: 20, sortBy: 'created_at:desc' }
    );
  });

  it('counts, expires by activity timestamp, and preserves a missing delete count', async () => {
    const countDocuments = vi
      .fn()
      .mockReturnValueOnce(execQuery(3))
      .mockReturnValueOnce(execQuery(1));
    const deleteMany = vi
      .fn()
      .mockReturnValueOnce(execQuery({ deletedCount: 2 }))
      .mockReturnValueOnce(execQuery({}));
    const model = { countDocuments, deleteMany };
    const repository = new MongooseActivityRepository(model as never);
    const cutoff = new Date('2026-07-01');

    await expect(repository.count()).resolves.toBe(3);
    await expect(
      repository.count({ status: 'failed', search: 'admin.*' })
    ).resolves.toBe(1);
    expect(countDocuments).toHaveBeenLastCalledWith({
      status: 'failed',
      $or: [
        { description: { $regex: /admin\.\*/i } },
        { 'actor.username': { $regex: /admin\.\*/i } },
      ],
    });
    await expect(repository.deleteOlderThan(cutoff)).resolves.toBe(2);
    await expect(repository.deleteOlderThan(cutoff)).resolves.toBe(0);
    expect(deleteMany).toHaveBeenCalledWith({ timestamp: { $lt: cutoff } });
  });

  it('builds all supported distinct-type filters', async () => {
    const distinct = vi.fn().mockResolvedValue(['login']);
    const repository = new MongooseActivityRepository({ distinct } as never);

    await expect(
      repository.getDistinctTypes({
        status: 'success',
        'actor.username': 'alice',
        'actor.user_id': 'user-1',
      })
    ).resolves.toEqual(['login']);
    expect(distinct).toHaveBeenCalledWith('type', {
      status: 'success',
      'actor.username': 'alice',
      'actor.user_id': 'user-1',
    });
    await repository.getDistinctTypes({ related_user_id: 'user-2' });
    expect(distinct).toHaveBeenLastCalledWith('type', {
      $or: [{ 'actor.user_id': 'user-2' }, { 'target.user_id': 'user-2' }],
    });
    await repository.getDistinctTypes();
    expect(distinct).toHaveBeenLastCalledWith('type', {});
  });
});
