import { DateTimeFormatOptions } from '../../utils/misc.js';
import { type IActivity } from '../../types/activity.js';
import { type IBaseService } from './base-service.interface.js';
import type { ClientDetails } from '../../utils/client-info.js';

export interface ActivityQueryOptions {
  limit?: number;
  page?: number;
  sort?: Record<string, 1 | -1 | 'asc' | 'desc'>;
}

export interface DeviceInfos {
  fingerprint?: string;
  fingerprint_js_id?: string;
  browser?: { name?: string; version?: string };
  os?: { name?: string; version?: string };
  device?: { type?: string; vendor?: string; model?: string };
  language?: string;
  timezone_guess?: string;
  platform?: string;
  screen?: { width?: number; height?: number; pixel_ratio?: number };
  hardware_concurrency?: number;
  memory?: number | null;
  is_new_device?: boolean;
  requires_2fa?: boolean;
  is_suspicious?: boolean;
  confidence_score?: number;
  risk_level?: 'low' | 'medium' | 'high' | 'critical';
  matched_device_id?: string;
  reason?: string;
  geo_location?: {
    country?: string;
    region?: string;
    city?: string;
    latitude?: number;
    longitude?: number;
    timezone?: string;
  };
}

/**
 * Information about the actor performing an activity
 */
export interface ActorInfo {
  id?: string;
  username?: string;
  email?: string;
  full_name?: string;
  given_name?: string;
  family_name?: string;
  role?: string;
  is_admin?: boolean;
  actor_type?: 'user' | 'admin' | 'system' | 'service' | 'anonymous';
}

/**
 * User reference for activity logging
 */
export interface ActivityUser {
  id?: string;
  _id?: string;
  username?: string;
  email?: string;
}

export interface ActivityOptions {
  ip_address?: string;
  user_agent?: string;
  client_id?: string;
  is_private?: boolean;
  related_activity_id?: string;
  device_infos?: DeviceInfos;
  metadata?: Record<string, unknown>;
  actor?: ActorInfo;
  target?: {
    target_type?:
      | 'user'
      | 'session'
      | 'client'
      | 'grant'
      | 'config'
      | 'system'
      | 'none';
    user_id?: string;
    username?: string;
    email?: string;
    full_name?: string;
    given_name?: string;
    family_name?: string;
    entity_id?: string;
    entity_name?: string;
    entity_data?: Record<string, unknown>;
  };
}

export interface LastActivityInfo {
  timestamp: Date;
  type: string;
  description: string;
}

export interface LastActivityInfoFormatted {
  timestamp: Date;
  formattedTimestamp: string;
  type: string;
  description: string;
  relativeTime: string;
}

export interface ActivityStats {
  totalActivities: number;
  uniqueUsers: number;
  todayCount: number;
  successfulLogins: number;
  failedLogins: number;
}

export interface DeleteResult {
  deletedCount: number;
}

/**
 * Filters for querying configuration audit logs
 */
export interface ConfigAuditFilters {
  action?: string; // Specific action type (update_config, reveal_secret, etc.)
  username?: string; // Filter by username
  status?: 'success' | 'failed' | 'warning' | 'info'; // Filter by status
  startDate?: Date; // Filter by date range start
  endDate?: Date; // Filter by date range end
}

/**
 * Interface for ActivityService - handles activity logging and tracking
 */
export interface IActivityService extends IBaseService<IActivity> {
  success(
    type: string,
    description: string,
    user?: ActivityUser | null,
    options?: ActivityOptions
  ): void;

  failed(
    type: string,
    description: string,
    user?: ActivityUser | null,
    options?: ActivityOptions
  ): void;

  info(
    type: string,
    description: string,
    user?: ActivityUser | null,
    options?: ActivityOptions
  ): void;

  warning(
    type: string,
    description: string,
    user?: ActivityUser | null,
    options?: ActivityOptions
  ): void;

  getUserActivities(
    userId: string,
    options?: ActivityQueryOptions
  ): Promise<{
    results: IActivity[];
    totalResults: number;
    totalPages: number;
    page: number;
    limit: number;
  }>;

  queryActivities(
    filter?: Record<string, unknown>,
    options?: ActivityQueryOptions
  ): Promise<{
    results: IActivity[];
    totalResults: number;
    totalPages: number;
    page: number;
    limit: number;
  }>;

  findActivitiesAroundTime(
    username: string,
    targetTime: number,
    timeWindow?: number
  ): Promise<IActivity[]>;

  getUserActivityTypes(username: string): Promise<string[]>;

  getActivityTypes(): Promise<string[]>;

  getActivityStats(): Promise<ActivityStats>;

  getLastActivityDateTime(
    userId?: string,
    username?: string
  ): Promise<Date | null>;

  getLastActivityDateTimeFormatted(
    userId?: string,
    username?: string,
    formatOptions?: DateTimeFormatOptions
  ): Promise<string | null>;

  getLastActivityInfo(
    userId?: string,
    username?: string
  ): Promise<LastActivityInfo | null>;

  getLastActivityInfoFormatted(
    userId?: string,
    username?: string,
    formatOptions?: DateTimeFormatOptions
  ): Promise<LastActivityInfoFormatted | null>;

  formatActivityDateTime(date: Date, options?: DateTimeFormatOptions): string;

  deleteOldActivities(olderThanDays?: number): Promise<DeleteResult>;

  /**
   * Query configuration audit logs with filters
   * Filters for config-related actions: update_config, reveal_secret, rollback_config, test_email, delete_audit_log
   * @param filters - Filters to apply (action, username, status, date range)
   * @param options - Query options (pagination, sorting)
   * @returns Paginated audit log results
   */
  findConfigAuditLogs(
    filters?: ConfigAuditFilters,
    options?: ActivityQueryOptions
  ): Promise<{
    results: IActivity[];
    totalResults: number;
    totalPages: number;
    page: number;
    limit: number;
  }>;

  /**
   * Find activities older than specified number of days
   * @param days - Number of days (default: 90)
   * @returns Array of activities older than the specified days
   */
  findOlderThan(days?: number): Promise<IActivity[]>;

  /**
   * Delete a single audit log with age validation
   * Only allows deletion of logs older than minimum age (for compliance)
   * @param logId - The ID of the log to delete
   * @param minAgeDays - Minimum age in days required for deletion (default: 90)
   * @returns The deleted activity or null if not found/too young
   * @throws Error if log is younger than minimum age
   */
  deleteLog(logId: string, minAgeDays?: number): Promise<IActivity | null>;

  shutdown(): Promise<void>;

  /**
   * Get device history for a user from their login activities
   * Used for device matching to detect new/suspicious devices
   * @param userId - The user ID to get device history for
   * @param limit - Maximum number of unique devices to return (default: 20)
   * @returns Array of ClientDetails from previous successful logins, deduplicated by fingerprint
   */
  getDeviceHistoryForUser(
    userId: string,
    limit?: number
  ): Promise<ClientDetails[]>;

  /**
   * Check if a device fingerprint is trusted for a user
   * @param userId - The user ID to check
   * @param fingerprint - The device fingerprint to check
   * @returns True if the device is trusted and not expired, false otherwise
   */
  isTrustedDevice(userId: string, fingerprint: string): Promise<boolean>;
}
