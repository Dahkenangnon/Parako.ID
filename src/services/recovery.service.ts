import { injectable, inject } from 'inversify';
import { TYPES } from '../di/types.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { IUserService } from '../di/interfaces/user-service.interface.js';
import type { IActivityService } from '../di/interfaces/activity-service.interface.js';
import type { INotificationService } from '../di/interfaces/notification-service.interface.js';
import type { IRecoveryUtils } from '../di/interfaces/recovery-utils.interface.js';
import type { IUser } from '../types/user.js';
import type {
  IRecoveryService,
  RecoveryMethod,
  RecoveryMethodStatus,
  RecoveryLockoutStatus,
  RecoveryInitiationResult,
  RecoveryCompletionResult,
  RecoveryDeviceInfo,
} from '../di/interfaces/recovery-service.interface.js';

/**
 * RecoveryService - High-level orchestration of all recovery operations
 *
 * This service coordinates between:
 * - RecoveryUtils: Crypto operations (hashing, verification)
 * - ActivityService: Audit logging
 * - NotificationService: Email/SMS notifications
 * - UserService: User updates
 */
@injectable()
export class RecoveryService implements IRecoveryService {
  constructor(
    @inject(TYPES.Logger)
    private readonly logger: ILogger,
    @inject(TYPES.ConfigManager)
    private readonly configManager: IConfigManager,
    @inject(TYPES.UserService)
    private readonly userService: IUserService,
    @inject(TYPES.ActivityService)
    private readonly activityService: IActivityService,
    @inject(TYPES.NotificationService)
    private readonly notificationService: INotificationService,
    @inject(TYPES.RecoveryUtils)
    private readonly recoveryUtils: IRecoveryUtils
  ) {}

  /**
   * Initiate a recovery attempt
   */
  async initiateRecovery(
    identifier: string,
    method: RecoveryMethod,
    deviceInfo: RecoveryDeviceInfo
  ): Promise<RecoveryInitiationResult> {
    try {
      const user = await this.findUserByIdentifier(identifier);
      if (!user) {
        // Don't reveal if user exists
        return {
          success: false,
          error:
            'Recovery request submitted. Check your email for instructions.',
        };
      }

      const methods = await this.getAvailableMethods(user._id!.toString());
      const methodStatus = methods.find(m => m.method === method);

      if (!methodStatus?.available) {
        return {
          success: false,
          error: 'This recovery method is not available for your account',
        };
      }

      await this.logAttempt(user._id!.toString(), method, false, deviceInfo, {
        stage: 'initiated',
      });

      return {
        success: true,
        attemptId: user._id!.toString(), // In production, use a proper session/attempt ID
        method,
        requiresVerification: true,
      };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'recovery_initiation_failed',
        identifier,
        method,
      });
      return {
        success: false,
        error: 'An error occurred. Please try again.',
      };
    }
  }

  /**
   * Complete a recovery attempt
   */
  async completeRecovery(
    _attemptId: string,
    _verification: string,
    _deviceInfo: RecoveryDeviceInfo
  ): Promise<RecoveryCompletionResult> {
    // In production, you'd want proper attempt tracking
    return {
      success: false,
      error: 'Use specific verification methods instead',
    };
  }

  /**
   * Verify backup code and consume it
   */
  async verifyAndConsumeBackupCode(
    user: IUser,
    code: string,
    deviceInfo: RecoveryDeviceInfo
  ): Promise<RecoveryCompletionResult> {
    try {
      const userId = user._id!.toString();

      const lockout = await this.checkLockout(userId, 'backup_codes');
      if (lockout.locked) {
        return {
          success: false,
          error: `Too many failed attempts. Try again in ${lockout.minutesRemaining} minutes.`,
        };
      }

      const result = await this.recoveryUtils.verifyUserBackupCode(user, code);

      if (!result.valid) {
        this.recoveryUtils.recordFailedRecoveryAttempt(user);
        await this.saveUserRecoveryState(user);

        await this.logAttempt(userId, 'backup_codes', false, deviceInfo, {
          error: result.error,
        });

        return {
          success: false,
          error: result.error || 'Invalid backup code',
        };
      }

      if (user.recovery?.backup_codes && result.matchedCode) {
        const updatedCodes = user.recovery.backup_codes.codes.filter(
          c => c !== result.matchedCode
        );

        this.recoveryUtils.clearRecoveryLockout(user);
        this.recoveryUtils.setLastRecoveredAt(user);

        await this.userService.updateById(userId, {
          recovery: {
            ...user.recovery,
            methods: user.recovery.methods ?? [],
            backup_codes: {
              ...user.recovery.backup_codes,
              codes: updatedCodes,
            },
            lockout: user.recovery.lockout,
            last_recovered_at: user.recovery.last_recovered_at,
          },
        });

        await this.logAttempt(userId, 'backup_codes', true, deviceInfo);

        await this.sendRecoveryNotification(user, 'backup_codes', deviceInfo);

        if (updatedCodes.length <= 2) {
          await this.sendBackupCodeWarning(user, updatedCodes.length);
        }

        return {
          success: true,
          userId,
          method: 'backup_codes',
          remainingCodes: updatedCodes.length,
        };
      }

      return {
        success: false,
        error: 'Failed to process backup code',
      };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'backup_code_verification_failed',
        userId: user._id,
      });
      return {
        success: false,
        error: 'An error occurred during verification',
      };
    }
  }

  /**
   * Verify security questions
   */
  async verifySecurityQuestions(
    user: IUser,
    answers: Map<string, string>,
    deviceInfo: RecoveryDeviceInfo
  ): Promise<RecoveryCompletionResult> {
    try {
      const userId = user._id!.toString();

      const lockoutResult =
        this.recoveryUtils.checkSecurityQuestionsLockout(user);
      if (lockoutResult.locked) {
        return {
          success: false,
          error: `Too many failed attempts. Try again in ${lockoutResult.minutesRemaining} minutes.`,
        };
      }

      const result = await this.recoveryUtils.verifySecurityQuestions(
        user,
        answers
      );

      if (!result.valid) {
        this.recoveryUtils.recordFailedSecurityQuestionAttempt(user);
        await this.saveUserRecoveryState(user);

        await this.logAttempt(userId, 'security_questions', false, deviceInfo, {
          error: result.error,
        });

        return {
          success: false,
          error: result.error || 'Security question verification failed',
        };
      }

      this.recoveryUtils.clearSecurityQuestionsLockout(user);
      this.recoveryUtils.setLastRecoveredAt(user);

      if (user.recovery?.security_questions) {
        user.recovery.security_questions.last_used_at = new Date();
      }

      await this.saveUserRecoveryState(user);

      await this.logAttempt(userId, 'security_questions', true, deviceInfo);

      await this.sendRecoveryNotification(
        user,
        'security_questions',
        deviceInfo
      );

      return {
        success: true,
        userId,
        method: 'security_questions',
      };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'security_questions_verification_failed',
        userId: user._id,
      });
      return {
        success: false,
        error: 'An error occurred during verification',
      };
    }
  }

  /**
   * Verify SMS recovery code and consume it
   */
  async verifyAndConsumeSmsRecoveryCode(
    user: IUser,
    code: string,
    deviceInfo: RecoveryDeviceInfo
  ): Promise<RecoveryCompletionResult> {
    try {
      const userId = user._id!.toString();

      const lockout = await this.checkLockout(userId, 'sms');
      if (lockout.locked) {
        return {
          success: false,
          error: `Too many failed attempts. Try again in ${lockout.minutesRemaining} minutes.`,
        };
      }

      const storedCode = user.recovery?.sms?.verification_code;
      const expiresAt = user.recovery?.sms?.verification_expires;

      if (!storedCode || !expiresAt) {
        return {
          success: false,
          error: 'No SMS verification code pending. Please request a new code.',
        };
      }

      const result = this.recoveryUtils.verifySmsCode(
        code,
        storedCode,
        expiresAt
      );

      if (!result.valid) {
        this.recoveryUtils.recordFailedRecoveryAttempt(user);
        await this.saveUserRecoveryState(user);

        await this.logAttempt(userId, 'sms', false, deviceInfo, {
          error: result.error || 'Invalid or expired code',
        });

        return {
          success: false,
          error: result.error || 'Invalid or expired code',
        };
      }

      if (user.recovery?.sms) {
        user.recovery.sms.verification_code = undefined;
        user.recovery.sms.verification_expires = undefined;
      }

      this.recoveryUtils.clearRecoveryLockout(user);
      this.recoveryUtils.setLastRecoveredAt(user);
      await this.saveUserRecoveryState(user);

      await this.logAttempt(userId, 'sms', true, deviceInfo);

      await this.sendRecoveryNotification(user, 'sms', deviceInfo);

      return {
        success: true,
        userId,
        method: 'sms',
      };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'sms_code_verification_failed',
        userId: user._id,
      });
      return {
        success: false,
        error: 'An error occurred during verification',
      };
    }
  }

  /**
   * Get available recovery methods for a user
   */
  async getAvailableMethods(userId: string): Promise<RecoveryMethodStatus[]> {
    try {
      const user = await this.userService.findById(userId);
      if (!user) {
        return [];
      }

      const methods: RecoveryMethodStatus[] = [];
      const config = this.recoveryUtils.getRecoveryConfig();

      const hasBackupCodes =
        user.recovery?.backup_codes &&
        user.recovery.backup_codes.codes.length > 0;
      const backupCodesExpired = hasBackupCodes
        ? this.recoveryUtils.areBackupCodesExpired(user)
        : false;

      methods.push({
        method: 'backup_codes',
        available:
          config.methods.backup_codes.enabled &&
          !!hasBackupCodes &&
          !backupCodesExpired,
        configured: !!hasBackupCodes,
        details: hasBackupCodes
          ? {
              remainingCodes:
                this.recoveryUtils.getRemainingBackupCodesCounts(user),
              expiresAt: user.recovery?.backup_codes?.expires_at,
            }
          : undefined,
      });

      const hasSecondaryEmail =
        user.recovery?.secondary_email?.email &&
        user.recovery.secondary_email.verified;

      methods.push({
        method: 'secondary_email',
        available:
          config.methods.secondary_email.enabled && !!hasSecondaryEmail,
        configured: !!user.recovery?.secondary_email?.email,
        details: {
          verified: user.recovery?.secondary_email?.verified,
        },
      });

      // Security questions
      const hasSecurityQuestions =
        this.recoveryUtils.hasSecurityQuestions(user);

      methods.push({
        method: 'security_questions',
        available:
          config.methods.security_questions.enabled && hasSecurityQuestions,
        configured: hasSecurityQuestions,
        details: hasSecurityQuestions
          ? {
              lastUsedAt: user.recovery?.security_questions?.last_used_at,
            }
          : undefined,
      });

      // SMS recovery
      const appConfig = this.configManager.getConfig();
      const smsEnabled = appConfig.notifications?.channels?.sms?.enabled;
      const hasPhone = !!user.phone_number;

      methods.push({
        method: 'sms',
        available: !!smsEnabled && hasPhone,
        configured: hasPhone,
        details: hasPhone
          ? {
              maskedPhone: this.maskPhoneNumber(user.phone_number!),
            }
          : undefined,
      });

      return methods;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'get_available_methods_failed',
        userId,
      });
      return [];
    }
  }

  /**
   * Check recovery lockout status
   */
  async checkLockout(
    userId: string,
    method?: RecoveryMethod
  ): Promise<RecoveryLockoutStatus> {
    try {
      const user = await this.userService.findById(userId);
      if (!user) {
        return {
          locked: false,
          failedAttempts: 0,
          maxAttempts: 5,
          remainingAttempts: 5,
        };
      }

      if (method === 'security_questions') {
        const result = this.recoveryUtils.checkSecurityQuestionsLockout(user);
        return {
          locked: result.locked,
          lockedUntil: result.lockedUntil,
          minutesRemaining: result.minutesRemaining,
          failedAttempts: result.failedAttempts ?? 0,
          maxAttempts: 3,
          remainingAttempts: result.remainingAttempts ?? 3,
        };
      }

      const result = this.recoveryUtils.checkRecoveryLockout(user);
      return {
        locked: result.locked,
        lockedUntil: result.lockedUntil,
        minutesRemaining: result.minutesRemaining,
        failedAttempts: result.failedAttempts ?? 0,
        maxAttempts: 5,
        remainingAttempts: result.remainingAttempts ?? 5,
      };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'check_lockout_failed',
        userId,
        method,
      });
      return {
        locked: false,
        failedAttempts: 0,
        maxAttempts: 5,
        remainingAttempts: 5,
      };
    }
  }

  /**
   * Check if user is in recovery cooldown period
   */
  async isInCooldownPeriod(userId: string): Promise<boolean> {
    try {
      const user = await this.userService.findById(userId);
      if (!user) return false;
      return this.recoveryUtils.isInRecoveryCooldown(user);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'cooldown_check_failed',
        userId,
      });
      return false;
    }
  }

  /**
   * Log a recovery attempt
   */
  async logAttempt(
    userId: string,
    method: RecoveryMethod,
    success: boolean,
    deviceInfo: RecoveryDeviceInfo,
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      const user = await this.userService.findById(userId);
      if (!user) return;

      const activityType = success
        ? 'account_recovery_successful'
        : 'recovery_attempt_failed';
      const description = success
        ? `Account recovered via ${method}`
        : `Failed recovery attempt via ${method}`;

      if (success) {
        await this.activityService.success(activityType, description, user, {
          ip_address: deviceInfo.ip,
          user_agent: deviceInfo.userAgent,
          actor: user,
          target: { target_type: 'none' },
          metadata: {
            method,
            location: deviceInfo.location,
            ...metadata,
          },
        });
      } else {
        await this.activityService.failed(activityType, description, user, {
          ip_address: deviceInfo.ip,
          user_agent: deviceInfo.userAgent,
          actor: user,
          target: { target_type: 'none' },
          metadata: {
            method,
            location: deviceInfo.location,
            ...metadata,
          },
        });
      }
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'log_attempt_failed',
        userId,
        method,
        success,
      });
    }
  }

  /**
   * Generate new backup codes for a user
   */
  async generateBackupCodes(
    userId: string
  ): Promise<{ codes: string[]; expiresAt: Date }> {
    try {
      const user = await this.userService.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const result = await this.recoveryUtils.generateBackupCodes();

      await this.userService.updateById(userId, {
        recovery: {
          ...user.recovery,
          methods: user.recovery?.methods ?? [],
          enabled: true,
          backup_codes: {
            codes: result.hashedCodes,
            generated_at: result.generatedAt,
            expires_at: result.expiresAt,
          },
        },
      });

      return {
        codes: result.codes,
        expiresAt: result.expiresAt,
      };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'generate_backup_codes_failed',
        userId,
      });
      throw error;
    }
  }

  /**
   * Setup security questions
   */
  async setupSecurityQuestions(
    userId: string,
    questionsWithAnswers: Array<{ question_key: string; answer: string }>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const user = await this.userService.findById(userId);
      if (!user) {
        return { success: false, error: 'User not found' };
      }

      const result =
        await this.recoveryUtils.setupSecurityQuestions(questionsWithAnswers);

      if (!result.valid) {
        return { success: false, error: result.error };
      }

      await this.userService.updateById(userId, {
        recovery: {
          ...user.recovery,
          methods: user.recovery?.methods ?? [],
          enabled: true,
          security_questions: {
            questions: result.questions!,
            setup_at: new Date(),
          },
        },
      });

      return { success: true };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'setup_security_questions_failed',
        userId,
      });
      return { success: false, error: 'Failed to set up security questions' };
    }
  }

  /**
   * Remove a recovery method
   */
  async removeRecoveryMethod(
    userId: string,
    method: RecoveryMethod
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const user = await this.userService.findById(userId);
      if (!user) {
        return { success: false, error: 'User not found' };
      }

      const updateData: NonNullable<IUser['recovery']> = {
        enabled: user.recovery?.enabled ?? false,
        methods: user.recovery?.methods ?? [],
        ...user.recovery,
      };

      switch (method) {
        case 'backup_codes':
          updateData.backup_codes = undefined;
          break;
        case 'secondary_email':
          updateData.secondary_email = undefined;
          break;
        case 'security_questions':
          updateData.security_questions = undefined;
          break;
        default:
          return { success: false, error: 'Invalid recovery method' };
      }

      const hasAnyMethod =
        updateData.backup_codes ||
        updateData.secondary_email?.verified ||
        updateData.security_questions;

      updateData.enabled = !!hasAnyMethod;

      await this.userService.updateById(userId, {
        recovery: updateData,
      });

      return { success: true };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'remove_recovery_method_failed',
        userId,
        method,
      });
      return { success: false, error: 'Failed to remove recovery method' };
    }
  }

  /**
   * Send recovery notification
   */
  async sendRecoveryNotification(
    user: IUser,
    method: RecoveryMethod,
    deviceInfo: RecoveryDeviceInfo
  ): Promise<void> {
    try {
      await this.notificationService.sendSecurityAlert(
        { email: user.email, username: user.username, locale: user.locale },
        'account_recovered',
        {
          method,
          timestamp: new Date().toISOString(),
          ip: deviceInfo.ip,
          userAgent: deviceInfo.userAgent,
          location: deviceInfo.location,
        }
      );
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'send_recovery_notification_failed',
        userId: user._id,
        method,
      });
    }
  }

  /**
   * Send backup code warning
   */
  async sendBackupCodeWarning(
    user: IUser,
    remainingCodes: number
  ): Promise<void> {
    try {
      const config = this.configManager.getConfig();
      const settingsUrl = `${config.deployment.url}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.settings}#recovery`;

      await this.notificationService.sendBackupCodeWarning(
        { email: user.email, username: user.username, locale: user.locale },
        remainingCodes,
        settingsUrl
      );
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'send_backup_code_warning_failed',
        userId: user._id,
        remainingCodes,
      });
    }
  }

  // ===== Private Helpers =====

  /**
   * Find user by various identifiers
   */
  private async findUserByIdentifier(
    identifier: string
  ): Promise<IUser | null> {
    if (identifier.includes('@')) {
      return (await this.userService.findByEmail(identifier)) ?? null;
    }

    if (/^\+?\d[\d\s-]+$/.test(identifier)) {
      const cleanPhone = identifier.replace(/[\s-]/g, '');
      return (await this.userService.findByPhoneNumber(cleanPhone)) ?? null;
    }

    return (await this.userService.findByUsername(identifier)) ?? null;
  }

  /**
   * Save user recovery state
   */
  private async saveUserRecoveryState(user: IUser): Promise<void> {
    if (user._id && user.recovery) {
      await this.userService.updateById(user._id.toString(), {
        recovery: user.recovery,
      });
    }
  }

  /**
   * Mask phone number for display (e.g., +1***456)
   */
  private maskPhoneNumber(phone: string): string {
    if (phone.length < 6) {
      return '***';
    }
    const prefix = phone.slice(0, 2);
    const suffix = phone.slice(-3);
    const masked = '*'.repeat(Math.max(phone.length - 5, 3));
    return `${prefix}${masked}${suffix}`;
  }
}
