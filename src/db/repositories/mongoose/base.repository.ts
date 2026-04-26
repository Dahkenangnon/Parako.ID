import type { TypedModel } from '../../../models/base.model.js';
import type { IBaseModel } from '../../../models/base.model.js';
import type {
  IBaseRepository,
  PaginatedResult,
  PaginationOptions,
  QueryOptions,
} from '../interfaces/base.repository.js';
import { serializeDocument, serializeDocuments } from '../../utils.js';

export abstract class AbstractMongooseRepository<
  T extends IBaseModel,
  TCreate,
  TUpdate = Partial<TCreate>,
> implements IBaseRepository<T, TCreate, TUpdate> {
  constructor(protected readonly model: TypedModel<any, any>) {}

  async findById(id: string): Promise<T | null> {
    const doc = await this.model.findById(id).lean().exec();
    return serializeDocument(doc) as T | null;
  }

  async findOne(filter: Record<string, unknown>): Promise<T | null> {
    const doc = await this.model
      .findOne(filter as any)
      .lean()
      .exec();
    return serializeDocument(doc) as T | null;
  }

  async findMany(
    filter: Record<string, unknown>,
    opts?: QueryOptions
  ): Promise<T[]> {
    let q = this.model.find(filter as any).lean();
    if (opts?.sort) q = q.sort(opts.sort as any);
    if (opts?.skip) q = q.skip(opts.skip);
    if (opts?.limit) q = q.limit(opts.limit);
    const docs = await q.exec();
    return serializeDocuments(docs) as T[];
  }

  async create(data: TCreate): Promise<T> {
    const doc = await this.model.create(data as Record<string, unknown>);
    return serializeDocument(doc as T & { _id?: any }) as T;
  }

  async update(id: string, data: TUpdate): Promise<T> {
    const doc = await this.model
      .findByIdAndUpdate(
        id,
        { $set: data as Record<string, unknown> },
        { returnDocument: 'after', runValidators: true }
      )
      .lean()
      .exec();
    if (!doc) throw new Error(`Document not found: ${id}`);
    return serializeDocument(doc) as T;
  }

  async delete(id: string): Promise<void> {
    await this.model.findByIdAndDelete(id).exec();
  }

  async count(filter?: Record<string, unknown>): Promise<number> {
    return this.model.countDocuments((filter ?? {}) as any).exec();
  }

  protected async paginate(
    filter: Record<string, unknown>,
    opts?: PaginationOptions
  ): Promise<PaginatedResult<T>> {
    const page = opts?.page ?? 1;
    const limit = opts?.limit ?? 20;
    const sortBy = opts?.sort
      ? Object.entries(opts.sort)
          .map(([k, v]) => `${k}:${v === -1 || v === 'desc' ? 'desc' : 'asc'}`)
          .join(',')
      : 'created_at:desc';

    const raw = await (this.model as any).paginate(filter, {
      page,
      limit,
      sortBy,
    });

    return {
      results: serializeDocuments(raw.results) as T[],
      totalResults: raw.totalResults,
      page: raw.page,
      limit: raw.limit,
      totalPages: raw.totalPages,
      hasNextPage: raw.hasNextPage,
      hasPrevPage: raw.hasPrevPage,
    };
  }
}
