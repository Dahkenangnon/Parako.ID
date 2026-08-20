import { type IUser, type RegisterWith } from '../../types/user.js';

export interface AuthUserData {
  email?: string;
  password: string;
  given_name?: string;
  family_name?: string;
  phone_number?: string;
  register_with?: RegisterWith;
  custom_identifier_1?: string;
  custom_identifier_2?: string;
  custom_identifier_3?: string;
}

export interface ManagedAuthUserData extends AuthUserData {
  username?: string;
  name?: string;
  nickname?: string;
  role?: string;
  account_enabled?: boolean;
}

export interface PasswordResetResult {
  user: IUser;
  resetToken: string;
}

export interface EmailVerificationResult {
  user: IUser;
  verificationToken: string;
}

export interface PhoneVerificationChallenge {
  user: IUser;
  verificationToken: string;
  code: string;
  expiresAt: Date;
}

export type PhoneVerificationDelivery = (
  challenge: PhoneVerificationChallenge
) => Promise<boolean>;

export interface AdminPasswordChangeOptions {
  requireReset?: boolean;
  sendEmail?: boolean;
  reason?: string;
}

export interface LoginResult {
  user: IUser;
  isFirstLogin?: boolean;
  requiresPasswordReset?: boolean;
}

export interface IAuthService {
  isValidEmailAddress(email: string): boolean;

  loginWithEmail(email: string, password: string): Promise<IUser>;
  loginWithUsername(username: string, password: string): Promise<IUser>;
  loginWithPhoneNumber(phoneNumber: string, password: string): Promise<IUser>;
  loginWithCustomIdentifier(
    slot: 1 | 2 | 3,
    value: string,
    password: string
  ): Promise<IUser>;

  registerUser(userData: AuthUserData): Promise<IUser>;
  registerManagedUser(userData: ManagedAuthUserData): Promise<IUser>;

  generatePasswordResetToken(email: string): Promise<PasswordResetResult>;
  resetPassword(token: string, newPassword: string): Promise<IUser>;
  changePassword(
    username: string,
    currentPassword: string,
    newPassword: string,
    logoutOtherDevices?: boolean
  ): Promise<IUser>;
  adminChangeUserPassword(
    adminUsername: string,
    targetUserId: string,
    newPassword: string,
    options?: AdminPasswordChangeOptions
  ): Promise<IUser>;
  changeUserPasswordByAuthorizedClient(
    actorClientId: string,
    targetUserId: string,
    newPassword: string,
    options?: AdminPasswordChangeOptions
  ): Promise<IUser>;

  verifyEmail(token: string): Promise<IUser>;
  generateEmailVerificationToken(
    userId: string
  ): Promise<EmailVerificationResult>;
  generatePhoneVerificationChallenge(
    userId: string
  ): Promise<PhoneVerificationChallenge>;
  renewPhoneVerificationChallenge(
    verificationToken: string,
    deliver?: PhoneVerificationDelivery
  ): Promise<PhoneVerificationChallenge>;
  verifyPhone(verificationToken: string, code: string): Promise<IUser>;

  isAdmin(user: IUser): boolean;
  hasRole(user: IUser, role: string): boolean;
  findUserByUsername(username: string): Promise<IUser | null>;

  // MFA
  verifyTotp(userIdentifier: string, code: string): Promise<boolean>;

  // Email OTP for new device verification
  generateEmailOtp(userId: string): Promise<{ code: string; expiresAt: Date }>;
  verifyEmailOtp(userId: string, code: string): Promise<boolean>;
}
