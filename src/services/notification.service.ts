import { injectable, inject } from 'inversify';
import { TYPES } from '../di/types.js';
import type { IEmailService } from '../di/interfaces/email-service.interface.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IUser } from '../types/user.js';
import type {
  INotificationService,
  NotificationChannel,
  NotificationRecipient,
  NotificationResult,
  SessionInfo,
  OtpContext,
  NotificationAction,
} from '../di/interfaces/notification-service.interface.js';

/**
 * NotificationService - Channel-agnostic notification abstraction
 *
 * This service wraps the EmailService (and future SMS/WhatsApp services)
 * to provide a unified notification API. All application code should use
 * this service instead of directly depending on EmailService.
 *
 * Currently only email channel is implemented. SMS and WhatsApp can be
 * added later without changing consumers of this service.
 */
@injectable()
export class NotificationService implements INotificationService {
  constructor(
    @inject(TYPES.EmailService)
    private readonly emailService: IEmailService,
    @inject(TYPES.ConfigManager)
    private readonly configManager: IConfigManager,
    @inject(TYPES.Logger)
    private readonly logger: ILogger
  ) {}

  /**
   * Send email verification notification
   */
  async sendVerification(
    recipient: NotificationRecipient,
    verificationUrl: string
  ): Promise<NotificationResult> {
    if (!recipient.email) {
      return this.createFailureResult(
        'email',
        'No email address provided for verification'
      );
    }

    try {
      await this.emailService.sendVerificationEmail(
        recipient.email,
        recipient.username || 'User',
        verificationUrl,
        recipient.locale
      );

      this.logger.debug('Verification notification sent', {
        channel: 'email',
        recipient: recipient.email,
      });

      return this.createSuccessResult('email');
    } catch (error) {
      this.logger.error('Failed to send verification notification', {
        error: (error as Error).message,
        recipient: recipient.email,
      });
      return this.createFailureResult('email', (error as Error).message);
    }
  }

  /**
   * Send password reset notification
   */
  async sendPasswordReset(
    recipient: NotificationRecipient,
    resetUrl: string
  ): Promise<NotificationResult> {
    if (!recipient.email) {
      return this.createFailureResult(
        'email',
        'No email address provided for password reset'
      );
    }

    try {
      await this.emailService.sendPasswordResetEmail(
        recipient.email,
        recipient.username || 'User',
        resetUrl,
        recipient.locale
      );

      this.logger.debug('Password reset notification sent', {
        channel: 'email',
        recipient: recipient.email,
      });

      return this.createSuccessResult('email');
    } catch (error) {
      this.logger.error('Failed to send password reset notification', {
        error: (error as Error).message,
        recipient: recipient.email,
      });
      return this.createFailureResult('email', (error as Error).message);
    }
  }

  /**
   * Send welcome notification to new users
   */
  async sendWelcome(
    recipient: NotificationRecipient
  ): Promise<NotificationResult> {
    if (!recipient.email) {
      return this.createFailureResult(
        'email',
        'No email address provided for welcome notification'
      );
    }

    try {
      await this.emailService.sendWelcomeEmail(
        recipient.email,
        recipient.username || 'User',
        recipient.locale
      );

      this.logger.debug('Welcome notification sent', {
        channel: 'email',
        recipient: recipient.email,
      });

      return this.createSuccessResult('email');
    } catch (error) {
      this.logger.error('Failed to send welcome notification', {
        error: (error as Error).message,
        recipient: recipient.email,
      });
      return this.createFailureResult('email', (error as Error).message);
    }
  }

  /**
   * Send security alert notification
   */
  async sendSecurityAlert(
    recipient: NotificationRecipient,
    alertType: string,
    details: Record<string, any>
  ): Promise<NotificationResult> {
    if (!recipient.email) {
      return this.createFailureResult(
        'email',
        'No email address provided for security alert'
      );
    }

    try {
      const detailsString = Object.entries(details)
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ');

      await this.emailService.sendSecurityAlertEmail(
        recipient.email,
        recipient.username || 'User',
        alertType,
        detailsString,
        recipient.locale
      );

      this.logger.debug('Security alert notification sent', {
        channel: 'email',
        recipient: recipient.email,
        alertType,
      });

      return this.createSuccessResult('email');
    } catch (error) {
      this.logger.error('Failed to send security alert notification', {
        error: (error as Error).message,
        recipient: recipient.email,
        alertType,
      });
      return this.createFailureResult('email', (error as Error).message);
    }
  }

  /**
   * Send new session/login alert notification
   */
  async sendNewSessionAlert(
    recipient: NotificationRecipient,
    sessionInfo: SessionInfo
  ): Promise<NotificationResult> {
    if (!recipient.email) {
      return this.createFailureResult(
        'email',
        'No email address provided for new session alert'
      );
    }

    try {
      await this.emailService.sendNewSessionNotification({
        email: recipient.email,
        username: recipient.username || 'User',
        ip: sessionInfo.ip,
        userAgent: sessionInfo.userAgent,
        timestamp: sessionInfo.timestamp,
        locale: recipient.locale,
      });

      this.logger.debug('New session alert notification sent', {
        channel: 'email',
        recipient: recipient.email,
        ip: sessionInfo.ip,
      });

      return this.createSuccessResult('email');
    } catch (error) {
      this.logger.error('Failed to send new session alert notification', {
        error: (error as Error).message,
        recipient: recipient.email,
      });
      return this.createFailureResult('email', (error as Error).message);
    }
  }

  /**
   * Send OTP code notification
   */
  async sendOtp(
    recipient: NotificationRecipient,
    otp: string,
    context: OtpContext
  ): Promise<NotificationResult> {
    if (!recipient.email) {
      return this.createFailureResult(
        'email',
        'No email address provided for OTP notification'
      );
    }

    try {
      await this.emailService.sendNewDeviceOtpEmail({
        email: recipient.email,
        username: recipient.username || 'User',
        otp,
        deviceInfo: context.deviceInfo,
        ip: context.ip,
        locale: recipient.locale,
      });

      this.logger.debug('OTP notification sent', {
        channel: 'email',
        recipient: recipient.email,
      });

      return this.createSuccessResult('email');
    } catch (error) {
      this.logger.error('Failed to send OTP notification', {
        error: (error as Error).message,
        recipient: recipient.email,
      });
      return this.createFailureResult('email', (error as Error).message);
    }
  }

  /**
   * Send a generic notification with custom content
   */
  async sendGeneric(
    recipient: NotificationRecipient,
    title: string,
    content: string,
    action?: NotificationAction
  ): Promise<NotificationResult> {
    if (!recipient.email) {
      return this.createFailureResult(
        'email',
        'No email address provided for generic notification'
      );
    }

    try {
      await this.emailService.sendNotificationEmail(
        recipient.email,
        recipient.username || 'User',
        title,
        content,
        action?.url,
        action?.text
      );

      this.logger.debug('Generic notification sent', {
        channel: 'email',
        recipient: recipient.email,
        title,
      });

      return this.createSuccessResult('email');
    } catch (error) {
      this.logger.error('Failed to send generic notification', {
        error: (error as Error).message,
        recipient: recipient.email,
      });
      return this.createFailureResult('email', (error as Error).message);
    }
  }

  /**
   * Send a templated email notification
   */
  async sendTemplatedEmail(
    email: string,
    subject: string,
    template: string,
    variables: Record<string, any>,
    locale?: string
  ): Promise<NotificationResult> {
    if (!email) {
      return this.createFailureResult(
        'email',
        'No email address provided for templated notification'
      );
    }

    try {
      await this.emailService.sendTemplatedEmail(
        email,
        subject,
        template,
        variables,
        locale
      );

      this.logger.debug('Templated email notification sent', {
        channel: 'email',
        recipient: email,
        template,
      });

      return this.createSuccessResult('email');
    } catch (error) {
      this.logger.error('Failed to send templated email notification', {
        error: (error as Error).message,
        recipient: email,
        template,
      });
      return this.createFailureResult('email', (error as Error).message);
    }
  }

  /**
   * Send backup code count warning notification
   */
  async sendBackupCodeWarning(
    recipient: NotificationRecipient,
    remainingCount: number,
    settingsUrl: string
  ): Promise<NotificationResult> {
    if (!recipient.email) {
      return this.createFailureResult(
        'email',
        'No email address provided for backup code warning'
      );
    }

    try {
      const title =
        remainingCount === 0
          ? 'Backup Codes Depleted'
          : `Only ${remainingCount} Backup Code${remainingCount === 1 ? '' : 's'} Remaining`;

      const content =
        remainingCount === 0
          ? 'You have used all your backup recovery codes. Please generate new codes immediately to ensure you can recover your account if needed.'
          : `You have only ${remainingCount} backup recovery code${remainingCount === 1 ? '' : 's'} remaining. We recommend generating new codes soon to ensure account recovery is always available.`;

      await this.emailService.sendNotificationEmail(
        recipient.email,
        recipient.username || 'User',
        title,
        content,
        settingsUrl,
        'Generate New Codes',
        recipient.locale
      );

      this.logger.debug('Backup code warning notification sent', {
        channel: 'email',
        recipient: recipient.email,
        remainingCount,
      });

      return this.createSuccessResult('email');
    } catch (error) {
      this.logger.error('Failed to send backup code warning notification', {
        error: (error as Error).message,
        recipient: recipient.email,
        remainingCount,
      });
      return this.createFailureResult('email', (error as Error).message);
    }
  }

  /**
   * Send admin alert notification (always uses email)
   */
  async sendAdminAlert(
    adminEmails: string[],
    subject: string,
    content: string
  ): Promise<NotificationResult> {
    if (!adminEmails || adminEmails.length === 0) {
      return this.createFailureResult(
        'email',
        'No admin email addresses provided'
      );
    }

    try {
      const sendPromises = adminEmails.map(email =>
        this.emailService.sendNotificationEmail(
          email,
          'Administrator',
          subject,
          content
        )
      );

      await Promise.all(sendPromises);

      this.logger.debug('Admin alert notification sent', {
        channel: 'email',
        recipientCount: adminEmails.length,
        subject,
      });

      return this.createSuccessResult('email');
    } catch (error) {
      this.logger.error('Failed to send admin alert notification', {
        error: (error as Error).message,
        adminEmails,
      });
      return this.createFailureResult('email', (error as Error).message);
    }
  }

  /**
   * Get the preferred notification channel for a user
   * Based on user preferences and available contact methods
   */
  getPreferredChannel(user: IUser): NotificationChannel {
    const userPreference = user.notification_preferences?.preferred_channel;

    if (userPreference && userPreference !== 'auto') {
      if (userPreference === 'email' && user.email) {
        return 'email';
      }
      if (userPreference === 'sms' && user.phone_number) {
        return 'sms';
      }
    }

    // Auto-detect based on available contact methods
    // Priority: email > sms > whatsapp (email is most reliable)
    if (user.email) {
      return 'email';
    }

    if (user.phone_number) {
      const config = this.configManager.getConfig();
      const smsEnabled = config.notifications?.channels?.sms?.enabled ?? false;
      if (smsEnabled) {
        return 'sms';
      }
    }

    // Default to email even if not available (will fail gracefully)
    return 'email';
  }

  /**
   * Get list of available notification channels
   * Based on system configuration
   */
  getAvailableChannels(): NotificationChannel[] {
    const channels: NotificationChannel[] = ['email']; // Email always available

    try {
      const config = this.configManager.getConfig();

      if (config.notifications?.channels?.sms?.enabled) {
        channels.push('sms');
      }

      //   channels.push('whatsapp');
      // }
    } catch {
      this.logger.warn(
        'Could not read notification config, defaulting to email only'
      );
    }

    return channels;
  }

  /**
   * Create a success result
   */
  private createSuccessResult(
    channel: NotificationChannel
  ): NotificationResult {
    return {
      success: true,
      channel,
    };
  }

  /**
   * Create a failure result
   */
  private createFailureResult(
    channel: NotificationChannel,
    error: string
  ): NotificationResult {
    return {
      success: false,
      channel,
      error,
    };
  }
}
