import type { IUser } from '../../types/user.js';
import {
  RecoveryMethod,
  RecoveryConfig,
  BackupCodeResult,
  SecondaryEmailResult,
  RecoveryVerificationResult,
  RecoveryLockoutResult,
  FailedAttemptResult,
  RecoveryCooldownResult,
  SecurityAnswerValidationResult,
  SecurityQuestionInput,
  SecurityQuestionsSetupResult,
  SecurityQuestionsLockoutResult,
  SecurityQuestionsVerificationResult,
} from '../../utils/recovery.js';

/**
 * Interface for recovery utils service
 * Defines the contract for account recovery operations
 */
export interface IRecoveryUtils {
  /**
   * Generate backup codes for account recovery
   * @returns Backup code generation result
   */
  generateBackupCodes(): Promise<BackupCodeResult>;

  /**
   * Verify backup code using user object (recommended method)
   * @param user - User object containing recovery configuration
   * @param code - Backup code to verify
   * @returns Recovery verification result
   */
  verifyUserBackupCode(
    user: IUser,
    code: string
  ): Promise<RecoveryVerificationResult>;

  /**
   * Verify backup code (low-level method)
   * @param code - Backup code to verify
   * @param storedHashedCodes - Array of stored hashed codes
   * @param expiresAt - Expiration date for the codes
   * @returns Recovery verification result
   */
  verifyBackupCode(
    code: string,
    storedHashedCodes: string[],
    expiresAt: Date
  ): Promise<RecoveryVerificationResult>;

  /**
   * Generate secondary email verification token
   * @param email - Email address to generate token for
   * @returns Secondary email verification result
   */
  generateSecondaryEmailVerification(email: string): SecondaryEmailResult;

  /**
   * Verify secondary email verification token
   * @param token - Token to verify
   * @param storedToken - Stored token to compare against
   * @param expiresAt - Expiration date for the token
   * @returns Recovery verification result
   */
  verifySecondaryEmailToken(
    token: string,
    storedToken: string,
    expiresAt: Date
  ): RecoveryVerificationResult;

  /**
   * Generate SMS verification code
   * @returns SMS verification code and expiration
   */
  generateSmsVerificationCode(): {
    code: string;
    hash: string;
    expiresAt: Date;
  };

  /**
   * Verify SMS verification code
   * @param code - Code to verify
   * @param storedCode - Stored code to compare against
   * @param expiresAt - Expiration date for the code
   * @returns Recovery verification result
   */
  verifySmsCode(
    code: string,
    storedCode: string,
    expiresAt: Date
  ): RecoveryVerificationResult;

  /**
   * Check if user has recovery enabled
   * @param user - User object to check
   * @returns True if recovery is enabled
   */
  isRecoveryEnabled(user: IUser): boolean;

  /**
   * Check if user has backup codes available and not expired
   * @param user - User object to check
   * @returns True if backup codes are available
   */
  hasBackupCodes(user: IUser): boolean;

  /**
   * Check if user has secondary email configured and verified
   * @param user - User object to check
   * @returns True if secondary email is configured and verified
   */
  hasSecondaryEmail(user: IUser): boolean;

  /**
   * Get user's available recovery methods
   * @param user - User object to check
   * @returns Array of available recovery methods
   */
  getAvailableRecoveryMethods(user: IUser): RecoveryMethod[];

  /**
   * Create recovery configuration object
   * @param enabled - Whether recovery is enabled
   * @param methods - Array of recovery methods
   * @param options - Additional configuration options
   * @returns Recovery configuration object
   */
  createRecoveryConfig(
    enabled?: boolean,
    methods?: RecoveryMethod[],
    options?: Partial<RecoveryConfig>
  ): RecoveryConfig;

  /**
   * Create backup codes recovery configuration
   * @param codes - Array of backup codes
   * @returns Recovery configuration with backup codes
   */
  createBackupCodesRecoveryConfig(codes: string[]): RecoveryConfig;

  /**
   * Create secondary email recovery configuration
   * @param email - Email address
   * @param verified - Whether email is verified
   * @returns Recovery configuration with secondary email
   */
  createSecondaryEmailRecoveryConfig(
    email: string,
    verified?: boolean
  ): RecoveryConfig;

  /**
   * Create disabled recovery configuration
   * @returns Disabled recovery configuration
   */
  createDisabledRecoveryConfig(): RecoveryConfig;

  /**
   * Mask email address for display
   * @param email - Email address to mask
   * @returns Masked email address
   */
  maskEmail(email: string): string;

  /**
   * Mask phone number for display
   * @param phoneNumber - Phone number to mask
   * @returns Masked phone number
   */
  maskPhoneNumber(phoneNumber: string): string;

  /**
   * Get recovery configuration from environment/config
   * @returns Recovery configuration from config
   */
  getRecoveryConfig(): {
    enabled: boolean;
    methods: {
      backup_codes: { enabled: boolean; count: number; expiryDays: number };
      secondary_email: { enabled: boolean };
      sms: { enabled: boolean };
      security_questions: { enabled: boolean };
    };
  };

  /**
   * Validate recovery method is supported
   * @param method - Recovery method to validate
   * @returns True if method is supported
   */
  isMethodSupported(method: RecoveryMethod): boolean;

  /**
   * Get available recovery methods based on configuration
   * @returns Array of available recovery methods
   */
  getAvailableMethods(): RecoveryMethod[];

  /**
   * Validate backup code format
   * @param code - Code to validate
   * @returns Validation result with sanitized code
   */
  validateBackupCodeFormat(code: string): {
    valid: boolean;
    sanitized?: string;
    error?: string;
  };

  /**
   * Check if backup codes are expired
   * @param user - User object to check
   * @returns True if backup codes are expired
   */
  areBackupCodesExpired(user: IUser): boolean;

  /**
   * Get remaining backup codes count
   * @param user - User object to check
   * @returns Number of remaining backup codes
   */
  getRemainingBackupCodesCounts(user: IUser): number;

  /**
   * Check if user is locked out from recovery attempts
   * @param user - User object to check
   * @returns Lockout status result
   */
  checkRecoveryLockout(user: IUser): RecoveryLockoutResult;

  /**
   * Record a failed recovery attempt
   * @param user - User object to update (modifies user object in place)
   * @returns Failed attempt result with lockout status
   */
  recordFailedRecoveryAttempt(user: IUser): FailedAttemptResult;

  /**
   * Clear recovery lockout after successful recovery
   * @param user - User object to update (modifies user object in place)
   */
  clearRecoveryLockout(user: IUser): void;

  /**
   * Get lockout configuration
   * @returns Configuration with max attempts and lockout duration
   */
  getLockoutConfig(): { maxAttempts: number; lockoutMinutes: number };

  /**
   * Check if user is in recovery cooldown period
   * During cooldown, password/MFA changes are restricted
   * @param user - User object to check
   * @returns Cooldown status result
   */
  checkRecoveryCooldown(user: IUser): RecoveryCooldownResult;

  /**
   * Check if user is in recovery cooldown period (convenience boolean)
   * @param user - User object to check
   * @returns True if user is in cooldown
   */
  isInRecoveryCooldown(user: IUser): boolean;

  /**
   * Set the last recovered timestamp for a user
   * Call this after successful account recovery
   * @param user - User object to update (modifies user object in place)
   */
  setLastRecoveredAt(user: IUser): void;

  /**
   * Get cooldown configuration
   * @returns Configuration with cooldown duration in hours
   */
  getCooldownConfig(): { cooldownHours: number };

  /**
   * Check if secondary email uses the same domain as primary email
   * @param primaryEmail - User's primary email
   * @param secondaryEmail - Secondary email being added
   * @returns Object with sameDomain flag and optional warning message
   */
  checkSecondaryEmailDomain(
    primaryEmail: string,
    secondaryEmail: string
  ): { sameDomain: boolean; warning?: string };

  // SECURITY QUESTIONS METHODS

  /**
   * Normalize security answer for consistent hashing
   * @param answer - Raw answer to normalize
   * @returns Normalized answer string
   */
  normalizeSecurityAnswer(answer: string): string;

  /**
   * Validate security answer strength
   * @param answer - Answer to validate
   * @returns Validation result with error if invalid
   */
  validateSecurityAnswer(answer: string): SecurityAnswerValidationResult;

  /**
   * Hash a security answer using PBKDF2
   * @param answer - Answer to hash
   * @returns Promise resolving to hash string
   */
  hashSecurityAnswer(answer: string): Promise<string>;

  /**
   * Verify a security answer against stored hash
   * @param providedAnswer - Answer provided by user
   * @param storedHash - Stored hash to verify against
   * @returns Promise resolving to true if answer matches
   */
  verifySecurityAnswer(
    providedAnswer: string,
    storedHash: string
  ): Promise<boolean>;

  /**
   * Setup security questions for a user
   * @param questionsWithAnswers - Array of question keys with their answers
   * @returns Promise resolving to setup result with hashed answers
   */
  setupSecurityQuestions(
    questionsWithAnswers: SecurityQuestionInput[]
  ): Promise<SecurityQuestionsSetupResult>;

  /**
   * Verify all security questions answers
   * @param user - User with security questions configured
   * @param providedAnswers - Map of question ID to provided answer
   * @returns Promise resolving to verification result
   */
  verifySecurityQuestions(
    user: IUser,
    providedAnswers: Map<string, string>
  ): Promise<SecurityQuestionsVerificationResult>;

  /**
   * Check if user has security questions configured
   * @param user - User to check
   * @returns True if security questions are configured
   */
  hasSecurityQuestions(user: IUser): boolean;

  /**
   * Check if user is locked out from security questions attempts
   * @param user - User to check
   * @returns Lockout status with remaining attempts
   */
  checkSecurityQuestionsLockout(user: IUser): SecurityQuestionsLockoutResult;

  /**
   * Record a failed security questions attempt
   * @param user - User object to update (modifies in place)
   * @returns Lockout result after recording the attempt
   */
  recordFailedSecurityQuestionAttempt(
    user: IUser
  ): SecurityQuestionsLockoutResult;

  /**
   * Clear security questions lockout after successful verification
   * @param user - User object to update (modifies in place)
   */
  clearSecurityQuestionsLockout(user: IUser): void;

  /**
   * Get available security question keys for display
   * @returns Array of question keys (e.g., 'q1', 'q2')
   */
  getAvailableQuestionKeys(): string[];

  /**
   * Get security questions configuration
   * @returns Configuration object with limits and available keys
   */
  getSecurityQuestionsConfig(): {
    minAnswerLength: number;
    maxAttempts: number;
    lockoutMinutes: number;
    availableQuestionKeys: string[];
  };
}
