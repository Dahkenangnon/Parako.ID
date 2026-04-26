import type { IUser } from '../../types/user.js';

/**
 * Supported notification channels
 */
export type NotificationChannel = 'email' | 'sms' | 'whatsapp';

/**
 * Recipient information for notifications
 * Can be a user object or explicit contact details
 */
export interface NotificationRecipient {
  userId?: string;
  email?: string;
  phone?: string;
  username?: string;
  locale?: string;
}

/**
 * Result of a notification send attempt
 */
export interface NotificationResult {
  success: boolean;
  channel: NotificationChannel;
  error?: string;
}

/**
 * Session information for new session alerts
 */
export interface SessionInfo {
  ip: string;
  userAgent: string;
  timestamp: Date;
}

/**
 * Context for OTP notifications
 */
export interface OtpContext {
  deviceInfo: string;
  ip: string;
}

/**
 * Action button for generic notifications
 */
export interface NotificationAction {
  url: string;
  text: string;
}

/**
 * Interface for NotificationService - channel-agnostic notification abstraction
 *
 * This service wraps the underlying email service (and future SMS/WhatsApp services)
 * to provide a unified notification API. All application code should use this
 * service instead of directly depending on EmailService.
 */
export interface INotificationService {
  // ===== User Notifications =====

  /**
   * Send email verification notification
   * @param recipient - Notification recipient
   * @param verificationUrl - URL to verify email
   */
  sendVerification(
    recipient: NotificationRecipient,
    verificationUrl: string
  ): Promise<NotificationResult>;

  /**
   * Send password reset notification
   * @param recipient - Notification recipient
   * @param resetUrl - URL to reset password
   */
  sendPasswordReset(
    recipient: NotificationRecipient,
    resetUrl: string
  ): Promise<NotificationResult>;

  /**
   * Send welcome notification to new users
   * @param recipient - Notification recipient
   */
  sendWelcome(recipient: NotificationRecipient): Promise<NotificationResult>;

  /**
   * Send security alert notification
   * @param recipient - Notification recipient
   * @param alertType - Type of security alert (e.g., 'password_changed', 'suspicious_login')
   * @param details - Additional details about the alert
   */
  sendSecurityAlert(
    recipient: NotificationRecipient,
    alertType: string,
    details: Record<string, any>
  ): Promise<NotificationResult>;

  /**
   * Send new session/login alert notification
   * @param recipient - Notification recipient
   * @param sessionInfo - Information about the new session
   */
  sendNewSessionAlert(
    recipient: NotificationRecipient,
    sessionInfo: SessionInfo
  ): Promise<NotificationResult>;

  /**
   * Send OTP code notification (e.g., for new device verification)
   * @param recipient - Notification recipient
   * @param otp - One-time password code
   * @param context - Context about why OTP is being sent
   */
  sendOtp(
    recipient: NotificationRecipient,
    otp: string,
    context: OtpContext
  ): Promise<NotificationResult>;

  /**
   * Send a generic notification with custom content
   * @param recipient - Notification recipient
   * @param title - Notification title
   * @param content - Notification body content
   * @param action - Optional action button
   */
  sendGeneric(
    recipient: NotificationRecipient,
    title: string,
    content: string,
    action?: NotificationAction
  ): Promise<NotificationResult>;

  /**
   * Send a templated email notification
   * @param email - Recipient email address
   * @param subject - Email subject
   * @param template - Template path (e.g., 'email/mail.njk')
   * @param variables - Template variables
   * @param locale - Optional locale for the email
   */
  sendTemplatedEmail(
    email: string,
    subject: string,
    template: string,
    variables: Record<string, any>,
    locale?: string
  ): Promise<NotificationResult>;

  // ===== Recovery Notifications =====

  /**
   * Send backup code count warning notification
   * Warns user when backup codes are running low
   * @param recipient - Notification recipient
   * @param remainingCount - Number of remaining backup codes
   * @param settingsUrl - URL to account settings page
   */
  sendBackupCodeWarning(
    recipient: NotificationRecipient,
    remainingCount: number,
    settingsUrl: string
  ): Promise<NotificationResult>;

  // ===== Admin Notifications =====

  /**
   * Send admin alert notification (always uses email)
   * @param adminEmails - List of admin email addresses
   * @param subject - Alert subject
   * @param content - Alert content
   */
  sendAdminAlert(
    adminEmails: string[],
    subject: string,
    content: string
  ): Promise<NotificationResult>;

  // ===== Helpers =====

  /**
   * Get the preferred notification channel for a user
   * Based on user preferences and available contact methods
   * @param user - User object
   */
  getPreferredChannel(user: IUser): NotificationChannel;

  /**
   * Get list of available notification channels
   * Based on system configuration
   */
  getAvailableChannels(): NotificationChannel[];
}
