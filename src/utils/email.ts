import nunjucks from 'nunjucks';
import nodemailer, { type Transporter } from 'nodemailer';
import { injectable, inject } from 'inversify';
import path from 'node:path';
import fs from 'node:fs';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import { IEmailService } from '../di/interfaces/email-service.interface.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IFileSystemUtils } from '../di/interfaces/file-system-utils.interface.js';
import type { II18nService } from '../di/interfaces/i18n-service.interface.js';
import { TYPES } from '../di/types.js';
import { escapeHtml } from './views.js';

export interface EmailAction {
  text: string;
  url: string;
}

export interface EmailTemplateData {
  title: string;
  content: string;
  username?: string;
  actions?: EmailAction[];
  [key: string]: any;
}

@injectable()
export default class EmailUtils implements IEmailService {
  private transporter: Transporter;
  private isConnectingToEmailServer = false;
  private templatePath: string = '';
  private customEmailTemplate: string | null = null;
  private nunjucksEnv: nunjucks.Environment | null = null;
  private configManager: IConfigManager;

  constructor(
    @inject(TYPES.ConfigManager) configManager: IConfigManager,
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.FileSystemUtils)
    private readonly fileSystemUtils: IFileSystemUtils,
    @inject(TYPES.I18nService) private readonly i18nService: II18nService
  ) {
    this.configManager = configManager;
    // Don't access config in constructor - it will be initialized later
    this.transporter = null as any;

    this.configManager.subscribe('EmailUtils', _updatedConfig => {
      this.logger.info('Configuration updated, reinitializing email service');
      this.initialize();
    });
  }

  /**
   * Initialize the email service with configuration
   */
  public initialize(): void {
    const emailConfig = this.configManager.getConfig().integrations.email;

    // In production, enforce TLS verification by default to prevent MITM attacks
    // Can be overridden via config for environments with self-signed certs
    const isProduction =
      this.configManager.getConfig().deployment.environment === 'production';
    const rejectUnauthorized =
      emailConfig.tls_reject_unauthorized ?? isProduction;

    this.transporter = nodemailer.createTransport({
      host: emailConfig.smtp_host,
      port: emailConfig.smtp_port,
      secure: false,
      pool: true, // Enable connection pooling for faster email sending
      maxConnections: 5, // Maintain up to 5 concurrent connections
      maxMessages: 100, // Reuse each connection for 100 emails
      auth: {
        user: emailConfig.smtp_username,
        pass: emailConfig.smtp_password,
      },
      tls: {
        rejectUnauthorized,
      },
    });

    this.initializeEmailTemplate();
  }

  /**
   * Initialize email template - check for custom template or use default
   */
  private initializeEmailTemplate(): void {
    const uiConfig = this.configManager.getConfig().branding?.ui?.customization;

    if (uiConfig?.enabled && uiConfig?.views?.email?.mail) {
      const customTemplatePath = path.join(
        this.fileSystemUtils.rootDir,
        uiConfig.rootPath || 'runtime/views',
        uiConfig.views.email.mail
      );

      if (this.isValidTemplateFile(customTemplatePath)) {
        this.customEmailTemplate = customTemplatePath;
        this.templatePath = path.dirname(customTemplatePath);

        this.logger.info('Custom email template loaded', {
          customTemplate: path.basename(customTemplatePath),
        });

        this.nunjucksEnv = new nunjucks.Environment(
          new nunjucks.FileSystemLoader(this.templatePath),
          {
            autoescape: true,
            noCache:
              this.configManager.getConfig().deployment.environment !==
              'production',
            throwOnUndefined: false,
            trimBlocks: true,
            lstripBlocks: true,
          }
        );
        return;
      } else {
        this.logger.warn(
          'Custom email template configured but not found or invalid',
          {
            configuredPath: uiConfig.views.email.mail,
            fullPath: customTemplatePath,
          }
        );
      }
    }

    // Fallback to default template
    this.templatePath = path.join(
      this.fileSystemUtils.rootDir,
      'dist',
      'src',
      'views'
    );
    this.customEmailTemplate = null;

    this.nunjucksEnv = new nunjucks.Environment(
      new nunjucks.FileSystemLoader(this.templatePath),
      {
        autoescape: true,
        noCache:
          this.configManager.getConfig().deployment.environment !==
          'production',
        throwOnUndefined: false,
        trimBlocks: true,
        lstripBlocks: true,
      }
    );
  }

  /**
   * Check if a template file exists and is valid
   */
  private isValidTemplateFile(filePath: string): boolean {
    try {
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return false;
      }

      const stats = fs.statSync(filePath);
      if (stats.size === 0) {
        return false;
      }

      const content = fs.readFileSync(filePath, 'utf8');
      if (!content.trim()) {
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error((error as Error).message, {
        context: 'failed_to_check_if_template_file_exists',
        filePath,
      });
      return false;
    }
  }

  public async connectToEmailServer(
    skipEnvs: string[] = ['test']
  ): Promise<boolean> {
    if (
      skipEnvs.includes(this.configManager.getConfig().deployment.environment)
    ) {
      this.logger.info(
        `Email server connection skipped for environment: ${this.configManager.getConfig().deployment.environment}`
      );
      return true;
    }

    try {
      await this.transporter.verify();
      this.logger.info(
        '🟢 Connected to email server (with connection pooling)'
      );
      this.isConnectingToEmailServer = true;
      return true;
    } catch (error) {
      this.logger.warn(
        '🔴 Unable to connect to email server. Make sure you have configured the SMTP options.'
      );
      this.logger.error((error as Error).message, {
        context: 'failed_to_connect_to_email_server',
        skipEnvs,
      });
      return false;
    }
  }

  /**
   * Close the SMTP connection pool (call on app shutdown)
   */
  public async closeConnection(): Promise<void> {
    if (this.transporter) {
      this.transporter.close();
      this.logger.info('SMTP connection pool closed');
    }
  }

  public async sendEmail(
    to: string,
    subject: string,
    text?: string,
    html?: string
  ): Promise<void> {
    if (!this.isConnectingToEmailServer) {
      const isConnected = await this.connectToEmailServer();

      if (!isConnected) {
        this.logger.error('Cannot send email: not connected to email server');
        throw new Error('Email server not connected');
      }

      this.isConnectingToEmailServer = true;
    }

    const mailOptions = {
      from: `${this.configManager.getConfig().integrations.email.from}`,
      to,
      subject,
    };

    if (text) {
      Object.assign(mailOptions, { text });
    }
    if (html) {
      Object.assign(mailOptions, { html });
    }

    try {
      await this.transporter.sendMail(mailOptions);
      this.logger.info(`Email sent successfully to ${to}`);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'email_sending_failed',
        to,
      });
      throw error;
    }
  }

  private getCommonTemplateData(
    templateData: Record<string, unknown> = {},
    locale?: string
  ): Record<string, unknown> {
    const currentConfig = this.configManager.getConfig();
    const brandingConfig = currentConfig.branding;

    if (locale) {
      this.i18nService.setLocale(locale);
    }

    const t = (key: string): string => {
      return this.i18nService.__(key);
    };

    return {
      ...templateData,
      currentYear: new Date().getFullYear(),
      appTitle: currentConfig.application.title,
      appDescription: currentConfig.application.description,
      companyName: brandingConfig.companyName,
      branding: brandingConfig,
      brandColors: {
        primary: brandingConfig.colors?.light?.primary || '#2563eb',
      },
      appUrl: currentConfig.deployment.url,
      websiteUrl: currentConfig.integrations.urls.website,
      privacyUrl:
        templateData.privacyUrl ||
        currentConfig.integrations.urls.privacy_policy,
      termsUrl: currentConfig.integrations.urls.terms_of_service,
      contactUrl: currentConfig.integrations.urls.contact,
      locale: locale || currentConfig.application.locales.default,
      t, // Add translation function to template context
    };
  }

  public renderTemplate(
    template: string,
    templateData: Record<string, unknown>,
    locale?: string
  ): string {
    try {
      const data = this.getCommonTemplateData(templateData, locale);

      // Use custom template if available, otherwise use the provided template
      let templateToUse: string;
      if (this.customEmailTemplate) {
        // When using custom template, just use the filename since templatePath is set to the directory
        templateToUse = path.basename(this.customEmailTemplate);
      } else {
        templateToUse = template;
      }

      if (!this.nunjucksEnv) {
        throw new Error('Nunjucks environment not initialized');
      }

      return this.nunjucksEnv.render(templateToUse, data);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'email_template_rendering_failed',
        template,
        customTemplateUsed: !!this.customEmailTemplate,
        customTemplatePath: this.customEmailTemplate,
        templatePath: this.templatePath,
        locale,
      });
      throw error;
    }
  }

  public async sendTemplatedEmail(
    to: string,
    subject: string,
    template: string,
    templateData: Record<string, unknown>,
    locale?: string
  ): Promise<void> {
    try {
      const html = this.renderTemplate(template, templateData, locale);

      let text = '';
      if (templateData.content) {
        // Robust HTML tag removal that handles multi-character sanitization properly
        text = this.stripHtmlTags(String(templateData.content));
      } else if (templateData.title) {
        text = String(templateData.title);
      } else {
        text = subject;
      }

      await this.sendEmail(to, subject, text, html);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'templated_email_sending_failed',
        to,
        template,
      });
      throw error;
    }
  }

  public async sendVerificationEmail(
    to: string,
    username: string,
    verificationUrl: string,
    locale?: string
  ): Promise<void> {
    if (locale) {
      this.i18nService.setLocale(locale);
    }

    await this.sendTemplatedEmail(
      to,
      this.i18nService.__('email.subject.email_verification'),
      'email/mail.njk',
      {
        title: this.i18nService.__('email.verification.title'),
        content: `
          <p>${this.i18nService.__('email.verification.body')}</p>
          <p>${this.i18nService.__('email.verification.expires').replace('{{hours}}', '24')}</p>
          <p>${this.i18nService.__('email.verification.ignore')}</p>
        `,
        username,
        actions: [
          {
            text: this.i18nService.__('email.verification.button'),
            url: verificationUrl,
          },
        ],
      },
      locale
    );
  }

  public async sendPasswordResetEmail(
    to: string,
    username: string,
    resetUrl: string,
    locale?: string
  ): Promise<void> {
    if (locale) {
      this.i18nService.setLocale(locale);
    }

    await this.sendTemplatedEmail(
      to,
      this.i18nService.__('email.subject.password_reset'),
      'email/mail.njk',
      {
        title: this.i18nService.__('email.password_reset.title'),
        content: `
          <p>${this.i18nService.__('email.password_reset.body')}</p>
          <p>${this.i18nService.__('email.password_reset.expires').replace('{{hours}}', '1')}</p>
          <p>${this.i18nService.__('email.password_reset.ignore')}</p>
        `,
        username,
        actions: [
          {
            text: this.i18nService.__('email.password_reset.button'),
            url: resetUrl,
          },
        ],
      },
      locale
    );
  }

  public async sendWelcomeEmail(
    to: string,
    username: string,
    locale?: string
  ): Promise<void> {
    if (locale) {
      this.i18nService.setLocale(locale);
    }

    const currentConfig = this.configManager.getConfig();
    const appName = currentConfig.application.title;
    const appDescription = currentConfig.application.description;

    await this.sendTemplatedEmail(
      to,
      this.safeReplace(
        this.i18nService.__('email.subject.welcome'),
        '{{appName}}',
        appName
      ),
      'email/mail.njk',
      {
        title: this.safeReplace(
          this.i18nService.__('email.welcome.title'),
          '{{appName}}',
          appName
        ),
        content: `
          <p>${this.safeReplace(this.i18nService.__('email.welcome.body_intro'), '{{appName}}', appName)}</p>
          <p>${this.safeReplace(this.i18nService.__('email.welcome.body_description'), '{{appDescription}}', appDescription)}</p>
          <p>${this.safeReplace(this.i18nService.__('email.welcome.features_intro'), '{{appName}}', appName)}</p>
          <ul>
            <li>${this.i18nService.__('email.welcome.feature_1')}</li>
            <li>${this.i18nService.__('email.welcome.feature_2')}</li>
            <li>${this.i18nService.__('email.welcome.feature_3')}</li>
          </ul>
          <p>${this.i18nService.__('email.welcome.get_started')}</p>
        `,
        username,
        actions: [
          {
            text: this.i18nService.__('email.welcome.button'),
            url: `${currentConfig.deployment.url}/accounts/`,
          },
        ],
      },
      locale
    );
  }

  public async sendSecurityAlertEmail(
    to: string,
    username: string,
    alertType: string,
    details: string,
    locale?: string
  ): Promise<void> {
    if (locale) {
      this.i18nService.setLocale(locale);
    }

    const currentConfig = this.configManager.getConfig();
    const appName = currentConfig.application.title;

    await this.sendTemplatedEmail(
      to,
      this.i18nService.__('email.subject.security_alert'),
      'email/mail.njk',
      {
        title: this.safeReplace(
          this.i18nService.__('email.security_alert.title'),
          '{{alertType}}',
          alertType
        ),
        content: `
          <p>${this.safeReplace(this.i18nService.__('email.security_alert.body'), '{{appName}}', appName)}</p>
          <p><strong>${this.i18nService.__('email.security_alert.alert_type_label')}</strong> ${escapeHtml(alertType)}</p>
          <p><strong>${this.i18nService.__('email.security_alert.details_label')}</strong> ${escapeHtml(details)}</p>
          <p>${this.i18nService.__('email.security_alert.not_you')}</p>
        `,
        username,
        actions: [
          {
            text: this.i18nService.__('email.security_alert.button'),
            url: `${currentConfig.deployment.url}/accounts/`,
          },
        ],
      },
      locale
    );
  }

  public async sendNewSessionNotification(data: {
    email: string;
    username: string;
    ip: string;
    userAgent: string;
    timestamp: Date;
    locale?: string;
  }): Promise<void> {
    if (data.locale) {
      this.i18nService.setLocale(data.locale);
    }

    const currentConfig = this.configManager.getConfig();
    const appName = currentConfig.application.title;
    const formattedTime = data.timestamp.toLocaleString();

    await this.sendTemplatedEmail(
      data.email,
      this.safeReplace(
        this.i18nService.__('email.subject.new_session'),
        '{{appName}}',
        appName
      ),
      'email/mail.njk',
      {
        title: this.i18nService.__('email.new_session.title'),
        content: `
          <p>${this.safeReplace(this.i18nService.__('email.new_session.body'), '{{appName}}', appName)}</p>
          <p><strong>${this.i18nService.__('email.new_session.time_label')}</strong> ${escapeHtml(formattedTime)}</p>
          <p><strong>${this.i18nService.__('email.new_session.ip_label')}</strong> ${escapeHtml(data.ip)}</p>
          <p><strong>${this.i18nService.__('email.new_session.device_label')}</strong> ${escapeHtml(data.userAgent)}</p>
          <p>${this.i18nService.__('email.new_session.not_you')}</p>
        `,
        username: data.username,
        actions: [
          {
            text: this.i18nService.__('email.new_session.button'),
            url: `${currentConfig.deployment.url}/accounts/security`,
          },
        ],
      },
      data.locale
    );
  }

  /**
   * Send OTP code for new device verification
   */
  public async sendNewDeviceOtpEmail(data: {
    email: string;
    username: string;
    otp: string;
    deviceInfo: string;
    ip: string;
    locale?: string;
  }): Promise<void> {
    if (data.locale) {
      this.i18nService.setLocale(data.locale);
    }

    const currentConfig = this.configManager.getConfig();
    const appName = currentConfig.application.title;

    await this.sendTemplatedEmail(
      data.email,
      this.safeReplace(
        this.i18nService.__('email.subject.new_device_otp'),
        '{{appName}}',
        appName
      ),
      'email/mail.njk',
      {
        title: this.i18nService.__('email.new_device_otp.title'),
        content: `
          <p>${this.safeReplace(this.i18nService.__('email.new_device_otp.body'), '{{appName}}', appName)}</p>
          <p style="text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; padding: 20px; background: #f5f5f5; border-radius: 8px; margin: 20px 0;">${escapeHtml(data.otp)}</p>
          <p><strong>${this.i18nService.__('email.new_device_otp.device_label')}</strong> ${escapeHtml(data.deviceInfo)}</p>
          <p><strong>${this.i18nService.__('email.new_device_otp.ip_label')}</strong> ${escapeHtml(data.ip)}</p>
          <p>${this.i18nService.__('email.new_device_otp.expires')}</p>
          <p>${this.i18nService.__('email.new_device_otp.not_you')}</p>
        `,
        username: data.username,
      },
      data.locale
    );
  }

  public async sendNotificationEmail(
    to: string,
    username: string,
    notificationTitle: string,
    notificationContent: string,
    actionUrl?: string,
    actionText?: string
  ): Promise<void> {
    const templateData: Record<string, any> = {
      title: notificationTitle,
      content: notificationContent,
      username,
    };

    if (actionUrl && actionText) {
      templateData.actions = [
        {
          text: actionText,
          url: actionUrl,
        },
      ];
    }

    await this.sendTemplatedEmail(
      to,
      notificationTitle,
      'email/mail.njk',
      templateData
    );
  }

  /**
   * Safely replace a placeholder in a template string with an HTML-escaped value.
   * Prevents XSS by escaping the replacement value before insertion.
   * @param template - The template string with placeholder
   * @param placeholder - The placeholder to replace (e.g., '{{name}}')
   * @param value - The value to insert (will be HTML-escaped)
   * @returns The template with the placeholder replaced by the escaped value
   */
  private safeReplace(
    template: string,
    placeholder: string,
    value: string
  ): string {
    return template.replace(placeholder, escapeHtml(value));
  }

  /**
   * Robustly strips HTML tags from text content.
   * Uses iterative replacement to handle multi-character sanitization properly.
   * This prevents incomplete sanitization where partial tags can be left behind.
   */
  private stripHtmlTags(input: string): string {
    if (!input || typeof input !== 'string') {
      return '';
    }

    let result = input;
    let previous = '';

    // Iteratively remove HTML tags until no more can be removed
    // a single pass would leave behind partial tags
    do {
      previous = result;
      result = result.replace(/<[^>]*>/g, '');
      // Also remove any remaining < or > characters that might be left behind
      result = result.replace(/[<>]/g, '');
    } while (result !== previous);

    result = result.replace(/\s+/g, ' ').trim();

    return result;
  }
}
