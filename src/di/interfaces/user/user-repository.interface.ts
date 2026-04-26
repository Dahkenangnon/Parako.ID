import { type IUser } from '../../../types/user.js';

/**
 * Interface for user repository operations
 * Handles user find/query operations
 */
export interface IUserRepository {
  findById(id: string): Promise<IUser | undefined>;
  findByEmail(email: string): Promise<IUser | undefined>;
  findByUsername(username: string): Promise<IUser | undefined>;
  findByPhoneNumber(phoneNumber: string): Promise<IUser | undefined>;
  findByCustomIdentifier(
    slot: 1 | 2 | 3,
    value: string
  ): Promise<IUser | undefined>;
  findByRecoveryEmail(email: string): Promise<IUser | undefined>;
  findByRecoveryToken(token: string): Promise<IUser | null>;

  findByEmailIncludingDisabled(email: string): Promise<IUser | undefined>;
  findByUsernameIncludingDisabled(username: string): Promise<IUser | undefined>;
  findByPhoneNumberIncludingDisabled(
    phoneNumber: string
  ): Promise<IUser | undefined>;

  isEmailTaken(email: string): Promise<boolean>;
  isPhoneNumberTaken(phoneNumber: string): Promise<boolean>;
  isUserNameTaken(username: string): Promise<boolean>;
  isCustomIdentifierAvailable(
    slot: 1 | 2 | 3,
    value: string,
    excludeUserId?: string
  ): Promise<boolean>;
}
