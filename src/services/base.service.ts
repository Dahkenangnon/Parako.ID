import {
  type UpdateWriteOpResult,
  type QueryFilter,
  type ClientSession,
  type PipelineStage,
  Document,
} from 'mongoose';
import { type IBaseModel, type TypedModel } from '../models/base.model.js';
import { type DeleteResult } from 'mongodb';
import { serializeDocument, serializeDocuments, merge } from '../db/utils.js';

export abstract class BaseService<
  T extends IBaseModel,
  M,
  ModelType extends TypedModel<T, M>,
> {
  protected model: ModelType;

  constructor(model: ModelType) {
    this.model = model;
  }

  protected normalizeFilter<F extends Record<string, any>>(filter: F): F {
    const newFilter = { ...filter } as F & { _id?: any; id?: any };

    if (Object.keys(newFilter).length === 0) {
      return newFilter;
    }

    if (newFilter.id && !newFilter._id) {
      newFilter._id = newFilter.id;
      delete newFilter.id;
    }

    return newFilter as F;
  }

  // ===== ESSENTIAL CRUD OPERATIONS =====

  public async createOne(
    data: Partial<T>,
    options: { session?: ClientSession } = {}
  ): Promise<T> {
    const doc = new (this.model as any)(data);
    const savedDoc = await doc.save(options);

    return serializeDocument(savedDoc) as T;
  }

  public async createMany(
    data: Partial<T>[],
    options: { session?: ClientSession; ordered?: boolean } = {}
  ): Promise<T[]> {
    const docs = await (this.model as any).insertMany(data, {
      session: options.session,
      ordered: options.ordered ?? true,
    });

    return serializeDocuments(docs) as T[];
  }

  public async findOne(
    filter: QueryFilter<T> | string,
    options: {
      populate?: string | Array<string>;
      select?: string | Record<string, 0 | 1>;
      lean?: boolean;
      session?: ClientSession;
    } = { lean: true }
  ): Promise<T | null> {
    let query: any;

    if (typeof filter === 'string') {
      query = this.model.findById(filter);
    } else {
      const normalizedFilter = this.normalizeFilter(
        filter as Record<string, any>
      );
      query = this.model.findOne(normalizedFilter);
    }

    if (options.populate) {
      if (typeof options.populate === 'string') {
        query.populate(options.populate.split(',').join(' '));
      } else if (Array.isArray(options.populate)) {
        options.populate.forEach(field => {
          query.populate(field);
        });
      }
    }

    if (options.select) {
      query.select(options.select);
    }

    if (options.session) {
      query.session(options.session);
    }

    if (options.lean) {
      query.lean();
    }

    const doc = await query.exec();
    return serializeDocument(doc) as T | null;
  }

  public async findMany(
    filter: QueryFilter<T> = {},
    options: {
      sort?: Record<string, 1 | -1 | 'asc' | 'desc'>;
      populate?: string | Array<string>;
      select?: string | Record<string, 0 | 1>;
      limit?: number;
      skip?: number;
      lean?: boolean;
      session?: ClientSession;
    } = {
      lean: true,
    }
  ): Promise<T[]> {
    const normalizedFilter = this.normalizeFilter(filter);

    const query: any = this.model.find(normalizedFilter);

    if (options.sort) {
      query.sort(options.sort);
    }

    if (options.select) {
      query.select(options.select);
    }

    if (options.populate) {
      if (typeof options.populate === 'string') {
        query.populate(options.populate.split(',').join(' '));
      } else if (Array.isArray(options.populate)) {
        options.populate.forEach(field => {
          query.populate(field);
        });
      }
    }

    if (options.limit !== undefined) {
      query.limit(options.limit);
    }

    if (options.skip !== undefined) {
      query.skip(options.skip);
    }

    if (options.session) {
      query.session(options.session);
    }

    if (options.lean) {
      query.lean();
    }

    const docs = await query.exec();
    return serializeDocuments(docs) as T[];
  }

  public async updateById(
    id: string,
    data: Partial<T>,
    options: {
      populate?: string | Array<string>;
      session?: ClientSession;
      upsert?: boolean;
      runValidators?: boolean;
    } = {}
  ): Promise<T | null> {
    const existingItem: any = await this.model
      .findById(id)
      .session(options.session || null);

    if (!existingItem) {
      if (options.upsert) {
        return await this.createOne({ _id: id, ...data } as Partial<T>, {
          session: options.session,
        });
      }
      return null;
    }

    merge(existingItem, data);

    if (options.populate) {
      if (typeof options.populate === 'string') {
        await existingItem.populate(options.populate.split(',').join(' '));
      } else if (Array.isArray(options.populate)) {
        for (const field of options.populate) {
          await existingItem.populate(field);
        }
      }
    }

    const saveOptions: any = {};
    if (options.session) saveOptions.session = options.session;
    if (options.runValidators)
      saveOptions.runValidators = options.runValidators;

    const savedDoc = await existingItem.save(saveOptions);
    return serializeDocument(savedDoc) as T;
  }

  public async updateMany(
    filter: QueryFilter<T>,
    data: Partial<T>,
    options: {
      session?: ClientSession;
      upsert?: boolean;
      runValidators?: boolean;
    } = {}
  ): Promise<UpdateWriteOpResult> {
    const normalizedFilter = this.normalizeFilter(filter);

    const updateOptions: any = {};
    if (options.session) updateOptions.session = options.session;
    if (options.upsert !== undefined) updateOptions.upsert = options.upsert;
    if (options.runValidators)
      updateOptions.runValidators = options.runValidators;

    return await this.model.updateMany(normalizedFilter, data, updateOptions);
  }

  public async deleteOne(
    filter: QueryFilter<T> | string,
    options: {
      session?: ClientSession;
    } = {}
  ): Promise<T | null> {
    let result: Document | null;

    if (typeof filter === 'string') {
      result = await (this.model as any).findByIdAndDelete(filter, {
        session: options.session,
      });
    } else {
      const normalizedFilter = this.normalizeFilter(
        filter as Record<string, any>
      );
      result = await (this.model as any).findOneAndDelete(normalizedFilter, {
        session: options.session,
      });
    }

    return serializeDocument(result) as T | null;
  }

  public async deleteMany(
    filter: QueryFilter<T>,
    options: {
      session?: ClientSession;
    } = {}
  ): Promise<DeleteResult> {
    const normalizedFilter = this.normalizeFilter(filter);

    return await this.model.deleteMany(normalizedFilter, {
      session: options.session,
    });
  }

  // ===== PAGINATION =====

  public async findWithPagination(
    filter: QueryFilter<T> = {},
    options: {
      page: number;
      limit: number;
      sort?: Record<string, 1 | -1 | 'asc' | 'desc'>;
      populate?: string | Array<string>;
      select?: string | Record<string, 0 | 1>;
      lean?: boolean;
      session?: ClientSession;
    }
  ): Promise<{
    results: T[];
    page: number;
    limit: number;
    totalResults: number;
    totalPages: number;
  }> {
    const normalizedFilter = this.normalizeFilter(filter);

    const {
      page,
      limit,
      sort,
      populate,
      select,
      lean = true,
      session,
    } = options;
    const skip = (page - 1) * limit;

    const totalResults = await this.model.countDocuments(normalizedFilter);

    const totalPages = Math.ceil(totalResults / limit);

    const query: any = this.model.find(normalizedFilter);

    if (sort) {
      query.sort(sort);
    }

    if (select) {
      query.select(select);
    }

    if (populate) {
      if (typeof populate === 'string') {
        query.populate(populate.split(',').join(' '));
      } else if (Array.isArray(populate)) {
        populate.forEach(field => {
          query.populate(field);
        });
      }
    }

    query.skip(skip).limit(limit);

    if (session) {
      query.session(session);
    }

    if (lean) {
      query.lean();
    }

    const results = await query.exec();
    const serializedResults = serializeDocuments(results) as T[];

    return {
      results: serializedResults,
      page,
      limit,
      totalResults,
      totalPages,
    };
  }

  public async countDocuments(filter: QueryFilter<T> = {}): Promise<number> {
    const normalizedFilter = this.normalizeFilter(filter);
    return await this.model.countDocuments(normalizedFilter);
  }

  // ===== UTILITY METHODS =====

  public async aggregate(
    pipeline: PipelineStage[],
    options: {
      session?: ClientSession;
    } = {}
  ): Promise<any[]> {
    let aggregation = this.model.aggregate(pipeline);

    if (options.session) {
      aggregation = aggregation.session(options.session);
    }

    return await aggregation.exec();
  }
}
