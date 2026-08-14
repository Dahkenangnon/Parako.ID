import { injectable } from 'inversify';
import type { IActivity } from '../../../models/activity.model.js';
import type { ActivityCursor } from '../../../types/activity.js';
import type { TypedModel } from '../../../models/base.model.js';
import type {
  IActivityRepository,
  ActivityFilter,
  CreateActivityDto,
} from '../interfaces/activity.repository.js';
import type {
  PaginatedResult,
  PaginationOptions,
} from '../interfaces/base.repository.js';
import { AbstractMongooseRepository } from './base.repository.js';

type ActivityModel = TypedModel<IActivity, object>;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@injectable()
export class MongooseActivityRepository
  extends AbstractMongooseRepository<IActivity, CreateActivityDto>
  implements IActivityRepository
{
  constructor(activityModel: ActivityModel) {
    super(activityModel);
  }

  // IActivityRepository omits findMany from base and redefines it with paginated return.
  // The override is intentionally incompatible with the base class signature.
  // @ts-expect-error -- return type narrowed from T[] to PaginatedResult per IActivityRepository
  async findMany(
    filter: ActivityFilter,
    opts?: PaginationOptions
  ): Promise<PaginatedResult<IActivity>> {
    const sort = opts?.sort
      ? Object.fromEntries(
          Object.entries(opts.sort).map(([key, direction]) => [
            key === 'username' ? 'actor.username' : key,
            direction,
          ])
        )
      : undefined;

    return this.paginate(
      this.toMongoFilter(filter),
      opts?.sort ? { ...opts, sort } : opts
    );
  }

  async findByUser(
    userId: string,
    opts?: PaginationOptions,
    cursor?: ActivityCursor
  ): Promise<PaginatedResult<IActivity>> {
    const filter: Record<string, unknown> = { 'actor.user_id': userId };

    if (cursor) {
      filter.$or = [
        { timestamp: { $lt: cursor.timestamp } },
        { timestamp: cursor.timestamp, _id: { $lt: cursor.id } },
      ];
    }

    const sort = opts?.sort
      ? Object.fromEntries(
          Object.entries(opts.sort).map(([key, direction]) => [
            key === 'id' ? '_id' : key,
            direction,
          ])
        )
      : undefined;

    return this.paginate(filter, opts ? { ...opts, sort } : undefined);
  }

  async findByDevice(fingerprint: string): Promise<IActivity[]> {
    return super.findMany({ 'device_infos.fingerprint': fingerprint });
  }

  async count(filter?: ActivityFilter): Promise<number> {
    return super.count(this.toMongoFilter(filter ?? {}));
  }

  async deleteOlderThan(date: Date): Promise<number> {
    const result = await this.model
      .deleteMany({ timestamp: { $lt: date } })
      .exec();
    return result.deletedCount ?? 0;
  }

  async getDistinctTypes(filter?: ActivityFilter): Promise<string[]> {
    return this.model.distinct('type', this.toMongoFilter(filter ?? {}));
  }

  private toMongoFilter(filter: ActivityFilter): Record<string, unknown> {
    const { search, related_user_id: relatedUserId, ...filterFields } = filter;
    const mongoFilter: Record<string, unknown> = { ...filterFields };
    const disjunctions: Array<Array<Record<string, unknown>>> = [];

    if (search) {
      const safeSearch = new RegExp(escapeRegExp(search), 'i');
      disjunctions.push([
        { description: { $regex: safeSearch } },
        { 'actor.username': { $regex: safeSearch } },
      ]);
    }

    if (relatedUserId) {
      disjunctions.push([
        { 'actor.user_id': relatedUserId },
        { 'target.user_id': relatedUserId },
      ]);
    }

    if (disjunctions.length === 1) {
      mongoFilter.$or = disjunctions[0];
    } else if (disjunctions.length > 1) {
      mongoFilter.$and = disjunctions.map($or => ({ $or }));
    }

    return mongoFilter;
  }
}
