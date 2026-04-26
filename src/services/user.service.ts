import type { IUser } from '../types/user.js';
import { injectable, inject } from 'inversify';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IMfaUtils } from '../di/interfaces/mfa-utils.interface.js';
import type { IPasswordUtils } from '../di/interfaces/password-utils.interface.js';
import type {
  IUserService,
  ProfileUpdateData,
  PasswordChangeData,
} from '../di/interfaces/user-service.interface.js';
import { TYPES } from '../di/types.js';
import crypto from 'node:crypto';
import { encryptValue } from '../utils/encryption.js';
import type {
  BulkWriteResult,
  BulkDeleteResult,
} from '../di/interfaces/base-service.interface.js';
import type {
  IUserRepository,
  CreateUserDto,
  UpdateUserDto,
  UserFilter,
  IUserMfaUpdate,
} from '../db/repositories/interfaces/user.repository.js';

/**
 * Service for user-related business operations.
 *
 * All persistence is delegated to IUserRepository — no Mongoose model
 * access occurs directly in this class. This makes the service compatible
 * with MongoDB (Mongoose), SQLite, and PostgreSQL (Prisma) backends.
 */
@injectable()
export class UserService implements IUserService {
  private static readonly HASH_ALGORITHM = 'sha256';
  private static readonly DEFAULT_PASSWORD_MIN_LENGTH = 8;
  private static readonly DEFAULT_PASSWORD_MAX_AGE_DAYS = 90;

  constructor(
    @inject(TYPES.Logger) protected readonly logger: ILogger,
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.MfaUtils) private readonly mfaUtils: IMfaUtils,
    @inject(TYPES.PasswordUtils) private readonly passwordUtils: IPasswordUtils,
    @inject(TYPES.UserRepository) private readonly userRepo: IUserRepository
  ) {}

  // ── Private helpers ──────────────────────────────────────────────────────────

  private validateTotpCode(code: string): string {
    const validation = this.mfaUtils.validateTotpCodeFormat(code);
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid TOTP code format');
    }
    return validation.sanitized!;
  }

  // ── IBaseService implementation (via repository) ──────────────────────────────

  public async createOne(
    data: Partial<IUser>,
    _options: { ordered?: boolean } = {}
  ): Promise<IUser> {
    return this.userRepo.create(data as CreateUserDto);
  }

  public async createMany(
    data: Partial<IUser>[],
    _options: { ordered?: boolean } = {}
  ): Promise<IUser[]> {
    return Promise.all(data.map(d => this.userRepo.create(d as CreateUserDto)));
  }

  public async findOne(
    filter: Record<string, unknown> | string,
    _options?: Record<string, unknown>
  ): Promise<IUser | null> {
    if (typeof filter === 'string') {
      return this.userRepo.findById(filter);
    }
    return this.userRepo.findOne(filter as Record<string, unknown>);
  }

  public async findMany(
    filter: Record<string, unknown> = {},
    options: {
      sort?: Record<string, 1 | -1 | 'asc' | 'desc'>;
      limit?: number;
      skip?: number;
    } = {}
  ): Promise<IUser[]> {
    const result = await this.userRepo.findMany(filter as UserFilter, {
      page: 1,
      limit: options?.limit || 50000,
      sort: options?.sort,
    });
    return result.results;
  }

  public async updateById(
    id: string,
    data: Partial<IUser>,
    _options: any = {}
  ): Promise<IUser | null> {
    try {
      return await this.userRepo.update(id, data as UpdateUserDto);
    } catch (error) {
      const msg = (error as Error).message ?? '';
      if (msg.includes('not found') || msg.includes('Document not found')) {
        return null;
      }
      throw error;
    }
  }

  public async updateMany(
    _filter: Record<string, unknown>,
    _data: Partial<IUser>,
    _options: { upsert?: boolean; runValidators?: boolean } = {}
  ): Promise<BulkWriteResult> {
    throw new Error(
      'updateMany is not supported by the repository abstraction'
    );
  }

  public async deleteOne(
    filter: Record<string, unknown> | string
  ): Promise<IUser | null> {
    if (typeof filter === 'string') {
      const user = await this.userRepo.findById(filter);
      if (!user) return null;
      await this.userRepo.delete(filter);
      return user;
    }
    const user = await this.userRepo.findOne(filter as Record<string, unknown>);
    if (!user) return null;
    await this.userRepo.delete(String(user._id!));
    return user;
  }

  public async deleteMany(
    _filter: Record<string, unknown>
  ): Promise<BulkDeleteResult> {
    throw new Error(
      'deleteMany is not supported by the repository abstraction'
    );
  }

  public async findWithPagination(
    filter: Record<string, unknown> = {},
    options: {
      page: number;
      limit: number;
      sort?: Record<string, 1 | -1 | 'asc' | 'desc'>;
    }
  ): Promise<{
    results: IUser[];
    page: number;
    limit: number;
    totalResults: number;
    totalPages: number;
  }> {
    const paged = await this.userRepo.findMany(filter as UserFilter, {
      page: options.page,
      limit: options.limit,
      sort: options.sort,
    });
    return {
      results: paged.results,
      page: paged.page,
      limit: paged.limit,
      totalResults: paged.totalResults,
      totalPages: paged.totalPages,
    };
  }

  public async countDocuments(
    filter: Record<string, unknown> = {}
  ): Promise<number> {
    return this.userRepo.count(filter as Record<string, unknown>);
  }

  public async aggregate(_pipeline: unknown[]): Promise<unknown[]> {
    throw new Error('aggregate is not supported by the repository abstraction');
  }

  // ── IUserRepository (di/interfaces) — query methods ──────────────────────────

  public async findByEmail(email: string): Promise<IUser | undefined> {
    try {
      const user = await this.userRepo.findOne({
        email,
        account_enabled: true,
      });
      return user || undefined;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, { context: 'error_finding_user_by_email', email });
      throw error;
    }
  }

  public async findById(id: string): Promise<IUser | undefined> {
    try {
      const user = await this.userRepo.findById(id);
      return user || undefined;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, { context: 'error_finding_user_by_id', id });
      throw error;
    }
  }

  public async findByUsername(username: string): Promise<IUser | undefined> {
    try {
      const user = await this.userRepo.findOne({
        username,
        account_enabled: true,
      });
      return user || undefined;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_finding_user_by_username',
        username,
      });
      throw error;
    }
  }

  public async findByPhoneNumber(
    phoneNumber: string
  ): Promise<IUser | undefined> {
    try {
      const user = await this.userRepo.findOne({
        phone_number: phoneNumber,
        account_enabled: true,
      });
      return user || undefined;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_finding_user_by_phone_number',
        phoneNumber,
      });
      throw error;
    }
  }

  public async findByCustomIdentifier(
    slot: 1 | 2 | 3,
    value: string
  ): Promise<IUser | undefined> {
    try {
      // Normalize case for case-insensitive fields
      const field = this.getCustomIdentifierFieldBySlot(slot);
      const normalizedValue =
        field && !field.case_sensitive
          ? value.toLowerCase().trim()
          : value.trim();

      const fieldName = `custom_identifier_${slot}` as const;
      const user = await this.userRepo.findOne({
        [fieldName]: normalizedValue,
        account_enabled: true,
      });
      return user || undefined;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_finding_user_by_custom_identifier',
        slot,
      });
      throw error;
    }
  }

  public async findByRecoveryEmail(email: string): Promise<IUser | undefined> {
    try {
      const user = await this.userRepo.findOne({
        'recovery.secondary_email.email': email.toLowerCase(),
        'recovery.secondary_email.verified': true,
        account_enabled: true,
      });
      return user || undefined;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_finding_user_by_recovery_email',
        email,
      });
      throw error;
    }
  }

  public async findByEmailIncludingDisabled(
    email: string
  ): Promise<IUser | undefined> {
    try {
      const user = await this.userRepo.findOne({ email });
      return user || undefined;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_finding_user_by_email_including_disabled',
        email,
      });
      throw error;
    }
  }

  public async findByUsernameIncludingDisabled(
    username: string
  ): Promise<IUser | undefined> {
    try {
      const user = await this.userRepo.findOne({ username });
      return user || undefined;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_finding_user_by_username_including_disabled',
        username,
      });
      throw error;
    }
  }

  public async findByPhoneNumberIncludingDisabled(
    phoneNumber: string
  ): Promise<IUser | undefined> {
    try {
      const user = await this.userRepo.findOne({
        phone_number: phoneNumber,
      });
      return user || undefined;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_finding_user_by_phone_number_including_disabled',
        phoneNumber,
      });
      throw error;
    }
  }

  public async isEmailTaken(email: string): Promise<boolean> {
    try {
      return (await this.userRepo.count({ email })) > 0;
    } catch (error) {
      this.logger.error(error as Error, { context: 'isEmailTaken', email });
      return false;
    }
  }

  public async isPhoneNumberTaken(phoneNumber: string): Promise<boolean> {
    try {
      return (await this.userRepo.count({ phone_number: phoneNumber })) > 0;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'isPhoneNumberTaken',
        phoneNumber,
      });
      return false;
    }
  }

  public async isUserNameTaken(username: string): Promise<boolean> {
    try {
      return (await this.userRepo.count({ username })) > 0;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'isUserNameTaken',
        username,
      });
      return false;
    }
  }

  public async isCustomIdentifierAvailable(
    slot: 1 | 2 | 3,
    value: string,
    excludeUserId?: string
  ): Promise<boolean> {
    try {
      // Normalize case for case-insensitive fields
      const field = this.getCustomIdentifierFieldBySlot(slot);
      const normalizedValue =
        field && !field.case_sensitive
          ? value.toLowerCase().trim()
          : value.trim();

      const fieldName = `custom_identifier_${slot}` as const;
      const query: Record<string, unknown> = {
        [fieldName]: normalizedValue,
      };
      if (excludeUserId) {
        query._id = { $ne: excludeUserId };
      }
      return (await this.userRepo.count(query)) === 0;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'isCustomIdentifierAvailable',
        slot,
        value,
        excludeUserId,
      });
      return false;
    }
  }

  public async findByRecoveryToken(token: string): Promise<IUser | null> {
    try {
      if (!token) return null;
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      return this.userRepo.findOne({
        'recovery.secondary_email.verification_token': tokenHash,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'find_user_by_recovery_token_failed',
        token: token ? 'provided' : 'missing',
      });
      return null;
    }
  }

  // ── Business operations ───────────────────────────────────────────────────────

  public async updateUserLastLoginDate(
    id: string,
    username: string
  ): Promise<IUser> {
    try {
      if (!id && !username) {
        throw new Error('Either user ID or username is required');
      }

      let user: IUser | null;
      if (username) {
        user = await this.userRepo.findOne({ username });
      } else {
        user = await this.userRepo.findById(id);
      }

      if (!user) {
        throw new Error('User not found');
      }

      return this.userRepo.update(String(user._id!), {
        last_login: new Date(),
      } as UpdateUserDto);
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_updating_user_last_login_date',
        id,
        username,
        error: err.message,
      });
      throw error;
    }
  }

  public async verifyTotp(
    userIdentifier: string,
    code: string
  ): Promise<boolean> {
    try {
      const sanitizedCode = this.validateTotpCode(code);

      let user = await this.findByUsername(userIdentifier);
      if (!user && userIdentifier.match(/^[0-9a-fA-F]{24}$/)) {
        user = (await this.userRepo.findById(userIdentifier)) || undefined;
      }

      if (!user) {
        this.logger.debug('User not found for TOTP verification', {
          userIdentifier,
        });
        return false;
      }

      if (!this.mfaUtils.isTotpEnabled(user)) {
        this.logger.debug('TOTP MFA not enabled for user', {
          username: user.username,
          mfaEnabled: user.mfa?.enabled,
          totpEnabled: user.mfa?.methods?.totp?.enabled,
        });
        return false;
      }

      const totpSecret = this.mfaUtils.getUserTotpSecret(user);
      if (!totpSecret) {
        this.logger.debug('TOTP secret not found for user', {
          username: user.username,
        });
        return false;
      }

      const result = this.mfaUtils.verifyTotpCode(sanitizedCode, totpSecret);
      if (!result.valid && result.error) {
        this.logger.error('TOTP verification failed', {
          context: 'totp_verification_error',
          username: user.username,
          error: result.error,
        });
      }

      return result.valid;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err as Error, {
        context: 'error_in_verifyTotp',
        userIdentifier,
      });
      return false;
    }
  }

  public async enableMfaTotp(username: string, secret: string): Promise<IUser> {
    try {
      if (!secret || typeof secret !== 'string' || secret.trim().length === 0) {
        throw new Error('TOTP secret is required');
      }

      const user = await this.findByUsername(username);
      if (!user) {
        throw new Error('User not found');
      }

      if (!/^[A-Z2-7]+=*$/.test(secret)) {
        throw new Error('Invalid TOTP secret format');
      }

      const encryptedSecret = encryptValue(secret);

      const mfaUpdate: IUserMfaUpdate = {
        enabled: true,
        'methods.totp': {
          enabled: true,
          secret: encryptedSecret,
          verified_at: new Date(),
        },
      };

      await this.userRepo.updateMfa(String(user._id!), mfaUpdate);
      const updatedUser = await this.userRepo.findById(String(user._id!));

      if (!updatedUser) {
        throw new Error('Failed to update user');
      }

      this.logger.info('MFA TOTP enabled for user', { username });
      return updatedUser;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err as Error, {
        context: 'error_enabling_mfa_totp',
        username,
      });
      throw error;
    }
  }

  public async initiateMfaTotpSetup(
    username: string,
    secret: string
  ): Promise<IUser> {
    try {
      if (!secret || typeof secret !== 'string' || secret.trim().length === 0) {
        throw new Error('TOTP secret is required');
      }

      const user = await this.findByUsername(username);
      if (!user) {
        throw new Error('User not found');
      }

      if (!/^[A-Z2-7]+=*$/.test(secret)) {
        throw new Error('Invalid TOTP secret format');
      }

      const encryptedSecret = encryptValue(secret);

      const mfaUpdate: IUserMfaUpdate = {
        'methods.totp': {
          enabled: false,
          secret: encryptedSecret,
        },
      };

      await this.userRepo.updateMfa(String(user._id!), mfaUpdate);
      const updatedUser = await this.userRepo.findById(String(user._id!));

      if (!updatedUser) {
        throw new Error('Failed to update user');
      }

      this.logger.info('MFA TOTP setup initiated for user', { username });
      return updatedUser;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err as Error, {
        context: 'error_initiating_mfa_totp_setup',
        username,
      });
      throw error;
    }
  }

  public async verifyTotpSetupCode(
    username: string,
    code: string
  ): Promise<boolean> {
    try {
      const sanitizedCode = this.validateTotpCode(code);

      const user = await this.findByUsername(username);
      if (!user) {
        this.logger.debug('User not found for TOTP setup verification', {
          username,
        });
        return false;
      }

      if (!this.mfaUtils.isTotpPendingSetup(user)) {
        this.logger.debug('No pending TOTP setup for user', {
          username,
          totpEnabled: user.mfa?.methods?.totp?.enabled,
          hasSecret: Boolean(user.mfa?.methods?.totp?.secret),
        });
        return false;
      }

      const totpSecret = this.mfaUtils.getUserTotpSecret(user);
      if (!totpSecret) {
        this.logger.debug('TOTP secret not found for pending setup', {
          username,
        });
        return false;
      }

      const result = this.mfaUtils.verifyTotpCode(sanitizedCode, totpSecret);
      if (!result.valid && result.error) {
        this.logger.error('TOTP setup verification failed', {
          context: 'totp_setup_verification_error',
          username,
          error: result.error,
        });
      }

      return result.valid;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err as Error, {
        context: 'error_in_verifyTotpSetupCode',
        username,
      });
      return false;
    }
  }

  public async enableMfaEmail(username: string): Promise<IUser> {
    try {
      const user = await this.findByUsername(username);
      if (!user) {
        throw new Error('User not found');
      }

      const mfaUpdate: IUserMfaUpdate = {
        enabled: true,
        'methods.email': {
          enabled: true,
          verified_at: new Date(),
        },
      };

      await this.userRepo.updateMfa(String(user._id!), mfaUpdate);
      const updatedUser = await this.userRepo.findById(String(user._id!));

      if (!updatedUser) {
        throw new Error('Failed to update user');
      }

      this.logger.info('MFA Email enabled for user', { username });
      return updatedUser;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err as Error, {
        context: 'error_enabling_mfa_email',
        username,
      });
      throw error;
    }
  }

  public async initiateEmailMfaSetup(
    username: string,
    ttlSeconds: number = 600
  ): Promise<{ code: string; expiresAt: Date }> {
    try {
      const user = await this.findByUsername(username);
      if (!user) {
        throw new Error('User not found');
      }

      const otpResult = this.mfaUtils.generateEmailOtp(ttlSeconds);

      await this.userRepo.setEmailOtp(String(user._id!), {
        hash: otpResult.hash,
        expires: otpResult.expiresAt,
      });

      this.logger.info('Email MFA setup initiated', { username, ttlSeconds });
      return { code: otpResult.code, expiresAt: otpResult.expiresAt };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'error_initiating_email_mfa_setup',
        username,
      });
      throw error;
    }
  }

  public async verifyEmailMfaSetupCode(
    username: string,
    code: string
  ): Promise<boolean> {
    try {
      if (!code || typeof code !== 'string' || code.trim().length === 0) {
        this.logger.debug('Email MFA setup verification failed: missing code', {
          username,
        });
        return false;
      }

      const user = await this.findByUsername(username);
      if (!user) {
        this.logger.debug('User not found for email MFA setup verification', {
          username,
        });
        return false;
      }

      if (!this.mfaUtils.isEmailMfaPendingSetup(user)) {
        this.logger.debug('No pending email MFA setup found', { username });
        return false;
      }

      const { hash: stored, expires } = user.mfa!.email_otp!;
      const result = this.mfaUtils.verifyEmailOtp(code.trim(), stored, expires);

      if (!result.valid) {
        this.logger.debug('Email MFA setup code verification failed', {
          username,
          error: result.error,
        });
        return false;
      }

      try {
        await this.userRepo.clearEmailOtp(String(user._id!));
        this.logger.info('Email MFA setup code verified and cleared', {
          username,
        });
      } catch (updateError) {
        this.logger.error(
          'Failed to clear email OTP after setup verification',
          {
            username,
            error: (updateError as Error).message,
          }
        );
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'error_in_verifyEmailMfaSetupCode',
        username,
      });
      return false;
    }
  }

  public async disableMfa(
    username: string,
    method?: 'totp' | 'email' | 'webauthn'
  ): Promise<IUser> {
    try {
      const user = await this.findByUsername(username);
      if (!user) {
        throw new Error('User not found');
      }

      let mfaUpdate: IUserMfaUpdate;

      if (method) {
        const hasOtherMethods = this.mfaUtils.hasAnyMethodEnabled(user, method);
        if (method === 'totp') {
          mfaUpdate = {
            enabled: hasOtherMethods,
            'methods.totp': { enabled: false },
          };
        } else if (method === 'email') {
          mfaUpdate = {
            enabled: hasOtherMethods,
            'methods.email': { enabled: false },
          };
        } else {
          mfaUpdate = {
            enabled: hasOtherMethods,
            'methods.webauthn': { enabled: false },
          };
        }
      } else {
        mfaUpdate = {
          enabled: false,
          'methods.totp': { enabled: false },
          'methods.email': { enabled: false },
          'methods.webauthn': { enabled: false },
        };
      }

      await this.userRepo.updateMfa(String(user._id!), mfaUpdate);
      const updatedUser = await this.userRepo.findById(String(user._id!));

      if (!updatedUser) {
        throw new Error('Failed to update user');
      }

      this.logger.info('MFA disabled for user', {
        username,
        method: method || 'all',
      });
      return updatedUser;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err as Error, {
        context: 'error_disabling_mfa',
        username,
        method,
      });
      throw error;
    }
  }

  public async setEmailOtp(
    username: string,
    code: string,
    ttlSeconds: number
  ): Promise<IUser> {
    try {
      if (!code || typeof code !== 'string' || code.trim().length === 0) {
        throw new Error('OTP code is required');
      }

      const user = await this.findByUsername(username);
      if (!user) {
        throw new Error('User not found');
      }

      const otpResult = this.mfaUtils.generateEmailOtp(ttlSeconds);

      const otpData =
        code.trim() !== otpResult.code
          ? {
              hash: crypto
                .createHash(UserService.HASH_ALGORITHM)
                .update(code.trim())
                .digest('hex'),
              expires: new Date(Date.now() + ttlSeconds * 1000),
            }
          : {
              hash: otpResult.hash,
              expires: otpResult.expiresAt,
            };

      await this.userRepo.setEmailOtp(String(user._id!), otpData);
      const updatedUser = await this.userRepo.findById(String(user._id!));

      if (!updatedUser) {
        throw new Error('Failed to update user');
      }

      this.logger.info('Email OTP set for user', { username, ttlSeconds });
      return updatedUser;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err as Error, {
        context: 'error_setting_email_otp',
        username,
      });
      throw error;
    }
  }

  public async verifyEmailOtp(
    username: string,
    code: string
  ): Promise<boolean> {
    try {
      if (!code || typeof code !== 'string' || code.trim().length === 0) {
        this.logger.debug('Email OTP verification failed: missing code', {
          username,
        });
        return false;
      }

      const user = await this.findByUsername(username);
      if (!user || !user.mfa || !user.mfa.email_otp) {
        this.logger.debug('User not found or no email OTP configured', {
          username,
        });
        return false;
      }

      const { hash: stored, expires } = user.mfa.email_otp;
      const result = this.mfaUtils.verifyEmailOtp(code.trim(), stored, expires);

      if (!result.valid) {
        this.logger.debug('Email OTP verification failed', {
          username,
          error: result.error,
        });
        return false;
      }

      try {
        await this.userRepo.clearEmailOtp(String(user._id!));
        this.logger.info('Email OTP verified and cleared', { username });
      } catch (updateError) {
        this.logger.error('Failed to clear email OTP after verification', {
          username,
          error: (updateError as Error).message,
        });
        return false;
      }

      return true;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err as Error, {
        context: 'error_verifying_email_otp',
        username,
      });
      return false;
    }
  }

  public async updateProfile(
    userId: string,
    profileData: ProfileUpdateData
  ): Promise<IUser> {
    try {
      const validatedData: Partial<IUser> = {};

      if (profileData.given_name !== undefined) {
        if (
          typeof profileData.given_name === 'string' &&
          profileData.given_name.trim().length > 0
        ) {
          validatedData.given_name = profileData.given_name.trim();
        }
      }

      if (profileData.family_name !== undefined) {
        if (
          typeof profileData.family_name === 'string' &&
          profileData.family_name.trim().length > 0
        ) {
          validatedData.family_name = profileData.family_name.trim();
        }
      }

      if (profileData.name !== undefined) {
        if (
          typeof profileData.name === 'string' &&
          profileData.name.trim().length > 0
        ) {
          validatedData.name = profileData.name.trim();
        }
      }

      if (profileData.phone_number !== undefined) {
        if (
          typeof profileData.phone_number === 'string' &&
          profileData.phone_number.trim().length > 0
        ) {
          if (!profileData.phone_number.match(/^\+?[\d\s\-()]+$/)) {
            throw new Error('Invalid phone number format');
          }
          validatedData.phone_number = profileData.phone_number.trim();
        }
      }

      const stringFields = [
        'picture',
        'locale',
        'country',
        'zoneinfo',
        'city',
        'address',
        'street_address',
        'region',
        'postal_code',
      ] as const;
      for (const field of stringFields) {
        if (profileData[field] !== undefined) {
          const value = profileData[field];
          if (typeof value === 'string' && value.trim().length > 0) {
            (validatedData as any)[field] = value.trim();
          }
        }
      }

      if (profileData.theme !== undefined) {
        if (profileData.theme === 'light' || profileData.theme === 'dark') {
          (validatedData as any).theme = profileData.theme;
        }
      }

      const updatedUser = await this.userRepo.update(
        userId,
        validatedData as UpdateUserDto
      );

      if (!updatedUser) {
        throw new Error('User not found');
      }

      this.logger.info('User profile updated', { userId });
      return updatedUser;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err as Error, {
        context: 'error_updating_user_profile',
        userId,
      });
      throw error;
    }
  }

  public async updateNotificationPreferences(
    userId: string,
    preferences: {
      preferred_channel: 'email' | 'sms' | 'auto';
      security_alerts: boolean;
      new_session_alerts: boolean;
      marketing: boolean;
    }
  ): Promise<IUser> {
    try {
      const updatedUser = await this.userRepo.update(userId, {
        notification_preferences: {
          preferred_channel: preferences.preferred_channel,
          security_alerts: preferences.security_alerts,
          new_session_alerts: preferences.new_session_alerts,
          marketing: preferences.marketing,
        },
      } as UpdateUserDto);

      this.logger.info('User notification preferences updated', { userId });
      return updatedUser;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err as Error, {
        context: 'error_updating_notification_preferences',
        userId,
      });
      throw error;
    }
  }

  public async updateWithAssignment(
    id: string,
    data: Partial<IUser>,
    _options: {
      populate?: string | string[];
      session?: any;
    } = {}
  ): Promise<IUser | null> {
    try {
      return await this.userRepo.update(id, data as UpdateUserDto);
    } catch (error) {
      const msg = (error as Error).message ?? '';
      if (msg.includes('not found') || msg.includes('Document not found')) {
        return null;
      }
      this.logger.error(error as Error, { id, data });
      throw error;
    }
  }

  public async changePassword(
    userId: string,
    passwordData: PasswordChangeData
  ): Promise<IUser> {
    try {
      if (!passwordData.newPassword) {
        throw new Error('New password is required');
      }

      const passwordValidation = this.validatePassword(
        passwordData.newPassword
      );
      if (!passwordValidation.isValid) {
        throw new Error(
          `Password validation failed: ${passwordValidation.messages.join(', ')}`
        );
      }

      const user = await this.userRepo.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      if (passwordData.currentPassword) {
        const passwordResult = await this.verifyPasswordWithRehash(
          passwordData.currentPassword,
          user.password || ''
        );

        if (!passwordResult.valid) {
          throw new Error('Current password is incorrect');
        }

        if (passwordResult.newHash) {
          try {
            await this.userRepo.update(userId, {
              password: passwordResult.newHash,
              password_hash_algo: 'argon2id',
              password_updated_at: new Date(),
            } as UpdateUserDto);

            this.logger.info(
              'Current password hash upgraded during password change',
              { userId }
            );
          } catch (updateError) {
            this.logger.error(
              'Failed to update upgraded current password hash',
              {
                userId,
                error: (updateError as Error).message,
              }
            );
          }
        }
      } else {
        if (user.password && user.password.trim() !== '') {
          throw new Error(
            'Current password is required to change existing password'
          );
        }

        this.logger.info('Setting initial password for user', { userId });
      }

      let hashedNewPassword: string;
      try {
        hashedNewPassword = await this.passwordUtils.hashPassword(
          passwordData.newPassword
        );
      } catch (error) {
        this.logger.error((error as Error).message, {
          context: 'error_hashing_password',
          userId,
        });
        throw new Error('Failed to hash password');
      }

      const updatedUser = await this.userRepo.update(userId, {
        password: hashedNewPassword,
        password_hash_algo: 'argon2id',
        password_updated_at: new Date(),
        password_force_reset: false,
      } as UpdateUserDto);

      this.logger.info('User password changed', { userId });
      return updatedUser;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err as Error, {
        context: 'error_changing_user_password',
        userId,
      });
      throw error;
    }
  }

  public async updateAvatar(
    userId: string,
    avatarPath: string
  ): Promise<IUser> {
    try {
      if (
        !avatarPath ||
        typeof avatarPath !== 'string' ||
        avatarPath.trim().length === 0
      ) {
        throw new Error('Avatar path is required');
      }

      const updatedUser = await this.userRepo.update(userId, {
        picture: avatarPath.trim(),
      } as UpdateUserDto);

      this.logger.info('User avatar updated', { userId, avatarPath });
      return updatedUser;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err as Error, {
        context: 'error_updating_user_avatar',
        userId,
        avatarPath,
      });
      throw error;
    }
  }

  public async removeAvatar(userId: string): Promise<IUser> {
    try {
      const updatedUser = await this.userRepo.update(userId, {
        picture: '',
      } as UpdateUserDto);

      this.logger.info('User avatar removed', { userId });
      return updatedUser;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_removing_user_avatar',
        userId,
        error: err.message,
      });
      throw error;
    }
  }

  public validatePassword(password: string): {
    isValid: boolean;
    messages: string[];
  } {
    const messages: string[] = [];
    let isValid = true;

    if (!password || typeof password !== 'string') {
      messages.push('Password is required');
      return { isValid: false, messages };
    }

    const config = this.configManager.getConfig();
    const minLength =
      config.security.authentication.login.password_policy.min_length;
    const requireUppercase =
      config.security.authentication.login.password_policy.require_uppercase;
    const requireLowercase =
      config.security.authentication.login.password_policy.require_lowercase;
    const requireNumbers =
      config.security.authentication.login.password_policy.require_numbers;
    const requireSymbols =
      config.security.authentication.login.password_policy.require_symbols;

    if (password.length < minLength) {
      messages.push(`Password must be at least ${minLength} characters long`);
      isValid = false;
    }

    if (password.length > 128) {
      messages.push('Password must be no more than 128 characters long');
      isValid = false;
    }

    if (requireUppercase && !/[A-Z]/.test(password)) {
      messages.push('Password must contain at least one uppercase letter');
      isValid = false;
    }

    if (requireLowercase && !/[a-z]/.test(password)) {
      messages.push('Password must contain at least one lowercase letter');
      isValid = false;
    }

    if (requireNumbers && !/\d/.test(password)) {
      messages.push('Password must contain at least one number');
      isValid = false;
    }

    if (
      requireSymbols &&
      !/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)
    ) {
      messages.push('Password must contain at least one special character');
      isValid = false;
    }

    if (/(.)\1{2,}/.test(password)) {
      messages.push(
        'Password cannot contain repeated characters (e.g., "aaa")'
      );
      isValid = false;
    }

    if (
      /123|234|345|456|567|678|789|890/.test(password) ||
      /abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz/i.test(
        password
      )
    ) {
      messages.push(
        'Password cannot contain sequential characters (e.g., "123", "abc")'
      );
      isValid = false;
    }

    return { isValid, messages };
  }

  public getPasswordPolicy(): {
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumbers: boolean;
    requireSymbols: boolean;
    maxAgeDays: number;
  } {
    const config = this.configManager.getConfig();
    return {
      minLength:
        config.security.authentication.login.password_policy.min_length,
      requireUppercase:
        config.security.authentication.login.password_policy.require_uppercase,
      requireLowercase:
        config.security.authentication.login.password_policy.require_lowercase,
      requireNumbers:
        config.security.authentication.login.password_policy.require_numbers,
      requireSymbols:
        config.security.authentication.login.password_policy.require_symbols,
      maxAgeDays:
        config.security.authentication.login.password_policy.max_age_days,
    };
  }

  // ── IUserStatisticsService ────────────────────────────────────────────────────

  public async countTotalUsers(): Promise<number> {
    try {
      return await this.userRepo.count({});
    } catch (error) {
      this.logger.error('Error counting total users', {
        error: (error as Error).message,
      });
      return 0;
    }
  }

  public async countActiveUsers(): Promise<number> {
    try {
      return await this.userRepo.count({
        account_enabled: true,
        account_is_anonymized: false,
      });
    } catch (error) {
      this.logger.error('Error counting active users', {
        error: (error as Error).message,
      });
      return 0;
    }
  }

  public async countDisabledUsers(): Promise<number> {
    try {
      return await this.userRepo.count({ account_enabled: false });
    } catch (error) {
      this.logger.error('Error counting disabled users', {
        error: (error as Error).message,
      });
      return 0;
    }
  }

  public async countAnonymizedUsers(): Promise<number> {
    try {
      return await this.userRepo.count({ account_is_anonymized: true });
    } catch (error) {
      this.logger.error('Error counting anonymized users', {
        error: (error as Error).message,
      });
      return 0;
    }
  }

  public async countAdminUsers(): Promise<number> {
    try {
      return await this.userRepo.count({
        roles: { $in: ['admin', 'superadmin'] },
      });
    } catch (error) {
      this.logger.error('Error counting admin users', {
        error: (error as Error).message,
      });
      return 0;
    }
  }

  public async countRecentUsers(days: number = 7): Promise<number> {
    try {
      const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      return await this.userRepo.count({
        created_at: { $gte: cutoffDate },
      });
    } catch (error) {
      this.logger.error('Error counting recent users', {
        days,
        error: (error as Error).message,
      });
      return 0;
    }
  }

  public async getUserStatistics(): Promise<{
    totalUsers: number;
    activeUsers: number;
    disabledUsers: number;
    anonymizedUsers: number;
    adminUsers: number;
    recentUsers: number;
  }> {
    try {
      const [
        totalUsers,
        activeUsers,
        disabledUsers,
        anonymizedUsers,
        adminUsers,
        recentUsers,
      ] = await Promise.all([
        this.countTotalUsers(),
        this.countActiveUsers(),
        this.countDisabledUsers(),
        this.countAnonymizedUsers(),
        this.countAdminUsers(),
        this.countRecentUsers(7),
      ]);

      return {
        totalUsers,
        activeUsers,
        disabledUsers,
        anonymizedUsers,
        adminUsers,
        recentUsers,
      };
    } catch (error) {
      this.logger.error('Error getting user statistics', {
        error: (error as Error).message,
      });
      return {
        totalUsers: 0,
        activeUsers: 0,
        disabledUsers: 0,
        anonymizedUsers: 0,
        adminUsers: 0,
        recentUsers: 0,
      };
    }
  }

  // ── IUserCustomIdentifierService ─────────────────────────────────────────────

  public getCustomIdentifierFields(): import('../di/interfaces/user/user-custom-identifier-service.interface.js').CustomIdentifierFieldConfig[] {
    const config = this.configManager.getConfig();
    const ciConfig = config.security.authentication.custom_identifiers;
    if (!ciConfig?.enabled) return [];
    return ciConfig.fields ?? [];
  }

  public getCustomIdentifierFieldByKey(
    key: string
  ):
    | import('../di/interfaces/user/user-custom-identifier-service.interface.js').CustomIdentifierFieldConfig
    | undefined {
    return this.getCustomIdentifierFields().find(f => f.key === key);
  }

  public getCustomIdentifierFieldBySlot(
    slot: 1 | 2 | 3
  ):
    | import('../di/interfaces/user/user-custom-identifier-service.interface.js').CustomIdentifierFieldConfig
    | undefined {
    return this.getCustomIdentifierFields().find(f => f.slot === slot);
  }

  public async setCustomIdentifier(
    userId: string,
    slot: 1 | 2 | 3,
    value: string
  ): Promise<IUser> {
    const fieldName = `custom_identifier_${slot}` as const;
    try {
      const user = await this.userRepo.update(userId, {
        [fieldName]: value,
      } as UpdateUserDto);

      if (!user) {
        throw new Error('User not found');
      }

      this.logger.info('Custom identifier set successfully', {
        userId,
        slot,
        context: 'setCustomIdentifier',
      });

      return user;
    } catch (error) {
      this.logger.error('Failed to set custom identifier', {
        userId,
        slot,
        error: (error as Error).message,
        context: 'setCustomIdentifier',
      });
      throw error;
    }
  }

  public getCustomIdentifier(user: IUser, slot: 1 | 2 | 3): string | undefined {
    switch (slot) {
      case 1:
        return user.custom_identifier_1;
      case 2:
        return user.custom_identifier_2;
      case 3:
        return user.custom_identifier_3;
    }
  }

  public async removeCustomIdentifier(
    userId: string,
    slot: 1 | 2 | 3
  ): Promise<IUser> {
    const fieldName = `custom_identifier_${slot}` as const;
    try {
      const user = await this.userRepo.update(userId, {
        [fieldName]: null,
      } as UpdateUserDto);

      if (!user) {
        throw new Error('User not found');
      }

      this.logger.info('Custom identifier removed successfully', {
        userId,
        slot,
        context: 'removeCustomIdentifier',
      });

      return user;
    } catch (error) {
      this.logger.error('Failed to remove custom identifier', {
        userId,
        slot,
        error: (error as Error).message,
        context: 'removeCustomIdentifier',
      });
      throw error;
    }
  }

  public async generateUniqueUsername(): Promise<string> {
    try {
      let username = crypto.randomUUID();

      const isUsernameTaken = async (name: string): Promise<boolean> => {
        return (await this.userRepo.count({ username: name })) > 0;
      };

      while (await isUsernameTaken(username)) {
        username = crypto.randomUUID();
      }

      return username;
    } catch (error) {
      this.logger.error(error as Error, { context: 'generateUniqueUsername' });
      return crypto.randomUUID();
    }
  }

  public async createUserWithGeneratedUsername(
    userData: Partial<IUser>
  ): Promise<IUser> {
    try {
      const { email } = userData;
      const username = await this.generateUniqueUsername();

      const user = await this.userRepo.create({
        ...userData,
        username,
        register_with: email ? 'email' : 'phone_number',
        email_verified: userData.email_verified ?? false,
        phone_number_verified: userData.phone_number_verified ?? false,
        account_enabled: userData.account_enabled ?? true,
        roles: userData.roles ?? ['user'],
        auth_provider: userData.auth_provider ?? 'local',
      } as CreateUserDto);

      this.logger.info('User created with generated username', {
        username,
        userId: (user as any)._id,
      });
      return user;
    } catch (error) {
      // Translate MongoDB duplicate-key errors into user-friendly messages
      // so raw E11000 details never leak to the end user.
      if (
        error instanceof Error &&
        'code' in error &&
        (error as any).code === 11000
      ) {
        const keyPattern = (error as any).keyPattern as
          | Record<string, number>
          | undefined;
        let friendly: string;

        if (keyPattern?.email) {
          friendly = 'Email is already registered';
        } else if (
          keyPattern?.custom_identifier_1 ||
          keyPattern?.custom_identifier_2 ||
          keyPattern?.custom_identifier_3
        ) {
          friendly = 'This identifier is already taken';
        } else if (keyPattern?.username) {
          friendly = 'Username is already taken';
        } else {
          friendly = 'An account with these details already exists';
        }

        this.logger.error('Duplicate key conflict during user creation', {
          keyPattern,
          originalError: error.message,
        });
        throw new Error(friendly);
      }

      this.logger.error('Error creating user with generated username', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  // ── IUserCredentialsService ───────────────────────────────────────────────────

  public async isPasswordMatch(
    password: string,
    hashedPassword: string
  ): Promise<boolean> {
    try {
      return (await this.passwordUtils.verifyPassword(password, hashedPassword))
        .valid;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'password_verification_failed',
      });
      return false;
    }
  }

  public async verifyPasswordWithRehash(
    password: string,
    hashedPassword: string
  ): Promise<{ valid: boolean; newHash?: string }> {
    try {
      const result = await this.passwordUtils.verifyPassword(
        password,
        hashedPassword
      );

      if (result.valid && result.needsUpgrade) {
        const newHash = await this.passwordUtils.rehashIfNeeded(
          password,
          hashedPassword
        );
        if (newHash) {
          this.logger.info('Password hash upgraded due to outdated parameters');
          return { valid: true, newHash };
        }
      }

      return { valid: result.valid };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'password_verification_with_rehash_failed',
      });
      return { valid: false };
    }
  }

  // ── IUserLifecycleService ─────────────────────────────────────────────────────

  public async softDelete(userId: string): Promise<IUser> {
    try {
      return await this.userRepo.update(userId, {
        account_is_anonymized: true,
        last_login: new Date(),
      } as UpdateUserDto);
    } catch (error) {
      this.logger.error(error as Error, { context: 'softDelete', userId });
      throw error;
    }
  }

  public async restore(userId: string): Promise<IUser> {
    try {
      return await this.userRepo.update(userId, {
        account_is_anonymized: false,
        last_login: new Date(),
      } as UpdateUserDto);
    } catch (error) {
      this.logger.error(error as Error, { context: 'restore', userId });
      throw error;
    }
  }

  public async anonymize(userId: string): Promise<IUser> {
    try {
      const user = await this.userRepo.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const anonymizedData = {
        account_is_anonymized: true,
        family_name: 'Anonymized',
        given_name: 'Anonymized',
        nickname: 'Anonymized',
        preferred_username: 'Anonymized',
        middle_name: 'Anonymized',
        gender: 'M' as const,
        birthdate: new Date('1970-01-01'),
        phone_number: 'Anonymized',
        profile: 'Anonymized',
        website: 'Anonymized',
        picture: 'Anonymized',
        email: `anon-${Date.now()}_${user.email}`,
        address: 'Anonymized',
        street_address: 'Anonymized',
        city: 'Anonymized',
        region: 'Anonymized',
        postal_code: 'Anonymized',
      };

      return await this.userRepo.update(
        userId,
        anonymizedData as UpdateUserDto
      );
    } catch (error) {
      this.logger.error(error as Error, { context: 'anonymize', userId });
      throw error;
    }
  }

  public async activate(userId: string): Promise<IUser> {
    try {
      return await this.userRepo.update(userId, {
        account_enabled: true,
      } as UpdateUserDto);
    } catch (error) {
      this.logger.error(error as Error, { context: 'activate', userId });
      throw error;
    }
  }

  public async deactivate(userId: string): Promise<IUser> {
    try {
      return await this.userRepo.update(userId, {
        account_enabled: false,
      } as UpdateUserDto);
    } catch (error) {
      this.logger.error(error as Error, { context: 'deactivate', userId });
      throw error;
    }
  }
}
