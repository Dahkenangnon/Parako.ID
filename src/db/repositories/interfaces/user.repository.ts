import type { IUser } from '../../../types/user.js';
import type {
  IBaseRepository,
  PaginatedResult,
  PaginationOptions,
} from './base.repository.js';

export interface UserFilter {
  email?: string;
  username?: string;
  roles?: string[];
  account_enabled?: boolean;
  auth_provider?: string;
  register_with?: string;
  account_is_anonymized?: boolean;
  created_at?: { $gte?: Date; $lte?: Date };
}

export type CreateUserDto = Omit<
  IUser,
  'id' | '_id' | 'created_at' | 'updated_at'
>;

export type UpdateUserDto = Partial<CreateUserDto>;

export interface IUserMfaUpdate {
  enabled?: boolean;
  preferred_method?: 'totp' | 'email' | 'webauthn';
  'methods.totp'?: {
    enabled?: boolean;
    secret?: string;
    verified_at?: Date;
  };
  'methods.email'?: {
    enabled?: boolean;
    verified_at?: Date;
  };
  'methods.webauthn'?: {
    enabled?: boolean;
    verified_at?: Date;
  };
  email_otp?: { hash: string; expires: Date } | null;
}

export interface IRecoveryLockout {
  failed_attempts?: number;
  last_failed_at?: Date;
  locked_until?: Date | null;
}

export interface ISecurityQuestion {
  id: string;
  question_key: string;
  answer_hash: string;
}

export interface IWebAuthnCredential {
  credential_id: string;
  publicKey: string;
  counter: number;
  device_type?: string;
  backed_up?: boolean;
  transports?: string[];
}

export interface IUserRepository extends Omit<
  IBaseRepository<IUser, CreateUserDto, UpdateUserDto>,
  'findMany'
> {
  findByEmail(email: string): Promise<IUser | null>;
  findByUsername(username: string): Promise<IUser | null>;
  findBySub(sub: string): Promise<IUser | null>;
  findBySecondaryEmail(email: string): Promise<IUser | null>;
  findMany(
    filter: UserFilter,
    opts?: PaginationOptions
  ): Promise<PaginatedResult<IUser>>;
  updateMfa(id: string, mfa: IUserMfaUpdate): Promise<void>;
  updateRecovery(id: string, recovery: Record<string, unknown>): Promise<void>;
  addWebAuthnCredential(
    id: string,
    credential: IWebAuthnCredential
  ): Promise<void>;
  removeWebAuthnCredential(id: string, credentialId: string): Promise<void>;
  addBackupCodes(id: string, codes: string[]): Promise<void>;
  consumeBackupCode(id: string, codeHash: string): Promise<boolean>;
  addSecurityQuestion(id: string, q: ISecurityQuestion): Promise<void>;
  updateRecoveryLockout(id: string, lockout: IRecoveryLockout): Promise<void>;
  setEmailOtp(id: string, otp: { hash: string; expires: Date }): Promise<void>;
  clearEmailOtp(id: string): Promise<void>;
  forcePasswordReset(id: string): Promise<void>;
  anonymize(id: string): Promise<IUser>;
}
