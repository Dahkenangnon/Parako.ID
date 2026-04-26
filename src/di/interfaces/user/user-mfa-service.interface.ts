import { type IUser } from '../../../types/user.js';

/**
 * Interface for user MFA (Multi-Factor Authentication) operations
 * Handles TOTP and email OTP operations
 */
export interface IUserMfaService {
  // TOTP operations
  verifyTotp(userIdentifier: string, code: string): Promise<boolean>;
  enableMfaTotp(username: string, secret: string): Promise<IUser>;
  initiateMfaTotpSetup(username: string, secret: string): Promise<IUser>;
  verifyTotpSetupCode(username: string, code: string): Promise<boolean>;
  enableMfaEmail(username: string): Promise<IUser>;
  initiateEmailMfaSetup(
    username: string,
    ttlSeconds?: number
  ): Promise<{ code: string; expiresAt: Date }>;
  verifyEmailMfaSetupCode(username: string, code: string): Promise<boolean>;
  disableMfa(
    username: string,
    method?: 'totp' | 'email' | 'webauthn'
  ): Promise<IUser>;

  // Email OTP operations
  setEmailOtp(
    username: string,
    code: string,
    ttlSeconds: number
  ): Promise<IUser>;
  verifyEmailOtp(username: string, code: string): Promise<boolean>;
}
