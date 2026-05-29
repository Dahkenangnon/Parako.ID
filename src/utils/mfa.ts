import {
  generateSecret as otpGenerateSecret,
  generateURI,
  verifySync,
} from 'otplib';
import QRCode from 'qrcode';
import crypto from 'node:crypto';
import { injectable, inject } from 'inversify';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import { IMfaUtils } from '../di/interfaces/mfa-utils.interface.js';
import { TYPES } from '../di/types.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import { type IUser } from '../types/user.js';
import { ensureDecrypted } from './encryption.js';

/**
 * MFA method types supported by the system
 */
export type MfaMethod = 'totp' | 'sms' | 'email' | 'webauthn';

/**
 * Update object for enabling/disabling MFA methods
 * Uses MongoDB dot notation for partial updates
 */
export interface MfaMethodUpdate {
  [key: string]: boolean | string | Date | undefined;
}

/**
 * TOTP verification result
 */
export interface TotpVerificationResult {
  valid: boolean;
  error?: string;
}

/**
 * Email OTP generation result
 */
export interface EmailOtpResult {
  code: string;
  hash: string;
  expiresAt: Date;
}

/**
 * QR Code generation result
 */
export interface QrCodeResult {
  otpauth: string;
  qrDataUri: string;
}

/**
 * MFA setup result
 */
export interface MfaSetupResult {
  secret: string;
  qrCode: QrCodeResult;
  backup_codes?: string[];
}

/**
 * Centralized MFA utility class
 * Contains all common MFA/TOTP logic used across the application
 */
@injectable()
export class MfaUtils implements IMfaUtils {
  readonly HASH_ALGORITHM = 'sha256';
  readonly EMAIL_OTP_LENGTH = 6;

  /**
   * Injected dependencies
   */
  private configManager: IConfigManager;
  private logger: ILogger;
  /**
   * Constructor with dependency injection
   * @param configManager - Configuration manager instance
   */
  constructor(
    @inject(TYPES.ConfigManager) configManager: IConfigManager,
    @inject(TYPES.Logger) logger: ILogger
  ) {
    this.logger = logger;
    this.configManager = configManager;
  }

  /**
   * Generate a new TOTP secret
   */
  generateTotpSecret(): string {
    try {
      return otpGenerateSecret();
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'totp_secret_generation_failed',
      });
      throw new Error('Failed to generate TOTP secret');
    }
  }

  /**
   * Generate TOTP URI for QR code
   */
  generateTotpUri(accountName: string, secret: string, issuer: string): string {
    try {
      if (!accountName || !secret) {
        throw new Error('Account name and secret are required');
      }

      return generateURI({ issuer, label: accountName, secret });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'totp_uri_generation_failed',
        accountName,
        issuer,
      });
      throw new Error('Failed to generate TOTP URI');
    }
  }

  /**
   * Generate QR code data URI from TOTP URI
   */
  async generateQrCode(otpauth: string): Promise<string> {
    try {
      if (!otpauth) {
        throw new Error('TOTP URI is required');
      }

      return await QRCode.toDataURL(otpauth);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'qr_code_generation_failed',
        otpauth,
      });
      throw new Error('Failed to generate QR code');
    }
  }

  /**
   * Complete MFA setup with secret generation and QR code
   */
  async setupTotp(
    accountName: string,
    issuer: string
  ): Promise<MfaSetupResult> {
    try {
      const secret = this.generateTotpSecret();
      const otpauth = this.generateTotpUri(accountName, secret, issuer);
      const qrDataUri = await this.generateQrCode(otpauth);

      return {
        secret,
        qrCode: {
          otpauth,
          qrDataUri,
        },
      };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'mfa_setup_failed',
        accountName,
        issuer,
      });
      throw new Error('Failed to setup MFA');
    }
  }

  /**
   * Verify TOTP code
   */
  verifyTotpCode(code: string, secret: string): TotpVerificationResult {
    try {
      if (!code || !secret) {
        return {
          valid: false,
          error: 'Code and secret are required',
        };
      }

      const sanitizedCode = code.replace(/\s+/g, '');
      if (!new RegExp(`^\\d{${this.EMAIL_OTP_LENGTH}}$`).test(sanitizedCode)) {
        return {
          valid: false,
          error: `Code must be exactly ${this.EMAIL_OTP_LENGTH} digits`,
        };
      }

      const { valid } = verifySync({ secret, token: sanitizedCode });

      return { valid };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'totp_verification_error',
        codeLength: code?.length,
      });
      return {
        valid: false,
        error: 'TOTP verification failed',
      };
    }
  }

  /**
   * Validate TOTP code format
   */
  validateTotpCodeFormat(code: string): {
    valid: boolean;
    sanitized?: string;
    error?: string;
  } {
    try {
      if (!code || typeof code !== 'string') {
        return { valid: false, error: 'TOTP code is required' };
      }

      const sanitized = code.replace(/\s+/g, '');

      if (!new RegExp(`^\\d{${this.EMAIL_OTP_LENGTH}}$`).test(sanitized)) {
        return {
          valid: false,
          error: `TOTP code must be exactly ${this.EMAIL_OTP_LENGTH} digits`,
        };
      }

      return { valid: true, sanitized };
    } catch (error) {
      this.logger.error((error as Error).message, {
        context: 'validate_totp_code_format_error',
        code,
      });
      return { valid: false, error: 'Invalid code format' };
    }
  }

  /**
   * Generate email OTP code
   */
  generateEmailOtp(ttlSeconds: number = 600): EmailOtpResult {
    try {
      if (ttlSeconds <= 0 || ttlSeconds > 3600) {
        throw new Error('TTL must be between 1 and 3600 seconds');
      }

      // crypto.randomInt(min, max) generates in range [min, max)
      const minValue = Math.pow(10, this.EMAIL_OTP_LENGTH - 1); // 100000 for 6 digits
      const maxValue = Math.pow(10, this.EMAIL_OTP_LENGTH); // 1000000 (exclusive)
      const code = crypto.randomInt(minValue, maxValue).toString();

      const hash = crypto
        .createHash(this.HASH_ALGORITHM)
        .update(code)
        .digest('hex');

      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

      return { code, hash, expiresAt };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'email_otp_generation_failed',
        ttlSeconds,
      });
      throw new Error('Failed to generate email OTP');
    }
  }

  /**
   * Verify email OTP code
   */
  verifyEmailOtp(
    code: string,
    storedHash: string,
    expiresAt: Date
  ): TotpVerificationResult {
    try {
      if (!code || !storedHash) {
        return {
          valid: false,
          error: 'Code and stored hash are required',
        };
      }

      if (expiresAt < new Date()) {
        return {
          valid: false,
          error: 'Email OTP has expired',
        };
      }

      const providedHash = crypto
        .createHash(this.HASH_ALGORITHM)
        .update(code.trim())
        .digest('hex');

      const providedBuffer = Buffer.from(providedHash, 'utf8');
      const storedBuffer = Buffer.from(storedHash, 'utf8');
      const valid =
        providedBuffer.length === storedBuffer.length &&
        crypto.timingSafeEqual(providedBuffer, storedBuffer);

      return { valid };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'email_otp_verification_error',
      });
      return {
        valid: false,
        error: 'Email OTP verification failed',
      };
    }
  }

  /**
   * Check if user has MFA enabled (master toggle)
   */
  isMfaEnabled(user: IUser): boolean {
    return Boolean(user.mfa?.enabled);
  }

  /**
   * Check if user has TOTP enabled (multi-method schema)
   */
  isTotpEnabled(user: IUser): boolean {
    return Boolean(
      user.mfa?.enabled &&
      user.mfa?.methods?.totp?.enabled &&
      user.mfa?.methods?.totp?.secret
    );
  }

  /**
   * Check if user has a pending TOTP setup (secret stored but not yet verified)
   */
  isTotpPendingSetup(user: IUser): boolean {
    return Boolean(
      user.mfa?.methods?.totp?.secret && !user.mfa?.methods?.totp?.enabled
    );
  }

  /**
   * Check if user has a pending email MFA setup (OTP hash stored but email not yet enabled)
   */
  isEmailMfaPendingSetup(user: IUser): boolean {
    return Boolean(
      user.mfa?.email_otp?.hash &&
      user.mfa?.email_otp?.expires &&
      user.mfa.email_otp.expires > new Date() &&
      !user.mfa?.methods?.email?.enabled
    );
  }

  /**
   * Check if user has email MFA enabled (multi-method schema)
   */
  isEmailMfaEnabled(user: IUser): boolean {
    return Boolean(user.mfa?.enabled && user.mfa?.methods?.email?.enabled);
  }

  /**
   * Check if user has WebAuthn MFA enabled (multi-method schema)
   */
  isWebAuthnEnabled(user: IUser): boolean {
    return Boolean(
      user.mfa?.enabled &&
      user.mfa?.methods?.webauthn?.enabled &&
      (user.mfa?.methods?.webauthn?.credentials?.length ?? 0) > 0
    );
  }

  /**
   * Get all enabled MFA methods for a user (multi-method schema)
   * @returns Array of enabled method names
   */
  getEnabledMethods(user: IUser): MfaMethod[] {
    if (!user.mfa?.enabled || !user.mfa?.methods) {
      return [];
    }

    const methods: MfaMethod[] = [];
    const userMethods = user.mfa.methods;

    if (userMethods.totp?.enabled && userMethods.totp?.secret) {
      methods.push('totp');
    }
    if (userMethods.email?.enabled) {
      methods.push('email');
    }
    if (
      userMethods.webauthn?.enabled &&
      (userMethods.webauthn?.credentials?.length ?? 0) > 0
    ) {
      methods.push('webauthn');
    }

    return methods;
  }

  /**
   * Check if user needs MFA method selection (has 2+ methods enabled)
   */
  needsMethodSelection(user: IUser): boolean {
    return this.getEnabledMethods(user).length > 1;
  }

  /**
   * Get enabled methods as an object for template rendering
   * Returns { totp: boolean, email: boolean, webauthn: boolean }
   */
  getEnabledMethodsObject(user: IUser): {
    totp: boolean;
    email: boolean;
    webauthn: boolean;
  } {
    const methods = this.getEnabledMethods(user);
    return {
      totp: methods.includes('totp'),
      email: methods.includes('email'),
      webauthn: methods.includes('webauthn'),
    };
  }

  /**
   * Get user's preferred MFA method, or first available if not set
   */
  getPreferredMethod(user: IUser): MfaMethod | null {
    const enabledMethods = this.getEnabledMethods(user);

    if (enabledMethods.length === 0) {
      return null;
    }

    if (
      user.mfa?.preferred_method &&
      enabledMethods.includes(user.mfa.preferred_method)
    ) {
      return user.mfa.preferred_method;
    }

    // Otherwise return first enabled method
    return enabledMethods[0];
  }

  /**
   * Get user's TOTP secret (multi-method schema)
   */
  getUserTotpSecret(user: IUser): string | undefined {
    const secret = user.mfa?.methods?.totp?.secret;
    if (!secret) return undefined;
    return ensureDecrypted(secret);
  }

  /**
   * Get update object for enabling a specific MFA method (multi-method schema)
   * Returns MongoDB dot notation update object that preserves other methods
   */
  getEnableMethodUpdate(
    method: 'totp' | 'email' | 'webauthn',
    data?: { secret?: string }
  ): MfaMethodUpdate {
    const update: MfaMethodUpdate = {
      'mfa.enabled': true,
      [`mfa.methods.${method}.enabled`]: true,
      [`mfa.methods.${method}.verified_at`]: new Date(),
    };

    if (method === 'totp' && data?.secret) {
      update['mfa.methods.totp.secret'] = data.secret;
    }

    return update;
  }

  /**
   * Get update object for disabling a specific MFA method (multi-method schema)
   * Returns MongoDB dot notation update object that preserves other methods
   */
  getDisableMethodUpdate(
    method: 'totp' | 'email' | 'webauthn'
  ): MfaMethodUpdate {
    const update: MfaMethodUpdate = {
      [`mfa.methods.${method}.enabled`]: false,
    };

    if (method === 'totp') {
      update['mfa.methods.totp.secret'] = undefined;
    }

    return update;
  }

  /**
   * Check if any MFA method is still enabled after disabling one
   * Used to determine if mfa.enabled should be set to false
   */
  hasAnyMethodEnabled(
    user: IUser,
    excludeMethod?: 'totp' | 'email' | 'webauthn'
  ): boolean {
    const methods = this.getEnabledMethods(user);
    if (excludeMethod) {
      return methods.filter(m => m !== excludeMethod).length > 0;
    }
    return methods.length > 0;
  }

  /**
   * Get update object for completely disabling MFA (all methods)
   * Returns MongoDB dot notation update object
   */
  getDisableAllMfaUpdate(): MfaMethodUpdate {
    return {
      'mfa.enabled': false,
      'mfa.methods.totp.enabled': false,
      'mfa.methods.totp.secret': undefined,
      'mfa.methods.email.enabled': false,
      'mfa.methods.webauthn.enabled': false,
      'mfa.preferred_method': undefined,
    };
  }

  /**
   * Mask email address for display
   */
  maskEmail(email: string): string {
    if (!email || !email.includes('@')) {
      return email;
    }

    const [localPart, domain] = email.split('@');
    if (localPart.length <= 1) {
      return email;
    }

    return `${localPart.charAt(0) + '*'.repeat(localPart.length - 1)}@${domain}`;
  }

  /**
   * Mask phone number for display
   */
  maskPhoneNumber(phoneNumber: string): string {
    if (!phoneNumber || phoneNumber.length < 4) {
      return phoneNumber;
    }

    const cleaned = phoneNumber.replace(/\D/g, '');
    if (cleaned.length < 4) {
      return phoneNumber;
    }

    return '*'.repeat(cleaned.length - 4) + cleaned.slice(-4);
  }

  /**
   * Get MFA configuration from environment/config
   */
  getMfaConfig(): {
    enabled: boolean;
    methods: {
      totp: { enabled: boolean; issuer: string };
      sms: { enabled: boolean };
      email: { enabled: boolean };
      webauthn: { enabled: boolean };
    };
  } {
    return {
      enabled:
        this.configManager.getConfig().security.authentication.multi_factor
          .enabled,
      methods: {
        totp: {
          enabled:
            this.configManager.getConfig().security.authentication.multi_factor
              .totp.enabled,
          issuer:
            this.configManager.getConfig().security.authentication.multi_factor
              .totp.issuer_name,
        },
        sms: {
          enabled:
            this.configManager.getConfig().security.authentication.multi_factor
              .sms.enabled,
        },
        email: {
          enabled:
            this.configManager.getConfig().security.authentication.multi_factor
              .email.enabled,
        },
        webauthn: {
          enabled:
            this.configManager.getConfig().security.authentication.multi_factor
              .webauthn.enabled,
        },
      },
    };
  }

  /**
   * Validate MFA method is supported
   */
  isMethodSupported(method: MfaMethod): boolean {
    const config = this.getMfaConfig();

    switch (method) {
      case 'totp':
        return config.methods.totp.enabled;
      case 'sms':
        return config.methods.sms.enabled;
      case 'email':
        return config.methods.email.enabled;
      case 'webauthn':
        return config.methods.webauthn.enabled;
      default:
        return false;
    }
  }

  /**
   * Get available MFA methods based on configuration
   */
  getAvailableMethods(): MfaMethod[] {
    const config = this.getMfaConfig();
    const methods: MfaMethod[] = [];

    if (config.methods.totp.enabled) methods.push('totp');
    if (config.methods.sms.enabled) methods.push('sms');
    if (config.methods.email.enabled) methods.push('email');
    if (config.methods.webauthn.enabled) methods.push('webauthn');

    return methods;
  }
}

export default MfaUtils;
