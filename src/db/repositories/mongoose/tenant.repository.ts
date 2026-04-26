import { injectable } from 'inversify';
import type { ITenant } from '../../../types/tenant.js';
import type { TenantModel } from '../../../models/tenant.model.js';
import type {
  ITenantRepository,
  CreateTenantDto,
} from '../interfaces/tenant.repository.js';
import { serializeDocument, serializeDocuments } from '../../utils.js';

@injectable()
export class MongooseTenantRepository implements ITenantRepository {
  constructor(private readonly tenantModel: TenantModel) {}

  async findBySlug(slug: string): Promise<ITenant | null> {
    const doc = await this.tenantModel.findOne({ slug }).lean().exec();
    return serializeDocument(doc) as ITenant | null;
  }

  async findByDomain(domain: string): Promise<ITenant | null> {
    const doc = await this.tenantModel.findOne({ domain }).lean().exec();
    return serializeDocument(doc) as ITenant | null;
  }

  async findById(id: string): Promise<ITenant | null> {
    const doc = await this.tenantModel.findById(id).lean().exec();
    return serializeDocument(doc) as ITenant | null;
  }

  async findAll(filter?: { status?: string }): Promise<ITenant[]> {
    const query = filter?.status ? { status: filter.status } : {};
    const docs = await this.tenantModel.find(query).lean().exec();
    return serializeDocuments(docs) as ITenant[];
  }

  async create(data: CreateTenantDto): Promise<ITenant> {
    const doc = await this.tenantModel.create(data);
    return serializeDocument(doc as any) as ITenant;
  }

  async update(id: string, data: Partial<ITenant>): Promise<ITenant> {
    const doc = await this.tenantModel
      .findByIdAndUpdate(
        id,
        { $set: { ...data, updated_at: new Date() } },
        { returnDocument: 'after', runValidators: true }
      )
      .lean()
      .exec();
    if (!doc) throw new Error(`Tenant not found: ${id}`);
    return serializeDocument(doc) as ITenant;
  }

  async exists(slug: string): Promise<boolean> {
    const count = await this.tenantModel.countDocuments({ slug }).exec();
    return count > 0;
  }
}
