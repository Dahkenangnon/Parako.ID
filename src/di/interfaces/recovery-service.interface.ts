import type { IUser } from '../../types/user.js';

/**
 * Recovery method types
 */
export type RecoveryMethod =
  | 'backup_codes'
  | 'secondary_email'
  | 'sms'
  | 'security_questions';

/**
 * Recovery attempt status
 */
export type RecoveryStatus = 'pending' | 'completed' | 'failed' | 'expired';

/**
 * Recovery attempt result
 */
export interface RecoveryAttemptResult {
  success: boolean;
  method: RecoveryMethod;
  error?: string;
  userId?: string;
  attemptId?: string;
}

/**
 * Lockout status for recovery attempts
 */
export interface RecoveryLockoutStatus {
  locked: boolean;
  lockedUntil?: Date;
  minutesRemaining?: number;
  failedAttempts: number;
  maxAttempts: number;
  remainingAttempts: number;
}

/**
 * Recovery method availability
 */
export interface RecoveryMethodStatus {
  method: RecoveryMethod;
  available: boolean;
  configured: boolean;
  details?: {
    remainingCodes?: number;
    verified?: boolean;
    expiresAt?: Date;
    lastUsedAt?: Date;
    maskedPhone?: string;
  };
}

/**
 * Recovery initiation result
 */
export interface RecoveryInitiationResult {
  success: boolean;
  attemptId?: string;
  method?: RecoveryMethod;
  error?: string;
  requiresVerification?: boolean;
  verificationSentTo?: string;
}

/**
 * Recovery completion result
 */
export interface RecoveryCompletionResult {
  success: boolean;
  userId?: string;
  method?: RecoveryMethod;
  error?: string;
  remainingCodes?: number;
  requiresPasswordReset?: boolean;
}

/**
 * Device information for recovery logging
 */
export interface RecoveryDeviceInfo {
  ip: string;
  userAgent: string;
  location?: string;
}

/**
 * Interface for RecoveryService - Orchestrates all recovery operations
 *
 * This service coordinates between RecoveryUtils (crypto operations),
 * ActivityService (logging), NotificationService (emails/SMS),
 * and UserService (user updates) to provide a unified recovery API.
 */
export interface IRecoveryService {
  // ===== Recovery Flow =====

  /**
   * Initiate a recovery attempt for a user
   * @param identifier - User identifier (email, phone, or username)
   * @param method - Recovery method to use
   * @param deviceInfo - Device information for logging
   */
  initiateRecovery(
    identifier: string,
    method: RecoveryMethod,
    deviceInfo: RecoveryDeviceInfo
  ): Promise<RecoveryInitiationResult>;

  /**
   * Complete a recovery attempt
   * @param attemptId - Recovery attempt ID
   * @param verification - Verification code or answer
   * @param deviceInfo - Device information for logging
   */
  completeRecovery(
    attemptId: string,
    verification: string,
    deviceInfo: RecoveryDeviceInfo
  ): Promise<RecoveryCompletionResult>;

  /**
   * Verify backup code and consume it
   * @param user - User object
   * @param code - Backup code to verify
   * @param deviceInfo - Device information for logging
   */
  verifyAndConsumeBackupCode(
    user: IUser,
    code: string,
    deviceInfo: RecoveryDeviceInfo
  ): Promise<RecoveryCompletionResult>;

  /**
   * Verify security questions answers
   * @param user - User object
   * @param answers - Map of question ID to answer
   * @param deviceInfo - Device information for logging
   */
  verifySecurityQuestions(
    user: IUser,
    answers: Map<string, string>,
    deviceInfo: RecoveryDeviceInfo
  ): Promise<RecoveryCompletionResult>;

  /**
   * Verify SMS recovery code and consume it
   * @param user - User object
   * @param code - SMS code to verify
   * @param deviceInfo - Device information for logging
   */
  verifyAndConsumeSmsRecoveryCode(
    user: IUser,
    code: string,
    deviceInfo: RecoveryDeviceInfo
  ): Promise<RecoveryCompletionResult>;

  // ===== Recovery Status =====

  /**
   * Get available recovery methods for a user
   * @param userId - User ID
   */
  getAvailableMethods(userId: string): Promise<RecoveryMethodStatus[]>;

  /**
   * Check recovery lockout status for a user
   * @param userId - User ID
   * @param method - Optional specific method to check
   */
  checkLockout(
    userId: string,
    method?: RecoveryMethod
  ): Promise<RecoveryLockoutStatus>;

  /**
   * Check if user is in recovery cooldown period
   * @param userId - User ID
   */
  isInCooldownPeriod(userId: string): Promise<boolean>;

  // ===== Recovery Logging =====

  /**
   * Log a recovery attempt
   * @param userId - User ID
   * @param method - Recovery method used
   * @param success - Whether the attempt succeeded
   * @param deviceInfo - Device information
   * @param metadata - Additional metadata
   */
  logAttempt(
    userId: string,
    method: RecoveryMethod,
    success: boolean,
    deviceInfo: RecoveryDeviceInfo,
    metadata?: Record<string, any>
  ): Promise<void>;

  // ===== Recovery Configuration =====

  /**
   * Generate new backup codes for a user
   * @param userId - User ID
   */
  generateBackupCodes(userId: string): Promise<{
    codes: string[];
    expiresAt: Date;
  }>;

  /**
   * Setup security questions for a user
   * @param userId - User ID
   * @param questionsWithAnswers - Array of question keys and answers
   */
  setupSecurityQuestions(
    userId: string,
    questionsWithAnswers: Array<{ question_key: string; answer: string }>
  ): Promise<{ success: boolean; error?: string }>;

  /**
   * Remove a recovery method for a user
   * @param userId - User ID
   * @param method - Recovery method to remove
   */
  removeRecoveryMethod(
    userId: string,
    method: RecoveryMethod
  ): Promise<{ success: boolean; error?: string }>;

  // ===== Recovery Notifications =====

  /**
   * Send recovery notification to user's primary email
   * @param user - User object
   * @param method - Recovery method used
   * @param deviceInfo - Device information
   */
  sendRecoveryNotification(
    user: IUser,
    method: RecoveryMethod,
    deviceInfo: RecoveryDeviceInfo
  ): Promise<void>;

  /**
   * Send backup code warning if codes are running low
   * @param user - User object
   * @param remainingCodes - Number of remaining codes
   */
  sendBackupCodeWarning(user: IUser, remainingCodes: number): Promise<void>;
}
