import { type IUser } from '../../../types/user.js';

/**
 * Password change data structure
 */
export interface PasswordChangeData {
  currentPassword?: string;
  newPassword: string;
}

/**
 * Password validation result
 */
export interface PasswordValidationResult {
  isValid: boolean;
  messages: string[];
}

/**
 * Password policy configuration
 */
export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSymbols: boolean;
  maxAgeDays: number;
}

/**
 * Interface for user credentials management
 * Handles password operations and validation
 */
export interface IUserCredentialsService {
  changePassword(
    userId: string,
    passwordData: PasswordChangeData
  ): Promise<IUser>;
  validatePassword(password: string): PasswordValidationResult;
  getPasswordPolicy(): PasswordPolicy;

  isPasswordMatch(password: string, hashedPassword: string): Promise<boolean>;
  verifyPasswordWithRehash(
    password: string,
    hashedPassword: string
  ): Promise<{ valid: boolean; newHash?: string }>;
}
