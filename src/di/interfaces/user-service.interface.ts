/**
 * User Service Interface
 *
 * This interface follows the Interface Segregation Principle by extending
 * focused, single-responsibility interfaces. Components can depend on
 * the specific interface they need rather than the entire IUserService.
 *
 * Segregated interfaces:
 * - IUserRepository: User find/query operations
 * - IUserProfileService: Profile and avatar management
 * - IUserCredentialsService: Password operations
 * - IUserMfaService: Multi-factor authentication
 * - IUserStatisticsService: User analytics/counts
 * - IUserCustomIdentifierService: Custom identifier management
 * - IUserLifecycleService: Account state transitions
 */

import { type IUser } from '../../types/user.js';
import { type IBaseService } from './base-service.interface.js';
import type { IUserRepository } from './user/user-repository.interface.js';
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
 * (IUserRepository, IUserProfileService, etc.) when full functionality
 * is not needed.
 */
export interface IUserService
  extends
    IBaseService<IUser>,
    IUserRepository,
    IUserProfileService,
    IUserCredentialsService,
    IUserMfaService,
    IUserStatisticsService,
    IUserCustomIdentifierService,
    IUserLifecycleService {}
