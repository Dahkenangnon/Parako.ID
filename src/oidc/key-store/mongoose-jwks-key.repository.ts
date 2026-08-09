import type { KeyStatus } from '../../di/interfaces/key-store.interface.js';
import type { JwksKeyModel } from '../../models/jwks-key.model.js';
import type {
  IJwksKeyRepository,
  JwksKeyRecord,
} from './jwks-key.repository.js';

export class MongooseJwksKeyRepository implements IJwksKeyRepository {
  constructor(private readonly model: JwksKeyModel) {}

  countCurrent(tenantId: string): Promise<number> {
    return this.model.countDocuments({
      tenant_id: tenantId,
      status: { $in: ['active', 'expiring'] },
    });
  }

  async findCurrent(tenantId: string): Promise<JwksKeyRecord[]> {
    return (await this.model
      .find({
        tenant_id: tenantId,
        status: { $in: ['active', 'expiring'] },
      })
      .lean()) as unknown as JwksKeyRecord[];
  }

  async findAll(tenantId: string): Promise<JwksKeyRecord[]> {
    return (await this.model
      .find({ tenant_id: tenantId })
      .sort({ created_at: -1 })
      .lean()) as unknown as JwksKeyRecord[];
  }

  async findNewestActive(tenantId: string): Promise<JwksKeyRecord | null> {
    return (await this.model
      .findOne({ tenant_id: tenantId, status: 'active' })
      .sort({ created_at: -1 })
      .lean()) as unknown as JwksKeyRecord | null;
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
        error.code === 11000
      ) {
        return false;
      }
      throw error;
    }
  }

  async insertMany(keys: JwksKeyRecord[]): Promise<void> {
    await this.model.insertMany(keys);
  }

  async markPromotedActiveExpiring(
    tenantId: string,
    rotatedAt: Date
  ): Promise<number> {
    const result = await this.model.updateMany(
      { tenant_id: tenantId, status: 'active', promoted: { $ne: false } },
      {
        $set: {
          status: 'expiring' as KeyStatus,
          rotated_at: rotatedAt,
        },
      }
    );
    return result.modifiedCount;
  }

  async promoteUnpromotedActive(tenantId: string): Promise<number> {
    const result = await this.model.updateMany(
      { tenant_id: tenantId, status: 'active', promoted: false },
      { $set: { promoted: true } }
    );
    return result.modifiedCount;
  }

  async retireExpired(tenantId: string, cutoff: Date): Promise<number> {
    const result = await this.model.updateMany(
      {
        tenant_id: tenantId,
        status: 'expiring',
        rotated_at: { $exists: true, $lt: cutoff },
      },
      { $set: { status: 'retired' as KeyStatus } }
    );
    return result.modifiedCount;
  }

  async retireByKid(tenantId: string, kid: string): Promise<boolean> {
    const result = await this.model.updateOne(
      {
        tenant_id: tenantId,
        kid,
        status: { $ne: 'retired' },
      },
      {
        $set: {
          status: 'retired' as KeyStatus,
          promoted: false,
        },
      }
    );
    return result.modifiedCount === 1;
  }
}
