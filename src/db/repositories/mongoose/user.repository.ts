import { injectable } from 'inversify';
import type { IUser, UserModel } from '../../../models/user.model.js';
import type {
  IUserRepository,
  UserFilter,
  CreateUserDto,
  UpdateUserDto,
  IUserMfaUpdate,
  IRecoveryLockout,
  ISecurityQuestion,
  IWebAuthnCredential,
} from '../interfaces/user.repository.js';
import type {
  PaginatedResult,
  PaginationOptions,
  QueryOptions,
} from '../interfaces/base.repository.js';
import { AbstractMongooseRepository } from './base.repository.js';
import { serializeDocument } from '../../utils.js';
import crypto from 'node:crypto';
import { computeUserName } from '../user-name.js';

@injectable()
export class MongooseUserRepository
  extends AbstractMongooseRepository<IUser, CreateUserDto, UpdateUserDto>
  implements IUserRepository
{
  constructor(private readonly userModel: UserModel) {
    super(userModel);
  }

  async update(id: string, data: UpdateUserDto): Promise<IUser> {
    const update = { ...data };

    // findByIdAndUpdate does not run the schema's pre-save hook. Materialize
    // the derived name here so MongoDB and Prisma expose the same profile.
    if (
      data.given_name !== undefined ||
      data.family_name !== undefined ||
      data.name !== undefined
    ) {
      update.name = computeUserName(
        data.given_name,
        data.family_name,
        data.custom_identifier_1,
        data.name
      );
    }

    return super.update(id, update);
  }

  async findByEmail(email: string): Promise<IUser | null> {
    return this.findOne({ email });
  }

  async findByUsername(username: string): Promise<IUser | null> {
    return this.findOne({ username });
  }

  async findBySub(sub: string): Promise<IUser | null> {
    return this.findOne({ sub });
  }

  async findBySecondaryEmail(email: string): Promise<IUser | null> {
    return this.findOne({ 'recovery.secondary_email.email': email });
  }

  async findByRecoveryTokenHash(tokenHash: string): Promise<IUser | null> {
    return this.findOne({
      'recovery.secondary_email.verification_token': tokenHash,
    });
  }

  // IUserRepository omits findMany from base and redefines it with paginated return.
  // The override is intentionally incompatible with the base class signature.
  // @ts-expect-error -- return type narrowed from T[] to PaginatedResult per IUserRepository
  async findMany(
    filter: UserFilter,
    opts?: PaginationOptions
  ): Promise<PaginatedResult<IUser>> {
    return this.paginate(filter as Record<string, unknown>, opts);
  }

  async findManyRaw(filter: UserFilter, opts?: QueryOptions): Promise<IUser[]> {
    return super.findMany(filter as Record<string, unknown>, opts);
  }

  async updateMfa(id: string, mfa: IUserMfaUpdate): Promise<void> {
    const update: Record<string, unknown> = {};
    if (mfa.enabled !== undefined) update['mfa.enabled'] = mfa.enabled;
    if (mfa.preferred_method !== undefined)
      update['mfa.preferred_method'] = mfa.preferred_method;
    if (mfa['methods.totp'] !== undefined)
      update['mfa.methods.totp'] = mfa['methods.totp'];
    if (mfa['methods.email'] !== undefined)
      update['mfa.methods.email'] = mfa['methods.email'];
    if (mfa['methods.webauthn'] !== undefined)
      update['mfa.methods.webauthn'] = mfa['methods.webauthn'];
    if ('email_otp' in mfa) update['mfa.email_otp'] = mfa.email_otp;
    await this.userModel.findByIdAndUpdate(id, { $set: update }).exec();
  }

  async updateRecovery(
    id: string,
    recovery: Record<string, unknown>
  ): Promise<void> {
    const update: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(recovery)) {
      update[`recovery.${k}`] = v;
    }
    await this.userModel.findByIdAndUpdate(id, { $set: update }).exec();
  }

  async addWebAuthnCredential(
    id: string,
    credential: IWebAuthnCredential
  ): Promise<void> {
    await this.userModel
      .findByIdAndUpdate(id, {
        $push: { 'mfa.methods.webauthn.credentials': credential },
        $set: { 'mfa.methods.webauthn.enabled': true },
      })
      .exec();
  }

  async removeWebAuthnCredential(
    id: string,
    credentialId: string
  ): Promise<void> {
    await this.userModel
      .findByIdAndUpdate(id, {
        $pull: {
          'mfa.methods.webauthn.credentials': { credential_id: credentialId },
        },
      })
      .exec();
  }

  async addBackupCodes(id: string, codes: string[]): Promise<void> {
    await this.userModel
      .findByIdAndUpdate(id, {
        $set: {
          'recovery.backup_codes': {
            codes,
            generated_at: new Date(),
            expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
          },
        },
      })
      .exec();
  }

  async consumeBackupCode(id: string, codeHash: string): Promise<boolean> {
    const result = await this.userModel
      .updateOne(
        {
          _id: id,
          'recovery.backup_codes.codes': codeHash,
        },
        {
          $pull: { 'recovery.backup_codes.codes': codeHash },
        }
      )
      .exec();
    return result.modifiedCount > 0;
  }

  async addSecurityQuestion(id: string, q: ISecurityQuestion): Promise<void> {
    await this.userModel
      .findByIdAndUpdate(id, {
        $push: { 'recovery.security_questions.questions': q },
        $set: { 'recovery.security_questions.setup_at': new Date() },
      })
      .exec();
  }

  async updateRecoveryLockout(
    id: string,
    lockout: IRecoveryLockout
  ): Promise<void> {
    const update: Record<string, unknown> = {};
    if (lockout.failed_attempts !== undefined)
      update['recovery.security_questions.failed_attempts'] =
        lockout.failed_attempts;
    if (lockout.last_failed_at !== undefined)
      update['recovery.security_questions.last_failed_at'] =
        lockout.last_failed_at;
    if ('locked_until' in lockout)
      update['recovery.security_questions.locked_until'] = lockout.locked_until;
    await this.userModel.findByIdAndUpdate(id, { $set: update }).exec();
  }

  async setEmailOtp(
    id: string,
    otp: { hash: string; expires: Date }
  ): Promise<void> {
    await this.userModel
      .findByIdAndUpdate(id, {
        $set: { 'mfa.email_otp': otp },
      })
      .exec();
  }

  async clearEmailOtp(id: string): Promise<void> {
    await this.userModel
      .findByIdAndUpdate(id, {
        $unset: { 'mfa.email_otp': '' },
      })
      .exec();
  }

  async forcePasswordReset(id: string): Promise<void> {
    await this.userModel
      .findByIdAndUpdate(id, { $set: { password_force_reset: true } })
      .exec();
  }

  async anonymize(id: string): Promise<IUser> {
    const anonymizedId = crypto.randomBytes(8).toString('hex');
    const doc = await this.userModel
      .findByIdAndUpdate(
        id,
        {
          $set: {
            email: `anonymized_${anonymizedId}@deleted.invalid`,
            username: `anonymized_${anonymizedId}`,
            given_name: 'Anonymized',
            family_name: 'User',
            name: 'Anonymized User',
            nickname: '',
            phone_number: '',
            picture: '',
            profile: '',
            website: '',
            birthdate: undefined,
            custom_identifier_1: undefined,
            custom_identifier_2: undefined,
            custom_identifier_3: undefined,
            account_is_anonymized: true,
            account_enabled: false,
            password: undefined,
            mfa: undefined,
            recovery: undefined,
          },
        },
        { returnDocument: 'after' }
      )
      .lean()
      .exec();
    if (!doc) throw new Error(`User not found: ${id}`);
    return serializeDocument(doc) as IUser;
  }
}
