/**
 * Interface for email service
 * Defines the contract for email operations
 */
export interface IEmailService {
  /**
   * Initialize the email service with configuration
   */
  initialize(): void;

  /**
   * Connect to email server
   * @param skipEnvs - Environments to skip connection
   * @returns Promise that resolves to connection status
   */
  connectToEmailServer(skipEnvs?: string[]): Promise<boolean>;

  /**
   * Close the SMTP connection pool
   * Should be called on application shutdown
   */
  closeConnection(): Promise<void>;

  /**
   * Send a basic email
   * @param to - Recipient email address
   * @param subject - Email subject
   * @param text - Plain text content
   * @param html - HTML content
   */
  sendEmail(
    to: string,
    subject: string,
    text?: string,
    html?: string
  ): Promise<void>;

  /**
   * Render an email template with data
   * @param template - Template name
   * @param templateData - Data to populate template
   * @returns Rendered HTML string
   */
  renderTemplate(template: string, templateData: Record<string, any>): string;

  /**
   * Send a templated email
   * @param to - Recipient email address
   * @param subject - Email subject
   * @param template - Template name
   * @param templateData - Data to populate template
   * @param locale - Optional locale for email content
   */
  sendTemplatedEmail(
    to: string,
    subject: string,
    template: string,
    templateData: Record<string, any>,
    locale?: string
  ): Promise<void>;

  /**
   * Send email verification email
   * @param to - Recipient email address
   * @param username - Username
   * @param verificationUrl - Verification URL
   * @param locale - Optional locale for email content
   */
  sendVerificationEmail(
    to: string,
    username: string,
    verificationUrl: string,
    locale?: string
  ): Promise<void>;

  /**
   * Send password reset email
   * @param to: Recipient email address
   * @param username - Username
   * @param resetUrl - Password reset URL
   * @param locale - Optional locale for email content
   */
  sendPasswordResetEmail(
    to: string,
    username: string,
    resetUrl: string,
    locale?: string
  ): Promise<void>;

  /**
   * Send welcome email
   * @param to - Recipient email address
   * @param username - Username
   * @param locale - Optional locale for email content
   */
  sendWelcomeEmail(
    to: string,
    username: string,
    locale?: string
  ): Promise<void>;

  /**
   * Send security alert email
   * @param to - Recipient email address
   * @param username - Username
   * @param alertType - Type of security alert
   * @param details - Alert details
   * @param locale - Optional locale for email content
   */
  sendSecurityAlertEmail(
    to: string,
    username: string,
    alertType: string,
    details: string,
    locale?: string
  ): Promise<void>;

  /**
   * Send new session notification email
   * Notifies user of a new login to their account
   * @param data - Session notification data
   */
  sendNewSessionNotification(data: {
    email: string;
    username: string;
    ip: string;
    userAgent: string;
    timestamp: Date;
    locale?: string;
  }): Promise<void>;

  /**
   * Send OTP code for new device verification
   * @param data - New device OTP data
   */
  sendNewDeviceOtpEmail(data: {
    email: string;
    username: string;
    otp: string;
    deviceInfo: string;
    ip: string;
    locale?: string;
  }): Promise<void>;

  /**
   * Send notification email
   * @param to - Recipient email address
   * @param username - Username
   * @param notificationTitle - Notification title
   * @param notificationContent - Notification content
   * @param actionUrl - Optional action URL
   * @param actionText - Optional action text
   * @param locale - Optional locale for email content
   */
  sendNotificationEmail(
    to: string,
    username: string,
    notificationTitle: string,
    notificationContent: string,
    actionUrl?: string,
    actionText?: string,
    locale?: string
  ): Promise<void>;
}
