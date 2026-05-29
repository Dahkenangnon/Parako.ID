import { type IActivity } from '../models/activity.model.js';
import { injectable, inject } from 'inversify';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type {
  IActivityService,
  ActivityQueryOptions,
  ActivityOptions,
  ConfigAuditFilters,
  DeviceInfos,
  ActivityStats,
  DeleteResult,
  LastActivityInfo,
  LastActivityInfoFormatted,
} from '../di/interfaces/activity-service.interface.js';
import { TYPES } from '../di/types.js';
import {
  DateTimeFormatOptions,
  formatDateTimeForUser,
  getShortRelativeTime,
} from '../utils/misc.js';
import type { ClientDetails } from '../utils/client-info.js';
import {
  encryptValue,
  decryptValue,
  isEncrypted,
} from '../utils/encryption.js';
import type { IActivityRepository } from '../db/repositories/interfaces/activity.repository.js';
import type {
  ActivityFilter,
  CreateActivityDto,
} from '../db/repositories/interfaces/activity.repository.js';
import type {
  BulkWriteResult,
  BulkDeleteResult,
} from '../di/interfaces/base-service.interface.js';
import {
  tenantContext,
  DEFAULT_TENANT_ID,
} from '../multi-tenancy/tenant-context.js';

// ── IBaseService stubs (not used by controllers for ActivityService) ───────────

type PaginatedServiceResult<T> = {
  results: T[];
  page: number;
  limit: number;
  totalResults: number;
  totalPages: number;
};

/** Internal DTO that carries tenant_id captured at queue time. */
type QueuedActivityDto = CreateActivityDto & {
  username?: string;
  _tenant_id: string;
};

@injectable()
export class ActivityService implements IActivityService {
  private activityQueue: QueuedActivityDto[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private processingBatch = false;
  private batchSize = 50;
  private batchDelay = 2000; // 2 seconds
  private readonly MAX_QUEUE_SIZE = 10_000;

  constructor(
    @inject(TYPES.Logger) protected readonly logger: ILogger,
    @inject(TYPES.ActivityRepository)
    private readonly activityRepo: IActivityRepository,
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager
  ) {
    this.startBatchProcessor();
  }

  // ── IBaseService contract (partial — controllers do not call these) ──────────

  async findOne(
    filter: Record<string, unknown> | string
  ): Promise<IActivity | null> {
    if (typeof filter === 'string') return this.activityRepo.findById(filter);
    const id = (filter as any)._id ?? (filter as any).id;
    if (id) return this.activityRepo.findById(String(id));
    const paged = await this.activityRepo.findMany(filter as ActivityFilter, {
      page: 1,
      limit: 1,
    });
    return paged.results[0] ?? null;
  }

  async countDocuments(filter: Record<string, unknown> = {}): Promise<number> {
    return this.activityRepo.count(filter as ActivityFilter);
  }

  async updateById(
    _id: string,
    _data: Partial<IActivity>,
    _options?: any
  ): Promise<IActivity | null> {
    throw new Error('updateById is not supported — activities are append-only');
  }

  async updateMany(
    _filter: Record<string, unknown>,
    _data: Partial<IActivity>,
    _options?: { upsert?: boolean; runValidators?: boolean }
  ): Promise<BulkWriteResult> {
    throw new Error('updateMany is not supported — activities are append-only');
  }

  async deleteMany(
    _filter: Record<string, unknown>
  ): Promise<BulkDeleteResult> {
    throw new Error('Use deleteOldActivities() instead');
  }

  async findMany(
    filter: Record<string, unknown> = {},
    _options: {
      sort?: Record<string, 1 | -1 | 'asc' | 'desc'>;
      limit?: number;
      skip?: number;
    } = {}
  ): Promise<IActivity[]> {
    const result = await this.activityRepo.findMany(filter as ActivityFilter, {
      page: 1,
      limit: 50000,
    });
    return result.results;
  }

  async findWithPagination(
    filter: Record<string, unknown>,
    options: {
      page: number;
      limit: number;
      sort?: Record<string, 1 | -1 | 'asc' | 'desc'>;
    }
  ): Promise<PaginatedServiceResult<IActivity>> {
    const paged = await this.activityRepo.findMany(filter as ActivityFilter, {
      page: options.page,
      limit: options.limit,
      sort: options.sort,
    });
    return {
      results: paged.results,
      page: paged.page,
      limit: paged.limit,
      totalResults: paged.totalResults,
      totalPages: paged.totalPages,
    };
  }

  async createOne(data: Partial<IActivity>): Promise<IActivity> {
    return this.activityRepo.create(data as CreateActivityDto);
  }

  async aggregate(_pipeline: unknown[]): Promise<unknown[]> {
    throw new Error('aggregate is not supported by the repository abstraction');
  }

  async createMany(
    data: Partial<IActivity>[],
    _options?: { ordered?: boolean }
  ): Promise<IActivity[]> {
    return Promise.all(
      data.map(d => this.activityRepo.create(d as CreateActivityDto))
    );
  }

  async deleteOne(
    _filter: Record<string, unknown> | string
  ): Promise<IActivity | null> {
    throw new Error('deleteOne is not supported — activities are append-only');
  }

  // ── Device encryption helpers ────────────────────────────────────────────────

  private isDeviceEncryptionEnabled(): boolean {
    try {
      const config = this.configManager.getConfig();
      return config.security?.protection?.encrypt_device_data ?? false;
    } catch {
      return false;
    }
  }

  private encryptSensitiveDeviceFields(
    deviceInfos: DeviceInfos | undefined
  ): DeviceInfos | undefined {
    if (!deviceInfos || !this.isDeviceEncryptionEnabled()) {
      return deviceInfos;
    }

    try {
      const encrypted = { ...deviceInfos };

      if (encrypted.fingerprint && !isEncrypted(encrypted.fingerprint)) {
        encrypted.fingerprint = encryptValue(encrypted.fingerprint);
      }

      if (
        encrypted.fingerprint_js_id &&
        !isEncrypted(encrypted.fingerprint_js_id)
      ) {
        encrypted.fingerprint_js_id = encryptValue(encrypted.fingerprint_js_id);
      }

      if (
        encrypted.geo_location &&
        typeof encrypted.geo_location === 'object'
      ) {
        const geoString = JSON.stringify(encrypted.geo_location);
        (encrypted as any)._encryptedGeoLocation = encryptValue(geoString);
        delete encrypted.geo_location;
      }

      return encrypted;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'error_encrypting_device_fields',
      });
      return deviceInfos;
    }
  }

  private decryptSensitiveDeviceFields(
    deviceInfos: DeviceInfos | undefined
  ): DeviceInfos | undefined {
    if (!deviceInfos) {
      return deviceInfos;
    }

    try {
      const decrypted = { ...deviceInfos };

      if (decrypted.fingerprint && isEncrypted(decrypted.fingerprint)) {
        decrypted.fingerprint = decryptValue(decrypted.fingerprint);
      }

      if (
        decrypted.fingerprint_js_id &&
        isEncrypted(decrypted.fingerprint_js_id)
      ) {
        decrypted.fingerprint_js_id = decryptValue(decrypted.fingerprint_js_id);
      }

      if ((decrypted as any)._encryptedGeoLocation) {
        const geoString = decryptValue(
          (decrypted as any)._encryptedGeoLocation
        );
        decrypted.geo_location = JSON.parse(geoString);
        delete (decrypted as any)._encryptedGeoLocation;
      }

      return decrypted;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'error_decrypting_device_fields',
      });
      return deviceInfos;
    }
  }

  // ── Batch processing ─────────────────────────────────────────────────────────

  private startBatchProcessor(): void {
    const processBatch = async (): Promise<void> => {
      if (this.activityQueue.length === 0 || this.processingBatch) return;

      this.processingBatch = true;
      const batch = [...this.activityQueue];
      this.activityQueue = [];

      try {
        if (batch.length > 0) {
          await Promise.all(
            batch.map(item =>
              tenantContext.run(item._tenant_id, () =>
                this.activityRepo.create(item)
              )
            )
          );
          this.logger.debug(`Batch processed ${batch.length} activity logs`);
        }
      } catch (error) {
        const err = error as Error;
        this.logger.error(err, {
          context: 'failed_to_process_activity_batch',
          error: err.message,
          count: batch.length,
        });

        const criticalLogs = batch.filter(a =>
          ['login_failed', 'password_changed', 'registration'].includes(
            a.type || ''
          )
        );

        if (criticalLogs.length > 0) {
          this.logger.info(
            `Retrying ${criticalLogs.length} critical logs individually`
          );
          for (const activity of criticalLogs) {
            try {
              await tenantContext.run(activity._tenant_id, () =>
                this.activityRepo.create(activity)
              );
            } catch (innerError) {
              const innerErr = innerError as Error;
              this.logger.error(innerErr, {
                context: 'failed_to_save_critical_activity',
                type: activity.type,
                error: innerErr.message,
              });
            }
          }
        }
      } finally {
        this.processingBatch = false;
      }
    };

    const scheduleBatch = (): void => {
      this.batchTimer = setTimeout(async () => {
        await processBatch();
        scheduleBatch();
      }, this.batchDelay);
    };

    scheduleBatch();
  }

  private async processBatchImmediately(): Promise<void> {
    if (this.processingBatch || this.activityQueue.length === 0) return;

    this.processingBatch = true;
    const batch = [...this.activityQueue];
    this.activityQueue = [];

    try {
      if (batch.length > 0) {
        await Promise.all(
          batch.map(item =>
            tenantContext.run(item._tenant_id, () =>
              this.activityRepo.create(item)
            )
          )
        );
        this.logger.debug(
          `Immediate batch processed ${batch.length} activity logs`
        );
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'failed_to_process_immediate_activity_batch',
        error: err.message,
        count: batch.length,
      });
    } finally {
      this.processingBatch = false;
    }
  }

  // ── Activity logging (fire-and-forget) ───────────────────────────────────────

  public success(
    type: string,
    description: string,
    user?: any,
    options: ActivityOptions = {}
  ): void {
    this.queueActivity({
      type,
      description,
      user,
      status: 'success',
      timestamp: new Date(),
      ...options,
    });
  }

  public failed(
    type: string,
    description: string,
    user?: any,
    options: ActivityOptions = {}
  ): void {
    const { actor, target, ...restOptions } = options;
    this.queueActivity({
      type,
      description,
      user,
      status: 'failed',
      timestamp: new Date(),
      ...restOptions,
      actor,
      target,
    } as any);
  }

  public info(
    type: string,
    description: string,
    user?: any,
    options: ActivityOptions = {}
  ): void {
    const { actor, target, ...restOptions } = options;
    this.queueActivity({
      type,
      description,
      user,
      status: 'info',
      timestamp: new Date(),
      ...restOptions,
      actor,
      target,
    } as any);
  }

  public warning(
    type: string,
    description: string,
    user?: any,
    options: ActivityOptions = {}
  ): void {
    const { actor, target, ...restOptions } = options;
    this.queueActivity({
      type,
      description,
      user,
      status: 'warning',
      timestamp: new Date(),
      ...restOptions,
      actor,
      target,
    } as any);
  }

  private extractUserData(user: any): {
    user_id?: string;
    username?: string;
    email?: string;
    full_name?: string;
    given_name?: string;
    family_name?: string;
  } {
    if (!user) return {};

    const userData: any = {};

    if (user._id) {
      userData.user_id = String(user._id);
    } else if (user.id) {
      userData.user_id = String(user.id);
    }

    if (user.username) {
      userData.username = user.username;
    } else if (user.custom_identifier_1) {
      userData.username = user.custom_identifier_1;
    } else if (user.email) {
      userData.username = user.email.split('@')[0];
    }

    if (user.email) {
      userData.email = user.email;
    }

    if (user.name) {
      userData.full_name = user.name;
    } else if (user.given_name || user.family_name) {
      const parts = [];
      if (user.given_name) parts.push(user.given_name);
      if (user.family_name) parts.push(user.family_name);
      userData.full_name = parts.join(' ');
    }

    if (user.given_name) {
      userData.given_name = user.given_name;
    }
    if (user.family_name) {
      userData.family_name = user.family_name;
    }

    return userData;
  }

  private queueActivity(activityData: any): void {
    try {
      const {
        type,
        description,
        user,
        username,
        ip_address = '0.0.0.0',
        user_agent = 'Unknown',
        status = 'success',
        client_id,
        is_private = false,
        related_activity_id,
        timestamp,
        device_infos,
        actor,
        target,
      } = activityData;

      const encryptedDeviceInfos =
        this.encryptSensitiveDeviceFields(device_infos);

      // Capture tenant_id NOW while ALS context is active.
      // Batch processing runs in setTimeout (outside ALS), so we
      // carry the tenant_id on the DTO for later tenantContext.run().
      const currentTenantId =
        tenantContext.getTenantIdSafe() ?? DEFAULT_TENANT_ID;

      const dto: QueuedActivityDto = {
        type,
        description,
        ip_address,
        status,
        timestamp: timestamp || new Date(),
        user_agent,
        client_id,
        is_private,
        related_activity_id,
        device_infos: encryptedDeviceInfos,
        _tenant_id: currentTenantId,
      };

      // `username` is the older flat DTO shape: callers used to pass
      // the username string directly. The newer shape passes a user
      // object and we derive the username from it. Both paths populate
      // the same field on the persisted activity for query simplicity.
      if (username) {
        dto.username = username;
      } else if (
        user &&
        typeof user === 'object' &&
        user !== null &&
        'username' in user &&
        typeof (user as any).username === 'string'
      ) {
        dto.username = (user as any).username;
      }

      if (actor) {
        dto.actor = {
          ...this.extractUserData(actor),
          actor_type: actor.actor_type || 'user',
        } as IActivity['actor'];
      } else if (user && !actor) {
        dto.actor = {
          ...this.extractUserData(user),
          actor_type: 'user',
        } as IActivity['actor'];
      }

      if (target) {
        dto.target = {
          target_type: target.target_type || 'none',
          ...this.extractUserData(target),
          entity_id: target.entity_id,
          entity_name: target.entity_name,
          entity_data: target.entity_data,
        } as IActivity['target'];
      }

      const criticalEventTypes = [
        'impossible_travel_detected',
        'vpn_detected',
        'high_fraud_score',
        'brute_force_detected',
        'account_lockout',
        'password_reset_success',
        'mfa_disabled',
        'admin_login_success',
        'new_device_verification_failed',
        'suspicious_activity',
      ];

      const isCritical = criticalEventTypes.includes(type);

      if (isCritical) {
        tenantContext
          .run(currentTenantId, () => this.activityRepo.create(dto))
          .then(() => {
            this.logger.debug('Critical security event logged immediately', {
              type,
              username: dto.username,
            });
          })
          .catch((err: Error) => {
            this.logger.error(err, {
              context: 'error_logging_critical_event',
              type,
            });
          });
      } else {
        if (this.activityQueue.length >= this.MAX_QUEUE_SIZE) {
          this.logger.warn('Activity queue full, dropping event', {
            type,
            queueSize: this.activityQueue.length,
          });
        } else {
          this.activityQueue.push(dto);

          if (
            this.activityQueue.length >= this.batchSize &&
            !this.processingBatch
          ) {
            this.processBatchImmediately();
          }
        }
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_queuing_activity',
        error: err.message,
        type: activityData?.type,
      });
    }
  }

  // ── Public query methods ─────────────────────────────────────────────────────

  public async getUserActivities(
    userId: string,
    options: ActivityQueryOptions = { limit: 20, page: 1 }
  ): Promise<{
    results: IActivity[];
    totalResults: number;
    totalPages: number;
    page: number;
    limit: number;
  }> {
    try {
      this.logger.info('Getting user activities', { userId });
      const result = await this.activityRepo.findByUser(userId, {
        page: options.page || 1,
        limit: options.limit || 20,
        sort: options.sort || { timestamp: -1 },
      });
      return {
        results: result.results,
        totalResults: result.totalResults,
        totalPages: result.totalPages,
        page: result.page,
        limit: result.limit,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_getting_user_activities',
        userId,
        error: err.message,
      });
      throw error;
    }
  }

  public async queryActivities(
    filter: Record<string, unknown> = {},
    options: ActivityQueryOptions = { limit: 20, page: 1 }
  ): Promise<{
    results: IActivity[];
    totalResults: number;
    totalPages: number;
    page: number;
    limit: number;
  }> {
    try {
      const result = await this.activityRepo.findMany(
        filter as ActivityFilter,
        {
          page: options.page || 1,
          limit: options.limit || 20,
          sort: options.sort || { timestamp: -1 },
        }
      );
      return {
        results: result.results,
        totalResults: result.totalResults,
        totalPages: result.totalPages,
        page: result.page,
        limit: result.limit,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_querying_activities',
        filter,
      });
      return {
        results: [],
        totalResults: 0,
        totalPages: 0,
        page: options.page || 1,
        limit: options.limit || 20,
      };
    }
  }

  public async findActivitiesAroundTime(
    username: string,
    targetTime: number,
    timeWindow: number = 300
  ): Promise<IActivity[]> {
    try {
      const startTime = new Date((targetTime - timeWindow) * 1000);
      const endTime = new Date((targetTime + timeWindow) * 1000);

      const result = await this.activityRepo.findMany(
        {
          'actor.username': username,
          timestamp: { $gte: startTime, $lte: endTime },
        } as any,
        { page: 1, limit: 100, sort: { timestamp: -1 } }
      );

      return result.results;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_finding_activities_around_time',
        username,
        targetTime,
        timeWindow,
        error: err.message,
      });
      return [];
    }
  }

  public async getUserActivityTypes(username: string): Promise<string[]> {
    try {
      return await this.activityRepo.getDistinctTypes({
        'actor.username': username,
      } as any);
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_getting_user_activity_types',
        username,
        error: err.message,
      });
      return [];
    }
  }

  public async getActivityTypes(): Promise<string[]> {
    try {
      return await this.activityRepo.getDistinctTypes();
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_getting_activity_types',
      });
      return [];
    }
  }

  public async getActivityStats(): Promise<ActivityStats> {
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const [totalActivities, todayCount, successfulLogins, failedLogins] =
        await Promise.all([
          this.activityRepo.count({}),
          this.activityRepo.count({
            timestamp: { $gte: todayStart },
          }),
          this.activityRepo.count({ type: 'login_success' }),
          this.activityRepo.count({ type: 'login_failed' }),
        ]);

      // Approximate uniqueUsers via distinct actor.user_id — use getDistinctTypes
      // pattern but for userIds; for now return 0 as estimation
      const uniqueUsers = 0;

      return {
        totalActivities,
        uniqueUsers,
        todayCount,
        successfulLogins,
        failedLogins,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_getting_activity_stats',
      });
      return {
        totalActivities: 0,
        uniqueUsers: 0,
        todayCount: 0,
        successfulLogins: 0,
        failedLogins: 0,
      };
    }
  }

  public async getLastActivityDateTime(
    userId?: string,
    username?: string
  ): Promise<Date | null> {
    try {
      if (!userId && !username) {
        throw new Error('Either userId or username must be provided');
      }

      const filter: ActivityFilter = {};
      if (userId) {
        filter['actor.user_id'] = userId;
      } else if (username) {
        (filter as any)['actor.username'] = username;
      }

      const result = await this.activityRepo.findMany(filter, {
        page: 1,
        limit: 1,
        sort: { timestamp: -1 },
      });

      return result.results[0]?.timestamp ?? null;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_getting_last_activity_datetime',
        userId,
        username,
        error: err.message,
      });
      return null;
    }
  }

  public async getLastActivityDateTimeFormatted(
    userId?: string,
    username?: string,
    formatOptions: DateTimeFormatOptions = {}
  ): Promise<string | null> {
    try {
      const lastActivity = await this.getLastActivityDateTime(userId, username);
      if (!lastActivity) return null;
      return this.formatActivityDateTime(lastActivity, formatOptions);
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_getting_last_activity_datetime_formatted',
        userId,
        username,
        error: err.message,
      });
      return null;
    }
  }

  public async getLastActivityInfo(
    userId?: string,
    username?: string
  ): Promise<LastActivityInfo | null> {
    try {
      if (!userId && !username) {
        throw new Error('Either userId or username must be provided');
      }

      const filter: ActivityFilter = {};
      if (userId) {
        filter['actor.user_id'] = userId;
      } else if (username) {
        (filter as any)['actor.username'] = username;
      }

      const result = await this.activityRepo.findMany(filter, {
        page: 1,
        limit: 1,
        sort: { timestamp: -1 },
      });

      const last = result.results[0];
      if (!last) return null;

      return {
        timestamp: last.timestamp,
        type: last.type,
        description: last.description,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_getting_last_activity_info',
        userId,
        username,
        error: err.message,
      });
      return null;
    }
  }

  public async getLastActivityInfoFormatted(
    userId?: string,
    username?: string,
    formatOptions: DateTimeFormatOptions = {}
  ): Promise<LastActivityInfoFormatted | null> {
    try {
      const info = await this.getLastActivityInfo(userId, username);
      if (!info) return null;

      return {
        timestamp: info.timestamp,
        formattedTimestamp: this.formatActivityDateTime(
          info.timestamp,
          formatOptions
        ),
        type: info.type,
        description: info.description,
        relativeTime: this.getShortRelativeTimeHelper(
          info.timestamp,
          formatOptions
        ),
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_getting_last_activity_info_formatted',
        userId,
        username,
        error: err.message,
      });
      return null;
    }
  }

  private getShortRelativeTimeHelper(
    date: Date,
    options: DateTimeFormatOptions = {}
  ): string {
    try {
      return getShortRelativeTime(date, { language: options.language });
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_getting_short_relative_time',
        date: date?.toISOString(),
        error: err.message,
      });
      return 'unknown';
    }
  }

  public formatActivityDateTime(
    date: Date,
    options: DateTimeFormatOptions = {}
  ): string {
    try {
      return formatDateTimeForUser(date, options);
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_formatting_datetime_for_user',
        date: date?.toISOString(),
        error: err.message,
      });
      return date.toLocaleDateString(
        options.language === 'fr' ? 'fr-FR' : 'en-US',
        {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        }
      );
    }
  }

  public async deleteOldActivities(olderThanDays = 90): Promise<DeleteResult> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      this.logger.info('Deleting old activities', { olderThanDays });

      const deletedCount = await this.activityRepo.deleteOlderThan(cutoffDate);

      return { deletedCount };
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_deleting_old_activities',
        olderThanDays,
        error: err.message,
      });
      throw error;
    }
  }

  public async findConfigAuditLogs(
    filters: ConfigAuditFilters = {},
    options: ActivityQueryOptions = { limit: 20, page: 1 }
  ): Promise<{
    results: IActivity[];
    totalResults: number;
    totalPages: number;
    page: number;
    limit: number;
  }> {
    try {
      const configActionTypes = [
        'update_config',
        'reveal_secret',
        'rollback_config',
        'test_email',
        'delete_audit_log',
      ];

      const repoFilter: ActivityFilter = {};

      if (filters.action) {
        repoFilter.type = filters.action;
      } else {
        repoFilter.type = configActionTypes;
      }

      if (filters.username) {
        (repoFilter as any)['actor.username'] = filters.username;
      }

      if (filters.status) {
        repoFilter.status = filters.status;
      }

      if (filters.startDate || filters.endDate) {
        repoFilter.timestamp = {};
        if (filters.startDate) {
          repoFilter.timestamp.$gte = filters.startDate;
        }
        if (filters.endDate) {
          const endDate = new Date(filters.endDate);
          endDate.setHours(23, 59, 59, 999);
          repoFilter.timestamp.$lte = endDate;
        }
      }

      this.logger.debug('Querying config audit logs', { filters, options });

      return await this.queryActivities(repoFilter as Record<string, unknown>, {
        ...options,
        sort: options.sort || { timestamp: -1 },
      });
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_finding_config_audit_logs',
        filters,
        error: err.message,
      });
      return {
        results: [],
        totalResults: 0,
        totalPages: 0,
        page: options.page || 1,
        limit: options.limit || 20,
      };
    }
  }

  public async findOlderThan(days = 90): Promise<IActivity[]> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      this.logger.debug('Finding activities older than days', {
        days,
        cutoffDate: cutoffDate.toISOString(),
      });

      const result = await this.activityRepo.findMany(
        { timestamp: { $lte: cutoffDate } },
        { page: 1, limit: 50000, sort: { timestamp: -1 } }
      );

      return result.results;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_finding_activities_older_than',
        days,
        error: err.message,
      });
      return [];
    }
  }

  public async deleteLog(
    logId: string,
    minAgeDays = 90
  ): Promise<IActivity | null> {
    try {
      this.logger.info('Attempting to delete audit log', {
        logId,
        minAgeDays,
      });

      const log = await this.activityRepo.findById(logId);

      if (!log) {
        this.logger.warn('Log not found for deletion', { logId });
        return null;
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - minAgeDays);

      if (log.timestamp > cutoffDate) {
        const logAgeDays = Math.floor(
          (Date.now() - log.timestamp.getTime()) / (24 * 60 * 60 * 1000)
        );

        this.logger.warn('Log too young for deletion', {
          logId,
          logAgeDays,
          minAgeDays,
        });

        throw new Error(
          `Cannot delete log: it is only ${logAgeDays} days old. Minimum age for deletion is ${minAgeDays} days.`
        );
      }

      await this.activityRepo.delete(logId);

      this.logger.info('Audit log deleted successfully', { logId });

      return log;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_deleting_audit_log',
        logId,
        minAgeDays,
        error: err.message,
      });
      throw error;
    }
  }

  public async getDeviceHistoryForUser(
    userId: string,
    limit = 20
  ): Promise<ClientDetails[]> {
    try {
      this.logger.debug('Getting device history for user', { userId, limit });

      const loginSuccessTypes = [
        'login_success',
        'oidc.login.success',
        'social_login_success',
      ];

      const result = await this.activityRepo.findMany(
        {
          'actor.user_id': userId,
          type: loginSuccessTypes,
          status: 'success',
        },
        { page: 1, limit: limit * 3, sort: { timestamp: -1 } }
      );

      const activities = result.results.filter(
        a => a.device_infos?.fingerprint && a.device_infos.fingerprint !== ''
      );

      if (activities.length === 0) {
        this.logger.debug('No device history found for user', { userId });
        return [];
      }

      const seenFingerprints = new Set<string>();
      const uniqueDevices: ClientDetails[] = [];

      for (const activity of activities) {
        const deviceInfos = this.decryptSensitiveDeviceFields(
          activity.device_infos
        );
        if (!deviceInfos?.fingerprint) continue;

        if (seenFingerprints.has(deviceInfos.fingerprint)) continue;
        seenFingerprints.add(deviceInfos.fingerprint);

        uniqueDevices.push({
          ip: activity.ip_address || 'unknown',
          user_agent: activity.user_agent || deviceInfos.platform || 'Unknown',
          browser: {
            name: deviceInfos.browser?.name,
            version: deviceInfos.browser?.version,
          },
          os: {
            name: deviceInfos.os?.name,
            version: deviceInfos.os?.version,
          },
          device: {
            type: deviceInfos.device?.type,
            vendor: deviceInfos.device?.vendor,
            model: deviceInfos.device?.model,
          },
          language: deviceInfos.language,
          timezone_guess: deviceInfos.timezone_guess,
          fingerprint: deviceInfos.fingerprint,
          fingerprint_js_id: deviceInfos.fingerprint_js_id,
        });

        if (uniqueDevices.length >= limit) break;
      }

      this.logger.debug('Device history retrieved', {
        userId,
        totalActivities: activities.length,
        uniqueDevices: uniqueDevices.length,
      });

      return uniqueDevices;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_getting_device_history_for_user',
        userId,
        error: err.message,
      });
      return [];
    }
  }

  public async isTrustedDevice(
    userId: string,
    fingerprint: string
  ): Promise<boolean> {
    try {
      if (!fingerprint) {
        return false;
      }

      this.logger.debug('Checking if device is trusted', {
        userId,
        fingerprint: `${fingerprint.substring(0, 8)}...`,
      });

      const now = new Date();

      const result = await this.activityRepo.findMany(
        {
          'actor.user_id': userId,
          'device_infos.fingerprint': fingerprint,
        },
        { page: 1, limit: 50, sort: { timestamp: -1 } }
      );

      const isTrusted = result.results.some(activity => {
        const trust = activity.device_infos?.device_trust;
        return (
          trust?.trusted === true &&
          trust?.fingerprint === fingerprint &&
          trust?.trusted_until instanceof Date &&
          trust.trusted_until > now
        );
      });

      this.logger.debug('Device trust check result', {
        userId,
        fingerprint: `${fingerprint.substring(0, 8)}...`,
        isTrusted,
      });

      return isTrusted;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_checking_trusted_device',
        userId,
        error: err.message,
      });
      return false;
    }
  }

  public async shutdown(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.activityQueue.length > 0) {
      try {
        this.logger.info(
          `Flushing ${this.activityQueue.length} pending activity logs on shutdown`
        );
        await Promise.all(
          this.activityQueue.map(item =>
            tenantContext.run(item._tenant_id, () =>
              this.activityRepo.create(item)
            )
          )
        );
      } catch (error) {
        const err = error as Error;
        this.logger.error(err, {
          context: 'error_flushing_activity_logs_on_shutdown',
        });
      }
      this.activityQueue = [];
    }
  }
}
