import { injectable } from 'inversify';
import type { ITenant, TenantStatus } from '../../../types/tenant.js';
import type { TenantModel } from '../../../models/tenant.model.js';
import type {
  ITenantRepository,
  CreateTenantDto,
  UpdateTenantDto,
} from '../interfaces/tenant.repository.js';
import { serializeDocument, serializeDocuments } from '../../utils.js';

const IMMUTABLE_TENANT_FIELDS = new Set([
  '_id',
  'id',
  'created_at',
  'updated_at',
  '__v',
  '__proto__',
  'constructor',
  'prototype',
]);

function mutableTenantFields(data: UpdateTenantDto): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => !IMMUTABLE_TENANT_FIELDS.has(key))
  );
}

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

  async findAll(filter?: { status?: TenantStatus }): Promise<ITenant[]> {
    const query: { status?: TenantStatus } = filter?.status
      ? { status: filter.status }
      : {};
    const docs = await this.tenantModel.find(query).lean().exec();
    return serializeDocuments(docs) as ITenant[];
  }

  async create(data: CreateTenantDto): Promise<ITenant> {
    const doc = await this.tenantModel.create(data);
    return serializeDocument(doc as any) as ITenant;
  }

  async update(id: string, data: UpdateTenantDto): Promise<ITenant> {
    const fields = mutableTenantFields(data);
    const fieldsToSet = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== null)
    );
    const fieldsToUnset = Object.fromEntries(
      Object.entries(fields)
        .filter(([, value]) => value === null)
        .map(([key]) => [key, 1])
    );
    const update: Record<string, Record<string, unknown>> = {
      $set: { ...fieldsToSet, updated_at: new Date() },
    };
    if (Object.keys(fieldsToUnset).length > 0) {
      update.$unset = fieldsToUnset;
    }

    const doc = await this.tenantModel
      .findByIdAndUpdate(id, update, {
        returnDocument: 'after',
        runValidators: true,
      })
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
