import crypto from 'node:crypto';
import { injectable, inject } from 'inversify';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { IPasswordUtils } from '../di/interfaces/password-utils.interface.js';
import { IRecoveryUtils } from '../di/interfaces/recovery-utils.interface.js';
import { TYPES } from '../di/types.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import { type IUser } from '../types/user.js';

/**
 * Recovery method types supported by the system
 */
export type RecoveryMethod =
  | 'backup_codes'
  | 'secondary_email'
  | 'sms'
  | 'security_questions';

/**
 * Recovery configuration interface
 */
export interface RecoveryConfig {
  enabled: boolean;
  methods: RecoveryMethod[];
  backup_codes?: {
    codes: string[];
    generated_at: Date;
    expires_at: Date;
  };
  secondary_email?: {
    email: string;
    verified: boolean;
    verification_token?: string;
    verification_expires?: Date;
  };
  sms?: {
    phone_number: string;
    verified: boolean;
    verification_code?: string;
    verification_expires?: Date;
  };
  security_questions?: {
    questions: Array<{
      id: string;
      question_key: string; // i18n key (e.g., 'q1', 'q2') from security-questions namespace
      answer_hash: string;
    }>;
    setup_at?: Date;
    last_used_at?: Date;
    failed_attempts?: number;
    last_failed_at?: Date;
    locked_until?: Date;
  };
}

/**
 * Backup code generation result
 */
export interface BackupCodeResult {
  codes: string[]; // Plain codes for one-time display
  hashedCodes: string[]; // Hashed codes for database storage
  generatedAt: Date;
  expiresAt: Date;
}

/**
 * Secondary email verification result
 */
export interface SecondaryEmailResult {
  email: string;
  verificationToken: string;
  tokenHash: string;
  expiresAt: Date;
}

/**
 * Recovery verification result
 */
export interface RecoveryVerificationResult {
  valid: boolean;
  method: RecoveryMethod;
  error?: string;
  matchedCode?: string; // The hashed code that matched (for removal)
}

/**
 * Recovery lockout check result
 */
export interface RecoveryLockoutResult {
  locked: boolean;
  failedAttempts?: number;
  remainingAttempts?: number;
  lockedUntil?: Date;
  minutesRemaining?: number;
}

/**
 * Failed recovery attempt result
 */
export interface FailedAttemptResult {
  locked: boolean;
  failedAttempts: number;
  lockedUntil?: Date;
}

/**
 * Recovery cooldown check result
 */
export interface RecoveryCooldownResult {
  inCooldown: boolean;
  cooldownEndsAt?: Date;
  hoursRemaining?: number;
}

/**
 * Security question answer validation result
 */
export interface SecurityAnswerValidationResult {
  valid: boolean;
  error?: string;
  normalized?: string;
}

/**
 * Security questions setup input
 */
export interface SecurityQuestionInput {
  question_key: string; // i18n key (e.g., 'q1', 'q2')
  answer: string;
}

/**
 * Security questions setup result
 */
export interface SecurityQuestionsSetupResult {
  valid: boolean;
  error?: string;
  questions?: Array<{
    id: string;
    question_key: string;
    answer_hash: string;
  }>;
  setup_at?: Date;
}

/**
 * Security questions lockout result
 */
export interface SecurityQuestionsLockoutResult {
  locked: boolean;
  failedAttempts?: number;
  remainingAttempts?: number;
  lockedUntil?: Date;
  minutesRemaining?: number;
}

/**
 * Security questions verification result
 */
export interface SecurityQuestionsVerificationResult {
  valid: boolean;
  error?: string;
  allCorrect?: boolean;
  incorrectCount?: number;
}

/**
 * Centralized Recovery utility class
 * Contains all common recovery logic used across the application
 */
@injectable()
export class RecoveryUtils implements IRecoveryUtils {
  private static readonly HASH_ALGORITHM = 'sha256';
  private static readonly BACKUP_CODE_LENGTH = 8;
  private static readonly BACKUP_CODE_COUNT = 10;
  private static readonly BACKUP_CODE_EXPIRY_DAYS = 365; // 1 year
  private static readonly VERIFICATION_TOKEN_LENGTH = 32;
  private static readonly VERIFICATION_TOKEN_EXPIRY_HOURS = 24;
  private static readonly VERIFICATION_CODE_LENGTH = 6;
  private static readonly VERIFICATION_CODE_EXPIRY_MINUTES = 15;
  private static readonly MAX_RECOVERY_ATTEMPTS = 5;
  private static readonly LOCKOUT_DURATION_MINUTES = 30;
  private static readonly RECOVERY_COOLDOWN_HOURS = 24;
  // Security questions constants
  private static readonly SECURITY_QUESTIONS_MIN_ANSWER_LENGTH = 3;
  private static readonly SECURITY_QUESTIONS_MAX_ANSWER_LENGTH = 200;
  private static readonly SECURITY_QUESTIONS_MAX_ATTEMPTS = 3;
  private static readonly SECURITY_QUESTIONS_LOCKOUT_MINUTES = 15;
  private static readonly AVAILABLE_QUESTION_KEYS = [
    'q1',
    'q2',
    'q3',
    'q4',
    'q5',
    'q6',
    'q7',
    'q8',
    'q9',
    'q10',
  ];

  /**
   * Injected dependencies
   */
  private configManager: IConfigManager;
  private passwordUtils: IPasswordUtils;
  private logger: ILogger;

  /**
   * Constructor with dependency injection
   * @param configManager - Configuration manager instance
   * @param passwordUtils - Password utilities instance
   */
  constructor(
    @inject(TYPES.ConfigManager) configManager: IConfigManager,
    @inject(TYPES.PasswordUtils) passwordUtils: IPasswordUtils,
    @inject(TYPES.Logger) logger: ILogger
  ) {
    this.configManager = configManager;
    this.passwordUtils = passwordUtils;
    this.logger = logger;
  }

  /**
   * Generate backup codes for account recovery
   */
  async generateBackupCodes(): Promise<BackupCodeResult> {
    try {
      const codes: string[] = [];
      const hashedCodes: string[] = [];
      const generatedAt = new Date();
      const expiresAt = new Date(
        generatedAt.getTime() +
          RecoveryUtils.BACKUP_CODE_EXPIRY_DAYS * 24 * 60 * 60 * 1000
      );

      for (let i = 0; i < RecoveryUtils.BACKUP_CODE_COUNT; i++) {
        const code = crypto
          .randomBytes(RecoveryUtils.BACKUP_CODE_LENGTH / 2)
          .toString('hex')
          .toUpperCase();
        const formattedCode = `${code.substring(0, 4)}-${code.substring(4, 8)}`;

        codes.push(formattedCode);

        const hashedCode = await this.passwordUtils.hashPassword(formattedCode);
        hashedCodes.push(hashedCode);
      }

      return {
        codes,
        hashedCodes,
        generatedAt,
        expiresAt,
      };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'backup_codes_generation_failed',
      });
      throw new Error('Failed to generate backup codes');
    }
  }

  /**
   * Verify backup code using user object (recommended method)
   */
  async verifyUserBackupCode(
    user: IUser,
    code: string
  ): Promise<RecoveryVerificationResult> {
    try {
      if (!user || !user.recovery?.backup_codes) {
        return {
          valid: false,
          method: 'backup_codes',
          error: 'No backup codes configured for this account',
        };
      }

      if (this.areBackupCodesExpired(user)) {
        return {
          valid: false,
          method: 'backup_codes',
          error: 'Backup codes have expired',
        };
      }

      // Use the existing verification method
      return await this.verifyBackupCode(
        code,
        user.recovery.backup_codes.codes,
        user.recovery.backup_codes.expires_at
      );
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'user_backup_code_verification_error',
        userId: user?._id,
        hasBackupCodes: !!user?.recovery?.backup_codes,
      });
      return {
        valid: false,
        method: 'backup_codes',
        error: 'Backup code verification failed',
      };
    }
  }

  /**
   * Verify backup code (low-level method)
   */
  async verifyBackupCode(
    code: string,
    storedHashedCodes: string[],
    expiresAt: Date
  ): Promise<RecoveryVerificationResult> {
    try {
      if (!code || typeof code !== 'string') {
        return {
          valid: false,
          method: 'backup_codes',
          error: 'Backup code is required',
        };
      }

      if (
        !storedHashedCodes ||
        !Array.isArray(storedHashedCodes) ||
        storedHashedCodes.length === 0
      ) {
        return {
          valid: false,
          method: 'backup_codes',
          error: 'No backup codes available',
        };
      }

      if (!expiresAt || !(expiresAt instanceof Date)) {
        return {
          valid: false,
          method: 'backup_codes',
          error: 'Invalid expiration date',
        };
      }

      if (expiresAt < new Date()) {
        return {
          valid: false,
          method: 'backup_codes',
          error: 'Backup codes have expired',
        };
      }

      const formatValidation = this.validateBackupCodeFormat(code);
      if (!formatValidation.valid) {
        return {
          valid: false,
          method: 'backup_codes',
          error: formatValidation.error || 'Invalid backup code format',
        };
      }

      const sanitizedCode = formatValidation.sanitized!;
      const formattedCode = `${sanitizedCode.substring(0, 4)}-${sanitizedCode.substring(4, 8)}`;

      let valid = false;
      let matchedCode: string | undefined;

      for (const storedHash of storedHashedCodes) {
        if (!storedHash || typeof storedHash !== 'string') {
          continue; // Skip invalid hashes
        }

        const verification = await this.passwordUtils.verifyPassword(
          formattedCode,
          storedHash
        );
        if (verification.valid && !valid) {
          valid = true;
          matchedCode = storedHash; // Return the matched hashed code for removal
        }
      }

      return {
        valid,
        method: 'backup_codes',
        error: valid ? undefined : 'Invalid backup code',
        matchedCode,
      };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'backup_code_verification_error',
        codeProvided: !!code,
        codesCount: storedHashedCodes?.length || 0,
      });
      return {
        valid: false,
        method: 'backup_codes',
        error: 'Backup code verification failed',
      };
    }
  }

  /**
   * Generate secondary email verification token
   */
  generateSecondaryEmailVerification(email: string): SecondaryEmailResult {
    try {
      if (!email || typeof email !== 'string') {
        throw new Error('Email address is required');
      }

      const trimmedEmail = email.toLowerCase().trim();

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedEmail)) {
        throw new Error('Valid email address is required');
      }

      const verificationToken = crypto
        .randomBytes(RecoveryUtils.VERIFICATION_TOKEN_LENGTH)
        .toString('hex');
      const tokenHash = crypto
        .createHash('sha256')
        .update(verificationToken)
        .digest('hex');
      const expiresAt = new Date(
        Date.now() +
          RecoveryUtils.VERIFICATION_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000
      );

      return {
        email: trimmedEmail,
        verificationToken,
        tokenHash,
        expiresAt,
      };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'secondary_email_verification_generation_failed',
        email: email || 'undefined',
      });
      throw new Error('Failed to generate secondary email verification');
    }
  }

  /**
   * Verify secondary email verification token
   */
  verifySecondaryEmailToken(
    token: string,
    storedToken: string,
    expiresAt: Date
  ): RecoveryVerificationResult {
    try {
      if (!token || typeof token !== 'string') {
        return {
          valid: false,
          method: 'secondary_email',
          error: 'Verification token is required',
        };
      }

      if (!storedToken || typeof storedToken !== 'string') {
        return {
          valid: false,
          method: 'secondary_email',
          error: 'Invalid stored token',
        };
      }

      if (!expiresAt || !(expiresAt instanceof Date)) {
        return {
          valid: false,
          method: 'secondary_email',
          error: 'Invalid expiration date',
        };
      }

      if (expiresAt < new Date()) {
        return {
          valid: false,
          method: 'secondary_email',
          error: 'Verification token has expired',
        };
      }

      // Hash the input token with SHA-256 to compare against stored hash
      const inputHash = crypto
        .createHash('sha256')
        .update(token.trim())
        .digest('hex');

      // Constant-time comparison to prevent timing attacks
      const valid =
        inputHash.length === storedToken.length &&
        crypto.timingSafeEqual(
          Buffer.from(inputHash, 'utf8'),
          Buffer.from(storedToken, 'utf8')
        );

      return {
        valid,
        method: 'secondary_email',
        error: valid ? undefined : 'Invalid verification token',
      };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'secondary_email_verification_error',
        tokenProvided: !!token,
        storedTokenProvided: !!storedToken,
      });
      return {
        valid: false,
        method: 'secondary_email',
        error: 'Secondary email verification failed',
      };
    }
  }

  /**
   * Generate SMS verification code
   */
  generateSmsVerificationCode(): {
    code: string;
    hash: string;
    expiresAt: Date;
  } {
    try {
      // crypto.randomInt(min, max) generates in range [min, max)
      const minValue = Math.pow(10, RecoveryUtils.VERIFICATION_CODE_LENGTH - 1); // 100000
      const maxValue = Math.pow(10, RecoveryUtils.VERIFICATION_CODE_LENGTH); // 1000000 (exclusive)
      const code = crypto.randomInt(minValue, maxValue).toString();

      const hash = crypto.createHash('sha256').update(code).digest('hex');

      const expiresAt = new Date(
        Date.now() + RecoveryUtils.VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000
      );

      return { code, hash, expiresAt };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'sms_verification_code_generation_failed',
      });
      throw new Error('Failed to generate SMS verification code');
    }
  }

  /**
   * Verify SMS verification code
   */
  verifySmsCode(
    code: string,
    storedCode: string,
    expiresAt: Date
  ): RecoveryVerificationResult {
    try {
      if (!code || typeof code !== 'string') {
        return {
          valid: false,
          method: 'sms',
          error: 'Verification code is required',
        };
      }

      if (!storedCode || typeof storedCode !== 'string') {
        return {
          valid: false,
          method: 'sms',
          error: 'Invalid stored code',
        };
      }

      if (!expiresAt || !(expiresAt instanceof Date)) {
        return {
          valid: false,
          method: 'sms',
          error: 'Invalid expiration date',
        };
      }

      if (expiresAt < new Date()) {
        return {
          valid: false,
          method: 'sms',
          error: 'Verification code has expired',
        };
      }

      const sanitizedCode = code.replace(/\s+/g, '');

      if (
        !new RegExp(`^\\d{${RecoveryUtils.VERIFICATION_CODE_LENGTH}}$`).test(
          sanitizedCode
        )
      ) {
        return {
          valid: false,
          method: 'sms',
          error: `Code must be exactly ${RecoveryUtils.VERIFICATION_CODE_LENGTH} digits`,
        };
      }

      // Hash the input code with SHA-256 to compare against stored hash
      const inputHash = crypto
        .createHash('sha256')
        .update(sanitizedCode)
        .digest('hex');

      // Constant-time comparison to prevent timing attacks
      const valid =
        inputHash.length === storedCode.length &&
        crypto.timingSafeEqual(
          Buffer.from(inputHash, 'utf8'),
          Buffer.from(storedCode, 'utf8')
        );

      return {
        valid,
        method: 'sms',
        error: valid ? undefined : 'Invalid verification code',
      };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'sms_verification_error',
        codeProvided: !!code,
        storedCodeProvided: !!storedCode,
      });
      return {
        valid: false,
        method: 'sms',
        error: 'SMS verification failed',
      };
    }
  }

  /**
   * Check if user has recovery enabled
   */
  isRecoveryEnabled(user: IUser): boolean {
    return Boolean(user.recovery?.enabled);
  }

  /**
   * Check if user has backup codes available and not expired
   */
  hasBackupCodes(user: IUser): boolean {
    return Boolean(
      user?.recovery?.enabled &&
      user.recovery?.backup_codes &&
      user.recovery.backup_codes.codes.length > 0 &&
      !this.areBackupCodesExpired(user)
    );
  }

  /**
   * Check if user has secondary email configured and verified
   */
  hasSecondaryEmail(user: IUser): boolean {
    return Boolean(
      user?.recovery?.enabled &&
      user.recovery?.secondary_email &&
      user.recovery.secondary_email.email &&
      user.recovery.secondary_email.verified
    );
  }

  /**
   * Get user's available recovery methods
   */
  getAvailableRecoveryMethods(user: IUser): RecoveryMethod[] {
    if (!this.isRecoveryEnabled(user)) {
      return [];
    }

    const methods: RecoveryMethod[] = [];

    if (this.hasBackupCodes(user)) {
      methods.push('backup_codes');
    }

    if (this.hasSecondaryEmail(user)) {
      methods.push('secondary_email');
    }

    if (this.hasSecurityQuestions(user)) {
      methods.push('security_questions');
    }

    return methods;
  }

  /**
   * Create recovery configuration object
   */
  createRecoveryConfig(
    enabled: boolean = true,
    methods: RecoveryMethod[] = ['backup_codes', 'secondary_email'],
    options: Partial<RecoveryConfig> = {}
  ): RecoveryConfig {
    return {
      enabled,
      methods,
      ...options,
    };
  }

  /**
   * Create backup codes recovery configuration
   */
  createBackupCodesRecoveryConfig(codes: string[]): RecoveryConfig {
    if (!codes || !Array.isArray(codes) || codes.length === 0) {
      throw new Error('Valid backup codes array is required');
    }

    return this.createRecoveryConfig(true, ['backup_codes'], {
      backup_codes: {
        codes,
        generated_at: new Date(),
        expires_at: new Date(
          Date.now() +
            RecoveryUtils.BACKUP_CODE_EXPIRY_DAYS * 24 * 60 * 60 * 1000
        ),
      },
    });
  }

  /**
   * Create secondary email recovery configuration
   */
  createSecondaryEmailRecoveryConfig(
    email: string,
    verified: boolean = false
  ): RecoveryConfig {
    if (!email || typeof email !== 'string') {
      throw new Error('Valid email address is required');
    }

    const trimmedEmail = email.toLowerCase().trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      throw new Error('Valid email address format is required');
    }

    return this.createRecoveryConfig(true, ['secondary_email'], {
      secondary_email: {
        email: trimmedEmail,
        verified,
      },
    });
  }

  /**
   * Disable recovery configuration
   */
  createDisabledRecoveryConfig(): RecoveryConfig {
    return {
      enabled: false,
      methods: [],
    };
  }

  /**
   * Mask email address for display
   */
  maskEmail(email: string): string {
    if (!email || typeof email !== 'string') {
      return '';
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail.includes('@')) {
      return trimmedEmail;
    }

    const [localPart, domain] = trimmedEmail.split('@');
    if (!localPart || !domain || localPart.length <= 1) {
      return trimmedEmail;
    }

    const maskedLocal =
      localPart.charAt(0) + '*'.repeat(Math.max(1, localPart.length - 1));
    return `${maskedLocal}@${domain}`;
  }

  /**
   * Mask phone number for display
   */
  maskPhoneNumber(phoneNumber: string): string {
    if (!phoneNumber || typeof phoneNumber !== 'string') {
      return '';
    }

    const trimmed = phoneNumber.trim();
    if (trimmed.length < 4) {
      return trimmed;
    }

    const cleaned = trimmed.replace(/\D/g, '');
    if (cleaned.length < 4) {
      return trimmed;
    }

    const maskedLength = Math.max(1, cleaned.length - 4);
    return '*'.repeat(maskedLength) + cleaned.slice(-4);
  }

  /**
   * Get recovery configuration from environment/config
   */
  getRecoveryConfig(): {
    enabled: boolean;
    methods: {
      backup_codes: { enabled: boolean; count: number; expiryDays: number };
      secondary_email: { enabled: boolean };
      sms: { enabled: boolean };
      security_questions: { enabled: boolean };
    };
  } {
    return {
      enabled:
        this.configManager.getConfig().security.authentication.recovery.enabled,
      methods: {
        backup_codes: {
          enabled:
            this.configManager.getConfig().security.authentication.recovery
              .backup_codes.enabled,
          count:
            this.configManager.getConfig().security.authentication.recovery
              .backup_codes.count,
          expiryDays:
            this.configManager.getConfig().security.authentication.recovery
              .backup_codes.expiry_days,
        },
        secondary_email: {
          enabled:
            this.configManager.getConfig().security.authentication.recovery
              .secondary_email.enabled,
        },
        sms: {
          enabled:
            this.configManager.getConfig().security.authentication.recovery.sms
              .enabled,
        },
        security_questions: {
          enabled:
            this.configManager.getConfig().security.authentication.recovery
              .security_questions.enabled,
        },
      },
    };
  }

  /**
   * Validate recovery method is supported
   */
  isMethodSupported(method: RecoveryMethod): boolean {
    const config = this.getRecoveryConfig();

    switch (method) {
      case 'backup_codes':
        return config.methods.backup_codes.enabled;
      case 'secondary_email':
        return config.methods.secondary_email.enabled;
      case 'sms':
        return config.methods.sms.enabled;
      case 'security_questions':
        return config.methods.security_questions.enabled;
      default:
        return false;
    }
  }

  /**
   * Get available recovery methods based on configuration
   */
  getAvailableMethods(): RecoveryMethod[] {
    const config = this.getRecoveryConfig();
    const methods: RecoveryMethod[] = [];

    if (config.methods.backup_codes.enabled) methods.push('backup_codes');
    if (config.methods.secondary_email.enabled) methods.push('secondary_email');
    if (config.methods.sms.enabled) methods.push('sms');
    if (config.methods.security_questions.enabled)
      methods.push('security_questions');

    return methods;
  }

  /**
   * Validate backup code format
   */
  validateBackupCodeFormat(code: string): {
    valid: boolean;
    sanitized?: string;
    error?: string;
  } {
    try {
      if (!code || typeof code !== 'string') {
        return { valid: false, error: 'Backup code is required' };
      }

      const sanitized = code.toUpperCase().replace(/[^A-F0-9]/g, '');

      if (sanitized.length !== RecoveryUtils.BACKUP_CODE_LENGTH) {
        return {
          valid: false,
          error: `Backup code must be exactly ${RecoveryUtils.BACKUP_CODE_LENGTH} characters`,
        };
      }

      return { valid: true, sanitized };
    } catch (error) {
      this.logger.error((error as Error).message, {
        context: 'validate_backup_code_format_error',
        code,
      });
      return { valid: false, error: 'Invalid backup code format' };
    }
  }

  /**
   * Check if backup codes are expired
   */
  areBackupCodesExpired(user: IUser): boolean {
    if (!user.recovery?.backup_codes?.expires_at) {
      return true;
    }
    return user.recovery.backup_codes.expires_at < new Date();
  }

  /**
   * Get remaining backup codes count
   */
  getRemainingBackupCodesCounts(user: IUser): number {
    if (!user.recovery?.backup_codes) {
      return 0;
    }

    // Since we remove used codes from the main array, the count is just the length
    return user.recovery.backup_codes.codes.length;
  }

  /**
   * Check if user is locked out from recovery attempts
   */
  checkRecoveryLockout(user: IUser): RecoveryLockoutResult {
    const lockout = user.recovery?.lockout;

    // No lockout data means not locked
    if (!lockout) {
      return {
        locked: false,
        failedAttempts: 0,
        remainingAttempts: RecoveryUtils.MAX_RECOVERY_ATTEMPTS,
      };
    }

    if (lockout.locked_until && lockout.locked_until > new Date()) {
      const minutesRemaining = Math.ceil(
        (lockout.locked_until.getTime() - Date.now()) / (1000 * 60)
      );
      return {
        locked: true,
        failedAttempts: lockout.failed_attempts || 0,
        lockedUntil: lockout.locked_until,
        minutesRemaining,
        remainingAttempts: 0,
      };
    }

    // Not locked, return remaining attempts
    const failedAttempts = lockout.failed_attempts || 0;
    const remainingAttempts = Math.max(
      0,
      RecoveryUtils.MAX_RECOVERY_ATTEMPTS - failedAttempts
    );

    return {
      locked: false,
      failedAttempts,
      remainingAttempts,
    };
  }

  /**
   * Record a failed recovery attempt
   * Returns whether the user is now locked out
   */
  recordFailedRecoveryAttempt(user: IUser): FailedAttemptResult {
    if (!user.recovery) {
      user.recovery = {
        enabled: false,
        methods: [],
        lockout: {
          locked: false,
          failed_attempts: 0,
          last_failed_at: undefined,
          locked_until: undefined,
        },
      };
    }

    if (!user.recovery.lockout) {
      user.recovery.lockout = {
        locked: false,
        failed_attempts: 0,
        last_failed_at: undefined,
        locked_until: undefined,
      };
    }

    // At this point user.recovery and user.recovery.lockout are guaranteed to exist
    const recovery = user.recovery!;
    const lockout = recovery.lockout!;

    if (lockout.locked_until && lockout.locked_until <= new Date()) {
      lockout.failed_attempts = 0;
      lockout.locked_until = undefined;
    }

    lockout.failed_attempts = (lockout.failed_attempts || 0) + 1;
    lockout.last_failed_at = new Date();

    if (lockout.failed_attempts >= RecoveryUtils.MAX_RECOVERY_ATTEMPTS) {
      lockout.locked_until = new Date(
        Date.now() + RecoveryUtils.LOCKOUT_DURATION_MINUTES * 60 * 1000
      );

      this.logger.warn('Recovery lockout triggered', {
        userId: user._id,
        username: user.username,
        failedAttempts: lockout.failed_attempts,
        lockedUntil: lockout.locked_until,
      });

      return {
        locked: true,
        failedAttempts: lockout.failed_attempts,
        lockedUntil: lockout.locked_until,
      };
    }

    return {
      locked: false,
      failedAttempts: lockout.failed_attempts,
    };
  }

  /**
   * Clear recovery lockout after successful recovery
   */
  clearRecoveryLockout(user: IUser): void {
    if (user.recovery?.lockout) {
      user.recovery.lockout.failed_attempts = 0;
      user.recovery.lockout.last_failed_at = undefined;
      user.recovery.lockout.locked_until = undefined;
    }
  }

  /**
   * Get lockout configuration
   */
  getLockoutConfig(): { maxAttempts: number; lockoutMinutes: number } {
    return {
      maxAttempts: RecoveryUtils.MAX_RECOVERY_ATTEMPTS,
      lockoutMinutes: RecoveryUtils.LOCKOUT_DURATION_MINUTES,
    };
  }

  /**
   * Check if user is in recovery cooldown period
   * During cooldown, password/MFA changes are restricted
   */
  checkRecoveryCooldown(user: IUser): RecoveryCooldownResult {
    const lastRecoveredAt = user.recovery?.last_recovered_at;

    if (!lastRecoveredAt) {
      return { inCooldown: false };
    }

    const cooldownEndsAt = new Date(
      lastRecoveredAt.getTime() +
        RecoveryUtils.RECOVERY_COOLDOWN_HOURS * 60 * 60 * 1000
    );

    if (cooldownEndsAt > new Date()) {
      const hoursRemaining = Math.ceil(
        (cooldownEndsAt.getTime() - Date.now()) / (1000 * 60 * 60)
      );
      return {
        inCooldown: true,
        cooldownEndsAt,
        hoursRemaining,
      };
    }

    return { inCooldown: false };
  }

  /**
   * Check if user is in recovery cooldown period (convenience boolean)
   */
  isInRecoveryCooldown(user: IUser): boolean {
    return this.checkRecoveryCooldown(user).inCooldown;
  }

  /**
   * Set the last recovered timestamp for a user
   * Call this after successful account recovery
   */
  setLastRecoveredAt(user: IUser): void {
    if (!user.recovery) {
      user.recovery = {
        enabled: false,
        methods: [],
      };
    }
    user.recovery.last_recovered_at = new Date();
  }

  /**
   * Get cooldown configuration
   */
  getCooldownConfig(): { cooldownHours: number } {
    return {
      cooldownHours: RecoveryUtils.RECOVERY_COOLDOWN_HOURS,
    };
  }

  /**
   * Check if secondary email uses the same domain as primary email
   * Returns a warning if domains match (security concern)
   */
  checkSecondaryEmailDomain(
    primaryEmail: string,
    secondaryEmail: string
  ): { sameDomain: boolean; warning?: string } {
    if (!primaryEmail || !secondaryEmail) {
      return { sameDomain: false };
    }

    const primaryDomain = primaryEmail.split('@')[1]?.toLowerCase();
    const secondaryDomain = secondaryEmail.split('@')[1]?.toLowerCase();

    if (!primaryDomain || !secondaryDomain) {
      return { sameDomain: false };
    }

    if (primaryDomain === secondaryDomain) {
      return {
        sameDomain: true,
        warning:
          'Your secondary email uses the same domain as your primary email. ' +
          'For better security, consider using an email from a different provider.',
      };
    }

    return { sameDomain: false };
  }

  // SECURITY QUESTIONS METHODS

  /**
   * Normalize security answer for consistent hashing
   * - Convert to lowercase
   * - Trim whitespace
   * - Replace multiple spaces with single space
   * - Remove punctuation
   */
  normalizeSecurityAnswer(answer: string): string {
    if (!answer || typeof answer !== 'string') {
      return '';
    }

    return answer
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '');
  }

  /**
   * Validate security answer strength
   */
  validateSecurityAnswer(answer: string): SecurityAnswerValidationResult {
    if (!answer || typeof answer !== 'string') {
      return { valid: false, error: 'Answer is required' };
    }

    const normalized = this.normalizeSecurityAnswer(answer);

    if (
      normalized.length < RecoveryUtils.SECURITY_QUESTIONS_MIN_ANSWER_LENGTH
    ) {
      return {
        valid: false,
        error: `Answer must be at least ${RecoveryUtils.SECURITY_QUESTIONS_MIN_ANSWER_LENGTH} characters`,
      };
    }

    if (
      normalized.length > RecoveryUtils.SECURITY_QUESTIONS_MAX_ANSWER_LENGTH
    ) {
      return {
        valid: false,
        error: `Answer must be less than ${RecoveryUtils.SECURITY_QUESTIONS_MAX_ANSWER_LENGTH} characters`,
      };
    }

    const genericAnswers = [
      'yes',
      'no',
      'maybe',
      'none',
      'na',
      'n/a',
      'idk',
      'unknown',
      'same',
      'nothing',
      'anything',
      'something',
    ];

    if (genericAnswers.includes(normalized)) {
      return {
        valid: false,
        error: 'Please provide a more specific answer',
      };
    }

    return { valid: true, normalized };
  }

  /**
   * Hash a security answer using Argon2id
   * Uses the passwordUtils for secure hashing
   */
  async hashSecurityAnswer(answer: string): Promise<string> {
    const normalized = this.normalizeSecurityAnswer(answer);

    if (!normalized) {
      throw new Error('Cannot hash empty answer');
    }

    return this.passwordUtils.hashPassword(normalized);
  }

  /**
   * Verify a security answer against stored hash
   */
  async verifySecurityAnswer(
    providedAnswer: string,
    storedHash: string
  ): Promise<boolean> {
    if (!providedAnswer || !storedHash) {
      return false;
    }

    const normalized = this.normalizeSecurityAnswer(providedAnswer);

    if (!normalized) {
      return false;
    }

    return (await this.passwordUtils.verifyPassword(normalized, storedHash))
      .valid;
  }

  /**
   * Setup security questions for a user
   * @param questionsWithAnswers - Array of question keys with their answers
   * @returns Setup result with hashed answers
   */
  async setupSecurityQuestions(
    questionsWithAnswers: SecurityQuestionInput[]
  ): Promise<SecurityQuestionsSetupResult> {
    if (!questionsWithAnswers || questionsWithAnswers.length === 0) {
      return {
        valid: false,
        error: 'At least one security question is required',
      };
    }

    for (const qa of questionsWithAnswers) {
      if (!RecoveryUtils.AVAILABLE_QUESTION_KEYS.includes(qa.question_key)) {
        return {
          valid: false,
          error: `Invalid question key: ${qa.question_key}`,
        };
      }
    }

    const questionKeys = questionsWithAnswers.map(qa => qa.question_key);
    const uniqueKeys = new Set(questionKeys);
    if (uniqueKeys.size !== questionKeys.length) {
      return {
        valid: false,
        error: 'Duplicate questions are not allowed',
      };
    }

    const hashedQuestions: Array<{
      id: string;
      question_key: string;
      answer_hash: string;
    }> = [];

    for (const qa of questionsWithAnswers) {
      const validation = this.validateSecurityAnswer(qa.answer);
      if (!validation.valid) {
        return {
          valid: false,
          error: `Invalid answer for question ${qa.question_key}: ${validation.error}`,
        };
      }

      const answerHash = await this.hashSecurityAnswer(qa.answer);

      hashedQuestions.push({
        id: crypto.randomUUID(),
        question_key: qa.question_key,
        answer_hash: answerHash,
      });
    }

    return {
      valid: true,
      questions: hashedQuestions,
      setup_at: new Date(),
    };
  }

  /**
   * Verify all security questions answers
   * @param user - User with security questions configured
   * @param providedAnswers - Map of question ID to provided answer
   * @returns Verification result
   */
  async verifySecurityQuestions(
    user: IUser,
    providedAnswers: Map<string, string>
  ): Promise<SecurityQuestionsVerificationResult> {
    if (!user.recovery?.security_questions?.questions) {
      return {
        valid: false,
        error: 'Security questions not configured',
      };
    }

    const storedQuestions = user.recovery.security_questions.questions;

    if (providedAnswers.size !== storedQuestions.length) {
      return {
        valid: false,
        error: 'All security questions must be answered',
      };
    }

    let incorrectCount = 0;

    for (const question of storedQuestions) {
      const providedAnswer = providedAnswers.get(question.id);

      if (!providedAnswer) {
        return {
          valid: false,
          error: `Missing answer for question ${question.id}`,
        };
      }

      const isCorrect = await this.verifySecurityAnswer(
        providedAnswer,
        question.answer_hash
      );

      if (!isCorrect) {
        incorrectCount++;
      }
    }

    if (incorrectCount > 0) {
      return {
        valid: false,
        allCorrect: false,
        incorrectCount,
        error: `${incorrectCount} answer(s) are incorrect`,
      };
    }

    return {
      valid: true,
      allCorrect: true,
      incorrectCount: 0,
    };
  }

  /**
   * Check if user has security questions configured
   */
  hasSecurityQuestions(user: IUser): boolean {
    return Boolean(
      user?.recovery?.enabled &&
      user.recovery?.security_questions?.questions &&
      user.recovery.security_questions.questions.length > 0
    );
  }

  /**
   * Check if user is locked out from security questions attempts
   */
  checkSecurityQuestionsLockout(user: IUser): SecurityQuestionsLockoutResult {
    const sqData = user.recovery?.security_questions;

    // No security questions data means not locked
    if (!sqData) {
      return {
        locked: false,
        failedAttempts: 0,
        remainingAttempts: RecoveryUtils.SECURITY_QUESTIONS_MAX_ATTEMPTS,
      };
    }

    if (sqData.locked_until && sqData.locked_until > new Date()) {
      const minutesRemaining = Math.ceil(
        (sqData.locked_until.getTime() - Date.now()) / (1000 * 60)
      );
      return {
        locked: true,
        failedAttempts: sqData.failed_attempts || 0,
        lockedUntil: sqData.locked_until,
        minutesRemaining,
        remainingAttempts: 0,
      };
    }

    // Not locked, return remaining attempts
    const failedAttempts = sqData.failed_attempts || 0;
    const remainingAttempts = Math.max(
      0,
      RecoveryUtils.SECURITY_QUESTIONS_MAX_ATTEMPTS - failedAttempts
    );

    return {
      locked: false,
      failedAttempts,
      remainingAttempts,
    };
  }

  /**
   * Record a failed security questions attempt
   */
  recordFailedSecurityQuestionAttempt(
    user: IUser
  ): SecurityQuestionsLockoutResult {
    if (!user.recovery) {
      user.recovery = {
        enabled: false,
        methods: [],
        security_questions: {
          questions: [],
          failed_attempts: 0,
          last_failed_at: undefined,
          locked_until: undefined,
        },
      };
    }

    if (!user.recovery.security_questions) {
      user.recovery.security_questions = {
        questions: [],
        failed_attempts: 0,
        last_failed_at: undefined,
        locked_until: undefined,
      };
    }

    const sqData = user.recovery.security_questions;

    if (sqData.locked_until && sqData.locked_until <= new Date()) {
      sqData.failed_attempts = 0;
      sqData.locked_until = undefined;
    }

    sqData.failed_attempts = (sqData.failed_attempts || 0) + 1;
    sqData.last_failed_at = new Date();

    if (
      sqData.failed_attempts >= RecoveryUtils.SECURITY_QUESTIONS_MAX_ATTEMPTS
    ) {
      sqData.locked_until = new Date(
        Date.now() +
          RecoveryUtils.SECURITY_QUESTIONS_LOCKOUT_MINUTES * 60 * 1000
      );

      this.logger.warn('Security questions lockout triggered', {
        userId: user._id,
        username: user.username,
        failedAttempts: sqData.failed_attempts,
        lockedUntil: sqData.locked_until,
      });

      return {
        locked: true,
        remainingAttempts: 0,
        lockedUntil: sqData.locked_until,
        minutesRemaining: RecoveryUtils.SECURITY_QUESTIONS_LOCKOUT_MINUTES,
      };
    }

    return {
      locked: false,
      remainingAttempts:
        RecoveryUtils.SECURITY_QUESTIONS_MAX_ATTEMPTS - sqData.failed_attempts,
    };
  }

  /**
   * Clear security questions lockout after successful verification
   */
  clearSecurityQuestionsLockout(user: IUser): void {
    if (user.recovery?.security_questions) {
      user.recovery.security_questions.failed_attempts = 0;
      user.recovery.security_questions.last_failed_at = undefined;
      user.recovery.security_questions.locked_until = undefined;
      user.recovery.security_questions.last_used_at = new Date();
    }
  }

  /**
   * Get available security question keys for display
   */
  getAvailableQuestionKeys(): string[] {
    return [...RecoveryUtils.AVAILABLE_QUESTION_KEYS];
  }

  /**
   * Get security questions configuration
   */
  getSecurityQuestionsConfig(): {
    minAnswerLength: number;
    maxAttempts: number;
    lockoutMinutes: number;
    availableQuestionKeys: string[];
  } {
    return {
      minAnswerLength: RecoveryUtils.SECURITY_QUESTIONS_MIN_ANSWER_LENGTH,
      maxAttempts: RecoveryUtils.SECURITY_QUESTIONS_MAX_ATTEMPTS,
      lockoutMinutes: RecoveryUtils.SECURITY_QUESTIONS_LOCKOUT_MINUTES,
      availableQuestionKeys: this.getAvailableQuestionKeys(),
    };
  }
}

export default RecoveryUtils;
