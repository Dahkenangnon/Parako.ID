import { type IUser, type RegisterWith } from '../types/user.js';
import { injectable, inject } from 'inversify';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IUserService } from '../di/interfaces/user-service.interface.js';
import type { IPasswordUtils } from '../di/interfaces/password-utils.interface.js';
import type { IMfaUtils } from '../di/interfaces/mfa-utils.interface.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type {
  IAuthService,
  AuthUserData,
  PasswordResetResult,
  EmailVerificationResult,
  AdminPasswordChangeOptions,
  LoginResult,
} from '../di/interfaces/auth-service.interface.js';
import { TYPES } from '../di/types.js';
import crypto from 'node:crypto';
import {
  checkPasswordBreach,
  computeSha1PrefixSuffix,
} from '../utils/password-breach.js';
import { createBackgroundTaskQueue } from '../jobs/domains/background-tasks/queue.js';
import { tenantContext } from '../multi-tenancy/tenant-context.js';
@injectable()
export class AuthService implements IAuthService {
  private static readonly PASSWORD_RESET_EXPIRY_HOURS = 1;
  private static readonly EMAIL_VERIFICATION_EXPIRY_HOURS = 24;
  private static readonly TOKEN_BYTES = 32;
  private static readonly HASH_ALGORITHM = 'sha256';
  private static readonly EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.UserService) private readonly userService: IUserService,
    @inject(TYPES.PasswordUtils) private readonly passwordUtils: IPasswordUtils,
    @inject(TYPES.MfaUtils) private readonly mfaUtils: IMfaUtils,
    @inject(TYPES.ConfigManager)
    private readonly configManager: IConfigManager
  ) {}

  /**
   * Blocking breach check — throws if password is found in HIBP.
   * Gracefully degrades: API failures never block the caller.
   */
  private async checkPasswordBreachBlocking(
    password: string,
    context:
      | 'check_on_registration'
      | 'check_on_password_reset'
      | 'check_on_password_change'
  ): Promise<void> {
    try {
      const config = this.configManager.getConfig();
      const pbd = config.security?.authentication?.password_breach_detection;
      if (!pbd?.enabled || !pbd[context]) return;

      const result = await checkPasswordBreach(password, pbd.api_timeout_ms);
      if (result.breached && result.count >= (pbd.min_breach_count ?? 1)) {
        throw new Error(
          `This password has appeared in ${result.count} known data breaches and cannot be used. Please choose a different password.`
        );
      }
    } catch (error) {
      // Re-throw breach errors, swallow API/network failures
      if ((error as Error).message?.includes('data breaches')) {
        throw error;
      }
      this.logger.warn('Password breach check failed (allowing password)', {
        context,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Non-blocking login breach check — dispatches a BullMQ job.
   * SHA1 prefix+suffix are pre-computed so plaintext never enters the queue.
   */
  private enqueueLoginBreachCheck(password: string, user: IUser): void {
    try {
      const config = this.configManager.getConfig();
      const pbd = config.security?.authentication?.password_breach_detection;
      if (!pbd?.enabled || !pbd.check_on_login) return;

      const { prefix, suffix } = computeSha1PrefixSuffix(password);
      const redisConfig = config.oidc_storage?.oidc_adapter?.redis;
      const tenantId = tenantContext.getTenantIdSafe();

      createBackgroundTaskQueue(redisConfig)
        .then(queue => {
          if (!queue) {
            this.logger.debug(
              'Skipping breach check enqueue: Redis not available'
            );
            return;
          }
          return queue
            .add('password-breach-check', {
              type: 'background-tasks',
              name: 'password-breach-check',
              sha1Prefix: prefix,
              sha1Suffix: suffix,
              userId: String(user._id),
              email: user.email || '',
              username: user.username || '',
              tenantId,
              apiTimeoutMs: pbd.api_timeout_ms,
              minBreachCount: pbd.min_breach_count,
            })
            .then(() => queue.close());
        })
        .catch(err => {
          this.logger.warn('Failed to enqueue login breach check', {
            error: (err as Error).message,
          });
        });
    } catch (error) {
      this.logger.warn('Login breach check enqueue failed', {
        error: (error as Error).message,
      });
    }
  }

  public isValidEmailAddress(email: string): boolean {
    if (!email || typeof email !== 'string') {
      return false;
    }
    return AuthService.EMAIL_REGEX.test(email.trim().toLowerCase());
  }

  private validateLoginInput(
    identifier: string,
    password: string,
    identifierType: string
  ): void {
    if (
      !identifier ||
      typeof identifier !== 'string' ||
      identifier.trim().length === 0
    ) {
      throw new Error(`${identifierType} is required`);
    }

    if (!password || typeof password !== 'string' || password.length === 0) {
      throw new Error('Password is required');
    }
  }

  private async performLogin(
    identifier: string,
    password: string,
    identifierType: 'email' | 'username' | 'phone_number' | 'custom_identifier',
    userLookup: () => Promise<IUser | undefined>
  ): Promise<LoginResult> {
    this.validateLoginInput(identifier, password, identifierType);

    this.logger.info(`Attempting login with ${identifierType}`, {
      [identifierType]: identifier,
    });

    const user = await userLookup();

    if (!user) {
      this.logger.warn(`Login failed: user not found`, {
        [identifierType]: identifier,
      });
      throw new Error(`Invalid ${identifierType} or password`);
    }

    await this.validateUserLoginStatus(user);
    await this.validatePassword(password, user.password, user);

    // Non-blocking: enqueue async breach check (fire-and-forget)
    this.enqueueLoginBreachCheck(password, user);

    await this.userService.updateUserLastLoginDate(user._id!, user.username);

    const result: LoginResult = { user };

    if (!user.last_login) {
      result.isFirstLogin = true;
    }

    if (user.password_force_reset) {
      result.requiresPasswordReset = true;
    }

    return result;
  }

  public async loginWithEmail(email: string, password: string): Promise<IUser> {
    const result = await this.performLogin(email, password, 'email', () =>
      this.userService.findByEmail(email)
    );
    return result.user;
  }

  public async loginWithUsername(
    username: string,
    password: string
  ): Promise<IUser> {
    const result = await this.performLogin(username, password, 'username', () =>
      this.userService.findByUsername(username)
    );
    return result.user;
  }

  public async loginWithPhoneNumber(
    phoneNumber: string,
    password: string
  ): Promise<IUser> {
    const result = await this.performLogin(
      phoneNumber,
      password,
      'phone_number',
      () => this.userService.findByPhoneNumber(phoneNumber)
    );
    return result.user;
  }

  public async loginWithCustomIdentifier(
    slot: 1 | 2 | 3,
    value: string,
    password: string
  ): Promise<IUser> {
    // Normalize case based on field config
    const field = this.userService.getCustomIdentifierFieldBySlot(slot);
    const normalizedValue =
      field && !field.case_sensitive
        ? value.toLowerCase().trim()
        : value.trim();

    const result = await this.performLogin(
      normalizedValue,
      password,
      'custom_identifier',
      () => this.userService.findByCustomIdentifier(slot, normalizedValue)
    );
    return result.user;
  }

  private async validateUserLoginStatus(user: IUser): Promise<void> {
    if (user.account_is_anonymized) {
      throw new Error('This account has been anonymized');
    }

    if (!user.account_enabled) {
      throw new Error('This account is disabled');
    }

    if (user.blocked_from && user.blocked_from.length > 0) {
      throw new Error('This account is blocked');
    }
  }

  private async validatePassword(
    providedPassword: string,
    storedPassword: string | undefined,
    user: IUser
  ): Promise<void> {
    if (!storedPassword) {
      this.logger.warn('Missing password hash for user', {
        username: user.username,
      });
      throw new Error('Invalid credentials');
    }

    try {
      const result = await this.userService.verifyPasswordWithRehash(
        providedPassword,
        storedPassword
      );

      if (!result.valid) {
        this.logger.warn('Login failed: password mismatch', {
          username: user.username,
        });
        throw new Error('Invalid credentials');
      }

      // If password is valid but was upgraded, update the stored hash
      if (result.newHash) {
        try {
          await this.userService.updateById(user._id!, {
            password: result.newHash,
            password_hash_algo: 'argon2id',
            password_updated_at: new Date(),
          });

          this.logger.info('Password hash automatically upgraded for user', {
            username: user.username,
            userId: user._id,
          });
        } catch (updateError) {
          this.logger.error('Failed to update upgraded password hash', {
            username: user.username,
            userId: user._id,
            error: (updateError as Error).message,
          });
          // Don't fail the login if we can't update the hash
        }
      }
    } catch (error) {
      this.logger.warn('Password validation error', {
        username: user.username,
        error: (error as Error).message,
      });
      throw new Error('Invalid credentials');
    }
  }

  private async validateRegistrationData(
    email?: string,
    phoneNumber?: string
  ): Promise<void> {
    const contactChannels =
      this.configManager.getConfig().security?.authentication?.signup
        ?.contact_channels;
    const requireAtLeastOne = contactChannels?.require_at_least_one ?? true;

    if (requireAtLeastOne && !email && !phoneNumber) {
      throw new Error('Either email or phone number is required');
    }

    if (email) {
      if (!this.isValidEmailAddress(email)) {
        throw new Error('Invalid email format');
      }

      const isEmailTaken = await this.userService.isEmailTaken(email);
      if (isEmailTaken) {
        throw new Error('Email is already registered');
      }
    }

    if (phoneNumber) {
      if (!phoneNumber.match(/^\+?[\d\s\-()]+$/)) {
        throw new Error('Invalid phone number format');
      }

      const isPhoneTaken =
        await this.userService.isPhoneNumberTaken(phoneNumber);
      if (isPhoneTaken) {
        throw new Error('Phone number is already registered');
      }
    }
  }

  public async registerUser(userData: AuthUserData): Promise<IUser> {
    try {
      const {
        email,
        password,
        given_name,
        family_name,
        phone_number,
        register_with,
        custom_identifier_1,
        custom_identifier_2,
        custom_identifier_3,
      } = userData;

      const passwordValidation = this.userService.validatePassword(password);
      if (!passwordValidation.isValid) {
        throw new Error(
          `Password validation failed: ${passwordValidation.messages.join(', ')}`
        );
      }

      await this.validateRegistrationData(email, phone_number);

      await this.checkPasswordBreachBlocking(password, 'check_on_registration');

      const registerWith = register_with || (email ? 'email' : 'phone_number');

      const hashedPassword = await this.passwordUtils.hashPassword(password);

      const user = await this.userService.createUserWithGeneratedUsername({
        email,
        password: hashedPassword,
        phone_number,
        register_with: registerWith as RegisterWith,
        roles: ['user'],
        password_hash_algo: 'argon2id',
        account_enabled: true,
        email_verified: false,
        phone_number_verified: false,
        given_name,
        family_name,
        custom_identifier_1: custom_identifier_1 || undefined,
        custom_identifier_2: custom_identifier_2 || undefined,
        custom_identifier_3: custom_identifier_3 || undefined,
      });

      return user;
    } catch (error) {
      const err = error as Error;
      this.logger.error('Error registering user', {
        error: err.message,
        email: userData.email,
        phoneNumber: userData.phone_number,
      });
      throw error;
    }
  }

  public async generatePasswordResetToken(
    email: string
  ): Promise<PasswordResetResult> {
    try {
      if (!this.isValidEmailAddress(email)) {
        throw new Error('Invalid email format');
      }

      // First try to find user by main email
      let user = await this.userService.findByEmail(email);

      // If not found, try to find by verified recovery email
      if (!user) {
        user = await this.userService.findByRecoveryEmail(email);
      }

      if (!user) {
        this.logger.info('Password reset requested for non-existent email', {
          email,
        });
        throw new Error('If the email exists, a reset link has been sent');
      }

      const resetToken = crypto
        .randomBytes(AuthService.TOKEN_BYTES)
        .toString('hex');
      const hashedToken = this.hashToken(resetToken);

      const tokenExpiry = new Date(
        Date.now() + AuthService.PASSWORD_RESET_EXPIRY_HOURS * 60 * 60 * 1000
      );

      await this.userService.updateById(user._id!, {
        reset_password_token: hashedToken,
        reset_password_expires: tokenExpiry,
      });

      return { user, resetToken };
    } catch (error) {
      const err = error as Error;
      this.logger.error('Error generating password reset token', {
        email,
        error: err.message,
      });
      throw error;
    }
  }

  private hashToken(token: string): string {
    return crypto
      .createHash(AuthService.HASH_ALGORITHM)
      .update(token)
      .digest('hex');
  }

  public async resetPassword(
    token: string,
    newPassword: string
  ): Promise<IUser> {
    try {
      if (!token || !newPassword) {
        throw new Error('Token and new password are required');
      }

      const passwordValidation = this.userService.validatePassword(newPassword);
      if (!passwordValidation.isValid) {
        throw new Error(
          `Password validation failed: ${passwordValidation.messages.join(', ')}`
        );
      }

      await this.checkPasswordBreachBlocking(
        newPassword,
        'check_on_password_reset'
      );

      const hashedToken = this.hashToken(token);

      const user = await this.userService.findOne({
        reset_password_token: hashedToken,
        reset_password_expires: { $gt: Date.now() },
      });

      if (!user) {
        throw new Error('Invalid or expired token');
      }

      const hashedNewPassword =
        await this.passwordUtils.hashPassword(newPassword);

      const updatedUser = await this.userService.updateById(user._id!, {
        password: hashedNewPassword,
        password_hash_algo: 'argon2id',
        password_updated_at: new Date(),
        reset_password_token: undefined,
        reset_password_expires: undefined,
        password_force_reset: false,
      });

      return updatedUser!;
    } catch (error) {
      const err = error as Error;
      this.logger.error('Error resetting password', { error: err.message });
      throw error;
    }
  }

  public async changePassword(
    username: string,
    currentPassword: string,
    newPassword: string,
    logoutOtherDevices = false
  ): Promise<IUser> {
    try {
      if (!username || !currentPassword || !newPassword) {
        throw new Error(
          'Username, current password, and new password are required'
        );
      }

      const passwordValidation = this.userService.validatePassword(newPassword);
      if (!passwordValidation.isValid) {
        throw new Error(
          `Password validation failed: ${passwordValidation.messages.join(', ')}`
        );
      }

      await this.checkPasswordBreachBlocking(
        newPassword,
        'check_on_password_change'
      );

      const user = await this.userService.findByUsername(username);

      if (!user) {
        throw new Error('User not found');
      }

      const passwordResult = await this.userService.verifyPasswordWithRehash(
        currentPassword,
        user.password || ''
      );

      if (!passwordResult.valid) {
        throw new Error('Current password is incorrect');
      }

      // If current password was upgraded, we should update it
      if (passwordResult.newHash) {
        try {
          await this.userService.updateById(user._id!, {
            password: passwordResult.newHash,
            password_hash_algo: 'argon2id',
            password_updated_at: new Date(),
          });

          this.logger.info(
            'Current password hash upgraded during password change',
            {
              username: user.username,
              userId: user._id,
            }
          );
        } catch (updateError) {
          this.logger.error('Failed to update upgraded current password hash', {
            username: user.username,
            userId: user._id,
            error: (updateError as Error).message,
          });
          // Continue with password change even if we can't update the current hash
        }
      }

      const hashedNewPassword =
        await this.passwordUtils.hashPassword(newPassword);

      const updatedUser = await this.userService.updateById(user._id!, {
        password: hashedNewPassword,
        password_hash_algo: 'argon2id',
        password_updated_at: new Date(),
        password_force_reset: false,
      });

      if (logoutOtherDevices) {
        this.logger.info('Request to logout other devices on password change', {
          username,
        });
      }

      return updatedUser!;
    } catch (error) {
      const err = error as Error;
      this.logger.error('Error changing password', {
        username,
        error: err.message,
      });
      throw error;
    }
  }

  public async adminChangeUserPassword(
    adminUsername: string,
    targetUserId: string,
    newPassword: string,
    options: AdminPasswordChangeOptions = {}
  ): Promise<IUser> {
    try {
      const { requireReset = false, sendEmail = true } = options;

      if (!adminUsername || !targetUserId || !newPassword) {
        throw new Error(
          'Admin username, target user ID, and new password are required'
        );
      }

      const passwordValidation = this.userService.validatePassword(newPassword);
      if (!passwordValidation.isValid) {
        throw new Error(
          `Password validation failed: ${passwordValidation.messages.join(', ')}`
        );
      }

      await this.checkPasswordBreachBlocking(
        newPassword,
        'check_on_password_change'
      );

      await this.validateAdmin(adminUsername);
      const targetUser = await this.getTargetUser(targetUserId);

      const hashedNewPassword =
        await this.passwordUtils.hashPassword(newPassword);

      const updateData: any = {
        password: hashedNewPassword,
        password_hash_algo: 'argon2id',
        password_updated_at: new Date(),
      };

      if (requireReset) {
        updateData.password_force_reset = true;
      }

      const updatedUser = await this.userService.updateById(
        targetUser._id!,
        updateData
      );

      if (sendEmail && targetUser.email) {
        this.logger.info('Should send password change email notification', {
          targetUsername: targetUser.username,
          targetEmail: targetUser.email,
        });
      }

      return updatedUser!;
    } catch (error) {
      const err = error as Error;
      this.logger.error('Error performing admin password change', {
        error: err.message,
        adminUsername,
        targetUserId,
      });
      throw error;
    }
  }

  private async validateAdmin(adminUsername: string): Promise<IUser> {
    const adminUser = await this.userService.findByUsername(adminUsername);

    if (!adminUser) {
      throw new Error('Admin user not found');
    }

    if (
      !adminUser.roles?.includes('admin') &&
      !adminUser.roles?.includes('superadmin')
    ) {
      throw new Error('Insufficient permissions');
    }

    return adminUser;
  }

  private async getTargetUser(userId: string): Promise<IUser> {
    const targetUser = await this.userService.findById(userId);

    if (!targetUser) {
      throw new Error('Target user not found');
    }

    return targetUser;
  }

  public async verifyEmail(token: string): Promise<IUser> {
    try {
      if (!token) {
        throw new Error('Verification token is required');
      }

      const hashedToken = this.hashToken(token);

      const user = await this.userService.findOne({
        email_verification_token: hashedToken,
        email_verification_expires: { $gt: Date.now() },
      });

      if (!user) {
        throw new Error('Invalid or expired token');
      }

      const updatedUser = await this.userService.updateById(user._id!, {
        email_verified: true,
        email_verification_token: undefined,
        email_verification_expires: undefined,
      });

      return updatedUser!;
    } catch (error) {
      const err = error as Error;
      this.logger.error('Error verifying email', { error: err.message });
      throw error;
    }
  }

  public async generateEmailVerificationToken(
    userId: string
  ): Promise<EmailVerificationResult> {
    try {
      if (!userId) {
        throw new Error('User ID is required');
      }

      const user = await this.userService.findById(userId);

      if (!user) {
        throw new Error('User not found');
      }

      if (user.email_verified) {
        throw new Error('Email is already verified');
      }

      if (!user.email) {
        throw new Error('User has no email address to verify');
      }

      const verificationToken = crypto
        .randomBytes(AuthService.TOKEN_BYTES)
        .toString('hex');
      const hashedToken = this.hashToken(verificationToken);

      const tokenExpiry = new Date(
        Date.now() +
          AuthService.EMAIL_VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000
      );

      const updatedUser = await this.userService.updateById(user._id!, {
        email_verification_token: hashedToken,
        email_verification_expires: tokenExpiry,
      });

      return { user: updatedUser!, verificationToken };
    } catch (error) {
      const err = error as Error;
      this.logger.error('Error generating email verification token', {
        userId,
        error: err.message,
      });
      throw error;
    }
  }

  public isAdmin(user: IUser): boolean {
    return (
      user.roles?.includes('admin') ||
      user.roles?.includes('superadmin') ||
      false
    );
  }

  public hasRole(user: IUser, role: string): boolean {
    return user.roles?.includes(role) || false;
  }

  public async verifyTotp(
    userIdentifier: string,
    code: string
  ): Promise<boolean> {
    try {
      if (!userIdentifier || !code) {
        this.logger.debug('TOTP verification failed: missing parameters', {
          userIdentifier: !!userIdentifier,
          codeLength: code?.length,
        });
        return false;
      }

      const validation = this.mfaUtils.validateTotpCodeFormat(code);
      if (!validation.valid) {
        this.logger.debug('TOTP verification failed: invalid code format', {
          userIdentifier,
          error: validation.error,
        });
        return false;
      }

      this.logger.debug('Attempting to verify TOTP', {
        userIdentifier,
        codeLength: code.length,
      });

      return await this.userService.verifyTotp(
        userIdentifier,
        validation.sanitized!
      );
    } catch (err) {
      const error = err as Error;
      this.logger.error('verifyTotp error', {
        userIdentifier,
        error: error.message,
        stack: error.stack,
      });
      return false;
    }
  }

  /**
   * Generate an email OTP for new device verification
   * Uses MfaUtils for OTP generation
   * @param userId - User's MongoDB ID
   * @returns Object with the plain OTP code and expiration time
   */
  public async generateEmailOtp(
    userId: string
  ): Promise<{ code: string; expiresAt: Date }> {
    try {
      // Use MfaUtils to generate OTP (10 minutes = 600 seconds)
      const otpResult = this.mfaUtils.generateEmailOtp(600);

      await this.userService.updateById(userId, {
        'mfa.email_otp': { hash: otpResult.hash, expires: otpResult.expiresAt },
      } as Partial<IUser>);

      this.logger.debug('Generated email OTP for user', {
        userId,
        expiresAt: otpResult.expiresAt,
      });

      return { code: otpResult.code, expiresAt: otpResult.expiresAt };
    } catch (err) {
      const error = err as Error;
      this.logger.error('generateEmailOtp error', {
        userId,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Verify an email OTP for new device verification
   * Uses MfaUtils for OTP verification
   * @param userId - User's MongoDB ID
   * @param code - The OTP code to verify
   * @returns true if valid, false otherwise
   */
  public async verifyEmailOtp(userId: string, code: string): Promise<boolean> {
    try {
      const user = await this.userService.findById(userId);
      if (!user?.mfa?.email_otp) {
        this.logger.debug('verifyEmailOtp: No OTP stored for user', { userId });
        return false;
      }

      // Use MfaUtils to verify OTP
      const result = this.mfaUtils.verifyEmailOtp(
        code,
        user.mfa.email_otp.hash,
        new Date(user.mfa.email_otp.expires)
      );

      if (result.valid) {
        await this.userService.updateById(userId, {
          'mfa.email_otp': null,
        } as Partial<IUser>);
        this.logger.debug('verifyEmailOtp: OTP verified successfully', {
          userId,
        });
      } else {
        this.logger.debug('verifyEmailOtp: Invalid OTP code', {
          userId,
          error: result.error,
        });
        if (result.error?.includes('expired')) {
          await this.userService.updateById(userId, {
            'mfa.email_otp': null,
          } as Partial<IUser>);
        }
      }

      return result.valid;
    } catch (err) {
      const error = err as Error;
      this.logger.error('verifyEmailOtp error', {
        userId,
        error: error.message,
        stack: error.stack,
      });
      return false;
    }
  }

  public async findUserByUsername(username: string): Promise<IUser | null> {
    try {
      if (
        !username ||
        typeof username !== 'string' ||
        username.trim().length === 0
      ) {
        throw new Error('Username is required');
      }

      this.logger.info('Looking up user by username', { username });

      const user = await this.userService.findByUsername(username);

      if (!user) {
        this.logger.warn('User not found', { username });
        return null;
      }

      return user;
    } catch (error) {
      const err = error as Error;
      this.logger.error('Error finding user by username', {
        username,
        error: err.message,
      });
      throw error;
    }
  }
}
