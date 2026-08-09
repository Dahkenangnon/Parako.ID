import type { PrismaClient } from '@prisma/client';
import type {
  IJwksKeyRepository,
  JwksKeyRecord,
} from './jwks-key.repository.js';

type PrismaJwksKey = Awaited<ReturnType<PrismaClient['jwksKey']['findFirst']>>;

function toRecord(row: NonNullable<PrismaJwksKey>): JwksKeyRecord {
  return {
    kid: row.kid,
    alg: row.alg,
    use: row.use,
    status: row.status as JwksKeyRecord['status'],
    promoted: row.promoted,
    encrypted_private_key: row.encrypted_private_key,
    public_key: row.public_key,
    tenant_id: row.tenant_id,
    created_at: row.created_at,
    rotated_at: row.rotated_at ?? undefined,
  };
}

export class PrismaJwksKeyRepository implements IJwksKeyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  countCurrent(tenantId: string): Promise<number> {
    return this.prisma.jwksKey.count({
      where: {
        tenant_id: tenantId,
        status: { in: ['active', 'expiring'] },
      },
    });
  }

  async findCurrent(tenantId: string): Promise<JwksKeyRecord[]> {
    const rows = await this.prisma.jwksKey.findMany({
      where: {
        tenant_id: tenantId,
        status: { in: ['active', 'expiring'] },
      },
    });
    return rows.map(toRecord);
  }

  async findAll(tenantId: string): Promise<JwksKeyRecord[]> {
    const rows = await this.prisma.jwksKey.findMany({
      where: { tenant_id: tenantId },
      orderBy: { created_at: 'desc' },
    });
    return rows.map(toRecord);
  }

  async findNewestActive(tenantId: string): Promise<JwksKeyRecord | null> {
    const row = await this.prisma.jwksKey.findFirst({
      where: { tenant_id: tenantId, status: 'active' },
      orderBy: { created_at: 'desc' },
    });
    return row ? toRecord(row) : null;
  }

  async insertInitial(keys: JwksKeyRecord[]): Promise<boolean> {
    try {
      await this.insertMany(keys);
      return true;
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        return false;
      }
      throw error;
    }
  }

  async insertMany(keys: JwksKeyRecord[]): Promise<void> {
    await this.prisma.jwksKey.createMany({
      data: keys.map(key => ({
        kid: key.kid,
        alg: key.alg,
        use: key.use,
        status: key.status,
        promoted: key.promoted,
        encrypted_private_key: key.encrypted_private_key,
        public_key:
          typeof key.public_key === 'string'
            ? key.public_key
            : JSON.stringify(key.public_key),
        tenant_id: key.tenant_id,
        created_at: key.created_at,
        rotated_at: key.rotated_at,
      })),
    });
  }

  async markPromotedActiveExpiring(
    tenantId: string,
    rotatedAt: Date
  ): Promise<number> {
    const result = await this.prisma.jwksKey.updateMany({
      where: {
        tenant_id: tenantId,
        status: 'active',
        promoted: { not: false },
      },
      data: { status: 'expiring', rotated_at: rotatedAt },
    });
    return result.count;
  }

  async promoteUnpromotedActive(tenantId: string): Promise<number> {
    const result = await this.prisma.jwksKey.updateMany({
      where: { tenant_id: tenantId, status: 'active', promoted: false },
      data: { promoted: true },
    });
    return result.count;
  }

  async retireExpired(tenantId: string, cutoff: Date): Promise<number> {
    const result = await this.prisma.jwksKey.updateMany({
      where: {
        tenant_id: tenantId,
        status: 'expiring',
        rotated_at: { lt: cutoff },
      },
      data: { status: 'retired' },
    });
    return result.count;
  }

  async retireByKid(tenantId: string, kid: string): Promise<boolean> {
    const result = await this.prisma.jwksKey.updateMany({
      where: {
        tenant_id: tenantId,
        kid,
        status: { not: 'retired' },
      },
      data: { status: 'retired', promoted: false },
    });
    return result.count === 1;
  }
}
