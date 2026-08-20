/**
 * User Service Interface
 *
 * This interface follows the Interface Segregation Principle by extending
 * focused, single-responsibility interfaces. Components can depend on
 * the specific interface they need rather than the entire IUserService.
 *
 * Segregated interfaces:
 * - IUserLookupService: User find/query operations
 * - IUserProfileService: Profile and avatar management
 * - IUserCredentialsService: Password operations
 * - IUserMfaService: Multi-factor authentication
 * - IUserStatisticsService: User analytics/counts
 * - IUserCustomIdentifierService: Custom identifier management
 * - IUserLifecycleService: Account state transitions
 */

import { type IUser } from '../../types/user.js';
import type { IUserLookupService } from './user/user-lookup-service.interface.js';
import type { IUserProfileService } from './user/user-profile-service.interface.js';
import type { IUserCredentialsService } from './user/user-credentials-service.interface.js';
import type { IUserMfaService } from './user/user-mfa-service.interface.js';
import type { IUserStatisticsService } from './user/user-statistics-service.interface.js';
import type { IUserCustomIdentifierService } from './user/user-custom-identifier-service.interface.js';
import type { IUserLifecycleService } from './user/user-lifecycle-service.interface.js';

// Re-export types from segregated interfaces for backward compatibility
export type {
  ProfileUpdateData,
  NotificationPreferences,
} from './user/user-profile-service.interface.js';
export type {
  PasswordChangeData,
  PasswordValidationResult,
  PasswordPolicy,
} from './user/user-credentials-service.interface.js';
export type { UserStatistics } from './user/user-statistics-service.interface.js';
export type {
  CustomIdentifierFieldConfig,
  CustomIdentifierEditPolicy,
} from './user/user-custom-identifier-service.interface.js';

/**
 * Interface for UserService - handles user-related operations
 *
 * This is a composite interface that combines all user-related
 * functionality. For new code, prefer using the specific interfaces
 * (IUserLookupService, IUserProfileService, etc.) when full functionality
 * is not needed.
 */
export interface IUserService
  extends
    IUserLookupService,
    IUserProfileService,
    IUserCredentialsService,
    IUserMfaService,
    IUserStatisticsService,
    IUserCustomIdentifierService,
    IUserLifecycleService {
  createOne(
    data: Partial<IUser>,
    options?: { ordered?: boolean }
  ): Promise<IUser>;
  createMany(
    data: Partial<IUser>[],
    options?: { ordered?: boolean }
  ): Promise<IUser[]>;
  findOne(
    filter: Record<string, unknown> | string,
    options?: {
      sort?: Record<string, 1 | -1 | 'asc' | 'desc'>;
      skip?: number;
    }
  ): Promise<IUser | null>;
  findMany(
    filter?: Record<string, unknown>,
    options?: {
      sort?: Record<string, 1 | -1 | 'asc' | 'desc'>;
      limit?: number;
      skip?: number;
    }
  ): Promise<IUser[]>;
  updateById(
    id: string,
    data: Partial<IUser>,
    options?: { upsert?: boolean; runValidators?: boolean }
  ): Promise<IUser | null>;
  deleteOne(filter: Record<string, unknown> | string): Promise<IUser | null>;
  findWithPagination(
    filter: Record<string, unknown>,
    options: {
      page: number;
      limit: number;
      sort?: Record<string, 1 | -1 | 'asc' | 'desc'>;
    }
  ): Promise<{
    results: IUser[];
    page: number;
    limit: number;
    totalResults: number;
    totalPages: number;
  }>;
  countDocuments(filter?: Record<string, unknown>): Promise<number>;
}
