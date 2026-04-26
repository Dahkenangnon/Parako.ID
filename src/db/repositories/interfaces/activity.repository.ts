import type { IActivity } from '../../../types/activity.js';
import type {
  IBaseRepository,
  PaginatedResult,
  PaginationOptions,
} from './base.repository.js';

export interface ActivityFilter {
  type?: string | string[];
  status?: 'success' | 'failed' | 'warning' | 'info';
  'actor.user_id'?: string;
  'actor.actor_type'?: string;
  'actor.username'?: string;
  client_id?: string;
  is_private?: boolean;
  timestamp?: { $gte?: Date; $lte?: Date };
  ip_address?: string;
  'device_infos.fingerprint'?: string;
}

export interface CreateActivityDto {
  type: string;
  description: string;
  timestamp?: Date;
  status: 'success' | 'failed' | 'warning' | 'info';
  ip_address?: string;
  user_agent?: string;
  client_id?: string;
  is_private?: boolean;
  related_activity_id?: string;
  actor?: IActivity['actor'];
  target?: IActivity['target'];
  device_infos?: IActivity['device_infos'];
}

export interface IActivityRepository extends Omit<
  IBaseRepository<IActivity, CreateActivityDto>,
  'findOne' | 'update' | 'findMany' | 'count'
> {
  create(data: CreateActivityDto): Promise<IActivity>;
  findById(id: string): Promise<IActivity | null>;
  findMany(
    filter: ActivityFilter,
    opts?: PaginationOptions
  ): Promise<PaginatedResult<IActivity>>;
  findByUser(
    userId: string,
    opts?: PaginationOptions
  ): Promise<PaginatedResult<IActivity>>;
  findByDevice(fingerprint: string): Promise<IActivity[]>;
  count(filter?: ActivityFilter): Promise<number>;
  deleteOlderThan(date: Date): Promise<number>;
  /** Returns distinct activity type strings matching the optional filter. */
  getDistinctTypes(filter?: ActivityFilter): Promise<string[]>;
}
