/**
 * User service interfaces following Interface Segregation Principle
 *
 * These interfaces break down the large IUserService into focused,
 * single-responsibility interfaces. The main IUserService extends
 * all of these for backward compatibility.
 */

export type { IUserRepository } from './user-repository.interface.js';
export type {
  IUserProfileService,
  ProfileUpdateData,
  NotificationPreferences,
} from './user-profile-service.interface.js';
export type {
  IUserCredentialsService,
  PasswordChangeData,
  PasswordValidationResult,
  PasswordPolicy,
} from './user-credentials-service.interface.js';
export type { IUserMfaService } from './user-mfa-service.interface.js';
export type {
  IUserStatisticsService,
  UserStatistics,
} from './user-statistics-service.interface.js';
export type {
  IUserCustomIdentifierService,
  CustomIdentifierFieldConfig,
  CustomIdentifierEditPolicy,
} from './user-custom-identifier-service.interface.js';
export type { IUserLifecycleService } from './user-lifecycle-service.interface.js';
