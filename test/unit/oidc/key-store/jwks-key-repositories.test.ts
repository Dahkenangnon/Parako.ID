import { describe, expect, it, vi } from 'vitest';

import { MongooseJwksKeyRepository } from '../../../../src/oidc/key-store/mongoose-jwks-key.repository.js';
import { PrismaJwksKeyRepository } from '../../../../src/oidc/key-store/prisma-jwks-key.repository.js';
import type { JwksKeyRecord } from '../../../../src/oidc/key-store/jwks-key.repository.js';

const key: JwksKeyRecord = {
  kid: 'key-id',
  alg: 'ES256',
  use: 'sig',
  status: 'active',
  promoted: true,
  encrypted_private_key: 'encrypted',
  public_key: { kty: 'EC' },
  tenant_id: 'default',
  created_at: new Date('2026-08-05T00:00:00.000Z'),
};

const row = {
  id: 'database-id',
  ...key,
  public_key: JSON.stringify(key.public_key),
  rotated_at: null,
};

describe('JWKS repository initial insertion', () => {
  it('reports a successful Prisma initial insert', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const repository = new PrismaJwksKeyRepository({
      jwksKey: { createMany },
    } as never);

    await expect(repository.insertInitial([key])).resolves.toBe(true);
    expect(createMany).toHaveBeenCalledTimes(1);
  });

  it('reports a Prisma unique conflict as another initializer winning', async () => {
    const createMany = vi.fn().mockRejectedValue({ code: 'P2002' });
    const repository = new PrismaJwksKeyRepository({
      jwksKey: { createMany },
    } as never);

    await expect(repository.insertInitial([key])).resolves.toBe(false);
  });

  it('does not hide a non-conflict Prisma failure', async () => {
    const failure = new Error('database unavailable');
    const createMany = vi.fn().mockRejectedValue(failure);
    const repository = new PrismaJwksKeyRepository({
      jwksKey: { createMany },
    } as never);

    await expect(repository.insertInitial([key])).rejects.toBe(failure);
  });

  it('reports a successful MongoDB initial insert', async () => {
    const insertMany = vi.fn().mockResolvedValue([key]);
    const repository = new MongooseJwksKeyRepository({ insertMany } as never);

    await expect(repository.insertInitial([key])).resolves.toBe(true);
    expect(insertMany).toHaveBeenCalledWith([key]);
  });

  it('reports a MongoDB duplicate-key conflict as another initializer winning', async () => {
    const insertMany = vi.fn().mockRejectedValue({ code: 11000 });
    const repository = new MongooseJwksKeyRepository({ insertMany } as never);

    await expect(repository.insertInitial([key])).resolves.toBe(false);
  });

  it('does not hide a non-conflict MongoDB failure', async () => {
    const failure = new Error('database unavailable');
    const insertMany = vi.fn().mockRejectedValue(failure);
    const repository = new MongooseJwksKeyRepository({ insertMany } as never);

    await expect(repository.insertInitial([key])).rejects.toBe(failure);
  });
});

describe('Prisma JWKS repository', () => {
  it('counts active and expiring keys for one tenant', async () => {
    const count = vi.fn().mockResolvedValue(2);
    const repository = new PrismaJwksKeyRepository({
      jwksKey: { count },
    } as never);

    await expect(repository.countCurrent('tenant-a')).resolves.toBe(2);
    expect(count).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-a',
        status: { in: ['active', 'expiring'] },
      },
    });
  });

  it('maps current keys and normalizes a null rotation date', async () => {
    const findMany = vi.fn().mockResolvedValue([row]);
    const repository = new PrismaJwksKeyRepository({
      jwksKey: { findMany },
    } as never);

    await expect(repository.findCurrent('tenant-a')).resolves.toEqual([
      expect.objectContaining({
        kid: 'key-id',
        tenant_id: 'default',
        rotated_at: undefined,
      }),
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-a',
        status: { in: ['active', 'expiring'] },
      },
    });
  });

  it('lists all tenant keys newest first and preserves a rotation date', async () => {
    const rotatedAt = new Date('2026-08-05T01:00:00.000Z');
    const findMany = vi
      .fn()
      .mockResolvedValue([{ ...row, rotated_at: rotatedAt }]);
    const repository = new PrismaJwksKeyRepository({
      jwksKey: { findMany },
    } as never);

    await expect(repository.findAll('tenant-a')).resolves.toEqual([
      expect.objectContaining({ rotated_at: rotatedAt }),
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { tenant_id: 'tenant-a' },
      orderBy: { created_at: 'desc' },
    });
  });

  it('finds the newest active key and returns null when absent', async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce(null);
    const repository = new PrismaJwksKeyRepository({
      jwksKey: { findFirst },
    } as never);

    await expect(
      repository.findNewestActive('tenant-a')
    ).resolves.toMatchObject({
      kid: 'key-id',
    });
    await expect(repository.findNewestActive('tenant-a')).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledWith({
      where: { tenant_id: 'tenant-a', status: 'active' },
      orderBy: { created_at: 'desc' },
    });
  });

  it('preserves already serialized public keys during bulk insertion', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const repository = new PrismaJwksKeyRepository({
      jwksKey: { createMany },
    } as never);

    await repository.insertMany([{ ...key, public_key: '{"kty":"EC"}' }]);

    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          kid: 'key-id',
          public_key: '{"kty":"EC"}',
          rotated_at: undefined,
        }),
      ],
    });
  });

  it('moves promoted active keys into the expiring phase', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const repository = new PrismaJwksKeyRepository({
      jwksKey: { updateMany },
    } as never);
    const rotatedAt = new Date('2026-08-05T02:00:00.000Z');

    await expect(
      repository.markPromotedActiveExpiring('tenant-a', rotatedAt)
    ).resolves.toBe(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-a',
        status: 'active',
        promoted: { not: false },
      },
      data: { status: 'expiring', rotated_at: rotatedAt },
    });
  });

  it('promotes unpromoted active keys', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 });
    const repository = new PrismaJwksKeyRepository({
      jwksKey: { updateMany },
    } as never);

    await expect(repository.promoteUnpromotedActive('tenant-a')).resolves.toBe(
      3
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { tenant_id: 'tenant-a', status: 'active', promoted: false },
      data: { promoted: true },
    });
  });

  it('retires expiring keys older than the cutoff', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 4 });
    const repository = new PrismaJwksKeyRepository({
      jwksKey: { updateMany },
    } as never);
    const cutoff = new Date('2026-08-05T03:00:00.000Z');

    await expect(repository.retireExpired('tenant-a', cutoff)).resolves.toBe(4);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-a',
        status: 'expiring',
        rotated_at: { lt: cutoff },
      },
      data: { status: 'retired' },
    });
  });

  it('retires one non-retired key by tenant and kid', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repository = new PrismaJwksKeyRepository({
      jwksKey: { updateMany },
    } as never);

    await expect(
      (repository as any).retireByKid('tenant-a', 'key-id')
    ).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-a',
        kid: 'key-id',
        status: { not: 'retired' },
      },
      data: { status: 'retired', promoted: false },
    });
  });
});

describe('Mongoose JWKS repository retirement', () => {
  it('retires one non-retired key by tenant and kid', async () => {
    const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const repository = new MongooseJwksKeyRepository({ updateOne } as never);

    await expect(
      (repository as any).retireByKid('tenant-a', 'key-id')
    ).resolves.toBe(true);
    expect(updateOne).toHaveBeenCalledWith(
      {
        tenant_id: 'tenant-a',
        kid: 'key-id',
        status: { $ne: 'retired' },
      },
      { $set: { status: 'retired', promoted: false } }
    );
  });
});
