import { injectable, inject } from 'inversify';
import {
  parsePhoneNumber,
  isValidPhoneNumber,
  CountryCode,
} from 'libphonenumber-js';
import Twilio from 'twilio';
import { TYPES } from '../di/types.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type {
  ISmsProvider,
  SmsResult,
  PhoneValidationResult,
} from '../di/interfaces/sms-provider.interface.js';

/**
 * SMS verification code result
 */
export interface SmsVerificationResult {
  success: boolean;
  error?: string;
  messageId?: string;
  retryAfter?: number;
}

/**
 * Rate limit entry for tracking SMS sends
 */
interface RateLimitEntry {
  count: number;
  resetAt: Date;
}

/**
 * Rate limit check result
 */
interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number;
}

/**
 * SMS provider configuration
 */
interface SmsProviderConfig {
  api_key?: string;
  api_secret?: string;
  from_number?: string;
}

/**
 * SMS Service - Handles SMS sending through configured providers
 * Currently supports Twilio via official SDK. More providers can be added.
 */
@injectable()
export class SmsService {
  private provider: ISmsProvider | null = null;
  private rateLimitCache = new Map<string, RateLimitEntry>();

  constructor(
    @inject(TYPES.ConfigManager) private configManager: IConfigManager,
    @inject(TYPES.Logger) private logger: ILogger
  ) {
    this.initializeProvider();
    // Clean up expired rate limit entries every 5 minutes. The timer is
    // unref'd so it never keeps the event loop alive during graceful
    // shutdown — see https://nodejs.org/api/timers.html#timersunref
    const cleanupTimer = setInterval(
      () => this.cleanupRateLimitCache(),
      5 * 60 * 1000
    );
    cleanupTimer.unref();
  }

  /**
   * Clean up expired rate limit entries
   */
  private cleanupRateLimitCache(): void {
    const now = new Date();
    for (const [key, entry] of this.rateLimitCache.entries()) {
      if (entry.resetAt < now) {
        this.rateLimitCache.delete(key);
      }
    }
  }

  /**
   * Check rate limits before sending SMS
   */
  private checkRateLimit(phone: string, ip?: string): RateLimitResult {
    const config = this.configManager.getConfig();
    const limits = config.notifications?.channels?.sms?.rate_limits;

    if (!limits) {
      return { allowed: true };
    }

    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
    const oneDayFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const phoneKey = `phone:${phone}`;
    const phoneEntry = this.rateLimitCache.get(phoneKey);

    if (phoneEntry) {
      if (phoneEntry.resetAt > now) {
        // Still within the rate limit window
        if (phoneEntry.count >= (limits.per_phone_per_hour || 3)) {
          const retryAfter = Math.ceil(
            (phoneEntry.resetAt.getTime() - now.getTime()) / 1000
          );
          this.logger.warn('SMS rate limit exceeded for phone', {
            phone,
            count: phoneEntry.count,
          });
          return { allowed: false, retryAfter };
        }
      } else {
        this.rateLimitCache.delete(phoneKey);
      }
    }

    if (ip) {
      const ipKey = `ip:${ip}`;
      const ipEntry = this.rateLimitCache.get(ipKey);

      if (ipEntry) {
        if (ipEntry.resetAt > now) {
          if (ipEntry.count >= (limits.per_ip_per_day || 10)) {
            const retryAfter = Math.ceil(
              (ipEntry.resetAt.getTime() - now.getTime()) / 1000
            );
            this.logger.warn('SMS rate limit exceeded for IP', {
              ip,
              count: ipEntry.count,
            });
            return { allowed: false, retryAfter };
          }
        } else {
          this.rateLimitCache.delete(ipKey);
        }
      }
    }

    const cooldownKey = `cooldown:${phone}`;
    const cooldownEntry = this.rateLimitCache.get(cooldownKey);
    const cooldownSeconds = limits.cooldown_seconds || 60;

    if (cooldownEntry && cooldownEntry.resetAt > now) {
      const retryAfter = Math.ceil(
        (cooldownEntry.resetAt.getTime() - now.getTime()) / 1000
      );
      this.logger.warn('SMS cooldown active for phone', { phone, retryAfter });
      return { allowed: false, retryAfter };
    }

    const existingPhoneEntry = this.rateLimitCache.get(phoneKey);
    if (existingPhoneEntry && existingPhoneEntry.resetAt > now) {
      existingPhoneEntry.count++;
    } else {
      this.rateLimitCache.set(phoneKey, { count: 1, resetAt: oneHourFromNow });
    }

    if (ip) {
      const ipKey = `ip:${ip}`;
      const existingIpEntry = this.rateLimitCache.get(ipKey);
      if (existingIpEntry && existingIpEntry.resetAt > now) {
        existingIpEntry.count++;
      } else {
        this.rateLimitCache.set(ipKey, { count: 1, resetAt: oneDayFromNow });
      }
    }

    const cooldownResetAt = new Date(now.getTime() + cooldownSeconds * 1000);
    this.rateLimitCache.set(cooldownKey, {
      count: 1,
      resetAt: cooldownResetAt,
    });

    return { allowed: true };
  }

  /**
   * Initialize the SMS provider based on configuration
   */
  private initializeProvider(): void {
    const config = this.configManager.getConfig();
    const smsConfig = config.notifications?.channels?.sms;

    if (!smsConfig?.enabled) {
      this.logger.info('SMS service disabled in configuration');
      return;
    }

    const providerName = smsConfig.provider;

    if (!providerName) {
      this.logger.warn('SMS enabled but no provider configured');
      return;
    }

    try {
      if (providerName === 'twilio') {
        this.provider = new TwilioProvider(smsConfig, this.logger);
      } else {
        this.logger.error(
          `Unknown SMS provider: ${providerName}. Only 'twilio' is supported.`
        );
      }
    } catch (error) {
      this.logger.error('Failed to initialize SMS provider', {
        provider: providerName,
        error,
      });
    }
  }

  /**
   * Check if SMS service is available
   */
  isAvailable(): boolean {
    return this.provider !== null && this.provider.isConfigured();
  }

  /**
   * Get the current provider name
   */
  getProviderName(): string | null {
    return this.provider?.getProviderName() || null;
  }

  /**
   * Send a verification code via SMS
   * @param phone - Phone number to send to
   * @param code - Verification code
   * @param ip - Optional IP address for rate limiting
   */
  async sendVerificationCode(
    phone: string,
    code: string,
    ip?: string
  ): Promise<SmsVerificationResult> {
    if (!this.provider) {
      return { success: false, error: 'SMS service not configured' };
    }

    const rateLimitResult = this.checkRateLimit(phone, ip);
    if (!rateLimitResult.allowed) {
      return {
        success: false,
        error: 'Too many SMS requests. Please try again later.',
        retryAfter: rateLimitResult.retryAfter,
      };
    }

    const config = this.configManager.getConfig();
    const appName = config.branding?.companyName || 'Application';

    const message = `Your ${appName} verification code is: ${code}. This code expires in 15 minutes.`;

    try {
      const result = await this.provider.sendSms(phone, message);
      return {
        success: result.success,
        error: result.error,
        messageId: result.messageId,
      };
    } catch (error) {
      this.logger.error('Failed to send verification SMS', { phone, error });
      return { success: false, error: 'Failed to send SMS' };
    }
  }

  /**
   * Send a recovery code via SMS
   * @param phone - Phone number to send to
   * @param code - Recovery code
   * @param ip - Optional IP address for rate limiting
   */
  async sendRecoveryCode(
    phone: string,
    code: string,
    ip?: string
  ): Promise<SmsVerificationResult> {
    if (!this.provider) {
      return { success: false, error: 'SMS service not configured' };
    }

    const rateLimitResult = this.checkRateLimit(phone, ip);
    if (!rateLimitResult.allowed) {
      return {
        success: false,
        error: 'Too many SMS requests. Please try again later.',
        retryAfter: rateLimitResult.retryAfter,
      };
    }

    const config = this.configManager.getConfig();
    const appName = config.branding?.companyName || 'Application';

    const message = `Your ${appName} account recovery code is: ${code}. This code expires in 15 minutes. If you didn't request this, please ignore.`;

    try {
      const result = await this.provider.sendSms(phone, message);
      return {
        success: result.success,
        error: result.error,
        messageId: result.messageId,
      };
    } catch (error) {
      this.logger.error('Failed to send recovery SMS', { phone, error });
      return { success: false, error: 'Failed to send SMS' };
    }
  }

  /**
   * Validate a phone number using libphonenumber-js
   */
  validatePhoneNumber(
    phone: string,
    defaultCountry?: string
  ): PhoneValidationResult {
    try {
      // Use libphonenumber-js for robust validation
      const countryCode = defaultCountry as CountryCode | undefined;

      if (!isValidPhoneNumber(phone, countryCode)) {
        return {
          valid: false,
          error:
            'Invalid phone number format. Please include country code (e.g., +1 for US).',
        };
      }

      const parsed = parsePhoneNumber(phone, countryCode);

      return {
        valid: true,
        formatted: parsed.format('E.164'),
        countryCode: parsed.country,
      };
    } catch {
      return {
        valid: false,
        error:
          'Could not parse phone number. Please use international format (e.g., +14155552671).',
      };
    }
  }
}

/**
 * Twilio SMS Provider Implementation using official SDK
 */
class TwilioProvider implements ISmsProvider {
  private accountSid: string;
  private authToken: string;
  private fromNumber: string;
  private client: ReturnType<typeof Twilio> | null = null;

  constructor(
    config: SmsProviderConfig,
    private logger: ILogger
  ) {
    this.accountSid = config.api_key || '';
    this.authToken = config.api_secret || '';
    this.fromNumber = config.from_number || '';

    if (this.isConfigured()) {
      this.client = Twilio(this.accountSid, this.authToken);
      this.logger.info('Twilio SMS provider initialized');
    }
  }

  getProviderName(): string {
    return 'twilio';
  }

  isConfigured(): boolean {
    return !!(this.accountSid && this.authToken && this.fromNumber);
  }

  async sendSms(to: string, message: string): Promise<SmsResult> {
    if (!this.isConfigured() || !this.client) {
      return { success: false, error: 'Twilio not properly configured' };
    }

    try {
      const result = await this.client.messages.create({
        body: message,
        to,
        from: this.fromNumber,
      });

      this.logger.info('SMS sent via Twilio', { messageId: result.sid, to });
      return { success: true, messageId: result.sid };
    } catch (error) {
      // Twilio SDK throws typed errors with code, message, status
      const twilioError = error as {
        code?: number;
        message?: string;
        status?: number;
        moreInfo?: string;
      };

      this.logger.error('Twilio send error', {
        code: twilioError.code,
        message: twilioError.message,
        status: twilioError.status,
        moreInfo: twilioError.moreInfo,
      });

      return {
        success: false,
        error: twilioError.message || 'Failed to send SMS via Twilio',
      };
    }
  }

  validatePhoneNumber(
    phone: string,
    _defaultCountry?: string
  ): PhoneValidationResult {
    // Basic E.164 validation
    const cleaned = phone.replace(/[^\d+]/g, '');

    if (!/^\+\d{10,15}$/.test(cleaned)) {
      return {
        valid: false,
        error:
          'Invalid phone number. Please use international format (e.g., +1234567890)',
      };
    }

    return { valid: true, formatted: cleaned };
  }
}

export default SmsService;
